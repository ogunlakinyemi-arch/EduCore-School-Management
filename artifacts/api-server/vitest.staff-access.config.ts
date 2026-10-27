import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/services/staff-subscription-access.postgres.test.ts"],
    testTimeout: 10000, hookTimeout: 15000, fileParallelism: false,
  },
});
