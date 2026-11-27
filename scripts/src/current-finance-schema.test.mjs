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
const paths = ["lib/db/drizzle/0175_owner_subscription_rule_management.sql",
  "lib/db/drizzle/0176_direct_student_live_preparation.sql", "lib/db/drizzle/0177_direct_student_live_release_reviews.sql",
  "lib/db/drizzle/0178_independent_bro_term_commissions.sql", "lib/db/dev-reconciliation/bro-field-operations.sql",
  "lib/db/drizzle/0181_current_subscription_lifecycle.sql", "lib/db/drizzle/0182_current_bulk_withdrawals_field_sms.sql",
  "lib/db/drizzle/0183_owner_free_academic_terms.sql","lib/db/drizzle/0185_company_bank_remittance_recovery.sql"];
const source = readSourceContract(paths.map(read)), dialect = new PgDialect();
const expression = value => normalize(is(value, SQL) ? dialect.sqlToQuery(value).sql : String(value));
const sorted = array => array.sort((a, b) => a.name.localeCompare(b.name));
const allTables = Object.values(schema).filter(v => { try { return !!getTableConfig(v).name; } catch { return false; } });
const additional = ["subscriptionRuleProposals", "subscriptionPaymentAssistanceRequests",
  "studentDirectLiveEvents", "studentDirectLiveReleaseRequests", "studentDirectLiveReleaseDecisions",
  "studentDirectLiveReviewBindings", "ownerFreeAcademicTerms", "ownerFreeAcademicTermEvents",
  "currentBankCredits","currentBulkAllocationReleases","currentBulkCheckoutAttempts","currentBulkTermClaims"];
const wanted = [...new Set([...Object.values(candidate), schema.studentDirectLiveReviews, schema.studentDirectLiveObligations,
  schema.studentDirectLiveAttempts, schema.broTermCommissionEntitlements, schema.broFieldLeads,
  ...additional.map(name => schema[name]).filter(Boolean)])];
test("direct-payment history, release, rule and free-term models are all registered", () => {
  assert.deepEqual(additional.filter(name => !schema[name]), []);
  assert.equal(wanted.length, 32);
});
for (const table of wanted) {
  const c = getTableConfig(table), expected = source.get(c.name);
  // Remove only this known table's generated identifier qualification. Never
  // normalize literal contents, arbitrary schema prefixes or expression logic.
  const tableExpression = value => expression(is(value, SQL)
    ? sqlUnqualify(dialect.sqlToQuery(value).sql, c.name) : value);
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
    assert.deepEqual(sorted(c.checks.map(x => ({ name: x.name, expression: tableExpression(x.value) }))),
      sorted(expected.checks.map(x => ({ name: x.name, expression: normalize(x.expression) }))));
    assert.deepEqual(sorted(c.foreignKeys.map(x => {
      const r = x.reference();
      assert.equal(allTables.filter(t => getTableName(t) === getTableName(r.foreignTable)).length, 1, "Parent must be a complete active model, never an ID stub");
      return { name: x.getName(), columns: r.columns.map(c => c.name), parent: getTableName(r.foreignTable),
        parentColumns: r.foreignColumns.map(c => c.name), onDelete: x.onDelete, onUpdate: x.onUpdate };
    })), sorted(expected.foreignKeys));
    assert.deepEqual(sorted(c.indexes.map(({ config: x }) => ({ name: x.name, unique: x.unique,
      columns: x.columns.map(col => is(col, SQL)
        ? { expression: tableExpression(col), order: "asc", nulls: "last" }
        : { name: col.name, order: col.indexConfig.order, nulls: col.indexConfig.nulls }),
      where: x.where ? tableExpression(x.where) : null }))),
    sorted(expected.indexes.map(x => ({ ...x, columns: x.columns.map(col => col.expression
      ? { ...col, expression: normalize(col.expression) } : col), where: x.where ? normalize(x.where) : null }))));
  });
}
function sqlUnqualify(value, table) {
  return value.split(/('(?:''|[^'])*')/g).map((part, i) => i % 2 ? part :
    part.replaceAll(`"${table}".`, "").replace(/"([a-z_][a-z_0-9]*)"/g, "$1")).join("");
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
test("0175's nested normalized-credit index is not silently omitted", () => {
  const indexes = source.get("subscription_payment_assistance_requests").indexes;
  assert.equal(indexes.length, 4);
  assert.deepEqual(indexes.find(i => i.name === "subscription_payment_assistance_bank_credit_normalized_uq"), {
    name: "subscription_payment_assistance_bank_credit_normalized_uq", unique: true,
    columns: [{ expression: "lower(btrim(bank_statement_reference))", order: "asc", nulls: "last" }],
    where: "status = 'BANK_VERIFIED'",
  });
});
test("0183's composite tenant keys retain both columns and RESTRICT actions", () => {
  const foreignKeys = source.get("owner_free_academic_terms").foreignKeys.filter(k => k.columns.length === 2);
  assert.equal(foreignKeys.length, 2);
  for (const key of foreignKeys) {
    assert.deepEqual(key.parentColumns, ["id", "school_id"]);
    assert.equal(key.columns[1], "school_id");
    assert.equal(key.onDelete, "restrict");
    assert.equal(key.onUpdate, "no action");
  }
});
test("unsupported expression indexes fail rather than disappear from the contract", () => {
  assert.throws(() => readSourceContract([`CREATE TABLE fixture (id integer);
    CREATE INDEX unsupported ON fixture (arbitrary(id));`]), /Unsupported index expression/);
});
test("metadata qualification handling never rewrites SQL string literals", () => {
  assert.equal(sqlUnqualify(`"fixture"."state" = '"fixture"."state"'`, "fixture"),
    `state = '"fixture"."state"'`);
  assert.equal(sqlUnqualify(`"other"."state" = 'ACTIVE'`, "fixture"), `other.state = 'ACTIVE'`);
});
