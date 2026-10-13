import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReviewOnlySchemaCommand } from "../../lib/db/schema-tooling-policy.mjs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

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
test("blocks implicit, unknown and database-reading CLI commands", () => {
  for (const args of [[], ["pull"], ["introspect"], ["up"], ["anything"]])
    assert.throws(() => assertReviewOnlySchemaCommand(args, {}), /disabled/);
});
test("actual offline Drizzle config loads without ever reading DATABASE_URL", () => {
  const loader = createRequire(import.meta.url).resolve("tsx");
  const configUrl = new URL("../../lib/db/drizzle.config.ts", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "-e", `
    process.argv = ['node', 'offline-review', 'generate'];
    process.env = new Proxy(process.env, { get(target, key) {
      if (key === 'DATABASE_URL') throw new Error('Credential access forbidden');
      return Reflect.get(target, key);
    } });
    const {default: config} = await import(${JSON.stringify(configUrl)});
    if ('dbCredentials' in config || config.dialect !== 'postgresql') process.exit(2);
    console.log('offline-config-ok');
  `], { env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "offline-config-ok");
});
