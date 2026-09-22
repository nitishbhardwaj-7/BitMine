/**
 * Refresh tokens: opaque, random, stored only as a hash, rotated on every use.
 * Presenting an already-used token means it was copied: the whole family
 * (that login's chain of tokens) is revoked and the user must sign in again.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Types } from "mongoose";
import { RefreshToken } from "../models/index.js";
import { AppError } from "../lib/errors.js";

export const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function format(id: Types.ObjectId, secret: string) {
  return `${id}.${secret}`;
}

export async function issueRefreshToken(userId: Types.ObjectId, opts: { familyId?: string; deviceId?: string } = {}, now = Date.now()) {
  const _id = new Types.ObjectId();
  const secret = randomBytes(32).toString("base64url");
  await RefreshToken.create({
    _id,
    userId,
    familyId: opts.familyId ?? randomUUID(),
    tokenHash: sha(secret),
    expiresAt: new Date(now + REFRESH_TTL_MS),
    deviceId: opts.deviceId,
  });
  return { token: format(_id, secret), id: _id };
}

const expired = () => new AppError(401, "session_expired", "Your session has ended. Please sign in again.");

/** Swaps a refresh token for a new one. Returns the user id. */
export async function rotateRefreshToken(token: string, now = Date.now()) {
  const [idStr, secret] = token.split(".");
  if (!idStr || !secret || !Types.ObjectId.isValid(idStr)) throw expired();

  const doc = await RefreshToken.findById(idStr).lean();
  if (!doc) throw expired();
  const match = timingSafeEqual(Buffer.from(sha(secret)), Buffer.from(doc.tokenHash));
  if (!match) throw expired();

  if (doc.revokedAt) {
    // Reuse of a rotated token: someone else has a copy. Kill the whole chain.
    await RefreshToken.updateMany({ familyId: doc.familyId, revokedAt: null }, { $set: { revokedAt: new Date(now) } });
    throw expired();
  }
  if (doc.expiresAt.getTime() <= now) throw expired();

  const next = await issueRefreshToken(doc.userId, { familyId: doc.familyId, deviceId: doc.deviceId ?? undefined }, now);
  const revoked = await RefreshToken.updateOne({ _id: doc._id, revokedAt: null }, { $set: { revokedAt: new Date(now), replacedBy: next.id } });
  if (revoked.modifiedCount !== 1) {
    // Lost a race with another refresh of the same token: treat as reuse.
    await RefreshToken.updateMany({ familyId: doc.familyId, revokedAt: null }, { $set: { revokedAt: new Date(now) } });
    throw expired();
  }
  return { userId: doc.userId, refreshToken: next.token };
}

export async function revokeRefreshToken(token: string, now = Date.now()) {
  const [idStr] = token.split(".");
  if (!idStr || !Types.ObjectId.isValid(idStr)) return;
  const doc = await RefreshToken.findById(idStr).lean();
  if (doc) await RefreshToken.updateMany({ familyId: doc.familyId, revokedAt: null }, { $set: { revokedAt: new Date(now) } });
}

export async function revokeAllForUser(userId: Types.ObjectId, now = Date.now()) {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(now) } });
}
