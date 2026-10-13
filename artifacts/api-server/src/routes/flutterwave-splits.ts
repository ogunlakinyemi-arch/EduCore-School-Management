import { Router, type Request } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { AuthError, getUserContext, isPlatformOwner, assertRoles, assertSchoolOperationalAccess, requireAuthentication } from "../middlewares/auth";
import { requireSplitDevelopment, isSplitDevelopment } from "../lib/flutterwave-split-policy";
import { developmentFlutterwaveCredential } from "../lib/flutterwave-development-config";
import { businessEmailSchema, existingDiagnosticTestReference, schoolTestSplitInput } from "../lib/flutterwave-split-review";
import { transactionSplitEvidence } from "../services/flutterwave-split-evidence";
import { recipientView, submitSplitRecipient, reviewSplitRecipient } from "../services/flutterwave-split-recipients";
import { splitPaymentView, reconcileSplitPayment } from "../services/flutterwave-split-reporting";
import { requestSplitRefund, verifySplitRefund } from "../services/flutterwave-split-refunds";

const router = Router();
const id = (value: unknown) => z.coerce.number().int().positive().parse(value);
const run = (handler: (req: Request,res: any) => Promise<void>) => (req: Request,res: any,next: any) => {
  void handler(req,res).catch(error => {
    if (error instanceof z.ZodError) return res.status(400).json({error:"Invalid split-settlement request"});
    next(error);
  });
};
async function scopes(req: Request) {
  requireSplitDevelopment();
  const c = getUserContext(req), owner = isPlatformOwner(c);
  if (!owner && c.roles.some(r => r.status === "ACTIVE" && ["INTERNAL_OFFICER","COMPANY_ACCOUNTANT"].includes(r.role))) {
    throw new AuthError(403,"This role cannot manage school or Partner settlement details");
  }
  const schoolIds = c.roles.filter(r => r.status === "ACTIVE" && ["SCHOOL_ADMIN","ACCOUNTANT"].includes(r.role)).map(r => r.schoolId).filter(Boolean);
  const schoolRows = (await pool.query(
    `SELECT id,name FROM schools WHERE ($1::boolean OR id=ANY($2::int[])) ORDER BY id DESC LIMIT 500`, [owner,schoolIds],
  )).rows.map(r => ({kind:"SCHOOL",id:r.id,name:r.name}));
  const partnerRows = (await pool.query(
    `SELECT p.id,COALESCE(NULLIF(p.business_name,''),p.full_name) name FROM partner_profiles p WHERE p.status='ACTIVE'
     AND ($1::boolean OR p.user_id=$2 OR EXISTS(SELECT 1 FROM partner_profile_users pu
       WHERE pu.partner_profile_id=p.id AND pu.user_id=$2 AND pu.status='ACTIVE'
        AND pu.role IN ('PARTNER_ADMIN','PARTNER_FINANCE'))) ORDER BY p.id DESC LIMIT 500`, [owner,c.user.id],
  )).rows.map(r => ({kind:"PARTNER",id:r.id,name:r.name}));
  if (!owner && !schoolRows.length && !partnerRows.length) throw new AuthError(403,"School administration or Partner finance access is required");
  return {owner,actorId:c.user.id,items:[...schoolRows,...partnerRows],
    schoolIds:schoolRows.map(r => r.id),partnerIds:partnerRows.map(r => r.id)};
}
router.use("/flutterwave",requireAuthentication());
router.get("/flutterwave/split-dashboard",run(async(req,res) => {
  const scope = await scopes(req);
  const schoolId = req.query.schoolId === undefined ? null : id(req.query.schoolId);
  if (schoolId && !scope.owner && !scope.schoolIds.includes(schoolId)) throw new AuthError(404,"School not found");
  const recipients = (await pool.query(
    `SELECT * FROM flutterwave_split_recipients WHERE
      ($1::boolean OR school_id=ANY($2::int[]) OR partner_profile_id=ANY($3::int[])) ORDER BY id DESC LIMIT 200`,
    [scope.owner,scope.schoolIds,scope.partnerIds],
  )).rows.map(recipientView);
  const settings = (await pool.query(
    `SELECT school_id AS "schoolId",enabled,automatic_settlement_confirmed AS "testSplitVerificationAuthorized"
     FROM flutterwave_split_settings WHERE $1::boolean OR school_id=ANY($2::int[])`, [scope.owner,scope.schoolIds],
  )).rows;
  const payments = (await pool.query(
    `SELECT payment_id FROM flutterwave_split_payments
     WHERE ($1::boolean OR school_id=ANY($2::int[]) OR partner_profile_id=ANY($3::int[]))
      AND ($4::int IS NULL OR school_id=$4) ORDER BY created_at DESC LIMIT 50`,
    [scope.owner,scope.schoolIds,scope.partnerIds,schoolId],
  )).rows;
  res.set("Cache-Control","no-store").json({
    developmentOnly:true,mode:"TEST",currency:"NGN",feeBearer:"PLATFORM",isOwner:scope.owner,
    testCredentialConfigured:!!developmentFlutterwaveCredential().secret,scopes:scope.items,recipients,
    schools:scope.schoolIds.map(s => settings.find(r => r.schoolId === s) ?? {schoolId:s,enabled:false,testSplitVerificationAuthorized:false}),
    payments:await Promise.all(payments.map(p => splitPaymentView(p.payment_id))),
  });
}));
router.post("/flutterwave/split-recipients",run(async(req,res) => {
  const scope = await scopes(req);
  const input = z.object({
    kind:z.enum(["SCHOOL","PARTNER"]),entityId:z.number().int().positive(),bankCode:z.string().regex(/^\d{3,6}$/),
    accountNumber:z.string().regex(/^\d{10}$/),contactPhone:z.string().regex(/^\+?\d{10,15}$/),
    businessEmail:businessEmailSchema,
    ownershipAttestation:z.literal(true),
  }).strict().parse(req.body);
  if (scope.owner) throw new AuthError(403,"Owner reviews submissions; settlement details must be submitted by their own school or Partner");
  const selected = scope.items.find(s => s.kind === input.kind && s.id === input.entityId);
  if (!selected) throw new AuthError(404,"Recipient entity not found");
  if (input.kind === "SCHOOL") assertSchoolOperationalAccess(req,input.entityId,["SCHOOL_ADMIN"]);
  res.status(201).set("Cache-Control","no-store").json(await submitSplitRecipient(scope.actorId,selected,input));
}));
router.post("/flutterwave/split-recipients/:recipientId/review",run(async(req,res) => {
  requireSplitDevelopment(); const c = assertRoles(req,["PLATFORM_OWNER"]);
  const input = z.object({
    action:z.enum(["APPROVE_AND_CREATE_TEST","VERIFY_EXISTING_TEST","RECOVER","SUSPEND","RETIRE"]),note:z.string().trim().min(10).max(1000),
    ownershipConfirmed:z.boolean().optional(),distinctFromPlatformAccountConfirmed:z.boolean().optional(),
    existingTestReference:z.literal(existingDiagnosticTestReference).optional(),
  }).strict().parse(req.body);
  res.set("Cache-Control","no-store").json(await reviewSplitRecipient(id(req.params.recipientId),c.user.id,input));
}));
router.patch("/flutterwave/split-schools/:schoolId/configuration",run(async(req,res) => {
  requireSplitDevelopment(); const c = assertRoles(req,["PLATFORM_OWNER"]),schoolId = id(req.params.schoolId);
  const input = schoolTestSplitInput.parse(req.body);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const school = (await db.query("SELECT id FROM schools WHERE id=$1 FOR SHARE",[schoolId])).rows[0];
    if (!school) throw new AuthError(404,"School not found");
    if (input.enabled) {
      const ready = (await db.query("SELECT id FROM flutterwave_split_recipients WHERE school_id=$1 AND status='TEST_READY' FOR SHARE",[schoolId])).rows[0];
      if (!ready) throw new AuthError(409,"School recipient must be owned, reviewed and provider-verified first");
      // Partner readiness is checked again against the actual term at checkout.
    }
    await db.query(
      `INSERT INTO flutterwave_split_settings(school_id,enabled,automatic_settlement_confirmed,reviewed_by)
       VALUES($1,$2,$3,$4) ON CONFLICT(school_id) DO UPDATE SET enabled=$2,automatic_settlement_confirmed=$3,reviewed_by=$4,updated_at=NOW()`,
      // Retain the existing storage column; in Development this is an explicit
      // TEST verification authorization, not an assertion of bank settlement.
      [schoolId,input.enabled,input.testSplitVerificationAuthorized,c.user.id],
    );
    await db.query("COMMIT");
  } catch(e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  res.json({schoolId,...input});
}));
router.get("/flutterwave/split-payments/:paymentId/transaction-evidence",run(async(req,res) => {
  const scope = await scopes(req), paymentId = id(req.params.paymentId);
  const p = (await pool.query("SELECT school_id FROM flutterwave_split_payments WHERE payment_id=$1",[paymentId])).rows[0];
  if (!p || (!scope.owner && !scope.schoolIds.includes(p.school_id))) throw new AuthError(404,"Split payment not found");
  res.set("Cache-Control","no-store").json(await transactionSplitEvidence(paymentId));
}));
router.post("/flutterwave/split-payments/:paymentId/reconcile",run(async(req,res) => {
  const scope = await scopes(req),paymentId = id(req.params.paymentId);
  const p = (await pool.query("SELECT school_id FROM flutterwave_split_payments WHERE payment_id=$1",[paymentId])).rows[0];
  if (!p || (!scope.owner && !scope.schoolIds.includes(p.school_id))) throw new AuthError(404,"Split payment not found");
  res.json(await reconcileSplitPayment(paymentId));
}));
router.post("/flutterwave/split-payments/:paymentId/refunds",run(async(req,res) => {
  requireSplitDevelopment(); const c = assertRoles(req,["PLATFORM_OWNER"]);
  const input = z.object({amountMinor:z.number().int().min(10000).max(500000),
    reason:z.string().trim().min(10).max(300),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{8,80}$/)}).strict().parse(req.body);
  res.json(await requestSplitRefund(id(req.params.paymentId),c.user.id,input));
}));
router.post("/flutterwave/split-adjustments/:adjustmentId/verify",run(async(req,res) => {
  requireSplitDevelopment(); assertRoles(req,["PLATFORM_OWNER"]);
  res.json(await verifySplitRefund(id(req.params.adjustmentId)));
}));
// Split-bound commissions are never released into the separate manual Partner payout path.
router.patch("/platform/partner-commissions/:commissionId/status",requireAuthentication(),(req,res,next) => {
  if (!isSplitDevelopment()) return next();
  void (async() => {
    assertRoles(req,["PLATFORM_OWNER"]);
    const bound = (await pool.query(
      `SELECT 1 FROM commission_ledger l JOIN flutterwave_split_payments s ON s.subscription_id=l.subscription_id
       AND s.partner_profile_id=l.partner_profile_id AND s.session_id=l.academic_session_id
       JOIN academic_terms t ON t.id=s.term_id AND t.name=l.term WHERE l.id=$1`, [id(req.params.commissionId)],
    )).rows[0];
    if (bound) throw new AuthError(409,"Commission belongs to a provider split; review its settlement/recovery instead of paying it again");
    next();
  })().catch(next);
});
export default router;
