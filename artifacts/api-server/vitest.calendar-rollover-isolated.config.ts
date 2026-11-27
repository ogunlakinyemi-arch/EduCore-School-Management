import {defineConfig} from "vitest/config";
// @ts-expect-error Review-only utility has no declaration emit.
import {requireIsolatedFinanceFixture} from "../../scripts/src/require-isolated-finance-fixture.mjs";
requireIsolatedFinanceFixture();
export default defineConfig({test:{include:["src/services/academic-calendar-rollover.isolated.postgres.test.ts"],
 fileParallelism:false,maxWorkers:1}});
