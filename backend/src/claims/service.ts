/**
 * Ad claims (docs/TECHNICAL_SPEC.md §6.3).
 *
 *   1. App: POST /v1/claims → we check the session, the daily cap and (for
 *      Super claims) the tier entitlement, then create a pending claim.
 *   2. App shows the rewarded ad with SSV customData = claimId, userId = user id.
 *   3. Google calls /webhooks/admob-ssv; after the signature checks out,
 *      verifySsvReward() turns the claim into a miner that runs until local midnight.
 *
 * Nothing is granted on the app's word. The daily cap is enforced twice: at
 * intent (verified + pending) for a clear message, and at verification with an
 * atomic conditional $inc on the session so concurrent callbacks can't exceed it.
 */
import mongoose, { Types } from "mongoose";
import { Claim, GameRound, Miner, Product, Session, SuperEntitlement } from "../models/index.js";
import { GAME_TRACK } from "../games/service.js";
import { AppError, notFound } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { getEconomics } from "../settings/economics.js";
import { claimCount, currentSession, sessionActive } from "../mining/sessions.js";
import { recordStreak } from "../mining/streak.js";
import { BOOST_TRACK, activeBoostUntil, boostGhFor } from "../mining/boost.js";
import { getGrowth } from "../settings/growth.js";
import type { SsvReward } from "./admobSsv.js";

export const CLAIM_TTL_MS = 10 * 60 * 1000;
export const MAX_OPEN_CLAIMS = 3;
const REGULAR_TRACK = "regular";

export type ClaimRequest =
  | { kind: "regular" }
  | { kind: "super"; tier: string }
  | { kind: "start" }
  | { kind: "boost" }
  | { kind: "game"; roundId: string }
  | { kind: "retry" };

interface Track {
  track: string;
  gh: number;
  cap: number;
  tierProductId?: Types.ObjectId;
  roundId?: Types.ObjectId;
}

async function resolveTrack(userId: Types.ObjectId, req: Exclude<ClaimRequest, { kind: "start" } | { kind: "retry" }>, now: number): Promise<Track> {
  if (req.kind === "regular") {
    const s = await getEconomics(new Date(now));
    return { track: REGULAR_TRACK, gh: s.claimGh, cap: s.claimsPerDay };
  }
  if (req.kind === "boost") {
    // A boost video doubles the hashpower running right now (up to a limit) for a while.
    const g = await getGrowth();
    if (g.boostAdsPerDay <= 0) throw notFound("Boost");
    // Watching another video while a boost runs adds more time after it, up to midnight.
    const session = await currentSession(userId, now);
    const runningUntil = await activeBoostUntil(userId, now);
    if (session && runningUntil && runningUntil >= session.endsAt.getTime()) {
      throw new AppError(409, "boost_active", "Your boost already runs until midnight.");
    }
    const gh = await boostGhFor(userId, now, g);
    if (gh <= 0) throw new AppError(409, "nothing_to_boost", "Claim some hashpower first, then boost it.");
    return { track: BOOST_TRACK, gh, cap: g.boostAdsPerDay };
  }
  if (req.kind === "game") {
    // The reward for a game round the app reported as won; one claim per round.
    const g = await getGrowth();
    const session = await currentSession(userId, now);
    const round = Types.ObjectId.isValid(req.roundId) ? await GameRound.findOne({ _id: req.roundId, userId }).lean() : null;
    if (!round || round.status !== "won" || round.localDate !== session?.localDate) {
      throw new AppError(409, "round_not_won", "There's no reward to claim for that round.");
    }
    return { track: GAME_TRACK, gh: g.gameGh, cap: g.gameWinsPerDay, roundId: round._id };
  }
  const product = await Product.findOne({ sku: req.tier, kind: "super_miner", active: true }).lean();
  if (!product || product.claimGh == null || product.claimsPerDay == null) throw notFound("Super Miner tier");
  const owned = await SuperEntitlement.exists({ userId, productId: product._id, activeUntil: { $gt: new Date(now) } });
  if (!owned) throw new AppError(403, "super_not_owned", `Unlock ${product.name} to use these claims.`);
  return { track: String(product._id), gh: product.claimGh, cap: product.claimsPerDay, tierProductId: product._id };
}

function openPendingFilter(userId: Types.ObjectId, now: number) {
  return { userId, status: "pending" as const, expiresAt: { $gt: new Date(now) } };
}

export async function createClaimIntent(userId: Types.ObjectId, req: ClaimRequest, now = Date.now()) {
  const session = await currentSession(userId, now);
  if (!session) throw new AppError(409, "session_not_started", "Tap Start mining first.");

  if (req.kind === "start") {
    // A video that counts towards starting today's mining; it adds no hashpower itself.
    if (sessionActive(session, now)) throw new AppError(409, "already_started", "Mining is already running today.");
    if ((await Claim.countDocuments(openPendingFilter(userId, now))) >= MAX_OPEN_CLAIMS) {
      throw new AppError(429, "too_many_pending", "Finish the video you already opened, then try again.");
    }
    const claim = await Claim.create({ userId, kind: "start", gh: 0, localDate: session.localDate, expiresAt: new Date(now + CLAIM_TTL_MS) });
    return {
      claimId: String(claim._id),
      kind: "start" as const,
      gh: 0,
      expiresAt: claim.expiresAt.toISOString(),
      remainingToday: Math.max(0, (session.adsRequired ?? 0) - (session.adsWatched ?? 0) - 1),
    };
  }
  if (!sessionActive(session, now)) {
    throw new AppError(409, "session_not_started", "Start today's mining first.");
  }

  if (req.kind === "retry") {
    // A video that unlocks the games again after a lost round; it adds no hashpower.
    if (!session.gameLock) throw new AppError(409, "retry_not_needed", "You can play again right away.");
    if ((await Claim.countDocuments(openPendingFilter(userId, now))) >= MAX_OPEN_CLAIMS) {
      throw new AppError(429, "too_many_pending", "Finish the video you already opened, then try again.");
    }
    const claim = await Claim.create({ userId, kind: "retry", gh: 0, localDate: session.localDate, expiresAt: new Date(now + CLAIM_TTL_MS) });
    return { claimId: String(claim._id), kind: "retry" as const, gh: 0, expiresAt: claim.expiresAt.toISOString(), remainingToday: 0 };
  }

  const t = await resolveTrack(userId, req, now);

  const openAll = await Claim.countDocuments(openPendingFilter(userId, now));
  if (openAll >= MAX_OPEN_CLAIMS) {
    throw new AppError(429, "too_many_pending", "Finish the ad you already opened, then try again.");
  }

  const used = claimCount(session, t.track);
  const pendingOnTrack = await Claim.countDocuments({
    ...openPendingFilter(userId, now),
    kind: req.kind,
    ...(t.tierProductId ? { tierProductId: t.tierProductId } : {}),
  });
  if (used + pendingOnTrack >= t.cap) {
    throw new AppError(409, "daily_limit_reached", "You've used all of today's claims. They reset at midnight.", {
      cap: t.cap,
      resetsAt: session.endsAt.toISOString(),
    });
  }

  const claim = await Claim.create({
    userId,
    kind: req.kind,
    tierProductId: t.tierProductId,
    roundId: t.roundId,
    gh: t.gh,
    localDate: session.localDate,
    expiresAt: new Date(now + CLAIM_TTL_MS),
  });

  return {
    claimId: String(claim._id),
    kind: req.kind,
    gh: t.gh,
    expiresAt: claim.expiresAt.toISOString(),
    remainingToday: t.cap - used - pendingOnTrack - 1,
  };
}

export async function getClaim(userId: Types.ObjectId, claimId: string) {
  if (!Types.ObjectId.isValid(claimId)) throw notFound("Claim");
  const c = await Claim.findOne({ _id: claimId, userId }).lean();
  if (!c) throw notFound("Claim");
  return { claimId: String(c._id), kind: c.kind, gh: c.gh, status: c.status, expiresAt: c.expiresAt.toISOString() };
}

/**
 * The app gives up a pending claim (the ad didn't load or was closed early).
 * Only pending claims change; a callback that arrives later finds the claim
 * cancelled and grants nothing. Idempotent.
 */
export async function cancelClaim(userId: Types.ObjectId, claimId: string) {
  if (!Types.ObjectId.isValid(claimId)) throw notFound("Claim");
  const r = await Claim.updateOne({ _id: claimId, userId, status: "pending" }, { $set: { status: "expired" } });
  const c = await Claim.findOne({ _id: claimId, userId }).lean();
  if (!c) throw notFound("Claim");
  return { claimId: String(c._id), status: c.status, cancelled: r.modifiedCount === 1 };
}

export type SsvOutcome =
  | { result: "granted"; minerId: string }
  /** A start video was counted; `active` is true when it was the last one and mining is now on. */
  | { result: "counted"; active: boolean }
  | { result: "duplicate" }
  | { result: "ignored"; reason: string };

class Abort extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

async function markClaim(id: Types.ObjectId, status: "expired" | "rejected") {
  await Claim.updateOne({ _id: id, status: "pending" }, { $set: { status } });
}

/**
 * Handles a signature-verified SSV callback. Idempotent: Google may retry the
 * same callback, and the unique index on admob.transactionId plus the
 * pending→verified transition make repeats harmless.
 */
export async function verifySsvReward(reward: SsvReward, now = Date.now()): Promise<SsvOutcome> {
  if (!reward.customData || !Types.ObjectId.isValid(reward.customData)) return { result: "ignored", reason: "no_claim" };
  if (!reward.transactionId) return { result: "ignored", reason: "no_transaction_id" };

  const claim = await Claim.findById(reward.customData).lean();
  if (!claim) return { result: "ignored", reason: "claim_not_found" };

  if (claim.status === "verified") {
    return claim.admob?.transactionId === reward.transactionId
      ? { result: "duplicate" }
      : { result: "ignored", reason: "claim_already_verified" };
  }
  if (claim.status !== "pending") return { result: "ignored", reason: `claim_${claim.status}` };

  if (reward.userId !== String(claim.userId)) {
    await markClaim(claim._id, "rejected");
    logger.warn({ claimId: String(claim._id), ssvUser: reward.userId }, "SSV user mismatch");
    return { result: "ignored", reason: "user_mismatch" };
  }
  if (now > claim.expiresAt.getTime()) {
    await markClaim(claim._id, "expired");
    return { result: "ignored", reason: "claim_expired" };
  }

  const session = await Session.findOne({ userId: claim.userId, localDate: claim.localDate }).lean();
  if (!session || now >= session.endsAt.getTime()) {
    await markClaim(claim._id, "expired");
    return { result: "ignored", reason: "day_over" };
  }

  if (claim.kind === "start") return verifyStartAd(claim, session._id, reward, now);
  if (claim.kind === "retry") {
    const marked = await Claim.updateOne(
      { _id: claim._id, status: "pending" },
      { $set: { status: "verified", "admob.transactionId": reward.transactionId, "admob.adUnit": reward.adUnit, "admob.rewardItem": reward.rewardItem, "admob.verifiedAt": new Date(now) } },
    ).catch((err: { code?: number }) => {
      if (err.code === 11000) return null; // the same AdMob transaction on another claim: a replay
      throw err;
    });
    if (!marked || marked.modifiedCount !== 1) return { result: "duplicate" };
    await Session.updateOne({ _id: session._id }, { $set: { gameLock: false } });
    return { result: "counted", active: true };
  }

  let cap: number;
  let track: string;
  let startAt = now;
  let endAt = session.endsAt;
  if (claim.kind === "regular") {
    cap = (await getEconomics(new Date(now))).claimsPerDay;
    track = REGULAR_TRACK;
  } else if (claim.kind === "game") {
    cap = (await getGrowth()).gameWinsPerDay;
    track = GAME_TRACK;
  } else if (claim.kind === "boost") {
    const g = await getGrowth();
    cap = g.boostAdsPerDay;
    track = BOOST_TRACK;
    // A boost watched while one is running is added on after it.
    startAt = Math.min(session.endsAt.getTime(), Math.max(now, (await activeBoostUntil(claim.userId, now)) ?? 0));
    endAt = new Date(Math.min(session.endsAt.getTime(), startAt + g.boostMinutes * 60_000));
  } else {
    const product = await Product.findById(claim.tierProductId).lean();
    if (!product?.claimsPerDay) {
      await markClaim(claim._id, "rejected");
      return { result: "ignored", reason: "tier_missing" };
    }
    cap = product.claimsPerDay;
    track = String(product._id);
  }

  const countPath = `claimCounts.${track}`;
  const tx = await mongoose.startSession();
  try {
    let minerId = "";
    await tx.withTransaction(async () => {
      const counted = await Session.updateOne(
        { _id: session._id, $or: [{ [countPath]: { $lt: cap } }, { [countPath]: { $exists: false } }] },
        { $inc: { [countPath]: 1 } },
        { session: tx },
      );
      if (counted.modifiedCount !== 1) throw new Abort("daily_limit");

      const marked = await Claim.updateOne(
        { _id: claim._id, status: "pending" },
        {
          $set: {
            status: "verified",
            "admob.transactionId": reward.transactionId,
            "admob.adUnit": reward.adUnit,
            "admob.rewardItem": reward.rewardItem,
            "admob.verifiedAt": new Date(now),
          },
        },
        { session: tx },
      );
      if (marked.modifiedCount !== 1) throw new Abort("concurrent_verify");

      if (claim.kind === "game") {
        // One reward per won round.
        const taken = await GameRound.updateOne({ _id: claim.roundId, status: "won" }, { $set: { status: "claimed" } }, { session: tx });
        if (taken.modifiedCount !== 1) throw new Abort("round_claimed");
      }

      const [miner] = await Miner.create(
        [
          {
            userId: claim.userId,
            source: claim.kind === "regular" ? "claim" : claim.kind === "boost" ? "boost" : claim.kind === "game" ? "game" : "super_claim",
            gh: claim.gh,
            startAt: new Date(startAt),
            endAt,
            claimId: claim._id,
            productId: claim.tierProductId,
          },
        ],
        { session: tx },
      );
      minerId = String(miner!._id);
    });
    return { result: "granted", minerId };
  } catch (err) {
    if (err instanceof Abort) {
      if (err.reason === "daily_limit" || err.reason === "round_claimed") {
        await markClaim(claim._id, "rejected");
        return { result: "ignored", reason: err.reason };
      }
      return { result: "duplicate" };
    }
    // Same AdMob transaction reused on another claim: a replay.
    if ((err as { code?: number }).code === 11000) return { result: "duplicate" };
    throw err;
  } finally {
    await tx.endSession();
  }
}

/**
 * A verified "start" video: counts towards today's start, and the one that
 * completes the count switches the day's mining on. The conditional $inc keeps
 * the count exact with concurrent callbacks.
 */
async function verifyStartAd(
  claim: { _id: Types.ObjectId; userId: Types.ObjectId },
  sessionId: Types.ObjectId,
  reward: SsvReward,
  now: number,
): Promise<SsvOutcome> {
  const tx = await mongoose.startSession();
  try {
    let active = false;
    await tx.withTransaction(async () => {
      const counted = await Session.updateOne(
        { _id: sessionId, activatedAt: null, $expr: { $lt: ["$adsWatched", "$adsRequired"] } },
        { $inc: { adsWatched: 1 } },
        { session: tx },
      );
      if (counted.modifiedCount !== 1) throw new Abort("already_started");

      const marked = await Claim.updateOne(
        { _id: claim._id, status: "pending" },
        {
          $set: {
            status: "verified",
            "admob.transactionId": reward.transactionId,
            "admob.adUnit": reward.adUnit,
            "admob.rewardItem": reward.rewardItem,
            "admob.verifiedAt": new Date(now),
          },
        },
        { session: tx },
      );
      if (marked.modifiedCount !== 1) throw new Abort("concurrent_verify");

      const started = await Session.updateOne(
        { _id: sessionId, activatedAt: null, $expr: { $gte: ["$adsWatched", "$adsRequired"] } },
        { $set: { activatedAt: new Date(now) } },
        { session: tx },
      );
      active = started.modifiedCount === 1;
    });
    if (active) {
      const s = await Session.findById(sessionId).select({ localDate: 1, endsAt: 1 }).lean();
      if (s) await recordStreak(claim.userId, s, now).catch((err) => logger.error({ err }, "streak update failed"));
    }
    return { result: "counted", active };
  } catch (err) {
    if (err instanceof Abort) {
      if (err.reason === "already_started") {
        await markClaim(claim._id, "rejected");
        return { result: "ignored", reason: "already_started" };
      }
      return { result: "duplicate" };
    }
    if ((err as { code?: number }).code === 11000) return { result: "duplicate" };
    throw err;
  } finally {
    await tx.endSession();
  }
}
