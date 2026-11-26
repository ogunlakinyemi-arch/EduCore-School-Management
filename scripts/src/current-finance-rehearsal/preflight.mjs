// Read-only preconditions for the PRIVATE FIXTURE ONLY, not a Production runner.
import assert from "node:assert/strict";
import { requireIdentity } from "./contract.mjs";
import { verifyPackets, captureCatalog, verifyStructure } from "./catalog.mjs";
import { readSourceContract } from "../current-finance-source-contract.mjs";
export async function inspectIdentity(client) {
  return (await client.query(`SELECT inet_server_addr() AS ip,current_database() AS db,current_user AS role,
    session_user AS session_role,current_setting('data_directory') AS data,current_setting('port') AS port,
    current_setting('search_path') AS search_path,current_setting('transaction_read_only') AS read_only,
    current_setting('server_version_num') AS version,pg_is_in_recovery() AS recovery`)).rows[0];
}
export async function assertFresh(client, contract, expected) {
  requireIdentity(await inspectIdentity(client), expected);
  const namespaces = (await client.query(`SELECT has_schema_privilege(current_user,'public','USAGE') AS usage,
    has_schema_privilege(current_user,'public','CREATE') AS create,
    current_schemas(true) AS resolved`)).rows[0];
  assert.equal(namespaces.usage, true); assert.equal(namespaces.create, true);
  assert.deepEqual(namespaces.resolved, ["public", "pg_catalog"], "Reject temporary/unexpected effective schemas");
  await verifyPackets(client, contract, ["student", "free-terms"]);
  const parents = ["schools", "academic_terms", "app_users", "students", "student_direct_live_attempts",
    "student_direct_live_reviews", "bro_term_commission_entitlements", "partner_profiles",
    "school_partner_attributions", "subscription_rule_proposals", "bro_field_leads"];
  const rows = (await client.query(`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,
    EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum) AS keyed
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attname='id' AND NOT a.attisdropped`, [parents])).rows;
  assert.equal(rows.length, parents.length);
  for (const r of rows) {
    assert.equal(r.keyed, true, r.relname + ": valid referenced key");
    assert.equal(r.type, ["student_direct_live_attempts", "student_direct_live_reviews",
      "bro_term_commission_entitlements", "subscription_rule_proposals"].includes(r.relname) ? "bigint" : "integer");
  }
  const collisions = [...contract.tables.keys()];
  for (const table of contract.tables.values()) {
    collisions.push(...table.keys.map(k => k.name), ...table.indexes.map(i => i.name));
    for (const column of table.columns) if (column.type.endsWith("serial")) collisions.push(`${table.name}_${column.name}_seq`);
  }
  const conflicts = (await client.query(`SELECT 'relation' AS kind,n.nspname,c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relname=ANY($1::text[])
    UNION ALL SELECT 'type',n.nspname,t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typname=ANY($1::text[])
    UNION ALL SELECT 'function',n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.proname='guard_current_bulk_scope'`, [collisions])).rows;
  assert.deepEqual(conflicts, [], "Fresh install only: refuse complete, partial, conflicting or preinstalled-function states");
}
export async function assertAfter0181(client, contract) {
  const firstNames = ["current_subscription_operations", "current_subscription_operation_events", "current_subscription_reference_claims"];
  await verifyStructure(client, { tables: readSourceContract([contract.sources[0]]) });
  const cols = await captureCatalog(client, firstNames);
  assert.equal(cols.relations.length, 3);
  const checks = cols.constraints.filter(c => c.table === "current_subscription_operations" && c.type === "c");
  assert.ok(checks.some(c => c.name === "current_subscription_operations_check"));
  assert.ok(!checks.some(c => c.name === "current_subscription_source_ck"));
  assert.ok(!cols.columns.some(c => ["allocation_id", "bulk_entitlement_id"].includes(c.name)));
  const fn = (await client.query("SELECT count(*)::int AS n FROM pg_proc WHERE proname='guard_current_bulk_scope'")).rows[0];
  assert.equal(fn.n, 0, "Do not insert current.functions.sql between structural sources");
  const triggerNames = (await client.query(`SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    AND NOT t.tgisinternal ORDER BY tgname`, [firstNames])).rows.map(r => r.tgname);
  assert.deepEqual(triggerNames, contract.current.triggers.filter(t => firstNames.includes(t.table)).map(t => t.name).sort());
  const subset = (await client.query(contract.files["db/production-activation/current.verify.sql"])).rows.filter(r =>
    r.name === "guard_student_direct_history" || firstNames.includes(r.name) || triggerNames.includes(r.name));
  assert.equal(subset.length, 7); assert.ok(subset.every(r => r.matches));
}
