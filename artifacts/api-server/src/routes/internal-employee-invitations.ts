import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request } from "express";
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

const router = Router();
router.use(requireAuthentication());

export type InternalEmployeeRole = "COMPANY_ACCOUNTANT" | "DEVICE_ACTIVATION_OFFICER";
const METADATA_KEY = "edupulseInternalEmployeeInvitation";
const INVITATION_DAYS = 7;
const validRole = (value: unknown): value is InternalEmployeeRole =>
  value === "COMPANY_ACCOUNTANT" || value === "DEVICE_ACTIVATION_OFFICER";
const normalizeEmail = (value: string) => value.trim().toLowerCase();

function signingKey() {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new AuthError(503, "Internal employee invitations are unavailable until Clerk is configured");
  }
  return process.env.CLERK_SECRET_KEY;
}

function signature(input: {
  claimId: string;
  employeeId: number;
  email: string;
  role: InternalEmployeeRole;
  schoolId: number | null;
}) {
  const content = [
    "v1", input.claimId, input.employeeId, normalizeEmail(input.email),
    input.role, input.schoolId ?? "company",
  ].join("|");
  return createHmac("sha256", signingKey()).update(content).digest("hex");
}

function safeEqualHex(expected: string, actual: unknown) {
  if (typeof actual !== "string" || !/^[a-f0-9]{64}$/i.test(actual)) return false;
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(actual, "hex");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export async function createInternalEmployeeInvitation(
  db: { query: (sql: string, values?: unknown[]) => Promise<any> },
  input: {
    employeeId: number;
    email: string;
    fullName: string;
    role: InternalEmployeeRole;
    schoolId: number | null;
    ignoreExisting?: boolean;
  },
) {
  if (!validRole(input.role) ||
      (input.role === "DEVICE_ACTIVATION_OFFICER" && (!Number.isSafeInteger(input.schoolId) || input.schoolId! < 1)) ||
      (input.role === "COMPANY_ACCOUNTANT" && input.schoolId !== null)) {
    throw new AuthError(400, "The internal employee role or school assignment is invalid");
  }
  const email = normalizeEmail(input.email);
  if (input.ignoreExisting === true) {
    let clerkUsers: Awaited<ReturnType<typeof clerkClient.users.getUserList>>;
    try {
      clerkUsers = await clerkClient.users.getUserList({ emailAddress: [email], limit: 100 });
    } catch {
      throw new AuthError(503, "Unable to verify the invitation email against Clerk; no invitation was created");
    }
    const registeredClerkUser = clerkUsers.data.some((user: any) =>
      user.emailAddresses?.some((address: any) => normalizeEmail(address.emailAddress) === email));
    if (registeredClerkUser) {
      throw new AuthError(409, "This email already has a Clerk account; do not create another invitation");
    }
  }
  const claimId = randomUUID();
  const publicMetadata = {
    [METADATA_KEY]: {
      version: 1,
      claimId,
      employeeId: input.employeeId,
      role: input.role,
      schoolId: input.schoolId,
      signature: signature({
        claimId,
        employeeId: input.employeeId,
        email,
        role: input.role,
        schoolId: input.schoolId,
      }),
    },
  };
  let invitation: Awaited<ReturnType<typeof clerkClient.invitations.createInvitation>>;
  try {
    invitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      expiresInDays: INVITATION_DAYS,
      ignoreExisting: input.ignoreExisting ?? false,
      notify: true,
      redirectUrl: invitationRedirect(`/accept-invitation?internalEmployeeInvitation=${encodeURIComponent(claimId)}`),
      publicMetadata,
    });
  } catch (error) {
    const status = (error as { status?: number; statusCode?: number } | null)?.status ??
      (error as { statusCode?: number } | null)?.statusCode;
    if (status === 409 || status === 422) {
      throw new AuthError(409, "This email already has a Clerk account or a pending invitation");
    }
    throw new AuthError(503, "Clerk could not dispatch the internal employee invitation; no role access was granted");
  }

  const createdAt = invitation.createdAt > 1_000_000_000_000
    ? invitation.createdAt
    : invitation.createdAt * 1000;
  return {
    id: invitation.id,
    claimId,
    expiresAt: new Date(createdAt + INVITATION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function revokeInternalEmployeeInvitation(invitationId: string) {
  try {
    await clerkClient.invitations.revokeInvitation(invitationId);
  } catch (error) {
    const status = (error as { status?: number; statusCode?: number } | null)?.status ??
      (error as { statusCode?: number } | null)?.statusCode;
    // Missing, accepted, expired, or already-revoked invitations cannot be used.
    if (status === 404 || status === 409 || status === 422) return;
    throw error;
  }
}

/**
 * Call from the authenticated-account acceptance path after an account has
 * been provisioned. Clerk public metadata is accepted only when its role,
 * employee, school scope, and exact email are covered by a server HMAC.
 */
export async function activateAcceptedInternalEmployeeInvitation(
  userId: number,
  clerkUserId: string,
  expectedClaimId?:string,
) {
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email = normalizeEmail(
    clerkUser.primaryEmailAddress?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ?? "",
  );
  const marker = (clerkUser.publicMetadata as Record<string, unknown> | undefined)?.[METADATA_KEY];
  if(!marker && !expectedClaimId) return false;
  if (clerkUser.primaryEmailAddress?.verification?.status !== "verified") {
    throw new AuthError(403, "Verify the invited email address before activating internal employee access");
  }
  if(expectedClaimId && !/^[0-9a-f-]{36}$/i.test(expectedClaimId)) throw new AuthError(400,"Invalid internal invitation context");
  const acceptedReceiptSql=`SELECT a.metadata->>'claimId' AS "claimId",a.metadata->>'role' AS role
       FROM audit_logs a
       JOIN platform_company_employees e ON e.id=a.record_id AND e.status='ACTIVE'
       JOIN app_users u ON u.id=a.actor_user_id AND u.clerk_user_id=$2 AND u.status='ACTIVE'
       JOIN school_memberships m ON m.user_id=u.id AND m.status='ACTIVE'
        AND m.role::text=a.metadata->>'role'
        AND m.school_id IS NOT DISTINCT FROM (a.metadata->>'schoolId')::integer
      WHERE a.actor_user_id=$1 AND a.clerk_user_id=$2
        AND a.module='Company Employees' AND a.event_type='INTERNAL_EMPLOYEE_INVITATION_ACCEPTED'
        AND a.metadata->>'claimId'=$3
        AND lower(e.email)=lower($4) AND lower(u.email)=lower($4)
        AND (m.school_id IS NULL OR EXISTS(SELECT 1 FROM schools s
          WHERE s.id=m.school_id AND upper(s.status)='ACTIVE'))
        AND NOT EXISTS(SELECT 1 FROM audit_logs invalidation
          WHERE invalidation.module='Company Employees' AND invalidation.record_id=a.record_id
            AND invalidation.event_type='INTERNAL_EMPLOYEE_INVITATION_INVALIDATED'
            AND invalidation.metadata->>'claimId'=a.metadata->>'claimId')
        AND NOT EXISTS(SELECT 1 FROM school_memberships other
          WHERE other.user_id=u.id AND other.status='ACTIVE'
            AND other.role::text<>m.role::text)
      LIMIT 1`;
  const acceptedReceiptValues=[userId,clerkUserId,expectedClaimId ?? (marker as any)?.claimId ?? "",email];
  const accepted = await pool.query(acceptedReceiptSql,acceptedReceiptValues);
  if(accepted.rows[0]) return true;
  if (!marker || typeof marker !== "object" || !email) {
    if(expectedClaimId) throw new AuthError(403,"This invitation does not belong to this active invited account");
    return false;
  }
  const metadata = marker as Record<string, unknown>;
  if(expectedClaimId && metadata.claimId!==expectedClaimId) throw new AuthError(403,"This invitation does not match the invited account");
  const employeeId = Number(metadata.employeeId);
  const schoolId = metadata.schoolId === null ? null : Number(metadata.schoolId);
  if (metadata.version !== 1 ||
      typeof metadata.claimId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(metadata.claimId) ||
      !Number.isSafeInteger(employeeId) || employeeId < 1 ||
      !validRole(metadata.role) ||
      (schoolId !== null && (!Number.isSafeInteger(schoolId) || schoolId < 1)) ||
      (metadata.role === "COMPANY_ACCOUNTANT" && schoolId !== null) ||
      (metadata.role === "DEVICE_ACTIVATION_OFFICER" && schoolId === null) ||
      !safeEqualHex(signature({
        claimId: metadata.claimId,
        employeeId,
        email,
        role: metadata.role,
        schoolId,
      }), metadata.signature)) {
    throw new AuthError(403, "This internal employee invitation is invalid or does not match this account");
  }

  // Clerk metadata can persist after an invitation is revoked. Only the latest,
  // unexpired claim recorded by the server may provision access.
  const liveClaimSql = `SELECT metadata->>'claimId' AS "claimId",
            (metadata->>'expiresAt')::timestamptz AS "expiresAt"
     FROM audit_logs
     WHERE record_id=$1 AND module='Company Employees'
       AND event_type IN ('INTERNAL_EMPLOYEE_INVITED','INTERNAL_EMPLOYEE_INVITATION_RESENT')
       AND metadata->>'claimId'=$2
       AND NOT EXISTS (
         SELECT 1 FROM audit_logs invalidation
         WHERE invalidation.record_id=$1 AND invalidation.module='Company Employees'
           AND invalidation.event_type IN (
             'INTERNAL_EMPLOYEE_INVITATION_INVALIDATED','INTERNAL_EMPLOYEE_INVITATION_ACCEPTED'
           )
           AND invalidation.metadata->>'claimId'=$2
       )
       AND NOT EXISTS (
         SELECT 1 FROM audit_logs newer
         WHERE newer.record_id=$1 AND newer.module='Company Employees'
           AND newer.event_type IN ('INTERNAL_EMPLOYEE_INVITED','INTERNAL_EMPLOYEE_INVITATION_RESENT')
           AND newer.id > audit_logs.id
       )
     ORDER BY id DESC LIMIT 1`;
  let liveClaim = await pool.query(
    liveClaimSql,
    [employeeId, metadata.claimId],
  );
  // Initial legacy dispatches omitted the local claim. Recover only from
  // an exact provider-accepted, signed invitation and an Owner-created profile.
  if(!liveClaim.rows[0]) {
    const {recoverLegacyInternalInvitation}=await import("./internal-invitation-recovery");
    await recoverLegacyInternalInvitation({userId,clerkUserId,email,metadata,employeeId,schoolId});
    liveClaim=await pool.query(liveClaimSql,[employeeId,metadata.claimId]);
  }
  const claimExpiry = liveClaim.rows[0]?.expiresAt
    ? new Date(liveClaim.rows[0].expiresAt).getTime()
    : 0;
  if (!liveClaim.rows[0] || liveClaim.rows[0].claimId !== metadata.claimId ||
      !Number.isFinite(claimExpiry) || claimExpiry <= Date.now()) {
    throw new AuthError(403, "This internal employee invitation is no longer pending or has expired");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query(
      `SELECT id,email,status FROM app_users
       WHERE id=$1 AND clerk_user_id=$2 FOR UPDATE`,
      [userId, clerkUserId],
    );
    if (!user.rows[0] || normalizeEmail(user.rows[0].email) !== email || user.rows[0].status !== "ACTIVE") {
      throw new AuthError(403, "The invitation does not match an active app account");
    }
    const employee = await client.query(
      `SELECT id FROM platform_company_employees
       WHERE id=$1 AND lower(email)=lower($2) AND status='ACTIVE'
       FOR UPDATE`,
      [employeeId, email],
    );
    if (!employee.rows[0]) {
      throw new AuthError(403, "An active company employee profile matching this invitation is required");
    }
    if((await client.query(acceptedReceiptSql,acceptedReceiptValues)).rows[0]) {
      await client.query("COMMIT");
      return true;
    }
    const currentClaim=await client.query(liveClaimSql,[employeeId,metadata.claimId]);
    if(!currentClaim.rows[0] || new Date(currentClaim.rows[0].expiresAt).getTime()<=Date.now()) {
      throw new AuthError(403,"This internal employee invitation is no longer pending or has expired");
    }
    if (schoolId !== null) {
      const school = await client.query(
        `SELECT id FROM schools WHERE id=$1 AND upper(status)='ACTIVE' FOR SHARE`,
        [schoolId],
      );
      if (!school.rows[0]) throw new AuthError(403, "The invited school is no longer active");
    }

    const activeRoles = await client.query(
      `SELECT id,role,school_id AS "schoolId",status FROM school_memberships
       WHERE user_id=$1 AND status='ACTIVE' FOR UPDATE`,
      [userId],
    );
    const incompatible = activeRoles.rows.some((assignment: { role: string; schoolId: number | null }) =>
      metadata.role === "COMPANY_ACCOUNTANT"
        ? assignment.role !== "COMPANY_ACCOUNTANT" || assignment.schoolId !== null
        : assignment.role !== "DEVICE_ACTIVATION_OFFICER",
    );
    if (incompatible) {
      throw new AuthError(409, "Internal employee access cannot be combined with school, owner, partner, or other platform roles");
    }

    const targetSchoolId = schoolId;
    const existing = activeRoles.rows.find((assignment: { role: string; schoolId: number | null }) =>
      assignment.role === metadata.role && assignment.schoolId === targetSchoolId,
    );
    if (!existing) {
      const inactive = await client.query(
        `SELECT id FROM school_memberships
         WHERE user_id=$1 AND school_id IS NOT DISTINCT FROM $2 AND role=$3
         FOR UPDATE`,
        [userId, targetSchoolId, metadata.role],
      );
      if (inactive.rows[0]) {
        throw new AuthError(409, "This internal employee role was previously deactivated and must not be reactivated by a stale invitation");
      }
      const created = await client.query(
        `INSERT INTO school_memberships(user_id,school_id,role,status)
         VALUES($1,$2,$3,'ACTIVE') RETURNING id`,
        [userId, targetSchoolId, metadata.role],
      );
      const contextName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || email;
      await client.query(
        `INSERT INTO audit_logs
          ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
           severity,event_type,result,metadata)
         VALUES($1,$2,$3,$4,$5,$6,'Security',$7,'info','INTERNAL_EMPLOYEE_ACTIVATED','SUCCESS',$8::jsonb)`,
        [
          contextName, metadata.role, userId, clerkUserId, targetSchoolId,
          `Activated ${metadata.role.replaceAll("_", " ")} account`, created.rows[0].id,
          JSON.stringify({ employeeId, role: metadata.role, claimId: metadata.claimId }),
        ],
      );
    }
    const contextName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || email;
    await client.query(
      `INSERT INTO audit_logs
        ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
         severity,event_type,result,metadata)
       VALUES($1,$2,$3,$4,$5,$6,'Company Employees',$7,'info',
         'INTERNAL_EMPLOYEE_INVITATION_ACCEPTED','SUCCESS',$8::jsonb)`,
      [
        contextName, metadata.role, userId, clerkUserId, targetSchoolId,
        `Accepted ${metadata.role.replaceAll("_", " ")} invitation`, employeeId,
        JSON.stringify({ employeeId, role: metadata.role, schoolId, claimId: metadata.claimId }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  // Metadata cleanup is not part of the committed role transaction. A failed
  // cleanup must not strand an accepted account; the identity-bound audit
  // receipt above safely recognizes its retry.
  await clerkClient.users.updateUserMetadata(clerkUserId, {
    publicMetadata: { [METADATA_KEY]: null },
  }).catch(()=>console.warn("Accepted internal invitation metadata cleanup is pending",{employeeId,userId}));
  return true;
}

const run = (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: NextFunction) => handler(req, res).catch(next);

router.post("/me/internal-employee-invitation/accept",run(async(req,res)=>{
  if(!req.body || typeof req.body!=="object" || Array.isArray(req.body) ||
    Object.keys(req.body).some(key=>key!=="claimId") ||
    (req.body.claimId!==undefined && (typeof req.body.claimId!=="string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.body.claimId)))) {
    throw new AuthError(400,"Provide only the internal invitation context");
  }
  const context=getUserContext(req);
  const handled=await activateAcceptedInternalEmployeeInvitation(
    context.user.id,context.user.clerkUserId,req.body.claimId,
  );
  res.json({handled});
}));

router.post("/platform/company-employees/:employeeId/invitation", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const employeeId = Number(req.params.employeeId);
  if (!Number.isSafeInteger(employeeId) || employeeId < 1) throw new AuthError(404, "Company employee not found");
  const role = req.body?.role;
  const schoolId = req.body?.schoolId === undefined ? null : Number(req.body.schoolId);
  if (!validRole(role) ||
      (role === "COMPANY_ACCOUNTANT" && schoolId !== null) ||
      (role === "DEVICE_ACTIVATION_OFFICER" && (!Number.isSafeInteger(schoolId) || schoolId! < 1))) {
    throw new AuthError(400, "A valid role and its authorized school scope are required");
  }
  const client = await pool.connect();
  let invitationId: string | null = null;
  let committed = false;
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    const employee = await client.query(
      `SELECT id,full_name AS "fullName",email FROM platform_company_employees
       WHERE id=$1 AND status='ACTIVE' FOR UPDATE`,
      [employeeId],
    );
    if (!employee.rows[0]) throw new AuthError(404, "Active company employee not found");
    const existingAccess = await client.query(
      `SELECT sm.role,sm.school_id AS "schoolId"
       FROM app_users au
       JOIN school_memberships sm ON sm.user_id=au.id
       WHERE au.status='ACTIVE' AND lower(au.email)=lower($1) AND sm.status='ACTIVE'
       LIMIT 1`,
      [employee.rows[0].email],
    );
    if (existingAccess.rows[0]) {
      throw new AuthError(409, "This email already belongs to an account with an active role");
    }
    if (schoolId !== null) {
      const school = await client.query(
        `SELECT id FROM schools WHERE id=$1 AND upper(status)='ACTIVE' FOR SHARE`,
        [schoolId],
      );
      if (!school.rows[0]) throw new AuthError(404, "Active school not found");
    }
    const invitation = await createInternalEmployeeInvitation(client, {
      employeeId,
      email: employee.rows[0].email,
      fullName: employee.rows[0].fullName,
      role,
      schoolId,
    });
    invitationId = invitation.id;
    const actor = getUserContext(req);
    await client.query(
      `INSERT INTO audit_logs
        ("user",role,actor_user_id,clerk_user_id,action,module,record_id,event_type,result,metadata)
       VALUES($1,'PLATFORM_OWNER',$2,$3,'Invited internal company employee','Company Employees',$4,
        'INTERNAL_EMPLOYEE_INVITED','SUCCESS',$5::jsonb)`,
      [
        actor.user.email, actor.user.id, actor.user.clerkUserId, employeeId,
         JSON.stringify({
           invitedEmail: employee.rows[0].email,
           role,
           schoolId,
           invitationId: invitation.id,
           claimId: invitation.claimId,
           expiresAt: invitation.expiresAt,
         }),
      ],
    );
    commitAttempted = true;
    const resolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM audit_logs
         WHERE record_id=$1 AND event_type='INTERNAL_EMPLOYEE_INVITED'
           AND metadata->>'invitationId'=$2 LIMIT 1`,
        [employeeId, invitation.id],
      )).rows[0]),
      revokeInvitation: () => revokeInternalEmployeeInvitation(invitationId!),
    });
    if (resolution === "ABORTED") {
      invitationId = null;
      throw new AuthError(503, "Invitation finalization failed; the Clerk invitation was revoked");
    }
    if (resolution === "UNKNOWN") {
      invitationId = null;
      throw new AuthError(503, "Invitation status is uncertain; contact the platform owner before retrying");
    }
    committed = true;
    res.status(201).json({
      employeeId,
      email: employee.rows[0].email,
      role,
      schoolId,
      invitation: { status: "DISPATCH_REQUEST_ACCEPTED", deliveryConfirmed: false, expiresAt: invitation.expiresAt },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (invitationId && !committed && !commitAttempted) {
      try {
        await revokeInternalEmployeeInvitation(invitationId);
      } catch {
        throw new AuthError(503, "Invitation finalization failed and Clerk could not revoke it; contact platform support before retrying");
      }
    }
    throw error;
  } finally {
    client.release();
  }
}));

export default router;