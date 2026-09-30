import { Router, type NextFunction, type Request } from "express";
import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { AuthError, getUserContext, requireAuthentication } from "../middlewares/auth";

const router = Router();
router.use(requireAuthentication());

const run = (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: NextFunction) => handler(req, res).catch(next);

/**
 * The global COMPANY_ACCOUNTANT role is deliberately checked here rather than
 * sharing school finance authorization. Every request also rechecks the live
 * employee profile, app account and absence of unrelated memberships.
 */
async function requireCompanyAccountant(req: Request) {
  const context = getUserContext(req);
  const isAccountant = context.roles.some((assignment) =>
    String(assignment.role) === "COMPANY_ACCOUNTANT" &&
    assignment.schoolId === null &&
    assignment.status === "ACTIVE",
  );
  if (!isAccountant) throw new AuthError(403, "Company Accountant access is required");

  let clerkUser: Awaited<ReturnType<typeof clerkClient.users.getUser>>;
  try {
    clerkUser = await clerkClient.users.getUser(context.user.clerkUserId);
  } catch {
    throw new AuthError(503, "Company Accountant access cannot be verified while Clerk is unavailable");
  }
  const primaryEmail = clerkUser.primaryEmailAddress;
  const clerkEmail = primaryEmail?.emailAddress.trim().toLowerCase();
  if (!clerkEmail || primaryEmail?.verification?.status !== "verified" ||
      clerkEmail !== context.user.email.trim().toLowerCase()) {
    throw new AuthError(403, "A matching verified Clerk primary email is required for Company Accountant access");
  }

  const eligible = await pool.query(
    `SELECT 1
     FROM app_users au
     JOIN platform_company_employees pce ON lower(pce.email)=lower(au.email)
     WHERE au.id=$1 AND au.clerk_user_id=$2 AND au.status='ACTIVE'
        AND lower(au.email)=lower($3) AND lower(pce.email)=lower($3) AND pce.status='ACTIVE'
       AND EXISTS (
         SELECT 1 FROM school_memberships role
         WHERE role.user_id=au.id AND role.school_id IS NULL
           AND role.role='COMPANY_ACCOUNTANT' AND role.status='ACTIVE'
       )
       AND NOT EXISTS (
         SELECT 1 FROM school_memberships other
         WHERE other.user_id=au.id AND other.status='ACTIVE'
           AND (other.role<>'COMPANY_ACCOUNTANT' OR other.school_id IS NOT NULL)
       )
     LIMIT 1`,
    [context.user.id, context.user.clerkUserId, clerkEmail],
  );
  if (!eligible.rows[0]) throw new AuthError(403, "Company Accountant access is not active for this employee account");
}

router.get("/company/accountant/overview", run(async (req, res) => {
  await requireCompanyAccountant(req);
  const [subscriptions, commissions, payouts] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE lower(verification_status)='verified')::int AS "verifiedSubscriptionCount",
          COALESCE(SUM(amount) FILTER (WHERE lower(verification_status)='verified'),0)::text AS "verifiedRevenue",
          COALESCE(SUM(edupulse_share) FILTER (WHERE lower(verification_status)='verified'),0)::text AS "verifiedEduPulseShare",
          COUNT(*) FILTER (WHERE lower(verification_status)<>'verified')::int AS "unverifiedSubscriptionCount",
          COUNT(*) FILTER (WHERE lower(verification_status)='verified' AND lower(status)='active')::int AS "activeVerifiedCount"
       FROM subscriptions`,
    ),
    pool.query(
      `SELECT status,currency,COUNT(*)::int AS count,COALESCE(SUM(amount),0)::text AS amount
       FROM commission_ledger GROUP BY status,currency ORDER BY currency,status`,
    ),
    pool.query(
      `SELECT status,currency,COUNT(*)::int AS count,COALESCE(SUM(amount),0)::text AS amount
       FROM partner_payouts GROUP BY status,currency ORDER BY currency,status`,
    ),
  ]);
  res.json({
    subscriptions: subscriptions.rows[0],
    commissions: commissions.rows,
    payouts: payouts.rows,
  });
}));

router.get("/company/accountant/subscriptions", run(async (req, res) => {
  await requireCompanyAccountant(req);
  const result = await pool.query(
    `SELECT id,term,amount::text,edupulse_share::text AS "edupulseShare",
        provider,provider_reference AS "providerReference",status,
        verification_status AS "verificationStatus",
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
     FROM subscriptions
     ORDER BY created_at DESC,id DESC
     LIMIT 500`,
  );
  res.json(result.rows);
}));

router.get("/company/accountant/reconciliation", run(async (req, res) => {
  await requireCompanyAccountant(req);
  const result = await pool.query(
    `SELECT id,term,amount::text,provider,provider_reference AS "providerReference",
        status,verification_status AS "verificationStatus",
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
     FROM subscriptions
     WHERE lower(verification_status) NOT IN ('verified','reconciled')
     ORDER BY created_at DESC,id DESC
     LIMIT 500`,
  );
  res.json(result.rows);
}));

router.get("/company/accountant/commissions", run(async (req, res) => {
  await requireCompanyAccountant(req);
  const result = await pool.query(
    `SELECT l.id,p.partner_code AS "partnerCode",p.business_name AS "partnerName",
        l.term,l.amount::text,l.currency,l.status,
        l.payment_reference AS "paymentReference",
        to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
        CASE WHEN l.paid_at IS NULL THEN NULL
          ELSE to_char(l.paid_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "paidAt"
     FROM commission_ledger l
     JOIN partner_profiles p ON p.id=l.partner_profile_id
     ORDER BY l.created_at DESC,l.id DESC
     LIMIT 500`,
  );
  res.json(result.rows);
}));

router.get("/company/accountant/payouts", run(async (req, res) => {
  await requireCompanyAccountant(req);
  const result = await pool.query(
    `SELECT po.id,p.partner_code AS "partnerCode",p.business_name AS "partnerName",
        po.amount::text,po.currency,po.status,po.payment_reference AS "paymentReference",
        po.period_start AS "periodStart",po.period_end AS "periodEnd",
        CASE WHEN po.paid_at IS NULL THEN NULL
          ELSE to_char(po.paid_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "paidAt",
        to_char(po.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
     FROM partner_payouts po
     JOIN partner_profiles p ON p.id=po.partner_profile_id
     ORDER BY po.created_at DESC,po.id DESC
     LIMIT 500`,
  );
  res.json(result.rows);
}));

export default router;