/**
 * One-off catalog update for the revenue features (2026-10-03). Safe to re-run.
 *  - adds any catalog products missing from the database (the Starter Pack)
 *  - makes the basic Super Miner an auto-renewing monthly subscription, with
 *    its own store product id (subscriptions are separate products in both stores)
 *
 *   npm run migrate:revenue
 *   production: docker exec bitmine-api node dist/scripts/apply-revenue-features.js
 */
import { env } from "../config/env.js";
import { connectDb, disconnectDb } from "../db/connect.js";
import { Product } from "../models/index.js";
import { seedAll } from "../db/seed.js";
import { defaultStoreId } from "../config/economics.js";

await connectDb(env().MONGODB_URI);
await seedAll();

const id = defaultStoreId("super_basic");
const sub = await Product.updateOne({ sku: "super_basic", billing: { $ne: "subscription" } }, { $set: { billing: "subscription" } });
// Only replace store ids that are still the old one-time default.
const apple = await Product.updateOne({ sku: "super_basic", "storeIds.apple": "bitmine_super_basic" }, { $set: { "storeIds.apple": id } });
const google = await Product.updateOne({ sku: "super_basic", "storeIds.google": "bitmine_super_basic" }, { $set: { "storeIds.google": id } });
const bundle = await Product.findOne({ sku: "starter_bundle" }).select({ sku: 1, storeIds: 1 }).lean();

console.log(`Super Miner → subscription: ${sub.modifiedCount ? "updated" : "already set"}; store ids updated: apple ${apple.modifiedCount}, google ${google.modifiedCount} (${id})`);
console.log(`Starter Pack: ${bundle ? `present (${bundle.storeIds?.google})` : "MISSING"}`);
await disconnectDb();
