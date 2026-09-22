import { Router } from "express";
import { AppConfig, Faq } from "../models/index.js";
import { getEconomics } from "../settings/economics.js";

/** No sign-in needed: shown before login and on app start. */
export function publicRouter() {
  const r = Router();

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
      supportEmail: cfg?.supportEmail,
      termsUrl: cfg?.termsUrl,
      privacyUrl: cfg?.privacyUrl,
      economics: {
        claimGh: eco.claimGh,
        claimsPerDay: eco.claimsPerDay,
        minWithdrawalSats: eco.minWithdrawalSats,
        referralPercent: eco.referralPercent,
        referralCapSatsPerDay: eco.referralCapSatsPerDay,
      },
    });
  });

  return r;
}
