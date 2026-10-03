import { Router } from "express";
import { AppConfig, Faq } from "../models/index.js";
import { getEconomics } from "../settings/economics.js";
import { activePromo } from "../settings/growth.js";
import { notFound } from "../lib/errors.js";
import type { MarketCache } from "../content/market.js";
import { listNews } from "../content/news.js";
import { getLesson, listLessons } from "../content/academy.js";

/** No sign-in needed: shown before login and on app start. */
export function publicRouter(opts: { market?: MarketCache } = {}) {
  const r = Router();

  r.get("/market", async (_req, res) => {
    if (!opts.market) return void res.status(503).json({ error: "market_unavailable", message: "Prices are unavailable right now." });
    try {
      res.json(await opts.market.get());
    } catch {
      res.status(503).json({ error: "market_unavailable", message: "Prices are unavailable right now." });
    }
  });

  r.get("/news", async (req, res) => {
    res.json({ articles: await listNews(typeof req.query.category === "string" ? req.query.category.toUpperCase() : undefined, Number(req.query.limit) || 30) });
  });

  r.get("/academy", async (_req, res) => {
    res.json({ lessons: await listLessons() });
  });

  r.get("/academy/:slug", async (req, res) => {
    const lesson = await getLesson(String(req.params.slug));
    if (!lesson) throw notFound("Lesson");
    res.json(lesson);
  });

  r.get("/faqs", async (_req, res) => {
    const faqs = await Faq.find({ active: true }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ faqs: faqs.map((f) => ({ id: String(f._id), question: f.question, answer: f.answer })) });
  });

  // App start: version gate, ad units and the headline numbers.
  r.get("/config", async (_req, res) => {
    const [cfg, eco] = await Promise.all([AppConfig.findById("app").lean(), getEconomics()]);
    res.json({
      minVersion: cfg?.minVersion,
      latestVersion: cfg?.latestVersion,
      updateMessage: cfg?.updateMessage,
      storeUrls: cfg?.storeUrls,
      adUnits: cfg?.adUnits,
      admobTestDevices: cfg?.admobTestDevices ?? [],
      supportEmail: cfg?.supportEmail,
      termsUrl: cfg?.termsUrl,
      privacyUrl: cfg?.privacyUrl,
      promo: activePromo(cfg),
      economics: {
        rateMsatPerGhDay: eco.rateMsatPerGhDay,
        claimGh: eco.claimGh,
        claimsPerDay: eco.claimsPerDay,
        minWithdrawalSats: eco.minWithdrawalSats,
        referralPercent: eco.referralPercent,
        referralCapSatsPerDay: eco.referralCapSatsPerDay,
        dailyStartRequired: Boolean(eco.dailyStartRequired),
        startAds: eco.dailyStartRequired ? (eco.startAds ?? 0) : 0,
      },
    });
  });

  return r;
}
