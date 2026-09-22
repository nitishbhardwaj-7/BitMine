/**
 * Test helper: a throwaway single-node MongoDB replica set (transactions work).
 * The first run downloads a MongoDB binary (~100 MB) into the user cache.
 */
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

let replSet: MongoMemoryReplSet | undefined;

export async function startTestDb(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  // Build unique indexes up front; the idempotency guarantees depend on them.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}

export async function stopTestDb(): Promise<void> {
  await mongoose.disconnect();
  await replSet?.stop();
}

export async function clearTestDb(): Promise<void> {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}
