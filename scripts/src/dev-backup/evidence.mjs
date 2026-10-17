import { createHash } from "node:crypto";
import { hash, quoteId, requireSafe } from "./safety.mjs";

const scope = "left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'";
const ordered = rows => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));

export async function assertSupportedSource(client) {
  const { rows: [r] } = await client.query(`SELECT
    (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass_rls,
    (SELECT count(*)::int FROM pg_extension WHERE extname<>'plpgsql') AS extra_extensions,
    (SELECT count(*)::int FROM pg_foreign_table) AS foreign_tables,
    (SELECT count(*)::int FROM pg_foreign_server) AS foreign_servers,
    (SELECT count(*)::int FROM pg_subscription) AS subscriptions,
    (SELECT count(*)::int FROM pg_publication) AS publications,
    (SELECT count(*)::int FROM pg_event_trigger) AS event_triggers,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE ${scope} AND (c.relpersistence='t' OR c.reltablespace<>0)) AS special_relations,
    (SELECT count(*)::int FROM pg_database WHERE datname=current_database()
      AND dattablespace<>(SELECT oid FROM pg_tablespace WHERE spcname='pg_default')) AS special_database,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_language l ON l.oid=p.prolang WHERE ${scope} AND l.lanname NOT IN ('sql','plpgsql','internal')) AS external_languages`);
  requireSafe(r.bypass_rls === true, "SOURCE_RLS_BYPASS_REQUIRED");
  for (const [name, value] of Object.entries(r)) {
    if (name !== "bypass_rls") requireSafe(value === 0, `UNSUPPORTED_${name.toUpperCase()}`);
  }
}

export async function catalogEvidence(client) {
  const queries = {
    tables: `SELECT n.nspname AS schema,c.relname AS name,c.relkind::text AS kind,
      c.relpersistence::text AS persistence,c.relrowsecurity,c.relforcerowsecurity,
      pg_get_expr(c.relpartbound,c.oid) AS partition_bound
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE ${scope} AND c.relkind IN ('r','p','v','m','S')`,
    constraints: `SELECT n.nspname AS schema,t.relname AS table_name,c.conname AS name,
      c.contype::text AS kind,c.convalidated,c.condeferrable,c.condeferred,
      pg_get_constraintdef(c.oid,true) AS definition,i.relname AS supporting_index
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      LEFT JOIN pg_class t ON t.oid=c.conrelid LEFT JOIN pg_class i ON i.oid=c.conindid WHERE ${scope}`,
    indexes: `SELECT n.nspname AS schema,t.relname AS table_name,i.relname AS name,
      pg_get_indexdef(i.oid) AS definition,x.indisunique,x.indisvalid,x.indisready,
      x.indimmediate,x.indnullsnotdistinct,c.conname AS owning_constraint
      FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid
      JOIN pg_namespace n ON n.oid=i.relnamespace
      LEFT JOIN pg_constraint c ON c.conindid=i.oid AND c.contype IN ('p','u') WHERE ${scope}`,
    triggers: `SELECT n.nspname AS schema,c.relname AS table_name,t.tgname AS name,
      t.tgenabled::text AS enabled,pg_get_triggerdef(t.oid,true) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${scope} AND NOT t.tgisinternal`,
    functions: `SELECT n.nspname AS schema,p.proname AS name,
      pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE ${scope} AND p.prokind IN ('f','p')`,
  };
  const categories = {};
  for (const [name, sql] of Object.entries(queries)) {
    const rows = ordered((await client.query(sql)).rows);
    categories[name] = { count: rows.length, sha256: hash(JSON.stringify(rows)) };
  }
  return categories;
}

async function rowStreamFingerprint(client, sql) {
  const digest = createHash("sha256");
  let count = 0n;
  await client.query(`DECLARE backup_rows NO SCROLL CURSOR FOR
    SELECT digest FROM (${sql}) AS hashed_rows ORDER BY digest COLLATE "C"`);
  try {
    while (true) {
      const { rows } = await client.query("FETCH FORWARD 1000 FROM backup_rows");
      for (const row of rows) { digest.update(row.digest + "\n"); count++; }
      if (!rows.length) break;
    }
  } finally { await client.query("CLOSE backup_rows"); }
  return { rows: count.toString(), sha256: digest.digest("hex") };
}

export async function sequenceEvidence(client) {
  const sequences = (await client.query(`SELECT n.nspname AS schema,c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE ${scope} AND c.relkind='S' ORDER BY n.nspname,c.relname`)).rows;
  const result = [];
  for (const sequence of sequences) {
    const { rows: [state] } = await client.query(`SELECT last_value::text AS last_value,is_called
      FROM ${quoteId(sequence.schema)}.${quoteId(sequence.name)}`);
    result.push({ ...sequence, ...state });
  }
  return { count: result.length, sha256: hash(JSON.stringify(result)) };
}

export async function captureEvidence(client) {
  const catalog = await catalogEvidence(client);
  const tables = (await client.query(`SELECT n.nspname AS schema,c.relname AS name,c.relkind::text AS kind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE ${scope} AND c.relkind IN ('r','p','m') ORDER BY n.nspname,c.relname`)).rows;
  const data = [];
  for (const table of tables) {
    // ONLY avoids counting inherited/partitioned rows twice. SHA-256 row hashes
    // are sorted server-side and streamed; row values never leave PostgreSQL.
    const fingerprint = await rowStreamFingerprint(client, `SELECT
      encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS digest
      FROM ONLY ${quoteId(table.schema)}.${quoteId(table.name)} AS t`);
    data.push({ ...table, ...fingerprint });
  }
  const largeObjects = await rowStreamFingerprint(client, `SELECT
    encode(sha256(convert_to(loid::text||':'||pageno::text||':'||encode(data,'hex'),'UTF8')),'hex') AS digest
    FROM pg_largeobject`);
  const largeObjectMetadata = (await client.query(
    "SELECT oid::text FROM pg_largeobject_metadata ORDER BY oid")).rows;
  return { catalog, data, sequences: await sequenceEvidence(client), largeObjects,
    largeObjectMetadata: { count: largeObjectMetadata.length, sha256: hash(JSON.stringify(largeObjectMetadata)) } };
}

export function compareEvidence(expected, actual) {
  // No forgiving FK rebinding, object deletion, or count-only comparison.
  for (const category of Object.keys(expected.catalog)) {
    requireSafe(JSON.stringify(expected.catalog[category]) === JSON.stringify(actual.catalog[category]),
      `CATALOG_${category.toUpperCase()}_MISMATCH`);
  }
  for (const key of ["data", "sequences", "largeObjects", "largeObjectMetadata"]) {
    requireSafe(JSON.stringify(expected[key]) === JSON.stringify(actual[key]),
      `${key.toUpperCase()}_MISMATCH`);
  }
}

export function normalizeSchemaDump(text) {
  // Restrict tokens are random per pg_dump invocation; server-version headers
  // are metadata. All remaining DDL, comments and ordering compare exactly.
  return text.split("\n").filter(line =>
    !/^\\(?:un)?restrict [A-Za-z0-9]+$/.test(line) &&
    !/^-- Dumped from database version /.test(line)).join("\n");
}
