// One-shot Development acceptance sign-in for an explicitly user-authorized account.
// Does not change identity, roles, verification, memberships, or school records.
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";

const [idArg,schoolArg,authorizedName,roleArg="TEACHER",studentArg]=process.argv.slice(2);
const userId=Number(idArg),schoolId=Number(schoolArg);
const studentId=studentArg?Number(studentArg):null;
if(!["TEACHER","SCHOOL_ADMIN","STUDENT","PARENT","PLATFORM_OWNER"].includes(roleArg)||
  (["STUDENT","PARENT"].includes(roleArg)&&(!Number.isSafeInteger(studentId)||Number(studentId)<1)))
  throw Error("Use an authorized role and bind family accounts to the approved existing student");
const nameKey=(value:string)=>value.toLowerCase().trim().split(/\s+/).sort().join(" ");
if(!Number.isSafeInteger(userId)||userId<1||!Number.isSafeInteger(schoolId)||schoolId<1||!authorizedName||
  process.env.REPLIT_DEPLOYMENT||!process.env.REPLIT_DEV_DOMAIN||!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"))
  throw Error("An explicit account, school, authorized name, and Development test tenant are required");
try {
  const identity=(await pool.query("SELECT current_database() AS database,inet_server_addr()::text AS address")).rows[0];
  if(identity.database!=="heliumdb"||identity.address!==null)throw Error("Confirmed local Development target required");
  const rows=(await pool.query(`SELECT u.id,u.clerk_user_id,concat_ws(' ',u.first_name,u.last_name) AS name,m.role
    FROM app_users u JOIN school_memberships m ON m.user_id=u.id AND m.status='ACTIVE'
    JOIN schools s ON s.id=$2 AND UPPER(s.status)='ACTIVE'
    WHERE u.id=$1 AND u.status='ACTIVE' AND m.role=$3
      AND (m.school_id=$2 OR ($3='PLATFORM_OWNER' AND m.school_id IS NULL))
      AND ($3<>'TEACHER' OR EXISTS(SELECT 1 FROM employees e WHERE e.user_id=u.id AND e.school_id=$2 AND e.employee_type='TEACHER' AND e.employment_status='ACTIVE'))
      AND ($3<>'STUDENT' OR EXISTS(SELECT 1 FROM students st WHERE st.id=$4 AND st.school_id=$2 AND st.user_id=u.id AND UPPER(st.status)='ACTIVE'))
      AND ($3<>'PARENT' OR EXISTS(SELECT 1 FROM parents p JOIN parent_student_relationships psr ON psr.parent_id=p.id
        JOIN students st ON st.id=psr.student_id AND st.school_id=$2 WHERE p.user_id=u.id AND st.id=$4
        AND UPPER(p.status)='ACTIVE' AND UPPER(psr.status)='ACTIVE'))`,[userId,schoolId,roleArg,studentId])).rows;
  if(rows.length!==1||nameKey(rows[0].name)!==nameKey(authorizedName))throw Error("Authorized name and active teacher binding must match exactly");
  const require=createRequire(fileURLToPath(new URL("../../artifacts/api-server/package.json",import.meta.url)));
  const {clerkClient}=await import(require.resolve("@clerk/express"));
  const user=await clerkClient.users.getUser(rows[0].clerk_user_id);
  if(user.banned||user.locked||!user.emailAddresses.some((e:any)=>e.verification?.status==="verified"))
    throw Error("Existing provider identity must be available and already verified");
  const result=await clerkClient.signInTokens.createSignInToken({userId:user.id,expiresInSeconds:1800});
  const ticketFile=`/tmp/exam-record-authorized-ticket-${userId}.json`;
  await writeFile(ticketFile,JSON.stringify({ticket:result.token,userId,schoolId}),{mode:0o600});
  console.log(JSON.stringify({ticketFile,userId,schoolId,role:roleArg,verified:true}));
} finally {await pool.end();}
