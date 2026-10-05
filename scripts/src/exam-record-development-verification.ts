import { createRequire } from "node:module";
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
const mode=process.argv[2];
if(!["--inventory","--ticket","--read-models"].includes(mode??"")||process.env.REPLIT_DEPLOYMENT||!process.env.REPLIT_DEV_DOMAIN||
  !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) throw Error("Development-only verification requires a verified test tenant");
const identity=(await pool.query("SELECT current_database() AS database,inet_server_addr()::text AS address,pg_postmaster_start_time()::text AS started")).rows[0];
if(identity.database!=="heliumdb"||identity.address!==null)throw Error("The independently confirmed local Development database is not selected");
const root=fileURLToPath(new URL("../../",import.meta.url));
const apiRequire=createRequire(root+"artifacts/api-server/package.json");
const {clerkClient:clerk}=await import(apiRequire.resolve("@clerk/express"));
async function approvedFixture(userId:number) {
  const r=(await pool.query(`SELECT u.id,u.clerk_user_id,u.status,s.id AS school_id,s.name,s.code,m.role
    FROM app_users u JOIN school_memberships m ON m.user_id=u.id AND m.status='ACTIVE'
    LEFT JOIN schools s ON s.id=m.school_id
    WHERE u.id=$1 AND u.status='ACTIVE' AND (m.school_id IS NULL OR upper(s.status)='ACTIVE')`,[userId])).rows;
  if(!r.length||!r[0].clerk_user_id)throw Error("No active existing account found");
  const user=await clerk.users.getUser(r[0].clerk_user_id);
  const purpose=String(user.privateMetadata.purpose??"");
  if(!/(educore|edupulse|notification|academic|timetable|lesson)/i.test(purpose)||!/(test|fixture|qa)/i.test(purpose))
    throw Error("This is not an explicitly owned Development QA identity; do not impersonate a business account");
  if(!user.emailAddresses.some((e:any)=>e.verification?.status==="verified"&&/@example\.(com|org|net)$/i.test(e.emailAddress)))
    throw Error("Fixture needs an already-verified controlled email");
  return {userId,clerkUserId:user.id,roles:r.map((x:any)=>({schoolId:x.school_id,role:x.role})),purpose};
}
try {
  if(mode==="--read-models") {
    const {periodStudents,compileStudent}=await import(apiRequire.resolve("./src/services/result-compilation.ts"));
    const c=await pool.connect();
    try {
      await c.query("BEGIN READ ONLY");
      const scopes=(await c.query(`SELECT DISTINCT sca.school_id AS "schoolId",sca.academic_session_id AS "sessionId",t.id AS "termId"
        FROM student_class_assignments sca JOIN academic_terms t ON t.school_id=sca.school_id AND t.academic_session_id=sca.academic_session_id
        AND (sca.academic_term_id IS NULL OR sca.academic_term_id=t.id) ORDER BY 1,2,3 LIMIT 20`)).rows;
      let compiled=0,contexts=0;
      const route=await readFile(root+"artifacts/api-server/src/routes/exam-record.ts","utf8");
      const sql=route.match(/const candidates=\(await pool\.query\(`([\s\S]*?)`,\[schoolId,sessionId,termId\]/)?.[1];
      if(!sql)throw Error("Context SQL could not be located for the native syntax check");
      for(const scope of scopes) {
        await c.query(sql,[scope.schoolId,scope.sessionId,scope.termId]);contexts++;
        for(const student of await periodStudents(c,scope)) {await compileStudent(c,scope,student);compiled++;}
      }
      const baseline=JSON.parse(await readFile("/tmp/exam-record-preservation-baseline.json","utf8"));
      let originalRows=0;const changes=[];
      for(const [table,rows] of Object.entries(baseline.tables) as [string,any[]][]) {
        if(!/^[a-z_]+$/.test(table))throw Error("Unsafe preservation table");
        const actual=(await c.query(`SELECT id,md5(to_jsonb(t)::text) AS jsonb_hash,md5(row_to_json(t)::text) AS json_hash FROM "${table}" t`)).rows;
        for(const row of rows) {
          originalRows++;const current=actual.find((r:any)=>r.id===row.id);
          if(!current||![current.jsonb_hash,current.json_hash].includes(row.hash))changes.push({table,id:row.id});
        }
      }
      if(changes.length)throw Error(`Original-record preservation failed: ${JSON.stringify(changes)}`);
      const finance=(await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
        AND table_name ~ '(fee|financial|salary|payroll|wallet|payment|refund|flutterwave)' ORDER BY table_name`)).rows;
      const financeTables:Record<string,unknown>={};
      for(const {table_name} of finance)financeTables[table_name]=(await c.query(`SELECT md5(to_jsonb(t)::text) AS hash FROM "${table_name.replaceAll('"','""')}" t ORDER BY 1`)).rows;
      await writeFile("/tmp/exam-record-finance-preservation.json",JSON.stringify({identity,tables:financeTables}),{mode:0o600});
      await c.query("ROLLBACK");
      console.log(JSON.stringify({nativeContextQueries:contexts,nativeCompiledStudents:compiled,preservedOriginalRows:originalRows,financeTables:finance.length,readOnly:true}));
    } finally {c.release();}
  } else if(mode==="--inventory") {
    const candidates=(await pool.query(`SELECT DISTINCT u.id FROM app_users u JOIN school_memberships m ON m.user_id=u.id
      LEFT JOIN schools s ON s.id=m.school_id WHERE u.status='ACTIVE' AND m.status='ACTIVE'
      AND (m.role='PLATFORM_OWNER' OR (upper(s.status)='ACTIVE' AND (s.name ILIKE '%QA%' OR s.code ILIKE '%QA%')))
      ORDER BY u.id`)).rows;
    const fixtures=[];
    const rejections:Record<string,number>={};
    for(const row of candidates) {
      try {const f=await approvedFixture(row.id);fixtures.push({userId:f.userId,roles:f.roles,purpose:f.purpose});}
      catch(error) {
        const e=error as any,status=Number(e.status??e.statusCode);
        if(status&&status!==404)throw Error(`Clerk inventory request failed (${status}); fixture availability is unverified`);
        const reason=status===404?"Retired provider identity":e.message;
        if(!["Retired provider identity","No active existing account found",
          "This is not an explicitly owned Development QA identity; do not impersonate a business account",
          "Fixture needs an already-verified controlled email"].includes(reason))throw error;
        rejections[reason]=(rejections[reason]??0)+1;
      }
    }
    console.log(JSON.stringify({identity,candidates:candidates.length,fixtures,rejections},null,2));
  } else {
    const userId=Number(process.argv[3]);if(!Number.isSafeInteger(userId)||userId<1)throw Error("Supply an existing approved fixture user ID");
    const f=await approvedFixture(userId);
    const token=await clerk.signInTokens.createSignInToken({userId:f.clerkUserId,expiresInSeconds:600});
    const output=`/tmp/exam-record-ticket-${userId}.json`;
    await writeFile(output,JSON.stringify({ticket:token.token,userId,roles:f.roles}),{mode:0o600});
    console.log(JSON.stringify({ticketFile:output,userId}));
  }
} finally {await pool.end();}
