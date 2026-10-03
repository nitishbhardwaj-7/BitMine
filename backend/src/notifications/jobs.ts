/**
 * Notification jobs:
 *  - runOutbox (every 30 s): pushes pending notifications to the user's devices
 *  - runReminders (hourly): "Start mining" at 10:00 local if today's session
 *    isn't started, and renewal reminders 3 days before, 1 day before and
 *    when a paid miner or a Super Miner tier ends
 */
import { Miner, Notification, Product, PushToken, Session, SuperEntitlement, User } from "../models/index.js";
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
      if (await Session.exists({ userId: u._id, localDate: day, $or: [{ activatedAt: { $ne: null } }, { adsRequired: { $in: [0, null] } }] })) continue;
      const created = await notify(u._id, {
        kind: "mining_reminder",
        title: "Your miners are waiting",
        body: "Mining stops at midnight. Start today's mining to keep earning.",
        dedupeKey: `mining_reminder:${day}`,
      });
      if (created) mining++;
    }
  }

  // Renewal reminders. Each stage is sent once (dedupeKey); a tap opens the Store.
  const products = new Map((await Product.find().select({ name: 1, kind: 1, billing: 1 }).lean()).map((p) => [String(p._id), p]));
  const stageOf = (endsAt: number): "3d" | "1d" | "ended" | null => {
    const left = endsAt - now;
    if (left <= 0) return left > -MS_PER_DAY ? "ended" : null;
    if (left <= MS_PER_DAY) return "1d";
    return left <= 3 * MS_PER_DAY ? "3d" : null;
  };
  const when = { "3d": "in 3 days", "1d": "tomorrow" } as const;

  const miners = await Miner.find({
    source: "paid",
    revokedAt: null,
    endAt: { $gt: new Date(now - MS_PER_DAY), $lte: new Date(now + 3 * MS_PER_DAY) },
  })
    .select({ userId: 1, gh: 1, endAt: 1, productId: 1 })
    .lean();
  for (const m of miners) {
    const stage = stageOf(m.endAt.getTime());
    if (!stage) continue;
    const name = products.get(String(m.productId))?.name ?? "Your miner";
    const gh = m.gh.toLocaleString("en-US");
    const created = await notify(m.userId, {
      kind: "miner_expiry",
      title: stage === "ended" ? `${name} has stopped mining` : `${name} stops ${when[stage]}`,
      body:
        stage === "ended"
          ? `Your ${name} (${gh} GH/s) has ended. Renew it in the Store to get your hashpower back.`
          : `Your ${name} (${gh} GH/s) stops mining ${when[stage]}. Renew it now and keep earning without a gap.`,
      // The 3-day key is the one used before the other stages existed.
      dedupeKey: stage === "3d" ? `miner_expiry:${m._id}` : `miner_expiry:${m._id}:${stage}`,
      data: { minerId: String(m._id), go: "store" },
    });
    if (created) expiry++;
  }

  const tiers = await SuperEntitlement.find({ activeUntil: { $gt: new Date(now - MS_PER_DAY), $lte: new Date(now + 3 * MS_PER_DAY) } }).lean();
  for (const e of tiers) {
    const product = products.get(String(e.productId));
    const stage = stageOf(e.activeUntil.getTime());
    if (!stage) continue;
    // A subscription renews itself: only tell the user once it has actually lapsed.
    if (product?.billing === "subscription" && stage !== "ended") continue;
    const name = product?.name ?? "Super Miner";
    const created = await notify(e.userId, {
      kind: "miner_expiry",
      title: stage === "ended" ? `${name} has ended` : `${name} ends ${when[stage]}`,
      body:
        stage === "ended"
          ? `Your extra daily claims are gone. Unlock ${name} again in the Store to get them back.`
          : `Your extra daily claims end ${when[stage]}. Extend ${name} now to keep them.`,
      dedupeKey: `super_expiry:${e._id}:${e.activeUntil.getTime()}:${stage}`,
      data: { go: "store", section: "super" },
    });
    if (created) expiry++;
  }
  return { mining, expiry };
}
