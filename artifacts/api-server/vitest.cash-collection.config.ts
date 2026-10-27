import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/routes/finance-cash.postgres.test.ts"],
    fileParallelism: false, testTimeout: 15000, hookTimeout: 20000 },
});
