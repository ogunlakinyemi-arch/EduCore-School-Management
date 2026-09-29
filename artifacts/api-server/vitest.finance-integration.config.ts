import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/routes/finance-postgres.integration.test.ts"],
  },
});