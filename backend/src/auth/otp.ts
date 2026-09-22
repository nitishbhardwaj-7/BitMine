/**
 * One-time email codes. Fixes BitPlay's OTP bugs (BITPLAY_BUG_AUDIT, medium):
 *  - 6 digits from a CSPRNG, not 4
 *  - bound to the email AND the purpose: a code only works for what it was sent for
 *  - stored hashed; 5 wrong tries and it's dead; 10-minute expiry
 *  - sending is rate-limited per email
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { Types } from "mongoose";
import { Otp } from "../models/index.js";
import { AppError } from "../lib/errors.js";
import { enforce } from "../lib/rateLimit.js";
import type { Mailer } from "./mailer.js";

export type OtpPurpose = "verify_email" | "login_2fa" | "reset_password" | "change_email" | "enable_2fa" | "disable_2fa" | "withdrawal";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
const SEND_LIMIT_PER_HOUR = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

const hashCode = (id: Types.ObjectId, code: string) => createHash("sha256").update(`${id}:${code}`).digest("hex");

const SUBJECTS: Record<OtpPurpose, string> = {
  verify_email: "Your BitMine verification code",
  login_2fa: "Your BitMine sign-in code",
  reset_password: "Reset your BitMine password",
  change_email: "Confirm your new BitMine email",
  enable_2fa: "Turn on two-step verification",
  disable_2fa: "Turn off two-step verification",
  withdrawal: "Confirm your BitMine withdrawal",
};

export async function sendOtp(
  mailer: Mailer,
  p: { email: string; purpose: OtpPurpose; userId?: Types.ObjectId },
  now = Date.now(),
): Promise<Types.ObjectId> {
  const email = p.email.toLowerCase();
  const last = await Otp.findOne({ email, purpose: p.purpose }).sort({ createdAt: -1 }).lean();
  if (last?.createdAt && now - last.createdAt.getTime() < RESEND_COOLDOWN_MS && !last.consumedAt) {
    throw new AppError(429, "otp_cooldown", "A code was just sent. Please wait a minute before asking for another.");
  }
  await enforce(`otp-send:${email}`, SEND_LIMIT_PER_HOUR, 60 * 60 * 1000, "Too many codes requested. Please try again in an hour.");

  // Only the newest code for an email + purpose works.
  await Otp.updateMany({ email, purpose: p.purpose, consumedAt: null }, { $set: { consumedAt: new Date(now) } });

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const _id = new Types.ObjectId();
  await Otp.create({ _id, userId: p.userId, email, purpose: p.purpose, codeHash: hashCode(_id, code), expiresAt: new Date(now + OTP_TTL_MS) });

  await mailer.send({
    to: email,
    subject: SUBJECTS[p.purpose],
    text: `Your code is ${code}\n\nIt expires in 10 minutes. If you didn't request it, you can ignore this email.`,
  });
  return _id;
}

/**
 * Checks and consumes a code. `challengeId` pins a specific code (2FA login);
 * otherwise the newest code for the email + purpose is used.
 */
export async function consumeOtp(
  p: { email: string; purpose: OtpPurpose; code: string; challengeId?: string },
  now = Date.now(),
): Promise<{ userId?: Types.ObjectId }> {
  const email = p.email.toLowerCase();
  const filter: Record<string, unknown> = { email, purpose: p.purpose, consumedAt: null, expiresAt: { $gt: new Date(now) } };
  if (p.challengeId) {
    if (!Types.ObjectId.isValid(p.challengeId)) throw invalid();
    filter._id = new Types.ObjectId(p.challengeId);
  }
  const otp = await Otp.findOne(filter).sort({ createdAt: -1 }).lean();
  if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw invalid();

  const ok =
    /^\d{6}$/.test(p.code) &&
    timingSafeEqual(Buffer.from(hashCode(otp._id, p.code)), Buffer.from(otp.codeHash));
  if (!ok) {
    const after = await Otp.findOneAndUpdate({ _id: otp._id }, { $inc: { attempts: 1 } }, { returnDocument: "after", lean: true });
    if ((after?.attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
      throw new AppError(400, "otp_locked", "Too many wrong codes. Request a new one.");
    }
    throw invalid();
  }
  // Consume atomically: a code works exactly once, even with parallel requests.
  const used = await Otp.updateOne({ _id: otp._id, consumedAt: null }, { $set: { consumedAt: new Date(now) } });
  if (used.modifiedCount !== 1) throw invalid();
  return { userId: otp.userId ?? undefined };
}

function invalid() {
  return new AppError(400, "otp_invalid", "That code is wrong or has expired.");
}
