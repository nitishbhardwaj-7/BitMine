/**
 * Test helper: connects each test file to its own database on the shared
 * in-memory replica set started by test/globalSetup.ts (transactions work).
 */
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { inject } from "vitest";

export async function startTestDb(): Promise<void> {
  const dbName = `t_${randomBytes(6).toString("hex")}`;
  await mongoose.connect(inject("mongoUri"), { dbName });
  // Build unique indexes up front; the idempotency guarantees depend on them.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}

export async function stopTestDb(): Promise<void> {
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
}

export async function clearTestDb(): Promise<void> {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}
