/**
 * Turns on the daily-start rule (2026-10-03): all mining stops at each user's
 * local midnight and earns again only after they start the day by watching
 * rewarded videos. Publishes a new economics version one minute from now, so
 * everything mined before that instant keeps the old rule. Also refreshes the
 * seeded FAQ answers and Academy lessons that describe how mining works.
 * Safe to re-run: it does nothing if the rule is already in force.
 *
 *   npm run migrate:daily-start            # 2 videos to start
 *   npm run migrate:daily-start -- 0       # daily start by a single tap, no videos
 *   production: docker exec bitmine-api node dist/scripts/enable-daily-start.js [videos]
 *
 * Later changes (number of videos, switching the rule off) are made in the
 * admin panel under Economics.
 */
import { env } from "../config/env.js";
import { connectDb, disconnectDb } from "../db/connect.js";
import { Faq, Lesson } from "../models/index.js";
import { getEconomics, publishEconomics } from "../settings/economics.js";
import { FAQ_SEEDS } from "../config/content.js";
import { LESSON_SEEDS } from "../content/academy.js";

const startAds = Math.max(0, Math.floor(Number(process.argv[2] ?? 2)));
if (!Number.isFinite(startAds)) {
  console.error("Usage: npm run migrate:daily-start -- [videos to watch, default 2]");
  process.exit(1);
}

await connectDb(env().MONGODB_URI);

const { version, ...current } = await getEconomics();
if (current.dailyStartRequired) {
  console.log(`Daily start is already on (v${version}, ${current.startAds ?? 0} video(s)). Change it in admin → Economics.`);
} else {
  const effectiveAt = new Date(Date.now() + 60_000);
  const v = await publishEconomics({ ...current, dailyStartRequired: true, startAds }, effectiveAt);
  console.log(`Published economics v${v}: daily start ON, ${startAds} video(s), from ${effectiveAt.toISOString()}`);
}

let faqs = 0;
for (const key of ["how-mining-works", "start-mining", "paid-miners"]) {
  const seed = FAQ_SEEDS.find((f) => f.seedKey === key)!;
  faqs += (await Faq.updateOne({ seedKey: key, answer: { $ne: seed.answer } }, { $set: { answer: seed.answer } })).modifiedCount;
}
let lessons = 0;
for (const slug of ["how-bitmine-works", "claims-and-super-miner"]) {
  const seed = LESSON_SEEDS.find((l) => l.slug === slug)!;
  lessons += (await Lesson.updateOne({ slug, body: { $ne: seed.body } }, { $set: { body: seed.body } })).modifiedCount;
}
console.log(`FAQ answers updated: ${faqs}, lessons updated: ${lessons}`);
await disconnectDb();
