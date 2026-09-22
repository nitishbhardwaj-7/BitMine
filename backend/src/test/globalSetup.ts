/**
 * One throwaway MongoDB replica set for the whole test run. Each test file
 * gets its own database on it (see test/mongo.ts), so files still run in
 * parallel without sharing data. Starting one server per file overloaded
 * machines once there were more than ~15 test files.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

export default async function setup(project: TestProject) {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  project.provide("mongoUri", replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}
