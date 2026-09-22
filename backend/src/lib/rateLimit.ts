/**
 * Fixed-window rate limiting backed by MongoDB, so limits hold across API
 * restarts and multiple instances. Counters expire on their own (TTL index).
 */
import { RateLimit } from "../models/index.js";
import { AppError } from "./errors.js";

export async function hit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const doc = await RateLimit.findOneAndUpdate(
    { _id: `${key}:${windowStart}` },
    { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(windowStart + windowMs) } },
    { upsert: true, returnDocument: "after", lean: true },
  );
  return (doc?.count ?? 0) <= limit;
}

export async function enforce(key: string, limit: number, windowMs: number, message = "Too many attempts. Please wait a few minutes and try again.") {
  if (!(await hit(key, limit, windowMs))) throw new AppError(429, "rate_limited", message);
}
