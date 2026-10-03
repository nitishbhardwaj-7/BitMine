/**
 * Notification jobs:
 *  - runOutbox (every 30 s): pushes pending notifications to the user's devices
 *  - runReminders (hourly): "Start mining" at 10:00 local if today's session
 *    isn't started, and a heads-up 3 days before a paid miner stops
 */
import { Miner, Notification, Product, PushToken, Session, User } from "../models/index.js";
import { logger } from "../lib/logger.js";
import { MS_PER_DAY, localDate } from "../lib/time.js";
import { effectiveTimezone } from "../users/timezone.js";
import { PREF_FOR, notify } from "./service.js";
import type { PushSender } from "./push.js";

const MAX_ATTEMPTS = 5;
/** Don't push stale news: anything older than this is kept in-app only. */
const PUSH_FRESH_MS = 24 * 60 * 60 * 1000;
const REMINDER_LOCAL_HOUR = 10;

export async function runOutbox(sender: PushSender | undefined, now = Date.now()) {
  const stats = { sent: 0, skipped: 0, failed: 0 };
  if (!sender) return { ...stats, paused: true };

  await Notification.updateMany({ push: "pending", createdAt: { $lt: new Date(now - PUSH_FRESH_MS) } }, { $set: { push: "skipped" } });
  const batch = await Notification.find({ push: "pending" }).sort({ createdAt: 1 }).limit(200).lean();

  for (const n of batch) {
    const user = await User.findById(n.userId).select({ status: 1, notificationPrefs: 1 }).lean();
    const pref = PREF_FOR[n.kind];
    const prefs = (user?.notificationPrefs ?? {}) as Record<string, boolean | undefined>;
    if (!user || user.status !== "active" || (pref && prefs[pref] === false)) {
      await Notification.updateOne({ _id: n._id }, { $set: { push: "skipped" } });
      stats.skipped++;
      continue;
    }
    const tokens = await PushToken.find({ userId: n.userId }).lean();
    if (tokens.length === 0) {
      await Notification.updateOne({ _id: n._id }, { $set: { push: "skipped" } });
      stats.skipped++;
      continue;
    }

    let delivered = false;
    let transient = false;
    for (const t of tokens) {
      try {
        const r = await sender.send(t.token, { title: n.title, body: n.body, data: { kind: n.kind, notificationId: String(n._id), ...(n.data ?? {}) } });
        if (r === "ok") delivered = true;
        else await PushToken.deleteOne({ _id: t._id });
      } catch (err) {
        transient = true;
        logger.warn({ err, notificationId: String(n._id) }, "push send failed");
      }
    }

    if (delivered) {
      await Notification.updateOne({ _id: n._id }, { $set: { push: "sent" }, $inc: { attempts: 1 } });
      stats.sent++;
    } else if (transient && n.attempts + 1 < MAX_ATTEMPTS) {
      await Notification.updateOne({ _id: n._id }, { $inc: { attempts: 1 } });
    } else {
      await Notification.updateOne({ _id: n._id }, { $set: { push: transient ? "failed" : "skipped" }, $inc: { attempts: 1 } });
      if (transient) stats.failed++;
      else stats.skipped++;
    }
  }
  return stats;
}

function localHour(now: number, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
}

export async function runReminders(now = Date.now()) {
  let mining = 0;
  let expiry = 0;

  // Only users who can receive pushes are worth checking.
  const userIds = await PushToken.distinct("userId");
  for (let i = 0; i < userIds.length; i += 500) {
    const users = await User.find({ _id: { $in: userIds.slice(i, i + 500) }, status: "active", "notificationPrefs.miningReminder": { $ne: false } })
      .select({ timezone: 1, timezonePending: 1 })
      .lean();
    for (const u of users) {
      const tz = effectiveTimezone(u, now);
      if (localHour(now, tz) !== REMINDER_LOCAL_HOUR) continue;
      const day = localDate(now, tz);
      if (await Session.exists({ userId: u._id, localDate: day })) continue;
      const created = await notify(u._id, {
        kind: "mining_reminder",
        title: "Your miners are ready",
        body: "Tap Start mining to unlock today's claims.",
        dedupeKey: `mining_reminder:${day}`,
      });
      if (created) mining++;
    }
  }

  // Paid miners ending within 3 days: one heads-up per miner.
  const ending = await Miner.find({
    source: "paid",
    revokedAt: null,
    endAt: { $gt: new Date(now), $lte: new Date(now + 3 * MS_PER_DAY) },
  })
    .select({ userId: 1, gh: 1, endAt: 1, productId: 1 })
    .lean();
  for (const m of ending) {
    const product = m.productId ? await Product.findById(m.productId).select({ name: 1 }).lean() : null;
    const days = Math.max(1, Math.ceil((m.endAt.getTime() - now) / MS_PER_DAY));
    const created = await notify(m.userId, {
      kind: "miner_expiry",
      title: `${product?.name ?? "Your miner"} ends soon`,
      body: `Your ${product?.name ?? "miner"} (${m.gh.toLocaleString("en-US")} GH/s) stops mining in ${days} day${days === 1 ? "" : "s"}. Renew it in the Store to keep mining.`,
      dedupeKey: `miner_expiry:${m._id}`,
      data: { minerId: String(m._id) },
    });
    if (created) expiry++;
  }
  return { mining, expiry };
}
