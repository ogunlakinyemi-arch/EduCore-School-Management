import { defineConfig } from "vitest/config";

// Only the credential-free disposable-cluster controller may enable this suite.
// Do not inherit the general setup's fake application DATABASE_URL.
export default defineConfig({
  test: {
    include: ["src/lib/hosted-journal.postgres.test.ts"],
    testTimeout: 10000,
    hookTimeout: 15000,
    fileParallelism: false,
  },
});
