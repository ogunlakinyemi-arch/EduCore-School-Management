import { defineConfig } from "drizzle-kit";
import path from "path";
import { assertReviewOnlySchemaCommand } from "./schema-tooling-policy.mjs";

assertReviewOnlySchemaCommand(process.argv.slice(2), process.env);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
