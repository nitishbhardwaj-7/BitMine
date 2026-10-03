import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import type { SsvVerifier } from "../claims/admobSsv.js";
import { verifySsvReward } from "../claims/service.js";
import { Purchase } from "../models/index.js";
import { refundTransaction, resolveEventUser, syncUser, type StoreDeps } from "../store/service.js";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

interface RcEvent {
  id?: string;
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  transaction_id?: string;
  environment?: string;
  cancel_reason?: string;
  price?: number;
  currency?: string;
}

// RENEWAL: a subscription's next paid period, granted like any other purchase.
const PURCHASE_EVENTS = new Set(["INITIAL_PURCHASE", "NON_RENEWING_PURCHASE", "RENEWAL"]);

export function webhooksRouter(opts: { ssv: SsvVerifier; store: StoreDeps; revenueCatWebhookAuth?: string }) {
  const r = Router();

  // AdMob rewarded SSV callback. Google retries on non-2xx, so every outcome we
  // have *decided* (granted, duplicate, ignored) returns 200; only a bad
  // signature (403) or our own failure (500, via the error handler) does not.
  r.get("/admob-ssv", async (req, res) => {
    const q = req.originalUrl.indexOf("?");
    const rawQuery = q >= 0 ? req.originalUrl.slice(q + 1) : "";
    // AdMob's console sends a bare request to check the URL when it's saved.
    if (!rawQuery) return void res.status(200).send("ok");

    const reward = await opts.ssv.verify(rawQuery);
    if (!reward) {
      req.log.warn("AdMob SSV signature rejected");
      return void res.status(403).send("invalid signature");
    }
    const outcome = await verifySsvReward(reward);
    req.log.info({ outcome, claimId: reward.customData }, "AdMob SSV processed");
    res.status(200).send("ok");
  });

  // RevenueCat webhook (Project settings → Integrations → Webhooks, with the
  // Authorization header set to REVENUECAT_WEBHOOK_AUTH). Purchase events only
  // tell us *who* to look at: the grant itself is based on RevenueCat's REST API.
  // RevenueCat retries on non-2xx, so transient failures return 5xx on purpose.
  r.post("/revenuecat", async (req, res) => {
    const expected = opts.revenueCatWebhookAuth;
    if (!expected) return void res.status(503).json({ error: "not_configured" });
    const header = req.get("authorization") ?? "";
    if (!safeEqual(header, expected) && !safeEqual(header, `Bearer ${expected}`)) {
      return void res.status(401).json({ error: "unauthorized" });
    }

    const event = (req.body as { event?: RcEvent })?.event;
    if (!event?.type) return void res.status(400).json({ error: "missing_event" });
    if (event.environment === "SANDBOX" && !opts.store.allowSandbox) {
      return void res.json({ ignored: "sandbox" });
    }

    if (PURCHASE_EVENTS.has(event.type)) {
      const userId = await resolveEventUser([event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])]);
      if (!userId) {
        req.log.warn({ event: event.id, appUserId: event.app_user_id }, "RevenueCat event for unknown user");
        return void res.json({ ignored: "unknown_user" });
      }
      if (!opts.store.revenueCat) return void res.status(503).json({ error: "store_unavailable" });
      const result = await syncUser(userId, opts.store);
      // Keep the price RevenueCat reports (the REST purchase list doesn't include it).
      if (event.transaction_id) {
        await Purchase.updateOne(
          { storeTransactionId: event.transaction_id, priceUsd: null },
          { $set: { priceUsd: event.price, currency: event.currency, rcEventId: event.id } },
        );
      }
      req.log.info({ event: event.id, type: event.type, granted: result.granted.length }, "RevenueCat purchase event processed");
      return void res.json({ ok: true, granted: result.granted.length });
    }

    // RevenueCat reports store refunds as a CANCELLATION with reason CUSTOMER_SUPPORT.
    if (event.type === "CANCELLATION" && event.cancel_reason === "CUSTOMER_SUPPORT" && event.transaction_id) {
      const result = await refundTransaction(event.transaction_id);
      req.log.warn({ event: event.id, result }, "RevenueCat refund processed");
      return void res.json({ ok: true, refund: result.status });
    }

    if (event.type === "REFUND_REVERSED") {
      req.log.warn({ event: event.id, tx: event.transaction_id }, "RevenueCat refund reversed: needs admin review");
    }
    res.json({ ignored: event.type });
  });

  return r;
}
