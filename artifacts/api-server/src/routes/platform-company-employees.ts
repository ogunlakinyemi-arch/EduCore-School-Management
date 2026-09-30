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

router.get("/platform/company-employees", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const result = await pool.query(
    `SELECT ${fields} FROM platform_company_employees ORDER BY full_name,id`,
  );
  res.json(result.rows);
}));

router.get("/platform/company-employees/:employeeId", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const result = await pool.query(
    `SELECT ${fields} FROM platform_company_employees WHERE id=$1`,
    [employeeId(req.params.employeeId)],
  );
  if (!result.rows[0]) throw new AuthError(404, "Company employee not found");
  res.json(result.rows[0]);
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