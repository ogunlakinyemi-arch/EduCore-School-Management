import { randomUUID, createHash } from "node:crypto";
import type { DatabasePoolClient as PoolClient } from "@workspace/db";
import { pool } from "@workspace/db";
import { AuthError, type UserContext } from "../middlewares/auth";
import { createEmailProvider } from "./communication-providers";
import { logger } from "../lib/logger";
import { z } from "zod";

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
export const applicationInput = z.object({
  applicantType: z.enum(["SCHOOL_ADMIN", "PARTNER"]),
  firstName: text(100), lastName: text(100), phone: text(32, 7),
  city: text(100, 2), state: text(100, 2), schoolName: text(200, 2).optional(),
  businessName: text(200).optional(), address: text(500).optional(),
  referralToken: text(256, 16).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.applicantType === "SCHOOL_ADMIN" && !v.schoolName) ctx.addIssue({ code: "custom", path: ["schoolName"], message: "School name is required" });
  if (v.applicantType !== "SCHOOL_ADMIN" && v.referralToken) ctx.addIssue({ code: "custom", path: ["referralToken"], message: "School referrals apply only to school applicants" });
});
export const applicationDecision = z.object({
  status: z.enum(["APPROVED", "REJECTED"]), reason: text(1000).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.status === "REJECTED" && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "A rejection reason is required" });
  if (v.status === "APPROVED" && v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Approval cannot include a rejection reason" });
});

export const applicationFields = `a.id,a.applicant_type AS "applicantType",
 a.first_name AS "firstName",a.last_name AS "lastName",a.email,a.phone,a.city,a.state,
 a.school_name AS "schoolName",a.business_name AS "businessName",a.address,a.status,
 a.created_at AS "createdAt",a.reviewed_at AS "reviewedAt",
 NULLIF(trim(concat_ws(' ',reviewer.first_name,reviewer.last_name)),'') AS "reviewerName",
 a.rejection_reason AS "rejectionReason",a.notification_status AS "notificationStatus"`;
export const applicationJoin = `FROM account_applications a LEFT JOIN app_users reviewer ON reviewer.id=a.reviewed_by`;

async function audit(client: PoolClient, actor: UserContext, id: number, action: string, metadata: object) {
  await client.query(`INSERT INTO audit_logs
    ("user",role,actor_user_id,clerk_user_id,action,module,record_id,severity,event_type,result,metadata)
    VALUES($1,$2,$3,$4,$5,'Account Applications',$6,'info','ACCOUNT_APPLICATION','SUCCESS',$7::jsonb)`,
  [actor.user.email, actor.roles.some(r => r.role === "PLATFORM_OWNER") ? "PLATFORM_OWNER" : "APPLICANT",
    actor.user.id, actor.user.clerkUserId, action, id, JSON.stringify(metadata)]);
}

export async function assertNewApplicant(client: PoolClient, userId: number) {
  // Lock identity, not just the absent application, to serialize two first submissions.
  await client.query(`SELECT id FROM app_users WHERE id=$1 FOR UPDATE`, [userId]);
  const existing = await client.query(`SELECT 1 FROM school_memberships WHERE user_id=$1
    UNION ALL SELECT 1 FROM partner_profiles WHERE user_id=$1
    UNION ALL SELECT 1 FROM employees WHERE user_id=$1
    UNION ALL SELECT 1 FROM students WHERE user_id=$1
    UNION ALL SELECT 1 FROM parents WHERE user_id=$1
    UNION ALL SELECT 1 FROM platform_company_employees p JOIN app_users u ON lower(u.email)=lower(p.email)
      WHERE u.id=$1`, [userId]);
  if (existing.rows.length) throw new AuthError(409, "Existing users cannot apply for a new role through public registration");
}

export async function submitApplication(actor: UserContext, input: z.infer<typeof applicationInput>, verifiedEmail: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assertNewApplicant(client, actor.user.id);
    const duplicate = await client.query(`SELECT 1 FROM account_applications WHERE user_id=$1 OR lower(email)=lower($2)`, [actor.user.id, verifiedEmail]);
    if (duplicate.rows.length) throw new AuthError(409, "An application already exists for this account or email");
    const owned = await client.query(`SELECT 1 FROM app_users WHERE id<>$1 AND lower(email)=lower($2)
      UNION ALL SELECT 1 FROM employees WHERE lower(email)=lower($2)
      UNION ALL SELECT 1 FROM partner_profiles WHERE lower(email)=lower($2)`, [actor.user.id, verifiedEmail]);
    if (owned.rows.length) throw new AuthError(409, "This email is already associated with an existing account; contact your administrator");
    let referralId: number | null = null;
    if (input.referralToken) {
      const link = await client.query(`SELECT l.id FROM partner_referral_links l
        JOIN partner_profiles p ON p.id=l.partner_profile_id
        WHERE l.token_hash=$1 AND l.status='ACTIVE' AND p.status='ACTIVE' FOR SHARE OF l,p`,
      [createHash("sha256").update(input.referralToken).digest("hex")]);
      if (!link.rows[0]) throw new AuthError(400, "Invalid or inactive school referral");
      referralId = link.rows[0].id;
    }
    const result = await client.query(`INSERT INTO account_applications
      (user_id,applicant_type,first_name,last_name,email,phone,city,state,school_name,business_name,address,referral_link_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [actor.user.id,input.applicantType,input.firstName,input.lastName,verifiedEmail,input.phone,input.city,input.state,
      input.schoolName ?? null,input.businessName ?? null,input.address ?? null,referralId]);
    await audit(client, actor, result.rows[0].id, "Submitted account application", { applicantType: input.applicantType, status: "PENDING" });
    await client.query("COMMIT");
    return result.rows[0].id as number;
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") throw new AuthError(409, "An application already exists for this account or email");
    throw error;
  } finally { client.release(); }
}

export async function decideApplication(actor: UserContext, id: number, decision: z.infer<typeof applicationDecision>) {
  if (!actor.roles.some(r => r.role === "PLATFORM_OWNER" && r.schoolId === null && r.status === "ACTIVE")) {
    throw new AuthError(403, "Platform Owner access is required");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT * FROM account_applications WHERE id=$1 FOR UPDATE`, [id]);
    const a = found.rows[0];
    if (!a) throw new AuthError(404, "Application not found");
    if (a.status !== "PENDING") throw new AuthError(409, "Application has already been decided");
    if (a.user_id === actor.user.id) throw new AuthError(403, "You cannot review your own application");
    await assertNewApplicant(client, a.user_id);
    let schoolId: number | null = null, partnerId: number | null = null;
    if (decision.status === "APPROVED") {
      const account = await client.query(`SELECT status FROM app_users WHERE id=$1`, [a.user_id]);
      if (account.rows[0]?.status !== "ACTIVE") throw new AuthError(409, "Applicant account is inactive; approval cannot restore it");
      if (a.applicant_type === "SCHOOL_ADMIN") {
        const school = await client.query(`INSERT INTO schools(code,name,city,state,status,address,phone,email)
          VALUES($1,$2,$3,$4,'active',$5,$6,$7) RETURNING id`,
        [`APP-${randomUUID()}`,a.school_name,a.city,a.state,a.address,a.phone,a.email]);
        schoolId = school.rows[0].id;
        if (a.referral_link_id) {
          const referral = await client.query(`SELECT l.partner_profile_id FROM partner_referral_links l
            JOIN partner_profiles p ON p.id=l.partner_profile_id WHERE l.id=$1 AND l.status='ACTIVE'
            AND p.status='ACTIVE' FOR SHARE OF l,p`, [a.referral_link_id]);
          if (!referral.rows[0]) throw new AuthError(409, "School referral is no longer active; review before approval");
          await client.query(`INSERT INTO school_partner_attributions
            (school_id,partner_profile_id,referral_link_id,source,status,is_current,created_by)
            VALUES($1,$2,$3,'PARTNER_DIRECT','ACTIVE',true,$4)`,
          [schoolId,referral.rows[0].partner_profile_id,a.referral_link_id,actor.user.id]);
        }
      } else {
        const profile = await client.query(`INSERT INTO partner_profiles
          (user_id,partner_code,type,full_name,business_name,email,phone,address,state,status,registered_at,activated_at,created_by)
          VALUES($1,$2,'RESELLER',$3,$4,$5,$6,$7,$8,'ACTIVE',NOW(),NOW(),$9) RETURNING id`,
        [a.user_id,`APP-${randomUUID()}`,`${a.first_name} ${a.last_name}`,a.business_name,a.email,a.phone,a.address,a.state,actor.user.id]);
        partnerId = profile.rows[0].id;
        await client.query(`INSERT INTO partner_profile_users(partner_profile_id,user_id,role,status)
          VALUES($1,$2,'PARTNER','ACTIVE')`, [partnerId,a.user_id]);
      }
      await client.query(`INSERT INTO school_memberships(user_id,school_id,role,status) VALUES($1,$2,$3,'ACTIVE')`,
      [a.user_id,schoolId,a.applicant_type]);
    }
    await client.query(`UPDATE account_applications SET status=$2,reviewed_at=NOW(),reviewed_by=$3,
      rejection_reason=$4,school_id=$5,partner_profile_id=$6 WHERE id=$1`,
    [id,decision.status,actor.user.id,decision.status === "REJECTED" ? decision.reason : null,schoolId,partnerId]);
    await audit(client, actor, id, `${decision.status === "APPROVED" ? "Approved" : "Rejected"} account application`,
      { previousStatus: "PENDING", status: decision.status, reason: decision.reason ?? null, schoolId, partnerProfileId: partnerId });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function notifyApplicationDecision(actor: UserContext, id: number) {
  // A committed decision is never undone because email failed. A claim prevents duplicate sends.
  const claim = await pool.query(`UPDATE account_applications SET notification_status='SENDING'
    WHERE id=$1 AND status IN ('APPROVED','REJECTED') AND notification_status='NOT_REQUESTED' RETURNING *`, [id]);
  const a = claim.rows[0];
  if (!a) return;
  let status = "UNAVAILABLE";
  let sendAttempted = false;
  try {
    const provider = createEmailProvider();
    if (["resend", "http-email"].includes(provider.provider)) {
      const approved = a.status === "APPROVED";
      const body = approved
        ? `Your Yetenia EduCore ${a.applicant_type === "PARTNER" ? "Partner" : "School Admin"} application has been approved. You can now log in with your registered account to access your dashboard.`
        : `Your Yetenia EduCore application was not approved. Reason: ${a.rejection_reason}. This decision does not grant portal access.`;
      sendAttempted = true;
      const result = await provider.send({ to: a.email,
        subject: `Yetenia EduCore application ${approved ? "approved" : "not approved"}`,
        body, idempotencyKey: `account-application-${id}-${a.status}` });
      status = result.accepted && result.status !== "SIMULATED" ? "ACCEPTED"
        : result.failure?.retryable ? "UNKNOWN" : "FAILED";
    }
  } catch {
    status = sendAttempted ? "UNKNOWN" : "UNAVAILABLE";
    logger.warn({ applicationId: id }, "Application decision email could not be confirmed");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE account_applications SET notification_status=$2 WHERE id=$1 AND notification_status='SENDING'`, [id,status]);
    await audit(client,actor,id,"Recorded application decision email status",{ notificationStatus:status });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
