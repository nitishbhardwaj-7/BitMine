/**
 * DEVELOPMENT ONLY. Rewarded ads and store purchases only exist on real
 * phones, so the browser build can't complete a claim or a purchase. These
 * routes stand in for AdMob's callback and RevenueCat so the whole flow can be
 * tested on a computer. They are mounted only when DEV_SHORTCUTS=true AND
 * NODE_ENV isn't production (see app.ts), and they act only on the signed-in
 * user's own claims.
 */
import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { requireUser } from "../auth/requireUser.js";
import { Claim, Product } from "../models/index.js";
import { AppError, notFound } from "../lib/errors.js";
import { verifySsvReward } from "../claims/service.js";
import { grantTransaction } from "../store/service.js";

export function devRouter(opts: { jwtAccessSecret: string }) {
  const r = Router();
  r.use(requireUser(opts.jwtAccessSecret));
  const uid = (req: Request) => req.userId!;

  // Acts as AdMob's server-side callback for one of your pending claims.
  r.post("/claims/:id/complete", async (req, res) => {
    const claim = await Claim.findOne({ _id: String(req.params.id), userId: uid(req) }).lean();
    if (!claim) throw notFound("Claim");
    const outcome = await verifySsvReward({ keyId: "dev", customData: String(claim._id), userId: String(uid(req)), transactionId: `dev-${randomUUID()}` });
    res.json(outcome);
  });

  // Acts as a completed store purchase confirmed by RevenueCat.
  r.post("/purchase", async (req, res) => {
    const { sku } = z.object({ sku: z.string() }).parse(req.body);
    const product = await Product.findOne({ sku, active: true }).lean();
    if (!product?.storeIds?.google) throw new AppError(404, "not_found", "Product not found.");
    const result = await grantTransaction(
      uid(req),
      { storeTransactionId: `dev-${randomUUID()}`, productId: product.storeIds.google, store: "play_store", purchasedAt: Date.now(), isSandbox: false },
      { allowSandbox: true },
    );
    res.json(result);
  });

  return r;
}
