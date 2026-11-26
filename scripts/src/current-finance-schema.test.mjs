// Credential-free metadata tests only. No SQL execution, app imports or providers.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { readSourceContract, normalize } from "./current-finance-source-contract.mjs";
import { compilePackage } from "./production-activation-package.mjs";
const deny = () => { throw new Error("Network/database access forbidden in offline schema validation"); };
net.connect = deny; net.createConnection = deny; net.Socket.prototype.connect = deny;
tls.connect = deny; globalThis.fetch = deny; syncBuiltinESMExports();
const require = createRequire(new URL("../../lib/db/package.json", import.meta.url));
const { getTableConfig, PgDialect } = require("drizzle-orm/pg-core");
const { is, SQL, getTableName } = require("drizzle-orm");
const schema = await import("../../lib/db/src/schema/index.ts");
const candidate = await import("../../lib/db/src/candidates/current-finance.ts");
const read = path => fs.readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const paths = ["lib/db/drizzle/0176_direct_student_live_preparation.sql",
  "lib/db/drizzle/0178_independent_bro_term_commissions.sql", "lib/db/dev-reconciliation/bro-field-operations.sql",
  "lib/db/drizzle/0181_current_subscription_lifecycle.sql", "lib/db/drizzle/0182_current_bulk_withdrawals_field_sms.sql"];
const source = readSourceContract(paths.map(read)), dialect = new PgDialect();
const expression = value => normalize(is(value, SQL) ? dialect.sqlToQuery(value).sql : String(value));
const sorted = array => array.sort((a, b) => a.name.localeCompare(b.name));
const allTables = Object.values(schema).filter(v => { try { return !!getTableConfig(v).name; } catch { return false; } });
const wanted = [...new Set([...Object.values(candidate), schema.studentDirectLiveReviews, schema.studentDirectLiveObligations,
  schema.studentDirectLiveAttempts, schema.broTermCommissionEntitlements, schema.broFieldLeads])];
assert.equal(wanted.length, 20);
for (const table of wanted) {
  const c = getTableConfig(table), expected = source.get(c.name);
  test(`${c.name}: exact columns, defaults, keys, CHECKs, FKs and indexes match source`, () => {
    assert.ok(expected);
    const columns = c.columns.map(column => ({
      name: column.name, type: column.getSQLType().replace("timestamp with time zone", "timestamptz"),
      notNull: column.notNull,
      default: column.default === undefined ? null : expression(typeof column.default === "string" ? `'${column.default}'` : column.default),
    }));
    assert.deepEqual(columns, expected.columns.map(column => ({ ...column, default: column.default === null ? null : normalize(column.default) })));
    const keys = [...c.columns.filter(x => x.primary).map(x => ({ name: `${c.name}_pkey`, columns: [x.name], primary: true })),
      ...c.columns.filter(x => x.isUnique).map(x => ({ name: x.uniqueName, columns: [x.name], primary: false })),
      ...c.primaryKeys.map(x => ({ name: x.getName(), columns: x.columns.map(c => c.name), primary: true })),
      ...c.uniqueConstraints.map(x => ({ name: x.getName(), columns: x.columns.map(c => c.name), primary: false }))];
    assert.deepEqual(sorted(keys), sorted(expected.keys));
    assert.deepEqual(sorted(c.checks.map(x => ({ name: x.name, expression: expression(x.value) }))),
      sorted(expected.checks.map(x => ({ name: x.name, expression: normalize(x.expression) }))));
    assert.deepEqual(sorted(c.foreignKeys.map(x => {
      const r = x.reference();
      assert.equal(allTables.filter(t => getTableName(t) === getTableName(r.foreignTable)).length, 1, "Parent must be a complete active model, never an ID stub");
      return { name: x.getName(), columns: r.columns.map(c => c.name), parent: getTableName(r.foreignTable),
        parentColumns: r.foreignColumns.map(c => c.name), onDelete: x.onDelete, onUpdate: x.onUpdate };
    })), sorted(expected.foreignKeys));
    assert.deepEqual(sorted(c.indexes.map(({ config: x }) => ({ name: x.name, unique: x.unique,
      columns: x.columns.map(c => ({ name: c.name, order: c.indexConfig.order })), where: x.where ? expression(x.where) : null }))),
    sorted(expected.indexes.map(x => ({ ...x, where: x.where ? normalize(x.where) : null }))));
  });
}
test("all fifteen final models are active, with no duplicate physical tables", () => {
  assert.equal(Object.keys(candidate).length, 15);
  for (const [name, table] of Object.entries(candidate)) assert.equal(schema[name], table);
  assert.equal(new Set(allTables.map(getTableName)).size, allTables.length);
  assert.equal(getTableConfig(schema.broFieldLeads).columns[0].getSQLType(), "serial");
});
test("schema mutation gates remain disabled", () => {
  const pkg = JSON.parse(read("lib/db/package.json"));
  assert.equal(pkg.scripts.push, "node ./schema-write-disabled.mjs");
  assert.equal(pkg.scripts["push-force"], "node ./schema-write-disabled.mjs");
  assert.doesNotMatch(read("scripts/post-merge.sh"), /^(?!#).*(?:db:push|push-force|drizzle-kit|psql)/m);
});
test("all existing installation and verification packets still match unchanged source", () => {
  const { files } = compilePackage(read);
  for (const [path, content] of Object.entries(files)) assert.equal(read(path), content, path);
});
test("contract comparison preserves case and spaces inside SQL string literals", () => {
  assert.notEqual(normalize("state = 'PAID'"), normalize("state = 'paid'"));
  assert.notEqual(normalize("state = 'Not Interested'"), normalize("state = 'NotInterested'"));
});
