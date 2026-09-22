import { Router, type Request } from "express";
import { z } from "zod";
import { requireUser } from "../auth/requireUser.js";
import { startSession } from "../mining/sessions.js";
import { getMiningStatus, listMiners } from "../mining/status.js";
import { createClaimIntent, getClaim } from "../claims/service.js";
import { listProducts, listPurchases, syncFromApp, type StoreDeps } from "../store/service.js";
import { getWallet, listLedger } from "../wallet/wallet.js";
import { listWithdrawals, requestWithdrawal } from "../wallet/withdrawals.js";

const claimBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("regular") }),
  z.object({ kind: z.literal("super"), tier: z.string().min(1).max(40) }),
]);

const withdrawalBody = z.object({
  amountSats: z.number().int().positive(),
  destination: z.string().trim().min(3).max(2000),
});

// requireUser guarantees userId; this narrows the type for handlers.
const uid = (req: Request) => req.userId!;

export function v1Router(opts: { jwtAccessSecret: string; store: StoreDeps }) {
  const r = Router();
  r.use(requireUser(opts.jwtAccessSecret));

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

  r.post("/withdrawals", async (req, res) => {
    const body = withdrawalBody.parse(req.body);
    res.status(201).json(await requestWithdrawal(uid(req), body));
  });

  r.get("/withdrawals", async (req, res) => {
    res.json({ withdrawals: await listWithdrawals(uid(req)) });
  });

  return r;
}
