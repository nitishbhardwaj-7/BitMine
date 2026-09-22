/**
 * Admin sign-in: email + password, then an authenticator-app code (TOTP).
 * Sessions are random tokens in an HttpOnly, SameSite=Strict cookie scoped to
 * /admin, stored hashed with a 12-hour lifetime. Every form carries a CSRF
 * token tied to the session.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { Types } from "mongoose";
import { AdminAudit, AdminSession, AdminUser } from "../models/index.js";
import { hashPassword, verifyPassword, dummyVerify } from "../auth/password.js";
import { hit } from "../lib/rateLimit.js";
import { newTotpSecret, otpauthUrl, verifyTotp } from "./totp.js";

export const COOKIE = "bm_admin";
const SESSION_MS = 12 * 60 * 60 * 1000;
const PASSWORD_STAGE_MS = 5 * 60 * 1000;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

declare module "express-serve-static-core" {
  interface Request {
    admin?: { id: Types.ObjectId; email: string; csrf: string; sessionId: Types.ObjectId };
  }
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function setCookie(res: Response, value: string, maxAgeMs: number, secure: boolean) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(value)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? "; Secure" : ""}`,
  );
}

export function clearCookie(res: Response) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`);
}

async function createSession(res: Response, adminId: Types.ObjectId, stage: "password" | "full", ip: string, secure: boolean) {
  const token = randomBytes(32).toString("base64url");
  const ttl = stage === "full" ? SESSION_MS : PASSWORD_STAGE_MS;
  await AdminSession.create({ adminId, tokenHash: sha(token), stage, csrf: randomBytes(24).toString("base64url"), ip, expiresAt: new Date(Date.now() + ttl) });
  setCookie(res, token, ttl, secure);
}

async function sessionFrom(req: Request) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const s = await AdminSession.findOne({ tokenHash: sha(token), expiresAt: { $gt: new Date() } }).lean();
  return s;
}

/** Step 1. Returns an error message, or null when the TOTP step should be shown. */
export async function passwordStep(req: Request, res: Response, email: string, password: string, secure: boolean): Promise<string | null> {
  const ip = req.ip ?? "unknown";
  const allowed = (await hit(`admin-login-ip:${ip}`, 10, 15 * 60 * 1000)) && (await hit(`admin-login:${email.toLowerCase()}`, 10, 15 * 60 * 1000));
  if (!allowed) return "Too many attempts. Wait 15 minutes.";
  const admin = await AdminUser.findOne({ email: email.toLowerCase(), active: true }).select("+passwordHash").lean();
  if (!admin) {
    await dummyVerify(password);
    return "Email or password is incorrect.";
  }
  if (!(await verifyPassword(password, admin.passwordHash))) return "Email or password is incorrect.";
  await createSession(res, admin._id, "password", ip, secure);
  return null;
}

/** Step 2. Upgrades the password-stage session to a full one. */
export async function totpStep(req: Request, res: Response, code: string, secure: boolean): Promise<string | null> {
  const s = await sessionFrom(req);
  if (!s || s.stage !== "password") return "Your sign-in timed out. Start again.";
  if (!(await hit(`admin-totp:${s.adminId}`, 8, 15 * 60 * 1000))) return "Too many attempts. Wait 15 minutes.";
  const admin = await AdminUser.findById(s.adminId).select("+totpSecret").lean();
  if (!admin?.active) return "Your sign-in timed out. Start again.";
  const step = verifyTotp(admin.totpSecret, code.trim());
  // A code can be used once: reject steps at or before the last accepted one.
  if (step === null || step <= (admin.lastTotpStep ?? 0)) return "That code is wrong or was already used.";
  const claimed = await AdminUser.updateOne({ _id: admin._id, lastTotpStep: { $lt: step } }, { $set: { lastTotpStep: step, lastLoginAt: new Date() } });
  if (claimed.modifiedCount !== 1) return "That code is wrong or was already used.";

  await AdminSession.deleteOne({ _id: s._id });
  await createSession(res, admin._id, "full", req.ip ?? "unknown", secure);
  await audit(admin._id, "admin.login", {}, req.ip);
  return null;
}

export async function signOut(req: Request, res: Response) {
  const token = readCookie(req, COOKIE);
  if (token) await AdminSession.deleteOne({ tokenHash: sha(token) });
  clearCookie(res);
}

/** Requires a full session; POSTs must also carry the session's CSRF token. */
export const requireAdmin: RequestHandler = async (req, res, next) => {
  try {
    const s = await sessionFrom(req);
    if (!s || s.stage !== "full") return void res.redirect(303, "/admin/login");
    const admin = await AdminUser.findById(s.adminId).lean();
    if (!admin?.active) return void res.redirect(303, "/admin/login");
    if (req.method !== "GET" && req.method !== "HEAD") {
      const sent = String((req.body as Record<string, unknown>)?._csrf ?? "");
      const ok = sent.length === s.csrf.length && timingSafeEqual(Buffer.from(sent), Buffer.from(s.csrf));
      if (!ok) return void res.status(403).send("Form expired. Go back, refresh the page and try again.");
    }
    req.admin = { id: admin._id, email: admin.email, csrf: s.csrf, sessionId: s._id };
    next();
  } catch (err) {
    next(err);
  }
};

export async function audit(adminId: Types.ObjectId, action: string, target: { type?: string; id?: string; details?: unknown }, ip?: string) {
  await AdminAudit.create({ adminId, action, targetType: target.type, targetId: target.id, details: target.details, ip });
}

/** Used by the create-admin script. Returns the TOTP enrolment details to show once. */
export async function createAdmin(email: string, password: string) {
  const secret = newTotpSecret();
  await AdminUser.create({ email, passwordHash: await hashPassword(password), totpSecret: secret });
  return { secret, url: otpauthUrl(secret, email) };
}
