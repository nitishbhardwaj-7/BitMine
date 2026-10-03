/**
 * Catalog update for the revenue features (2026-10-03). Safe to re-run.
 *  - adds any catalog products missing from the database (the Starter Pack)
 *  - sets each product's billing from the catalog: paid miners are auto-renewing
 *    monthly subscriptions, Super Miner tiers and the Starter Pack are one-time
 *  - moves store product ids that are still a default to the matching default
 *    (subscriptions are separate products in both stores: "..._monthly")
 *
 *   npm run migrate:revenue
 *   production: docker exec bitmine-api node dist/scripts/apply-revenue-features.js
 */
import { env } from "../config/env.js";
import { connectDb, disconnectDb } from "../db/connect.js";
import { Product } from "../models/index.js";
import { seedAll } from "../db/seed.js";
import { PRODUCT_SEEDS, defaultStoreId } from "../config/economics.js";

await connectDb(env().MONGODB_URI);
await seedAll();

for (const seed of PRODUCT_SEEDS) {
  const billing = seed.billing ?? "one_time";
  const id = defaultStoreId(seed.sku);
  const defaults = [`bitmine_${seed.sku}`, `bitmine_${seed.sku}_monthly`];
  const b = await Product.updateOne({ sku: seed.sku, billing: { $ne: billing } }, { $set: { billing } });
  // Ids an admin typed in by hand are left alone.
  const apple = await Product.updateOne({ sku: seed.sku, "storeIds.apple": { $in: defaults, $ne: id } }, { $set: { "storeIds.apple": id } });
  const google = await Product.updateOne({ sku: seed.sku, "storeIds.google": { $in: defaults, $ne: id } }, { $set: { "storeIds.google": id } });
  const p = await Product.findOne({ sku: seed.sku }).select({ billing: 1, storeIds: 1 }).lean();
  const changed = b.modifiedCount + apple.modifiedCount + google.modifiedCount > 0;
  console.log(`${seed.sku.padEnd(15)} ${String(p?.billing).padEnd(13)} ${p?.storeIds?.google}${changed ? "   (updated)" : ""}`);
}
// Titan was repriced on 2026-10-03; only the old launch price is replaced, never an admin's own edit.
const titan = await Product.updateOne({ sku: "miner_titan", priceDisplayUsd: 49.99 }, { $set: { priceDisplayUsd: 79.99 } });
console.log(`Titan display price: ${titan.modifiedCount ? "49.99 → 79.99" : "unchanged"}`);
await disconnectDb();
