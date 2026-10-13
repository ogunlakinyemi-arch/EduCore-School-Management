import { defineConfig } from "drizzle-kit";
import path from "path";
import { fileURLToPath } from "node:url";
import { assertReviewOnlySchemaCommand } from "./schema-tooling-policy.mjs";

assertReviewOnlySchemaCommand(process.argv.slice(2), process.env);

// This is an offline review configuration, never an application connection.
// Do not read DATABASE_URL even when it is available in the shell.
export default defineConfig({
  schema: path.join(path.dirname(fileURLToPath(import.meta.url)), "./src/schema/index.ts"),
  dialect: "postgresql",
});
