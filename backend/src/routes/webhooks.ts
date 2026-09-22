import { Router } from "express";
import type { SsvVerifier } from "../claims/admobSsv.js";
import { verifySsvReward } from "../claims/service.js";

export function webhooksRouter(opts: { ssv: SsvVerifier }) {
  const r = Router();

  // AdMob rewarded SSV callback. Google retries on non-2xx, so every outcome we
  // have *decided* (granted, duplicate, ignored) returns 200; only a bad
  // signature (403) or our own failure (500, via the error handler) does not.
  r.get("/admob-ssv", async (req, res) => {
    const q = req.originalUrl.indexOf("?");
    const rawQuery = q >= 0 ? req.originalUrl.slice(q + 1) : "";
    // AdMob's console sends a bare request to check the URL when it's saved.
    if (!rawQuery) return void res.status(200).send("ok");

    const reward = await opts.ssv.verify(rawQuery);
    if (!reward) {
      req.log.warn("AdMob SSV signature rejected");
      return void res.status(403).send("invalid signature");
    }
    const outcome = await verifySsvReward(reward);
    req.log.info({ outcome, claimId: reward.customData }, "AdMob SSV processed");
    res.status(200).send("ok");
  });

  return r;
}
