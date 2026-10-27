import { defineConfig } from "vitest/config";
export default defineConfig({test:{
  environment:"node",include:["src/routes/owner-subscription-rules.postgres.test.ts"],
  fileParallelism:false,testTimeout:20000,hookTimeout:20000,
}});
