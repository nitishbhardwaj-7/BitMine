import { env } from "./config/env.js";
import { connectDb, disconnectDb } from "./db/connect.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { SsvVerifier, httpKeyFetcher } from "./claims/admobSsv.js";
import { httpRevenueCatClient } from "./store/revenuecat.js";
import { brevoMailer, devLogMailer, disabledMailer } from "./auth/mailer.js";
import { socialVerifier } from "./auth/social.js";
import { httpSpeedClient } from "./wallet/speed.js";

const config = env();
await connectDb(config.MONGODB_URI);

const mailer =
  config.BREVO_API_KEY && config.MAIL_FROM
    ? brevoMailer(config.BREVO_API_KEY, config.MAIL_FROM)
    : config.NODE_ENV === "production"
      ? disabledMailer()
      : devLogMailer();
if (!config.BREVO_API_KEY) {
  logger.warn(`BREVO_API_KEY not set: emails are ${config.NODE_ENV === "production" ? "disabled" : "logged to the console"}`);
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
  admin: {
    speed: config.SPEED_API_KEY ? httpSpeedClient(config.SPEED_API_KEY, config.SPEED_API_BASE) : undefined,
    secureCookies: config.NODE_ENV === "production",
  },
});
if (!config.REVENUECAT_SECRET_KEY) logger.warn("REVENUECAT_SECRET_KEY not set: store purchases are disabled");
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "BitMine API listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down API");
  server.close();
  await disconnectDb();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
