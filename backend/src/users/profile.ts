/**
 * Signed-in account actions: profile, password, email, 2FA, timezone,
 * referral code, account deletion.
 */
import type { Types } from "mongoose";
import { User, Withdrawal } from "../models/index.js";
import { enforce } from "../lib/rateLimit.js";
import { OPEN_STATUSES } from "../wallet/withdrawals.js";
import { AppError, notFound } from "../lib/errors.js";
import { MS_PER_DAY, isValidTimeZone, nextLocalMidnight } from "../lib/time.js";
import { hashPassword, verifyPassword, PASSWORD_MIN, PASSWORD_MAX } from "../auth/password.js";
import { consumeOtp, sendOtp } from "../auth/otp.js";
import { revokeAllForUser } from "../auth/refreshTokens.js";
import { publicUser } from "../auth/service.js";
import { isDisposableEmail } from "../auth/disposable.js";
import type { Mailer } from "../auth/mailer.js";
import { effectiveTimezone } from "./timezone.js";

const TZ_CHANGE_COOLDOWN_MS = 30 * MS_PER_DAY;
const REFERRAL_WINDOW_MS = 7 * MS_PER_DAY;

async function load(userId: Types.ObjectId, withPassword = false) {
  const q = User.findOne({ _id: userId, status: "active" });
  const u = await (withPassword ? q.select("+passwordHash") : q).lean();
  if (!u) throw notFound("Account");
  return u;
}

export async function getMe(userId: Types.ObjectId) {
  const u = await load(userId);
  return {
    ...publicUser(u),
    timezonePending: u.timezonePending?.tz ? { timezone: u.timezonePending.tz, effectiveAt: u.timezonePending.effectiveAt?.toISOString() } : null,
    notificationPrefs: {
      miningReminder: u.notificationPrefs?.miningReminder !== false,
      minerExpiry: u.notificationPrefs?.minerExpiry !== false,
      withdrawals: u.notificationPrefs?.withdrawals !== false,
      support: u.notificationPrefs?.support !== false,
    },
  };
}

export async function updateProfile(userId: Types.ObjectId, input: { name?: string }) {
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set.name = input.name.trim();
  await User.updateOne({ _id: userId }, { $set: set }, { runValidators: true });
  return getMe(userId);
}

export async function changePassword(userId: Types.ObjectId, input: { currentPassword?: string; newPassword: string }) {
  const u = await load(userId, true);
  if (input.newPassword.length < PASSWORD_MIN || input.newPassword.length > PASSWORD_MAX) {
    throw new AppError(400, "weak_password", `Use a password of at least ${PASSWORD_MIN} characters.`);
  }
  // Accounts created with Google/Apple have no password yet and can set one directly.
  if (u.passwordHash && !(await verifyPassword(input.currentPassword ?? "", u.passwordHash))) {
    throw new AppError(401, "invalid_credentials", "Your current password is incorrect.");
  }
  await User.updateOne({ _id: userId }, { $set: { passwordHash: await hashPassword(input.newPassword) } });
  await revokeAllForUser(userId);
  return { ok: true, signedOut: true };
}

export async function requestEmailChange(mailer: Mailer, userId: Types.ObjectId, newEmailIn: string) {
  const newEmail = newEmailIn.trim().toLowerCase();
  if (isDisposableEmail(newEmail)) throw new AppError(400, "disposable_email", "Please use a permanent email address.");
  if (await User.exists({ email: newEmail })) throw new AppError(409, "email_taken", "That email is already used by another account.");
  // Codes go to an address the user doesn't own yet: cap how many one account can trigger.
  await enforce(`email-change:${userId}`, 5, 60 * 60 * 1000);
  await sendOtp(mailer, { email: newEmail, purpose: "change_email", userId });
  return { ok: true };
}

export async function confirmEmailChange(userId: Types.ObjectId, input: { newEmail: string; code: string }) {
  const newEmail = input.newEmail.trim().toLowerCase();
  const { userId: owner } = await consumeOtp({ email: newEmail, purpose: "change_email", code: input.code });
  if (String(owner) !== String(userId)) throw new AppError(400, "otp_invalid", "That code is wrong or has expired.");
  try {
    await User.updateOne({ _id: userId }, { $set: { email: newEmail, emailVerified: true } });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new AppError(409, "email_taken", "That email is already used by another account.");
    throw err;
  }
  return getMe(userId);
}

export async function requestTwoFactorChange(mailer: Mailer, userId: Types.ObjectId, enable: boolean) {
  const u = await load(userId);
  if (Boolean(u.twoFactor?.enabled) === enable) {
    throw new AppError(409, "no_change", enable ? "Two-step verification is already on." : "Two-step verification is already off.");
  }
  await sendOtp(mailer, { email: u.email, purpose: enable ? "enable_2fa" : "disable_2fa", userId });
  return { ok: true };
}

export async function confirmTwoFactorChange(userId: Types.ObjectId, enable: boolean, code: string) {
  const u = await load(userId);
  await consumeOtp({ email: u.email, purpose: enable ? "enable_2fa" : "disable_2fa", code });
  await User.updateOne({ _id: userId }, { $set: { "twoFactor.enabled": enable } });
  return getMe(userId);
}

/**
 * Timezone changes are allowed once per 30 days and take effect at the next
 * midnight in the *current* zone, so they can't be used to reset claims early.
 */
export async function requestTimezoneChange(userId: Types.ObjectId, tz: string, now = Date.now()) {
  if (!isValidTimeZone(tz)) throw new AppError(400, "invalid_timezone", "That time zone wasn't recognised.");
  const u = await load(userId);
  const current = effectiveTimezone(u, now);
  if (current === tz && !u.timezonePending?.tz) return getMe(userId);
  if (u.timezoneChangedAt && now - u.timezoneChangedAt.getTime() < TZ_CHANGE_COOLDOWN_MS) {
    const nextAllowed = new Date(u.timezoneChangedAt.getTime() + TZ_CHANGE_COOLDOWN_MS);
    throw new AppError(429, "timezone_cooldown", `You can change your time zone again on ${nextAllowed.toDateString()}.`, {
      nextAllowedAt: nextAllowed.toISOString(),
    });
  }
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        timezone: current, // fold in any pending change that already took effect
        timezonePending: { tz, effectiveAt: new Date(nextLocalMidnight(now, current)) },
        timezoneChangedAt: new Date(now),
      },
    },
  );
  return getMe(userId);
}

/** A referral code can still be added within 7 days of signing up, once. */
export async function addReferral(userId: Types.ObjectId, code: string, now = Date.now()) {
  const u = await load(userId);
  if (u.referredBy) throw new AppError(409, "referral_already_set", "You've already used a referral code.");
  if (u.createdAt && now - u.createdAt.getTime() > REFERRAL_WINDOW_MS) {
    throw new AppError(409, "referral_window_closed", "Referral codes can only be added in your first 7 days.");
  }
  const referrer = await User.findOne({ referralCode: code.trim().toUpperCase(), status: "active" }).select({ _id: 1, referredBy: 1 }).lean();
  if (!referrer) throw new AppError(400, "invalid_referral", "That referral code doesn't exist.");
  if (String(referrer._id) === String(userId)) throw new AppError(400, "invalid_referral", "You can't use your own referral code.");
  if (String(referrer.referredBy) === String(userId)) throw new AppError(400, "invalid_referral", "You can't use the code of someone you referred.");
  await User.updateOne({ _id: userId, referredBy: null }, { $set: { referredBy: referrer._id } });
  return getMe(userId);
}

/**
 * Deletes the account: signs out everywhere, frees the email and marks it
 * deleted. Records are kept (not erased) for fraud and accounting review.
 */
export async function deleteAccount(userId: Types.ObjectId, now = Date.now()) {
  const u = await load(userId);
  // Sats that are being paid out must land (or return) before the account goes.
  if (await Withdrawal.exists({ userId, status: { $in: OPEN_STATUSES } })) {
    throw new AppError(409, "withdrawal_open", "You have a withdrawal in progress. Wait until it's sent or returned, then delete your account.");
  }
  await User.updateOne(
    { _id: userId },
    { $set: { status: "deleted", deletedAt: new Date(now), email: `deleted+${userId}@deleted.bitmine.invalid` }, $unset: { providers: 1 } },
  );
  await revokeAllForUser(userId);
  return { ok: true, email: u.email };
}
