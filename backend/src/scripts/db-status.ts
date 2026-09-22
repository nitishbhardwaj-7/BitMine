/** Prints the economics settings and product catalog in the configured database. */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Product, Settings } from "../models/index.js";

await mongoose.connect(env().MONGODB_URI);
console.log(`database: ${mongoose.connection.name}`);
for (const v of await Settings.find().sort({ version: 1 }).lean()) {
  console.log(`settings v${v.version} from ${v.effectiveAt.toISOString()}:`, v.values);
}
for (const p of await Product.find().sort({ sortOrder: 1 }).lean()) {
  const power = p.kind === "miner" ? `${p.gh} GH/s` : `${p.claimsPerDay} claims × ${p.claimGh} GH/s`;
  console.log(`  ${p.sku.padEnd(12)} ${p.name.padEnd(16)} $${String(p.priceDisplayUsd).padEnd(6)} ${power.padEnd(22)} ${String(p.durationDays).padStart(3)} days  store id: ${p.storeIds?.apple ?? "-"}`);
}
await mongoose.disconnect();
