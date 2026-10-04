import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { generateSchoolCode } from "../lib/generated-person-codes";
import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { AuthError, type Role, type UserContext } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { queueCommunicationNotification } from "../services/communication-service";
import { commitInvitationWithRecovery } from "./partner-commit-recovery";
import { invitationRedirect } from "./invitation-redirect";

export const INVITABLE_SCHOOL_ROLES = [
  "SCHOOL_ADMIN",
  "TEACHER",
  "ACCOUNTANT",
  "STAFF",
  "DRIVER",
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
  personId?: number | null;
  studentId?: number | null;
  /** Derived from the selected persisted profile, never accepted from the API body. */
  invitationEmployeeNo?: string | null;
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

function clerkRejectionStatus(error: unknown) {
  const status = (error as { status?: number; statusCode?: number } | null)?.status ??
    (error as { statusCode?: number } | null)?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500 ? status : null;
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
  replacementAttemptId?: string,
  phone?: string | null,
  attemptId?: string,
  dispatchStatus?: string,
) {
  const actorRole = actor.roles.find((item) =>
    item.schoolId === schoolId && item.role === "SCHOOL_ADMIN"
  )?.role ?? actor.roles.find((item) =>
    item.role === "PLATFORM_OWNER" && item.schoolId === null
  )?.role ?? actor.roles.find((item) =>
    ["PARTNER", "PARTNER_OWNER", "PARTNER_ADMIN"].includes(item.role)
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
        ...(replacementAttemptId ? { replacementAttemptId } : {}),
        ...(phone ? { phone } : {}),
        ...(attemptId ? { attemptId } : {}),
        ...(dispatchStatus ? { dispatchStatus } : {}),
        ...splitName(fullName ?? ""),
      }),
    ],
  );
}

async function activatePendingSchool(
  client: any,
  schoolId: number,
  actor: { name: string; role: string; userId: number; clerkUserId: string },
  membershipId: number,
  role: InvitationRole,
  claimId: string,
  activationSource: "CLERK_INVITATION" | "VERIFIED_EXISTING_ACCOUNT",
) {
  const activated = await client.query(
    `UPDATE schools SET status='active'
     WHERE id=$1 AND status='pending'
     RETURNING id`,
    [schoolId],
  );
  if (!activated.rows[0]) return false;
  await client.query(
    `INSERT INTO audit_logs
      ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
       severity,event_type,result,metadata)
     VALUES($1,$2,$3,$4,$5,'Activated school after administrator verification',
       'Security',$6,'info','SCHOOL_ACTIVATED','SUCCESS',$7)`,
    [
      actor.name,
      actor.role,
      actor.userId,
      actor.clerkUserId,
      schoolId,
      membershipId,
      JSON.stringify({ role, activationSource, claimId }),
    ],
  );
  const partnerAttribution = await client.query(
    `SELECT partner_profile_id AS "partnerId" FROM school_partner_attributions
     WHERE school_id=$1 AND source='PARTNER_DIRECT'
     ORDER BY starts_at LIMIT 1`,
    [schoolId],
  );
  if (partnerAttribution.rows[0]) {
    await client.query(
      `INSERT INTO audit_logs
        ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
         severity,event_type,result,metadata)
       VALUES($1,$2,$3,$4,$5,'Completed partner school registration','Partners',$6,
         'info','PARTNER_SCHOOL_REGISTRATION_COMPLETED','SUCCESS',$7::jsonb)`,
      [
        actor.name,
        actor.role,
        actor.userId,
        actor.clerkUserId,
        schoolId,
        membershipId,
        JSON.stringify({
          partnerId: partnerAttribution.rows[0].partnerId,
          schoolId,
          registrationStatus: "ACTIVE",
          claimId,
          activationSource,
        }),
      ],
    );
  }
  return true;
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
    const parent = input.personId
      ? await client.query(
        `SELECT id,user_id AS "userId" FROM parents
         WHERE school_id=$1 AND id=$2 AND lower(email)=lower($3) FOR UPDATE`,
        [input.schoolId, input.personId, input.email],
      )
      : await client.query(
        `SELECT id,user_id AS "userId" FROM parents
         WHERE school_id=$1 AND lower(email)=lower($2) ORDER BY id FOR UPDATE`,
        [input.schoolId, input.email],
      );
    if (input.personId && !parent.rows[0]) {
      throw new AuthError(409, "The selected parent profile changed before the invitation was saved");
    }
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
    const student = input.personId
      ? await client.query(
        `SELECT id,user_id AS "userId" FROM students
         WHERE id=$1 AND school_id=$2 AND lower(email)=lower($3) FOR UPDATE`,
        [input.studentId, input.schoolId, input.email],
      )
      : await client.query(
        `SELECT id,user_id AS "userId" FROM students
         WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [input.studentId, input.schoolId],
      );
    if (!student.rows[0]) throw new AuthError(404, "Student profile not found in this school");
    if (student.rows[0].userId) throw new AuthError(409, "This student profile is already linked to an account");
  }

  if (input.role === "TEACHER" || input.role === "ACCOUNTANT" || input.role === "STAFF" || input.role === "DRIVER") {
    const employee = input.personId
      ? await client.query(
        `SELECT id,user_id AS "userId",employee_type AS "type",
                employment_status AS status,employee_no AS "employeeNo"
         FROM employees
         WHERE school_id=$1 AND id=$2 AND lower(email)=lower($3) AND employee_type=$4 FOR UPDATE`,
        [input.schoolId, input.personId, input.email, input.role],
      )
      : await client.query(
        `SELECT id,user_id AS "userId",employee_type AS "type",
                employment_status AS status,employee_no AS "employeeNo"
         FROM employees
         WHERE school_id=$1 AND lower(email)=lower($2)
         ORDER BY id FOR UPDATE`,
        [input.schoolId, input.email],
      );
    if (input.personId && !employee.rows[0]) {
      throw new AuthError(409, "The selected employee profile changed before the invitation was saved");
    }
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
        if (employee.rows[0].employeeNo !== employeeNo) {
          throw new AuthError(409, "The employee number is permanent; select the existing profile and use its invitation recovery workflow");
        }
        const { firstName: employeeFirstName, lastName } = splitName(input.fullName);
        await client.query(
          `UPDATE employees SET first_name=$1,last_name=$2,
             phone=$3,updated_at=NOW()
           WHERE id=$4`,
          [employeeFirstName, lastName, input.phone, employee.rows[0].id],
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

  if (input.role === "TEACHER" || input.role === "ACCOUNTANT" || input.role === "STAFF" || input.role === "DRIVER") {
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
  claim: { claimId: string; emailProof: string },
) {
  if (!/^[0-9a-f-]{36}$/i.test(claim.claimId) || !matchesEmailProof(input.email, claim.emailProof)) {
    throw new AuthError(403, "This invitation claim does not match the verified account");
  }
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
    const employeeNo = input.invitationEmployeeNo || `ACT-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
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
    if (input.role === "SCHOOL_ADMIN") {
      const actorRole = actor.roles.find((item) =>
        item.schoolId === input.schoolId && item.role === "SCHOOL_ADMIN"
      )?.role ?? actor.roles.find((item) =>
        item.role === "PLATFORM_OWNER" && item.schoolId === null
      )?.role ?? "AUTHENTICATED";
      await activatePendingSchool(
        client,
        input.schoolId,
        {
          name: [actor.user.firstName, actor.user.lastName].filter(Boolean).join(" ") || actor.user.email,
          role: actorRole,
          userId: actor.user.id,
          clerkUserId: actor.user.clerkUserId,
        },
        membership.rows[0].id,
        input.role,
        claim.claimId,
        "VERIFIED_EXISTING_ACCOUNT",
      );
    }
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

async function resolveExistingInvitee(input: InviteeInput): Promise<InviteeInput> {
  if (!Number.isSafeInteger(input.personId) || Number(input.personId) < 1) {
    throw new AuthError(400, "Select an existing school profile before activation");
  }
  let result;
  if (input.role === "PARENT") {
    result = await pool.query(
      `SELECT id AS "personId",name AS "fullName",email,phone,status,user_id AS "userId"
         FROM parents WHERE id=$1 AND school_id=$2`,
      [input.personId, input.schoolId],
    );
  } else if (input.role === "STUDENT") {
    result = await pool.query(
      `SELECT id AS "personId",concat_ws(' ',first_name,middle_name,last_name) AS "fullName",
              email,NULL::text AS phone,status,user_id AS "userId"
         FROM students WHERE id=$1 AND school_id=$2`,
      [input.personId, input.schoolId],
    );
  } else {
    result = await pool.query(
      `SELECT id AS "personId",concat_ws(' ',first_name,middle_name,last_name) AS "fullName",
              email,phone,employment_status AS status,user_id AS "userId",employee_type AS "type",employee_no AS "employeeNo"
         FROM employees WHERE id=$1 AND school_id=$2 AND employee_type=$3`,
      [input.personId, input.schoolId, input.role],
    );
  }
  const profile = result.rows[0];
  if (!profile) throw new AuthError(404, "Selected school profile not found");
  if (input.role !== "STUDENT" && input.role !== "PARENT" && profile.type !== input.role) {
    throw new AuthError(409, "Selected employee profile does not match the requested role");
  }
  if (profile.userId) throw new AuthError(409, "This school profile is already linked to an account");
  const status = String(profile.status ?? "").toUpperCase();
  if (!["ACTIVE", "PENDING"].includes(status)) {
    throw new AuthError(409, "Selected school profile is inactive and cannot be activated");
  }
  const email = typeof profile.email === "string" ? profile.email.trim() : "";
  const fullName = typeof profile.fullName === "string" ? profile.fullName.trim().replace(/\s+/g, " ") : "";
  const phone = typeof profile.phone === "string" && profile.phone.trim() ? profile.phone.trim() : null;
  if (!email) throw new AuthError(409, "The selected school profile has no email. Correct its profile before activation.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError(409, "The selected school profile has an invalid email. Correct its profile before activation.");
  }
  if (fullName.length < 2) throw new AuthError(409, "The selected school profile has no valid name. Correct its profile before activation.");
  if (input.role === "PARENT" && !phone) {
    throw new AuthError(409, "The selected parent profile has no phone number. Correct its profile before activation.");
  }
  if (phone && !/^\+?[0-9][0-9\s()-]{7,24}$/.test(phone)) {
    throw new AuthError(409, "The selected school profile has an invalid phone. Correct its profile before activation.");
  }
  return {
    ...input,
    email,
    fullName,
    phone,
    studentId: input.role === "STUDENT" ? Number(profile.personId) : null,
    invitationEmployeeNo: typeof profile.employeeNo === "string" && /^INV-[A-F0-9]{16}$/.test(profile.employeeNo)
      ? profile.employeeNo : null,
  };
}

export async function createSchoolInvitation(input: InviteeInput, actor: UserContext) {
  input = input.personId == null ? input : await resolveExistingInvitee(input);
  if (input.personId != null) {
    const activationOfficer = await pool.query(
      `SELECT 1 FROM app_users au
       JOIN school_memberships sm ON sm.user_id = au.id
       WHERE lower(au.email) = lower($1)
         AND sm.role = 'DEVICE_ACTIVATION_OFFICER' AND sm.status = 'ACTIVE'
       LIMIT 1`,
      [input.email],
    );
    if (activationOfficer.rows[0]) {
      throw new AuthError(403, "A Device Activation Officer cannot be invited to an ordinary school role");
    }
  }
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
    return provisionExistingAccount(normalizedInput, localUsers.rows[0], actor, {
      claimId: randomUUID(),
      emailProof: emailProof(verifiedEmail),
    });
  }

  const claimId = randomUUID();
  const employeeNo = input.invitationEmployeeNo || `INV-${claimId.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  const metadata = {
    [METADATA_KEY]: {
      version: 1,
      claimId,
      emailProof: emailProof(email),
      schoolId: input.schoolId,
      role: input.role,
      ...splitName(fullName),
      studentId: input.role === "STUDENT" ? input.studentId : null,
      employeeNo: input.role === "TEACHER" || input.role === "ACCOUNTANT" || input.role === "STAFF" || input.role === "DRIVER" ? employeeNo : null,
    },
  };

  let invitation: Awaited<ReturnType<typeof clerkClient.invitations.createInvitation>>;
  try {
    invitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      expiresInDays: INVITATION_DAYS,
      ignoreExisting: false,
      notify: true,
      redirectUrl: invitationRedirect("/accept-invitation"),
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
    code?: string;
    name: string;
    city: string;
    state: string;
    status?: string;
    phone?: string;
    email?: string;
  };
  administrator: { fullName: string; email: string; phone?: string };
  partnerId?: number;
}, actor: UserContext) {
  const school = {
    code: input.school.code?.trim().toUpperCase() || generateSchoolCode(input.school.name),
    name: input.school.name.trim(),
    city: input.school.city.trim(),
    state: input.school.state.trim(),
    requestedStatus: input.school.status?.trim() || "active",
    phone: input.school.phone?.trim() || null,
    email: input.school.email?.trim().toLowerCase() || null,
  };
  const email = normalizeEmail(input.administrator.email);
  const fullName = input.administrator.fullName.trim().replace(/\s+/g, " ");
  const administratorPhone = input.administrator.phone?.trim() || null;
  if (!school.code || school.code.length > 10 || school.name.length < 2 ||
      !school.city || !school.state || fullName.length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError(400, "A valid school and first administrator name and email are required");
  }
  if (input.partnerId !== undefined) {
    if (!Number.isInteger(input.partnerId) || input.partnerId < 1 || !administratorPhone) {
      throw new AuthError(400, "A valid partner, school, and administrator phone number are required");
    }
    if (school.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(school.email)) {
      throw new AuthError(400, "A valid school email is required");
    }
    if (school.phone && school.phone.length > 40 || school.email && school.email.length > 254 ||
        administratorPhone.length > 40 || school.name.length > 200 ||
        school.city.length > 100 || school.state.length > 100 || fullName.length > 200) {
      throw new AuthError(400, "School or administrator information exceeds the allowed length");
    }
    return createPartnerSchoolWithAdministrator({
      school,
      administrator: { fullName, email, phone: administratorPhone },
      partnerId: input.partnerId,
    }, actor);
  }
  if (!["active", "inactive", "suspended"].includes(school.requestedStatus)) {
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
       VALUES($1,$2,$3,$4,'pending') RETURNING id`,
      [school.code, school.name, school.city, school.state],
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
      redirectUrl: invitationRedirect("/accept-invitation"),
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

async function findSchoolInvitationForClaim(email: string, schoolId: number, claimId: string) {
  const statuses: ClerkSchoolInvitationStatus[] = ["pending", "accepted", "revoked", "expired"];
  const matches = new Map<string, any>();
  for (const status of statuses) {
    let offset = 0;
    let totalCount: number | null = null;
    while (totalCount === null || offset < totalCount) {
      const response = await clerkClient.invitations.getInvitationList({
        query: email,
        status,
        limit: 100,
        offset,
      });
      if (!Array.isArray(response.data) || !Number.isInteger(response.totalCount) || response.totalCount < 0) {
        throw new Error("Clerk returned incomplete invitation pagination data");
      }
      totalCount = response.totalCount;
      for (const invitation of response.data as any[]) {
        const marker = (invitation.publicMetadata as Record<string, any> | undefined)?.[METADATA_KEY];
        if (
          normalizeEmail(invitation.emailAddress) === email &&
          marker?.claimId === claimId &&
          Number(marker?.schoolId) === schoolId &&
          marker?.role === "SCHOOL_ADMIN"
        ) {
          matches.set(invitation.id, invitation);
        }
      }
      if (response.data.length === 0 && offset < totalCount) {
        throw new Error("Clerk invitation pagination ended before all matches were read");
      }
      offset += response.data.length;
    }
  }
  return [...matches.values()];
}

async function auditPartnerSchoolRegistration(
  client: any,
  actor: UserContext,
  schoolId: number,
  partnerId: number,
  action: string,
  eventType: string,
  metadata: Record<string, unknown>,
) {
  const role = actor.roles.find((item) =>
    ["PARTNER", "PARTNER_OWNER", "PARTNER_ADMIN"].includes(item.role)
  )?.role ?? "AUTHENTICATED";
  const name = [actor.user.firstName, actor.user.lastName].filter(Boolean).join(" ") || actor.user.email;
  await client.query(
    `INSERT INTO audit_logs
      ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
       severity,event_type,result,metadata)
     VALUES($1,$2,$3,$4,$5,$6,'Partners',$5,'info',$7,'SUCCESS',$8::jsonb)`,
    [
      name,
      role,
      actor.user.id,
      actor.user.clerkUserId,
      schoolId,
      action,
      eventType,
      JSON.stringify({ partnerId, schoolId, ...metadata }),
    ],
  );
}

async function createPartnerSchoolWithAdministrator(input: {
  school: {
    code: string;
    name: string;
    city: string;
    state: string;
    phone: string | null;
    email: string | null;
  };
  administrator: { fullName: string; email: string; phone: string };
  partnerId: number;
}, actor: UserContext) {
  const { school, administrator, partnerId } = input;
  const { firstName, lastName } = splitName(administrator.fullName);
  const claimId = randomUUID();
  const attemptId = randomUUID();
  const client = await pool.connect();
  let invitationId: string | null = null;
  let schoolId: number | null = null;
  let attemptAuditId: number | null = null;
  let advisoryLocks: string[] = [];
  let providerCallStarted = false;
  let commitAttempted = false;
  let phase1Committed = false;
  let transactionStarted = false;
  let discardClient = false;
  let providerOutcomeUnknown = false;
  try {
    advisoryLocks = [
      `first-school-admin:${administrator.email}`,
      `partner-school-name:${school.name.toLowerCase()}`,
      school.email ? `partner-school-email:${school.email}` : null,
      school.phone ? `partner-school-phone:${school.phone.replace(/\D/g, "")}` : null,
    ].filter((value): value is string => Boolean(value)).sort();
    await client.query(
      `SELECT pg_advisory_lock(hashtextextended(identity,0))
       FROM unnest($1::text[]) AS identities(identity) ORDER BY identity`,
      [advisoryLocks],
    );
    const openAttempt = await client.query(
      `SELECT id FROM audit_logs
       WHERE event_type='PARTNER_SCHOOL_REGISTRATION_ATTEMPT'
         AND metadata->>'attemptStatus' IN (
           'PREPARED','DISPATCHING','OUTCOME_UNKNOWN','UNKNOWN_PROVIDER_STATE','MULTIPLE_MATCHES'
         )
         AND (
           lower(trim(metadata->>'administratorEmail'))=$1
           OR lower(trim(metadata->>'schoolName'))=$2
         )
       ORDER BY timestamp DESC LIMIT 1`,
      [administrator.email, school.name.toLowerCase()],
    );
    if (openAttempt.rows[0]) {
      throw new AuthError(
        409,
        "A previous school registration or invitation attempt has an unresolved provider outcome; reconcile it before retrying",
        "INVITATION_RECOVERY_REQUIRED",
      );
    }
    const stagedAttempt = await client.query(
      `INSERT INTO audit_logs
        ("user",role,actor_user_id,clerk_user_id,action,module,event_type,result,metadata)
       VALUES($1,$2,$3,$4,'Prepared partner school registration','Partners',
         'PARTNER_SCHOOL_REGISTRATION_ATTEMPT','SUCCESS',$5::jsonb)
       RETURNING id`,
      [
        [actor.user.firstName, actor.user.lastName].filter(Boolean).join(" ") || actor.user.email,
        actor.roles.find((item) => ["PARTNER", "PARTNER_OWNER", "PARTNER_ADMIN"].includes(item.role))?.role ??
          "AUTHENTICATED",
        actor.user.id,
        actor.user.clerkUserId,
        JSON.stringify({
          attemptId,
          attemptStatus: "PREPARED",
          partnerId,
          administratorEmail: administrator.email,
          administratorPhone: administrator.phone,
          administratorName: administrator.fullName,
          schoolName: school.name,
          schoolCity: school.city,
          schoolState: school.state,
          schoolCode: school.code,
          schoolEmail: school.email,
          schoolPhone: school.phone,
          claimId,
          source: "PARTNER_DIRECT",
        }),
      ],
    );
    attemptAuditId = Number(stagedAttempt.rows[0]?.id);
    if (!attemptAuditId) throw new AuthError(503, "School registration attempt could not be recorded");

    await client.query("BEGIN");
    transactionStarted = true;

    const duplicateSchool = await client.query(
      `SELECT id FROM schools
       WHERE lower(trim(name))=lower(trim($1))
          OR ($2::text IS NOT NULL AND email IS NOT NULL AND lower(trim(email))=lower(trim($2)))
          OR ($3::text IS NOT NULL AND phone IS NOT NULL
              AND regexp_replace(phone,'\\D','','g')=regexp_replace($3,'\\D','','g'))
       ORDER BY id LIMIT 1 FOR UPDATE`,
      [school.name, school.email, school.phone],
    );
    if (duplicateSchool.rows[0]) {
      throw new AuthError(409, "A school with this name, email, or phone already exists");
    }
    const existingUser = await client.query(
      `SELECT id FROM app_users WHERE lower(trim(email))=$1 ORDER BY id LIMIT 2 FOR UPDATE`,
      [administrator.email],
    );
    if (existingUser.rows.length) {
      throw new AuthError(409, "This administrator email already belongs to an EduCore account");
    }
    const existingInvitation = await client.query(
      `SELECT id FROM audit_logs
       WHERE event_type='SCHOOL_ADMIN_INVITED'
         AND lower(trim(metadata->>'invitedEmail'))=$1
         AND metadata->>'superseded' IS DISTINCT FROM 'true'
         AND (
           metadata->>'invitationId' IS NOT NULL
           OR metadata->>'dispatchStatus' IN (
             'DISPATCHING','UNKNOWN_PROVIDER_STATE','OUTCOME_UNKNOWN','REGISTERED_OR_PENDING'
           )
         )
       ORDER BY timestamp DESC LIMIT 1 FOR UPDATE`,
      [administrator.email],
    );
    if (existingInvitation.rows[0]) {
      throw new AuthError(409, "This administrator email already has a school invitation; use the existing invitation workflow");
    }

    const created = await client.query(
      `INSERT INTO schools(code,name,city,state,status,phone,email)
       VALUES($1,$2,$3,$4,'pending',$5,$6) RETURNING id`,
      [school.code, school.name, school.city, school.state, school.phone, school.email],
    );
    schoolId = Number(created.rows[0]?.id);
    if (!schoolId) throw new AuthError(503, "School could not be created");
    await client.query(
      `UPDATE audit_logs SET school_id=$1::integer,
         metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('schoolId',$1::integer,'attemptStatus','DISPATCHING')
       WHERE id=$2`,
      [schoolId, attemptAuditId],
    );

    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
      [`school-attribution:${schoolId}`],
    );
    await client.query(
      `INSERT INTO school_partner_attributions
        (school_id,partner_profile_id,referral_link_id,source,status,is_current,created_by)
       VALUES($1,$2,NULL,'PARTNER_DIRECT','ACTIVE',true,$3)`,
      [schoolId, partnerId, actor.user.id],
    );
    await auditPartnerSchoolRegistration(
      client, actor, schoolId, partnerId, "Partner registered pending school", "PARTNER_SCHOOL_REGISTERED",
      { source: "PARTNER_DIRECT", schoolName: school.name, administratorEmail: administrator.email },
    );
    await auditPartnerSchoolRegistration(
      client, actor, schoolId, partnerId, "Established permanent partner-school relationship",
      "PARTNER_SCHOOL_ATTRIBUTION_ESTABLISHED", { source: "PARTNER_DIRECT" },
    );

    // Commit the school, immutable partner attribution, dispatch claim, and audit evidence
    // before calling Clerk. A lost provider response can then never strand an invite whose
    // school/claim disappeared in a rollback.
    await auditInvitation(
      client,
      actor,
      schoolId,
      "SCHOOL_ADMIN",
      administrator.email,
      "SCHOOL_ADMIN_INVITED",
      null,
      undefined,
      claimId,
      administrator.fullName,
      undefined,
      administrator.phone,
      attemptId,
      "DISPATCHING",
    );
    await client.query(
      `UPDATE audit_logs
       SET metadata=COALESCE(metadata,'{}'::jsonb) ||
         '{"attemptStatus":"DISPATCHING","dispatchStatus":"DISPATCHING"}'::jsonb
       WHERE id=$1`,
      [attemptAuditId],
    );
    commitAttempted = true;
    const preparedResolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM schools s
         JOIN school_partner_attributions a ON a.school_id=s.id
           AND a.partner_profile_id=$2 AND a.source='PARTNER_DIRECT' AND a.is_current=true
         WHERE s.id=$1 AND EXISTS (
           SELECT 1 FROM audit_logs claim WHERE claim.school_id=s.id
             AND claim.event_type='SCHOOL_ADMIN_INVITED'
             AND claim.metadata->>'claimId'=$3
             AND claim.metadata->>'role'='SCHOOL_ADMIN'
             AND lower(claim.metadata->>'invitedEmail')=$4
         )`,
        [schoolId, partnerId, claimId, administrator.email],
      )).rows[0]),
    });
    transactionStarted = false;
    if (preparedResolution !== "COMMITTED") {
      discardClient = preparedResolution === "UNKNOWN";
      if (preparedResolution === "ABORTED") {
        await pool.query(
          `UPDATE audit_logs SET metadata=COALESCE(metadata,'{}'::jsonb) ||
             '{"attemptStatus":"FAILED","dispatchStatus":"NOT_DISPATCHED"}'::jsonb WHERE id=$1`,
          [attemptAuditId],
        ).catch(() => undefined);
      }
      throw new AuthError(
        503,
        preparedResolution === "UNKNOWN"
          ? "School registration preparation is uncertain; no invitation was sent. Reconcile before retrying."
          : "School registration could not be prepared; no invitation was sent.",
        "INVITATION_RECOVERY_REQUIRED",
      );
    }
    phase1Committed = true;
    commitAttempted = false;

    let invitation: any;
    providerCallStarted = true;
    try {
      invitation = await clerkClient.invitations.createInvitation({
        emailAddress: administrator.email,
        expiresInDays: INVITATION_DAYS,
        ignoreExisting: false,
        notify: true,
        redirectUrl: invitationRedirect("/accept-invitation"),
        publicMetadata: {
          [METADATA_KEY]: {
            version: 1,
            claimId,
            emailProof: emailProof(administrator.email),
            schoolId,
            role: "SCHOOL_ADMIN",
            employeeNo: null,
            firstName,
            lastName,
            partnerRegistrationAttemptId: attemptId,
          },
        },
      });
      invitationId = invitation.id;
    } catch (error) {
      if (clerkRejectionStatus(error)) throwClerkInvitationError(error);
      try {
        const matches = await findSchoolInvitationForClaim(administrator.email, schoolId, claimId);
        if (matches.length === 1) {
          invitation = matches[0];
          invitationId = matches[0].id;
        } else {
          providerOutcomeUnknown = true;
        }
      } catch {
        providerOutcomeUnknown = true;
      }
    }

    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(
      `UPDATE audit_logs
       SET metadata=COALESCE(metadata,'{}'::jsonb) || $1::jsonb
       WHERE school_id=$2 AND event_type='SCHOOL_ADMIN_INVITED'
         AND metadata->>'claimId'=$3 AND metadata->>'role'='SCHOOL_ADMIN'
         AND lower(metadata->>'invitedEmail')=$4`,
      [
        JSON.stringify({
          invitationId: invitationId ?? null,
          dispatchStatus: providerOutcomeUnknown ? "UNKNOWN_PROVIDER_STATE" : "REQUEST_ACCEPTED",
          attemptId,
        }),
        schoolId,
        claimId,
        administrator.email,
      ],
    );
    await auditPartnerSchoolRegistration(
      client,
      actor,
      schoolId,
      partnerId,
      providerOutcomeUnknown
        ? "Partner school administrator invitation requires provider recovery"
        : "Partner school administrator invitation sent",
      providerOutcomeUnknown ? "PARTNER_SCHOOL_INVITATION_UNCERTAIN" : "PARTNER_SCHOOL_INVITATION_SENT",
      {
        source: "PARTNER_DIRECT",
        invitedEmail: administrator.email,
        invitationId: invitationId ?? null,
        claimId,
        attemptId,
        dispatchStatus: providerOutcomeUnknown ? "UNKNOWN_PROVIDER_STATE" : "REQUEST_ACCEPTED",
      },
    );
    await client.query(
      `UPDATE audit_logs
       SET metadata=COALESCE(metadata,'{}'::jsonb) || $1::jsonb
       WHERE id=$2`,
      [
        JSON.stringify({
          attemptStatus: providerOutcomeUnknown ? "OUTCOME_UNKNOWN" : "COMPLETED",
          invitationId: invitationId ?? null,
          dispatchStatus: providerOutcomeUnknown ? "UNKNOWN_PROVIDER_STATE" : "REQUEST_ACCEPTED",
          schoolId,
        }),
        attemptAuditId,
      ],
    );

    commitAttempted = true;
    const resolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM audit_logs claim
         WHERE claim.school_id=$1 AND claim.event_type='SCHOOL_ADMIN_INVITED'
           AND claim.metadata->>'claimId'=$2
           AND claim.metadata->>'invitationId'=$3`,
        [schoolId, claimId, invitationId],
      )).rows[0]),
    });
    transactionStarted = false;
    if (resolution !== "COMMITTED") {
      discardClient = resolution === "UNKNOWN";
      await pool.query(
        `UPDATE audit_logs SET metadata=COALESCE(metadata,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
        [
          JSON.stringify({
            attemptStatus: "OUTCOME_UNKNOWN",
            dispatchStatus: "UNKNOWN_PROVIDER_STATE",
            invitationId,
          }),
          attemptAuditId,
        ],
      ).catch(() => undefined);
      await pool.query(
        `UPDATE audit_logs
         SET metadata=COALESCE(metadata,'{}'::jsonb) ||
           '{"dispatchStatus":"UNKNOWN_PROVIDER_STATE"}'::jsonb
         WHERE school_id=$1 AND event_type='SCHOOL_ADMIN_INVITED' AND metadata->>'claimId'=$2`,
        [schoolId, claimId],
      ).catch(() => undefined);
      throw new AuthError(
        503,
        "The invitation may be active but finalization is unconfirmed; its durable school claim is retained. Reconcile before retrying.",
        "INVITATION_RECOVERY_REQUIRED",
      );
    }
  } catch (error) {
    if (transactionStarted && !commitAttempted) {
      await client.query("ROLLBACK").catch(() => undefined);
      transactionStarted = false;
    }
    if (!phase1Committed && attemptAuditId && !commitAttempted && !providerCallStarted) {
      await pool.query(
        `UPDATE audit_logs SET metadata=COALESCE(metadata,'{}'::jsonb) ||
           '{"attemptStatus":"FAILED","dispatchStatus":"NOT_DISPATCHED"}'::jsonb
         WHERE id=$1`,
        [attemptAuditId],
      ).catch(() => undefined);
    }
    if (phase1Committed && attemptAuditId && !commitAttempted) {
      const rejection = !providerOutcomeUnknown && providerCallStarted && clerkRejectionStatus(error) !== null;
      const registeredOrPending = (
        (error as { code?: string; eventType?: string } | null)?.code ??
        (error as { eventType?: string } | null)?.eventType
      ) === "INVITATION_ALREADY_EXISTS";
      const dispatchStatus = providerOutcomeUnknown
        ? "UNKNOWN_PROVIDER_STATE"
        : registeredOrPending ? "REGISTERED_OR_PENDING"
        : rejection ? "PROVIDER_REJECTED" : "OUTCOME_UNKNOWN";
      const attemptStatus = providerOutcomeUnknown || !rejection ? "OUTCOME_UNKNOWN" : "FAILED";
      await pool.query(
        `UPDATE audit_logs SET metadata=COALESCE(metadata,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
        [
          JSON.stringify({ attemptStatus, dispatchStatus, invitationId }),
          attemptAuditId,
        ],
      ).catch(() => undefined);
      await pool.query(
        `UPDATE audit_logs
         SET metadata=COALESCE(metadata,'{}'::jsonb) || $1::jsonb
         WHERE school_id=$2 AND event_type='SCHOOL_ADMIN_INVITED' AND metadata->>'claimId'=$3`,
        [
          JSON.stringify({
            dispatchStatus,
            invitationId,
            attemptId,
          }),
          schoolId,
          claimId,
        ],
      ).catch(() => undefined);
      if (providerCallStarted) {
        await pool.query(
          `INSERT INTO audit_logs
            ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
             severity,event_type,result,metadata)
           VALUES($1,$2,$3,$4,$5,$6,'Partners',$5,'warning',$7,'SUCCESS',$8::jsonb)`,
          [
            [actor.user.firstName, actor.user.lastName].filter(Boolean).join(" ") || actor.user.email,
            actor.roles.find((item) => ["PARTNER", "PARTNER_OWNER", "PARTNER_ADMIN"].includes(item.role))?.role ??
              "AUTHENTICATED",
            actor.user.id,
            actor.user.clerkUserId,
            schoolId,
            providerOutcomeUnknown || !rejection ? "Partner school invitation requires recovery" :
              "Partner school invitation provider rejected the request",
            providerOutcomeUnknown || !rejection
              ? "PARTNER_SCHOOL_INVITATION_UNCERTAIN"
              : "PARTNER_SCHOOL_INVITATION_FAILED",
            JSON.stringify({
              partnerId,
              schoolId,
              claimId,
              attemptId,
              invitationId,
              dispatchStatus,
            }),
          ],
        ).catch(() => undefined);
      }
      if (!rejection) {
        throw new AuthError(
          503,
          "The school invitation outcome or its finalization is uncertain; its durable school claim is retained. Reconcile before retrying.",
          "INVITATION_RECOVERY_REQUIRED",
        );
      }
    }
    throw error;
  } finally {
    if (advisoryLocks.length) {
      await client.query(
        `SELECT pg_advisory_unlock(hashtextextended(identity,0))
         FROM unnest($1::text[]) AS identities(identity) ORDER BY identity`,
        [advisoryLocks],
      ).catch(() => undefined);
    }
    client.release(discardClient ? new Error("Invitation recovery left the database session uncertain") : undefined);
  }
  if (providerOutcomeUnknown || !invitationId) {
    throw new AuthError(
      503,
      "School registration is pending but Clerk did not confirm the invitation outcome; reconcile before retrying",
      "INVITATION_RECOVERY_REQUIRED",
    );
  }
  return {
    schoolId,
    administratorInvitation: {
      invitationId,
      email: administrator.email,
      role: "SCHOOL_ADMIN",
      status: "DISPATCH_REQUESTED" as const,
      dispatchStatus: "REQUEST_ACCEPTED" as const,
      deliveryStatus: "UNVERIFIED" as const,
      deliveryNote: "Clerk accepted the invitation request; inbox delivery is not verified.",
    },
  };
}

export type ClerkSchoolInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export async function listClerkInvitationsForStatus(status: ClerkSchoolInvitationStatus, query?: string) {
  const invitations: any[] = [];
  for (let offset=0; offset<10000; offset+=100) {
    const response = await clerkClient.invitations.getInvitationList({ status, limit:100, offset, ...(query ? {query} : {}) });
    invitations.push(...response.data);
    if (response.data.length<100 || (Number.isFinite(response.totalCount) && invitations.length>=response.totalCount)) return invitations;
  }
  throw new AuthError(503,"Invitation lookup exceeded its safe page limit; no invitation was sent");
}

export async function getClerkSchoolInvitation(invitationId: string) {
  const statuses: ClerkSchoolInvitationStatus[] = ["pending", "accepted", "revoked", "expired"];
  try {
    for (const status of statuses) {
      // Clerk's query filters recipient email, not an invitation ID. Search complete status pages.
      const invitations = await listClerkInvitationsForStatus(status);
      const invitation = invitations.find((item) => item.id === invitationId);
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
  const guardClient = await pool.connect();
  const lockKey = `school-admin-invitation:${input.schoolId}:${input.invitationId}`;
  let lockResultReceived = false;
  let lockHeld = false;
  let releaseError: Error | undefined;
  try {
    const result = await guardClient.query(
      `SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked`,
      [lockKey],
    );
    lockResultReceived = true;
    lockHeld = result.rows[0]?.locked === true;
    if (!lockHeld) {
      throw new AuthError(409, "This invitation is already being replaced; retry after the current request finishes");
    }
    return await replaceSchoolAdminInvitationUnderGuard(input, actor);
  } catch (error) {
    if (!lockResultReceived) {
      releaseError = error instanceof Error ? error : new Error("Invitation lock acquisition failed");
    }
    throw error;
  } finally {
    if (lockHeld) {
      try {
        const result = await guardClient.query(
          `SELECT pg_advisory_unlock(hashtextextended($1,0)) AS unlocked`,
          [lockKey],
        );
        if (result.rows[0]?.unlocked !== true) {
          releaseError = new Error("Invitation replacement lock could not be released");
        }
      } catch (error) {
        releaseError = error instanceof Error ? error : new Error("Invitation replacement lock could not be released");
      }
    }
    guardClient.release(releaseError);
  }
}

type ReplacementSourceEvent = "SCHOOL_ADMIN_INVITED" | "USER_INVITED";

type DurableReplacementAttempt = {
  id: number;
  metadata: Record<string, any>;
};

function rowMetadata(value: unknown): Record<string, any> {
  return parseInvitationMetadata(value);
}

async function getReplacementAttempt(schoolId: number, attemptId: string): Promise<DurableReplacementAttempt | null> {
  const result = await pool.query(
    `SELECT id,metadata FROM audit_logs
     WHERE school_id=$1 AND event_type='SCHOOL_INVITATION_REPLACEMENT_ATTEMPT'
       AND metadata->>'attemptId'=$2
     ORDER BY timestamp DESC LIMIT 1`,
    [schoolId, attemptId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, metadata: rowMetadata(row.metadata) } : null;
}

async function setReplacementAttemptState(
  schoolId: number,
  attemptId: string,
  attemptStatus: string,
  extra: Record<string, unknown> = {},
) {
  await pool.query(
    `UPDATE audit_logs
     SET metadata=COALESCE(metadata,'{}'::jsonb) || $1::jsonb
     WHERE school_id=$2 AND event_type='SCHOOL_INVITATION_REPLACEMENT_ATTEMPT'
       AND metadata->>'attemptId'=$3`,
    [JSON.stringify({ attemptStatus, ...extra }), schoolId, attemptId],
  );
  await pool.query(
    `UPDATE audit_logs
     SET metadata=COALESCE(metadata,'{}'::jsonb) || $1::jsonb
     WHERE school_id=$2 AND event_type='SCHOOL_INVITATION_SUPERSEDED'
       AND metadata->>'replacementAttemptId'=$3`,
    [JSON.stringify({ attemptStatus, ...extra }), schoolId, attemptId],
  ).catch(() => undefined);
}

/**
 * Persist the replacement claim and invalidate the selected claim while holding the same
 * audit-row lock used by activation. This transaction commits before any notify=true call.
 */
async function reserveReplacementAttempt(input: {
  schoolId: number;
  invitationId: string;
  sourceEvent: ReplacementSourceEvent;
  role: InvitationRole;
  oldClaimId: string;
  oldEmail: string;
  email: string;
  fullName: string;
  phone?: string | null;
  actor: UserContext;
  marker: Record<string, any>;
  attemptId: string;
  newClaimId: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sourceResult = await client.query(
      `SELECT id,metadata FROM audit_logs
       WHERE school_id=$1 AND metadata->>'invitationId'=$2
         AND event_type=$3
         AND (metadata->>'claimId'=$4 OR metadata->>'claimId' IS NULL)
       ORDER BY timestamp DESC LIMIT 1 FOR UPDATE`,
      [input.schoolId, input.invitationId, input.sourceEvent, input.oldClaimId],
    );
    const source = sourceResult.rows[0];
    if (!source) throw new AuthError(409, "This invitation changed while it was being replaced");
    const sourceMetadata = rowMetadata(source.metadata);
    if (sourceMetadata.superseded === true) {
      throw new AuthError(409, "This invitation has already been replaced");
    }
    const superseded = await client.query(
      `SELECT 1 FROM audit_logs
       WHERE school_id=$1 AND event_type='SCHOOL_INVITATION_SUPERSEDED'
         AND metadata->>'supersedesClaimId'=$2 LIMIT 1`,
      [input.schoolId, input.oldClaimId],
    );
    if (superseded.rows[0]) throw new AuthError(409, "This invitation has already been replaced");
    const existingAttempt = await client.query(
      `SELECT 1 FROM audit_logs
       WHERE school_id=$1 AND event_type='SCHOOL_INVITATION_REPLACEMENT_ATTEMPT'
         AND metadata->>'selectedInvitationId'=$2
         AND metadata->>'sourceEvent'=$3
         AND metadata->>'attemptStatus' IN (
           'PREPARED','REVOCATION_REJECTED','REVOCATION_UNKNOWN','DISPATCHING',
           'DISPATCH_REJECTED','OUTCOME_UNKNOWN','MULTIPLE_MATCHES'
         )
       LIMIT 1`,
      [input.schoolId, input.invitationId, input.sourceEvent],
    );
    if (existingAttempt.rows[0]) {
      throw new AuthError(
        409,
        "This selected invitation already has a replacement recovery attempt; reconcile it before starting another.",
        "INVITATION_RECOVERY_REQUIRED",
      );
    }
    const alreadyActivated = await client.query(
      `SELECT 1 FROM audit_logs
       WHERE school_id=$1 AND event_type='USER_ACTIVATED'
         AND metadata->>'claimId'=$2 LIMIT 1`,
      [input.schoolId, input.oldClaimId],
    );
    if (alreadyActivated.rows[0]) {
      throw new AuthError(409, "This invitation was already activated and cannot be replaced");
    }

    // Recheck provider status after taking the activation row lock. Accepted invitations
    // are never revoked or superseded as a management operation.
    const currentClerkInvitation = await getClerkSchoolInvitation(input.invitationId);
    const currentMarker = (currentClerkInvitation.publicMetadata as Record<string, any> | undefined)?.[METADATA_KEY];
    if (
      currentMarker?.schoolId !== input.schoolId ||
      currentMarker?.role !== input.role ||
      currentMarker?.claimId !== input.oldClaimId
    ) {
      throw new AuthError(409, "This invitation identity changed while it was being replaced");
    }
    if (currentClerkInvitation.status !== "pending" && currentClerkInvitation.status !== "expired") {
      throw new AuthError(409, "Only pending or expired invitations may be replaced");
    }

    const oldMembership = await client.query(
      `SELECT sm.id,sm.status FROM app_users au
       JOIN school_memberships sm ON sm.user_id=au.id
       WHERE lower(au.email)=lower($1) AND sm.school_id=$2 AND sm.role=$3
       FOR UPDATE OF au,sm`,
      [input.oldEmail, input.schoolId, input.role],
    );
    if (oldMembership.rows.length) {
      throw new AuthError(
        409,
        oldMembership.rows.some((row: any) => row.status === "ACTIVE")
          ? "This school user is already active"
          : "This school membership is inactive and cannot be reactivated by invitation replacement",
      );
    }
    if (input.email !== input.oldEmail) {
      const existingAccount = await client.query(
        `SELECT id FROM app_users WHERE lower(email)=lower($1) LIMIT 1 FOR UPDATE`,
        [input.email],
      );
      if (existingAccount.rows[0]) {
        throw new AuthError(409, "The replacement email already belongs to an account");
      }
    }

    if (input.role === "ACCOUNTANT") {
      // Accountants have no role-specific profile row; lock and recheck both addresses
      // against school Accountant memberships so a concurrent activation cannot create
      // duplicate school access for either identity.
      const accountantMemberships = await client.query(
        `SELECT sm.id,sm.status FROM app_users au
         JOIN school_memberships sm ON sm.user_id=au.id
         WHERE lower(au.email)=ANY($1::text[]) AND sm.school_id=$2
           AND sm.role='ACCOUNTANT'
         FOR UPDATE OF au,sm`,
        [[...new Set([input.oldEmail, input.email])], input.schoolId],
      );
      if (accountantMemberships.rows.length) {
        throw new AuthError(409, "An Accountant membership already exists for this invitation identity");
      }
    }

    if (input.role === "STUDENT") {
      const student = await client.query(
        `SELECT id,user_id AS "userId" FROM students
         WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [input.marker.studentId, input.schoolId],
      );
      if (!student.rows[0]) throw new AuthError(409, "The student profile is no longer available in this school");
      if (student.rows[0].userId) {
        throw new AuthError(409, "The student profile was linked while this invitation was being replaced");
      }
      const otherLink = await client.query(
        `SELECT id FROM students WHERE user_id IS NOT NULL AND id=$1 LIMIT 1`,
        [input.marker.studentId],
      );
      if (otherLink.rows[0]) {
        throw new AuthError(409, "The student profile is already linked to an account");
      }
    }

    if (input.role === "PARENT") {
      const parent = await client.query(
        `SELECT id,user_id AS "userId" FROM parents
         WHERE school_id=$1 AND lower(email)=lower($2) ORDER BY id FOR UPDATE`,
        [input.schoolId, input.oldEmail],
      );
      if (parent.rows.length !== 1 || parent.rows[0].userId) {
        throw new AuthError(409, "The parent profile changed or is already linked; its invitation cannot be safely replaced");
      }
      if (input.email !== input.oldEmail) {
        const duplicate = await client.query(
          `SELECT id FROM parents WHERE school_id=$1 AND lower(email)=lower($2) LIMIT 1`,
          [input.schoolId, input.email],
        );
        if (duplicate.rows[0]) throw new AuthError(409, "A parent profile already uses the replacement email");
      }
    }

    if (input.role === "TEACHER" || input.role === "ACCOUNTANT" || input.role === "STAFF" || input.role === "DRIVER") {
      const employee = await client.query(
        `SELECT id,user_id AS "userId",employee_type AS type FROM employees
         WHERE school_id=$1 AND lower(email)=lower($2) ORDER BY id FOR UPDATE`,
        [input.schoolId, input.oldEmail],
      );
      if (
        employee.rows.length !== 1 ||
        employee.rows[0].userId ||
        employee.rows[0].type !== input.role
      ) {
        throw new AuthError(409, "The employee profile changed or is already linked; its invitation cannot be safely replaced");
      }
      if (input.email !== input.oldEmail) {
        const duplicate = await client.query(
          `SELECT id FROM employees WHERE school_id=$1 AND lower(email)=lower($2) LIMIT 1`,
          [input.schoolId, input.email],
        );
        if (duplicate.rows[0]) throw new AuthError(409, "An employee profile already uses the replacement email");
      }
    }

    const { firstName, lastName } = splitName(input.fullName);
    const replacementMarker = {
      ...input.marker,
      version: 1,
      claimId: input.newClaimId,
      emailProof: emailProof(input.email),
      schoolId: input.schoolId,
      role: input.role,
      firstName,
      lastName,
      studentId: input.role === "STUDENT" ? input.marker.studentId : null,
      employeeNo: input.role === "TEACHER" || input.role === "ACCOUNTANT" || input.role === "STAFF" || input.role === "DRIVER" ? input.marker.employeeNo : null,
      replacementAttemptId: input.attemptId,
    };
    const attemptMetadata = {
      attemptId: input.attemptId,
      attemptStatus: "PREPARED",
      actorName: [input.actor.user.firstName, input.actor.user.lastName].filter(Boolean).join(" ") || input.actor.user.email,
      actorRole: input.role === "SCHOOL_ADMIN" ? "PLATFORM_OWNER" : "SCHOOL_ADMIN",
      actorUserId: input.actor.user.id,
      actorClerkUserId: input.actor.user.clerkUserId,
      selectedInvitationId: input.invitationId,
      selectedClaimId: input.oldClaimId,
      claimId: input.newClaimId,
      schoolId: input.schoolId,
      role: input.role,
      oldEmail: input.oldEmail,
      invitedEmail: input.email,
      firstName,
      lastName,
      phone: input.phone ?? null,
      emailProof: replacementMarker.emailProof,
      studentId: replacementMarker.studentId,
      employeeNo: replacementMarker.employeeNo,
      invitationMarker: replacementMarker,
      sourceEvent: input.sourceEvent,
    };
    await client.query(
      `INSERT INTO audit_logs
        ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
         severity,event_type,result,metadata)
       VALUES($1,$2,$3,$4,$5,'Prepared selected invitation replacement',
         'Security',NULL,'info','SCHOOL_INVITATION_REPLACEMENT_ATTEMPT','SUCCESS',$6)`,
      [
        [input.actor.user.firstName, input.actor.user.lastName].filter(Boolean).join(" ") || input.actor.user.email,
       input.role === "SCHOOL_ADMIN"
         ? input.actor.roles.find((item) =>
             ["PLATFORM_OWNER", "PARTNER_OWNER", "PARTNER_ADMIN"].includes(item.role)
           )?.role ?? "PLATFORM_OWNER"
         : "SCHOOL_ADMIN",
        input.actor.user.id,
        input.actor.user.clerkUserId,
        input.schoolId,
        JSON.stringify(attemptMetadata),
      ],
    );
    try {
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      let committed = false;
      try {
        committed = Boolean((await getReplacementAttempt(input.schoolId, input.attemptId))?.metadata);
      } catch {
        throw new AuthError(
          503,
          "Invitation replacement preparation is uncertain; do not resend. Reconcile the invitation before retrying.",
          "INVITATION_RECOVERY_REQUIRED",
        );
      }
      if (!committed) {
        throw new AuthError(
          503,
          "Invitation replacement preparation could not be confirmed; no email was sent.",
          "INVITATION_RECOVERY_REQUIRED",
        );
      }
    }
    return replacementMarker;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function finalizeReplacementAttempt(input: {
  schoolId: number;
  attemptId: string;
  invitationId: string;
  actor: UserContext;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id,metadata FROM audit_logs
       WHERE school_id=$1 AND event_type='SCHOOL_INVITATION_REPLACEMENT_ATTEMPT'
         AND metadata->>'attemptId'=$2 FOR UPDATE`,
      [input.schoolId, input.attemptId],
    );
    const row = result.rows[0];
    if (!row) throw new AuthError(404, "Invitation replacement attempt not found");
    const metadata = rowMetadata(row.metadata);
    if (metadata.attemptStatus === "COMPLETED") {
      await client.query("ROLLBACK").catch(() => undefined);
      return metadata;
    }
    const role = metadata.role as InvitationRole;
    const sourceEvent = metadata.sourceEvent as ReplacementSourceEvent;
    const existing = await client.query(
      `SELECT id FROM audit_logs WHERE school_id=$1 AND event_type=$2
         AND metadata->>'claimId'=$3 LIMIT 1`,
      [input.schoolId, sourceEvent, metadata.claimId],
    );
    if (!existing.rows[0]) {
      await auditInvitation(
        client,
        input.actor,
        input.schoolId,
        role,
        metadata.invitedEmail,
        sourceEvent,
        null,
        input.invitationId,
        metadata.claimId,
        [metadata.firstName, metadata.lastName].filter(Boolean).join(" "),
        input.attemptId,
        metadata.phone ?? null,
      );
    }
    await client.query(
      `UPDATE audit_logs
       SET metadata=COALESCE(metadata,'{}'::jsonb) ||
         jsonb_build_object('attemptStatus','COMPLETED','providerInvitationId',$1)
       WHERE id=$2`,
      [input.invitationId, row.id],
    );
    await client.query(
      `UPDATE audit_logs
       SET metadata=COALESCE(metadata,'{}'::jsonb) ||
         jsonb_build_object('attemptStatus','COMPLETED','replacementInvitationId',$1)
       WHERE school_id=$2 AND event_type='SCHOOL_INVITATION_SUPERSEDED'
         AND metadata->>'replacementAttemptId'=$3`,
      [input.invitationId, input.schoolId, input.attemptId],
    );
    try {
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      const recovered = await getReplacementAttempt(input.schoolId, input.attemptId).catch(() => null);
      if (recovered?.metadata.attemptStatus !== "COMPLETED") {
        throw new AuthError(
          503,
          "Invitation response was received but its durable record is uncertain; reconcile before retrying.",
          "INVITATION_RECOVERY_REQUIRED",
        );
      }
      return recovered.metadata;
    }
    return { ...metadata, attemptStatus: "COMPLETED", providerInvitationId: input.invitationId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function revokeSelectedInvitationForAttempt(attempt: DurableReplacementAttempt) {
  const metadata = attempt.metadata;
  if (metadata.sourceRevoked === true || metadata.sourceWasExpired === true) {
    return metadata.previousInviteRevoked === true;
  }

  let invitation: Awaited<ReturnType<typeof getClerkSchoolInvitation>>;
  try {
    invitation = await getClerkSchoolInvitation(metadata.selectedInvitationId);
  } catch {
    await setReplacementAttemptState(metadata.schoolId, metadata.attemptId, "REVOCATION_UNKNOWN");
    throw new AuthError(
      503,
      "The selected invitation status could not be verified. No replacement was sent; reconcile before retrying.",
      "INVITATION_RECOVERY_REQUIRED",
    );
  }

  const marker = (invitation.publicMetadata as Record<string, any> | undefined)?.[METADATA_KEY];
  if (
    marker?.schoolId !== metadata.schoolId ||
    marker?.role !== metadata.role ||
    marker?.claimId !== metadata.selectedClaimId
  ) {
    await setReplacementAttemptState(metadata.schoolId, metadata.attemptId, "CANCELLED");
    throw new AuthError(409, "The selected invitation identity changed; no replacement was sent");
  }
  if (invitation.status === "accepted") {
    await setReplacementAttemptState(metadata.schoolId, metadata.attemptId, "CANCELLED", {
      cancellationReason: "SOURCE_ACCEPTED",
    });
    throw new AuthError(409, "The selected invitation was accepted and cannot be replaced");
  }
  if (invitation.status === "expired") {
    return false;
  }
  if (invitation.status === "revoked") {
    return true;
  }

  let revokeError: unknown;
  let revokeRejected = false;
  try {
    await clerkClient.invitations.revokeInvitation(metadata.selectedInvitationId);
  } catch (error) {
    revokeError = error;
    revokeRejected = true;
  }

  let current: Awaited<ReturnType<typeof getClerkSchoolInvitation>>;
  try {
    current = await getClerkSchoolInvitation(metadata.selectedInvitationId);
  } catch {
    await setReplacementAttemptState(metadata.schoolId, metadata.attemptId, "REVOCATION_UNKNOWN");
    throw new AuthError(
      503,
      "The selected invitation revocation outcome is unknown. No replacement was sent; reconcile before retrying.",
      "INVITATION_RECOVERY_REQUIRED",
    );
  }
  const currentMarker = (current.publicMetadata as Record<string, any> | undefined)?.[METADATA_KEY];
  if (
    currentMarker?.schoolId !== metadata.schoolId ||
    currentMarker?.role !== metadata.role ||
    currentMarker?.claimId !== metadata.selectedClaimId
  ) {
    await setReplacementAttemptState(metadata.schoolId, metadata.attemptId, "CANCELLED");
    throw new AuthError(409, "The selected invitation identity changed; no replacement was sent");
  }
  if (current.status === "accepted") {
    await setReplacementAttemptState(metadata.schoolId, metadata.attemptId, "CANCELLED", {
      cancellationReason: "SOURCE_ACCEPTED",
    });
    throw new AuthError(409, "The selected invitation was accepted while revocation was in progress; no replacement was sent");
  }
  if (current.status === "revoked") return true;
  if (current.status === "expired") return false;
  const rejectionStatus = revokeRejected ? clerkRejectionStatus(revokeError) : null;
  await setReplacementAttemptState(
    metadata.schoolId,
    metadata.attemptId,
    rejectionStatus ? "REVOCATION_REJECTED" : "REVOCATION_UNKNOWN",
    rejectionStatus ? { rejectionStatus } : {},
  );
  throw new AuthError(
    503,
    rejectionStatus
      ? "Clerk rejected revocation of the selected invitation. No replacement was sent; reconcile to safely retry this staged attempt."
      : "The selected invitation revocation outcome is unknown. No replacement was sent; reconcile before retrying.",
    "INVITATION_RECOVERY_REQUIRED",
  );
}

async function markReplacementAttemptDispatching(
  schoolId: number,
  attemptId: string,
  previousInviteRevoked: boolean,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const attemptResult = await client.query(
      `SELECT id,metadata FROM audit_logs
       WHERE school_id=$1 AND event_type='SCHOOL_INVITATION_REPLACEMENT_ATTEMPT'
         AND metadata->>'attemptId'=$2 FOR UPDATE`,
      [schoolId, attemptId],
    );
    const attemptRow = attemptResult.rows[0];
    if (!attemptRow) throw new AuthError(404, "Invitation replacement attempt not found");
    const metadata = rowMetadata(attemptRow.metadata);
    if (metadata.attemptStatus === "DISPATCH_REJECTED" && metadata.sourceRevoked === true) {
      const retried = await client.query(
        `UPDATE audit_logs
         SET metadata=COALESCE(metadata,'{}'::jsonb) ||
           jsonb_build_object('attemptStatus','DISPATCHING')
         WHERE id=$1 RETURNING metadata`,
        [attemptRow.id],
      );
      await client.query(
        `UPDATE audit_logs
         SET metadata=COALESCE(metadata,'{}'::jsonb) || '{"attemptStatus":"DISPATCHING"}'::jsonb
         WHERE school_id=$1 AND event_type='SCHOOL_INVITATION_SUPERSEDED'
           AND metadata->>'replacementAttemptId'=$2`,
        [schoolId, attemptId],
      );
      await client.query("COMMIT");
      return rowMetadata(retried.rows[0]?.metadata ?? metadata);
    }
    if (!["PREPARED", "REVOCATION_REJECTED", "REVOCATION_UNKNOWN"].includes(metadata.attemptStatus)) {
      throw new AuthError(409, "This invitation replacement is already dispatching or requires reconciliation");
    }
    const cancelAttempt = async (message: string): Promise<never> => {
      await client.query(
        `UPDATE audit_logs SET metadata=COALESCE(metadata,'{}'::jsonb) ||
          '{"attemptStatus":"CANCELLED"}'::jsonb
         WHERE id=$1`,
        [attemptRow.id],
      );
      await client.query("COMMIT");
      throw new AuthError(409, message);
    };

    const sourceResult = await client.query(
      `SELECT id,metadata FROM audit_logs
       WHERE school_id=$1 AND metadata->>'invitationId'=$2
         AND event_type=$3 AND metadata->>'claimId'=$4
       ORDER BY timestamp DESC LIMIT 1 FOR UPDATE`,
      [schoolId, metadata.selectedInvitationId, metadata.sourceEvent, metadata.selectedClaimId],
    );
    const source = sourceResult.rows[0];
    if (!source) throw new AuthError(409, "The selected invitation changed; no replacement was sent");
    const sourceMetadata = rowMetadata(source.metadata);
    if (sourceMetadata.superseded === true) {
      return await cancelAttempt("The selected invitation has already been replaced");
    }
    const activated = await client.query(
      `SELECT 1 FROM audit_logs
       WHERE school_id=$1 AND event_type='USER_ACTIVATED'
         AND metadata->>'claimId'=$2 LIMIT 1`,
      [schoolId, metadata.selectedClaimId],
    );
    if (activated.rows[0]) {
      await client.query(
        `UPDATE audit_logs SET metadata=COALESCE(metadata,'{}'::jsonb) ||
          '{"attemptStatus":"CANCELLED","cancellationReason":"SOURCE_ACTIVATED"}'::jsonb
         WHERE id=$1`,
        [attemptRow.id],
      );
      await client.query("COMMIT");
      throw new AuthError(409, "The selected invitation was activated and cannot be replaced");
    }

    const memberships = await client.query(
      `SELECT sm.id,sm.status FROM app_users au
       JOIN school_memberships sm ON sm.user_id=au.id
       WHERE lower(au.email)=ANY($1::text[]) AND sm.school_id=$2 AND sm.role=$3
       FOR UPDATE OF au,sm`,
      [[...new Set([metadata.oldEmail, metadata.invitedEmail])], schoolId, metadata.role],
    );
    if (memberships.rows.length) {
      return await cancelAttempt("A school membership now exists for the selected invitation identity");
    }
    if (metadata.invitedEmail !== metadata.oldEmail) {
      const account = await client.query(
        `SELECT id FROM app_users WHERE lower(email)=lower($1) LIMIT 1 FOR UPDATE`,
        [metadata.invitedEmail],
      );
      if (account.rows[0]) return await cancelAttempt("The replacement email now belongs to an account");
    }

    if (metadata.role === "STUDENT") {
      const student = await client.query(
        `SELECT id,user_id AS "userId" FROM students
         WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [metadata.studentId, schoolId],
      );
      if (!student.rows[0] || student.rows[0].userId) {
        return await cancelAttempt("The student profile changed or was linked while this invitation was being replaced");
      }
    }
    if (metadata.role === "PARENT") {
      const parent = await client.query(
        `SELECT id,user_id AS "userId" FROM parents
         WHERE school_id=$1 AND lower(email)=lower($2) ORDER BY id FOR UPDATE`,
        [schoolId, metadata.oldEmail],
      );
      if (parent.rows.length !== 1 || parent.rows[0].userId) {
        return await cancelAttempt("The parent profile changed or was linked while this invitation was being replaced");
      }
      if (metadata.invitedEmail !== metadata.oldEmail) {
        const duplicate = await client.query(
          `SELECT id FROM parents WHERE school_id=$1 AND lower(email)=lower($2) LIMIT 1`,
          [schoolId, metadata.invitedEmail],
        );
        if (duplicate.rows[0]) return await cancelAttempt("A parent profile now uses the replacement email");
        await client.query(`UPDATE parents SET email=$1 WHERE id=$2`, [metadata.invitedEmail, parent.rows[0].id]);
      }
    }
    if (metadata.role === "TEACHER" || metadata.role === "ACCOUNTANT" || metadata.role === "STAFF" || metadata.role === "DRIVER") {
      const employee = await client.query(
        `SELECT id,user_id AS "userId",employee_type AS type FROM employees
         WHERE school_id=$1 AND lower(email)=lower($2) ORDER BY id FOR UPDATE`,
        [schoolId, metadata.oldEmail],
      );
      if (
        employee.rows.length !== 1 ||
        employee.rows[0].userId ||
        employee.rows[0].type !== metadata.role
      ) {
        return await cancelAttempt("The employee profile changed or was linked while this invitation was being replaced");
      }
      if (metadata.invitedEmail !== metadata.oldEmail) {
        const duplicate = await client.query(
          `SELECT id FROM employees WHERE school_id=$1 AND lower(email)=lower($2) LIMIT 1`,
          [schoolId, metadata.invitedEmail],
        );
        if (duplicate.rows[0]) return await cancelAttempt("An employee profile now uses the replacement email");
        await client.query(
          `UPDATE employees SET email=$1,updated_at=NOW() WHERE id=$2`,
          [metadata.invitedEmail, employee.rows[0].id],
        );
      }
    }

    await client.query(
      `UPDATE audit_logs
       SET metadata=COALESCE(metadata,'{}'::jsonb) ||
         jsonb_build_object(
           'superseded',true,
           'supersededByClaimId',$1,
           'supersededByAttemptId',$2,
           'supersededByInvitationId',NULL
         )
       WHERE id=$3 AND school_id=$4`,
      [metadata.claimId, attemptId, source.id, schoolId],
    );
    await client.query(
      `INSERT INTO audit_logs
        ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
         severity,event_type,result,metadata)
       VALUES($1,$2,$3,$4,$5,'Superseded selected school invitation',
         'Security',NULL,'info','SCHOOL_INVITATION_SUPERSEDED','SUCCESS',$6)`,
      [
        metadata.actorName ?? "School invitation manager",
        metadata.actorRole,
        metadata.actorUserId,
        metadata.actorClerkUserId,
        schoolId,
        JSON.stringify({
          supersedesClaimId: metadata.selectedClaimId,
          supersededInvitationId: metadata.selectedInvitationId,
          replacementClaimId: metadata.claimId,
          replacementInvitationId: null,
          replacementAttemptId: attemptId,
          attemptStatus: "DISPATCHING",
          oldEmail: metadata.oldEmail,
          invitedEmail: metadata.invitedEmail,
          role: metadata.role,
        }),
      ],
    );
    const updatedAttempt = await client.query(
      `UPDATE audit_logs
       SET metadata=COALESCE(metadata,'{}'::jsonb) || $1::jsonb
       WHERE id=$2 RETURNING metadata`,
      [JSON.stringify({
        attemptStatus: "DISPATCHING",
        sourceRevoked: true,
        sourceWasExpired: !previousInviteRevoked,
        previousInviteRevoked,
      }), attemptRow.id],
    );
    await client.query("COMMIT");
    return rowMetadata(updatedAttempt.rows[0]?.metadata ?? metadata);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function dispatchReplacementAttempt(
  schoolId: number,
  attemptId: string,
  actor: UserContext,
  options: { allowPrepared: boolean },
) {
  const attempt = await getReplacementAttempt(schoolId, attemptId);
  if (!attempt) throw new AuthError(404, "Invitation replacement attempt not found");
  if (attempt.metadata.attemptStatus === "COMPLETED") {
    return {
      status: "PENDING" as const,
      invitationId: attempt.metadata.providerInvitationId,
      supersededInvitationId: attempt.metadata.selectedInvitationId,
      previousInviteRevoked: attempt.metadata.previousInviteRevoked === true,
      email: attempt.metadata.invitedEmail,
      schoolId,
      role: attempt.metadata.role,
      dispatchStatus: "REQUEST_ACCEPTED" as const,
      deliveryStatus: "UNVERIFIED" as const,
      expiresAt: null,
      recoveryStatus: "COMPLETED" as const,
    };
  }
  if (!options.allowPrepared) {
    throw new AuthError(
      409,
      "This invitation replacement has an unknown provider outcome; reconcile it before attempting another send.",
      "INVITATION_RECOVERY_REQUIRED",
    );
  }
  if (["DISPATCHING", "OUTCOME_UNKNOWN", "MULTIPLE_MATCHES", "CANCELLED"].includes(attempt.metadata.attemptStatus)) {
    throw new AuthError(
      409,
      "This replacement has an uncertain or terminal outcome; reconcile it without sending another invitation.",
      "INVITATION_RECOVERY_REQUIRED",
    );
  }
  let previousInviteRevoked = attempt.metadata.previousInviteRevoked === true;
  if (attempt.metadata.attemptStatus !== "DISPATCH_REJECTED") {
    previousInviteRevoked = await revokeSelectedInvitationForAttempt(attempt);
  }
  const durableMetadata = await markReplacementAttemptDispatching(
    schoolId,
    attemptId,
    previousInviteRevoked,
  );
  let invitation: Awaited<ReturnType<typeof clerkClient.invitations.createInvitation>>;
  try {
    invitation = await clerkClient.invitations.createInvitation({
      emailAddress: durableMetadata.invitedEmail,
      expiresInDays: INVITATION_DAYS,
      ignoreExisting: false,
      notify: true,
      redirectUrl: invitationRedirect("/accept-invitation"),
      publicMetadata: { [METADATA_KEY]: durableMetadata.invitationMarker },
    });
  } catch (error) {
    const rejectionStatus = clerkRejectionStatus(error);
    if (rejectionStatus) {
      await setReplacementAttemptState(schoolId, attemptId, "DISPATCH_REJECTED", {
        rejectionStatus,
        sourceRevoked: true,
        previousInviteRevoked,
      });
      throw new AuthError(
        503,
        "Clerk definitely rejected this invitation request. The selected invitation was already revoked; reconcile to safely retry this same staged attempt.",
        "INVITATION_RECOVERY_REQUIRED",
      );
    }
    await setReplacementAttemptState(schoolId, attemptId, "OUTCOME_UNKNOWN", {
      sourceRevoked: true,
      previousInviteRevoked,
    });
    throw new AuthError(
      503,
      "The replacement invitation outcome is unknown. It is blocked from resending; reconcile it before retrying.",
      "INVITATION_RECOVERY_REQUIRED",
    );
  }
  const finalized = await finalizeReplacementAttempt({
    schoolId,
    attemptId,
    invitationId: invitation.id,
    actor,
  });
  return {
    status: "PENDING" as const,
    invitationId: invitation.id,
    supersededInvitationId: durableMetadata.selectedInvitationId,
    previousInviteRevoked,
    email: durableMetadata.invitedEmail,
    schoolId,
    role: durableMetadata.role,
    dispatchStatus: "REQUEST_ACCEPTED" as const,
    deliveryStatus: "UNVERIFIED" as const,
    expiresAt: new Date(
      (invitation.createdAt > 1_000_000_000_000 ? invitation.createdAt : invitation.createdAt * 1000) +
      INVITATION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
    recoveryStatus: finalized.attemptStatus,
  };
}

async function findProviderInvitationForAttempt(attempt: DurableReplacementAttempt) {
  const metadata = attempt.metadata;
  const statuses: ClerkSchoolInvitationStatus[] = ["pending", "accepted", "revoked", "expired"];
  const found = new Map<string, any>();
  for (const status of statuses) {
    const invitations = await listClerkInvitationsForStatus(status,metadata.invitedEmail);
    for (const invitation of invitations) {
      const marker = (invitation.publicMetadata as Record<string, any> | undefined)?.[METADATA_KEY];
      if (
        marker?.replacementAttemptId === metadata.attemptId &&
        marker?.claimId === metadata.claimId &&
        marker?.schoolId === metadata.schoolId &&
        marker?.role === metadata.role
      ) {
        found.set(invitation.id, invitation);
      }
    }
  }
  return [...found.values()];
}

export async function reconcileSchoolInvitationReplacement(input: {
  schoolId: number;
  invitationId: string;
}, actor: UserContext, sourceEvent: ReplacementSourceEvent) {
  const attemptRows = await pool.query(
    `SELECT id,metadata FROM audit_logs
     WHERE school_id=$1 AND event_type='SCHOOL_INVITATION_REPLACEMENT_ATTEMPT'
       AND metadata->>'selectedInvitationId'=$2
     ORDER BY timestamp DESC LIMIT 1`,
    [input.schoolId, input.invitationId],
  );
  const row = attemptRows.rows[0];
  if (!row) throw new AuthError(404, "No replacement recovery record exists for this invitation");
  const attempt: DurableReplacementAttempt = { id: row.id, metadata: rowMetadata(row.metadata) };
  if (attempt.metadata.sourceEvent !== sourceEvent) {
    throw new AuthError(404, "No replacement recovery record exists for this invitation");
  }
  if ([
    "PREPARED",
    "REVOCATION_REJECTED",
    "REVOCATION_UNKNOWN",
    "DISPATCH_REJECTED",
  ].includes(attempt.metadata.attemptStatus)) {
    return dispatchReplacementAttempt(input.schoolId, attempt.metadata.attemptId, actor, { allowPrepared: true });
  }
  if (attempt.metadata.attemptStatus === "CANCELLED") {
    throw new AuthError(409, "This replacement attempt was cancelled; the selected invitation remains unchanged");
  }
  if (attempt.metadata.attemptStatus === "COMPLETED") {
    return {
      status: "RECOVERED" as const,
      attemptId: attempt.metadata.attemptId,
      invitationId: attempt.metadata.providerInvitationId,
      email: attempt.metadata.invitedEmail,
      role: attempt.metadata.role,
      recoveryState: "COMPLETED" as const,
    };
  }
  let matches: any[];
  try {
    matches = await findProviderInvitationForAttempt(attempt);
  } catch {
    throw new AuthError(
      503,
      "The provider could not be searched for this attempt. No new invitation was sent; retry reconciliation later.",
      "INVITATION_RECOVERY_REQUIRED",
    );
  }
  if (matches.length === 0) {
    await setReplacementAttemptState(input.schoolId, attempt.metadata.attemptId, "OUTCOME_UNKNOWN");
    return {
      status: "RECOVERY_REQUIRED" as const,
      attemptId: attempt.metadata.attemptId,
      invitationId: null,
      email: attempt.metadata.invitedEmail,
      role: attempt.metadata.role,
      recoveryState: "OUTCOME_UNKNOWN" as const,
    };
  }
  if (matches.length !== 1) {
    await setReplacementAttemptState(input.schoolId, attempt.metadata.attemptId, "MULTIPLE_MATCHES");
    return {
      status: "RECOVERY_REQUIRED" as const,
      attemptId: attempt.metadata.attemptId,
      invitationId: null,
      email: attempt.metadata.invitedEmail,
      role: attempt.metadata.role,
      recoveryState: "MULTIPLE_MATCHES" as const,
    };
  }
  const providerInvitation = matches[0];
  await finalizeReplacementAttempt({
    schoolId: input.schoolId,
    attemptId: attempt.metadata.attemptId,
    invitationId: providerInvitation.id,
    actor,
  });
  const previousInviteRevoked = attempt.metadata.previousInviteRevoked === true;
  return {
    status: "RECOVERED" as const,
    attemptId: attempt.metadata.attemptId,
    invitationId: providerInvitation.id,
    email: attempt.metadata.invitedEmail,
    role: attempt.metadata.role,
    clerkStatus: providerInvitation.status,
    previousInviteRevoked,
    recoveryState: "COMPLETED" as const,
  };
}

async function replaceSchoolAdminInvitationUnderGuard(input: {
  schoolId: number;
  invitationId: string;
  email?: string;
}, actor: UserContext) {
  const target = await pool.query(
    `SELECT id,metadata
     FROM audit_logs
     WHERE school_id=$1 AND metadata->>'invitationId'=$2
       AND event_type='SCHOOL_ADMIN_INVITED'
     ORDER BY timestamp DESC LIMIT 1`,
    [input.schoolId, input.invitationId],
  );
  const source = target.rows[0];
  if (!source) throw new AuthError(404, "School administrator invitation not found");
  const sourceMetadata = rowMetadata(source.metadata);
  const oldEmail = normalizeEmail(String(sourceMetadata.invitedEmail ?? ""));
  const email = normalizeEmail(input.email ?? oldEmail);
  const recordedFullName = [sourceMetadata.firstName, sourceMetadata.lastName]
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
  const oldClaimId = sourceMetadata.claimId ?? clerkMarker?.claimId;
  if (
    !oldClaimId ||
    !/^[0-9a-f-]{36}$/i.test(oldClaimId) ||
    clerkMarker?.schoolId !== input.schoolId ||
    clerkMarker?.role !== "SCHOOL_ADMIN" ||
    clerkMarker?.claimId !== oldClaimId
  ) {
    throw new AuthError(409, "This invitation does not contain enough information to safely replace it");
  }
  const fullName = recordedFullName !== oldEmail
    ? recordedFullName
    : [clerkMarker.firstName, clerkMarker.lastName]
      .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0)
      .join(" ") || oldEmail;
  if (fullName.length < 2) {
    throw new AuthError(409, "This invitation does not contain enough information to safely replace it");
  }
  const attemptId = randomUUID();
  const newClaimId = randomUUID();
  await reserveReplacementAttempt({
    schoolId: input.schoolId,
    invitationId: input.invitationId,
    sourceEvent: "SCHOOL_ADMIN_INVITED",
    role: "SCHOOL_ADMIN",
    oldClaimId,
    oldEmail,
    email,
    fullName,
    phone: typeof sourceMetadata.phone === "string" ? sourceMetadata.phone : null,
    actor,
    marker: clerkMarker,
    attemptId,
    newClaimId,
  });
  return dispatchReplacementAttempt(input.schoolId, attemptId, actor, { allowPrepared: true });
}

const MANAGEABLE_SCHOOL_INVITATION_ROLES = [
  "TEACHER",
  "ACCOUNTANT",
  "PARENT",
  "STUDENT",
  "STAFF",
  "DRIVER",
] as const satisfies readonly InvitationRole[];

type ManageableSchoolInvitationRole = (typeof MANAGEABLE_SCHOOL_INVITATION_ROLES)[number];

function isManageableSchoolInvitationRole(value: unknown): value is ManageableSchoolInvitationRole {
  return typeof value === "string" &&
    MANAGEABLE_SCHOOL_INVITATION_ROLES.includes(value as ManageableSchoolInvitationRole);
}

function parseInvitationMetadata(value: unknown): Record<string, any> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

/**
 * School-user invitations are already represented by USER_INVITED audit rows and Clerk
 * invitation metadata. This list deliberately excludes accepted/registered and superseded
 * invitations; only still-actionable records are returned to the tenant manager.
 */
export async function listSchoolUserInvitations(schoolId: number) {
  const records = await pool.query(
    `SELECT id,metadata,timestamp AS "createdAt"
     FROM audit_logs
     WHERE school_id=$1 AND event_type='USER_INVITED'
       AND metadata->>'invitationId' IS NOT NULL
       AND metadata->>'role'=ANY($2::text[])
     ORDER BY timestamp DESC`,
    [schoolId, MANAGEABLE_SCHOOL_INVITATION_ROLES],
  );
  const supersededRows = await pool.query(
    `SELECT metadata->>'supersedesClaimId' AS "claimId"
     FROM audit_logs
     WHERE school_id=$1 AND event_type='SCHOOL_INVITATION_SUPERSEDED'
       AND metadata->>'supersedesClaimId' IS NOT NULL`,
    [schoolId],
  );
  const superseded = new Set(supersededRows.rows.map((row: { claimId: string }) => row.claimId));
  const activeMemberships = await pool.query(
    `SELECT lower(au.email) AS email,sm.role
     FROM school_memberships sm
     JOIN app_users au ON au.id=sm.user_id
     WHERE sm.school_id=$1 AND sm.role=ANY($2::text[]) AND sm.status='ACTIVE'`,
    [schoolId, MANAGEABLE_SCHOOL_INVITATION_ROLES],
  );
  const registeredUsers = new Set(
    activeMemberships.rows.map((row: { email: string; role: string }) =>
      `${normalizeEmail(row.email)}:${row.role}`
    ),
  );
  const attempts = await pool.query(
    `SELECT metadata,timestamp AS "createdAt"
     FROM audit_logs attempt
     WHERE attempt.school_id=$1
       AND attempt.event_type='SCHOOL_INVITATION_REPLACEMENT_ATTEMPT'
       AND attempt.metadata->>'sourceEvent'='USER_INVITED'
       AND attempt.metadata->>'attemptStatus' IN (
         'PREPARED','REVOCATION_REJECTED','REVOCATION_UNKNOWN','DISPATCHING',
         'DISPATCH_REJECTED','OUTCOME_UNKNOWN','MULTIPLE_MATCHES'
       )
       AND NOT EXISTS (
         SELECT 1 FROM audit_logs completed
         WHERE completed.school_id=attempt.school_id
           AND completed.event_type='USER_INVITED'
           AND completed.metadata->>'claimId'=attempt.metadata->>'claimId'
           AND completed.metadata->>'invitationId' IS NOT NULL
       )
     ORDER BY attempt.timestamp DESC`,
    [schoolId],
  );
  const recoveryInvitationIds = new Set(attempts.rows.map((attemptRecord: any) =>
    String(parseInvitationMetadata(attemptRecord.metadata).selectedInvitationId ?? "")
  ));
  const invitations = [];
  for (const record of records.rows) {
    const metadata = parseInvitationMetadata(record.metadata);
    const invitationId = String(metadata.invitationId ?? "");
    const claimId = String(metadata.claimId ?? "");
    const email = normalizeEmail(String(metadata.invitedEmail ?? ""));
    const role = metadata.role;
    if (
      !invitationId ||
      !email ||
      !isManageableSchoolInvitationRole(role) ||
      metadata.superseded === true ||
      (claimId && superseded.has(claimId)) ||
      recoveryInvitationIds.has(invitationId)
    ) {
      continue;
    }
    if (registeredUsers.has(`${email}:${role}`)) continue;
    const clerkInvitation = await getClerkSchoolInvitation(invitationId);
    const clerkStatus = clerkInvitation.status as ClerkSchoolInvitationStatus;
    // Accepted Clerk invitations and active accounts are not pending invitations.
    if (clerkStatus !== "pending" && clerkStatus !== "expired") continue;
    invitations.push({
      invitationId,
      claimId: claimId || null,
      email,
      fullName: [metadata.firstName, metadata.lastName]
        .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0)
        .join(" ") || null,
      schoolId,
      role,
      status: clerkStatus === "pending" ? "PENDING" as const : "EXPIRED" as const,
      clerkStatus,
      isCurrent: true,
      createdAt: record.createdAt,
    });
  }
  for (const attemptRecord of attempts.rows) {
    const metadata = parseInvitationMetadata(attemptRecord.metadata);
    if (!isManageableSchoolInvitationRole(metadata.role)) continue;
    invitations.push({
      invitationId: String(metadata.selectedInvitationId ?? ""),
      recoveryAttemptId: String(metadata.attemptId ?? ""),
      recoveryState: String(metadata.attemptStatus ?? "OUTCOME_UNKNOWN"),
      claimId: String(metadata.claimId ?? "") || null,
      email: normalizeEmail(String(metadata.invitedEmail ?? "")),
      fullName: [metadata.firstName, metadata.lastName]
        .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0)
        .join(" ") || null,
      schoolId,
      role: metadata.role,
      status: "RECOVERY_REQUIRED" as const,
      clerkStatus: null,
      isCurrent: true,
      createdAt: attemptRecord.createdAt,
    });
  }
  return { schoolId, invitations };
}

/**
 * Reissue exactly the selected school invitation. Its audit row is the tenant-scoped
 * identity; Clerk metadata supplies role-specific activation claims omitted from audit.
 */
export async function replaceSchoolUserInvitation(input: {
  schoolId: number;
  invitationId: string;
  email?: string;
}, actor: UserContext) {
  const guardClient = await pool.connect();
  const lockKey = `school-user-invitation:${input.schoolId}:${input.invitationId}`;
  let lockHeld = false;
  let releaseError: Error | undefined;
  try {
    const result = await guardClient.query(
      `SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked`,
      [lockKey],
    );
    lockHeld = result.rows[0]?.locked === true;
    if (!lockHeld) {
      throw new AuthError(409, "This invitation is already being replaced; retry after the current request finishes");
    }
    return await replaceSchoolUserInvitationUnderGuard(input, actor);
  } finally {
    if (lockHeld) {
      try {
        const result = await guardClient.query(
          `SELECT pg_advisory_unlock(hashtextextended($1,0)) AS unlocked`,
          [lockKey],
        );
        if (result.rows[0]?.unlocked !== true) {
          releaseError = new Error("School invitation replacement lock could not be released");
        }
      } catch (error) {
        releaseError = error instanceof Error
          ? error
          : new Error("School invitation replacement lock could not be released");
      }
    }
    guardClient.release(releaseError);
  }
}

async function replaceSchoolUserInvitationUnderGuard(input: {
  schoolId: number;
  invitationId: string;
  email?: string;
}, actor: UserContext) {
  const target = await pool.query(
    `SELECT id,metadata
     FROM audit_logs
     WHERE school_id=$1 AND metadata->>'invitationId'=$2 AND event_type='USER_INVITED'
     ORDER BY timestamp DESC LIMIT 1`,
    [input.schoolId, input.invitationId],
  );
  const source = target.rows[0];
  if (!source) throw new AuthError(404, "School user invitation not found");

  const sourceMetadata = parseInvitationMetadata(source.metadata);
  const oldEmail = normalizeEmail(String(sourceMetadata.invitedEmail ?? ""));
  const email = normalizeEmail(input.email ?? oldEmail);
  const fullName = [sourceMetadata.firstName, sourceMetadata.lastName]
    .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0)
    .join(" ");
  const role = sourceMetadata.role;
  const claimId = sourceMetadata.claimId;
  if (!isManageableSchoolInvitationRole(role)) {
    throw new AuthError(409, "This invitation role cannot be managed through school-user invitations");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(oldEmail) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^[0-9a-f-]{36}$/i.test(String(claimId ?? ""))) {
    throw new AuthError(409, "This invitation does not contain enough information to safely replace it");
  }
  const superseded = await pool.query(
    `SELECT 1 FROM audit_logs
     WHERE school_id=$1 AND event_type='SCHOOL_INVITATION_SUPERSEDED'
       AND metadata->>'supersedesClaimId'=$2 LIMIT 1`,
    [input.schoolId, claimId],
  );
  if (sourceMetadata.superseded === true || superseded.rows[0]) {
    throw new AuthError(409, "This invitation has already been replaced");
  }

  const clerkInvitation = await getClerkSchoolInvitation(input.invitationId);
  const marker = (clerkInvitation.publicMetadata as Record<string, any> | undefined)?.[METADATA_KEY];
  if (
    marker?.schoolId !== input.schoolId ||
    marker?.role !== role ||
    marker?.claimId !== claimId
  ) {
    throw new AuthError(409, "This invitation identity is stale or does not match its school record");
  }
  const clerkStatus = clerkInvitation.status as ClerkSchoolInvitationStatus;
  if (clerkStatus !== "pending" && clerkStatus !== "expired") {
    throw new AuthError(409, "Only pending or expired school invitations may be replaced");
  }

  const activeMembership = await pool.query(
    `SELECT sm.id FROM app_users au
     JOIN school_memberships sm ON sm.user_id=au.id
     WHERE lower(au.email)=lower($1) AND sm.school_id=$2
       AND sm.role=$3 AND sm.status='ACTIVE' LIMIT 1`,
    [oldEmail, input.schoolId, role],
  );
  if (activeMembership.rows[0]) {
    throw new AuthError(409, "This school user is already active");
  }
  if (email !== oldEmail) {
    const existingAccount = await pool.query(
      `SELECT id FROM app_users WHERE lower(email)=lower($1) LIMIT 1`,
      [email],
    );
    if (existingAccount.rows[0]) {
      throw new AuthError(409, "The replacement email already belongs to an account; invite that account through the normal school-user flow");
    }
  }

  const inviteName = fullName || [marker.firstName, marker.lastName]
    .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0)
    .join(" ") || oldEmail;
  const studentId = role === "STUDENT" ? marker.studentId : null;
  const employeeNo =
    (role === "TEACHER" || role === "ACCOUNTANT" || role === "STAFF" || role === "DRIVER") &&
    typeof marker.employeeNo === "string" &&
    /^INV-[A-F0-9]{16}$/.test(marker.employeeNo)
      ? marker.employeeNo
      : null;
  if (
    (role === "STUDENT" && (!Number.isInteger(studentId) || Number(studentId) < 1)) ||
    ((role === "TEACHER" || role === "STAFF" || role === "DRIVER") &&
      (typeof employeeNo !== "string" || !/^INV-[A-F0-9]{16}$/.test(employeeNo)))
  ) {
    throw new AuthError(409, "Role-specific activation details are missing; this invitation cannot be safely replaced");
  }
  const attemptId = randomUUID();
  await reserveReplacementAttempt({
    schoolId: input.schoolId,
    invitationId: input.invitationId,
    sourceEvent: "USER_INVITED",
    role,
    oldClaimId: claimId,
    oldEmail,
    email,
    fullName: inviteName,
    actor,
    marker: { ...marker, studentId, employeeNo },
    attemptId,
    newClaimId: randomUUID(),
  });
  return dispatchReplacementAttempt(input.schoolId, attemptId, actor, { allowPrepared: true });

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
    (invite.role === "TEACHER" || invite.role === "STAFF" || invite.role === "DRIVER") &&
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
      `SELECT current_invite.id,
              current_invite.metadata->>'phone' AS "invitedPhone"
       FROM audit_logs current_invite
       WHERE current_invite.school_id=$1
         AND current_invite.metadata->>'claimId'=$2
         AND current_invite.metadata->>'role'=$4
         AND lower(current_invite.metadata->>'invitedEmail')=lower($3)
         AND (
           (
             current_invite.event_type IN ('SCHOOL_ADMIN_INVITED','USER_INVITED')
             AND (
               (
                 current_invite.metadata->>'invitationId' IS NOT NULL
                 AND current_invite.metadata->>'superseded' IS DISTINCT FROM 'true'
               )
               OR (
                 current_invite.event_type='SCHOOL_ADMIN_INVITED'
                 AND current_invite.metadata->>'invitationId' IS NULL
                 AND current_invite.metadata->>'dispatchStatus' IN (
                   'DISPATCHING','UNKNOWN_PROVIDER_STATE','OUTCOME_UNKNOWN'
                 )
               )
             )
           )
           OR (
             current_invite.event_type='SCHOOL_INVITATION_REPLACEMENT_ATTEMPT'
             AND current_invite.metadata->>'attemptStatus' IN (
               'DISPATCHING','OUTCOME_UNKNOWN','MULTIPLE_MATCHES','COMPLETED'
             )
           )
         )
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
      const verifiedClerkPhone = clerkUser.phoneNumbers.find(
        (item) => item.verification?.status === "verified",
      )?.phoneNumber ?? null;
      const phone = verifiedClerkPhone ??
        (typeof liveClaim.rows[0].invitedPhone === "string" ? liveClaim.rows[0].invitedPhone : null);
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
        if (invite.role === "SCHOOL_ADMIN") {
          await activatePendingSchool(
            client,
            invite.schoolId,
            {
              name: [firstName, lastName].filter(Boolean).join(" ") || email,
              role: invite.role,
              userId,
              clerkUserId,
            },
            membership.rows[0].id,
            invite.role,
            invite.claimId,
            "CLERK_INVITATION",
          );
        }
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