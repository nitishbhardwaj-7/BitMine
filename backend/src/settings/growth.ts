/**
 * Growth settings: the perks, bonuses and offers around the core economics.
 * They live in the app config (admin → FAQs & app) and apply as soon as they
 * are saved; unlike the mining rate they never reprice anything in the past.
 */
import { AppConfig } from "../models/index.js";

export interface GrowthSettings {
  /** Owners of an active paid miner start the day with one tap, no videos. */
  paidSkipStartAds: boolean;
  /** Every Nth day started in a row earns the streak bonus (0 = off). */
  streakDays: number;
  /** Bonus hashpower on a streak day, until midnight. */
  streakBonusGh: number;
  /** Boost videos per day (0 = off). Each doubles the current hashpower for a while. */
  boostAdsPerDay: number;
  boostMinutes: number;
  /** The most hashpower one boost can add. */
  boostMaxGh: number;
  /** Game rewards that can be claimed per day (0 = games off), and what each adds until midnight. */
  gameWinsPerDay: number;
  gameGh: number;
  /** New accounts see the starter offer for this many hours (0 = off). */
  offerHours: number;
}

export const DEFAULT_GROWTH: GrowthSettings = {
  paidSkipStartAds: true,
  streakDays: 7,
  streakBonusGh: 55,
  boostAdsPerDay: 3,
  boostMinutes: 60,
  boostMaxGh: 500,
  gameWinsPerDay: 10,
  gameGh: 5.5,
  offerHours: 48,
};

export async function getGrowth(): Promise<GrowthSettings> {
  const cfg = await AppConfig.findById("app").select({ growth: 1 }).lean();
  const g = (cfg?.growth ?? {}) as Partial<Record<keyof GrowthSettings, number | boolean | null>>;
  const n = (k: keyof GrowthSettings) => {
    const v = g[k];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : (DEFAULT_GROWTH[k] as number);
  };
  return {
    paidSkipStartAds: typeof g.paidSkipStartAds === "boolean" ? g.paidSkipStartAds : DEFAULT_GROWTH.paidSkipStartAds,
    streakDays: Math.floor(n("streakDays")),
    streakBonusGh: n("streakBonusGh"),
    boostAdsPerDay: Math.floor(n("boostAdsPerDay")),
    boostMinutes: Math.max(1, Math.floor(n("boostMinutes"))),
    boostMaxGh: n("boostMaxGh"),
    gameWinsPerDay: Math.floor(n("gameWinsPerDay")),
    gameGh: n("gameGh"),
    offerHours: n("offerHours"),
  };
}

export interface PromoView {
  title: string;
  body: string;
  badge: string;
  sku: string;
  endsAt: string;
}

/** The sale banner the app shows, if one is switched on and hasn't ended. */
export function activePromo(cfg: { promo?: { active?: boolean | null; title?: string | null; body?: string | null; badge?: string | null; sku?: string | null; endsAt?: Date | null } | null } | null, now = Date.now()): PromoView | null {
  const p = cfg?.promo;
  if (!p?.active || !p.title || !p.endsAt || p.endsAt.getTime() <= now) return null;
  return { title: p.title, body: p.body ?? "", badge: p.badge ?? "", sku: p.sku ?? "", endsAt: p.endsAt.toISOString() };
}
