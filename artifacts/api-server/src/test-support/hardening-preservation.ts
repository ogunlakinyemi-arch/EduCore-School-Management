import { readFile, writeFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const path = new URL("../../.local/test-fixtures/hardening-baseline.json", import.meta.url);
const c = await pool.connect();
try {
  await c.query("BEGIN READ ONLY");
  const identity = (await c.query("SELECT current_database() name,pg_postmaster_start_time() started")).rows[0];
  if (process.env.REPLIT_DEPLOYMENT || identity.name !== "heliumdb" ||
      new Date(identity.started).toISOString() !== "2026-10-04T08:40:42.935Z") throw Error("Unverified Development target");
  const original = JSON.parse(await readFile(new URL("../../.local/test-fixtures/targeted-transport.json",import.meta.url),"utf8"));
  for (const table of ["schools","students","parents","employees","school_memberships","transport_buses","transport_routes","transport_route_stops","transport_student_assignments","transport_history"]) {
    const b = original.before[table];
    const row = (await c.query(`SELECT md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) digest FROM ${table} t WHERE id<=$1`,[b.max])).rows[0];
    if (row.digest !== b.digest) throw Error(`Original ${table} rows changed`);
  }
  if (process.argv.includes("--capture")) {
    const tables = (await c.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='id' AND data_type IN ('integer','bigint','smallint') AND table_name !~ '^(app_users|sessions|notification|platform_notification|communication)' ORDER BY table_name`)).rows;
    const baseline: Record<string,any> = {};
    for (const {table_name:t} of tables) {
      if (!/^[a-z_]+$/.test(t)) throw Error("Invalid catalog identifier");
      const columns = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[t])).rows.map(r=>r.column_name);
      const fields = columns.map((v:string)=>`'${v}',t."${v}"`).join(",");
      const row = (await c.query(`SELECT COALESCE(max(id),0) max,md5(COALESCE(string_agg(md5(jsonb_build_object(${fields})::text),'' ORDER BY id),'')) digest FROM "${t}" t`)).rows[0];
      baseline[t]={...row,columns};
    }
    await writeFile(path,JSON.stringify({identity,baseline},null,2));
    process.stdout.write(JSON.stringify({captured:Object.keys(baseline).length,originalTablesUnchanged:10,readOnly:true})+"\n");
  } else {
    const {baseline}=JSON.parse(await readFile(path,"utf8"));
    const changed:string[]=[];
    for (const [t,b] of Object.entries(baseline) as [string,any][]) {
      const fields=b.columns.map((v:string)=>`'${v}',t."${v}"`).join(",");
      const row=(await c.query(`SELECT md5(COALESCE(string_agg(md5(jsonb_build_object(${fields})::text),'' ORDER BY id),'')) digest FROM "${t}" t WHERE id<=$1`,[b.max])).rows[0];
      if(row.digest!==b.digest) changed.push(t);
    }
    if(changed.length) throw Error(`Historical rows changed: ${changed.join(",")}`);
    process.stdout.write(JSON.stringify({preserved:Object.keys(baseline).length,readOnly:true})+"\n");
  }
} finally { await c.query("ROLLBACK");c.release();await pool.end(); }