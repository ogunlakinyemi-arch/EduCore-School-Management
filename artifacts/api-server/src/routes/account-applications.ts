import { Router, type Request, type Response, type NextFunction } from "express";
import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { AuthError, assertRoles, getUserContext, handleAuthError, requireAuthentication } from "../middlewares/auth";
import { applicationInput, applicationDecision, applicationFields, applicationJoin,
  submitApplication, decideApplication, notifyApplicationDecision } from "../services/account-applications";
import { withApplicationNotificationInfo, reconcileApplicationNotification } from "../services/account-application-notifications";

const router = Router();
router.use(["/account-application","/platform/account-applications"], (_req,res,next) => {
  res.setHeader("Cache-Control","private, no-store"); next();
});
const run = (fn: (req: Request,res: Response) => Promise<unknown>) => (req: Request,res: Response,next: NextFunction) =>
  void fn(req,res).catch(error => handleAuthError(error,req,res,next));

async function application(id: number) {
  return (await pool.query(`SELECT ${applicationFields} ${applicationJoin} WHERE a.id=$1`, [id])).rows[0];
}

router.get("/account-application", requireAuthentication(), run(async (req,res) => {
  const c = getUserContext(req);
  const result = await pool.query(`SELECT ${applicationFields} ${applicationJoin} WHERE a.user_id=$1`, [c.user.id]);
  const existing = await pool.query(`SELECT 1 FROM school_memberships WHERE user_id=$1
    UNION ALL SELECT 1 FROM employees WHERE user_id=$1
    UNION ALL SELECT 1 FROM students WHERE user_id=$1
    UNION ALL SELECT 1 FROM parents WHERE user_id=$1
    UNION ALL SELECT 1 FROM partner_profiles WHERE user_id=$1
    UNION ALL SELECT 1 FROM platform_company_employees p JOIN app_users u ON lower(u.email)=lower(p.email)
      WHERE u.id=$1`, [c.user.id]);
  res.json({ application: result.rows[0] ?? null, eligible: !existing.rows.length && !result.rows.length });
}));
router.post("/account-application", requireAuthentication(), run(async (req,res) => {
  const c = getUserContext(req), parsed = applicationInput.safeParse(req.body);
  if (!parsed.success) {
    const issue=parsed.error.issues[0];
    const labels:Record<string,string>={fullName:"Full name",phone:"Phone",email:"Email",schoolName:"School name",
      partnerType:"Partner type",applicantType:"Applicant type",address:"Address",businessName:"Business name"};
    const label=labels[String(issue?.path[0])] ?? "Application";
    throw new AuthError(400,`${label}: ${issue?.message ?? "Please complete the required details"}`);
  }
  const identity = await clerkClient.users.getUser(c.user.clerkUserId);
  const email = identity.emailAddresses.find(e => e.id === identity.primaryEmailAddressId);
  if (!email || email.verification?.status !== "verified") throw new AuthError(403,"Verify your primary email before applying");
  const id = await submitApplication(c,parsed.data,email.emailAddress.trim().toLowerCase());
  res.status(201).json(await application(id));
}));
router.get("/platform/account-applications", requireAuthentication(), run(async (req,res) => {
  const c = assertRoles(req,["PLATFORM_OWNER"]);
  if (!c.roles.some(r=>r.role==="PLATFORM_OWNER" && r.schoolId===null && r.status==="ACTIVE")) {
    throw new AuthError(403,"Platform Owner access is required");
  }
  res.json(await withApplicationNotificationInfo((await pool.query(`SELECT ${applicationFields} ${applicationJoin} ORDER BY a.created_at DESC,a.id DESC`)).rows));
}));
router.post("/platform/account-applications/:applicationId/decision", requireAuthentication(), run(async (req,res) => {
  const c = assertRoles(req,["PLATFORM_OWNER"]);
  const id = Number(req.params.applicationId), parsed = applicationDecision.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) throw new AuthError(400,"Valid decision and rejection reason required");
  await decideApplication(c,id,parsed.data);
  try { await notifyApplicationDecision(c,id); }
  catch { req.log?.warn({applicationId:id},"Decision committed; notification needs review"); }
  res.json((await withApplicationNotificationInfo([await application(id)]))[0]);
}));
router.post("/platform/account-applications/:applicationId/notification", requireAuthentication(), run(async (req,res) => {
  const c = assertRoles(req,["PLATFORM_OWNER"]);
  const id = Number(req.params.applicationId);
  if (!Number.isSafeInteger(id) || id < 1 || !["RETRY","RECONCILE"].includes(req.body?.action)
    || Object.keys(req.body ?? {}).some(key => key !== "action")) throw new AuthError(400,"Valid notification action required");
  if (req.body.action === "RETRY") await notifyApplicationDecision(c,id,true);
  else await reconcileApplicationNotification(c,id);
  res.json((await withApplicationNotificationInfo([await application(id)]))[0]);
}));
export default router;
