import mongoose from "mongoose";
import { logger } from "../lib/logger.js";

mongoose.set("strictQuery", true);

export async function connectDb(uri: string): Promise<void> {
  await mongoose.connect(uri);
  // The ledger relies on multi-document transactions, which need a replica set
  // (Atlas always is). Refuse to run against a standalone server.
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName) {
    throw new Error("MongoDB must be a replica set: ledger transactions are unavailable on a standalone server.");
  }
  logger.info({ host: mongoose.connection.host, replicaSet: hello.setName }, "MongoDB connected");
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
