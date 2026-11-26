// SELECT/EXPLAIN-only post-install comparison; never installs or repairs objects.
import assert from "node:assert/strict";
import { normalize } from "../current-finance-source-contract.mjs";
export const quote = name => `"${name.replaceAll('"', '""')}"`;
const sort = rows => rows.sort((a, b) => a.name.localeCompare(b.name));

export async function captureCatalog(client, names) {
  const columns = (await client.query(`SELECT c.relname AS "table",a.attname AS name,
    format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS "notNull",
    pg_get_expr(d.adbin,d.adrelid) AS "default",a.attidentity AS identity,a.attgenerated AS generated,
    pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname) AS sequence
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum`, [names])).rows;
  const constraints = (await client.query(`SELECT c.relname AS "table",co.conname AS name,co.contype AS type,
    ARRAY(SELECT attname FROM unnest(co.conkey) WITH ORDINALITY x(num,ord)
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=x.num ORDER BY ord) AS columns,
    pc.relname AS parent,pn.nspname AS "parentSchema",
    ARRAY(SELECT attname FROM unnest(co.confkey) WITH ORDINALITY x(num,ord)
      JOIN pg_attribute a ON a.attrelid=pc.oid AND a.attnum=x.num ORDER BY ord) AS "parentColumns",
    co.confdeltype AS "onDelete",co.confupdtype AS "onUpdate",co.confmatchtype AS match,
    co.convalidated AS valid,co.condeferrable AS deferrable,co.condeferred AS deferred,
    pg_get_expr(co.conbin,co.conrelid) AS expression
    FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_class pc ON pc.oid=co.confrelid LEFT JOIN pg_namespace pn ON pn.oid=pc.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,co.conname`, [names])).rows;
  const indexes = (await client.query(`SELECT c.relname AS "table",ix.relname AS name,i.indisunique AS unique,
    i.indisvalid AS valid,i.indisready AS ready,i.indnullsnotdistinct AS "nullsNotDistinct",
    am.amname AS method,i.indnkeyatts=i.indnatts AS "noIncludedColumns",
    pg_get_expr(i.indpred,i.indrelid) AS "where",
    ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY x(num,ord)
      LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=x.num ORDER BY ord) AS columns,
    ARRAY(SELECT opt::int FROM unnest(i.indoption) opt) AS options,
    pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class ix ON ix.oid=i.indexrelid JOIN pg_am am ON am.oid=ix.relam
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    ORDER BY c.relname,ix.relname`, [names])).rows;
  const relations = (await client.query(`SELECT c.relname AS name,c.relkind AS kind,c.relrowsecurity AS rls,
    c.relforcerowsecurity AS "forceRls",pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [names])).rows;
  return { columns, constraints, indexes, relations };
}
async function canonicalExpression(client, table, value, type) {
  // EXPLAIN without ANALYZE: parse/deparse expressions; never evaluate rows/functions.
  const sql = `EXPLAIN (VERBOSE, FORMAT JSON, COSTS false) SELECT (${value})${type ? "::" + type : ""} FROM ONLY public.${quote(table)}`;
  const plan = (await client.query(sql)).rows[0]["QUERY PLAN"][0].Plan;
  assert.ok(plan.Output?.length === 1, "Expected one expression in EXPLAIN");
  return plan.Output[0];
}
export async function verifyStructure(client, contract) {
  const names = [...contract.tables.keys()], actual = await captureCatalog(client, names);
  assert.deepEqual(actual.relations.map(t => t.name).sort(), names.sort(), "All target tables must exist");
  for (const row of actual.relations) {
    assert.equal(row.kind, "r"); assert.equal(row.owner, "neondb_owner");
    assert.equal(row.rls, false); assert.equal(row.forceRls, false);
  }
  for (const [name, expected] of contract.tables) {
    const columns = actual.columns.filter(c => c.table === name);
    assert.equal(columns.length, expected.columns.length, name + ": column count");
    for (let i = 0; i < columns.length; i++) {
      const a = columns[i], e = expected.columns[i];
      assert.equal(a.name, e.name); assert.equal(a.notNull, e.notNull);
      assert.equal(a.identity, ""); assert.equal(a.generated, "");
      const type = e.type === "timestamptz" ? "timestamp with time zone" :
        e.type === "bigserial" ? "bigint" : e.type === "serial" ? "integer" : e.type;
      assert.equal(a.type, type);
      if (e.type.endsWith("serial")) {
        assert.equal(a.sequence, `public.${name}_${e.name}_seq`);
        assert.equal(normalize(a.default), normalize(`nextval('${name}_${e.name}_seq'::regclass)`));
      } else if (e.default === null) assert.equal(a.default, null);
      else assert.equal(await canonicalExpression(client, name, a.default, type),
        await canonicalExpression(client, name, e.default, type), name + "." + e.name + " default");
    }
    const constraints = actual.constraints.filter(c => c.table === name);
    assert.equal(constraints.length, expected.keys.length + expected.checks.length + expected.foreignKeys.length, name + ": constraint count");
    for (const row of constraints) {
      assert.equal(row.valid, true); assert.equal(row.deferrable, false); assert.equal(row.deferred, false);
    }
    assert.deepEqual(sort(constraints.filter(c => ["p", "u"].includes(c.type)).map(c => ({
      name: c.name, columns: c.columns, primary: c.type === "p",
    }))), sort(expected.keys));
    assert.deepEqual(sort(constraints.filter(c => c.type === "f").map(c => {
      assert.equal(c.parentSchema, "public"); assert.equal(c.match, "s");
      const action = v => ({ a: "no action", r: "restrict" })[v] ?? v;
      return { name: c.name, columns: c.columns, parent: c.parent, parentColumns: c.parentColumns,
        onDelete: action(c.onDelete), onUpdate: action(c.onUpdate) };
    })), sort(expected.foreignKeys));
    for (const e of expected.checks) {
      const a = constraints.find(c => c.type === "c" && c.name === e.name); assert.ok(a, e.name);
      assert.equal(await canonicalExpression(client, name, a.expression),
        await canonicalExpression(client, name, e.expression), e.name);
    }
    const indexes = actual.indexes.filter(c => c.table === name);
    const indexSpecs = [...expected.indexes, ...expected.keys.map(k => ({
      name: k.name, unique: true, columns: k.columns.map(name => ({ name, order: "asc", nulls: "last" })), where: null,
    }))];
    assert.equal(indexes.length, indexSpecs.length, name + ": all standalone and constraint-backed indexes");
    for (const e of indexSpecs) {
      const a = indexes.find(c => c.name === e.name); assert.ok(a, e.name);
      assert.equal(a.unique, e.unique); assert.equal(a.valid, true); assert.equal(a.ready, true);
      assert.equal(a.method, "btree"); assert.equal(a.noIncludedColumns, true); assert.equal(a.nullsNotDistinct, false);
      assert.deepEqual(a.columns, e.columns.map(c => c.name));
      assert.deepEqual(a.options, e.columns.map(c => (c.order === "desc" ? 1 : 0) | (c.nulls === "first" ? 2 : 0)));
      if (e.where === null) assert.equal(a.where, null);
      else assert.equal(await canonicalExpression(client, name, a.where), await canonicalExpression(client, name, e.where), e.name);
    }
  }
  // Constraint-owned indexes must also be valid, ready and use default NULL semantics.
  const bad = (await client.query(`SELECT ix.relname FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
    JOIN pg_class ix ON ix.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    AND (NOT i.indisvalid OR NOT i.indisready OR i.indnullsnotdistinct)`, [names])).rows;
  assert.deepEqual(bad, []);
  return actual;
}
export async function verifyPackets(client, contract, groups = ["student", "free-terms", "current"]) {
  for (const group of groups) {
    const rows = (await client.query(contract.files[`db/production-activation/${group}.verify.sql`])).rows;
    assert.ok(rows.length > 0);
    assert.deepEqual(rows.filter(r => !r.matches), [], group + ": procedural verification");
  }
}
