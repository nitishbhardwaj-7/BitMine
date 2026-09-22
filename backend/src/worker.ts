/**
 * Background worker: run as a single process, separate from the API
 * (docs/TECHNICAL_SPEC.md §3). Jobs still to add as their modules are built:
 * none: all jobs are registered below.
 */
import { env } from "./config/env.js";
import { connectDb, disconnectDb } from "./db/connect.js";
import { logger } from "./lib/logger.js";
import { MS_PER_HOUR } from "./lib/time.js";
import { runAccrual } from "./mining/accrualJob.js";
import { runStoreFollowUps } from "./store/service.js";
import { httpRevenueCatClient } from "./store/revenuecat.js";
import { runPayouts } from "./wallet/payoutJob.js";
import { httpSpeedClient } from "./wallet/speed.js";
import { runReferralRewards } from "./referrals/referralJob.js";
import { runOutbox, runReminders } from "./notifications/jobs.js";
import { fcmSender } from "./notifications/push.js";
import { refreshNews } from "./content/news.js";

const config = env();
await connectDb(config.MONGODB_URI);

let stopping = false;
const timers = new Set<NodeJS.Timeout>();

function schedule(fn: () => void, ms: number) {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
}

/** Runs `job` now, then a couple of minutes past every hour. Never overlaps itself. */
function hourly(name: string, job: () => Promise<unknown>, minuteOffsetMs = 2 * 60_000) {
  const loop = async () => {
    try {
      await job();
    } catch (err) {
      logger.error({ err, job: name }, "job failed");
    }
    if (stopping) return;
    const now = Date.now();
    const next = Math.floor(now / MS_PER_HOUR) * MS_PER_HOUR + MS_PER_HOUR + minuteOffsetMs;
    schedule(loop, next - now);
  };
  void loop();
}

/** Runs `job` every `ms`, measured from the end of the previous run. */
function every(name: string, ms: number, job: () => Promise<unknown>) {
  const loop = async () => {
    try {
      await job();
    } catch (err) {
      logger.error({ err, job: name }, "job failed");
    }
    if (!stopping) schedule(loop, ms);
  };
  void loop();
}

// Catches up any missed hours on start, then keeps pace.
hourly("accrual", () => runAccrual());

const store = {
  revenueCat: config.REVENUECAT_SECRET_KEY ? httpRevenueCatClient(config.REVENUECAT_SECRET_KEY) : undefined,
  allowSandbox: config.ALLOW_SANDBOX,
};
every("store-follow-ups", 60_000, () => runStoreFollowUps(store));

const speed = config.SPEED_API_KEY ? httpSpeedClient(config.SPEED_API_KEY, config.SPEED_API_BASE) : undefined;
if (!speed) logger.warn("SPEED_API_KEY not set: payouts are paused");
// Referral rewards settle a UTC day once it's over (checked hourly, idempotent).
hourly("referral-rewards", () => runReferralRewards(), 10 * 60_000);
hourly("reminders", () => runReminders(), 5 * 60_000);

const push =
  config.FIREBASE_PROJECT_ID && config.FIREBASE_CLIENT_EMAIL && config.FIREBASE_PRIVATE_KEY
    ? fcmSender(config.FIREBASE_PROJECT_ID, config.FIREBASE_CLIENT_EMAIL, config.FIREBASE_PRIVATE_KEY)
    : undefined;
if (!push) logger.warn("Firebase service account not set: push notifications are paused (in-app list still works)");
every("push-outbox", 30_000, () => runOutbox(push));

every("news", 30 * 60_000, () => refreshNews());

every("payouts", 60_000, async () => {
  const r = await runPayouts(speed);
  if (r.sent || r.paid || r.failed || r.reconcile || r.paused === "insufficient_funds") logger.info(r, "payout run");
});
logger.info("BitMine worker started");

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down worker");
  stopping = true;
  for (const t of timers) clearTimeout(t);
  await disconnectDb();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
