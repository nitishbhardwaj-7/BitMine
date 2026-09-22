import { Router, type Request } from "express";
import { z } from "zod";
import { enforce } from "../lib/rateLimit.js";
import {
  forgotPassword,
  login,
  logout,
  refresh,
  register,
  resendVerification,
  resetPassword,
  socialLogin,
  verifyEmail,
  verifyTwoFactor,
  type AuthDeps,
} from "../auth/service.js";

const email = z.string().trim().toLowerCase().email().max(254);
const code = z.string().trim().regex(/^\d{6}$/, "6-digit code");
const deviceId = z.string().trim().max(128).optional();
const timezone = z.string().trim().min(1).max(64);
const referralCode = z.string().trim().max(16).optional().transform((v) => v || undefined);

const schemas = {
  register: z.object({ email, password: z.string().max(128), name: z.string().trim().min(1).max(60), timezone, referralCode }),
  verifyEmail: z.object({ email, code, deviceId }),
  emailOnly: z.object({ email }),
  login: z.object({ email, password: z.string().max(128), deviceId }),
  twoFactor: z.object({ email, challengeId: z.string().length(24), code, deviceId }),
  social: z.object({
    provider: z.enum(["google", "apple"]),
    idToken: z.string().min(20).max(8000),
    timezone,
    name: z.string().trim().max(60).optional(),
    referralCode,
    deviceId,
  }),
  refresh: z.object({ refreshToken: z.string().min(20).max(200) }),
  reset: z.object({ email, code, newPassword: z.string().max(128) }),
};

const OTP_VERIFY_LIMIT = 30;
const QUARTER_HOUR = 15 * 60 * 1000;
const ip = (req: Request) => req.ip ?? "unknown";

/** Public endpoints: no access token needed. */
export function authRouter(deps: AuthDeps) {
  const r = Router();

  r.post("/register", async (req, res) => {
    const body = schemas.register.parse(req.body);
    res.status(201).json(await register(deps, { ...body, ip: ip(req) }));
  });

  r.post("/verify-email", async (req, res) => {
    await enforce(`otp-verify-ip:${ip(req)}`, OTP_VERIFY_LIMIT, QUARTER_HOUR);
    res.json(await verifyEmail(deps, schemas.verifyEmail.parse(req.body)));
  });

  r.post("/resend-verification", async (req, res) => {
    res.json(await resendVerification(deps, schemas.emailOnly.parse(req.body).email));
  });

  r.post("/login", async (req, res) => {
    const body = schemas.login.parse(req.body);
    res.json(await login(deps, { ...body, ip: ip(req) }));
  });

  r.post("/2fa/verify", async (req, res) => {
    await enforce(`otp-verify-ip:${ip(req)}`, OTP_VERIFY_LIMIT, QUARTER_HOUR);
    res.json(await verifyTwoFactor(deps, schemas.twoFactor.parse(req.body)));
  });

  r.post("/social", async (req, res) => {
    await enforce(`social-ip:${ip(req)}`, 30, QUARTER_HOUR);
    res.json(await socialLogin(deps, schemas.social.parse(req.body)));
  });

  r.post("/refresh", async (req, res) => {
    res.json(await refresh(deps, schemas.refresh.parse(req.body).refreshToken));
  });

  r.post("/logout", async (req, res) => {
    res.json(await logout(schemas.refresh.parse(req.body).refreshToken));
  });

  r.post("/password/forgot", async (req, res) => {
    res.json(await forgotPassword(deps, schemas.emailOnly.parse(req.body).email));
  });

  r.post("/password/reset", async (req, res) => {
    await enforce(`otp-verify-ip:${ip(req)}`, OTP_VERIFY_LIMIT, QUARTER_HOUR);
    res.json(await resetPassword(schemas.reset.parse(req.body)));
  });

  return r;
}
