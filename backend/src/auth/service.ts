/**
 * Sign-up and sign-in flows (email + password, Google, Apple, email 2FA).
 * Every successful sign-in ends in issueSession(): a 15-minute access token
 * and a rotating 60-day refresh token.
 */
import { randomInt } from "node:crypto";
import { Types } from "mongoose";
import { User } from "../models/index.js";
import { AppError } from "../lib/errors.js";
import { enforce } from "../lib/rateLimit.js";
import { isValidTimeZone } from "../lib/time.js";
import { logger } from "../lib/logger.js";
import { ensureBalance } from "../wallet/balances.js";
import { hashPassword, verifyPassword, dummyVerify, PASSWORD_MIN, PASSWORD_MAX } from "./password.js";
import { consumeOtp, sendOtp } from "./otp.js";
import { issueRefreshToken, revokeAllForUser, revokeRefreshToken, rotateRefreshToken } from "./refreshTokens.js";
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken } from "./tokens.js";
import { isDisposableEmail } from "./disposable.js";
import type { Mailer } from "./mailer.js";
import type { SocialProvider, SocialVerifier } from "./social.js";

export interface AuthDeps {
  mailer: Mailer;
  social: SocialVerifier;
  jwtAccessSecret: string;
}

const LOCK_AFTER_FAILURES = 10;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const REFERRAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

/** The user fields sign-in needs (works for lean reads and toObject()). */
export interface SessionUser {
  _id: Types.ObjectId;
  email: string;
  name: string;
  emailVerified: boolean;
  timezone: string;
  referralCode: string;
  twoFactor?: { enabled?: boolean | null } | null;
  photoUrl?: string | null;
  providers?: unknown;
}

export function publicUser(u: SessionUser) {
  const providers = (u.providers ?? {}) as { google?: { sub?: string }; apple?: { sub?: string } };
  return {
    id: String(u._id),
    email: u.email,
    name: u.name,
    photoUrl: u.photoUrl ?? undefined,
    emailVerified: u.emailVerified,
    timezone: u.timezone,
    referralCode: u.referralCode,
    twoFactorEnabled: Boolean(u.twoFactor?.enabled),
    linkedProviders: (["google", "apple"] as const).filter((p) => providers[p]?.sub),
  };
}

async function issueSession(user: SessionUser, deps: AuthDeps, deviceId?: string) {
  await ensureBalance(user._id);
  const accessToken = await signAccessToken(String(user._id), deps.jwtAccessSecret);
  const { token: refreshToken } = await issueRefreshToken(user._id, { deviceId });
  if (deviceId) await User.updateOne({ _id: user._id }, { $addToSet: { deviceIds: deviceId } });
  return { accessToken, accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS, refreshToken, user: publicUser(user) };
}

async function uniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = Array.from({ length: 8 }, () => REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)]).join("");
    if (!(await User.exists({ referralCode: code }))) return code;
  }
  throw new Error("could not generate a unique referral code");
}

async function resolveReferrer(code: string | undefined): Promise<Types.ObjectId | undefined> {
  if (!code) return undefined;
  const referrer = await User.findOne({ referralCode: code.trim().toUpperCase(), status: "active" }).select({ _id: 1 }).lean();
  if (!referrer) throw new AppError(400, "invalid_referral", "That referral code doesn't exist.");
  return referrer._id;
}

function checkPassword(password: string) {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new AppError(400, "weak_password", `Use a password of at least ${PASSWORD_MIN} characters.`);
  }
}

function checkTimezone(tz: string) {
  if (!isValidTimeZone(tz)) throw new AppError(400, "invalid_timezone", "Your device's time zone wasn't recognised.");
}

// ── email + password ──────────────────────────────────────────────────────

export async function register(
  deps: AuthDeps,
  input: { email: string; password: string; name: string; timezone: string; referralCode?: string; ip?: string },
) {
  const email = input.email.trim().toLowerCase();
  if (input.ip) await enforce(`register-ip:${input.ip}`, 10, 60 * 60 * 1000);
  if (isDisposableEmail(email)) throw new AppError(400, "disposable_email", "Please use a permanent email address.");
  checkPassword(input.password);
  checkTimezone(input.timezone);
  if (await User.exists({ email })) throw new AppError(409, "email_taken", "An account with this email already exists. Try signing in.");
  const referredBy = await resolveReferrer(input.referralCode);

  let user;
  try {
    user = await User.create({
      email,
      passwordHash: await hashPassword(input.password),
      name: input.name.trim(),
      timezone: input.timezone,
      referralCode: await uniqueReferralCode(),
      referredBy,
      emailVerified: false,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new AppError(409, "email_taken", "An account with this email already exists. Try signing in.");
    throw err;
  }
  await sendOtp(deps.mailer, { email, purpose: "verify_email", userId: user._id });
  return { email, verificationRequired: true };
}

export async function verifyEmail(deps: AuthDeps, input: { email: string; code: string; deviceId?: string }) {
  const email = input.email.trim().toLowerCase();
  await consumeOtp({ email, purpose: "verify_email", code: input.code });
  const user = await User.findOneAndUpdate({ email, status: "active" }, { $set: { emailVerified: true } }, { returnDocument: "after", lean: true });
  if (!user) throw new AppError(400, "otp_invalid", "That code is wrong or has expired.");
  return issueSession(user, deps, input.deviceId);
}

/** Always succeeds from the caller's point of view, so it can't be used to probe which emails exist. */
export async function resendVerification(deps: AuthDeps, emailIn: string) {
  const email = emailIn.trim().toLowerCase();
  const user = await User.findOne({ email, status: "active", emailVerified: false }).select({ _id: 1 }).lean();
  if (user) await sendOtp(deps.mailer, { email, purpose: "verify_email", userId: user._id });
  return { ok: true };
}

export async function login(deps: AuthDeps, input: { email: string; password: string; deviceId?: string; ip?: string }, now = Date.now()) {
  const email = input.email.trim().toLowerCase();
  if (input.ip) await enforce(`login-ip:${input.ip}`, 30, LOCK_WINDOW_MS);

  const user = await User.findOne({ email, status: "active" }).select("+passwordHash").lean();
  if (!user || !user.passwordHash) {
    await dummyVerify(input.password);
    throw new AppError(401, "invalid_credentials", "Email or password is incorrect.");
  }
  if (user.lockUntil && user.lockUntil.getTime() > now) {
    throw new AppError(429, "account_locked", "Too many failed attempts. Try again in 15 minutes or reset your password.");
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    const inWindow = user.failedLogins?.windowStart && now - user.failedLogins.windowStart.getTime() < LOCK_WINDOW_MS;
    const count = (inWindow ? user.failedLogins!.count : 0) + 1;
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          failedLogins: { count, windowStart: inWindow ? user.failedLogins!.windowStart : new Date(now) },
          ...(count >= LOCK_AFTER_FAILURES ? { lockUntil: new Date(now + LOCK_WINDOW_MS) } : {}),
        },
      },
    );
    throw new AppError(401, "invalid_credentials", "Email or password is incorrect.");
  }
  await User.updateOne({ _id: user._id }, { $set: { failedLogins: { count: 0 } }, $unset: { lockUntil: 1 } });

  if (!user.emailVerified) {
    await sendOtp(deps.mailer, { email, purpose: "verify_email", userId: user._id }).catch(() => undefined);
    throw new AppError(403, "email_not_verified", "Verify your email to continue. We've sent you a code.");
  }
  return afterFirstFactor(deps, user, input.deviceId);
}

/** Second step when 2FA is on: email a code and return a challenge instead of tokens. */
async function afterFirstFactor(deps: AuthDeps, user: SessionUser, deviceId?: string) {
  if (user.twoFactor?.enabled) {
    const challengeId = await sendOtp(deps.mailer, { email: user.email, purpose: "login_2fa", userId: user._id });
    return { twoFactorRequired: true as const, challengeId: String(challengeId), email: user.email };
  }
  return issueSession(user, deps, deviceId);
}

export async function verifyTwoFactor(deps: AuthDeps, input: { email: string; challengeId: string; code: string; deviceId?: string }) {
  const { userId } = await consumeOtp({ email: input.email, purpose: "login_2fa", code: input.code, challengeId: input.challengeId });
  const user = await User.findOne({ _id: userId, status: "active" }).lean();
  if (!user) throw new AppError(400, "otp_invalid", "That code is wrong or has expired.");
  return issueSession(user, deps, input.deviceId);
}

// ── Google / Apple ───────────────────────────────────────────────────────

export async function socialLogin(
  deps: AuthDeps,
  input: { provider: SocialProvider; idToken: string; timezone: string; name?: string; referralCode?: string; deviceId?: string },
) {
  const id = await deps.social.verify(input.provider, input.idToken);
  const subPath = `providers.${input.provider}.sub`;

  let user: (SessionUser & { status?: string | null }) | null = await User.findOne({ [subPath]: id.sub }).lean();
  if (user && user.status !== "active") throw new AppError(403, "account_inactive", "This account is no longer active.");

  if (!user) {
    if (!id.email || !id.emailVerified) {
      throw new AppError(400, "email_required", "Share your email with BitMine to create an account.");
    }
    const byEmail = await User.findOne({ email: id.email }).lean();
    if (byEmail) {
      if (byEmail.status !== "active") throw new AppError(403, "account_inactive", "This account is no longer active.");
      // The provider vouches for this email, so link it to the existing account.
      user = await User.findOneAndUpdate(
        { _id: byEmail._id },
        { $set: { [subPath]: id.sub, emailVerified: true } },
        { returnDocument: "after", lean: true },
      );
    } else {
      checkTimezone(input.timezone);
      if (isDisposableEmail(id.email) && input.provider === "google") {
        throw new AppError(400, "disposable_email", "Please use a permanent email address.");
      }
      const referredBy = await resolveReferrer(input.referralCode);
      const created = await User.create({
        email: id.email,
        name: (id.name ?? input.name ?? id.email.split("@")[0] ?? "Miner").slice(0, 60),
        timezone: input.timezone,
        referralCode: await uniqueReferralCode(),
        referredBy,
        emailVerified: true,
        providers: { [input.provider]: { sub: id.sub } },
      });
      user = created.toObject() as unknown as SessionUser;
      logger.info({ userId: String(created._id), provider: input.provider }, "account created via social sign-in");
    }
  }
  return afterFirstFactor(deps, user!, input.deviceId);
}

// ── sessions and passwords ───────────────────────────────────────────────

export async function refresh(deps: AuthDeps, refreshToken: string) {
  const { userId, refreshToken: next } = await rotateRefreshToken(refreshToken);
  const user = await User.findOne({ _id: userId, status: "active" }).lean();
  if (!user) throw new AppError(401, "session_expired", "Your session has ended. Please sign in again.");
  return {
    accessToken: await signAccessToken(String(userId), deps.jwtAccessSecret),
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: next,
    user: publicUser(user),
  };
}

export async function logout(refreshToken: string) {
  await revokeRefreshToken(refreshToken);
  return { ok: true };
}

export async function forgotPassword(deps: AuthDeps, emailIn: string) {
  const email = emailIn.trim().toLowerCase();
  const user = await User.findOne({ email, status: "active" }).select({ _id: 1 }).lean();
  if (user) await sendOtp(deps.mailer, { email, purpose: "reset_password", userId: user._id }).catch((err) => {
    // Don't reveal existence through errors other than the rate limit.
    if (err instanceof AppError && err.status === 429) throw err;
    logger.error({ err }, "reset email failed");
  });
  return { ok: true };
}

export async function resetPassword(input: { email: string; code: string; newPassword: string }) {
  const email = input.email.trim().toLowerCase();
  checkPassword(input.newPassword);
  await consumeOtp({ email, purpose: "reset_password", code: input.code });
  const user = await User.findOneAndUpdate(
    { email, status: "active" },
    { $set: { passwordHash: await hashPassword(input.newPassword), emailVerified: true, failedLogins: { count: 0 } }, $unset: { lockUntil: 1 } },
    { returnDocument: "after", lean: true },
  );
  if (!user) throw new AppError(400, "otp_invalid", "That code is wrong or has expired.");
  // Sign out every device: whoever knew the old password loses access.
  await revokeAllForUser(user._id);
  return { ok: true };
}
