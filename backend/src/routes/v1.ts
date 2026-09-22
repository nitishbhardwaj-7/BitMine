import { Router, type Request } from "express";
import { z } from "zod";
import { requireUser } from "../auth/requireUser.js";
import { startSession } from "../mining/sessions.js";
import { getMiningStatus, listMiners } from "../mining/status.js";
import { createClaimIntent, getClaim } from "../claims/service.js";
import { listProducts, listPurchases, syncFromApp, type StoreDeps } from "../store/service.js";
import { getWallet, listLedger } from "../wallet/wallet.js";
import { listWithdrawals, requestWithdrawal, sendWithdrawalCode } from "../wallet/withdrawals.js";
import type { Mailer } from "../auth/mailer.js";
import {
  addReferral,
  changePassword,
  confirmEmailChange,
  confirmTwoFactorChange,
  deleteAccount,
  getMe,
  requestEmailChange,
  requestTimezoneChange,
  requestTwoFactorChange,
  updateProfile,
} from "../users/profile.js";

const claimBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("regular") }),
  z.object({ kind: z.literal("super"), tier: z.string().min(1).max(40) }),
]);

const sixDigits = z.string().trim().regex(/^\d{6}$/, "6-digit code");
const withdrawalBody = z.object({
  amountSats: z.number().int().positive(),
  destination: z.string().trim().min(3).max(2000),
  /** Required when two-step verification is on (see POST /withdrawals/code). */
  code: sixDigits.optional(),
});
const otpCode = z.object({ code: sixDigits });

// requireUser guarantees userId; this narrows the type for handlers.
const uid = (req: Request) => req.userId!;

export function v1Router(opts: { jwtAccessSecret: string; store: StoreDeps; mailer: Mailer }) {
  const r = Router();
  r.use(requireUser(opts.jwtAccessSecret));

  // account
  r.get("/me", async (req, res) => {
    res.json(await getMe(uid(req)));
  });
  r.patch("/me", async (req, res) => {
    res.json(await updateProfile(uid(req), z.object({ name: z.string().trim().min(1).max(60).optional() }).parse(req.body)));
  });
  r.post("/me/password", async (req, res) => {
    const body = z.object({ currentPassword: z.string().max(128).optional(), newPassword: z.string().max(128) }).parse(req.body);
    res.json(await changePassword(uid(req), body));
  });
  r.post("/me/email", async (req, res) => {
    const { newEmail } = z.object({ newEmail: z.string().trim().toLowerCase().email().max(254) }).parse(req.body);
    res.json(await requestEmailChange(opts.mailer, uid(req), newEmail));
  });
  r.post("/me/email/confirm", async (req, res) => {
    const body = z.object({ newEmail: z.string().trim().toLowerCase().email(), code: sixDigits }).parse(req.body);
    res.json(await confirmEmailChange(uid(req), body));
  });
  for (const [path, enable] of [["enable", true], ["disable", false]] as const) {
    r.post(`/me/2fa/${path}`, async (req, res) => {
      res.json(await requestTwoFactorChange(opts.mailer, uid(req), enable));
    });
    r.post(`/me/2fa/${path}/confirm`, async (req, res) => {
      res.json(await confirmTwoFactorChange(uid(req), enable, otpCode.parse(req.body).code));
    });
  }
  r.post("/me/timezone", async (req, res) => {
    const { timezone } = z.object({ timezone: z.string().trim().min(1).max(64) }).parse(req.body);
    res.json(await requestTimezoneChange(uid(req), timezone));
  });
  r.post("/me/referral", async (req, res) => {
    const { code } = z.object({ code: z.string().trim().min(4).max(16) }).parse(req.body);
    res.json(await addReferral(uid(req), code));
  });
  r.post("/me/delete", async (req, res) => {
    z.object({ confirm: z.literal("DELETE") }).parse(req.body);
    res.json(await deleteAccount(uid(req)));
  });

  // mining
  r.get("/mining/status", async (req, res) => {
    res.json(await getMiningStatus(uid(req)));
  });

  r.post("/mining/start", async (req, res) => {
    const s = await startSession(uid(req));
    res.json({ localDate: s!.localDate, startedAt: s!.startedAt.toISOString(), endsAt: s!.endsAt.toISOString() });
  });

  r.get("/miners", async (req, res) => {
    res.json({ miners: await listMiners(uid(req)) });
  });

  r.post("/claims", async (req, res) => {
    const body = claimBody.parse(req.body);
    res.status(201).json(await createClaimIntent(uid(req), body));
  });

  r.get("/claims/:id", async (req, res) => {
    res.json(await getClaim(uid(req), req.params.id!));
  });

  r.get("/store/products", async (_req, res) => {
    res.json({ products: await listProducts() });
  });

  // Called by the app after a purchase completes (no body: we ask RevenueCat what was bought).
  r.post("/store/sync", async (req, res) => {
    res.json(await syncFromApp(uid(req), opts.store));
  });

  r.get("/store/purchases", async (req, res) => {
    res.json({ purchases: await listPurchases(uid(req)) });
  });

  r.get("/wallet", async (req, res) => {
    res.json(await getWallet(uid(req)));
  });

  r.get("/wallet/ledger", async (req, res) => {
    const before = typeof req.query.before === "string" ? req.query.before : undefined;
    res.json(await listLedger(uid(req), before));
  });

  r.post("/withdrawals/code", async (req, res) => {
    res.json(await sendWithdrawalCode(opts.mailer, uid(req)));
  });

  r.post("/withdrawals", async (req, res) => {
    const body = withdrawalBody.parse(req.body);
    res.status(201).json(await requestWithdrawal(uid(req), body));
  });

  r.get("/withdrawals", async (req, res) => {
    res.json({ withdrawals: await listWithdrawals(uid(req)) });
  });

  return r;
}
