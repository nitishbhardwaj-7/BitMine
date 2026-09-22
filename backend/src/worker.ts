/**
 * Background worker: run as a single process, separate from the API
 * (docs/TECHNICAL_SPEC.md §3). Jobs still to add as their modules are built:
 * referrals (daily), payouts (every minute), purchase reconcile (every 15 min),
 * notifications.
 */
import { env } from "./config/env.js";
import { connectDb, disconnectDb } from "./db/connect.js";
import { logger } from "./lib/logger.js";
import { MS_PER_HOUR } from "./lib/time.js";
import { runAccrual } from "./mining/accrualJob.js";

const config = env();
await connectDb(config.MONGODB_URI);

let stopping = false;
let timer: NodeJS.Timeout | undefined;

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
    timer = setTimeout(loop, next - now);
  };
  void loop();
}

// Catches up any missed hours on start, then keeps pace.
hourly("accrual", () => runAccrual());
logger.info("BitMine worker started");

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down worker");
  stopping = true;
  if (timer) clearTimeout(timer);
  await disconnectDb();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
