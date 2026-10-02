/**
 * Admin sign-in: email + password. Sessions are random tokens in an HttpOnly,
 * SameSite=Strict cookie scoped to /admin, stored hashed with a 12-hour
 * lifetime. Every form carries a CSRF token tied to the session. Sign-in is
 * rate-limited per IP and per account (10 attempts per 15 minutes).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { Types } from "mongoose";
import { AdminAudit, AdminSession, AdminUser } from "../models/index.js";
import { hashPassword, verifyPassword, dummyVerify } from "../auth/password.js";
import { hit } from "../lib/rateLimit.js";

export const COOKIE = "bm_admin";
const SESSION_MS = 12 * 60 * 60 * 1000;

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

async function createSession(res: Response, adminId: Types.ObjectId, ip: string, secure: boolean) {
  const token = randomBytes(32).toString("base64url");
  await AdminSession.create({ adminId, tokenHash: sha(token), stage: "full", csrf: randomBytes(24).toString("base64url"), ip, expiresAt: new Date(Date.now() + SESSION_MS) });
  setCookie(res, token, SESSION_MS, secure);
}

async function sessionFrom(req: Request) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  return AdminSession.findOne({ tokenHash: sha(token), expiresAt: { $gt: new Date() } }).lean();
}

/** Signs in. Returns an error message for the page, or null when the session cookie was set. */
export async function signIn(req: Request, res: Response, email: string, password: string, secure: boolean): Promise<string | null> {
  const ip = req.ip ?? "unknown";
  const allowed = (await hit(`admin-login-ip:${ip}`, 10, 15 * 60 * 1000)) && (await hit(`admin-login:${email.toLowerCase()}`, 10, 15 * 60 * 1000));
  if (!allowed) return "Too many attempts. Wait 15 minutes.";
  const admin = await AdminUser.findOne({ email: email.toLowerCase(), active: true }).select("+passwordHash").lean();
  if (!admin) {
    await dummyVerify(password);
    return "Email or password is incorrect.";
  }
  if (!(await verifyPassword(password, admin.passwordHash))) return "Email or password is incorrect.";
  await AdminUser.updateOne({ _id: admin._id }, { $set: { lastLoginAt: new Date() } });
  await createSession(res, admin._id, ip, secure);
  await audit(admin._id, "admin.login", {}, ip);
  return null;
}

export async function signOut(req: Request, res: Response) {
  const token = readCookie(req, COOKIE);
  if (token) await AdminSession.deleteOne({ tokenHash: sha(token) });
  clearCookie(res);
}

/** Requires a session; POSTs must also carry the session's CSRF token. */
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

/** Used by the create-admin script. */
export async function createAdmin(email: string, password: string) {
  await AdminUser.create({ email, passwordHash: await hashPassword(password) });
}

/** Used by the create-admin script (--reset-password). Signs that admin out everywhere. */
export async function setAdminPassword(email: string, password: string) {
  const admin = await AdminUser.findOne({ email }).lean();
  if (!admin) return false;
  await AdminUser.updateOne({ _id: admin._id }, { $set: { passwordHash: await hashPassword(password) } });
  await AdminSession.deleteMany({ adminId: admin._id });
  return true;
}
