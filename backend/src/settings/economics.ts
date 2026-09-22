/**
 * Versioned economics settings. The database holds every version; the accrual
 * engine uses the version in force at each instant, so a rate change never
 * reprices mining that already happened.
 */
import { Settings } from "../models/index.js";
import { DEFAULT_ECONOMICS, type EconomicsSettings } from "../config/economics.js";
import type { RatePeriod } from "../mining/accrual.js";

const KEY = "economics";

/** Creates version 1 from the launch defaults if no version exists yet. */
export async function seedEconomics(effectiveAt = new Date(0)): Promise<void> {
  await Settings.updateOne(
    { key: KEY, version: 1 },
    { $setOnInsert: { key: KEY, version: 1, effectiveAt, values: DEFAULT_ECONOMICS } },
    { upsert: true },
  );
}

/** Rate periods for the accrual engine, oldest first. Fails closed if none exist. */
export async function getRateSchedule(): Promise<RatePeriod[]> {
  const versions = await Settings.find({ key: KEY }).sort({ effectiveAt: 1, version: 1 }).lean();
  if (versions.length === 0) {
    throw new Error("No economics settings found: run the seed before accruing.");
  }
  return versions.map((v) => ({ effectiveAt: v.effectiveAt.getTime(), rateMsatPerGhDay: v.values.rateMsatPerGhDay }));
}

/** Settings in force at `at` (default now). */
export async function getEconomics(at = new Date()): Promise<EconomicsSettings & { version: number }> {
  const v = await Settings.findOne({ key: KEY, effectiveAt: { $lte: at } }).sort({ effectiveAt: -1, version: -1 }).lean();
  if (!v) throw new Error("No economics settings in force.");
  return { ...v.values, version: v.version };
}

/**
 * Adds a new version taking effect at `effectiveAt`, which must be in the
 * future (past mining is never repriced).
 */
export async function publishEconomics(
  values: EconomicsSettings,
  effectiveAt: Date,
  createdBy?: string,
  now = new Date(),
): Promise<number> {
  if (effectiveAt.getTime() <= now.getTime()) {
    throw new Error("New economics settings must take effect in the future.");
  }
  const latest = await Settings.findOne({ key: KEY }).sort({ version: -1 }).lean();
  const version = (latest?.version ?? 0) + 1;
  await Settings.create({ key: KEY, version, effectiveAt, values, createdBy });
  return version;
}
