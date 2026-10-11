/**
 * Reviewed additive DEVELOPMENT DDL only. An independently obtained database
 * identity fingerprint is mandatory. There is intentionally no Production mode.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { pool } from "@workspace/db";
import { requireSplitDevelopment } from "../../artifacts/api-server/src/lib/flutterwave-split-policy";
requireSplitDevelopment();
const expected = process.argv[2];
assert.match(expected ?? "",/^[a-f0-9]{32}$/,"Supply the independently verified Development database fingerprint");
const db = await pool.connect();
try {
  const identity = (await db.query(
    `SELECT current_database() name,inet_server_addr() address,
     md5(current_database()||COALESCE(inet_server_addr()::text,'LOCAL')||pg_postmaster_start_time()::text) fingerprint`,
  )).rows[0];
  assert.equal(identity.name,"heliumdb"); assert.equal(identity.address,null); assert.equal(identity.fingerprint,expected);
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'flutterwave_split_%'")).rows[0].n,0,
    "Additive initialization requires all five tables to be absent; do not silently rerun");
  const tables = (await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'
     AND (tablename ILIKE '%payment%' OR tablename ILIKE '%allocation%' OR tablename ILIKE '%subscription%'
       OR tablename ILIKE '%commission%' OR tablename ILIKE '%payout%' OR tablename='school_partner_attributions')
     ORDER BY tablename`,
  )).rows.map(r => r.tablename as string);
  async function fingerprints() {
    const result: Record<string,{count:number;fingerprint:string}> = {};
    for (const table of tables) {
      assert.match(table,/^[a-z0-9_]+$/);
      result[table]=(await db.query(
        `SELECT count(*)::int count,md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) fingerprint FROM "${table}" t`,
      )).rows[0];
    }
    return result;
  }
  await db.query("BEGIN");
  await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
  const before = await fingerprints();
  await db.query(await fs.readFile(new URL("../../lib/db/dev-reconciliation/flutterwave-splits.sql",import.meta.url),"utf8"));
  const after = await fingerprints();
  assert.deepEqual(after,before,"Existing financial data changed: initialization will roll back");
  const initialized = (await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'flutterwave_split_%' ORDER BY tablename",
  )).rows.map(r => r.tablename);
  assert.equal(initialized.length,5);
  for (const table of initialized) assert.equal((await db.query(`SELECT count(*)::int n FROM "${table}"`)).rows[0].n,0);
  await db.query("COMMIT");
  const report={scope:"DEVELOPMENT ONLY",createdTables:initialized,oldFinancialDataUnchanged:true,
    excludedFinancialFields:[],preservation:after,historicalBackfills:0,recipientsCreated:0,providerMutations:0};
  await fs.mkdir(new URL("../../reports/flutterwave-splits/",import.meta.url),{recursive:true});
  await fs.writeFile(new URL("../../reports/flutterwave-splits/development-ddl.json",import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify({scope:report.scope,createdTables:5,preservedFinancialTables:tables.length,oldFinancialDataUnchanged:true,excludedFinancialFields:[]}));
} catch(error) { await db.query("ROLLBACK"); throw error; }
finally { db.release(); await pool.end(); }
