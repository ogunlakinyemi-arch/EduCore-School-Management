import { pool } from "@workspace/db";
import { readFile, writeFile } from "node:fs/promises";
import { lessonTeachingScope } from "../../artifacts/api-server/src/services/lesson-teaching-scope";

const path = "/tmp/lesson-parent-preservation.json";
if (process.env.REPLIT_DEPLOYMENT || !process.env.REPLIT_DEV_DOMAIN) throw Error("Development only");
const identity = (await pool.query("SELECT current_database() AS db,inet_server_addr()::text AS address")).rows[0];
if (identity.db !== "heliumdb" || identity.address !== null) throw Error("Unverified Development database");
const mode = process.argv[2];
try {
  if (mode === "capture") {
    const tables = (await pool.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`)).rows;
    const baseline: Record<string, unknown[]> = {};
    for (const { table_name } of tables) {
      if (!/^[a-z_]+$/.test(table_name)) throw Error("Unsafe table");
      baseline[table_name] = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${table_name}" t`)).rows.map(r => r.row);
    }
    await writeFile(path, JSON.stringify(baseline), { mode: 0o600 });
    console.log(JSON.stringify({ capturedTables: tables.length }));
  } else if (mode === "seed") {
    await pool.query("BEGIN");
    const permitted = await pool.query(`SELECT c.name,s.code FROM teacher_class_assignments a
      JOIN employees e ON e.id=a.employee_id AND e.school_id=a.school_id
      JOIN school_classes c ON c.id=a.school_class_id AND c.school_id=a.school_id
      JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
      WHERE e.user_id=912 AND e.id=183 AND a.school_id=1393 AND a.school_class_id=538
        AND a.subject_id=6 AND a.section='A' AND a.academic_session_id=358 AND a.status='ACTIVE'`);
    if (!permitted.rows.length) throw Error("Existing authorized assignment no longer matches");
    if ((await pool.query(`SELECT id FROM school_curriculum_assignments WHERE school_id=1393
      AND school_class_id=538 AND subject_id=6 AND academic_session_id=358 AND academic_term_id=20`)).rows.length)
      throw Error("Refusing to overwrite existing curriculum mapping");
    const { name, code } = permitted.rows[0];
    const version = (await pool.query(`INSERT INTO curriculum_versions
      (title,education_level,class_levels,subject_codes,source_kind,source_organization,source_reference,
       status,description,created_by,published_at)
      VALUES('Development test curriculum — lesson-note acceptance','OTHER',$1::jsonb,$2::jsonb,'SCHOOL_SPECIFIC',
       'Development acceptance tests','Development only; not official curriculum','PUBLISHED',
       'User-authorized minimal Development test data. Retained to preserve lesson-note acceptance evidence.',309,now())
      RETURNING id`, [JSON.stringify([name]), JSON.stringify([code])])).rows[0];
    const mapping = (await pool.query(`INSERT INTO school_curriculum_assignments
      (school_id,curriculum_version_id,school_class_id,subject_id,academic_session_id,academic_term_id,confirmed_by)
      VALUES(1393,$1,538,6,358,20,911) RETURNING id`, [version.id])).rows[0];
    const topic = (await pool.query(`INSERT INTO curriculum_topics
      (school_id,mapping_id,class_level,subject_code,title,source_kind)
      VALUES(1393,$1,$2,$3,'Development test topic — lesson-note PDF acceptance','SCHOOL_SPECIFIC') RETURNING id`,
      [mapping.id, name, code])).rows[0];
    await pool.query("COMMIT");
    console.log(JSON.stringify({ developmentOnly: true, versionId: version.id, mappingId: mapping.id, topicId: topic.id }));
  } else if (mode === "communication-scope") {
    const {currentTeacherAssignmentSql}=await import("../../artifacts/api-server/src/routes/parent-communication");
    // Read-only CTE fixtures exercise multi-class, wildcard, stale, foreign-school
    // and inactive cases without creating students or changing live relationships.
    const rows=(await pool.query(`WITH
      students(id,school_id,status) AS (VALUES(721,1393,'active'),(740,1393,'active'),(741,1393,'active'),
        (742,1393,'inactive'),(743,1400,'active'),(744,1393,'active'),(745,1393,'active'),(746,1393,'active')),
      student_class_assignments(student_id,school_id,school_class_id,section,academic_session_id,status,is_current) AS
        (VALUES(721,1393,538,'A',358,'ACTIVE',true),(740,1393,571,'Science',358,'ACTIVE',true),
          (741,1393,538,'B',358,'ACTIVE',true),(742,1393,538,'A',358,'ACTIVE',true),
          (743,1400,538,'A',358,'ACTIVE',true),(744,1393,538,'A',359,'ACTIVE',true),
          (745,1393,538,'A',358,'ACTIVE',false),(745,1393,572,'Science',358,'ACTIVE',true),
          (746,1393,573,'Commercial',358,'ACTIVE',true)),
      academic_sessions(id,school_id,is_current,start_date,end_date) AS
        (VALUES(358,1393,true,date '2026-09-01',date '2027-07-31'),(359,1393,false,date '2025-09-01',date '2026-07-31')),
      employees(id,school_id,user_id,employment_status,employee_type) AS (VALUES(183,1393,912,'ACTIVE','TEACHER')),
      teacher_class_assignments(school_id,school_class_id,section,academic_session_id,status,employee_id,start_date,end_date) AS
        (VALUES(1393,538,'A',358,'ACTIVE',183,date '2026-09-01',NULL::date),
          (1393,571,'Science',358,'ACTIVE',183,date '2026-09-01',NULL::date),
          (1393,573,'',358,'ACTIVE',183,date '2026-09-01',NULL::date))
      SELECT st.id FROM students st WHERE st.school_id=$1 AND ${currentTeacherAssignmentSql("st.id","st.school_id","$2")}
      ORDER BY st.id`,[1393,912])).rows.map(r=>r.id);
    if(JSON.stringify(rows)!==JSON.stringify([721,740,746]))throw Error("Native communication-scope regression");
    console.log(JSON.stringify({nativeCommunicationScope:"PASS",readOnlySyntheticCases:true,allowedIds:rows,
      deniedCases:["wrong section","inactive student","foreign school","wrong session","historical enrollment"]}));
  } else if (mode === "scope") {
    const scope=lessonTeachingScope(["$1","$3","$4","c.id","s.id","e.id","COALESCE(c.section,'')"]);
    const contexts=(await pool.query(`SELECT DISTINCT c.id AS "classId",c.section,s.id AS "subjectId"
      FROM employees e JOIN school_classes c ON c.school_id=e.school_id
      JOIN academic_sessions ac ON ac.id=$3 AND ac.school_id=e.school_id
      JOIN academic_terms t ON t.id=$4 AND t.academic_session_id=ac.id AND t.school_id=e.school_id
      JOIN subjects s ON s.school_id=e.school_id
      WHERE e.school_id=$1 AND e.user_id=$2 AND e.employee_type='TEACHER' AND e.employment_status='ACTIVE'
        AND ${scope} ORDER BY c.id,s.id`,[1393,912,358,20])).rows;
    if(!contexts.some(c=>c.classId===538&&c.subjectId===6&&c.section==="A")||
       !contexts.some(c=>c.classId===571&&c.subjectId===15&&c.section==="Science")||
       contexts.some(c=>c.classId===538&&c.subjectId!==6))throw Error("Native staffing scope regression");
    const existingEnrollment=(await pool.query(`SELECT student_id,school_class_id,section FROM student_class_assignments
      WHERE school_id=1393 AND is_current=true AND status='ACTIVE' ORDER BY student_id`)).rows;
    console.log(JSON.stringify({nativeStaffingCheck:"PASS",contexts,existingEnrollment}));
  } else if (mode === "verify") {
    const baseline = JSON.parse(await readFile(path, "utf8"));
    const changed: Record<string, number> = {}, appended: Record<string, number> = {}, bookkeepingUpdates:Record<string,number>={};
    const normalize = (table: string, row: any) => {
      const copy = { ...row };
      if (table === "app_users") delete copy.updated_at; // ordinary authenticated identity bookkeeping
      if (table === "school_subscription_enforcement") delete copy.updated_at; // existing scheduler's refresh timestamp
      return JSON.stringify(copy);
    };
    for (const [table, original] of Object.entries(baseline) as [string, any[]][]) {
      if (!/^[a-z_]+$/.test(table)) throw Error("Unsafe table");
      const actual = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${table}" t`)).rows;
      const remaining = new Map<string, number>();
      for (const r of actual) { const key = normalize(table, r.row); remaining.set(key, (remaining.get(key) ?? 0) + 1); }
      for (const r of original) {
        const key = normalize(table, r), count = remaining.get(key) ?? 0;
        if (!count) changed[table] = (changed[table] ?? 0) + 1;
        else {
          remaining.set(key, count - 1);
          if ((table==="app_users"||table==="school_subscription_enforcement")&&
            actual.some(a=>normalize(table,a.row)===key&&a.row.updated_at!==r.updated_at))
            bookkeepingUpdates[table]=(bookkeepingUpdates[table]??0)+1;
        }
      }
      const extra = [...remaining.values()].reduce((a, b) => a + b, 0);
      if (extra) appended[table] = extra;
    }
    const report = { originalBusinessRowsPreserved: !Object.keys(changed).length,
      originalRowsByteIdentical: !Object.keys(changed).length&&!Object.keys(bookkeepingUpdates).length,
      changed, appended,bookkeepingUpdates,
      excludedBookkeepingFields:["app_users.updated_at","school_subscription_enforcement.updated_at"] };
    await writeFile("/tmp/lesson-parent-preservation-result.json", JSON.stringify(report), { mode: 0o600 });
    console.log(JSON.stringify(report));
    if (Object.keys(changed).length) process.exitCode = 1;
  } else throw Error("Choose capture, seed, scope or verify");
} catch (error) { await pool.query("ROLLBACK").catch(() => {}); throw error; }
finally { await pool.end(); }
