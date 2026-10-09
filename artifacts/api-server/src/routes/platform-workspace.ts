import { Router, type Request } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "@workspace/db";
import { AuthError, assertRoles, getUserContext, requireAuthentication } from "../middlewares/auth";
import { queueCommunicationNotification } from "../services/communication-service";

const router = Router();
router.use(requireAuthentication());
export const schoolSelection = z.object({
  schoolIds: z.array(z.number().int().positive()).min(1).max(50)
    .refine(ids => new Set(ids).size === ids.length, "Select distinct schools"),
}).strict();
export const platformMessageInput = schoolSelection.extend({
  subject: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(5000),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),
  confirmedRecipientCount:z.number().int().positive(),
}).strict();
const run = (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: any) => void handler(req, res).catch(error =>
    next(error instanceof z.ZodError ? new AuthError(400, error.issues[0]?.message ?? "Invalid request") : error));
function owner(req: Request) { return assertRoles(req, ["PLATFORM_OWNER"]); }
async function audit(db: any, req: Request, action: string, metadata: unknown, schoolId: number | null = null, recordId: number | null = null) {
  const {user} = getUserContext(req);
  await db.query(`INSERT INTO audit_logs
    ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,event_type,result,metadata)
    VALUES($1,'PLATFORM_OWNER',$2,$3,$4,$5,'Platform workspace',$6,'APPLICATION_EVENT','SUCCESS',$7::jsonb)`,
    [user.email,user.id,user.clerkUserId,schoolId,action,recordId,JSON.stringify(metadata)]);
}
async function recipients(db: any, ids: number[]) {
  const schools = (await db.query(`SELECT id,name FROM schools WHERE id=ANY($1::int[]) AND lower(status)='active' ORDER BY id FOR SHARE`,[ids])).rows;
  if (schools.length !== ids.length) throw new AuthError(404,"One or more selected schools are unavailable");
  const rawUsers = (await db.query(`SELECT sm.school_id AS "schoolId",sm.user_id AS "userId"
    FROM school_memberships sm JOIN app_users u ON u.id=sm.user_id
    WHERE sm.school_id=ANY($1::int[]) AND sm.role='SCHOOL_ADMIN' AND sm.status='ACTIVE' AND upper(u.status)='ACTIVE'
    ORDER BY sm.school_id,sm.user_id FOR SHARE OF sm,u`,[ids])).rows;
  const users = [...new Map(rawUsers.map((u:any)=>[`${u.schoolId}:${u.userId}`,u])).values()] as any[];
  const result = schools.map((s: any) => ({...s, recipientCount:users.filter((u: any) => u.schoolId===s.id).length}));
  if (result.some((s: any) => !s.recipientCount)) throw new AuthError(409,"Each selected school needs an active School Admin recipient");
  return {schools:result, users, recipientCount:users.length};
}
router.post("/platform/communications/preview",run(async(req,res) => {
  owner(req);
  const {schoolIds} = schoolSelection.parse(req.body);
  const {schools,recipientCount} = await recipients(pool,schoolIds);
  res.set("Cache-Control","no-store").json({schools,recipientCount});
}));
router.post("/platform/communications",run(async(req,res) => {
  owner(req);
  const input = platformMessageInput.parse(req.body);
  const schoolIds = [...input.schoolIds].sort((a,b)=>a-b);
  const userId = getUserContext(req).user.id;
  const hash = createHash("sha256").update(JSON.stringify({schoolIds,subject:input.subject,body:input.body})).digest("hex");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`platform-message:${userId}:${input.idempotencyKey}`]);
    const previous = (await db.query(`SELECT c.id,c.school_id AS "schoolId",s.name AS "schoolName",c.recipient_count AS "recipientCount",c.status,
      c.target_criteria->>'requestHash' AS "requestHash"
      FROM communication_campaigns c JOIN schools s ON s.id=c.school_id
      WHERE c.created_by_user_id=$1 AND c.idempotency_key=$2 AND c.target_criteria->>'platformOwner'='true' ORDER BY c.school_id`,
      [userId,input.idempotencyKey])).rows;
    if (previous.length) {
      if (previous.some(r=>r.requestHash!==hash) || previous.length!==schoolIds.length) throw new AuthError(409,"This submission key belongs to a different message");
      await db.query("COMMIT");
      res.json({campaigns:previous.map(({requestHash,...r})=>r)}); return;
    }
    const audience = await recipients(db,schoolIds);
    if(audience.recipientCount!==input.confirmedRecipientCount)throw new AuthError(409,"The recipient list changed. Preview and confirm the schools again before sending.");
    const campaigns = [];
    for (const school of audience.schools) {
      const users = audience.users.filter((u:any)=>u.schoolId===school.id);
      const campaign = (await db.query(`INSERT INTO communication_campaigns
        (school_id,created_by_user_id,idempotency_key,title,subject,body,category,target_type,target_criteria,channels,status,recipient_count)
        VALUES($1,$2,$3,$4,$4,$5,'ANNOUNCEMENT','USERS',$6::jsonb,ARRAY['IN_APP'],'QUEUED',$7)
        ON CONFLICT(school_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
        RETURNING id,school_id AS "schoolId",recipient_count AS "recipientCount",status`,
        [school.id,userId,input.idempotencyKey,input.subject,input.body,
          JSON.stringify({userIds:users.map((u:any)=>u.userId),platformOwner:true,requestHash:hash}),users.length])).rows[0];
      if (!campaign) throw new AuthError(409,"Submission key is already in use");
      for (const recipient of users) {
        const notificationId = await queueCommunicationNotification(db,{
          schoolId:school.id,recipientUserId:Number(recipient.userId),category:"ANNOUNCEMENT",
          eventKey:`PLATFORM_CAMPAIGN:${campaign.id}:${recipient.userId}`,subject:input.subject,body:input.body,
          link:"/inbox",channels:["IN_APP"],useSchoolDefaults:false,
        });
        await db.query(`INSERT INTO communication_campaign_recipients(campaign_id,school_id,recipient_user_id,notification_id,status)
          VALUES($1,$2,$3,$4,CASE WHEN $4::integer IS NULL THEN 'SKIPPED' ELSE 'QUEUED' END)
          ON CONFLICT(campaign_id,recipient_user_id) DO NOTHING`,[campaign.id,school.id,recipient.userId,notificationId]);
      }
      await audit(db,req,"Queued platform message to school",{recipientCount:users.length,channels:["IN_APP"]},school.id,campaign.id);
      campaigns.push({...campaign,schoolName:school.name});
    }
    await db.query("COMMIT");
    res.set("Cache-Control","no-store").json({campaigns});
  } catch(error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
}));
router.get("/platform/communications",run(async(req,res) => {
  owner(req);
  const campaigns = (await pool.query(`SELECT c.id,c.school_id AS "schoolId",s.name AS "schoolName",c.subject,c.body,c.status,
    c.recipient_count AS "recipientCount",c.created_at AS "createdAt",
    COALESCE((SELECT json_agg(states) FROM (SELECT COALESCE(d.status,r.status) AS status,count(*)::int AS count
      FROM communication_campaign_recipients r LEFT JOIN communication_deliveries d ON d.notification_id=r.notification_id
      WHERE r.campaign_id=c.id AND r.school_id=c.school_id GROUP BY COALESCE(d.status,r.status)) states),'[]'::json) AS "deliveryStates"
    FROM communication_campaigns c JOIN schools s ON s.id=c.school_id
    WHERE c.created_by_user_id=$1 AND c.target_criteria->>'platformOwner'='true' ORDER BY c.created_at DESC,c.id DESC LIMIT 100`,
    [getUserContext(req).user.id])).rows;
  res.set("Cache-Control","no-store").json({campaigns});
}));
export function exportCsvCell(value: unknown) {
  let text=String(value??"");
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text="'"+text;
  return `"${text.replaceAll('"','""')}"`;
}
router.post("/platform/exports/schools",run(async(req,res) => {
  owner(req);
  const {schoolIds} = schoolSelection.parse(req.body);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const rows=(await db.query(`SELECT s.id,s.code,s.name,s.city,s.state,s.status,
      (SELECT count(*) FROM students st WHERE st.school_id=s.id) AS students,
      (SELECT count(*) FROM employees e WHERE e.school_id=s.id) AS employees
      FROM schools s WHERE s.id=ANY($1::int[]) ORDER BY s.id`,[schoolIds])).rows;
    if (rows.length!==schoolIds.length) throw new AuthError(404,"One or more selected schools were not found");
    const columns=["id","code","name","city","state","status","students","employees"];
    const csv=[columns.join(","),...rows.map(r=>columns.map(c=>exportCsvCell(r[c])).join(","))].join("\r\n")+"\r\n";
    await audit(db,req,"Exported school directory",{schoolIds,rowCount:rows.length,columns});
    await db.query("COMMIT");
    res.set("Cache-Control","no-store").set("Content-Disposition",'attachment; filename="educore-school-directory.csv"')
      .type("text/csv").send(csv);
  } catch(error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
}));
export default router;
