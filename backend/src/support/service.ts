import { Types } from "mongoose";
import { SupportTicket } from "../models/index.js";
import { AppError, notFound } from "../lib/errors.js";
import { enforce } from "../lib/rateLimit.js";
import { notify } from "../notifications/service.js";

export type TicketCategory = "withdrawal" | "purchase" | "mining" | "account" | "other";

type TicketLean = {
  _id: Types.ObjectId;
  category?: string | null;
  subject: string;
  status?: string | null;
  messages: { from: string; text: string; at: Date }[];
  createdAt?: Date;
  updatedAt?: Date;
};

function view(t: TicketLean) {
  return {
    id: String(t._id),
    category: t.category,
    subject: t.subject,
    status: t.status,
    messages: t.messages.map((m) => ({ from: m.from, text: m.text, at: m.at.toISOString() })),
    createdAt: t.createdAt?.toISOString(),
    updatedAt: t.updatedAt?.toISOString(),
  };
}

export async function createTicket(userId: Types.ObjectId, input: { category: TicketCategory; subject: string; message: string }, now = Date.now()) {
  await enforce(`ticket:${userId}`, 5, 24 * 60 * 60 * 1000, "You've opened several requests today. We'll reply to those first.");
  const t = await SupportTicket.create({
    userId,
    category: input.category,
    subject: input.subject.trim(),
    messages: [{ from: "user", text: input.message.trim(), at: new Date(now) }],
  });
  return view(t.toObject() as TicketLean);
}

export async function listTickets(userId: Types.ObjectId) {
  const rows = await SupportTicket.find({ userId }).sort({ updatedAt: -1 }).limit(50).lean();
  return rows.map((t) => view(t as TicketLean));
}

async function ownTicket(userId: Types.ObjectId, id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound("Request");
  const t = await SupportTicket.findOne({ _id: id, userId }).lean();
  if (!t) throw notFound("Request");
  return t;
}

export async function getTicket(userId: Types.ObjectId, id: string) {
  return view((await ownTicket(userId, id)) as TicketLean);
}

export async function addUserMessage(userId: Types.ObjectId, id: string, text: string, now = Date.now()) {
  const t = await ownTicket(userId, id);
  if (t.status === "closed") throw new AppError(409, "ticket_closed", "This request is closed. Open a new one if you still need help.");
  await enforce(`ticket-msg:${userId}`, 30, 60 * 60 * 1000);
  const updated = await SupportTicket.findOneAndUpdate(
    { _id: t._id },
    { $push: { messages: { from: "user", text: text.trim(), at: new Date(now) } }, $set: { status: "open" } },
    { returnDocument: "after", lean: true },
  );
  return view(updated as TicketLean);
}

/** Admin panel: reply and notify the user. */
export async function adminReply(id: string, text: string, now = Date.now()) {
  const t = await SupportTicket.findOneAndUpdate(
    { _id: id },
    { $push: { messages: { from: "admin", text: text.trim(), at: new Date(now) } }, $set: { status: "answered" } },
    { returnDocument: "after", lean: true },
  );
  if (!t) throw notFound("Request");
  await notify(t.userId, {
    kind: "support_reply",
    title: "Support replied",
    body: `Re: ${t.subject}`,
    dedupeKey: `support:${t._id}:${t.messages.length}`,
    data: { ticketId: String(t._id) },
  });
  return view(t as TicketLean);
}

export async function closeTicket(id: string) {
  await SupportTicket.updateOne({ _id: id }, { $set: { status: "closed" } });
}
