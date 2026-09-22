import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/test/globalSetup.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 180_000,
    env: { LOG_LEVEL: "silent", NODE_ENV: "test" },
  },
});
