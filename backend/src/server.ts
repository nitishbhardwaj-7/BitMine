import { env } from "./config/env.js";
import { connectDb, disconnectDb } from "./db/connect.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { SsvVerifier, httpKeyFetcher } from "./claims/admobSsv.js";
import { httpRevenueCatClient } from "./store/revenuecat.js";
import { createMailer } from "./auth/mailer.js";
import { socialVerifier } from "./auth/social.js";
import { httpSpeedClient } from "./wallet/speed.js";
import { MarketCache, coinGeckoFetcher } from "./content/market.js";

const config = env();
await connectDb(config.MONGODB_URI);

const { mailer, mode: mailMode } = createMailer(config);
if (mailMode === "brevo" || mailMode === "smtp") {
  logger.info({ mailMode, from: config.MAIL_FROM }, "email delivery configured");
} else if (config.NODE_ENV === "production" && mailMode === "log") {
  logger.warn("MAIL_LOG_ONLY=true: email codes are written to this log, not sent. Configure SMTP before real users sign up.");
} else {
  logger.warn(`No email provider: emails are ${mailMode === "disabled" ? "disabled" : "logged to the console"}`);
}

const app = createApp({
  mailer,
  social: socialVerifier({
    googleClientIds: config.GOOGLE_CLIENT_IDS,
    appleAudiences: config.APPLE_BUNDLE_ID ? [config.APPLE_BUNDLE_ID] : [],
  }),
  corsOrigins: config.CORS_ORIGINS,
  jwtAccessSecret: config.JWT_ACCESS_SECRET,
  ssv: new SsvVerifier(httpKeyFetcher(config.ADMOB_SSV_KEYS_URL)),
  store: {
    revenueCat: config.REVENUECAT_SECRET_KEY ? httpRevenueCatClient(config.REVENUECAT_SECRET_KEY) : undefined,
    allowSandbox: config.ALLOW_SANDBOX,
  },
  revenueCatWebhookAuth: config.REVENUECAT_WEBHOOK_AUTH,
  market: new MarketCache(coinGeckoFetcher()),
  devShortcuts: config.DEV_SHORTCUTS && config.NODE_ENV !== "production",
  trustProxy: config.TRUST_PROXY,
  admin: {
    speed: config.SPEED_API_KEY ? httpSpeedClient(config.SPEED_API_KEY, config.SPEED_API_BASE) : undefined,
    secureCookies: config.NODE_ENV === "production",
  },
});
if (!config.REVENUECAT_SECRET_KEY) logger.warn("REVENUECAT_SECRET_KEY not set: store purchases are disabled");
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "BitMine API listening");
});

let stopping = false;
async function shutdown(signal: string, code = 0) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "shutting down API");
  // Stop accepting connections, let in-flight requests finish (10 s at most), then exit.
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  await Promise.race([closed, new Promise((r) => setTimeout(r, 10_000))]);
  await disconnectDb().catch(() => undefined);
  process.exit(code);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
// A bug that escapes the request handlers must not leave a half-working process: log and restart.
process.on("unhandledRejection", (err) => {
  logger.fatal({ err }, "unhandled promise rejection");
  void shutdown("unhandledRejection", 1);
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  void shutdown("uncaughtException", 1);
});
