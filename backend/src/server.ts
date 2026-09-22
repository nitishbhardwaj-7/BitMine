import { env } from "./config/env.js";
import { connectDb, disconnectDb } from "./db/connect.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { SsvVerifier, httpKeyFetcher } from "./claims/admobSsv.js";
import { httpRevenueCatClient } from "./store/revenuecat.js";

const config = env();
await connectDb(config.MONGODB_URI);

const app = createApp({
  corsOrigins: config.CORS_ORIGINS,
  jwtAccessSecret: config.JWT_ACCESS_SECRET,
  ssv: new SsvVerifier(httpKeyFetcher(config.ADMOB_SSV_KEYS_URL)),
  store: {
    revenueCat: config.REVENUECAT_SECRET_KEY ? httpRevenueCatClient(config.REVENUECAT_SECRET_KEY) : undefined,
    allowSandbox: config.ALLOW_SANDBOX,
  },
  revenueCatWebhookAuth: config.REVENUECAT_WEBHOOK_AUTH,
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
