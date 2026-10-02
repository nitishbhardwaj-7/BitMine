/**
 * Store (docs/TECHNICAL_SPEC.md §6.4).
 *
 * One grant function, three ways in: the app's POST /v1/store/sync after a
 * purchase, the RevenueCat webhook, and follow-up checks from the worker. All
 * three look the purchase up in RevenueCat first; the unique
 * storeTransactionId makes whichever arrives second a no-op.
 *
 *   paid miner  → a miner of the pack's GH/s for durationDays, stacking freely
 *   Super tier  → that tier's entitlement extended by durationDays
 *   refund      → miner revoked / tier shortened, account flagged for review
 */
import mongoose, { Types, type ClientSession } from "mongoose";
import { Balance, Ledger, Miner, Product, Purchase, StoreSync, SuperEntitlement, User } from "../models/index.js";
import { AppError } from "../lib/errors.js";
import { enforce } from "../lib/rateLimit.js";
import { logger } from "../lib/logger.js";
import { MS_PER_DAY } from "../lib/time.js";
import { ensureBalance } from "../wallet/balances.js";
import { getRateSchedule } from "../settings/economics.js";
import { earnedMsat } from "../mining/accrual.js";
import type { RevenueCatClient, StoreTransaction } from "./revenuecat.js";

export interface StoreDeps {
  revenueCat?: RevenueCatClient;
  allowSandbox: boolean;
}

export type GrantResult =
  | { status: "granted"; purchaseId: string; sku: string; kind: "miner" | "super_miner"; activeUntil?: string }
  | { status: "already_granted"; purchaseId: string }
  | { status: "skipped"; reason: "sandbox" | "unknown_product" };

/** Follow-up checks after an app sync, in case RevenueCat hadn't processed the purchase yet. */
const FOLLOW_UPS_MS = [2 * 60_000, 15 * 60_000, 60 * 60_000];

function requireClient(deps: StoreDeps): RevenueCatClient {
  if (!deps.revenueCat) throw new AppError(503, "store_unavailable", "Purchases are temporarily unavailable.");
  return deps.revenueCat;
}

async function findProductByStoreId(storeProductId: string) {
  return Product.findOne({ $or: [{ "storeIds.apple": storeProductId }, { "storeIds.google": storeProductId }] }).lean();
}

/**
 * Grants one RevenueCat-confirmed transaction to `userId`. Idempotent.
 * `now` is when we process it; the miner itself starts at the purchase time.
 */
export async function grantTransaction(
  userId: Types.ObjectId,
  t: StoreTransaction,
  deps: StoreDeps,
  now = Date.now(),
  extra: { priceUsd?: number; currency?: string; rcEventId?: string } = {},
): Promise<GrantResult> {
  const existing = await Purchase.findOne({ storeTransactionId: t.storeTransactionId }).select({ _id: 1 }).lean();
  if (existing) return { status: "already_granted", purchaseId: String(existing._id) };

  if (t.isSandbox && !deps.allowSandbox) {
    logger.warn({ userId: String(userId), tx: t.storeTransactionId }, "sandbox purchase refused (ALLOW_SANDBOX=false)");
    return { status: "skipped", reason: "sandbox" };
  }

  const product = await findProductByStoreId(t.productId);
  if (!product || (product.kind === "miner" && !product.gh)) {
    logger.error({ userId: String(userId), storeProductId: t.productId }, "purchase for unknown store product");
    return { status: "skipped", reason: "unknown_product" };
  }

  await ensureBalance(userId, now);
  // A purchase can't start in the future (device clock skew on the store side).
  const startAt = Math.min(t.purchasedAt, now);
  const tx = await mongoose.startSession();
  try {
    let result: GrantResult | undefined;
    await tx.withTransaction(async () => {
      const [purchase] = await Purchase.create(
        [
          {
            userId,
            productId: product._id,
            store: t.store,
            storeTransactionId: t.storeTransactionId,
            rcAppUserId: String(userId),
            rcEventId: extra.rcEventId,
            purchasedAt: new Date(t.purchasedAt),
            priceUsd: extra.priceUsd,
            currency: extra.currency,
          },
        ],
        { session: tx },
      );

      if (product.kind === "miner") {
        const [miner] = await Miner.create(
          [
            {
              userId,
              source: "paid",
              gh: product.gh!,
              startAt: new Date(startAt),
              endAt: new Date(startAt + product.durationDays * MS_PER_DAY),
              productId: product._id,
              purchaseId: purchase!._id,
            },
          ],
          { session: tx },
        );
        await backfill(userId, miner!._id, { gh: product.gh!, startAt, endAt: startAt + product.durationDays * MS_PER_DAY }, tx);
        await Purchase.updateOne({ _id: purchase!._id }, { $set: { grantedMinerId: miner!._id } }, { session: tx });
        result = { status: "granted", purchaseId: String(purchase!._id), sku: product.sku, kind: "miner" };
      } else {
        // Extend from whichever is later: now, or the current expiry (buying again adds time).
        const ent = await SuperEntitlement.findOneAndUpdate(
          { userId, productId: product._id },
          [
            {
              $set: {
                userId,
                productId: product._id,
                lastPurchaseId: purchase!._id,
                activeUntil: {
                  $add: [{ $max: [{ $ifNull: ["$activeUntil", new Date(0)] }, new Date(now)] }, product.durationDays * MS_PER_DAY],
                },
              },
            },
          ],
          { upsert: true, returnDocument: "after", session: tx, lean: true, updatePipeline: true },
        );
        await Purchase.updateOne({ _id: purchase!._id }, { $set: { grantedSuperUntil: ent!.activeUntil } }, { session: tx });
        result = {
          status: "granted",
          purchaseId: String(purchase!._id),
          sku: product.sku,
          kind: "super_miner",
          activeUntil: ent!.activeUntil.toISOString(),
        };
      }
    });
    logger.info({ userId: String(userId), tx: t.storeTransactionId, result }, "purchase granted");
    return result!;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const p = await Purchase.findOne({ storeTransactionId: t.storeTransactionId }).select({ _id: 1 }).lean();
      return { status: "already_granted", purchaseId: String(p?._id) };
    }
    throw err;
  } finally {
    await tx.endSession();
  }
}

/**
 * A purchase processed late (e.g. a delayed webhook) can start before the
 * hours the accrual job already closed for this user. Credit that gap now, for
 * this miner only, so the buyer loses nothing. See mining/accrualJob.ts.
 */
async function backfill(
  userId: Types.ObjectId,
  minerId: Types.ObjectId,
  span: { gh: number; startAt: number; endAt: number },
  tx: ClientSession,
) {
  // Always write the balance: this makes a concurrent accrual run conflict with
  // this transaction, so one of them retries and sees the other's result.
  const bal = await Balance.findOneAndUpdate({ userId }, { $inc: { minersRev: 1 } }, { session: tx, returnDocument: "after" }).lean();
  const accruedUntil = bal?.accruedUntil?.getTime() ?? span.startAt;
  if (span.startAt >= accruedUntil) return;

  const schedule = await getRateSchedule();
  const msat = Math.floor(earnedMsat([span], schedule, span.startAt, accruedUntil));
  if (msat <= 0) return;
  await Ledger.create(
    [
      {
        userId,
        type: "mining",
        amountMsat: msat,
        bucket: "available",
        idempotencyKey: `mining-backfill:${minerId}`,
        refType: "miner",
        refId: minerId,
        meta: { from: new Date(span.startAt), to: new Date(accruedUntil) },
      },
    ],
    { session: tx },
  );
  await Balance.updateOne({ userId }, { $inc: { availableMsat: msat, lifetimeMinedMsat: msat } }, { session: tx });
}

/** Grants everything RevenueCat knows about for this user that we haven't granted yet. */
export async function syncUser(userId: Types.ObjectId, deps: StoreDeps, now = Date.now()) {
  const client = requireClient(deps);
  const txs = await client.listOneTimePurchases(String(userId));
  const results: GrantResult[] = [];
  for (const t of txs.sort((a, b) => a.purchasedAt - b.purchasedAt)) {
    results.push(await grantTransaction(userId, t, deps, now));
  }
  return {
    granted: results.filter((r): r is Extract<GrantResult, { status: "granted" }> => r.status === "granted"),
    alreadyGranted: results.filter((r) => r.status === "already_granted").length,
    skipped: results.filter((r) => r.status === "skipped").length,
  };
}

/** App entry point: sync now, and schedule follow-up checks in case RevenueCat lags. */
export async function syncFromApp(userId: Types.ObjectId, deps: StoreDeps, now = Date.now()) {
  // Each call hits RevenueCat's API: a purchase plus a few "Restore" taps is plenty.
  await enforce(`store-sync:${userId}`, 12, 10 * 60_000, "Please wait a few minutes before syncing purchases again.");
  const result = await syncUser(userId, deps, now);
  if (result.granted.length === 0) {
    // Replace, don't add: repeated taps must not queue repeated checks.
    await StoreSync.deleteMany({ userId });
    await StoreSync.insertMany(FOLLOW_UPS_MS.map((ms, i) => ({ userId, dueAt: new Date(now + ms), attempt: i + 1 })));
  }
  return result;
}

/** Worker: runs due follow-up checks. A grant cancels the user's remaining checks. */
export async function runStoreFollowUps(deps: StoreDeps, now = Date.now()) {
  if (!deps.revenueCat) return { processed: 0 };
  const due = await StoreSync.find({ dueAt: { $lte: new Date(now) } }).sort({ dueAt: 1 }).limit(200).lean();
  let processed = 0;
  for (const job of due) {
    const claimed = await StoreSync.deleteOne({ _id: job._id });
    if (claimed.deletedCount !== 1) continue; // another worker took it
    processed++;
    try {
      const r = await syncUser(job.userId, deps, now);
      if (r.granted.length) await StoreSync.deleteMany({ userId: job.userId });
    } catch (err) {
      logger.error({ err, userId: String(job.userId) }, "store follow-up failed");
    }
  }
  return { processed };
}

/**
 * Refund: stop what the purchase granted from now on and flag the account.
 * Sats already credited stay, but the flag holds withdrawals for admin review.
 */
export async function refundTransaction(storeTransactionId: string, now = Date.now(), reason = "refund") {
  const purchase = await Purchase.findOne({ storeTransactionId }).lean();
  if (!purchase) return { status: "not_found" as const };
  if (purchase.status === "refunded") return { status: "already_refunded" as const };
  const product = await Product.findById(purchase.productId).lean();

  const tx = await mongoose.startSession();
  try {
    await tx.withTransaction(async () => {
      const marked = await Purchase.updateOne({ _id: purchase._id, status: "granted" }, { $set: { status: "refunded" } }, { session: tx });
      if (marked.modifiedCount !== 1) return;

      if (purchase.grantedMinerId) {
        await Miner.updateOne(
          { _id: purchase.grantedMinerId, revokedAt: null },
          { $set: { status: "revoked", revokedAt: new Date(now), revokeReason: reason } },
          { session: tx },
        );
      } else if (product?.kind === "super_miner") {
        // Take back this purchase's time, but never end before now.
        await SuperEntitlement.updateOne(
          { userId: purchase.userId, productId: product._id },
          [{ $set: { activeUntil: { $max: [new Date(now), { $subtract: ["$activeUntil", product.durationDays * MS_PER_DAY] }] } } }],
          { session: tx, updatePipeline: true },
        );
      }

      await User.updateOne(
        { _id: purchase.userId },
        { $push: { reviewFlags: { reason, refType: "purchase", refId: purchase._id, createdAt: new Date(now) } } },
        { session: tx },
      );
    });
  } finally {
    await tx.endSession();
  }
  logger.warn({ purchaseId: String(purchase._id), userId: String(purchase.userId) }, "purchase refunded");
  return { status: "refunded" as const, userId: String(purchase.userId) };
}

export async function listProducts() {
  const products = await Product.find({ active: true }).sort({ sortOrder: 1 }).lean();
  return products.map((p) => ({
    sku: p.sku,
    kind: p.kind,
    name: p.name,
    priceDisplayUsd: p.priceDisplayUsd,
    durationDays: p.durationDays,
    ...(p.kind === "miner" ? { gh: p.gh } : { claimGh: p.claimGh, claimsPerDay: p.claimsPerDay, maxGhPerDay: (p.claimGh ?? 0) * (p.claimsPerDay ?? 0) }),
    storeIds: { apple: p.storeIds?.apple, google: p.storeIds?.google },
  }));
}

export async function listPurchases(userId: Types.ObjectId) {
  const rows = await Purchase.find({ userId })
    .sort({ purchasedAt: -1 })
    .limit(200)
    .populate<{ productId: { sku: string; name: string; kind: string } | null }>("productId", { sku: 1, name: 1, kind: 1 })
    .lean();
  return rows.map((p) => ({
    id: String(p._id),
    product: p.productId ? { sku: p.productId.sku, name: p.productId.name, kind: p.productId.kind } : null,
    store: p.store,
    purchasedAt: p.purchasedAt.toISOString(),
    status: p.status,
    superActiveUntil: p.grantedSuperUntil?.toISOString(),
  }));
}

/** Picks our user id out of a RevenueCat event (app_user_id is set with Purchases.logIn(userId)). */
export async function resolveEventUser(ids: (string | undefined | null)[]): Promise<Types.ObjectId | null> {
  for (const id of ids) {
    if (id && /^[0-9a-f]{24}$/i.test(id) && (await User.exists({ _id: id }))) return new Types.ObjectId(id);
  }
  return null;
}
