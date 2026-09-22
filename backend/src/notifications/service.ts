/**
 * Notifications are written to an outbox (the `notifications` collection),
 * which is also the in-app notification list. Writing happens inside the same
 * transaction as the event (e.g. a withdrawal being paid), so a notification
 * exists if and only if the event happened. The outbox job pushes them.
 */
import { Types, type ClientSession } from "mongoose";
import { Notification, PushToken, User } from "../models/index.js";

export type NotificationKind =
  | "mining_reminder"
  | "miner_expiry"
  | "withdrawal_paid"
  | "withdrawal_failed"
  | "withdrawal_rejected"
  | "support_reply"
  | "announcement";

export type PrefKey = "miningReminder" | "minerExpiry" | "withdrawals" | "support";

/** Which preference switch controls each kind (announcements can't be switched off here). */
export const PREF_FOR: Record<NotificationKind, PrefKey | null> = {
  mining_reminder: "miningReminder",
  miner_expiry: "minerExpiry",
  withdrawal_paid: "withdrawals",
  withdrawal_failed: "withdrawals",
  withdrawal_rejected: "withdrawals",
  support_reply: "support",
  announcement: null,
};

export interface NewNotification {
  kind: NotificationKind;
  title: string;
  body: string;
  dedupeKey: string;
  data?: Record<string, string>;
}

/** Records a notification once per dedupeKey. Returns false if it already existed. */
export async function notify(userId: Types.ObjectId, n: NewNotification, session?: ClientSession): Promise<boolean> {
  try {
    await Notification.create([{ userId, ...n }], session ? { session } : {});
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

export async function listNotifications(userId: Types.ObjectId, before?: string) {
  const filter: Record<string, unknown> = { userId };
  if (before && Types.ObjectId.isValid(before)) filter._id = { $lt: new Types.ObjectId(before) };
  const rows = await Notification.find(filter).sort({ _id: -1 }).limit(31).lean();
  const page = rows.slice(0, 30);
  return {
    notifications: page.map((n) => ({
      id: String(n._id),
      kind: n.kind,
      title: n.title,
      body: n.body,
      data: n.data ?? {},
      read: Boolean(n.readAt),
      createdAt: n.createdAt?.toISOString(),
    })),
    unread: await Notification.countDocuments({ userId, readAt: null }),
    nextCursor: rows.length > 30 ? String(page[page.length - 1]!._id) : null,
  };
}

export async function markRead(userId: Types.ObjectId, ids: string[] | "all", now = Date.now()) {
  const filter: Record<string, unknown> = { userId, readAt: null };
  if (ids !== "all") filter._id = { $in: ids.filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i)) };
  const r = await Notification.updateMany(filter, { $set: { readAt: new Date(now) } });
  return { marked: r.modifiedCount };
}

/** A device token belongs to whoever registered it last (phones change hands, users switch accounts). */
export async function registerPushToken(userId: Types.ObjectId, token: string, platform: "android" | "ios") {
  await PushToken.updateOne({ token }, { $set: { userId, platform } }, { upsert: true });
  return { ok: true };
}

export async function removePushToken(userId: Types.ObjectId, token: string) {
  await PushToken.deleteOne({ token, userId });
  return { ok: true };
}

export async function updateNotificationPrefs(userId: Types.ObjectId, prefs: Partial<Record<PrefKey, boolean>>) {
  const set = Object.fromEntries(Object.entries(prefs).map(([k, v]) => [`notificationPrefs.${k}`, v]));
  await User.updateOne({ _id: userId }, { $set: set });
  const u = await User.findById(userId).select({ notificationPrefs: 1 }).lean();
  return { notificationPrefs: u?.notificationPrefs };
}
