/**
 * One-off catalog change (2026-10-03): paid miners last 30 days and are renewed
 * by buying the pack again; Super Miner Max costs $249. Safe to re-run: every
 * step only touches rows that still hold the old value, so later admin edits
 * are never overwritten. Miners already bought keep the length they were sold with.
 *
 *   npm run migrate:monthly
 *   production: docker exec bitmine-api node dist/scripts/migrate-monthly-miners.js
 */
import { env } from "../config/env.js";
import { connectDb, disconnectDb } from "../db/connect.js";
import { Faq, Lesson, Product } from "../models/index.js";
import { FAQ_SEEDS } from "../config/content.js";
import { LESSON_SEEDS } from "../content/academy.js";

await connectDb(env().MONGODB_URI);

const miners = await Product.updateMany({ kind: "miner", durationDays: 180 }, { $set: { durationDays: 30 } });
const max = await Product.updateOne({ sku: "super_max", priceDisplayUsd: 99 }, { $set: { priceDisplayUsd: 249 } });

const faqSeed = FAQ_SEEDS.find((f) => f.seedKey === "paid-miners")!;
const faq = await Faq.updateOne({ seedKey: "paid-miners", answer: /180 days/ }, { $set: { answer: faqSeed.answer } });

let lessons = 0;
for (const seed of LESSON_SEEDS) {
  const r = await Lesson.updateOne({ slug: seed.slug, body: /180 days/ }, { $set: { body: seed.body } });
  lessons += r.modifiedCount;
}

console.log(`paid miner packs set to 30 days: ${miners.modifiedCount}`);
console.log(`Super Miner Max price set to $249: ${max.modifiedCount}`);
console.log(`FAQ updated: ${faq.modifiedCount}, lessons updated: ${lessons}`);
for (const p of await Product.find().sort({ sortOrder: 1 }).lean()) {
  console.log(`  ${p.sku.padEnd(12)} $${String(p.priceDisplayUsd).padEnd(6)} ${String(p.durationDays).padStart(3)} days`);
}
await disconnectDb();
