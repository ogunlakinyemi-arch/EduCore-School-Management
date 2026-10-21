import { test } from "node:test";
import assert from "node:assert/strict";
import { requiredTenantKeys, verifyRequiredTenantKeys } from "./required-tenant-keys.mjs";

const model = () => ({ tables: requiredTenantKeys.map(k => ({
  id: k.table, keys: [{ name: k.name, kind: k.kind, columns: [...k.columns] }],
})) });
test("retains all four declared composite keys and index/constraint ownership", () => {
  assert.equal(verifyRequiredTenantKeys(model()).length, 4);
});
for (const required of requiredTenantKeys) {
  test(`refuses missing prerequisite ${required.name}`, () => {
    const m = model(); m.tables.find(t => t.id === required.table).keys = [];
    assert.throws(() => verifyRequiredTenantKeys(m), /Missing or changed/);
  });
}
test("refuses wrong columns or an arbitrary current-ownership conversion", () => {
  const m = model(); m.tables[0].keys[0].columns.pop();
  assert.throws(() => verifyRequiredTenantKeys(m), /Missing or changed/);
  const n = model(); n.tables[0].keys[0].kind = "unique_index";
  assert.throws(() => verifyRequiredTenantKeys(n), /Missing or changed/);
});
test("records the three historical index owners without changing current constraint ownership", () => {
  const keys = verifyRequiredTenantKeys(model());
  const historical = keys.filter(key => key.historicalKind);
  assert.equal(historical.length, 3);
  assert.ok(historical.every(key => key.historicalKind === "unique_index" && key.kind === "unique_constraint"));
});
