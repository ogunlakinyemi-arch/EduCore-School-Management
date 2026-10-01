import { Router, type IRouter, type Request } from "express";
import { pool } from "@workspace/db";
import {
  AuthError,
  getUserContext,
  handleAuthError,
  requireAuthentication,
} from "../middlewares/auth";
import {
  getClerkSchoolInvitationStatus,
  listSchoolUserInvitations,
  reconcileSchoolInvitationReplacement,
  replaceSchoolAdminInvitation,
  replaceSchoolUserInvitation,
} from "./school-invitations";

const router: IRouter = Router();
router.use(requireAuthentication());

const asyncRoute =
  (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any) =>
    handler(req, res).catch((error) => handleAuthError(error, req, res));

function schoolIdFrom(value: unknown) {
  const schoolId = Number(value);
  if (!Number.isInteger(schoolId) || schoolId < 1) {
    throw new AuthError(400, "A valid school ID is required");
  }
  return schoolId;
}

function assertPlatformOwner(req: Request) {
  const context = getUserContext(req);
  if (!context.roles.some((assignment) =>
    assignment.role === "PLATFORM_OWNER" &&
    assignment.schoolId === null &&
    assignment.status === "ACTIVE"
  )) {
    throw new AuthError(403, "Only a global Platform Owner may manage school invitations");
  }
  return context;
}

function assertSchoolAdmin(req: Request, schoolId: number) {
  const context = getUserContext(req);
  if (context.roles.some((assignment) =>
    assignment.role === "PLATFORM_OWNER" &&
    assignment.schoolId === null &&
    assignment.status === "ACTIVE"
  )) {
    throw new AuthError(403, "Platform Owners have read-only access to school-user invitation management");
  }
  if (!context.roles.some((assignment) =>
    assignment.role === "SCHOOL_ADMIN" &&
    assignment.schoolId === schoolId &&
    assignment.status === "ACTIVE"
  )) {
    throw new AuthError(403, "An active School Admin for this school is required");
  }
  return context;
}

function invitationIdFrom(value: unknown) {
  const invitationId = String(value ?? "");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(invitationId)) {
    throw new AuthError(400, "Invalid Clerk invitation ID");
  }
  return invitationId;
}

function metadataObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

router.get(
  "/schools/:schoolId/users/invitations",
  asyncRoute(async (req, res) => {
    const schoolId = schoolIdFrom(req.params.schoolId);
    assertSchoolAdmin(req, schoolId);
    res.json(await listSchoolUserInvitations(schoolId));
  }),
);

router.patch(
  "/schools/:schoolId/users/invitations/:invitationId",
  asyncRoute(async (req, res) => {
    const schoolId = schoolIdFrom(req.params.schoolId);
    const actor = assertSchoolAdmin(req, schoolId);
    const invitationId = invitationIdFrom(req.params.invitationId);
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AuthError(400, "A valid replacement email is required");
    }
    const result = await replaceSchoolUserInvitation({ schoolId, invitationId, email }, actor);
    res.status(201).json(result);
  }),
);

router.post(
  "/schools/:schoolId/users/invitations/:invitationId/resend",
  asyncRoute(async (req, res) => {
    const schoolId = schoolIdFrom(req.params.schoolId);
    const actor = assertSchoolAdmin(req, schoolId);
    const invitationId = invitationIdFrom(req.params.invitationId);
    if (Object.hasOwn(req.body ?? {}, "email")) {
      throw new AuthError(400, "Use PATCH to change the invited email");
    }
    const result = await replaceSchoolUserInvitation({ schoolId, invitationId }, actor);
    res.status(201).json(result);
  }),
);

router.post(
  "/schools/:schoolId/users/invitations/:invitationId/reconcile",
  asyncRoute(async (req, res) => {
    const schoolId = schoolIdFrom(req.params.schoolId);
    const actor = assertSchoolAdmin(req, schoolId);
    const invitationId = invitationIdFrom(req.params.invitationId);
    const result = await reconcileSchoolInvitationReplacement(
      { schoolId, invitationId },
      actor,
      "USER_INVITED",
    );
    res.status(result.status === "RECOVERY_REQUIRED" ? 202 : 200).json(result);
  }),
);

router.get(
  "/schools/:schoolId/invitations",
  asyncRoute(async (req, res) => {
    assertPlatformOwner(req);
    const schoolId = schoolIdFrom(req.params.schoolId);
    const school = await pool.query(`SELECT id FROM schools WHERE id=$1`, [schoolId]);
    if (!school.rows[0]) throw new AuthError(404, "School not found");
    const records = await pool.query(
      `SELECT id,metadata,timestamp AS "createdAt"
       FROM audit_logs
       WHERE school_id=$1 AND event_type='SCHOOL_ADMIN_INVITED'
         AND metadata->>'invitationId' IS NOT NULL
       ORDER BY timestamp DESC`,
      [schoolId],
    );
    const supersededRows = await pool.query(
      `SELECT metadata->>'supersedesClaimId' AS "claimId"
       FROM audit_logs
       WHERE school_id=$1 AND event_type='SCHOOL_INVITATION_SUPERSEDED'
         AND metadata->>'supersedesClaimId' IS NOT NULL`,
      [schoolId],
    );
    const superseded = new Set(supersededRows.rows.map((row: { claimId: string }) => row.claimId));
    const memberships = await pool.query(
      `SELECT lower(au.email) AS email,sm.status AS "membershipStatus",
              sm.id AS "membershipId",au.id AS "userId"
       FROM school_memberships sm
       JOIN app_users au ON au.id=sm.user_id
       WHERE sm.school_id=$1 AND sm.role='SCHOOL_ADMIN'`,
      [schoolId],
    );
    const acceptedClaims = await pool.query(
      `SELECT record_id AS "membershipId",metadata->>'claimId' AS "claimId"
       FROM audit_logs
       WHERE school_id=$1 AND event_type='USER_ACTIVATED'
         AND metadata->>'activationSource'='CLERK_INVITATION'
         AND metadata->>'claimId' IS NOT NULL`,
      [schoolId],
    );
    const acceptedClaimMemberships = new Set(
      acceptedClaims.rows.map((row: { claimId: string; membershipId: number }) =>
        `${row.claimId}:${row.membershipId}`
      ),
    );
    const recoveryAttempts = await pool.query(
      `SELECT metadata,timestamp AS "createdAt"
       FROM audit_logs attempt
       WHERE attempt.school_id=$1
         AND attempt.event_type='SCHOOL_INVITATION_REPLACEMENT_ATTEMPT'
         AND attempt.metadata->>'sourceEvent'='SCHOOL_ADMIN_INVITED'
         AND attempt.metadata->>'attemptStatus' IN (
           'PREPARED','REVOCATION_REJECTED','REVOCATION_UNKNOWN','DISPATCHING',
           'DISPATCH_REJECTED','OUTCOME_UNKNOWN','MULTIPLE_MATCHES'
         )
         AND NOT EXISTS (
           SELECT 1 FROM audit_logs completed
           WHERE completed.school_id=attempt.school_id
             AND completed.event_type='SCHOOL_ADMIN_INVITED'
             AND completed.metadata->>'claimId'=attempt.metadata->>'claimId'
             AND completed.metadata->>'invitationId' IS NOT NULL
         )
       ORDER BY attempt.timestamp DESC`,
      [schoolId],
    );
    const recoveryInvitationIds = new Set(recoveryAttempts.rows.map((attempt: any) =>
      String(metadataObject(attempt.metadata).selectedInvitationId ?? "")
    ));
    const membershipByEmail = new Map<string, any>();
    for (const membership of memberships.rows) {
      membershipByEmail.set(membership.email, membership);
    }
    const invitations = [];
    const recordedEmails = new Set<string>();
    for (const record of records.rows) {
      const metadata = metadataObject(record.metadata);
      const invitationId = String(metadata.invitationId ?? "");
      const claimId = String(metadata.claimId ?? "");
      const email = String(metadata.invitedEmail ?? "").trim().toLowerCase();
      if (email) recordedEmails.add(email);
      if (recoveryInvitationIds.has(invitationId)) continue;
      const membership = membershipByEmail.get(email);
      const isSuperseded = Boolean(claimId && superseded.has(claimId));
      const isCurrent = !isSuperseded;
      const linkedMembership = membership?.membershipStatus === "ACTIVE" &&
        Boolean(claimId && acceptedClaimMemberships.has(`${claimId}:${membership.membershipId}`));
      let clerkStatus: string | null = null;
      let status: string;
      if (isSuperseded) {
        status = "SUPERSEDED";
        clerkStatus = "revoked-or-ignored";
      } else if (linkedMembership) {
        status = "ACTIVE";
      } else {
        clerkStatus = await getClerkSchoolInvitationStatus(invitationId);
        status = clerkStatus === "pending"
          ? "PENDING"
          : clerkStatus === "expired"
            ? "EXPIRED"
            : clerkStatus === "revoked"
              ? "REVOKED"
              : "ACCEPTED";
      }
      invitations.push({
        invitationId,
        claimId: claimId || null,
        email,
        fullName: [metadata.firstName, metadata.lastName]
          .filter((name): name is string => typeof name === "string" && Boolean(name))
          .join(" ") || null,
        schoolId,
        role: "SCHOOL_ADMIN",
        status,
        clerkStatus,
        isCurrent,
        membershipId: linkedMembership ? membership.membershipId : null,
        userId: linkedMembership ? membership.userId : null,
        createdAt: record.createdAt,
        expiresAt: null,
      });
    }
    for (const attempt of recoveryAttempts.rows) {
      const metadata = metadataObject(attempt.metadata);
      invitations.push({
        invitationId: String(metadata.selectedInvitationId ?? ""),
        recoveryAttemptId: String(metadata.attemptId ?? ""),
        recoveryState: String(metadata.attemptStatus ?? "OUTCOME_UNKNOWN"),
        claimId: String(metadata.claimId ?? "") || null,
        email: String(metadata.invitedEmail ?? "").trim().toLowerCase(),
        fullName: [metadata.firstName, metadata.lastName]
          .filter((name): name is string => typeof name === "string" && Boolean(name))
          .join(" ") || null,
        schoolId,
        role: "SCHOOL_ADMIN",
        status: "RECOVERY_REQUIRED",
        clerkStatus: null,
        isCurrent: true,
        membershipId: null,
        userId: null,
        createdAt: attempt.createdAt,
        expiresAt: null,
      });
    }
    for (const [email, membership] of membershipByEmail) {
      if (membership.membershipStatus === "ACTIVE" && !recordedEmails.has(email)) {
        invitations.push({
          invitationId: null,
          claimId: null,
          email,
          fullName: null,
          schoolId,
          role: "SCHOOL_ADMIN",
          status: "ACTIVE",
          clerkStatus: null,
          isCurrent: true,
          membershipId: membership.membershipId,
          userId: membership.userId,
          createdAt: null,
          expiresAt: null,
        });
      }
    }
    res.json({ schoolId, role: "SCHOOL_ADMIN", invitations });
  }),
);

router.patch(
  "/schools/:schoolId/invitations/:invitationId",
  asyncRoute(async (req, res) => {
    const actor = assertPlatformOwner(req);
    const schoolId = schoolIdFrom(req.params.schoolId);
    const invitationId = invitationIdFrom(req.params.invitationId);
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AuthError(400, "A valid replacement email is required");
    }
    const result = await replaceSchoolAdminInvitation({ schoolId, invitationId, email }, actor);
    res.status(201).json(result);
  }),
);

router.post(
  "/schools/:schoolId/invitations/:invitationId/resend",
  asyncRoute(async (req, res) => {
    const actor = assertPlatformOwner(req);
    const schoolId = schoolIdFrom(req.params.schoolId);
    const invitationId = invitationIdFrom(req.params.invitationId);
    if (Object.hasOwn(req.body ?? {}, "email")) {
      throw new AuthError(400, "Use PATCH to change the invited email");
    }
    const result = await replaceSchoolAdminInvitation({ schoolId, invitationId }, actor);
    res.status(201).json(result);
  }),
);

router.post(
  "/schools/:schoolId/invitations/:invitationId/reconcile",
  asyncRoute(async (req, res) => {
    const actor = assertPlatformOwner(req);
    const schoolId = schoolIdFrom(req.params.schoolId);
    const invitationId = invitationIdFrom(req.params.invitationId);
    const result = await reconcileSchoolInvitationReplacement(
      { schoolId, invitationId },
      actor,
      "SCHOOL_ADMIN_INVITED",
    );
    res.status(result.status === "RECOVERY_REQUIRED" ? 202 : 200).json(result);
  }),
);

export default router;