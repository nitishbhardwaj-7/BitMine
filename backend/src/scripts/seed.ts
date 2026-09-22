import { env } from "../config/env.js";
import { connectDb, disconnectDb } from "../db/connect.js";
import { seedAll } from "../db/seed.js";
import { logger } from "../lib/logger.js";

await connectDb(env().MONGODB_URI);
await seedAll();
logger.info("seed complete");
await disconnectDb();
