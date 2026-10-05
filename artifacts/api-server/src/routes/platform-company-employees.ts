import { Router, type NextFunction, type Request } from "express";
import { pool } from "@workspace/db";
import { AuthError, assertRoles, getUserContext, requireAuthentication } from "../middlewares/auth";
import {
  createInternalEmployeeInvitation,
  revokeInternalEmployeeInvitation,
  type InternalEmployeeRole,
} from "./internal-employee-invitations";
import { commitInvitationWithRecovery } from "./partner-commit-recovery";

const router = Router();
const run = (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: NextFunction) => handler(req, res).catch(next);

router.use(requireAuthentication());

const fields = `id,"full_name" AS "fullName",email,phone,"job_title" AS "jobTitle",status,
  "created_at" AS "createdAt","updated_at" AS "updatedAt"`;

function employeeId(value: unknown) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new AuthError(404, "Company employee not found");
  return id;
}

function text(value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null) {
    if (required) throw new AuthError(400, `${label} is required`);
    return null;
  }
  if (typeof value !== "string") throw new AuthError(400, `${label} must be a string`);
  const normalized = value.trim();
  if (required && !normalized) throw new AuthError(400, `${label} is required`);
  if (normalized.length > (label === "email" ? 254 : 160)) {
    throw new AuthError(400, `${label} is too long`);
  }
  return normalized || null;
}

function statusValue(value: unknown): "ACTIVE" | "INACTIVE" {
  const status = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (status !== "ACTIVE" && status !== "INACTIVE") {
    throw new AuthError(400, "status must be ACTIVE or INACTIVE");
  }
  return status;
}

async function audit(
  req: Request,
  db: { query: (sql: string, values?: unknown[]) => Promise<any> },
  action: string,
  id: number,
) {
  const context = getUserContext(req);
  await db.query(
    `INSERT INTO audit_logs
      ("user",role,actor_user_id,clerk_user_id,action,module,record_id,event_type,result)
     VALUES($1,'PLATFORM_OWNER',$2,$3,$4,'Company Employees',$5,$6,'SUCCESS')`,
    [
      [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email,
      context.user.id,
      context.user.clerkUserId,
      action,
      id,
      action === "Created company employee"
        ? "PLATFORM_COMPANY_EMPLOYEE_CREATED"
        : "PLATFORM_COMPANY_EMPLOYEE_UPDATED",
    ],
  );
}

async function invitationStatus(employee: Record<string, any>) {
  const result = await pool.query(
    `SELECT latest.metadata->>'role' AS role,
            latest.metadata->>'invitedEmail' AS "invitedEmail",
            NULLIF(latest.metadata->>'schoolId','')::integer AS "schoolId",
            latest.metadata->>'claimId' AS "claimId",
            latest.metadata->>'invitationId' AS "invitationId",
            latest.metadata->>'expiresAt' AS "expiresAt",
            latest.timestamp AS "createdAt",
            EXISTS (
              SELECT 1 FROM app_users au
              JOIN school_memberships sm ON sm.user_id=au.id
              WHERE au.status='ACTIVE' AND lower(au.email)=lower($2)
                AND sm.status='ACTIVE'
                AND ((sm.role='COMPANY_ACCOUNTANT' AND sm.school_id IS NULL)
                  OR (sm.role='DEVICE_ACTIVATION_OFFICER' AND sm.school_id IS NOT NULL))
            ) AS "hasActiveMembership",
            EXISTS (
              SELECT 1 FROM audit_logs invalidation
              WHERE invalidation.record_id=$1 AND invalidation.module='Company Employees'
                AND invalidation.event_type='INTERNAL_EMPLOYEE_INVITATION_INVALIDATED'
                AND invalidation.metadata->>'claimId'=latest.metadata->>'claimId'
            ) AS invalidated
     FROM (SELECT 1) seed
     LEFT JOIN LATERAL (
       SELECT metadata,timestamp FROM audit_logs
       WHERE record_id=$1 AND module='Company Employees'
         AND event_type IN ('INTERNAL_EMPLOYEE_INVITED','INTERNAL_EMPLOYEE_INVITATION_RESENT')
       ORDER BY id DESC LIMIT 1
     ) latest ON TRUE`,
    [employee.id, employee.email],
  );
  const row = result.rows[0];
  const expiry = row?.expiresAt ? new Date(row.expiresAt).getTime() : 0;
  const active = row?.hasActiveMembership === true || row?.hasActiveMembership === "t";
  let status = "NOT_INVITED";
  if (active) status = "ACTIVE";
  else if (row && !row.invalidated && expiry > Date.now()) status = "PENDING";
  else if (row && !row.invalidated && expiry > 0) status = "EXPIRED";
  return {
    employeeId: employee.id,
    email: row?.invitedEmail ?? employee.email,
    status,
    invitation: row?.claimId ? {
      email: row.invitedEmail ?? employee.email,
      role: row.role,
      schoolId: row.schoolId,
      invitationId: row.invitationId,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      status: active ? "ACTIVE" : status,
    } : null,
  };
}

async function insertInvitationAudit(
  db: { query: (sql: string, values?: unknown[]) => Promise<any> },
  req: Request,
  employeeId: number,
  eventType: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  const actor = getUserContext(req);
  await db.query(
    `INSERT INTO audit_logs
      ("user",role,actor_user_id,clerk_user_id,action,module,record_id,event_type,result,metadata)
     VALUES($1,'PLATFORM_OWNER',$2,$3,$4,'Company Employees',$5,$6,'SUCCESS',$7::jsonb)`,
    [
      actor.user.email, actor.user.id, actor.user.clerkUserId,
      action, employeeId, eventType, JSON.stringify(metadata),
    ],
  );
}

router.get("/platform/company-employees", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const result = await pool.query(
    `SELECT ${fields} FROM platform_company_employees ORDER BY full_name,id`,
  );
  const employees = await Promise.all(result.rows.map(async (employee: Record<string, any>) => ({
    ...employee,
    invitationStatus: await invitationStatus(employee),
  })));
  res.json(employees);
}));

router.get("/platform/company-employees/invitations", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const result = await pool.query(`SELECT ${fields} FROM platform_company_employees ORDER BY full_name,id`);
  const rows = await Promise.all(result.rows.map(async (employee: Record<string, any>) => ({
    ...employee,
    invitationStatus: await invitationStatus(employee),
  })));
  res.json(rows);
}));

router.get("/platform/company-employees/:employeeId/invitation", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const result = await pool.query(
    `SELECT ${fields} FROM platform_company_employees WHERE id=$1`,
    [employeeId(req.params.employeeId)],
  );
  if (!result.rows[0]) throw new AuthError(404, "Company employee not found");
  res.json(await invitationStatus(result.rows[0]));
}));

async function replaceEmployeeInvitation(req: Request, res: any, mode: "edit" | "resend") {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const id = employeeId(req.params.employeeId);
  let email: string | undefined;
  let expectedInvitationId: string | undefined;
  if (mode === "edit") {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
        Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, "email")) {
      throw new AuthError(400, "Provide only the replacement invitation email");
    }
    email = text(req.body.email, "email", true)!.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError(400, "A valid email is required");
  } else {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
        Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, "invitationId")) {
      throw new AuthError(400, "Provide only the current invitationId");
    }
    if (typeof req.body.invitationId !== "string" || !req.body.invitationId.trim()) {
      throw new AuthError(400, "invitationId must be a nonempty string");
    }
    expectedInvitationId = req.body.invitationId;
  }

  const client = await pool.connect();
  let newInvitationId: string | null = null;
  let priorInvitationId: string | null = null;
  let committed = false;
  let commitAttempted = false;
  let employee: Record<string, any>;
  let invitation: Awaited<ReturnType<typeof createInternalEmployeeInvitation>>;
  let role: InternalEmployeeRole;
  let schoolId: number | null;
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT ${fields} FROM platform_company_employees WHERE id=$1 FOR UPDATE`,
      [id],
    );
    if (!current.rows[0] || current.rows[0].status !== "ACTIVE") {
      throw new AuthError(404, "Active company employee not found");
    }
    employee = current.rows[0];
    const latest = await client.query(
      `SELECT metadata,
              EXISTS (
                SELECT 1 FROM audit_logs invalidation
                WHERE invalidation.record_id=$1 AND invalidation.module='Company Employees'
                  AND invalidation.event_type='INTERNAL_EMPLOYEE_INVITATION_INVALIDATED'
                  AND invalidation.metadata->>'claimId'=latest.metadata->>'claimId'
              ) AS invalidated
       FROM (
         SELECT metadata FROM audit_logs
         WHERE record_id=$1 AND module='Company Employees'
           AND event_type IN ('INTERNAL_EMPLOYEE_INVITED','INTERNAL_EMPLOYEE_INVITATION_RESENT')
         ORDER BY id DESC LIMIT 1
       ) latest`,
      [id],
    );
    const previous = latest.rows[0];
    if (!previous || previous.invalidated) {
      throw new AuthError(409, "There is no current invitation to edit or resend");
    }
    const marker = previous.metadata as Record<string, unknown>;
    if (mode === "resend" && marker.invitationId !== expectedInvitationId) {
      throw new AuthError(409, "The invitation is no longer current; refresh before resending");
    }
    role = marker.role as InternalEmployeeRole;
    schoolId = marker.schoolId === null ? null : Number(marker.schoolId);
    if ((role !== "COMPANY_ACCOUNTANT" && role !== "DEVICE_ACTIVATION_OFFICER") ||
        (role === "COMPANY_ACCOUNTANT" && schoolId !== null) ||
        (role === "DEVICE_ACTIVATION_OFFICER" && (!Number.isSafeInteger(schoolId) || schoolId! < 1)) ||
        typeof marker.claimId !== "string" || !marker.claimId ||
        typeof marker.invitationId !== "string" || !marker.invitationId) {
      throw new AuthError(409, "The current invitation cannot be safely changed");
    }
    const expiry = marker.expiresAt ? new Date(String(marker.expiresAt)).getTime() : 0;
    if (mode === "edit" && expiry <= Date.now()) {
      throw new AuthError(409, "An expired invitation can only be resent");
    }
    const active = await client.query(
      `SELECT 1 FROM app_users au
       JOIN school_memberships sm ON sm.user_id=au.id
       WHERE au.status='ACTIVE' AND lower(au.email)=lower($1) AND sm.status='ACTIVE'
         AND ((sm.role='COMPANY_ACCOUNTANT' AND sm.school_id IS NULL)
           OR (sm.role='DEVICE_ACTIVATION_OFFICER' AND sm.school_id IS NOT NULL))
       LIMIT 1`,
      [employee.email],
    );
    if (active.rows[0]) throw new AuthError(409, "This employee already has active internal access");
    priorInvitationId = marker.invitationId;
    const targetEmail = email ?? employee.email;
    invitation = await createInternalEmployeeInvitation(client, {
      employeeId: id,
      email: targetEmail,
      fullName: employee.fullName,
      role,
      schoolId,
      ...(mode === "resend" ? { ignoreExisting: true } : {}),
    });
    newInvitationId = invitation.id;
    if (mode === "edit") {
      const updated = await client.query(
        `UPDATE platform_company_employees SET email=$1,updated_at=NOW()
         WHERE id=$2 RETURNING ${fields}`,
        [targetEmail, id],
      );
      employee = updated.rows[0];
      await insertInvitationAudit(client, req, id, "INTERNAL_EMPLOYEE_INVITATION_EDITED",
        "Edited pending internal employee invitation email", {
          previousEmail: current.rows[0].email, email: targetEmail, role, schoolId,
          oldClaimId: marker.claimId, claimId: invitation.claimId,
        });
    }
    await insertInvitationAudit(client, req, id, "INTERNAL_EMPLOYEE_INVITATION_INVALIDATED",
      "Invalidated replaced internal employee invitation", {
        claimId: marker.claimId, invitationId: marker.invitationId, reason: mode,
      });
    await insertInvitationAudit(client, req, id, "INTERNAL_EMPLOYEE_INVITATION_RESENT",
      mode === "edit" ? "Sent edited internal employee invitation" : "Resent internal employee invitation", {
        invitedEmail: targetEmail, role, schoolId, invitationId: invitation.id,
        claimId: invitation.claimId, expiresAt: invitation.expiresAt,
      });
    commitAttempted = true;
    const resolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM audit_logs
         WHERE record_id=$1 AND event_type='INTERNAL_EMPLOYEE_INVITATION_RESENT'
           AND metadata->>'claimId'=$2 LIMIT 1`,
        [id, invitation.claimId],
      )).rows[0]),
      revokeInvitation: () => revokeInternalEmployeeInvitation(newInvitationId!),
    });
    if (resolution === "ABORTED") {
      newInvitationId = null;
      throw new AuthError(503, "Invitation update failed; the new Clerk invitation was revoked");
    }
    if (resolution === "UNKNOWN") {
      newInvitationId = null;
      throw new AuthError(503, "Invitation status is uncertain; contact the platform owner before retrying");
    }
    committed = true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (newInvitationId && !committed && !commitAttempted) {
      try {
        await revokeInternalEmployeeInvitation(newInvitationId);
      } catch {
        throw new AuthError(503, "Invitation update failed and Clerk could not revoke the new invitation");
      }
    }
    if ((error as { code?: string })?.code === "23505") {
      throw new AuthError(409, "A company employee with this email already exists");
    }
    throw error;
  } finally {
    client.release();
  }
  try {
    await revokeInternalEmployeeInvitation(priorInvitationId!);
  } catch {
    throw new AuthError(503, "The previous Clerk invitation may still be open, but its signed claim has been invalidated");
  }
  res.json({
    employeeId: id,
    email: employee!.email,
    role: role!,
    schoolId: schoolId!,
    invitation: {
      status: "DISPATCH_REQUEST_ACCEPTED",
      deliveryConfirmed: false,
      invitationId: invitation!.id,
      expiresAt: invitation!.expiresAt,
    },
  });
}

router.patch("/platform/company-employees/:employeeId/invitation", run(async (req, res) => {
  await replaceEmployeeInvitation(req, res, "edit");
}));

router.post("/platform/company-employees/:employeeId/invitation/resend", run(async (req, res) => {
  await replaceEmployeeInvitation(req, res, "resend");
}));

router.get("/platform/company-employees/:employeeId", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const result = await pool.query(
    `SELECT ${fields} FROM platform_company_employees WHERE id=$1`,
    [employeeId(req.params.employeeId)],
  );
  if (!result.rows[0]) throw new AuthError(404, "Company employee not found");
  res.json({
    ...result.rows[0],
    invitationStatus: await invitationStatus(result.rows[0]),
  });
}));

router.post("/platform/company-employees", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const allowed = ["fullName", "email", "phone", "jobTitle", "role", "schoolId"];
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => !allowed.includes(key))) {
    throw new AuthError(400, "Provide only employee profile fields, role, and the authorized school");
  }
  const fullName = text(req.body?.fullName, "fullName", true)!;
  const email = text(req.body?.email, "email", true)!.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError(400, "A valid email is required");
  const phone = text(req.body?.phone, "phone");
  const jobTitle = text(req.body?.jobTitle, "jobTitle");
  const role = req.body?.role;
  const schoolId = req.body?.schoolId === undefined ? null : employeeId(req.body.schoolId);
  if (role !== "COMPANY_ACCOUNTANT" && role !== "DEVICE_ACTIVATION_OFFICER") {
    throw new AuthError(400, "role must be COMPANY_ACCOUNTANT or DEVICE_ACTIVATION_OFFICER");
  }
  if (role === "DEVICE_ACTIVATION_OFFICER" && schoolId === null) {
    throw new AuthError(400, "An authorized school is required for a Device Activation Officer");
  }
  if (role === "COMPANY_ACCOUNTANT" && schoolId !== null) {
    throw new AuthError(400, "A Company Accountant cannot be assigned to a school");
  }
  const client = await pool.connect();
  let clerkInvitationId: string | null = null;
  let committed = false;
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    if (schoolId !== null) {
      const school = await client.query(
        `SELECT id FROM schools WHERE id=$1 AND upper(status)='ACTIVE' FOR SHARE`,
        [schoolId],
      );
      if (!school.rows[0]) throw new AuthError(404, "Active school not found");
    }
    const result = await client.query(
      `INSERT INTO platform_company_employees(full_name,email,phone,job_title)
       VALUES($1,$2,$3,$4) RETURNING ${fields}`,
      [fullName, email, phone, jobTitle],
    );
    const employee = result.rows[0];
    const invitation = await createInternalEmployeeInvitation(client, {
      employeeId: employee.id,
      email,
      fullName,
      role: role as InternalEmployeeRole,
      schoolId,
    });
    clerkInvitationId = invitation.id;
    await insertInvitationAudit(client, req, employee.id, "INTERNAL_EMPLOYEE_INVITED",
      "Invited internal company employee", {
        invitationId:invitation.id,claimId:invitation.claimId,role,schoolId,email,
        expiresAt:invitation.expiresAt,
      });
    await audit(req, client, "Created company employee", employee.id);
    commitAttempted = true;
    const resolution = await commitInvitationWithRecovery({
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      isCommitted: async () => Boolean((await pool.query(
        `SELECT 1 FROM platform_company_employees WHERE id=$1`,
        [employee.id],
      )).rows[0]),
      revokeInvitation: () => revokeInternalEmployeeInvitation(clerkInvitationId!),
    });
    if (resolution === "ABORTED") {
      clerkInvitationId = null;
      throw new AuthError(503, "Employee invitation could not be finalized; the invitation was revoked and no profile was created");
    }
    if (resolution === "UNKNOWN") {
      clerkInvitationId = null;
      throw new AuthError(503, "Employee invitation status is uncertain; contact the platform owner before retrying");
    }
    committed = true;
    res.status(201).json({
      ...employee,
      role,
      schoolId,
      invitation: { status: "DISPATCH_REQUEST_ACCEPTED", deliveryConfirmed: false, expiresAt: invitation.expiresAt },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (clerkInvitationId && !committed && !commitAttempted) {
      try {
        await revokeInternalEmployeeInvitation(clerkInvitationId);
      } catch {
        throw new AuthError(
          503,
          "Employee invitation finalization failed and Clerk could not revoke the invitation; contact platform support before retrying",
        );
      }
    }
    if ((error as { code?: string })?.code === "23505") {
      throw new AuthError(409, "A company employee with this email already exists");
    }
    throw error;
  } finally {
    client.release();
  }
}));

router.patch("/platform/company-employees/:employeeId", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const id = employeeId(req.params.employeeId);
  const allowed = ["fullName", "email", "phone", "jobTitle", "status"];
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
      !Object.keys(req.body).length || Object.keys(req.body).some((key) => !allowed.includes(key))) {
    throw new AuthError(400, "Provide one or more supported employee fields");
  }
  const current = await pool.query(
    `SELECT ${fields} FROM platform_company_employees WHERE id=$1`,
    [id],
  );
  if (!current.rows[0]) throw new AuthError(404, "Company employee not found");

  const fullName = req.body.fullName === undefined ? current.rows[0].fullName :
    text(req.body.fullName, "fullName", true);
  const email = req.body.email === undefined ? current.rows[0].email :
    text(req.body.email, "email", true)!.toLowerCase();
  if (req.body.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError(400, "A valid email is required");
  }
  if (req.body.email !== undefined && email !== current.rows[0].email.toLowerCase()) {
    const invitationState = await invitationStatus(current.rows[0]);
    if (invitationState.status === "PENDING") {
      throw new AuthError(409, "Use the pending invitation email edit endpoint to change this employee email");
    }
  }
  const phone = req.body.phone === undefined ? current.rows[0].phone : text(req.body.phone, "phone");
  const jobTitle = req.body.jobTitle === undefined ? current.rows[0].jobTitle : text(req.body.jobTitle, "jobTitle");
  const status = req.body.status === undefined ? current.rows[0].status : statusValue(req.body.status);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE platform_company_employees
       SET full_name=$1,email=$2,phone=$3,job_title=$4,status=$5,updated_at=NOW()
       WHERE id=$6 RETURNING ${fields}`,
      [fullName, email, phone, jobTitle, status, id],
    );
    const employee = result.rows[0];
    await audit(req, client, "Updated company employee", id);
    await client.query("COMMIT");
    res.json(employee);
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string })?.code === "23505") {
      throw new AuthError(409, "A company employee with this email already exists");
    }
    throw error;
  } finally {
    client.release();
  }
}));

export default router;