/**
 * Launch economics (docs/ECONOMICS.md). These are the seed values for the
 * versioned `settings` document and the `products` catalog; at runtime the
 * database is the source of truth and admins change values there.
 */

export interface EconomicsSettings {
  /** 0.048 sats per GH/s per day = 48 msat. */
  rateMsatPerGhDay: number;
  claimGh: number;
  claimsPerDay: number;
  minWithdrawalSats: number;
  referralPercent: number;
  referralCapSatsPerDay: number;
  /** 0 = every withdrawal needs admin approval. */
  withdrawalAutoApproveMaxSats: number;
}

export const DEFAULT_ECONOMICS: EconomicsSettings = {
  rateMsatPerGhDay: 48,
  claimGh: 5.5,
  claimsPerDay: 60,
  minWithdrawalSats: 2500,
  referralPercent: 5,
  referralCapSatsPerDay: 5,
  withdrawalAutoApproveMaxSats: 0,
};

export type ProductKind = "miner" | "super_miner";

export interface ProductSeed {
  sku: string;
  kind: ProductKind;
  name: string;
  priceDisplayUsd: number;
  durationDays: number;
  /** miner only */
  gh?: number;
  /** super_miner only */
  claimGh?: number;
  claimsPerDay?: number;
  sortOrder: number;
}

export const PRODUCT_SEEDS: ProductSeed[] = [
  { sku: "miner_mini", kind: "miner", name: "Mini Miner", priceDisplayUsd: 1.99, gh: 65, durationDays: 180, sortOrder: 10 },
  { sku: "miner_spark", kind: "miner", name: "Spark", priceDisplayUsd: 4.99, gh: 170, durationDays: 180, sortOrder: 20 },
  { sku: "miner_core", kind: "miner", name: "Core", priceDisplayUsd: 9.99, gh: 360, durationDays: 180, sortOrder: 30 },
  { sku: "miner_forge", kind: "miner", name: "Forge", priceDisplayUsd: 19.99, gh: 760, durationDays: 180, sortOrder: 40 },
  { sku: "miner_titan", kind: "miner", name: "Titan", priceDisplayUsd: 49.99, gh: 2000, durationDays: 180, sortOrder: 50 },
  { sku: "super_basic", kind: "super_miner", name: "Super Miner", priceDisplayUsd: 4.99, claimGh: 5.5, claimsPerDay: 30, durationDays: 30, sortOrder: 60 },
  { sku: "super_pro", kind: "super_miner", name: "Super Miner Pro", priceDisplayUsd: 49, claimGh: 10, claimsPerDay: 50, durationDays: 365, sortOrder: 70 },
  { sku: "super_max", kind: "super_miner", name: "Super Miner Max", priceDisplayUsd: 99, claimGh: 20, claimsPerDay: 50, durationDays: 365, sortOrder: 80 },
];

/**
 * Store product IDs used when creating the products in App Store Connect and
 * Play Console. The same id works in both stores. Admins can change them later.
 */
export function defaultStoreId(sku: string): string {
  return `bitmine_${sku}`;
}

/**
 * The 15-day guard (docs/ECONOMICS.md): one Titan + every free claim + one
 * Super Miner Max, all claims mining a full day, must not reach the minimum
 * withdrawal in under 15 days. Returns the days that user needs.
 */
export function fastestSinglePackDays(settings: EconomicsSettings, products: ProductSeed[]): number {
  const topMiner = Math.max(0, ...products.filter((p) => p.kind === "miner").map((p) => p.gh ?? 0));
  const topSuper = Math.max(
    0,
    ...products.filter((p) => p.kind === "super_miner").map((p) => (p.claimGh ?? 0) * (p.claimsPerDay ?? 0)),
  );
  const gh = topMiner + settings.claimGh * settings.claimsPerDay + topSuper;
  const msatPerDay = gh * settings.rateMsatPerGhDay;
  return msatPerDay > 0 ? (settings.minWithdrawalSats * 1000) / msatPerDay : Infinity;
}
