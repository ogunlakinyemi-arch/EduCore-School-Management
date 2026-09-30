import { Router, type NextFunction, type Request } from "express";
import crypto from "node:crypto";
import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { commitInvitationWithRecovery } from "./partner-commit-recovery";
import { invitationRedirect } from "./invitation-redirect";
import {
  AuthError,
  assertRoles,
  getUserContext,
  requireAuthentication,
} from "../middlewares/auth";

export const publicPartnersRouter = Router();
const router = Router();
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const normalizedEmail = (value: string) => value.trim().toLowerCase();
const idOf = (value: unknown, label = "Resource") => {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new AuthError(404, `${label} not found`);
  return id;
};
const minorUnitsOf = (value: unknown) => {
  const decimal = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : typeof value === "string" ? value.trim() : "";
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(decimal);
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
};
const decimalOfMinorUnits = (value: bigint) =>
  `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
const maxPayoutSubsetEntries = 256;
const maxPayoutSubsetSearchSteps = 100_000;
function oldestExactPayoutSubset(
  entries: Array<{ id: number; amount: bigint }>,
  target: bigint,
) {
  const candidates = entries.filter((entry) => entry.amount <= target);
  if (candidates.length > maxPayoutSubsetEntries) {
    throw new AuthError(409, "Too many payable entries for safe payout selection; reduce the payable set and retry");
  }
  const suffixTotals = Array<bigint>(candidates.length + 1).fill(0n);
  for (let index = candidates.length - 1; index >= 0; index--) {
    suffixTotals[index] = suffixTotals[index + 1] + candidates[index].amount;
  }
  const selected: number[] = [];
  let result: number[] | null = null;
  let searchSteps = 0;
  const search = (index: number, sum: bigint): boolean => {
    if (++searchSteps > maxPayoutSubsetSearchSteps) {
      throw new AuthError(409, "Payout selection exceeded the safe search limit; narrow the payable set and retry");
    }
    if (sum === target) {
      result = [...selected];
      return true;
    }
    if (sum > target || index === candidates.length || sum + suffixTotals[index] < target) return false;

    // Include earlier payable entries first, but backtrack and skip entries when needed.
    selected.push(candidates[index].id);
    if (search(index + 1, sum + candidates[index].amount)) return true;
    selected.pop();
    return search(index + 1, sum);
  };
  search(0, 0n);
  return result;
}
const run = (fn: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: NextFunction) => fn(req, res).catch(next);
const currentPayoutKeyVersion = () =>
  process.env.PAYOUT_ENCRYPTION_KEY
    ? process.env.PAYOUT_ENCRYPTION_KEY_VERSION || "payout-v1"
    : "session-hkdf-v1";
const key = (version: string) => {
  let keyring: Record<string, string> = {};
  if (process.env.PAYOUT_ENCRYPTION_KEYS) {
    try { keyring = JSON.parse(process.env.PAYOUT_ENCRYPTION_KEYS); } catch { throw new Error("PAYOUT_ENCRYPTION_KEYS must be valid JSON"); }
  }
  const secret = keyring[version] ??
    (version === (process.env.PAYOUT_ENCRYPTION_KEY_VERSION || "payout-v1")
      ? process.env.PAYOUT_ENCRYPTION_KEY
      : undefined) ??
    (version === "v1" || version === "session-hkdf-v1" ? process.env.SESSION_SECRET : undefined);
  if (!secret) throw new Error(`Encryption key ${version} is not configured`);
  return Buffer.from(crypto.hkdfSync(
    "sha256",
    secret,
    Buffer.alloc(0),
    `edupulse-partner-payout-encryption-${version === "session-hkdf-v1" ? "v1" : version}`,
    32,
  ));
};
const encrypt = (value: string, version = currentPayoutKeyVersion()) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(version), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, body, cipher.getAuthTag()].map((v) => v.toString("base64")).join(".");
};
const decrypt = (value: string, version: string) => {
  const [iv, body, tag] = value.split(".").map((part) => Buffer.from(part, "base64"));
  if (!iv || !body || !tag) throw new Error("Invalid encrypted payout value");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(version), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
};
const mask = (value: string | null) => value ? `****${value.slice(-4)}` : null;
const partnerFields = `
 p.id, p.partner_code AS "partnerCode", p.type AS "partnerType", p.full_name AS "fullName",
 p.business_name AS "businessName", p.email, p.phone, p.address, p.state, p.lga, p.status,
 u.clerk_user_id AS "clerkUserId", p.user_id AS "userId", p.registered_at AS "registrationDate",
 p.activated_at AS "activationDate", p.deactivated_at AS "deactivationDate",
 p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;
const schoolFields = `s.id AS "schoolId", s.name AS "schoolName", s.code AS "schoolCode",
 a.status AS "attributionStatus", a.source AS "attributionSource", a.referral_link_id AS "referralLinkId",
 a.starts_at AS "startDate", a.ends_at AS "endDate",
 (SELECT COUNT(*)::int FROM students st WHERE st.school_id=s.id AND upper(st.status)='ACTIVE') AS "eligibleStudentCount"`;
const commissionFields = `l.id,l.partner_profile_id AS "partnerId",l.school_id AS "schoolId",
 l.student_id AS "studentId",l.subscription_id AS "subscriptionId",l.term,
 l.commission_rule_id AS "commissionRuleId",l.rate::float,1 AS "eligibleStudentCount",
 l.amount::float,l.currency,l.status,l.created_at AS "generatedAt",l.approved_at AS "approvedAt",
 l.payable_at AS "payableAt",l.paid_at AS "paidAt",l.payment_reference AS "paymentReference"`;

function profileFromRow(row: any) {
  if (!row || row.status !== "ACTIVE") throw new AuthError(403, "Partner account is not active");
  return row;
}
async function self(req: Request) {
  const c = getUserContext(req);
  const r = await pool.query(`SELECT ${partnerFields},
      (p.user_id=$1) AS "isOwner",
      CASE WHEN p.user_id=$1 THEN 'PARTNER_OWNER' ELSE pu.role END AS "partnerRole"
    FROM partner_profiles p
    LEFT JOIN app_users u ON u.id=p.user_id
    LEFT JOIN LATERAL (SELECT role FROM partner_profile_users
      WHERE partner_profile_id=p.id AND user_id=$1 AND status='ACTIVE' LIMIT 1) pu ON true
    WHERE p.user_id=$1 OR EXISTS (SELECT 1 FROM partner_profile_users pu
      WHERE pu.partner_profile_id=p.id AND pu.user_id=$1 AND pu.status='ACTIVE')
    ORDER BY p.id LIMIT 1`, [c.user.id]);
  return profileFromRow(r.rows[0]);
}
function requirePartnerOwner(req: Request, partner: any) {
  if (!partner.isOwner && !["PARTNER_OWNER", "PARTNER_ADMIN"].includes(partner.partnerRole)) {
    throw new AuthError(403, "Partner owner permission is required");
  }
}
function requirePartnerFinanceAccess(partner: any) {
  if (!partner.isOwner && !["PARTNER_ADMIN", "PARTNER_FINANCE"].includes(partner.partnerRole)) {
    throw new AuthError(403, "Partner finance permission is required");
  }
}
function invitationRedirectUrl(token: string) {
  return invitationRedirect(`/accept-invitation?partnerInvitation=${encodeURIComponent(token)}`);
}
const validEmail = (email: string) =>
  email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
function clerkInvitationFailure(error: unknown, failureMessage: string) {
  const status = (error as { status?: number; statusCode?: number } | null)?.status ??
    (error as { statusCode?: number } | null)?.statusCode;
  if (status === 409 || status === 422) {
    return new AuthError(409, "This email already has an EduCore account or a pending invitation.");
  }
  if (status === 429) {
    return new AuthError(429 as any, failureMessage, "INVITATION_PROVIDER_RATE_LIMITED");
  }
  if (typeof status === "number" && status >= 400 && status < 500) {
    return new AuthError(status as any, failureMessage, "INVITATION_PROVIDER_REJECTED");
  }
  return new AuthError(
    503,
    `${failureMessage} Clerk did not confirm whether the request was accepted; check before retrying.`,
    "INVITATION_DELIVERY_UNCERTAIN",
  );
}
async function audit(
  req: Request,
  action: string,
  module: string,
  recordId: number | null,
  metadata: any = null,
  db: { query: (text: string, values?: any[]) => Promise<any> } = pool,
) {
  const c = getUserContext(req);
  await db.query(`INSERT INTO audit_logs ("user",role,actor_user_id,clerk_user_id,action,module,record_id,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [c.user.email, c.roles[0]?.role ?? "AUTHENTICATED", c.user.id, c.user.clerkUserId, action, module, recordId, metadata]);
}
async function knownClerkInvitationIds(
  db: { query: (text: string, values?: any[]) => Promise<any> },
  invitationIds: number[],
) : Promise<string[]> {
  if (!invitationIds.length) return [];
  const known = await db.query(
    `SELECT DISTINCT metadata->>'clerkInvitationId' AS "clerkInvitationId"
     FROM audit_logs WHERE module='Partners' AND record_id=ANY($1::int[])
       AND metadata ? 'clerkInvitationId'`,
    [invitationIds],
  );
  const ids = known.rows.map((row: any) => row.clerkInvitationId)
    .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
  return Array.from(new Set<string>(ids));
}
async function reconcileClerkInvitationAttempt(email: string, partnerInvitationId: number, attemptId: string) {
  const statuses = ["pending", "accepted", "revoked", "expired"] as const;
  const matches: any[] = [];
  for (const status of statuses) {
    let offset = 0;
    let totalCount: number | null = null;
    while (totalCount === null || offset < totalCount) {
      const response = await clerkClient.invitations.getInvitationList({
        query: email, status, limit: 100, offset,
      });
      if (!Array.isArray(response.data) || !Number.isInteger(response.totalCount) ||
          response.totalCount < 0) {
        throw new Error("Clerk returned incomplete invitation pagination data");
      }
      totalCount = response.totalCount;
      for (const invitation of response.data as any[]) {
        const marker = invitation.publicMetadata?.edupulsePartnerInvitation;
        if (normalizedEmail(invitation.emailAddress) === email &&
            marker?.attemptId === attemptId &&
            Number(marker?.partnerInvitationId) === partnerInvitationId) {
          matches.push(invitation);
        }
      }
      if (response.data.length === 0 && offset < totalCount) {
        throw new Error("Clerk invitation list pagination ended before all results were read");
      }
      offset += response.data.length;
    }
  }
  if (!matches.length) return { state: "ABSENT" as const, invitation: null };
  if (matches.length !== 1) return { state: "AMBIGUOUS" as const, invitation: null };
  const invitation = matches[0];
  if (invitation.status === "pending" && !invitation.revoked) {
    return { state: "PENDING" as const, invitation };
  }
  if (invitation.status === "revoked" || invitation.status === "expired" || invitation.revoked) {
    return { state: "TERMINAL" as const, invitation };
  }
  return { state: "ACCEPTED" as const, invitation };
}
async function finalizePartnerInvitationResend(
  req: Request,
  details: {
    partnerId: number;
    email: string;
    invitation: any;
    clerkInvitationId: string;
    attemptId: string;
    priorClerkInvitationIds: string[];
    recovered?: boolean;
  },
) {
  const client = await pool.connect();
  let committed = false;
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    const partner = await client.query(`SELECT status,user_id AS "userId"
      FROM partner_profiles WHERE id=$1 FOR UPDATE`, [details.partnerId]);
    if (!partner.rows[0] || partner.rows[0].status !== "INVITED" || partner.rows[0].userId) {
      throw new AuthError(409, "The partner invitation was accepted or changed before this resend could be finalized");
    }
    const current = await client.query(`SELECT id,status FROM partner_invitations
      WHERE id=$1 AND partner_profile_id=$2 AND status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE') FOR UPDATE`,
      [details.invitation.id, details.partnerId]);
    if (!current.rows[0]) {
      const alreadyCommitted = await client.query(`SELECT 1 FROM partner_invitations i
        JOIN audit_logs a ON a.module='Partners' AND a.record_id=i.id
        WHERE i.id=$1 AND i.status='ACTIVE' AND a.metadata->>'attemptId'=$2
          AND a.metadata->>'clerkInvitationId'=$3 LIMIT 1`,
        [details.invitation.id, details.attemptId, details.clerkInvitationId]);
      if (!alreadyCommitted.rows[0]) throw new AuthError(503,
        "Invitation recovery is required before finalizing this resend", "INVITATION_RECOVERY_REQUIRED");
      await client.query("COMMIT");
      committed = true;
      return {
        id: details.invitation.id, partnerId: details.partnerId, email: details.email,
        status: "PENDING", invitationDispatchStatus: "REQUEST_ACCEPTED",
        invitationDeliveryStatus: "UNVERIFIED", expiresAt: details.invitation.expiresAt,
        createdAt: details.invitation.createdAt,
      };
    }
    const supersededIds = await supersedePartnerInvitations(client, details.partnerId);
    await client.query(`UPDATE partner_invitations SET status='ACTIVE' WHERE id=$1
      AND status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')`, [details.invitation.id]);
    await audit(req, details.recovered ? "Recovered partner invitation resend" : "Resent partner invitation",
      "Partners", details.invitation.id, {
        partnerId: details.partnerId, invitedEmail: details.email,
        clerkInvitationId: details.clerkInvitationId, attemptId: details.attemptId,
        recoveryStatus: details.recovered ? "RECONCILED_FROM_CLERK_METADATA" : undefined,
        supersededInvitationIds: supersededIds,
      }, client);
    commitAttempted = true;
    const resolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM partner_invitations WHERE id=$1 AND status='ACTIVE'`, [details.invitation.id],
      )).rows[0]),
      revokeInvitation: () => clerkClient.invitations.revokeInvitation(details.clerkInvitationId),
    });
    if (resolution !== "COMMITTED") throw new AuthError(503,
      resolution === "UNKNOWN" ? "Invitation finalization status is uncertain; recovery is required before retrying" :
        "Partner invitation could not be finalized; please retry");
    committed = true;
    await revokeClerkInvitations(details.priorClerkInvitationIds, "replacement");
    return {
      id: details.invitation.id, partnerId: details.partnerId, email: details.email,
      status: "PENDING", invitationDispatchStatus: "REQUEST_ACCEPTED",
      invitationDeliveryStatus: "UNVERIFIED", expiresAt: details.invitation.expiresAt,
      createdAt: details.invitation.createdAt,
    };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    let providerInvitationRevoked = false;
    if (!committed && !commitAttempted) {
      try {
        await clerkClient.invitations.revokeInvitation(details.clerkInvitationId);
        providerInvitationRevoked = true;
      } catch {
        // Keep the durable attempt recoverable if the provider did not confirm revocation.
      }
    }
    if (!committed) {
      const recoveryStatus = providerInvitationRevoked ? "FAILED" : "UNKNOWN_PROVIDER_STATE";
      await pool.query(`UPDATE partner_invitations SET status=$2,revoked_at=CASE WHEN $2='FAILED' THEN NOW() ELSE revoked_at END
        WHERE id=$1 AND status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')`,
        [details.invitation.id, recoveryStatus]).catch(() => undefined);
      await audit(req, "Partner invitation finalization requires recovery", "Partners", details.invitation.id,
        { partnerId: details.partnerId, invitedEmail: details.email, attemptId: details.attemptId,
          clerkInvitationId: details.clerkInvitationId, dispatchStatus: recoveryStatus }, pool).catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}
async function revokeClerkInvitations(ids: string[], operation: "replacement" | "email correction" | "revocation") {
  const failures: string[] = [];
  for (const id of ids) {
    try {
      await clerkClient.invitations.revokeInvitation(id);
    } catch {
      failures.push(id);
    }
  }
  if (failures.length) {
    const nextStep = operation === "replacement"
      ? "The replacement is committed and the old local token is invalidated; retry the replacement or have a Platform Owner revoke the prior Clerk invitation."
      : operation === "email correction"
        ? "The corrected email and local token invalidation are committed; resend the corrected invitation and have a Platform Owner revoke the prior Clerk invitation."
        : "The local invitation is revoked; have a Platform Owner retry Clerk revocation.";
    throw new AuthError(503, `${nextStep} Clerk revocation requires recovery.`, "INVITATION_RECOVERY_REQUIRED");
  }
}
async function supersedePartnerInvitations(
  db: { query: (text: string, values?: any[]) => Promise<any> },
  partnerId: number,
) {
  const current = await db.query(
    `SELECT id FROM partner_invitations
     WHERE partner_profile_id=$1 AND status='ACTIVE' FOR UPDATE`,
    [partnerId],
  );
  const ids = current.rows.map((row: any) => Number(row.id)).filter(Number.isInteger);
  if (ids.length) {
    await db.query(`UPDATE partner_invitations SET status='REVOKED',revoked_at=NOW()
      WHERE id=ANY($1::int[]) AND status='ACTIVE'`, [ids]);
  }
  return ids;
}
function referralToken(partnerId: number, code: string) {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required");
  return crypto.createHmac("sha256", process.env.SESSION_SECRET)
    .update(`edupulse-referral:${partnerId}:${code}`).digest("base64url");
}
async function partnerLink(req: Request, p: any) {
  const token = referralToken(p.id, p.partnerCode);
  const h = hash(token);
  const existing = await pool.query(`SELECT id,created_at AS "createdAt",status FROM partner_referral_links WHERE token_hash=$1`, [h]);
  if (existing.rows[0]) return { id: existing.rows[0].id, url: `/school/register?ref=${token}`, status: existing.rows[0].status, createdAt: existing.rows[0].createdAt };
  const created = await pool.query(`INSERT INTO partner_referral_links(partner_profile_id,token_hash,status,created_by)
    VALUES($1,$2,'ACTIVE',$3) RETURNING id,created_at AS "createdAt",status`, [p.id, h, getUserContext(req).user.id]);
  return { id: created.rows[0].id, url: `/school/register?ref=${token}`, status: "ACTIVE", createdAt: created.rows[0].createdAt };
}

// Referral validation and school onboarding intentionally precede authentication: possession of
// the high-entropy referral token is the authorization for this public registration flow.
publicPartnersRouter.post("/partner/referrals/validate", run(async (req, res) => {
  const token = req.body?.referralToken;
  if (typeof token !== "string" || token.length < 32) throw new AuthError(400, "A valid referral token is required");
  const r = await pool.query(`SELECT l.id,l.status,p.partner_code AS "partnerCode",p.status AS "partnerStatus"
    FROM partner_referral_links l JOIN partner_profiles p ON p.id=l.partner_profile_id WHERE l.token_hash=$1`, [hash(token)]);
  const row = r.rows[0];
  const valid = !!row && row.status === "ACTIVE" && row.partnerStatus === "ACTIVE";
  res.json({ valid, status: valid ? "VALID" : row?.status === "REVOKED" ? "REVOKED" : "INVALID",
    partnerCode: valid ? row.partnerCode : null, referralLinkId: valid ? row.id : null });
}));
publicPartnersRouter.post("/partner/onboarding", run(async (req, res) => {
  const token = req.body?.referralToken, s = req.body?.school, administrator = req.body?.administrator;
  const administratorName = typeof administrator?.fullName === "string" ? administrator.fullName.trim() : "";
  const administratorEmail = typeof administrator?.email === "string" ? normalizedEmail(administrator.email) : "";
  if (typeof token !== "string" || token.length < 32 || !s?.code || !s?.name || !s?.city || !s?.state ||
      administratorName.length < 2 || !validEmail(administratorEmail)) {
    throw new AuthError(400, "A valid referral token, complete school, and administrator name and email are required");
  }
  const [firstName, ...lastParts] = administratorName.split(/\s+/);
  const lastName = lastParts.join(" ") || null;
  const claimId = crypto.randomUUID();
  const clerkSecret = process.env.CLERK_SECRET_KEY;
  if (!clerkSecret) throw new AuthError(503, "Administrator invitations are unavailable until Clerk is configured");
  const emailProof = crypto.createHmac("sha256", clerkSecret).update(administratorEmail).digest("hex");
  const client = await pool.connect();
  let clerkInvitationId: string | null = null;
  let committed = false;
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    const identityLocks = [
      `code:${String(s.code).trim().toLowerCase()}`,
      `name:${String(s.name).trim().toLowerCase()}`,
      s.email ? `email:${String(s.email).trim().toLowerCase()}` : null,
      s.registrationNumber ? `registration:${String(s.registrationNumber).trim().toLowerCase()}` : null,
      s.phone ? `phone:${String(s.phone).replace(/\D/g, "")}` : null,
    ].filter((value): value is string => Boolean(value)).sort();
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended(identity,0))
       FROM unnest($1::text[]) AS identities(identity) ORDER BY identity`,
      [[...identityLocks, `admin:${administratorEmail}`].sort()],
    );
    const link = await client.query(`SELECT l.id,l.partner_profile_id FROM partner_referral_links l
      JOIN partner_profiles p ON p.id=l.partner_profile_id
      WHERE l.token_hash=$1 AND l.status='ACTIVE' AND p.status='ACTIVE' FOR UPDATE`, [hash(token)]);
    if (!link.rows[0]) throw new AuthError(400, "Referral token is invalid or revoked");
    const existing = await client.query(`SELECT id FROM schools
      WHERE lower(trim(code))=lower(trim($1))
        OR lower(trim(name))=lower(trim($2))
        OR (email IS NOT NULL AND $3::text IS NOT NULL AND lower(trim(email))=lower(trim($3)))
        OR (registration_number IS NOT NULL AND $4::text IS NOT NULL
            AND lower(trim(registration_number))=lower(trim($4)))
        OR (phone IS NOT NULL AND $5::text IS NOT NULL
            AND regexp_replace(phone,'\\D','','g')=regexp_replace($5,'\\D','','g'))`,
      [s.code, s.name, s.email ?? null, s.registrationNumber ?? null, s.phone ?? null]);
    if (existing.rows[0]) {
      const current = await client.query(`SELECT partner_profile_id FROM school_partner_attributions
        WHERE school_id=$1 AND is_current=true`, [existing.rows[0].id]);
      const priorConflict = await client.query(`SELECT id FROM partner_attribution_conflicts
        WHERE school_id=$1 AND attempted_partner_profile_id=$2 AND status='OPEN' FOR UPDATE`,
        [existing.rows[0].id, link.rows[0].partner_profile_id]);
      const conflict = priorConflict.rows[0] ? priorConflict : await client.query(`INSERT INTO partner_attribution_conflicts
        (school_id,existing_partner_profile_id,attempted_partner_profile_id,referral_link_id,source,metadata)
        VALUES($1,$2,$3,$4,'REFERRAL_LINK',$5) RETURNING id`, [existing.rows[0].id,
        current.rows[0]?.partner_profile_id ?? null, link.rows[0].partner_profile_id, link.rows[0].id,
        JSON.stringify({ code: s.code })]);
      await client.query("COMMIT");
      res.status(409).json({ error: "School already exists; attribution conflict recorded", conflictId: conflict.rows[0].id });
      return;
    }
    const school = await client.query(`INSERT INTO schools
      (code,name,city,state,registration_number,address,lga,phone,email,website,logo,school_type,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending')
      RETURNING id,code,name,city,state,status,created_at AS "createdAt"`,
      [s.code,s.name,s.city,s.state,s.registrationNumber ?? null,s.address ?? null,s.lga ?? null,s.phone ?? null,
       s.email ?? null,s.website ?? null,s.logoUrl ?? null,s.schoolType ?? null]);
    let clerkInvitation;
    try {
      clerkInvitation = await clerkClient.invitations.createInvitation({
        emailAddress: administratorEmail,
        expiresInDays: 7,
        notify: true,
        ignoreExisting: false,
        redirectUrl: invitationRedirect("/accept-invitation"),
        publicMetadata: {
          edupulseSchoolInvitation: {
            version: 1,
            claimId,
            emailProof,
            schoolId: school.rows[0].id,
            role: "SCHOOL_ADMIN",
            employeeNo: null,
            firstName,
            lastName,
          },
        },
      });
    } catch (error) {
      throw clerkInvitationFailure(error,
        "The administrator invitation could not be sent. No school was created; please retry.");
    }
    clerkInvitationId = clerkInvitation.id;
    await client.query(`INSERT INTO audit_logs
        ("user",role,school_id,action,module,record_id,event_type,metadata)
      VALUES('Referral onboarding','PUBLIC_REFERRAL',$1,'Invited School Administrator','Security',$1,
        'SCHOOL_ADMIN_INVITED',jsonb_build_object(
          'claimId',$2,'invitedEmail',$3,'email',$3,'role','SCHOOL_ADMIN','schoolId',$1,
          'invitationId',$4,'emailProof',$5,'firstName',$6,'lastName',$7))`,
      [school.rows[0].id, claimId, administratorEmail, clerkInvitation.id, emailProof, firstName, lastName]);
    await client.query(`INSERT INTO school_partner_attributions(school_id,partner_profile_id,referral_link_id,source,status,is_current)
      VALUES($1,$2,$3,'REFERRAL','ACTIVE',true)`, [school.rows[0].id, link.rows[0].partner_profile_id, link.rows[0].id]);
    await client.query(`INSERT INTO audit_logs("user",role,school_id,action,module,record_id,event_type,metadata)
      VALUES('Referral onboarding','PUBLIC_REFERRAL',$1,'Created school through partner referral','Partners',$1,
      'PARTNER_SCHOOL_ONBOARDED',jsonb_build_object('partnerProfileId',$2,'referralLinkId',$3,
      'administratorEmail',$4,'administratorInvitationStatus','DISPATCH_REQUESTED','invitationId',$5))`,
      [school.rows[0].id, link.rows[0].partner_profile_id, link.rows[0].id, administratorEmail, clerkInvitation.id]);
    commitAttempted = true;
    const resolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM schools WHERE id=$1`, [school.rows[0].id],
      )).rows[0]),
      revokeInvitation: () => clerkClient.invitations.revokeInvitation(clerkInvitationId!),
    });
    if (resolution !== "COMMITTED") throw new AuthError(503,
      resolution === "UNKNOWN" ? "Onboarding status is uncertain; contact the platform owner before retrying" :
        "School onboarding could not be completed; please retry");
    committed = true;
    res.status(201).json({
      school: school.rows[0],
      attributionStatus: "CREATED",
      administratorInvitation: {
        invitationId: clerkInvitation.id,
        email: administratorEmail,
        status: "DISPATCH_REQUESTED",
        dispatchStatus: "REQUEST_ACCEPTED",
        deliveryStatus: "UNVERIFIED",
        deliveryNote: "Clerk accepted the invitation request; inbox delivery is not verified.",
        expiresInDays: 7,
      },
      conflictId: null,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (clerkInvitationId && !committed && !commitAttempted) {
      await clerkClient.invitations.revokeInvitation(clerkInvitationId).catch(() => undefined);
    }
    throw e;
  } finally { client.release(); }
}));

router.use(requireAuthentication());

router.get("/platform/partners", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const values: any[] = [], where: string[] = [];
  if (req.query.status) { values.push(req.query.status); where.push(`p.status=$${values.length}`); }
  if (req.query.search) { values.push(`%${req.query.search}%`); where.push(`(p.full_name ILIKE $${values.length} OR p.email ILIKE $${values.length} OR p.partner_code ILIKE $${values.length})`); }
  const r = await pool.query(`SELECT ${partnerFields} FROM partner_profiles p LEFT JOIN app_users u ON u.id=p.user_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.created_at DESC`, values);
  res.json(r.rows);
}));
router.get("/platform/partners/invitations", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const filter = typeof req.query.status === "string" ? req.query.status.toUpperCase() : null;
  if (filter && !["PENDING", "ACTIVE", "EXPIRED", "REVOKED"].includes(filter)) {
    throw new AuthError(400, "status must be PENDING, ACTIVE, EXPIRED, or REVOKED");
  }
  const r = await pool.query(`SELECT i.id,i.partner_profile_id AS "partnerId",
      i.invited_email AS email,i.status AS "invitationStatus",p.status AS "partnerStatus",
      i.created_at AS "createdAt",i.expires_at AS "expiresAt",i.redeemed_at AS "redeemedAt",
      CASE WHEN i.status='ACTIVE' AND i.expires_at>NOW() THEN 'PENDING'
           WHEN i.status='ACTIVE' THEN 'EXPIRED'
           WHEN i.status='ACCEPTED' AND p.status='ACTIVE' AND EXISTS (
             SELECT 1 FROM partner_profile_users pu JOIN app_users u ON u.id=pu.user_id
             WHERE pu.partner_profile_id=p.id AND pu.status='ACTIVE'
               AND lower(u.email)=lower(i.invited_email)
               AND (p.user_id IS NULL OR pu.user_id<>p.user_id OR pu.role='PARTNER')
           ) THEN 'ACTIVE'
           WHEN i.status='ACCEPTED' THEN 'ACCEPTED'
           ELSE i.status END AS status
    FROM partner_invitations i JOIN partner_profiles p ON p.id=i.partner_profile_id
    WHERE ($1::text IS NULL OR
      CASE WHEN i.status='ACTIVE' AND i.expires_at>NOW() THEN 'PENDING'
           WHEN i.status='ACTIVE' THEN 'EXPIRED'
           WHEN i.status='ACCEPTED' AND p.status='ACTIVE' AND EXISTS (
             SELECT 1 FROM partner_profile_users pu JOIN app_users u ON u.id=pu.user_id
             WHERE pu.partner_profile_id=p.id AND pu.status='ACTIVE'
               AND lower(u.email)=lower(i.invited_email)
               AND (p.user_id IS NULL OR pu.user_id<>p.user_id OR pu.role='PARTNER')
           ) THEN 'ACTIVE'
           WHEN i.status='ACCEPTED' THEN 'ACCEPTED'
           ELSE i.status END=$1)
    ORDER BY i.created_at DESC`, [filter]);
  res.json(r.rows);
}));
router.post("/platform/partners/invitations", run(async (req, res) => {
  const c = assertRoles(req, ["PLATFORM_OWNER"]);
  const b = req.body ?? {}, email = normalizedEmail(String(b.email ?? "")), fullName = String(b.fullName ?? "").trim();
  if (!email || !email.includes("@") || fullName.length < 2) throw new AuthError(400, "email and fullName are required");
  const token = crypto.randomBytes(32).toString("base64url");
  const client = await pool.connect();
  let clerkInvitationId: string | null = null;
  let committed = false;
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
      [`partner-invitation:${email}`],
    );
    const duplicate = await client.query(
      `SELECT 1 FROM partner_profiles p
       WHERE lower(p.email)=lower($1) AND p.status='INVITED'
       LIMIT 1`,
      [email],
    );
    if (duplicate.rows[0]) {
      throw new AuthError(409, "A pending or expired partner invitation already exists for this email; resend it from the partner directory");
    }
    const p = await client.query(`INSERT INTO partner_profiles(partner_code,type,full_name,business_name,email,phone,status,invited_at,created_by)
      VALUES('PENDING-'||upper(substr(md5(random()::text),1,12)),COALESCE($1,'INDIVIDUAL'),$2,$3,$4,$5,'INVITED',NOW(),$6)
      RETURNING id,partner_code AS "partnerCode",email,status,created_at AS "createdAt"`,
      [b.partnerType ?? "INDIVIDUAL", fullName, b.businessName ?? null, email, b.phone ?? null, c.user.id]);
    const invitation = await client.query(`INSERT INTO partner_invitations(partner_profile_id,invited_email,token_hash,status,expires_at,created_by)
      VALUES($1,$2,$3,'ACTIVE',NOW()+INTERVAL '7 days',$4)
      RETURNING id,expires_at AS "expiresAt",created_at AS "createdAt"`, [p.rows[0].id,email,hash(token),c.user.id]);
    let clerkInvitation;
    try {
      clerkInvitation = await clerkClient.invitations.createInvitation({
        emailAddress: email,
        expiresInDays: 7,
        ignoreExisting: false,
        notify: true,
        redirectUrl: invitationRedirectUrl(token),
      });
    } catch (error) {
      throw clerkInvitationFailure(error,
        "The partner invitation was not finalized locally.");
    }
    clerkInvitationId = clerkInvitation.id;
    await audit(req,"Created partner invitation","Partners",invitation.rows[0].id,
      {partnerId:p.rows[0].id,invitedEmail:email,clerkInvitationId:clerkInvitation.id},client);
    commitAttempted = true;
    const resolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM partner_invitations WHERE id=$1`, [invitation.rows[0].id],
      )).rows[0]),
      revokeInvitation: () => clerkClient.invitations.revokeInvitation(clerkInvitationId!),
    });
    if (resolution !== "COMMITTED") throw new AuthError(503,
      resolution === "UNKNOWN" ? "Invitation status is uncertain; check the partner directory before retrying" :
        "Partner invitation could not be completed; please retry");
    committed = true;
    res.status(201).json({ id: invitation.rows[0].id, partnerId: p.rows[0].id, email, status: "PENDING",
      clerkInvitationId: clerkInvitationId, invitationDispatchStatus: "REQUEST_ACCEPTED",
      invitationDeliveryStatus: "UNVERIFIED",
      expiresAt: invitation.rows[0].expiresAt, createdAt: invitation.rows[0].createdAt });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (clerkInvitationId && !committed && !commitAttempted) {
      await clerkClient.invitations.revokeInvitation(clerkInvitationId).catch(() => undefined);
    }
    throw e;
  } finally { client.release(); }
}));
router.post("/platform/partners/:partnerId/invitations/resend", run(async (req, res) => {
  const c = assertRoles(req, ["PLATFORM_OWNER"]);
  const partnerId = idOf(req.params.partnerId, "Partner");
  const ownershipClient = await pool.connect();
  let ownershipLocked = false;
  try {
    const lock = await ownershipClient.query(
      `SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked`,
      [`partner-invitation-resend:${partnerId}`],
    );
    ownershipLocked = lock.rows[0]?.locked === true;
    if (!ownershipLocked) {
      throw new AuthError(409,
        "A resend or recovery for this partner is already in progress. Wait for it to finish; no second provider request was made.",
        "INVITATION_DISPATCH_IN_PROGRESS");
    }
  let email = "";
  const token = crypto.randomBytes(32).toString("base64url");
  const attemptId = crypto.randomUUID();
  let invitation: any;
  let oldClerkInvitationIds: string[] = [];
  let supersededIds: number[] = [];
  let recoveryAttemptId: string | null = null;
  try {
    const client = await pool.connect();
    try {
    await client.query("BEGIN");
    const partner = await client.query(`SELECT id,email,status,user_id AS "userId"
      FROM partner_profiles WHERE id=$1 FOR UPDATE`, [partnerId]);
    const row = partner.rows[0];
    if (!row) throw new AuthError(404, "Partner not found");
    if (row.status !== "INVITED" || row.userId) {
      throw new AuthError(409, "Only a pending partner invitation can be resent");
    }
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
      [`partner-invitation:${normalizedEmail(row.email)}`]);
    email = normalizedEmail(row.email);
    const rateLimited = await client.query(`SELECT GREATEST(1,CEIL(EXTRACT(EPOCH FROM (expires_at-NOW()))))::int AS "retryAfterSeconds"
      FROM partner_invitations WHERE partner_profile_id=$1 AND status='RATE_LIMITED' AND expires_at>NOW()
      ORDER BY created_at DESC LIMIT 1`, [partnerId]);
    if (rateLimited.rows[0]) {
      const retrySeconds = Number(rateLimited.rows[0].retryAfterSeconds) || 1;
      res.set("Retry-After", String(retrySeconds));
      res.status(429).json({ error: "Clerk rate-limited this invitation; retry after the indicated delay.",
        code: "INVITATION_PROVIDER_RATE_LIMITED", retryAfterSeconds: retrySeconds });
      await client.query("ROLLBACK");
      return;
    }
    const unresolved = await client.query(`SELECT id,status,created_at AS "createdAt",
        expires_at AS "expiresAt" FROM partner_invitations
      WHERE partner_profile_id=$1 AND status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [partnerId]);
    if (unresolved.rows[0]) {
      invitation = unresolved.rows[0];
      if (invitation.status === "DISPATCHING") {
        const stillFresh = await client.query(`SELECT 1 FROM partner_invitations
          WHERE id=$1 AND created_at>NOW()-INTERVAL '5 minutes'`, [invitation.id]);
        if (stillFresh.rows[0]) {
          throw new AuthError(409,
            "The partner invitation provider request may still be in flight. Wait five minutes before attempting recovery; no second provider request was made.",
            "INVITATION_DISPATCH_IN_PROGRESS");
        }
      }
      const attempt = await client.query(`SELECT metadata->>'attemptId' AS "attemptId"
        FROM audit_logs WHERE module='Partners' AND record_id=$1
          AND metadata->>'dispatchStatus' IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')
        ORDER BY timestamp DESC LIMIT 1`, [invitation.id]);
      recoveryAttemptId = attempt.rows[0]?.attemptId ?? null;
      if (!recoveryAttemptId) {
        throw new AuthError(503,
          "This invitation has an unresolved provider attempt without a recovery marker. Do not resend; a Platform Owner must reconcile it manually.",
          "INVITATION_RECOVERY_REQUIRED");
      }
      await client.query("COMMIT");
    } else {
      const clerkUsers = await clerkClient.users.getUserList({ emailAddress: [email], limit: 100 });
      const registeredClerkUser = clerkUsers.data.some((user: any) =>
        user.emailAddresses?.some((address: any) => normalizedEmail(address.emailAddress) === email));
      if (registeredClerkUser) {
        throw new AuthError(409, "This email already has an EduCore account; do not create another invitation.");
      }
      const appUser = await client.query(`SELECT id FROM app_users
        WHERE lower(trim(email))=$1 LIMIT 1`, [email]);
      if (appUser.rows[0]) {
        throw new AuthError(409, "This email already has an active application account or role; do not create another invitation.");
      }
      const historical = await client.query(`SELECT id FROM partner_invitations
        WHERE partner_profile_id=$1 AND status IN ('ACTIVE','REVOKED') FOR UPDATE`, [partnerId]);
      const historicalIds = historical.rows.map((item: any) => Number(item.id)).filter(Number.isInteger);
      oldClerkInvitationIds = await knownClerkInvitationIds(client, historicalIds);
      const inserted = await client.query(`INSERT INTO partner_invitations
          (partner_profile_id,invited_email,token_hash,status,expires_at,created_by)
        VALUES($1,$2,$3,'DISPATCHING',NOW()+INTERVAL '7 days',$4)
        RETURNING id,created_at AS "createdAt",expires_at AS "expiresAt"`,
        [partnerId, email, hash(token), c.user.id]);
      invitation = inserted.rows[0];
      await audit(req, "Started partner invitation resend", "Partners", invitation.id,
        { partnerId, invitedEmail: email, attemptId, dispatchStatus: "DISPATCHING" }, client);
      await client.query("COMMIT");
    }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    throw error;
  }

  if (recoveryAttemptId) {
    let reconciliation: Awaited<ReturnType<typeof reconcileClerkInvitationAttempt>>;
    try {
      reconciliation = await reconcileClerkInvitationAttempt(email, Number(invitation.id), recoveryAttemptId);
    } catch {
      throw new AuthError(503,
        "Clerk invitation reconciliation could not verify every status and page. No new invitation was sent; retry Owner recovery later.",
        "INVITATION_RECOVERY_REQUIRED");
    }
    if (reconciliation.state === "ABSENT" || reconciliation.state === "TERMINAL") {
      const recoveryStatus = reconciliation.state === "ABSENT"
        ? "PROVIDER_INVITATION_ABSENT" : `PROVIDER_INVITATION_${String(reconciliation.invitation.status).toUpperCase()}`;
      await pool.query(`UPDATE partner_invitations SET status='FAILED',revoked_at=NOW()
        WHERE id=$1 AND status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')`, [invitation.id]);
      await pool.query(`INSERT INTO audit_logs ("user",role,actor_user_id,clerk_user_id,action,module,record_id,metadata)
        VALUES($1,$2,$3,$4,'Resolved partner invitation resend attempt','Partners',$5,$6)`,
        [c.user.email, c.roles[0]?.role ?? "AUTHENTICATED", c.user.id, c.user.clerkUserId,
          invitation.id, { partnerId, attemptId: recoveryAttemptId, recoveryStatus }]);
      throw new AuthError(409,
        "Clerk confirms the prior resend has no usable invitation. The previous local invitation remains unchanged; it is safe to retry the resend.",
        "INVITATION_PROVIDER_ABSENT");
    }
    if (reconciliation.state !== "PENDING") {
      throw new AuthError(503,
        reconciliation.state === "ACCEPTED"
          ? "Clerk reports this invitation was accepted. Do not resend; a Platform Owner must reconcile the partner account state."
          : "Clerk returned ambiguous invitation state for this attempt. No replacement was sent; a Platform Owner must reconcile it manually.",
        "INVITATION_RECOVERY_REQUIRED");
    }
    const history = await pool.query(`SELECT id FROM partner_invitations
      WHERE partner_profile_id=$1 AND status IN ('ACTIVE','REVOKED')`, [partnerId]);
    oldClerkInvitationIds = await knownClerkInvitationIds(pool,
      history.rows.map((item: any) => Number(item.id)).filter(Number.isInteger));
    const result = await finalizePartnerInvitationResend(req, {
      partnerId, email, invitation, clerkInvitationId: reconciliation.invitation.id,
      attemptId: recoveryAttemptId, priorClerkInvitationIds: oldClerkInvitationIds, recovered: true,
    });
    res.status(201).json(result);
    return;
  }

  let clerkInvitation: any;
  try {
    clerkInvitation = await clerkClient.invitations.createInvitation({
      emailAddress: email, expiresInDays: 7, ignoreExisting: true,
      notify: true, redirectUrl: invitationRedirectUrl(token),
      publicMetadata: { edupulsePartnerInvitation: { attemptId, partnerInvitationId: invitation.id } },
    });
  } catch (error) {
    const status = (error as { status?: number; statusCode?: number } | null)?.status ??
      (error as { statusCode?: number } | null)?.statusCode;
    if (status === 429 || status === 409 || status === 422 ||
        (typeof status === "number" && status >= 400 && status < 500)) {
      const retryAfter = (error as { retryAfter?: number; headers?: { get?: (name: string) => string | null } })
        ?.retryAfter;
      const headerValue = (error as { headers?: { get?: (name: string) => string | null } })
        ?.headers?.get?.("retry-after");
      const retrySeconds = status === 429
        ? Math.max(1, Math.min(3600, Number(retryAfter ?? headerValue) || 60))
        : undefined;
      if (status === 429) {
        await pool.query(`UPDATE partner_invitations SET status='RATE_LIMITED',
          expires_at=NOW()+($2::int * INTERVAL '1 second'),revoked_at=NOW()
          WHERE id=$1 AND status='DISPATCHING'`, [invitation.id, retrySeconds]);
      } else {
        await pool.query(`UPDATE partner_invitations SET status='FAILED',revoked_at=NOW()
          WHERE id=$1 AND status='DISPATCHING'`, [invitation.id]);
      }
      await pool.query(`INSERT INTO audit_logs ("user",role,actor_user_id,clerk_user_id,action,module,record_id,metadata)
        VALUES($1,$2,$3,$4,'Partner invitation resend rejected by provider','Partners',$5,$6)`,
        [c.user.email, c.roles[0]?.role ?? "AUTHENTICATED", c.user.id, c.user.clerkUserId,
          invitation.id, { partnerId, attemptId, providerStatus: status }]);
      if (status === 429) {
        res.set("Retry-After", String(retrySeconds));
        res.status(429).json({ error: "Clerk rate-limited the invitation request; the previous invitation remains usable.",
          code: "INVITATION_PROVIDER_RATE_LIMITED", retryAfterSeconds: retrySeconds });
        return;
      }
      throw clerkInvitationFailure(error, "Clerk rejected the partner invitation request; the previous invitation remains usable.");
    }
    await pool.query(`UPDATE partner_invitations SET status='UNKNOWN_PROVIDER_STATE'
      WHERE id=$1 AND status='DISPATCHING'`, [invitation.id]);
    await pool.query(`INSERT INTO audit_logs ("user",role,actor_user_id,clerk_user_id,action,module,record_id,metadata)
      VALUES($1,$2,$3,$4,'Partner invitation resend requires provider recovery','Partners',$5,$6)`,
      [c.user.email, c.roles[0]?.role ?? "AUTHENTICATED", c.user.id, c.user.clerkUserId,
        invitation.id, { partnerId, attemptId, dispatchStatus: "UNKNOWN_PROVIDER_STATE" }]);
    throw new AuthError(503,
      "Clerk did not confirm whether the invitation was accepted. Recovery is required; do not retry because the provider may already have created it.",
      "INVITATION_RECOVERY_REQUIRED");
  }

  const client = await pool.connect();
  let committed = false;
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    const currentPartner = await client.query(`SELECT status,user_id AS "userId"
      FROM partner_profiles WHERE id=$1 FOR UPDATE`, [partnerId]);
    if (!currentPartner.rows[0] || currentPartner.rows[0].status !== "INVITED" ||
        currentPartner.rows[0].userId) {
      throw new AuthError(409, "The partner invitation was accepted or changed before this resend could be finalized");
    }
    const current = await client.query(`SELECT id FROM partner_invitations
      WHERE id=$1 AND partner_profile_id=$2 AND status='DISPATCHING' FOR UPDATE`, [invitation.id, partnerId]);
    if (!current.rows[0]) throw new AuthError(503, "Invitation recovery is required before finalizing this resend",
      "INVITATION_RECOVERY_REQUIRED");
    supersededIds = await supersedePartnerInvitations(client, partnerId);
    await client.query(`UPDATE partner_invitations SET status='ACTIVE'
      WHERE id=$1 AND status='DISPATCHING'`, [invitation.id]);
    await audit(req, "Resent partner invitation", "Partners", invitation.id,
      { partnerId, invitedEmail: email, clerkInvitationId: clerkInvitation.id, attemptId,
        supersededInvitationIds: supersededIds }, client);
    commitAttempted = true;
    const resolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM partner_invitations WHERE id=$1 AND status='ACTIVE'`, [invitation.id],
      )).rows[0]),
      revokeInvitation: () => clerkClient.invitations.revokeInvitation(clerkInvitation.id),
    });
    if (resolution !== "COMMITTED") throw new AuthError(503,
      resolution === "UNKNOWN" ? "Invitation finalization status is uncertain; recovery is required before retrying" :
        "Partner invitation could not be finalized; please retry");
    committed = true;
    await revokeClerkInvitations(oldClerkInvitationIds, "replacement");
    res.status(201).json({ id: invitation.id, partnerId, email,
      status: "PENDING", invitationDispatchStatus: "REQUEST_ACCEPTED",
      invitationDeliveryStatus: "UNVERIFIED", expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt });
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    if (!committed && !commitAttempted) {
      await clerkClient.invitations.revokeInvitation(clerkInvitation.id).catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
  } finally {
    let unlockError: Error | undefined;
    if (ownershipLocked) {
      try {
        await ownershipClient.query(
          `SELECT pg_advisory_unlock(hashtextextended($1,0))`,
          [`partner-invitation-resend:${partnerId}`],
        );
      } catch {
        unlockError = new Error("Could not release partner invitation resend lock");
      }
    }
    ownershipClient.release(unlockError);
  }
}));
router.delete("/platform/partners/invitations/:invitationId", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const invitationId = idOf(req.params.invitationId, "Invitation");
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const invitation = await client.query(`SELECT id,partner_profile_id AS "partnerId",status
      FROM partner_invitations WHERE id=$1 FOR UPDATE`, [invitationId]);
    const row = invitation.rows[0];
    if (!row) throw new AuthError(404, "Invitation not found");
    if (!["ACTIVE", "REVOKED"].includes(row.status)) {
      throw new AuthError(409, "Only a pending or expired invitation can be revoked");
    }
    const oldClerkInvitationIds = await knownClerkInvitationIds(client, [invitationId]);
    if (row.status === "ACTIVE") {
      await client.query(`UPDATE partner_invitations SET status='REVOKED',revoked_at=NOW()
        WHERE id=$1 AND status='ACTIVE'`, [invitationId]);
      await audit(req, "Revoked partner invitation", "Partners", invitationId,
        { partnerId: row.partnerId }, client);
    }
    await client.query("COMMIT");
    committed = true;
    await revokeClerkInvitations(oldClerkInvitationIds, "revocation");
    res.json({ id: invitationId, partnerId: row.partnerId, status: "REVOKED" });
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}));
router.get("/platform/partners/:partnerId", run(async (req,res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const r=await pool.query(`SELECT ${partnerFields} FROM partner_profiles p LEFT JOIN app_users u ON u.id=p.user_id WHERE p.id=$1`,[idOf(req.params.partnerId,"Partner")]);
  if (!r.rows[0]) throw new AuthError(404,"Partner not found"); res.json(r.rows[0]);
}));
router.patch("/platform/partners/:partnerId", run(async(req,res)=>{
  assertRoles(req,["PLATFORM_OWNER"]);
  const id=idOf(req.params.partnerId,"Partner"), b=req.body??{};
  const client=await pool.connect();
  let committed=false;
  let oldClerkInvitationIds:string[]=[];
  try {
    await client.query("BEGIN");
    const existing=await client.query(`SELECT id,email,status,user_id AS "userId"
      FROM partner_profiles WHERE id=$1 FOR UPDATE`,[id]);
    if(!existing.rows[0])throw new AuthError(404,"Partner not found");
    const oldEmail=normalizedEmail(existing.rows[0].email);
    const emailProvided=Object.prototype.hasOwnProperty.call(b,"email");
    const email=emailProvided?normalizedEmail(String(b.email??"")):oldEmail;
    let supersededInvitationIds:number[]=[];
    if(emailProvided && email!==oldEmail) {
      if(!validEmail(email))throw new AuthError(400,"A valid partner email is required");
      if(existing.rows[0].status!=="INVITED" || existing.rows[0].userId) {
        throw new AuthError(409,"Only a pending partner email can be corrected");
      }
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`partner-invitation:${email}`]);
      const duplicate=await client.query(`SELECT id FROM partner_profiles
        WHERE lower(email)=lower($1) AND status='INVITED' AND id<>$2 LIMIT 1`,[email,id]);
      if(duplicate.rows[0])throw new AuthError(409,"Another pending partner already uses this email");
      supersededInvitationIds=await supersedePartnerInvitations(client,id);
      oldClerkInvitationIds=await knownClerkInvitationIds(client,supersededInvitationIds);
    }
    const updated=await client.query(`UPDATE partner_profiles SET full_name=COALESCE($1,full_name),
      business_name=COALESCE($2,business_name),phone=COALESCE($3,phone),address=COALESCE($4,address),
      state=COALESCE($5,state),lga=COALESCE($6,lga),email=$7,updated_at=NOW()
      WHERE id=$8 RETURNING id`,[b.fullName,b.businessName,b.phone,b.address,b.state,b.lga,email,id]);
    if(!updated.rows[0])throw new AuthError(404,"Partner not found");
    await audit(req,emailProvided && email!==oldEmail?"Corrected pending partner invitation email":"Updated partner",
      "Partners",id,emailProvided && email!==oldEmail?{oldEmail,newEmail:email,supersededInvitationIds}:null,client);
    await client.query("COMMIT");
    committed=true;
    if(emailProvided && email!==oldEmail)await revokeClerkInvitations(oldClerkInvitationIds,"email correction");
  } catch(error) {
    if(!committed)await client.query("ROLLBACK").catch(()=>undefined);
    throw error;
  } finally { client.release(); }
  const out=await pool.query(`SELECT ${partnerFields} FROM partner_profiles p LEFT JOIN app_users u ON u.id=p.user_id WHERE p.id=$1`,[id]);
  res.json(out.rows[0]);
}));
router.patch("/platform/partners/:partnerId/status", run(async(req,res)=>{
  assertRoles(req,["PLATFORM_OWNER"]); const id=idOf(req.params.partnerId,"Partner"), status=req.body?.status;
  if(!["INVITED","ACTIVE","SUSPENDED","DEACTIVATED"].includes(status))throw new AuthError(400,"Invalid partner status");
  const client=await pool.connect();
  let r;
  try {
    await client.query("BEGIN");
    r=await client.query(`UPDATE partner_profiles SET status=$1,activated_at=CASE WHEN $1='ACTIVE' THEN NOW() ELSE activated_at END,
      deactivated_at=CASE WHEN $1='DEACTIVATED' THEN NOW() ELSE deactivated_at END,updated_at=NOW() WHERE id=$2 RETURNING id,user_id`,[status,id]);
    if(r.rows[0]?.user_id) {
      await client.query(`UPDATE school_memberships SET status=$1,updated_at=NOW()
        WHERE user_id=$2 AND school_id IS NULL AND role='PARTNER'`,
        [status==="ACTIVE"?"ACTIVE":"INACTIVE",r.rows[0].user_id]);
      await client.query(`UPDATE partner_profile_users SET status=$1
        WHERE partner_profile_id=$2 AND role='PARTNER'`,
        [status==="ACTIVE"?"ACTIVE":"INACTIVE",id]);
    }
    if(!r.rows[0])throw new AuthError(404,"Partner not found");
    await audit(req,`Changed partner status to ${status}`,"Partners",id,null,client);
    await client.query("COMMIT");
  } catch(e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  const out=await pool.query(`SELECT ${partnerFields} FROM partner_profiles p LEFT JOIN app_users u ON u.id=p.user_id WHERE p.id=$1`,[id]);res.json(out.rows[0]);
}));
router.get("/platform/partners/:partnerId/schools", run(async(req,res)=>{assertRoles(req,["PLATFORM_OWNER"]);const r=await pool.query(`SELECT ${schoolFields} FROM school_partner_attributions a JOIN schools s ON s.id=a.school_id WHERE a.partner_profile_id=$1 ORDER BY a.starts_at DESC`,[idOf(req.params.partnerId,"Partner")]);res.json(r.rows)}));
router.get("/platform/partners/:partnerId/attribution-history", run(async(req,res)=>{assertRoles(req,["PLATFORM_OWNER"]);const r=await pool.query(`SELECT a.id,a.partner_profile_id AS "partnerId",a.school_id AS "schoolId",a.status AS "attributionStatus",a.source AS "attributionSource",a.referral_link_id AS "referralLinkId",a.starts_at AS "startDate",a.ends_at AS "endDate",a.created_at AS "createdAt" FROM school_partner_attributions a WHERE a.partner_profile_id=$1 ORDER BY a.starts_at DESC`,[idOf(req.params.partnerId,"Partner")]);res.json(r.rows)}));
router.get("/platform/partners/:partnerId/commissions", run(async(req,res)=>{assertRoles(req,["PLATFORM_OWNER"]);const r=await pool.query(`SELECT ${commissionFields} FROM commission_ledger l WHERE l.partner_profile_id=$1 ORDER BY l.created_at DESC`,[idOf(req.params.partnerId,"Partner")]);res.json(r.rows)}));
router.get("/platform/partners/:partnerId/payouts", run(async(req,res)=>{assertRoles(req,["PLATFORM_OWNER"]);const r=await pool.query(`SELECT id,partner_profile_id AS "partnerId",amount::float,currency,status,payment_reference AS "paymentReference",period_start AS "periodStart",period_end AS "periodEnd",created_at AS "createdAt",paid_at AS "paidAt" FROM partner_payouts WHERE partner_profile_id=$1 ORDER BY created_at DESC`,[idOf(req.params.partnerId,"Partner")]);res.json(r.rows)}));
router.get("/platform/partners/:partnerId/payout-information", run(async(req,res)=>{assertRoles(req,["PLATFORM_OWNER"]);const partnerId=idOf(req.params.partnerId,"Partner"),client=await pool.connect();try{await client.query("BEGIN");const r=await client.query(`SELECT id,method,bank_name_encrypted,account_name_encrypted,account_number_encrypted,bank_code_encrypted,encryption_key_version,updated_at AS "updatedAt" FROM partner_payout_information WHERE partner_profile_id=$1 AND status='ACTIVE' FOR SHARE`,[partnerId]);if(!r.rows[0])throw new AuthError(404,"Payout information not found");const x=r.rows[0];await audit(req,"Viewed payout information","Partner Payout Information",x.id,{partnerId},client);await client.query("COMMIT");res.json({id:x.id,partnerId,payoutMethod:x.method,bankName:decrypt(x.bank_name_encrypted,x.encryption_key_version),accountName:decrypt(x.account_name_encrypted,x.encryption_key_version),accountNumber:decrypt(x.account_number_encrypted,x.encryption_key_version),bankCode:x.bank_code_encrypted?decrypt(x.bank_code_encrypted,x.encryption_key_version):null,updatedAt:x.updatedAt});}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}}));

router.get("/platform/partner-attribution-conflicts", run(async(req,res)=>{assertRoles(req,["PLATFORM_OWNER"]);const r=await pool.query(`SELECT c.id,c.school_id AS "schoolId",c.existing_partner_profile_id AS "existingPartnerId",c.attempted_partner_profile_id AS "attemptedPartnerId",c.source AS "attemptedAttributionSource",c.status,c.created_at AS "createdAt",c.resolved_at AS "resolvedAt",c.decision AS "resolutionNote" FROM partner_attribution_conflicts c WHERE ($1::text IS NULL OR c.status=$1) ORDER BY c.created_at DESC`,[typeof req.query.status==="string"?req.query.status:null]);res.json(r.rows)}));
router.post("/platform/partner-attribution-conflicts/:conflictId/resolve", run(async(req,res)=>{const c=assertRoles(req,["PLATFORM_OWNER"]),cid=idOf(req.params.conflictId,"Conflict"), decision=String(req.body?.decision??"").toUpperCase();if(!["ACCEPT","REJECT"].includes(decision))throw new AuthError(400,"decision must be ACCEPT or REJECT");const client=await pool.connect();try{await client.query("BEGIN");const x=await client.query(`SELECT * FROM partner_attribution_conflicts WHERE id=$1 AND status='OPEN' FOR UPDATE`,[cid]);if(!x.rows[0])throw new AuthError(404,"Conflict not found");if(decision==="ACCEPT"){await client.query(`UPDATE school_partner_attributions SET is_current=false,status='ENDED',ends_at=NOW() WHERE school_id=$1 AND is_current=true`,[x.rows[0].school_id]);await client.query(`INSERT INTO school_partner_attributions(school_id,partner_profile_id,referral_link_id,source,status,is_current,created_by) VALUES($1,$2,$3,'PLATFORM_ASSIGNED','ACTIVE',true,$4)`,[x.rows[0].school_id,x.rows[0].attempted_partner_profile_id,x.rows[0].referral_link_id,c.user.id]);}await client.query(`UPDATE partner_attribution_conflicts SET status=$1,decision=$2,resolved_by=$3,resolved_at=NOW() WHERE id=$4`,[decision==="ACCEPT"?"ACCEPTED":"REJECTED",req.body?.note??decision,c.user.id,cid]);await audit(req,`Resolved attribution conflict: ${decision}`,"Partner Attribution",cid,null,client);await client.query("COMMIT");res.json({id:cid,status:decision==="ACCEPT"?"ACCEPTED":"REJECTED"});}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}}));
router.get("/platform/partner-commission-rules", run(async(req,res)=>{assertRoles(req,["PLATFORM_OWNER"]);const r=await pool.query(`SELECT id,name,status,term,currency,calculation_basis AS "calculationBasis",effective_at AS "effectiveDate",ends_at AS "endDate",partner_rate::float AS rate,allocation_total::float AS "allocationTotal",partner_amount::float AS "partnerAmount",school_amount::float AS "schoolAmount",edupulse_amount::float AS "edupulseAmount",created_at AS "createdAt" FROM commission_rules ORDER BY effective_at DESC`);res.json(r.rows)}));
router.post("/platform/partner-commission-rules", run(async(req,res)=>{assertRoles(req,["PLATFORM_OWNER"]);const b=req.body??{},p=Number(b.rate??b.partnerAmount),school=Number(b.schoolAmount??2000),edu=Number(b.edupulseAmount??(Number(b.allocationTotal??5000)-p-school)),total=Number(b.allocationTotal??p+school+edu);if(!Number.isFinite(p)||p<0||!Number.isFinite(school)||school<0||!Number.isFinite(edu)||edu<0||Math.abs(p+school+edu-total)>0.001)throw new AuthError(400,"Commission allocation must balance");const r=await pool.query(`INSERT INTO commission_rules(name,term,currency,calculation_basis,effective_at,partner_rate,allocation_total,partner_amount,school_amount,edupulse_amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,status,currency,calculation_basis AS "calculationBasis",effective_at AS "effectiveDate",ends_at AS "endDate",partner_rate::float AS rate,created_at AS "createdAt"`,[b.name??"Partner referral",b.term??null,b.currency??"NGN",b.calculationBasis??"PER_ELIGIBLE_STUDENT_PER_TERM",b.effectiveDate??new Date(),p,total,p,school,edu]);await audit(req,"Created commission rule","Commission Rules",r.rows[0].id);res.status(201).json(r.rows[0])}));
router.patch("/platform/partner-commission-rules/:ruleId", run(async(req,res)=>{assertRoles(req,["PLATFORM_OWNER"]);const id=idOf(req.params.ruleId,"Rule"),b=req.body??{};const current=await pool.query(`SELECT partner_rate::float AS rate FROM commission_rules WHERE id=$1`,[id]);if(!current.rows[0])throw new AuthError(404,"Rule not found");if(b.rate!==undefined&&Number(b.rate)!==Number(current.rows[0].rate))throw new AuthError(409,"Financial rule amounts are immutable; create a new effective-dated rule");const r=await pool.query(`UPDATE commission_rules SET status=COALESCE($1,status),ends_at=COALESCE($2,ends_at) WHERE id=$3 RETURNING id,status,currency,calculation_basis AS "calculationBasis",effective_at AS "effectiveDate",ends_at AS "endDate",partner_rate::float AS rate,created_at AS "createdAt"`,[b.status,b.endDate,id]);await audit(req,"Updated commission rule","Commission Rules",id);res.json(r.rows[0])}));
router.patch("/platform/partner-commissions/:commissionId/status", run(async(req,res)=>{const c=assertRoles(req,["PLATFORM_OWNER"]),id=idOf(req.params.commissionId,"Commission"),nextStatus=String(req.body?.status??"");const allowed:Record<string,string[]>={PENDING:["APPROVED","HELD","CANCELLED"],APPROVED:["PAYABLE","HELD","CANCELLED"],PAYABLE:["HELD","CANCELLED"],HELD:["APPROVED","CANCELLED"]};const client=await pool.connect();try{await client.query("BEGIN");const current=await client.query(`SELECT status,payout_id FROM commission_ledger WHERE id=$1 FOR UPDATE`,[id]);if(!current.rows[0])throw new AuthError(404,"Commission not found");if(current.rows[0].payout_id||!allowed[current.rows[0].status]?.includes(nextStatus))throw new AuthError(409,`Invalid commission transition from ${current.rows[0].status} to ${nextStatus}`);await client.query(`UPDATE commission_ledger SET status=$1,approved_at=CASE WHEN $1='APPROVED' THEN NOW() ELSE approved_at END,payable_at=CASE WHEN $1='PAYABLE' THEN NOW() ELSE payable_at END,held_at=CASE WHEN $1='HELD' THEN NOW() ELSE held_at END,cancelled_at=CASE WHEN $1='CANCELLED' THEN NOW() ELSE cancelled_at END,created_by=COALESCE(created_by,$2) WHERE id=$3`,[nextStatus,c.user.id,id]);const r=await client.query(`SELECT ${commissionFields} FROM commission_ledger l WHERE l.id=$1`,[id]);await audit(req,`Changed commission status to ${nextStatus}`,"Commissions",id,null,client);await client.query("COMMIT");res.json(r.rows[0])}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}}));
router.get("/platform/partner-payouts", run(async(req,res)=>{assertRoles(req,["PLATFORM_OWNER"]);const r=await pool.query(`SELECT id,partner_profile_id AS "partnerId",amount::float,currency,status,payment_reference AS "paymentReference",period_start AS "periodStart",period_end AS "periodEnd",created_at AS "createdAt",paid_at AS "paidAt" FROM partner_payouts ORDER BY created_at DESC`);res.json(r.rows)}));
router.post("/platform/partner-payouts", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const body = req.body ?? {};
  const partnerId = idOf(body.partnerId, "Partner");
  const amount = minorUnitsOf(body.amount);
  const currency = String(body.currency ?? "NGN").toUpperCase();
  if (amount === null || amount <= 0n) {
    throw new AuthError(400, "A positive amount with no more than two decimal places is required");
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new AuthError(400, "A valid three-letter currency is required");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const payable = await client.query(
      `SELECT id,amount FROM commission_ledger
       WHERE partner_profile_id=$1 AND currency=$2 AND status='PAYABLE' AND payout_id IS NULL
       ORDER BY payable_at,id FOR UPDATE`,
      [partnerId, currency],
    );
    const entries = payable.rows.map((row) => {
      const entryAmount = minorUnitsOf(row.amount);
      if (entryAmount === null) throw new Error("Invalid commission amount returned from database");
      return { id: row.id, amount: entryAmount };
    });
    const total = entries.reduce((sum, entry) => sum + entry.amount, 0n);
    if (amount > total) throw new AuthError(409, "Payout exceeds payable commission");
    const selected = oldestExactPayoutSubset(entries, amount);
    if (!selected) {
      throw new AuthError(409, "Payout amount must exactly match a whole-entry payable commission subset");
    }
    const payout = await client.query(
      `INSERT INTO partner_payouts
       (partner_profile_id,amount,currency,status,period_start,period_end,method,notes)
       VALUES($1,$2,$3,'PENDING',$4,$5,$6,$7)
       RETURNING id,partner_profile_id AS "partnerId",amount::float,currency,status,
         period_start AS "periodStart",period_end AS "periodEnd",created_at AS "createdAt"`,
      [partnerId, decimalOfMinorUnits(amount), currency, body.periodStart ?? new Date(0),
        body.periodEnd ?? new Date(), body.method ?? null, body.notes ?? null],
    );
    await client.query(`UPDATE commission_ledger SET payout_id=$1 WHERE id=ANY($2::int[])`,
      [payout.rows[0].id, selected]);
    await audit(req, "Created partner payout", "Payouts", payout.rows[0].id, null, client);
    await client.query("COMMIT");
    res.status(201).json(payout.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));
router.patch("/platform/partner-payouts/:payoutId", run(async(req,res)=>{assertRoles(req,["PLATFORM_OWNER"]);const id=idOf(req.params.payoutId,"Payout"),status=req.body?.status,reference=typeof req.body?.paymentReference==="string"?req.body.paymentReference.trim():"";const transitions:Record<string,string[]>={PENDING:["PROCESSING","FAILED"],PROCESSING:["PAID","FAILED"],PAID:["REVERSED"]};const client=await pool.connect();try{await client.query("BEGIN");const current=await client.query(`SELECT id,status FROM partner_payouts WHERE id=$1 FOR UPDATE`,[id]);if(!current.rows[0])throw new AuthError(404,"Payout not found");if(!transitions[current.rows[0].status]?.includes(status))throw new AuthError(409,`Invalid payout transition from ${current.rows[0].status} to ${status}`);if(status==="PAID"&&!reference)throw new AuthError(400,"paymentReference is required when marking a payout paid");if(status==="REVERSED"&&(!reference||reference.length>200||/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(reference)))throw new AuthError(400,"A valid reversal paymentReference is required");const p=await client.query(`UPDATE partner_payouts SET status=$1,payment_reference=CASE WHEN $1='REVERSED' OR $2='' THEN payment_reference ELSE $2 END,paid_at=CASE WHEN $1='PAID' THEN NOW() ELSE paid_at END,reversed_at=CASE WHEN $1='REVERSED' THEN NOW() ELSE reversed_at END,reversal_reference=CASE WHEN $1='REVERSED' THEN $3 ELSE reversal_reference END WHERE id=$4 RETURNING id,partner_profile_id AS "partnerId",amount::float,currency,status,payment_reference AS "paymentReference",reversal_reference AS "reversalReference",period_start AS "periodStart",period_end AS "periodEnd",created_at AS "createdAt",paid_at AS "paidAt"`,[status,reference,status==="REVERSED"?reference:null,id]);if(status==="PAID")await client.query(`UPDATE commission_ledger SET status='PAID',paid_at=NOW(),payment_reference=$1 WHERE payout_id=$2 AND status='PAYABLE'`,[reference,id]);if(status==="FAILED")await client.query(`UPDATE commission_ledger SET payout_id=NULL WHERE payout_id=$1 AND status='PAYABLE'`,[id]);if(status==="REVERSED")await client.query(`UPDATE commission_ledger SET payout_id=NULL,status='PAYABLE',reversed_at=NOW(),reversal_reference=$2 WHERE payout_id=$1 AND status='PAID'`,[id,reference]);await audit(req,`Updated partner payout to ${status}`,"Payouts",id,status==="REVERSED"?{reversalReference:reference}:null,client);await client.query("COMMIT");res.json(p.rows[0])}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}}));

router.post(["/partner/invitations/accept", "/partner/invitations/:invitationToken/accept"], run(async (req, res) => {
  const context = getUserContext(req);
  const token = String(req.params.invitationToken ?? req.query.partnerInvitation ?? req.body?.partnerInvitation ?? "");
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new AuthError(400, "Invalid invitation token");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const invitation = await client.query(`SELECT i.id,i.partner_profile_id,i.invited_email,i.expires_at,p.status AS "partnerStatus"
      FROM partner_invitations i JOIN partner_profiles p ON p.id=i.partner_profile_id
      WHERE i.token_hash=$1 AND i.status='ACTIVE' FOR UPDATE OF i`, [hash(token)]);
    const row = invitation.rows[0];
    if (!row || row.expires_at < new Date()) throw new AuthError(400, "Invitation is expired or revoked");
    let clerkUser;
    try {
      clerkUser = await clerkClient.users.getUser(context.user.clerkUserId);
    } catch {
      throw new AuthError(503, "Unable to verify the invited partner email");
    }
    const verifiedEmail = clerkUser.primaryEmailAddress?.verification?.status === "verified"
      ? normalizedEmail(clerkUser.primaryEmailAddress.emailAddress)
      : "";
    if (!verifiedEmail || verifiedEmail !== normalizedEmail(row.invited_email) ||
        verifiedEmail !== normalizedEmail(context.user.email)) {
      throw new AuthError(403, "Invitation email does not match authenticated user");
    }
    const legacyStaffPermission = token.match(/^staff_(standard|finance|admin)_/)?.[1];
    if (token.startsWith("staff_") && !legacyStaffPermission) throw new AuthError(400, "Invalid staff invitation");
    const staffClaim = legacyStaffPermission ? null : await client.query(`SELECT metadata->>'permission' AS permission
      FROM audit_logs WHERE module='Partners' AND record_id=$1
        AND action IN ('Created partner staff invitation','Resent partner staff invitation')
      ORDER BY timestamp DESC LIMIT 1`, [row.id]);
    const staffPermission = legacyStaffPermission ??
      (String(staffClaim?.rows[0]?.permission ?? "").toLowerCase() || undefined);
    const staffRoles: Record<string, string> = {
      standard: "PARTNER_STAFF",
      finance: "PARTNER_FINANCE",
      admin: "PARTNER_ADMIN",
    };
    if (staffPermission && !staffRoles[staffPermission]) {
      throw new AuthError(409, "The staff invitation permission cannot be verified");
    }
    const isStaffInvite = Boolean(staffPermission);
    const partnerRole = isStaffInvite ? staffRoles[staffPermission!] : "PARTNER_OWNER";
    if (isStaffInvite && row.partnerStatus !== "ACTIVE") {
      throw new AuthError(403, "The partner account is not active");
    }
    if (isStaffInvite) {
      await client.query(`INSERT INTO partner_profile_users(partner_profile_id,user_id,role,status)
        VALUES($1,$2,$3,'ACTIVE')
        ON CONFLICT(partner_profile_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='ACTIVE'`,
        [row.partner_profile_id, context.user.id, partnerRole]);
    } else {
      const attached = await client.query(`UPDATE partner_profiles SET user_id=$1,status='ACTIVE',
          registered_at=NOW(),activated_at=NOW(),updated_at=NOW()
        WHERE id=$2 AND (user_id IS NULL OR user_id=$1) RETURNING id`,
        [context.user.id, row.partner_profile_id]);
      if (!attached.rows[0]) throw new AuthError(409, "Partner invitation cannot be attached to this account");
      await client.query(`INSERT INTO partner_profile_users(partner_profile_id,user_id,role,status)
        VALUES($1,$2,'PARTNER','ACTIVE')
        ON CONFLICT(partner_profile_id,user_id) DO UPDATE SET status='ACTIVE'`,
        [row.partner_profile_id, context.user.id]);
    }
    await client.query(`INSERT INTO school_memberships(user_id,school_id,role,status)
      VALUES($1,NULL,'PARTNER','ACTIVE')
      ON CONFLICT(user_id,role) WHERE school_id IS NULL
      DO UPDATE SET status='ACTIVE',updated_at=NOW()`, [context.user.id]);
    await client.query(`UPDATE partner_invitations SET status='ACCEPTED',redeemed_at=NOW() WHERE id=$1`, [row.id]);
    await audit(req, isStaffInvite ? "Accepted partner staff invitation" : "Accepted partner invitation",
      "Partners", row.partner_profile_id, { role: partnerRole, invitationId: row.id }, client);
    await client.query("COMMIT");
    const result = await pool.query(`SELECT ${partnerFields} FROM partner_profiles p
      LEFT JOIN app_users u ON u.id=p.user_id WHERE p.id=$1`, [row.partner_profile_id]);
    res.json({ ...result.rows[0], status: "ACTIVE",
      role: partnerRole,
      redirectTo: "/partner" });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}));
router.get("/partner/profile", run(async(req,res)=>res.json(await self(req))));
router.patch("/partner/profile", run(async(req,res)=>{const p=await self(req);requirePartnerOwner(req,p);const b=req.body??{};await pool.query(`UPDATE partner_profiles SET full_name=COALESCE($1,full_name),business_name=COALESCE($2,business_name),phone=COALESCE($3,phone),address=COALESCE($4,address),state=COALESCE($5,state),lga=COALESCE($6,lga),updated_at=NOW() WHERE id=$7`,[b.fullName,b.businessName,b.phone,b.address,b.state,b.lga,p.id]);res.json(await self(req))}));
router.get("/partner/dashboard", run(async(req,res)=>{const p=await self(req),r=await pool.query(`SELECT (SELECT COUNT(DISTINCT school_id)::int FROM school_partner_attributions WHERE partner_profile_id=$1 AND is_current=true) AS schools,(SELECT COUNT(DISTINCT st.id)::int FROM students st JOIN school_partner_attributions a ON a.school_id=st.school_id WHERE a.partner_profile_id=$1 AND a.is_current=true AND upper(st.status)='ACTIVE') AS students,(SELECT COALESCE(SUM(amount),0)::float FROM commission_ledger WHERE partner_profile_id=$1 AND status NOT IN('REVERSED','CANCELLED')) AS lifetime,(SELECT COALESCE(SUM(amount),0)::float FROM commission_ledger WHERE partner_profile_id=$1 AND status='PAID') AS paid,(SELECT COALESCE(SUM(amount),0)::float FROM commission_ledger WHERE partner_profile_id=$1 AND term=(SELECT term FROM commission_ledger WHERE partner_profile_id=$1 ORDER BY created_at DESC LIMIT 1) AND status NOT IN('REVERSED','CANCELLED')) AS current`,[p.id]);const x=r.rows[0];const response:any={referredSchools:x.schools,eligibleStudents:x.students};if(p.isOwner||["PARTNER_ADMIN","PARTNER_FINANCE"].includes(p.partnerRole)){response.currentTermCommission=x.current;response.lifetimeCommission=x.lifetime;response.paidCommission=x.paid;response.outstandingCommission=x.lifetime-x.paid;}res.json(response)}));
router.get("/partner/referral-link", run(async(req,res)=>{const p=await self(req);res.json(await partnerLink(req,p))}));
router.get("/partner/schools", run(async(req,res)=>{const p=await self(req);const r=await pool.query(`SELECT ${schoolFields} FROM school_partner_attributions a JOIN schools s ON s.id=a.school_id WHERE a.partner_profile_id=$1 AND a.is_current=true ORDER BY a.starts_at DESC`,[p.id]);res.json(r.rows)}));
router.get("/partner/schools/:schoolId", run(async(req,res)=>{const p=await self(req),r=await pool.query(`SELECT ${schoolFields} FROM school_partner_attributions a JOIN schools s ON s.id=a.school_id WHERE a.partner_profile_id=$1 AND a.school_id=$2`,[p.id,idOf(req.params.schoolId,"School")]);if(!r.rows[0])throw new AuthError(404,"School not found");res.json(r.rows[0])}));
router.get("/partner/staff", run(async (req, res) => {
  const partner = await self(req);
  requirePartnerOwner(req, partner);
  const r = await pool.query(`SELECT pu.user_id AS "userId",u.email,
      concat_ws(' ',u.first_name,u.last_name) AS "fullName",pu.role,pu.status,
      pu.created_at AS "joinedAt"
    FROM partner_profile_users pu JOIN app_users u ON u.id=pu.user_id
    WHERE pu.partner_profile_id=$1 AND pu.role IN ('PARTNER_STAFF','PARTNER_FINANCE','PARTNER_ADMIN')
    ORDER BY pu.created_at DESC`, [partner.id]);
  res.json(r.rows);
}));
router.patch("/partner/staff/:userId/permissions", run(async (req, res) => {
  const partner = await self(req);
  requirePartnerOwner(req, partner);
  const userId = idOf(req.params.userId, "Staff user");
  const permission = String(req.body?.permission ?? "").toUpperCase();
  const permissionRoles: Record<string, string> = {
    STANDARD: "PARTNER_STAFF",
    FINANCE: "PARTNER_FINANCE",
    ADMIN: "PARTNER_ADMIN",
  };
  const role = permissionRoles[permission];
  if (!role) throw new AuthError(400, "Permission must be STANDARD, FINANCE, or ADMIN");
  const updated = await pool.query(`UPDATE partner_profile_users
    SET role=$1 WHERE partner_profile_id=$2 AND user_id=$3
      AND role IN ('PARTNER_STAFF','PARTNER_FINANCE','PARTNER_ADMIN') AND status='ACTIVE'
    RETURNING user_id AS "userId",role,status`, [role, partner.id, userId]);
  if (!updated.rows[0]) throw new AuthError(404, "Active partner staff member not found");
  await audit(req, "Changed partner staff permissions", "Partners", userId,
    { partnerId: partner.id, permission, role });
  res.json(updated.rows[0]);
}));
router.get("/partner/staff/invitations", run(async (req, res) => {
  const partner = await self(req);
  requirePartnerOwner(req, partner);
  const r = await pool.query(`SELECT id,invited_email AS email,status,
      created_at AS "createdAt",expires_at AS "expiresAt"
    FROM partner_invitations
    WHERE partner_profile_id=$1 AND status='ACTIVE' AND expires_at>NOW()
    ORDER BY created_at DESC`, [partner.id]);
  res.json(r.rows);
}));
router.post("/partner/staff-invitations", run(async (req, res) => {
  const context = getUserContext(req);
  const partner = await self(req);
  requirePartnerOwner(req, partner);
  const email = normalizedEmail(String(req.body?.email ?? ""));
  const permission = String(req.body?.permission ?? "STANDARD").toUpperCase();
  const permissionRoles: Record<string, string> = {
    STANDARD: "PARTNER_STAFF",
    FINANCE: "PARTNER_FINANCE",
    ADMIN: "PARTNER_ADMIN",
  };
  const role = permissionRoles[permission];
  if (!validEmail(email)) throw new AuthError(400, "A valid staff email is required");
  if (!role) throw new AuthError(400, "Permission must be STANDARD, FINANCE, or ADMIN");
  const client = await pool.connect();
  let clerkInvitationId: string | null = null;
  let committed = false;
  let commitAttempted = false;
  const token = crypto.randomBytes(32).toString("base64url");
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
      [`partner-staff:${partner.id}:${email}`]);
    const duplicate = await client.query(`SELECT 1 FROM partner_invitations
      WHERE partner_profile_id=$1 AND lower(invited_email)=lower($2)
        AND status='ACTIVE' AND expires_at>NOW()
      UNION ALL
      SELECT 1 FROM partner_profile_users pu JOIN app_users u ON u.id=pu.user_id
      WHERE pu.partner_profile_id=$1 AND lower(u.email)=lower($2) AND pu.status='ACTIVE'
      LIMIT 1`, [partner.id, email]);
    if (duplicate.rows[0]) throw new AuthError(409, "This email already has an active partner invitation or membership");
    const invitation = await client.query(`INSERT INTO partner_invitations
        (partner_profile_id,invited_email,token_hash,status,expires_at,created_by)
      VALUES($1,$2,$3,'ACTIVE',NOW()+INTERVAL '7 days',$4)
      RETURNING id,created_at AS "createdAt",expires_at AS "expiresAt"`,
      [partner.id, email, hash(token), context.user.id]);
    try {
      const clerkInvitation = await clerkClient.invitations.createInvitation({
        emailAddress: email,
        expiresInDays: 7,
        notify: true,
        redirectUrl: invitationRedirectUrl(token),
      });
      clerkInvitationId = clerkInvitation.id;
    } catch (error) {
      throw clerkInvitationFailure(error,
        "The partner staff invitation was not finalized locally.");
    }
    await audit(req, "Created partner staff invitation", "Partners", invitation.rows[0].id,
      { partnerId: partner.id, invitedEmail: email, role, permission, clerkInvitationId }, client);
    commitAttempted = true;
    const resolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM partner_invitations WHERE id=$1`, [invitation.rows[0].id],
      )).rows[0]),
      revokeInvitation: () => clerkClient.invitations.revokeInvitation(clerkInvitationId!),
    });
    if (resolution !== "COMMITTED") throw new AuthError(503,
      resolution === "UNKNOWN" ? "Invitation status is uncertain; check staff invitations before retrying" :
        "Staff invitation could not be completed; please retry");
    committed = true;
    res.status(201).json({
      id: invitation.rows[0].id, partnerId: partner.id, email,
      role, permission, status: "PENDING",
      invitationDispatchStatus: "REQUEST_ACCEPTED",
      invitationDeliveryStatus: "UNVERIFIED",
      expiresAt: invitation.rows[0].expiresAt, createdAt: invitation.rows[0].createdAt,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (clerkInvitationId && !committed && !commitAttempted) {
      await clerkClient.invitations.revokeInvitation(clerkInvitationId).catch(() => undefined);
    }
    throw e;
  } finally {
    client.release();
  }
}));
router.post("/partner/staff-invitations/:invitationId/resend", run(async (req, res) => {
  const context = getUserContext(req);
  const partner = await self(req);
  requirePartnerOwner(req, partner);
  const invitationId = idOf(req.params.invitationId, "Invitation");
  const client = await pool.connect();
  let clerkInvitationId: string | null = null;
  let committed = false;
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    const invitation = await client.query(`SELECT id,partner_profile_id AS "partnerId",
        invited_email AS email,status
      FROM partner_invitations WHERE id=$1 AND partner_profile_id=$2 FOR UPDATE`,
      [invitationId, partner.id]);
    const old = invitation.rows[0];
    if (!old) throw new AuthError(404, "Staff invitation not found");
    if (old.status !== "ACTIVE") throw new AuthError(409, "Only a pending or expired staff invitation can be resent");
    const auditRecord = await client.query(`SELECT metadata->>'permission' AS permission
      FROM audit_logs WHERE module='Partners' AND record_id=$1
        AND action IN ('Created partner staff invitation','Resent partner staff invitation')
      ORDER BY timestamp DESC LIMIT 1`, [invitationId]);
    const permission = String(auditRecord.rows[0]?.permission ?? "").toUpperCase();
    const permissionRoles: Record<string, string> = {
      STANDARD: "PARTNER_STAFF", FINANCE: "PARTNER_FINANCE", ADMIN: "PARTNER_ADMIN",
    };
    const role = permissionRoles[permission];
    if (!role) throw new AuthError(409, "The original staff invitation permission cannot be verified");
    const email = normalizedEmail(old.email);
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
      [`partner-staff:${partner.id}:${email}`]);
    const membership = await client.query(`SELECT 1 FROM partner_profile_users pu
      JOIN app_users u ON u.id=pu.user_id
      WHERE pu.partner_profile_id=$1 AND lower(u.email)=lower($2) AND pu.status='ACTIVE' LIMIT 1`,
      [partner.id, email]);
    if (membership.rows[0]) throw new AuthError(409, "This email already has an active partner membership");
    const historical = await client.query(`SELECT id FROM partner_invitations
      WHERE partner_profile_id=$1 AND lower(invited_email)=lower($2)
        AND status IN ('ACTIVE','REVOKED') FOR UPDATE`,
      [partner.id, email]);
    const historicalIds = historical.rows.map((row: any) => Number(row.id)).filter(Number.isInteger);
    const oldClerkInvitationIds = await knownClerkInvitationIds(client, historicalIds);
    const prior = await client.query(`SELECT id FROM partner_invitations
      WHERE partner_profile_id=$1 AND lower(invited_email)=lower($2) AND status='ACTIVE' FOR UPDATE`,
      [partner.id, email]);
    const supersededIds = prior.rows.map((row: any) => Number(row.id)).filter(Number.isInteger);
    if (supersededIds.length) await client.query(`UPDATE partner_invitations
      SET status='REVOKED',revoked_at=NOW() WHERE id=ANY($1::int[]) AND status='ACTIVE'`, [supersededIds]);
    const token = crypto.randomBytes(32).toString("base64url");
    const created = await client.query(`INSERT INTO partner_invitations
        (partner_profile_id,invited_email,token_hash,status,expires_at,created_by)
      VALUES($1,$2,$3,'ACTIVE',NOW()+INTERVAL '7 days',$4)
      RETURNING id,created_at AS "createdAt",expires_at AS "expiresAt"`,
      [partner.id, email, hash(token), context.user.id]);
    try {
      const clerkInvitation = await clerkClient.invitations.createInvitation({
        emailAddress: email, expiresInDays: 7, notify: true, redirectUrl: invitationRedirectUrl(token),
      });
      clerkInvitationId = clerkInvitation.id;
    } catch (error) {
      throw clerkInvitationFailure(error, "The partner staff invitation was not finalized locally.");
    }
    await audit(req, "Resent partner staff invitation", "Partners", created.rows[0].id,
      { partnerId: partner.id, invitedEmail: email, role, permission, clerkInvitationId,
        supersededInvitationIds: supersededIds }, client);
    commitAttempted = true;
    const resolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM partner_invitations WHERE id=$1`, [created.rows[0].id],
      )).rows[0]),
      revokeInvitation: () => clerkClient.invitations.revokeInvitation(clerkInvitationId!),
    });
    if (resolution !== "COMMITTED") throw new AuthError(503,
      resolution === "UNKNOWN" ? "Invitation status is uncertain; check staff invitations before retrying" :
        "Staff invitation could not be completed; please retry");
    committed = true;
    await revokeClerkInvitations(oldClerkInvitationIds, "replacement");
    res.status(201).json({ id: created.rows[0].id, partnerId: partner.id, email,
      role, permission, status: "PENDING", invitationDispatchStatus: "REQUEST_ACCEPTED",
      invitationDeliveryStatus: "UNVERIFIED", expiresAt: created.rows[0].expiresAt,
      createdAt: created.rows[0].createdAt });
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    if (clerkInvitationId && !committed && !commitAttempted) {
      await clerkClient.invitations.revokeInvitation(clerkInvitationId).catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}));
router.delete("/partner/staff-invitations/:invitationId", run(async (req, res) => {
  const partner = await self(req);
  requirePartnerOwner(req, partner);
  const invitationId = idOf(req.params.invitationId, "Invitation");
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const invitation = await client.query(`SELECT id,status FROM partner_invitations
      WHERE id=$1 AND partner_profile_id=$2 AND status IN ('ACTIVE','REVOKED') FOR UPDATE`,
      [invitationId, partner.id]);
    if (!invitation.rows[0]) throw new AuthError(404, "Pending staff invitation not found");
    const oldClerkInvitationIds = await knownClerkInvitationIds(client, [invitationId]);
    if (invitation.rows[0].status === "ACTIVE") {
      await client.query(`UPDATE partner_invitations SET status='REVOKED',revoked_at=NOW()
        WHERE id=$1 AND status='ACTIVE'`, [invitationId]);
      await audit(req, "Revoked partner staff invitation", "Partners", invitationId,
        { partnerId: partner.id }, client);
    }
    await client.query("COMMIT");
    committed = true;
    await revokeClerkInvitations(oldClerkInvitationIds, "revocation");
    res.json({ id: invitationId, partnerId: partner.id, status: "REVOKED" });
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}));
router.get("/partner/commissions", run(async(req,res)=>{const p=await self(req);requirePartnerFinanceAccess(p);const r=await pool.query(`SELECT ${commissionFields} FROM commission_ledger l WHERE l.partner_profile_id=$1 ORDER BY l.created_at DESC`,[p.id]);res.json(r.rows)}));
router.get("/partner/payouts", run(async(req,res)=>{const p=await self(req);requirePartnerFinanceAccess(p);const r=await pool.query(`SELECT id,partner_profile_id AS "partnerId",amount::float,currency,status,payment_reference AS "paymentReference",period_start AS "periodStart",period_end AS "periodEnd",created_at AS "createdAt",paid_at AS "paidAt" FROM partner_payouts WHERE partner_profile_id=$1 ORDER BY created_at DESC`,[p.id]);res.json(r.rows)}));
router.get("/partner/payout-information", run(async(req,res)=>{const p=await self(req);requirePartnerFinanceAccess(p);const r=await pool.query(`SELECT id,method,account_name_encrypted,account_last4,updated_at AS "updatedAt" FROM partner_payout_information WHERE partner_profile_id=$1 AND status='ACTIVE'`,[p.id]);const x=r.rows[0];res.json(x?{id:x.id,payoutMethod:x.method,bankName:null,accountName:"Stored securely",maskedAccountNumber:mask(x.account_last4),updatedAt:x.updatedAt}:{id:0,payoutMethod:"BANK_TRANSFER",bankName:null,accountName:null,maskedAccountNumber:null,updatedAt:new Date().toISOString()})}));
router.patch("/partner/payout-information", run(async(req,res)=>{const p=await self(req);requirePartnerOwner(req,p);const b=req.body??{},client=await pool.connect();if(!b.accountName)throw new AuthError(400,"accountName is required");try{await client.query("BEGIN");const existing=await client.query(`SELECT bank_name_encrypted,account_number_encrypted,bank_code_encrypted,account_last4,encryption_key_version FROM partner_payout_information WHERE partner_profile_id=$1 FOR UPDATE`,[p.id]);if(!existing.rows[0]&&!b.accountNumber)throw new AuthError(400,"accountNumber is required when payout information is first created");const version=existing.rows[0]?.encryption_key_version??currentPayoutKeyVersion();const preserve=(field:string)=>existing.rows[0]?.[field]??null;const r=await client.query(`INSERT INTO partner_payout_information(partner_profile_id,method,bank_name_encrypted,account_name_encrypted,account_number_encrypted,bank_code_encrypted,account_last4,encryption_key_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(partner_profile_id) DO UPDATE SET method=EXCLUDED.method,bank_name_encrypted=EXCLUDED.bank_name_encrypted,account_name_encrypted=EXCLUDED.account_name_encrypted,account_number_encrypted=EXCLUDED.account_number_encrypted,bank_code_encrypted=EXCLUDED.bank_code_encrypted,account_last4=EXCLUDED.account_last4,encryption_key_version=EXCLUDED.encryption_key_version,updated_at=NOW() RETURNING id,method,account_last4,updated_at AS "updatedAt"`,[p.id,b.payoutMethod??"BANK_TRANSFER",b.bankName!==undefined?encrypt(b.bankName,version):preserve("bank_name_encrypted")??encrypt("",version),encrypt(b.accountName,version),b.accountNumber?encrypt(b.accountNumber,version):preserve("account_number_encrypted"),b.bankCode!==undefined?(b.bankCode?encrypt(b.bankCode,version):null):preserve("bank_code_encrypted"),b.accountNumber?String(b.accountNumber).slice(-4):existing.rows[0].account_last4,version]);await audit(req,"Updated payout information","Partner Payout Information",r.rows[0].id,{fieldsUpdated:Object.keys(b).filter((field)=>field!=="accountNumber")},client);await client.query("COMMIT");const x=r.rows[0];res.json({id:x.id,payoutMethod:x.method,bankName:null,accountName:"Stored securely",maskedAccountNumber:mask(x.account_last4),updatedAt:x.updatedAt});}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}}));

router.use((err: unknown, _req: Request, res: any, next: NextFunction) => {
  if (err instanceof AuthError) return res.status(err.statusCode).json({ error: err.message, code: err.eventType });
  return next(err);
});
export default router;