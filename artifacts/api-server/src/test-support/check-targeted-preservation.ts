import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { printableCardSnapshotSql } from "../lib/nfc-printable-snapshot";

const f = JSON.parse(await readFile(new URL("../../.local/test-fixtures/targeted-transport.json", import.meta.url), "utf8"));
const c = await pool.connect();
try {
  await c.query("BEGIN READ ONLY");
  const identity = (await c.query("SELECT current_database() AS name,pg_postmaster_start_time() AS started")).rows[0];
  if (identity.name !== "heliumdb" || new Date(identity.started).toISOString() !== "2026-10-04T02:29:28.053Z") {
    throw new Error("Not the verified Development target");
  }
  const tables = ["schools", "students", "parents", "employees", "school_memberships",
    "transport_buses", "transport_routes", "transport_route_stops", "transport_student_assignments", "transport_history"];
  const changed: string[] = [];
  for (const table of tables) {
    const baseline = f.before[table];
    const actual = (await c.query(
      `SELECT md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) AS digest
       FROM ${table} t WHERE id<=$1`, [baseline.max],
    )).rows[0];
    if (actual.digest !== baseline.digest) changed.push(table);
  }
  if (changed.length) throw new Error(`Pre-existing rows changed in: ${changed.join(", ")}`);
  const planned = await c.query(`EXPLAIN (FORMAT JSON) ${printableCardSnapshotSql}`, [f.cardId, f.schoolId]);
  if (!planned.rows[0]?.["QUERY PLAN"]) throw new Error("No printable snapshot query plan");
  console.log(JSON.stringify({ originalTablesUnchanged: tables.length, printableSnapshotPostgresPlan: "PASS", readOnly: true }));
} finally { await c.query("ROLLBACK"); c.release(); await pool.end(); }