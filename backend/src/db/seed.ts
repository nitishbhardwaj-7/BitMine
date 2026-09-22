/**
 * Idempotent seed: economics settings v1 and the product catalog.
 * Existing products keep any admin edits; only missing SKUs are inserted.
 * CLI: npm run seed (src/scripts/seed.ts)
 */
import { Product } from "../models/index.js";
import { PRODUCT_SEEDS } from "../config/economics.js";
import { seedEconomics } from "../settings/economics.js";

export async function seedAll(): Promise<void> {
  await seedEconomics();
  for (const p of PRODUCT_SEEDS) {
    await Product.updateOne({ sku: p.sku }, { $setOnInsert: p }, { upsert: true });
  }
}
