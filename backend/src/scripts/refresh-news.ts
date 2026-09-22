/** Fetches the news feeds once (the worker does this every 30 minutes). */
import { env } from "../config/env.js";
import { connectDb, disconnectDb } from "../db/connect.js";
import { refreshNews } from "../content/news.js";

await connectDb(env().MONGODB_URI);
const added = await refreshNews();
console.log(`news: ${added} new articles`);
await disconnectDb();
