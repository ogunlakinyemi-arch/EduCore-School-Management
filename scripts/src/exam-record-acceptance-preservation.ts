import { pool } from "@workspace/db";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const mode=process.argv[2],path="/tmp/mercyland-exam-preservation.json";
if(!["capture","verify"].includes(mode??"")||process.env.REPLIT_DEPLOYMENT||!process.env.REPLIT_DEV_DOMAIN)
  throw Error("Development preservation mode required");
try {
  const identity=(await pool.query("SELECT current_database() AS database,inet_server_addr()::text AS address")).rows[0];
  if(identity.database!=="heliumdb"||identity.address!==null)throw Error("Local Development target required");
  if(mode==="capture") {
    const tables=(await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'
      AND table_type='BASE TABLE' AND (table_name ~ '(fee|financial|salary|payroll|wallet|payment|refund|flutterwave)'
      OR table_name IN('students','parents','parent_student_relationships','academic_grading_rules','academic_results','academic_assessments',
      'academic_report_cards','academic_report_card_lines','school_memberships','schools','app_users','academic_assessment_types')) ORDER BY 1`)).rows;
    const baseline:Record<string,any[]>={};
    for(const {table_name} of tables) {
      if(!/^[a-z_]+$/.test(table_name))throw Error("Unsafe table");
      baseline[table_name]=(await pool.query(`SELECT to_jsonb(t) AS row FROM "${table_name}" t`)).rows.map((r:any)=>r.row);
    }
    await writeFile(path,JSON.stringify({identity,tables:baseline}),{mode:0o600});
    const logo=(await pool.query("SELECT object_path FROM school_branding_logos WHERE school_id=1393 AND is_current=true")).rows[0];
    if(logo) {
      const require=createRequire(fileURLToPath(new URL("../../artifacts/api-server/package.json",import.meta.url)));
      const {schoolLogoFile}=await import(require.resolve("./src/lib/schoolLogoStorage.ts"));
      let bytes:Buffer;
      try {[bytes]=await schoolLogoFile(logo.object_path).download();}catch{throw Error("Existing Mercyland logo could not be read safely");}
      await writeFile("/tmp/mercyland-school-logo",bytes,{mode:0o600});
    }
    console.log(JSON.stringify({capturedTables:tables.length,logoAvailable:!!logo,privateBaseline:path}));
  } else {
    const original=JSON.parse(await readFile(path,"utf8"));
    const changes:Record<string,number>={},newRows:Record<string,number>={};
    for(const [table,rows] of Object.entries(original.tables) as [string,any[]][]) {
      if(!/^[a-z_]+$/.test(table))throw Error("Unsafe table");
      const actual=(await pool.query(`SELECT to_jsonb(t) AS row FROM "${table}" t`)).rows.map((r:any)=>r.row);
      const normalize=(r:any)=>{
        const copy={...r};
        if(table==="students"&&Number(r.id)===721)for(const k of ["class_name","section","updated_at"])delete copy[k];
        // Normal signed-in identity synchronization may touch its bookkeeping timestamp.
        if(table==="app_users")delete copy.updated_at;
        return JSON.stringify(copy);
      };
      // Not every table uses an "id" primary key. Match full normalized rows as
      // a multiset, retaining duplicate counts and never correlating undefined IDs.
      const remaining=new Map<string,number>();
      for(const row of actual) {
        const key=normalize(row);
        remaining.set(key,(remaining.get(key)??0)+1);
      }
      for(const row of rows) {
        const key=normalize(row),count=remaining.get(key)??0;
        if(!count)changes[table]=(changes[table]??0)+1;
        else remaining.set(key,count-1);
      }
      const added=[...remaining.values()].reduce((sum,count)=>sum+count,0);
      if(added)newRows[table]=added;
      const approvedNewTables=["academic_assessments","academic_grading_rules","academic_report_card_lines","academic_report_cards","academic_results"];
      if(added&&!approvedNewTables.includes(table))
        changes[table]=(changes[table]??0)+added;
      if(added&&approvedNewTables.includes(table))for(const row of actual) {
        if((remaining.get(normalize(row))??0)>0&&Number(row.school_id)!==1393)
          changes[table]=(changes[table]??0)+1;
      }
    }
    const historical=JSON.parse(await readFile("/tmp/exam-record-preservation-baseline.json","utf8"));
    let historicalRowsVerified=0;
    for(const [table,rows] of Object.entries(historical.tables) as [string,any[]][]) {
      if(!/^[a-z_]+$/.test(table))throw Error("Unsafe historical table");
      const actual=(await pool.query(`SELECT id,md5(to_jsonb(t)::text) AS jsonb_hash,md5(row_to_json(t)::text) AS json_hash FROM "${table}" t`)).rows;
      for(const row of rows) {
        // The authorized enrollment's profile fields are covered against the
        // full-row baseline above, which preserves all its unrelated fields.
        if(table==="students"&&Number(row.id)===721)continue;
        const current=actual.find((r:any)=>r.id===row.id);
        if(!current||![current.jsonb_hash,current.json_hash].includes(row.hash))
          changes[table]=(changes[table]??0)+1;
        else historicalRowsVerified++;
      }
    }
    const enrollments=(await pool.query(`SELECT id,student_id,academic_session_id,academic_term_id,school_class_id,section
      FROM student_class_assignments WHERE school_id=1393`)).rows;
    if(enrollments.length!==1||enrollments[0].student_id!==721||enrollments[0].academic_session_id!==358||
      enrollments[0].academic_term_id!==20||enrollments[0].school_class_id!==538||enrollments[0].section!=="A")
      changes.student_class_assignments=(changes.student_class_assignments??0)+1;
    console.log(JSON.stringify({originalRecordsPreserved:Object.keys(changes).length===0,historicalRowsVerified,
      approvedStudentEnrollmentOnly:enrollments.length===1,unexpectedChanges:changes,approvedNewRows:newRows}));
    if(Object.keys(changes).length)process.exitCode=1;
  }
} finally {await pool.end();}
