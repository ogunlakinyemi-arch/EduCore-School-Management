import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { AuthError, type Role, type UserContext } from "../middlewares/auth";

export const INVITABLE_SCHOOL_ROLES = [
  "SCHOOL_ADMIN",
  "TEACHER",
  "ACCOUNTANT",
  "STAFF",
  "PARENT",
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
    "The invitation email could not be sent. No access was granted.",
    "INVITATION_DELIVERY_FAILED",
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
      JSON.stringify({ invitedEmail: email, role, invitationId: invitationId ?? null }),
    ],
  );
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
      redirectUrl: "/",
      publicMetadata: metadata,
    });
  } catch (error) {
    throwClerkInvitationError(error);
  }

  let client: any;
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
    );
    await client.query("COMMIT");
  } catch (error) {
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
    throw error;
  } finally {
    client?.release();
  }

  return {
    status: "INVITATION_SENT" as const,
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

export type AcceptedInvitation = {
  claimId: string;
  emailProof: string;
  schoolId: number;
  role: InvitationRole;
  employeeNo: string | null;
  firstName: string | null;
  lastName: string | null;
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
  };
}

export async function activateAcceptedSchoolInvitation(userId: number, clerkUserId: string) {
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email = normalizeEmail(
    clerkUser.primaryEmailAddress?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      "",
  );
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
  return changedMembership;
}