import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { AuthError, type Role, type UserContext } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { queueCommunicationNotification } from "../services/communication-service";
import { commitInvitationWithRecovery } from "./partner-commit-recovery";

export const INVITABLE_SCHOOL_ROLES = [
  "SCHOOL_ADMIN",
  "TEACHER",
  "ACCOUNTANT",
  "STAFF",
  "PARENT",
  "STUDENT",
] as const satisfies readonly Role[];

const INVITATION_DAYS = 7;
const METADATA_KEY = "edupulseSchoolInvitation";

type InvitationRole = (typeof INVITABLE_SCHOOL_ROLES)[number];

type InviteeInput = {
  schoolId: number;
  email: string;
  fullName: string;
  phone: string | null;
  role: InvitationRole;
  studentId?: number | null;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function schoolInvitationKey() {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new AuthError(503, "Invitation service is unavailable");
  return key;
}

function emailProof(email: string) {
  return createHmac("sha256", schoolInvitationKey())
    .update(normalizeEmail(email))
    .digest("hex");
}

function splitName(fullName: string) {
  const [firstName, ...lastNameParts] = fullName.trim().replace(/\s+/g, " ").split(" ");
  return {
    firstName,
    lastName: lastNameParts.join(" ") || firstName,
  };
}

function matchesEmailProof(email: string, proof: unknown) {
  if (typeof proof !== "string" || !/^[a-f0-9]{64}$/.test(proof)) return false;
  const expected = Buffer.from(emailProof(email), "hex");
  const actual = Buffer.from(proof, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isInvitationRole(value: unknown): value is InvitationRole {
  return typeof value === "string" &&
    INVITABLE_SCHOOL_ROLES.includes(value as InvitationRole);
}

function throwClerkInvitationError(error: unknown): never {
  const status = (error as { status?: number; statusCode?: number } | null)?.status ??
    (error as { statusCode?: number } | null)?.statusCode;
  if (status === 409 || status === 422) {
    throw new AuthError(
      409,
      "This email already has a Clerk account or a pending invitation. Ask an existing account to sign in to EduCore once, then submit again to grant the school role, or wait for the invitation to expire.",
      "INVITATION_ALREADY_EXISTS",
    );
  }
  throw new AuthError(
    503,
    "Clerk did not confirm the invitation request; its status may be uncertain. Check before retrying.",
    "INVITATION_DELIVERY_UNCERTAIN",
  );
}

async function auditInvitation(
  client: any,
  actor: UserContext,
  schoolId: number,
  role: InvitationRole,
  email: string,
  eventType: string,
  recordId: number | null,
  invitationId?: string,
  claimId?: string,
  fullName?: string,
) {
  const actorRole = actor.roles.find((item) =>
    item.schoolId === schoolId && item.role === "SCHOOL_ADMIN"
  )?.role ?? actor.roles.find((item) =>
    item.role === "PLATFORM_OWNER" && item.schoolId === null
  )?.role ?? "AUTHENTICATED";
  const actorName = [actor.user.firstName, actor.user.lastName]
    .filter(Boolean)
    .join(" ") || actor.user.email;
  await client.query(
    `INSERT INTO audit_logs
      ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
       severity,event_type,result,metadata)
     VALUES($1,$2,$3,$4,$5,$6,'Security',$7,'info',$8,'SUCCESS',$9)`,
    [
      actorName,
      actorRole,
      actor.user.id,
      actor.user.clerkUserId,
      schoolId,
      eventType === "SCHOOL_ADMIN_INVITED"
        ? "Invited School Administrator"
        : eventType === "USER_ROLE_CHANGED"
          ? `Granted ${role.replaceAll("_", " ")} access to an existing account`
          : `Invited ${role.replaceAll("_", " ")}`,
      recordId,
      eventType,
      JSON.stringify({
        invitedEmail: email,
        role,
        invitationId: invitationId ?? null,
        claimId: claimId ?? null,
        ...splitName(fullName ?? ""),
      }),
    ],
  );
}

async function queueSchoolAccountNotification(input: {
  recipientUserId: number;
  schoolId: number;
  role: InvitationRole;
  eventKey: string;
  body: string;
}) {
  try {
    await queueCommunicationNotification(pool, {
      recipientUserId: input.recipientUserId,
      schoolId: input.schoolId,
      category: "ACCOUNT",
      eventKey: input.eventKey,
      subject: "School access is active",
      body: input.body,
      link: "/",
      channels: ["IN_APP"],
    });
  } catch (error) {
    logger.warn(
      {
        recipientUserId: input.recipientUserId,
        schoolId: input.schoolId,
        role: input.role,
        errorType: error instanceof Error ? error.name : "UnknownError",
      },
      "Could not queue school account notification",
    );
  }
}

async function ensureInviteProfile(client: any, input: InviteeInput, employeeNo: string) {
  const { firstName, lastName } = splitName(input.fullName);
  if (input.role === "PARENT") {
    if (!input.phone) throw new AuthError(400, "A phone number is required for parent invitations");
    const parent = await client.query(
      `SELECT id,user_id AS "userId" FROM parents
       WHERE school_id=$1 AND lower(email)=lower($2) ORDER BY id FOR UPDATE`,
      [input.schoolId, input.email],
    );
    if (parent.rows.length > 1) {
      throw new AuthError(409, "Multiple parent records use this email; resolve the duplicate before inviting");
    }
    if (parent.rows[0]?.userId) {
      throw new AuthError(409, "This parent profile is already linked to an account");
    }
    if (!parent.rows[0]) {
      await client.query(
        `INSERT INTO parents(school_id,name,email,phone)
         VALUES($1,$2,$3,$4)`,
        [input.schoolId, input.fullName, input.email, input.phone],
      );
    }
  }

  if (input.role === "STUDENT") {
    if (!input.studentId) throw new AuthError(400, "A student profile is required for student invitations");
    const student = await client.query(
      `SELECT id,user_id AS "userId" FROM students
       WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [input.studentId, input.schoolId],
    );
    if (!student.rows[0]) throw new AuthError(404, "Student profile not found in this school");
    if (student.rows[0].userId) throw new AuthError(409, "This student profile is already linked to an account");
  }

  if (input.role === "TEACHER" || input.role === "STAFF") {
    const employee = await client.query(
      `SELECT id,user_id AS "userId",employee_type AS "type",
              employment_status AS status,employee_no AS "employeeNo"
       FROM employees
       WHERE school_id=$1 AND lower(email)=lower($2)
       ORDER BY id FOR UPDATE`,
      [input.schoolId, input.email],
    );
    if (employee.rows.length > 1) {
      throw new AuthError(409, "Multiple employee records use this email; resolve the duplicate before inviting");
    }
    const expectedType = input.role;
    if (employee.rows[0]) {
      if (employee.rows[0].userId) {
        throw new AuthError(409, "This employee profile is already linked to an account");
      }
      if (employee.rows[0].type !== expectedType) {
        throw new AuthError(409, `The existing employee profile is not a ${expectedType.toLowerCase()}`);
      }
      if (employee.rows[0].status === "PENDING") {
        const { firstName: employeeFirstName, lastName } = splitName(input.fullName);
        await client.query(
          `UPDATE employees SET employee_no=$1,first_name=$2,last_name=$3,
             phone=$4,updated_at=NOW()
           WHERE id=$5`,
          [employeeNo, employeeFirstName, lastName, input.phone, employee.rows[0].id],
        );
      } else if (employee.rows[0].status !== "ACTIVE") {
        throw new AuthError(409, "The existing employee profile is inactive");
      }
    } else {
      const { firstName: employeeFirstName, lastName } = splitName(input.fullName);
      await client.query(
        `INSERT INTO employees
          (school_id,user_id,employee_no,first_name,last_name,phone,email,employee_type,employment_status)
         VALUES($1,NULL,$2,$3,$4,$5,$6,$7,'PENDING')`,
        [
          input.schoolId,
          employeeNo,
          employeeFirstName,
          lastName,
          input.phone,
          input.email,
          expectedType,
        ],
      );
    }
  }
}

async function ensureActivatedProfile(
  client: any,
  input: InviteeInput,
  userId: number,
  employeeNo?: string,
) {
  if (input.role === "STUDENT") {
    if (!input.studentId) throw new AuthError(409, "Student profile information is missing from this invitation");
    const existingStudent = await client.query(
      `SELECT id,school_id AS "schoolId" FROM students WHERE user_id=$1 FOR UPDATE`,
      [userId],
    );
    if (existingStudent.rows[0] && existingStudent.rows[0].id !== input.studentId) {
      throw new AuthError(409, "This account is already linked to a different student profile");
    }
    const student = await client.query(
      `SELECT id,user_id AS "userId" FROM students
       WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [input.studentId, input.schoolId],
    );
    if (!student.rows[0]) throw new AuthError(409, "Student profile is no longer available in this school");
    if (student.rows[0].userId && student.rows[0].userId !== userId) {
      throw new AuthError(409, "This student profile is already linked to another account");
    }
    await client.query(
      `UPDATE students SET user_id=$1,updated_at=NOW()
       WHERE id=$2 AND school_id=$3 AND (user_id IS NULL OR user_id=$1)`,
      [userId, input.studentId, input.schoolId],
    );
  }

  if (input.role === "PARENT") {
    const owned = await client.query(
      `SELECT id,school_id AS "schoolId" FROM parents WHERE user_id=$1 FOR UPDATE`,
      [userId],
    );
    if (owned.rows[0] && owned.rows[0].schoolId !== input.schoolId) {
      throw new AuthError(
        409,
        "This parent account is already linked to another school; the current parent model supports one school profile per account",
        "PARENT_PROFILE_SCHOOL_CONFLICT",
      );
    }
    let parent = await client.query(
      `SELECT id,user_id AS "userId" FROM parents
       WHERE school_id=$1 AND lower(email)=lower($2)
       ORDER BY id FOR UPDATE`,
      [input.schoolId, input.email],
    );
    if (parent.rows.length > 1) {
      throw new AuthError(409, "Multiple parent records use this email; resolve the duplicate before activation");
    }
    if (parent.rows[0]?.userId && parent.rows[0].userId !== userId) {
      throw new AuthError(409, "This parent profile is already linked to another account");
    }
    if (!parent.rows[0]) {
      if (!input.phone) throw new AuthError(409, "A parent profile must be created before activation");
      parent = await client.query(
        `INSERT INTO parents(school_id,user_id,name,email,phone)
         VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [input.schoolId, userId, input.fullName, input.email, input.phone],
      );
    } else {
      await client.query(`UPDATE parents SET user_id=$1 WHERE id=$2`, [userId, parent.rows[0].id]);
    }
  }

  if (input.role === "TEACHER" || input.role === "STAFF") {
    const employee = await client.query(
      `SELECT id,user_id AS "userId",employee_type AS "type",employment_status AS status,employee_no AS "employeeNo"
       FROM employees
       WHERE school_id=$1 AND lower(email)=lower($2)
       ORDER BY id FOR UPDATE`,
      [input.schoolId, input.email],
    );
    if (employee.rows.length > 1) {
      throw new AuthError(409, "Multiple employee records use this email; resolve the duplicate before activation");
    }
    if (employee.rows[0]) {
      if (employee.rows[0].userId && employee.rows[0].userId !== userId) {
        throw new AuthError(409, "This employee profile is already linked to another account");
      }
      if (employee.rows[0].type !== input.role) {
        throw new AuthError(409, "The employee profile role does not match the invitation");
      }
      if (employee.rows[0].status !== "ACTIVE" && !(
        employee.rows[0].employeeNo === employeeNo &&
        employee.rows[0].status === "PENDING"
      )) {
        throw new AuthError(409, "This employee profile is inactive; an administrator must review it before activation");
      }
      await client.query(
        `UPDATE employees SET user_id=$1,
           employment_status=CASE
             WHEN employee_no=$2 AND employment_status='PENDING' THEN 'ACTIVE'
             ELSE employment_status
           END,
           updated_at=NOW()
         WHERE id=$3`,
        [userId, employeeNo ?? null, employee.rows[0].id],
      );
    } else {
      if (!employeeNo) {
        throw new AuthError(409, "Employee profile not found; ask the school administrator to resend the invitation");
      }
      const { firstName, lastName } = splitName(input.fullName);
      await client.query(
        `INSERT INTO employees
          (school_id,user_id,employee_no,first_name,last_name,phone,email,employee_type,employment_status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE')`,
        [input.schoolId, userId, employeeNo, firstName, lastName, input.phone, input.email, input.role],
      );
    }
  }
}

async function provisionExistingAccount(
  input: InviteeInput,
  user: { id: number; clerkUserId: string },
  actor: UserContext,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id,status FROM school_memberships
       WHERE user_id=$1 AND school_id=$2 AND role=$3 FOR UPDATE`,
      [user.id, input.schoolId, input.role],
    );
    if (existing.rows[0]) {
      throw new AuthError(
        409,
        existing.rows[0].status === "ACTIVE"
          ? "This user already has the requested school role"
          : "This school membership is inactive and must not be reactivated by an invitation",
      );
    }
    const membership = await client.query(
      `INSERT INTO school_memberships(user_id,school_id,role,status)
       VALUES($1,$2,$3,'ACTIVE')
       ON CONFLICT(user_id,school_id,role) DO NOTHING
       RETURNING id,user_id AS "userId",school_id AS "schoolId",role,status`,
      [user.id, input.schoolId, input.role],
    );
    if (!membership.rows[0]) {
      throw new AuthError(409, "This school membership changed during the invitation request; review its current status");
    }
    const employeeNo = `ACT-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    await ensureActivatedProfile(client, input, user.id, employeeNo);
    await auditInvitation(
      client,
      actor,
      input.schoolId,
      input.role,
      input.email,
      "USER_ROLE_CHANGED",
      membership.rows[0].id,
    );
    await client.query("COMMIT");
    await queueSchoolAccountNotification({
      recipientUserId: user.id,
      schoolId: input.schoolId,
      role: input.role,
      eventKey: `school-invitation:${input.schoolId}:role-granted:${input.role}:${user.id}`,
      body: `Your ${input.role.replaceAll("_", " ").toLowerCase()} access to this school is active.`,
    });
    return {
      status: "ACTIVE" as const,
      email: input.email,
      schoolId: input.schoolId,
      role: input.role,
      membership: membership.rows[0],
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function createSchoolInvitation(input: InviteeInput, actor: UserContext) {
  const email = normalizeEmail(input.email);
  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  const phone = input.phone?.trim() || null;
  if (!Number.isInteger(input.schoolId) || input.schoolId < 1) {
    throw new AuthError(400, "A valid school is required");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || fullName.length < 2) {
    throw new AuthError(400, "A valid email and full name are required");
  }
  if (!isInvitationRole(input.role)) throw new AuthError(400, "Unsupported invitation role");
  if (input.role === "PARENT" && !phone) {
    throw new AuthError(400, "A phone number is required for parent invitations");
  }
  if (input.role === "STUDENT" && (!Number.isInteger(input.studentId) || Number(input.studentId) < 1)) {
    throw new AuthError(400, "A valid student profile is required for student invitations");
  }

  const school = await pool.query(`SELECT id FROM schools WHERE id=$1`, [input.schoolId]);
  if (!school.rows[0]) throw new AuthError(404, "School not found");

  const localUsers = await pool.query(
    `SELECT id,clerk_user_id AS "clerkUserId",status
     FROM app_users WHERE lower(email)=lower($1) ORDER BY id LIMIT 2`,
    [email],
  );
  if (localUsers.rows.length > 1) {
    throw new AuthError(409, "Multiple accounts use this email; resolve the duplicate before granting access");
  }
  const normalizedInput: InviteeInput = { ...input, email, fullName, phone };
  if (localUsers.rows[0]) {
    if (localUsers.rows[0].status !== "ACTIVE") {
      throw new AuthError(409, "This account is inactive; a Platform Owner must reactivate it first");
    }
    let clerkUser;
    try {
      clerkUser = await clerkClient.users.getUser(localUsers.rows[0].clerkUserId);
    } catch {
      throw new AuthError(503, "Unable to verify the existing account email before granting school access");
    }
    const verifiedEmail = clerkUser.primaryEmailAddress?.verification?.status === "verified"
      ? normalizeEmail(clerkUser.primaryEmailAddress.emailAddress)
      : "";
    if (!verifiedEmail || verifiedEmail !== email) {
      throw new AuthError(403, "The requested email must be the existing account's primary verified Clerk email");
    }
    return provisionExistingAccount(normalizedInput, localUsers.rows[0], actor);
  }

  const claimId = randomUUID();
  const employeeNo = `INV-${claimId.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  const metadata = {
    [METADATA_KEY]: {
      version: 1,
      claimId,
      emailProof: emailProof(email),
      schoolId: input.schoolId,
      role: input.role,
      ...splitName(fullName),
      studentId: input.role === "STUDENT" ? input.studentId : null,
      employeeNo: input.role === "TEACHER" || input.role === "STAFF" ? employeeNo : null,
    },
  };

  let invitation: Awaited<ReturnType<typeof clerkClient.invitations.createInvitation>>;
  try {
    invitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      expiresInDays: INVITATION_DAYS,
      ignoreExisting: false,
      notify: true,
      redirectUrl: "/accept-invitation",
      publicMetadata: metadata,
    });
  } catch (error) {
    throwClerkInvitationError(error);
  }

  let client: any;
  let commitAttempted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await ensureInviteProfile(client, normalizedInput, employeeNo);
    await auditInvitation(
      client,
      actor,
      input.schoolId,
      input.role,
      email,
      input.role === "SCHOOL_ADMIN" ? "SCHOOL_ADMIN_INVITED" : "USER_INVITED",
      null,
      invitation.id,
      claimId,
      fullName,
    );
    commitAttempted = true;
    const resolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM audit_logs WHERE metadata->>'invitationId'=$1 LIMIT 1`,
        [invitation.id],
      )).rows[0]),
      revokeInvitation: () => clerkClient.invitations.revokeInvitation(invitation.id),
    });
    if (resolution !== "COMMITTED") {
      throw new AuthError(
        503,
        resolution === "UNKNOWN"
          ? "Invitation status is uncertain; check the account before retrying"
          : "Invitation could not be completed; please retry",
        resolution === "UNKNOWN" ? "INVITATION_RECOVERY_REQUIRED" : undefined,
      );
    }
  } catch (error) {
    if (!commitAttempted) {
      await client.query("ROLLBACK").catch(() => undefined);
      try {
        await clerkClient.invitations.revokeInvitation(invitation.id);
      } catch {
        throw new AuthError(
          503,
          "The invitation could not be finalized or revoked. Contact platform support before retrying.",
          "INVITATION_RECOVERY_REQUIRED",
        );
      }
    }
    throw error;
  } finally {
    client?.release();
  }

  return {
    status: "DISPATCH_REQUESTED" as const,
    dispatchStatus: "REQUEST_ACCEPTED" as const,
    deliveryStatus: "UNVERIFIED" as const,
    deliveryNote: "Clerk accepted the invitation request; inbox delivery is not verified.",
    invitationId: invitation.id,
    email,
    schoolId: input.schoolId,
    role: input.role,
    expiresAt: new Date(
      (invitation.createdAt > 1_000_000_000_000 ? invitation.createdAt : invitation.createdAt * 1000) +
      INVITATION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

export async function createSchoolWithAdministrator(input: {
  school: {
    code: string;
    name: string;
    city: string;
    state: string;
    status?: string;
  };
  administrator: { fullName: string; email: string };
}, actor: UserContext) {
  const school = {
    code: input.school.code.trim().toUpperCase(),
    name: input.school.name.trim(),
    city: input.school.city.trim(),
    state: input.school.state.trim(),
    status: input.school.status?.trim() || "active",
  };
  const email = normalizeEmail(input.administrator.email);
  const fullName = input.administrator.fullName.trim().replace(/\s+/g, " ");
  if (!school.code || school.code.length > 10 || school.name.length < 2 ||
      !school.city || !school.state || fullName.length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError(400, "A valid school and first administrator name and email are required");
  }
  if (!["active", "inactive", "suspended"].includes(school.status)) {
    throw new AuthError(400, "Invalid school status");
  }

  const client = await pool.connect();
  let invitationId: string | null = null;
  let schoolId: number | null = null;
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
      [`first-school-admin:${email}`],
    );
    const created = await client.query(
      `INSERT INTO schools(code,name,city,state,status)
       VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [school.code, school.name, school.city, school.state, school.status],
    );
    schoolId = created.rows[0]?.id;
    if (!schoolId) throw new AuthError(503, "School could not be created");
    const { firstName, lastName } = splitName(fullName);
    const claimId = randomUUID();
    const invitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      expiresInDays: INVITATION_DAYS,
      ignoreExisting: false,
      notify: true,
      redirectUrl: "/accept-invitation",
      publicMetadata: {
        [METADATA_KEY]: {
          version: 1,
          claimId,
          emailProof: emailProof(email),
          schoolId,
          role: "SCHOOL_ADMIN",
          employeeNo: null,
          firstName,
          lastName,
        },
      },
    }).catch((error) => throwClerkInvitationError(error));
    invitationId = invitation.id;
    await auditInvitation(
      client,
      actor,
      schoolId,
      "SCHOOL_ADMIN",
      email,
      "SCHOOL_ADMIN_INVITED",
      null,
      invitation.id,
      claimId,
      fullName,
    );
    commitAttempted = true;
    const resolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM schools WHERE id=$1`,
        [schoolId],
      )).rows[0]),
      revokeInvitation: () => clerkClient.invitations.revokeInvitation(invitation.id),
    });
    if (resolution !== "COMMITTED") {
      throw new AuthError(
        503,
        resolution === "UNKNOWN"
          ? "School and administrator invitation status is uncertain; check the school directory before retrying"
          : "School creation and administrator invitation could not be completed; please retry",
        resolution === "UNKNOWN" ? "INVITATION_RECOVERY_REQUIRED" : undefined,
      );
    }
    return {
      schoolId,
      administratorInvitation: {
        invitationId: invitation.id,
        email,
        role: "SCHOOL_ADMIN",
        status: "DISPATCH_REQUESTED" as const,
        dispatchStatus: "REQUEST_ACCEPTED" as const,
        deliveryStatus: "UNVERIFIED" as const,
        deliveryNote: "Clerk accepted the invitation request; inbox delivery is not verified.",
      },
    };
  } catch (error) {
    if (!commitAttempted) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (invitationId) {
        await clerkClient.invitations.revokeInvitation(invitationId).catch(() => {
          throw new AuthError(
            503,
            "School creation failed and its invitation could not be revoked. Contact platform support before retrying.",
            "INVITATION_RECOVERY_REQUIRED",
          );
        });
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export type ClerkSchoolInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export async function getClerkSchoolInvitation(invitationId: string) {
  const statuses: ClerkSchoolInvitationStatus[] = ["pending", "accepted", "revoked", "expired"];
  try {
    for (const status of statuses) {
      const response = await clerkClient.invitations.getInvitationList({
        query: invitationId,
        status,
      });
      const invitation = response.data.find((item) => item.id === invitationId);
      if (invitation) return invitation;
    }
  } catch {
    throw new AuthError(503, "Clerk invitation status could not be checked");
  }
  throw new AuthError(404, "Invitation not found in Clerk");
}

export async function getClerkSchoolInvitationStatus(invitationId: string) {
  const invitation = await getClerkSchoolInvitation(invitationId);
  return invitation.status as ClerkSchoolInvitationStatus;
}

export async function replaceSchoolAdminInvitation(input: {
  schoolId: number;
  invitationId: string;
  email?: string;
}, actor: UserContext) {
  const target = await pool.query(
    `SELECT id,school_id AS "schoolId",event_type AS "eventType",metadata
     FROM audit_logs
     WHERE school_id=$1 AND metadata->>'invitationId'=$2
       AND event_type='SCHOOL_ADMIN_INVITED'
     ORDER BY timestamp DESC LIMIT 1`,
    [input.schoolId, input.invitationId],
  );
  const source = target.rows[0];
  if (!source) throw new AuthError(404, "School administrator invitation not found");
  const sourceMetadata = typeof source.metadata === "string"
    ? JSON.parse(source.metadata)
    : source.metadata ?? {};
  let oldClaimId = sourceMetadata.claimId;
  const oldEmail = normalizeEmail(String(sourceMetadata.invitedEmail ?? ""));
  const email = normalizeEmail(input.email ?? oldEmail);
  let fullName = [sourceMetadata.firstName, sourceMetadata.lastName]
    .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0)
    .join(" ") || oldEmail;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError(400, "A valid replacement email is required");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(oldEmail)) {
    throw new AuthError(409, "This invitation does not contain enough information to safely replace it");
  }
  const clerkInvitation = await getClerkSchoolInvitation(input.invitationId);
  const clerkMarker = (clerkInvitation.publicMetadata as Record<string, any> | undefined)?.[METADATA_KEY];
  oldClaimId = oldClaimId ?? clerkMarker?.claimId;
  if (fullName === oldEmail) {
    fullName = [clerkMarker?.firstName, clerkMarker?.lastName]
      .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0)
      .join(" ") || oldEmail;
  }
  if (!oldClaimId || !/^[0-9a-f-]{36}$/i.test(oldClaimId) || fullName.length < 2) {
    throw new AuthError(409, "This invitation does not contain enough information to safely replace it");
  }
  const alreadySuperseded = await pool.query(
    `SELECT 1 FROM audit_logs
     WHERE school_id=$1 AND event_type='SCHOOL_INVITATION_SUPERSEDED'
       AND metadata->>'supersedesClaimId'=$2 LIMIT 1`,
    [input.schoolId, oldClaimId],
  );
  if (alreadySuperseded.rows[0]) {
    throw new AuthError(409, "This invitation has already been replaced");
  }
  const clerkStatus = clerkInvitation.status as ClerkSchoolInvitationStatus;
  if (clerkStatus !== "pending" && clerkStatus !== "expired") {
    throw new AuthError(409, "Only pending or expired invitations may be replaced");
  }
  const member = await pool.query(
    `SELECT sm.id,sm.status FROM app_users au
     JOIN school_memberships sm ON sm.user_id=au.id
     WHERE lower(au.email)=lower($1) AND sm.school_id=$2
       AND sm.role='SCHOOL_ADMIN' LIMIT 1`,
    [oldEmail, input.schoolId],
  );
  if (member.rows[0]?.status === "ACTIVE") {
    throw new AuthError(409, "This school administrator is already active");
  }
  const newClaimId = randomUUID();
  const metadata = {
    [METADATA_KEY]: {
      version: 1,
      claimId: newClaimId,
      emailProof: emailProof(email),
      schoolId: input.schoolId,
      role: "SCHOOL_ADMIN",
      studentId: null,
      employeeNo: null,
      ...splitName(fullName),
    },
  };
  const sameAddressResend = email === oldEmail && clerkStatus === "pending";
  let previousInviteRevoked = false;
  if (sameAddressResend) {
    try {
      await clerkClient.invitations.revokeInvitation(input.invitationId);
      previousInviteRevoked = true;
    } catch {
      throw new AuthError(
        503,
        "The previous invitation could not be safely revoked; no replacement was sent.",
        "INVITATION_RECOVERY_REQUIRED",
      );
    }
  }
  const recordSupersededWithoutReplacement = async () => {
    if (!previousInviteRevoked) return;
    let markerClient: any;
    try {
      markerClient = await pool.connect();
      await markerClient.query("BEGIN");
      await markerClient.query(
        `UPDATE audit_logs
         SET metadata=COALESCE(metadata,'{}'::jsonb) ||
           jsonb_build_object('superseded',true,'supersededByClaimId',$1)
         WHERE school_id=$2 AND metadata->>'invitationId'=$3
           AND event_type='SCHOOL_ADMIN_INVITED'`,
        [oldClaimId, input.schoolId, input.invitationId],
      );
      await markerClient.query(
        `INSERT INTO audit_logs
          ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
           severity,event_type,result,metadata)
         VALUES($1,'PLATFORM_OWNER',$2,$3,$4,'Superseded revoked School Administrator invitation',
           'Security',NULL,'info','SCHOOL_INVITATION_SUPERSEDED','SUCCESS',$5)`,
        [
          [actor.user.firstName, actor.user.lastName].filter(Boolean).join(" ") || actor.user.email,
          actor.user.id,
          actor.user.clerkUserId,
          input.schoolId,
          JSON.stringify({
            supersedesClaimId: oldClaimId,
            supersededInvitationId: input.invitationId,
            replacementClaimId: null,
            replacementInvitationId: null,
            oldEmail,
            invitedEmail: email,
            role: "SCHOOL_ADMIN",
          }),
        ],
      );
      await markerClient.query("COMMIT");
    } catch {
      await markerClient?.query("ROLLBACK").catch(() => undefined);
      throw new AuthError(
        503,
        "The previous invitation was revoked but its local status could not be recorded. Contact platform support before retrying.",
        "INVITATION_RECOVERY_REQUIRED",
      );
    } finally {
      markerClient?.release();
    }
  };
  let invitation: Awaited<ReturnType<typeof clerkClient.invitations.createInvitation>>;
  try {
    invitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      expiresInDays: INVITATION_DAYS,
      ignoreExisting: false,
      notify: true,
      redirectUrl: "/accept-invitation",
      publicMetadata: metadata,
    });
  } catch (error) {
    await recordSupersededWithoutReplacement();
    if (previousInviteRevoked) {
      throw new AuthError(
        503,
        "The previous invitation was revoked but Clerk did not confirm a replacement. Check the invitation list before retrying.",
        "INVITATION_RECOVERY_REQUIRED",
      );
    }
    throwClerkInvitationError(error);
  }

  let client: any;
  let commitAttempted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT id FROM audit_logs
       WHERE school_id=$1 AND metadata->>'invitationId'=$2
         AND (metadata->>'claimId'=$3 OR metadata->>'claimId' IS NULL)
         AND event_type='SCHOOL_ADMIN_INVITED'
       FOR UPDATE`,
      [input.schoolId, input.invitationId, oldClaimId],
    );
    if (!locked.rows[0]) throw new AuthError(409, "This invitation changed while it was being replaced");
    const superseded = await client.query(
      `SELECT 1 FROM audit_logs
       WHERE school_id=$1 AND event_type='SCHOOL_INVITATION_SUPERSEDED'
         AND metadata->>'supersedesClaimId'=$2 LIMIT 1`,
      [input.schoolId, oldClaimId],
    );
    if (superseded.rows[0]) throw new AuthError(409, "This invitation has already been replaced");
    const activeMembership = await client.query(
      `SELECT sm.id FROM app_users au
       JOIN school_memberships sm ON sm.user_id=au.id
       WHERE lower(au.email)=lower($1) AND sm.school_id=$2
         AND sm.role='SCHOOL_ADMIN' AND sm.status='ACTIVE' LIMIT 1`,
      [oldEmail, input.schoolId],
    );
    if (activeMembership.rows[0]) throw new AuthError(409, "This school administrator is already active");
    await client.query(
      `UPDATE audit_logs
       SET metadata=COALESCE(metadata,'{}'::jsonb) ||
         jsonb_build_object('superseded',true,'supersededByClaimId',$1,'supersededByInvitationId',$2)
       WHERE school_id=$3 AND metadata->>'invitationId'=$4
         AND event_type='SCHOOL_ADMIN_INVITED'`,
      [newClaimId, invitation.id, input.schoolId, input.invitationId],
    );
    await auditInvitation(
      client,
      actor,
      input.schoolId,
      "SCHOOL_ADMIN",
      email,
      "SCHOOL_ADMIN_INVITED",
      null,
      invitation.id,
      newClaimId,
      fullName,
    );
    await client.query(
      `INSERT INTO audit_logs
        ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
         severity,event_type,result,metadata)
       VALUES($1,'PLATFORM_OWNER',$2,$3,$4,'Replaced School Administrator invitation',
         'Security',NULL,'info','SCHOOL_INVITATION_SUPERSEDED','SUCCESS',$5)`,
      [
        [actor.user.firstName, actor.user.lastName].filter(Boolean).join(" ") || actor.user.email,
        actor.user.id,
        actor.user.clerkUserId,
        input.schoolId,
        JSON.stringify({
          supersedesClaimId: oldClaimId,
          supersededInvitationId: input.invitationId,
          replacementClaimId: newClaimId,
          replacementInvitationId: invitation.id,
          oldEmail,
          invitedEmail: email,
          role: "SCHOOL_ADMIN",
        }),
      ],
    );
    commitAttempted = true;
    const resolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM audit_logs WHERE metadata->>'invitationId'=$1 LIMIT 1`,
        [invitation.id],
      )).rows[0]),
      revokeInvitation: () => clerkClient.invitations.revokeInvitation(invitation.id),
    });
    if (resolution !== "COMMITTED") {
      throw new AuthError(
        503,
        resolution === "UNKNOWN"
          ? "Invitation replacement status is uncertain; do not resend. Check the invitation list before retrying."
          : "Invitation replacement could not be completed; please retry",
        resolution === "UNKNOWN" ? "INVITATION_RECOVERY_REQUIRED" : undefined,
      );
    }
  } catch (error) {
    if (!commitAttempted) {
      await client?.query("ROLLBACK").catch(() => undefined);
      try {
        await clerkClient.invitations.revokeInvitation(invitation.id);
      } catch {
        await recordSupersededWithoutReplacement();
        throw new AuthError(
          503,
          "The replacement invitation could not be finalized or revoked. Contact platform support before retrying.",
          "INVITATION_RECOVERY_REQUIRED",
        );
      }
    }
    await recordSupersededWithoutReplacement();
    throw error;
  } finally {
    client?.release();
  }

  if (!previousInviteRevoked) {
    try {
      await clerkClient.invitations.revokeInvitation(input.invitationId);
      previousInviteRevoked = true;
    } catch {
      previousInviteRevoked = false;
    }
  }
  return {
    status: "PENDING" as const,
    invitationId: invitation.id,
    supersededInvitationId: input.invitationId,
    previousInviteRevoked,
    email,
    schoolId: input.schoolId,
    role: "SCHOOL_ADMIN" as const,
    dispatchStatus: "REQUEST_ACCEPTED" as const,
    deliveryStatus: "UNVERIFIED" as const,
    expiresAt: new Date(
      (invitation.createdAt > 1_000_000_000_000 ? invitation.createdAt : invitation.createdAt * 1000) +
      INVITATION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

export type AcceptedInvitation = {
  claimId: string;
  emailProof: string;
  schoolId: number;
  role: InvitationRole;
  employeeNo: string | null;
  firstName: string | null;
  lastName: string | null;
  studentId: number | null;
};

export function acceptedInvitationFromMetadata(metadata: unknown, email: string): AcceptedInvitation | null {
  if (!metadata || typeof metadata !== "object") return null;
  const marker = (metadata as Record<string, unknown>)[METADATA_KEY];
  if (!marker || typeof marker !== "object") return null;
  const invite = marker as Record<string, unknown>;
  if (
    invite.version !== 1 ||
    typeof invite.claimId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(invite.claimId) ||
    !isInvitationRole(invite.role) ||
    !Number.isInteger(invite.schoolId) ||
    Number(invite.schoolId) < 1 ||
    (invite.firstName !== undefined && (typeof invite.firstName !== "string" || invite.firstName.length > 100)) ||
    (invite.lastName !== undefined && invite.lastName !== null &&
      (typeof invite.lastName !== "string" || invite.lastName.length > 100)) ||
    (invite.studentId !== undefined && invite.studentId !== null &&
      (!Number.isInteger(invite.studentId) || Number(invite.studentId) < 1)) ||
    (invite.role === "STUDENT" && (!Number.isInteger(invite.studentId) || Number(invite.studentId) < 1)) ||
    (invite.role !== "STUDENT" && invite.studentId !== undefined && invite.studentId !== null) ||
    !matchesEmailProof(email, invite.emailProof)
  ) {
    throw new AuthError(403, "This invitation does not match the authenticated account");
  }
  if (
    (invite.role === "TEACHER" || invite.role === "STAFF") &&
    (typeof invite.employeeNo !== "string" || !/^INV-[A-F0-9]{16}$/.test(invite.employeeNo))
  ) {
    throw new AuthError(403, "This invitation is incomplete");
  }
  return {
    claimId: invite.claimId,
    emailProof: invite.emailProof as string,
    schoolId: Number(invite.schoolId),
    role: invite.role,
    employeeNo: typeof invite.employeeNo === "string" ? invite.employeeNo : null,
    firstName: typeof invite.firstName === "string" ? invite.firstName.trim() || null : null,
    lastName: typeof invite.lastName === "string" ? invite.lastName.trim() || null : null,
    studentId: Number.isInteger(invite.studentId) ? Number(invite.studentId) : null,
  };
}

export async function activateAcceptedSchoolInvitation(userId: number, clerkUserId: string) {
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const primaryEmail = clerkUser.primaryEmailAddress;
  const email = primaryEmail?.verification?.status === "verified"
    ? normalizeEmail(primaryEmail.emailAddress)
    : "";
  if (!email) return false;
  const invite = acceptedInvitationFromMetadata(clerkUser.publicMetadata, email);
  if (!invite) return false;

  const school = await pool.query(`SELECT id FROM schools WHERE id=$1`, [invite.schoolId]);
  if (!school.rows[0]) throw new AuthError(403, "The invitation school is no longer available");

  const client = await pool.connect();
  let changedMembership = false;
  try {
    await client.query("BEGIN");
    const user = await client.query(
      `SELECT id,email,status FROM app_users WHERE id=$1 AND clerk_user_id=$2 FOR UPDATE`,
      [userId, clerkUserId],
    );
    if (!user.rows[0] || normalizeEmail(user.rows[0].email) !== email || user.rows[0].status !== "ACTIVE") {
      throw new AuthError(403, "The invitation does not match an active account");
    }
    const liveClaim = await client.query(
      `SELECT current_invite.id FROM audit_logs current_invite
       WHERE current_invite.school_id=$1
         AND (
           current_invite.metadata->>'claimId'=$2
           OR (current_invite.metadata->>'claimId' IS NULL
             AND lower(current_invite.metadata->>'invitedEmail')=lower($3)
             AND current_invite.metadata->>'role'=$4)
         )
         AND current_invite.metadata->>'invitationId' IS NOT NULL
         AND current_invite.metadata->>'superseded' IS DISTINCT FROM 'true'
         AND current_invite.event_type IN ('SCHOOL_ADMIN_INVITED','USER_INVITED')
         AND NOT EXISTS (
           SELECT 1 FROM audit_logs superseded
           WHERE superseded.school_id=current_invite.school_id
             AND superseded.event_type='SCHOOL_INVITATION_SUPERSEDED'
             AND superseded.metadata->>'supersedesClaimId'=$2
         )
       ORDER BY current_invite.timestamp DESC LIMIT 1 FOR UPDATE`,
      [invite.schoolId, invite.claimId, email, invite.role],
    );
    if (!liveClaim.rows[0]) {
      throw new AuthError(403, "This invitation has been replaced or is no longer active");
    }
    const activationOfficer = await client.query(
      `SELECT 1 FROM school_memberships
       WHERE user_id = $1 AND role = 'DEVICE_ACTIVATION_OFFICER'
         AND status = 'ACTIVE' LIMIT 1`,
      [userId],
    );
    if (activationOfficer.rows[0]) {
      throw new AuthError(403, "Device Activation Officer accounts cannot be activated through ordinary school invitations");
    }
    const existing = await client.query(
      `SELECT id,status FROM school_memberships
       WHERE user_id=$1 AND school_id=$2 AND role=$3 FOR UPDATE`,
      [userId, invite.schoolId, invite.role],
    );

    if (!existing.rows[0]) {
      const firstName = clerkUser.firstName?.trim() || invite.firstName;
      const lastName = clerkUser.lastName?.trim() || invite.lastName;
      const phone = clerkUser.phoneNumbers[0]?.phoneNumber ?? null;
      await client.query(
        `UPDATE app_users SET first_name=COALESCE($1,first_name),
           last_name=COALESCE($2,last_name),phone=COALESCE($3,phone),updated_at=NOW()
         WHERE id=$4`,
        [firstName, lastName, phone, userId],
      );
      const activationInput: InviteeInput = {
        schoolId: invite.schoolId,
        email,
        fullName: [firstName, lastName].filter(Boolean).join(" ") || email,
        phone,
        role: invite.role,
        studentId: invite.studentId,
      };
      await ensureActivatedProfile(client, activationInput, userId, invite.employeeNo ?? undefined);
      const membership = await client.query(
        `INSERT INTO school_memberships(user_id,school_id,role,status)
         VALUES($1,$2,$3,'ACTIVE')
         ON CONFLICT(user_id,school_id,role) DO NOTHING
         RETURNING id`,
        [userId, invite.schoolId, invite.role],
      );
      if (membership.rows[0]) {
        changedMembership = true;
        const actorRole = invite.role;
        await client.query(
          `INSERT INTO audit_logs
            ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
             severity,event_type,result,metadata)
           VALUES($1,$2,$3,$4,$5,$6,'Security',$7,'info','USER_ACTIVATED','SUCCESS',$8)`,
          [
            [firstName, lastName].filter(Boolean).join(" ") || email,
            actorRole,
            userId,
            clerkUserId,
            invite.schoolId,
            `Activated ${invite.role.replaceAll("_", " ")} account`,
            membership.rows[0].id,
            JSON.stringify({ role: invite.role, activationSource: "CLERK_INVITATION", claimId: invite.claimId }),
          ],
        );
      }
    } else if (existing.rows[0].status !== "ACTIVE") {
      // A prior explicit deactivation wins over stale accepted-invitation metadata.
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  await clerkClient.users.updateUserMetadata(clerkUserId, {
    publicMetadata: { [METADATA_KEY]: null },
  });
  if (changedMembership) {
    await queueSchoolAccountNotification({
      recipientUserId: userId,
      schoolId: invite.schoolId,
      role: invite.role,
      eventKey: `school-invitation:${invite.claimId}:activated`,
      body: `Your ${invite.role.replaceAll("_", " ").toLowerCase()} access to this school is active.`,
    });
  }
  return changedMembership;
}