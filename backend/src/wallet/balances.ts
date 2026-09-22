import type { ClientSession, Types } from "mongoose";
import { Balance } from "../models/index.js";
import { floorHour } from "../lib/time.js";

/**
 * Creates the user's balance if missing. Accrual starts at the current hour:
 * a new account has no miners before now, so there is nothing earlier to credit.
 */
export async function ensureBalance(userId: Types.ObjectId, now = Date.now(), session?: ClientSession) {
  await Balance.updateOne(
    { userId },
    { $setOnInsert: { userId, accruedUntil: new Date(floorHour(now)) } },
    { upsert: true, session },
  );
}
