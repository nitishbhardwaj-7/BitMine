import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { AppError } from "./lib/errors.js";
import type { SsvVerifier } from "./claims/admobSsv.js";
import type { StoreDeps } from "./store/service.js";
import type { Mailer } from "./auth/mailer.js";
import type { SocialVerifier } from "./auth/social.js";
import { authRouter } from "./routes/auth.js";
import { publicRouter } from "./routes/public.js";
import { adminRouter, type AdminOptions } from "./admin/router.js";
import { devRouter } from "./routes/dev.js";
import type { MarketCache } from "./content/market.js";
import { v1Router } from "./routes/v1.js";
import { webhooksRouter } from "./routes/webhooks.js";

export interface AppOptions {
  corsOrigins: string[];
  jwtAccessSecret: string;
  ssv: SsvVerifier;
  store: StoreDeps;
  /** Value RevenueCat sends in the Authorization header of webhooks. */
  revenueCatWebhookAuth?: string;
  mailer: Mailer;
  social: SocialVerifier;
  /** Admin panel at /admin (omit to disable). */
  admin?: AdminOptions;
  market?: MarketCache;
  /** Development-only claim/purchase shortcuts (never mounted in production). */
  devShortcuts?: boolean;
  /** Express "trust proxy" setting (see config/env.ts TRUST_PROXY). */
  trustProxy?: string | boolean;
}

export function createApp(opts: AppOptions) {
  const app = express();

  app.disable("x-powered-by");
  // Behind a reverse proxy: trust only that hop for the client IP (rate limits key on it).
  app.set("trust proxy", opts.trustProxy ?? "loopback");

  app.use(helmet());
  // The mobile app sends no Origin header; only the admin site is a browser origin.
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || opts.corsOrigins.includes(origin)) }));
  app.use(express.json({ limit: "100kb" }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/health" } }));
  // Balances and tokens must never be served from a cache.
  app.use(["/v1", "/webhooks"], (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/health", (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ ok: dbUp });
  });

  app.use("/webhooks", webhooksRouter({ ssv: opts.ssv, store: opts.store, revenueCatWebhookAuth: opts.revenueCatWebhookAuth }));
  if (opts.admin) app.use("/admin", adminRouter(opts.admin));
  app.use("/v1/public", publicRouter({ market: opts.market }));
  if (opts.devShortcuts && process.env.NODE_ENV !== "production") {
    app.use("/v1/dev", devRouter({ jwtAccessSecret: opts.jwtAccessSecret }));
  }
  app.use("/v1/auth", authRouter({ mailer: opts.mailer, social: opts.social, jwtAccessSecret: opts.jwtAccessSecret }));
  app.use("/v1", v1Router({ jwtAccessSecret: opts.jwtAccessSecret, store: opts.store, mailer: opts.mailer }));

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found", message: "Not found." });
  });

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof AppError) {
      return void res.status(err.status).json({ error: err.code, message: err.message, ...(err.details ?? {}) });
    }
    if (err instanceof ZodError) {
      return void res.status(400).json({ error: "invalid_request", message: "Some fields are missing or invalid.", issues: err.issues });
    }
    if ((err as { type?: string }).type === "entity.parse.failed") {
      return void res.status(400).json({ error: "invalid_json", message: "The request body isn't valid JSON." });
    }
    req.log.error({ err }, "unhandled error");
    res.status(500).json({ error: "internal_error", message: "Something went wrong. Please try again." });
  };
  app.use(onError);

  return app;
}
