import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReviewOnlySchemaCommand } from "../../lib/db/schema-tooling-policy.mjs";

for (const command of ["push", "migrate", "drop", "studio"]) {
  test(`refuses ${command} before reading credentials or connecting`, () => {
    assert.throws(() => assertReviewOnlySchemaCommand([command, "--force"], {
      get DATABASE_URL() { throw new Error("Credentials must not be inspected"); },
    }), /disabled/);
  });
}
test("refuses tooling in Production and deployment contexts", () => {
  for (const env of [{ NODE_ENV: "production" }, { REPLIT_DEPLOYMENT: "1" }])
    assert.throws(() => assertReviewOnlySchemaCommand(["generate"], env), /Production/);
});
test("allows offline review commands without database credentials", () => {
  for (const command of ["generate", "export", "check"])
    assert.doesNotThrow(() => assertReviewOnlySchemaCommand([command], {}));
});
