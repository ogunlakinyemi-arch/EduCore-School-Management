// One-shot Development acceptance sign-in for an explicitly user-authorized account.
// Does not change identity, roles, verification, memberships, or school records.
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";

const [idArg,schoolArg,authorizedName]=process.argv.slice(2);
const userId=Number(idArg),schoolId=Number(schoolArg);
const nameKey=(value:string)=>value.toLowerCase().trim().split(/\s+/).sort().join(" ");
if(!Number.isSafeInteger(userId)||userId<1||!Number.isSafeInteger(schoolId)||schoolId<1||!authorizedName||
  process.env.REPLIT_DEPLOYMENT||!process.env.REPLIT_DEV_DOMAIN||!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"))
  throw Error("An explicit account, school, authorized name, and Development test tenant are required");
try {
  const identity=(await pool.query("SELECT current_database() AS database,inet_server_addr()::text AS address")).rows[0];
  if(identity.database!=="heliumdb"||identity.address!==null)throw Error("Confirmed local Development target required");
  const rows=(await pool.query(`SELECT u.id,u.clerk_user_id,concat_ws(' ',u.first_name,u.last_name) AS name,m.role
    FROM app_users u JOIN school_memberships m ON m.user_id=u.id AND m.status='ACTIVE'
    JOIN schools s ON s.id=m.school_id AND UPPER(s.status)='ACTIVE'
    JOIN employees e ON e.user_id=u.id AND e.school_id=s.id AND e.employee_type='TEACHER' AND e.employment_status='ACTIVE'
    WHERE u.id=$1 AND u.status='ACTIVE' AND m.school_id=$2 AND m.role='TEACHER'`,[userId,schoolId])).rows;
  if(rows.length!==1||nameKey(rows[0].name)!==nameKey(authorizedName))throw Error("Authorized name and active teacher binding must match exactly");
  const require=createRequire(fileURLToPath(new URL("../../artifacts/api-server/package.json",import.meta.url)));
  const {clerkClient}=await import(require.resolve("@clerk/express"));
  const user=await clerkClient.users.getUser(rows[0].clerk_user_id);
  if(user.banned||user.locked||!user.emailAddresses.some((e:any)=>e.verification?.status==="verified"))
    throw Error("Existing provider identity must be available and already verified");
  const result=await clerkClient.signInTokens.createSignInToken({userId:user.id,expiresInSeconds:600});
  const ticketFile=`/tmp/exam-record-authorized-ticket-${userId}.json`;
  await writeFile(ticketFile,JSON.stringify({ticket:result.token,userId,schoolId}),{mode:0o600});
  console.log(JSON.stringify({ticketFile,userId,schoolId,role:"TEACHER",verified:true}));
} finally {await pool.end();}
