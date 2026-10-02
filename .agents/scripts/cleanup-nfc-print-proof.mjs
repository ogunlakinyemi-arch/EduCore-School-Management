import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const { Client } = createRequire(process.cwd() + "/lib/db/package.json")("pg");
const f = JSON.parse(await readFile("/tmp/nfc-print-fixture.json", "utf8"));
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  const identity = (await db.query("SELECT current_database() AS db,pg_postmaster_start_time()::text AS started")).rows[0];
  if (identity.db !== f.identity.db || identity.started !== f.identity.started) throw Error("Development target changed");
  if (!(await db.query("SELECT 1 FROM schools WHERE id=$1 AND code=$2 FOR UPDATE", [f.schoolId, f.tag])).rowCount) throw Error("Fixture ownership lost");
  for (const [table, ids] of [["students", f.studentIds], ["employees", [f.employeeId]], ["nfc_cards", f.cards.map(c => c.id)], ["platform_devices", [f.deviceId]], ["school_classes", f.classIds]]) {
    const actual = (await db.query(`SELECT id FROM ${table} WHERE school_id=$1 ORDER BY id`, [f.schoolId])).rows.map(r => r.id);
    if (JSON.stringify(actual) !== JSON.stringify([...ids].sort((a, b) => a - b))) throw Error("Unexpected record added to test school; cleanup blocked");
  }
  const baseline = JSON.parse(await readFile("/tmp/nfc-print-original-records.json", "utf8"));
  const checkOriginals = async () => {
    for (const [table, wanted] of Object.entries(baseline)) {
      if (!/^[a-z_]+$/.test(table)) throw Error("Unsafe table");
      const key = table === "schools" ? "id" : "school_id";
      const actual = (await db.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) AS digest FROM ${table} t WHERE ${key} IS DISTINCT FROM $1`, [f.schoolId])).rows[0];
      if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw Error("Original records changed: " + table);
    }
  };
  await checkOriginals();
  const allow = new Set(["audit_logs", "school_classes", "academic_sessions", "academic_terms", "employees", "student_class_assignments", "students", "platform_devices", "nfc_cards", "device_credentials", "attendance_settings", "attendance_events", "attendance_notification_events", "nfc_card_history", "employee_nfc_card_bindings", "device_school_bindings", "employee_nfc_card_history"]);
  const candidates = (await db.query("SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name WHERE c.table_schema='public' AND c.column_name='school_id' AND t.table_type='BASE TABLE'")).rows;
  const owned = new Set();
  for (const { table_name: table } of candidates) {
    if (!/^[a-z_]+$/.test(table)) throw Error("Unsafe table");
    if ((await db.query(`SELECT 1 FROM ${table} WHERE school_id=$1 LIMIT 1`, [f.schoolId])).rowCount) {
      if (!allow.has(table)) throw Error("Unexpected test-school data; cleanup blocked: " + table);
      owned.add(table);
    }
  }
  const edges = (await db.query("SELECT c.relname AS child,p.relname AS parent FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_class p ON p.oid=f.confrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE f.contype='f' AND n.nspname='public'")).rows;
  const order = [], visited = new Set(), visiting = new Set();
  const visit = table => {
    if (visited.has(table)) return;
    if (visiting.has(table)) throw Error("Fixture cleanup dependency cycle");
    visiting.add(table);
    for (const { child, parent } of edges) if (parent === table && child !== table && owned.has(child)) visit(child);
    visiting.delete(table); visited.add(table); order.push(table);
  };
  for (const table of owned) visit(table);
  let rowsRemoved = 0;
  for (const table of order) {
    if (table === "device_school_bindings") {
      // Historical bindings are append-only for real devices. This is the
      // single binding created for our disposable test device. Hold an
      // exclusive table lock, disable only its mutation guard, delete that
      // exact owned fixture, and restore the guard BEFORE committing. All FK
      // checks remain active; rollback also restores the trigger on failure.
      await db.query("LOCK TABLE device_school_bindings IN ACCESS EXCLUSIVE MODE");
      const bindings = (await db.query("SELECT device_id FROM device_school_bindings WHERE school_id=$1", [f.schoolId])).rows;
      if (bindings.length !== 1 || bindings[0].device_id !== f.deviceId) throw Error("Unexpected historical binding; cleanup blocked");
      const triggers = (await db.query("SELECT t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='device_school_bindings'::regclass AND p.proname='prevent_device_school_binding_mutation' AND NOT t.tgisinternal AND (t.tgtype & 8)=8")).rows;
      if (triggers.length !== 1 || triggers[0].tgenabled !== "O" || !/^[a-z_]+$/.test(triggers[0].tgname)) throw Error("Unknown historical guard; cleanup blocked");
      const trigger = triggers[0].tgname;
      await db.query(`ALTER TABLE device_school_bindings DISABLE TRIGGER ${trigger}`);
      rowsRemoved += (await db.query("DELETE FROM device_school_bindings WHERE school_id=$1 AND device_id=$2", [f.schoolId, f.deviceId])).rowCount;
      await db.query(`ALTER TABLE device_school_bindings ENABLE TRIGGER ${trigger}`);
    } else {
      rowsRemoved += (await db.query(`DELETE FROM ${table} WHERE school_id=$1`, [f.schoolId])).rowCount;
    }
  }
  rowsRemoved += (await db.query("DELETE FROM schools WHERE id=$1 AND code=$2", [f.schoolId, f.tag])).rowCount;
  await checkOriginals();
  await db.query("COMMIT");
  console.log({ temporarySchoolRemoved: true, ownedRowsRemoved: rowsRemoved, originalBusinessRecordsUnchanged: true });
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}