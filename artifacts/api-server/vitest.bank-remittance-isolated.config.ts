import {defineConfig} from "vitest/config";
// This guard runs before test collection/imports. No native fixture may start
// merely because somebody supplied a filename to a broader Vitest config.
// @ts-expect-error Review-only JavaScript safety utility deliberately has no declaration emit.
import {requireIsolatedFinanceFixture} from "../../scripts/src/require-isolated-finance-fixture.mjs";
requireIsolatedFinanceFixture();
export default defineConfig({test:{
 include:["src/services/company-bank-remittances.isolated.postgres.test.ts"],
 fileParallelism:false,maxWorkers:1,
}});
