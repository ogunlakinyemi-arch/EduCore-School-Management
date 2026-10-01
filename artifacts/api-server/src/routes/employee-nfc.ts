import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request } from "express";
import { pool } from "@workspace/db";
import {
  AuthError,
  assertSchoolAccess,
  assertSchoolOperationalAccess,
  getUserContext,
  hasRole,
  isPlatformOwner,
  requireAuthentication,
} from "../middlewares/auth";
import {
  employeeNfcCardActionStatus,
  employeeNfcIdentityMatches,
  employeeNfcPersonType,
  isVerifiedCurrentTermNfcEntitlement,
  validEmployeeNfcIsoDate,
} from "../lib/employee-nfc-policy";
import { getStaffNfcEligibility } from "./staff-nfc-billing-service";

type DbClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};

const router = Router();
const run =
  (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: NextFunction) =>
    handler(req, res).catch(next);

function positiveId(value: unknown, name: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new AuthError(400, `${name} must be a positive integer`);
  }
  return result;
}

async function mapInBatches<T, R>(
  values: T[],
  batchSize: number,
  mapper: (value: T) => Promise<R>,
) {
  const output: R[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    output.push(...await Promise.all(values.slice(index, index + batchSize).map(mapper)));
  }
  return output;
}

function currentSchoolContext(req: Request) {
  const context = getUserContext(req);
  return context;
}

/**
 * Owner school reads are explicit platform visibility only. A Platform Owner
 * can mutate these physical NFC/card records because employee-card assignment,
 * replacement, lock and activation are explicitly assigned platform controls.
 * Mixed-role Owner sessions never fall through to school operational writes.
 */
function assertEmployeeNfcRead(req: Request, schoolId: number) {
  const context = currentSchoolContext(req);
  if (isPlatformOwner(context)) return context;
  if (hasRole(context, "SCHOOL_ADMIN", schoolId)) {
    assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    return context;
  }
  assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN"]);
  return context;
}

function assertEmployeeNfcMutation(req: Request, schoolId: number) {
  const context = currentSchoolContext(req);
  if (isPlatformOwner(context)) return context;
  if (hasRole(context, "SCHOOL_ADMIN", schoolId)) {
    return assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
  }
  throw new AuthError(404, "School not found or employee NFC management is not available");
}

function assertSchoolAdminDiscrepancyWrite(req: Request, schoolId: number) {
  return assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
}

function employeeContextOrNotFound(employee: { id: number | string; employeeType: string }) {
  const personType = employeeNfcPersonType(employee.employeeType);
  if (!personType) throw new AuthError(404, "Employee not found");
  return personType;
}

async function assertTargetSchool(db: DbClient, schoolId: number) {
  const result = await db.query(`SELECT id FROM schools WHERE id=$1`, [schoolId]);
  if (!result.rows[0]) throw new AuthError(404, "School not found");
}

async function getActiveTerm(
  db: DbClient,
  schoolId: number,
  employeeId: number,
) {
  const result = await db.query(
    `SELECT t.id AS "termId", t.name AS "termName", t.academic_session_id AS "sessionId",
            s.name AS "sessionName", t.start_date AS "startDate", t.end_date AS "endDate"
       FROM academic_terms t
       JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
      WHERE t.school_id=$1 AND t.is_current=true AND t.status='ACTIVE'
        AND s.is_current=true AND s.status='ACTIVE'
        AND t.start_date<=CURRENT_DATE AND t.end_date>=CURRENT_DATE
        AND EXISTS (
          SELECT 1 FROM employees e
           WHERE e.id=$2 AND e.school_id=$1 AND e.employment_status='ACTIVE'
             AND UPPER(e.employee_type) IN ('TEACHER','STAFF')
        )
       ORDER BY t.start_date DESC, t.id DESC
       LIMIT 1`,
    [schoolId, employeeId],
  );
  return result.rows[0] as
    | { termId: number; termName: string; sessionId: number; sessionName: string; startDate: string; endDate: string }
    | undefined;
}

/**
 * Use the authoritative billing-owned entitlement service for both reads and
 * device admission; the attendance path calls it inside the event transaction.
 */
async function getEmployeeTermEligibility(
  db: DbClient,
  employeeId: number,
  schoolId: number,
) {
  const term = await getActiveTerm(db, schoolId, employeeId);
  if (!term) {
    return {
      configured: true as const,
      eligible: false,
      status: "NOT_CONFIGURED" as const,
      currentTerm: null,
      subscriptionId: null,
    };
  }

  let billing;
  try {
    billing = await getStaffNfcEligibility(db, employeeId, schoolId, Number(term.termId));
  } catch {
    // Surface billing unavailability as an explicit profile state and remain
    // ineligible. Physical card management is still useful while billing is
    // being configured; the device-ingestion path turns this state into a 503.
    return {
      configured: false as const,
      eligible: false,
      status: "NOT_CONFIGURED" as const,
      currentTerm: {
        termId: term.termId,
        termName: term.termName,
        academicYear: term.sessionName,
      },
      subscriptionId: null,
    };
  }
  const status = billing.eligible
    ? "PAID"
    : String(billing.status ?? "UNPAID").toUpperCase();
  return {
    configured: true as const,
    eligible: isVerifiedCurrentTermNfcEntitlement({
      paymentStatus: status,
      verificationStatus: billing.eligible && status === "PAID" ? "VERIFIED" : "UNVERIFIED",
    }),
    status: ["PAID", "PENDING", "UNPAID", "FAILED", "EXPIRED"].includes(status)
      ? (status as "PAID" | "PENDING" | "UNPAID" | "FAILED" | "EXPIRED")
      : "UNPAID" as const,
    currentTerm: {
      termId: term.termId,
      termName: term.termName,
      academicYear: term.sessionName,
    },
    subscriptionId: billing.subscriptionId == null ? null : Number(billing.subscriptionId),
  };
}

async function assertEmployeeTermPaid(
  db: DbClient,
  employeeId: number,
  schoolId: number,
) {
  const eligibility = await getEmployeeTermEligibility(db, employeeId, schoolId);
  if (!eligibility.configured) {
    throw new AuthError(503, "Employee NFC subscription verification is not configured");
  }
  if (!eligibility.eligible) {
    throw new AuthError(403, "A paid, server-verified NFC subscription for the current academic term is required");
  }
  return eligibility;
}

async function employeeCardView(db: DbClient, schoolId: number, employeeId: number) {
  const employees = await db.query(
    `SELECT e.id AS "employeeId", e.school_id AS "schoolId", e.employee_no AS "employeeNo",
            e.employee_type AS "employeeType", trim(concat_ws(' ',e.first_name,e.middle_name,e.last_name)) AS "employeeName",
            binding.id AS "bindingId", binding.status AS "bindingStatus",
            binding."cardId", binding.uid, binding."cardStatus" AS status,
            binding.scans, binding."activatedAt"
       FROM employees e
       LEFT JOIN LATERAL (
         SELECT b.id,b.status,c.id AS "cardId",c.uid,c.status AS "cardStatus",
                c.scans,c.activated_at AS "activatedAt"
           FROM employee_nfc_card_bindings b
           JOIN nfc_cards c ON c.id=b.nfc_card_id AND c.school_id=b.school_id
          WHERE b.employee_id=e.id AND b.school_id=e.school_id
          ORDER BY CASE WHEN b.status IN ('ASSIGNED','ACTIVE','LOCKED') THEN 0 ELSE 1 END,
                   b.id DESC
          LIMIT 1
       ) binding ON TRUE
      WHERE e.id=$1 AND e.school_id=$2 AND e.employment_status='ACTIVE'
      LIMIT 1`,
    [employeeId, schoolId],
  );
  const row = employees.rows[0];
  if (!row) throw new AuthError(404, "Employee not found");
  const personType = employeeContextOrNotFound(row);
  const entitlement = await getEmployeeTermEligibility(db, employeeId, schoolId);
  const status = row.bindingId == null
    ? "UNASSIGNED"
    : String(row.bindingStatus).toUpperCase() === "ASSIGNED"
      ? "LOCKED"
      : String(row.status ?? "DEACTIVATED").toUpperCase();
  return {
    cardId: row.cardId == null ? null : Number(row.cardId),
    schoolId: Number(row.schoolId),
    employeeId: Number(row.employeeId),
    personType,
    employeeName: row.employeeName,
    employeeNo: row.employeeNo,
    uid: row.uid ?? null,
    status: ["UNASSIGNED", "LOCKED", "ACTIVE", "DEACTIVATED", "REPLACED"].includes(status)
      ? status
      : "DEACTIVATED",
    termEligibility: entitlement.status,
    paymentRequired: !entitlement.eligible,
    nfcEligible: status === "ACTIVE" && entitlement.eligible,
    scans: Number(row.scans ?? 0),
    ...(entitlement.currentTerm ? { currentTerm: entitlement.currentTerm } : {}),
    activatedAt: row.activatedAt ?? null,
  };
}

async function auditEmployeeCardAction(
  req: Request,
  db: DbClient,
  input: {
    schoolId: number;
    employeeId: number;
    bindingId: number;
    cardId: number;
    action: string;
    previousStatus: string | null;
    newStatus: string | null;
    reason: string;
    replacementNfcCardId?: number | null;
  },
) {
  const context = getUserContext(req);
  await db.query(
    `INSERT INTO employee_nfc_card_history
       (school_id,binding_id,nfc_card_id,employee_id,action,previous_status,
        new_status,replacement_nfc_card_id,reason,actor_user_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.schoolId, input.bindingId, input.cardId, input.employeeId, input.action,
      input.previousStatus, input.newStatus, input.replacementNfcCardId ?? null,
      input.reason, context.user.id,
    ],
  );
  await db.query(
    `INSERT INTO audit_logs
       ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
        severity,event_type,result,metadata)
     VALUES($1,$2,$3,$4,$5,$6,'NFC', $7,'info',$8,'SUCCESS',$9::jsonb)`,
    [
      [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email,
      isPlatformOwner(context) ? "PLATFORM_OWNER" :
        hasRole(context, "DEVICE_ACTIVATION_OFFICER", input.schoolId)
          ? "DEVICE_ACTIVATION_OFFICER"
          : "SCHOOL_ADMIN",
      context.user.id,
      context.user.clerkUserId,
      input.schoolId,
      `Employee NFC card ${input.action.toLowerCase()}`,
      input.cardId,
      `EMPLOYEE_NFC_CARD_${input.action}`,
      JSON.stringify({
        employeeId: input.employeeId,
        bindingId: input.bindingId,
        cardId: input.cardId,
        previousStatus: input.previousStatus,
        newStatus: input.newStatus,
        replacementNfcCardId: input.replacementNfcCardId ?? null,
        reason: input.reason,
      }),
    ],
  );
}

const getDevice = async (req: Request) => {
  const supplied = req.header("X-Device-Credential")?.trim() ?? "";
  const separator = supplied.indexOf(".");
  if (separator < 1 || separator === supplied.length - 1) {
    throw new AuthError(401, "A valid configured device credential is required");
  }
  const identifierValue = supplied.slice(0, separator);
  const secret = supplied.slice(separator + 1);
  const device = await pool.query(
    `SELECT c.id AS "credentialId", c.device_id AS "deviceId", c.school_id AS "schoolId",
            c.secret_hash AS "secretHash", d.status AS "deviceStatus"
       FROM device_credentials c
       JOIN platform_devices d ON d.id=c.device_id AND d.school_id=c.school_id
      WHERE c.credential_identifier=$1 AND c.status='ACTIVE'
        AND (c.expires_at IS NULL OR c.expires_at>NOW())`,
    [identifierValue],
  );
  const row = device.rows[0];
  const digest = createHash("sha256").update(secret).digest();
  const stored = row?.secretHash ? Buffer.from(row.secretHash, "hex") : Buffer.alloc(0);
  if (!row || stored.length !== digest.length || !timingSafeEqual(digest, stored) ||
      row.deviceStatus !== "ACTIVE") {
    throw new AuthError(401, "Invalid or inactive device credential");
  }
  const configured = await pool.query(
    `SELECT 1 FROM platform_devices
      WHERE id=$1 AND school_id=$2 AND school_id IS NOT NULL
        AND configuration_status='CONFIGURED'`,
    [row.deviceId, row.schoolId],
  );
  if (!configured.rows[0]) throw new AuthError(403, "The NFC device is not configured for a school");
  await pool.query(`UPDATE device_credentials SET last_used_at=NOW() WHERE id=$1`, [row.credentialId]);
  await pool.query(`UPDATE platform_devices SET last_seen_at=NOW() WHERE id=$1`, [row.deviceId]);
  return row as { credentialId: number; deviceId: number; schoolId: number };
};

const authenticateEmployeeUser = requireAuthentication();
router.use((req, res, next) => {
  const employeeNfcUserPath =
    /^\/schools\/\d+\/employee-nfc(?:\/|$)/.test(req.path) ||
    /^\/me\/employee-nfc(?:\/|$)/.test(req.path);
  const employeeNfcDevicePath =
    req.path === "/devices/employee-nfc/attendance/events" && req.method === "POST";
  // This router is mounted before the application's global authenticated
  // router. Never intercept public webhooks or other unmatched API routes.
  if (!employeeNfcUserPath || employeeNfcDevicePath) {
    return next();
  }
  return authenticateEmployeeUser(req, res, next);
});

router.get("/schools/:schoolId/employee-nfc/cards", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  assertEmployeeNfcRead(req, schoolId);
  const requestedPersonType =
    req.query.personType === undefined ? null : employeeNfcPersonType(req.query.personType);
  if (req.query.personType !== undefined && !requestedPersonType) {
    throw new AuthError(400, "personType must be TEACHER or STAFF");
  }
  const search = req.query.search === undefined ? null : String(req.query.search).trim();
  if (search !== null && search.length > 100) throw new AuthError(400, "search must be 100 characters or shorter");
  const requestedStatus =
    req.query.status === undefined ? null : String(req.query.status).toUpperCase();
  if (requestedStatus !== null &&
      !["UNASSIGNED", "LOCKED", "ACTIVE", "DEACTIVATED", "REPLACED"].includes(requestedStatus)) {
    throw new AuthError(400, "Invalid employee NFC card status");
  }
  const pageLimit = req.query.limit === undefined ? 100 : positiveId(req.query.limit, "limit");
  if (pageLimit > 200) throw new AuthError(400, "limit must not exceed 200");
  const offset =
    req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new AuthError(400, "offset must be a non-negative integer up to 1000000");
  }
  const result = await pool.query(
    `SELECT e.id AS "employeeId",
            CASE WHEN upper(e.employee_type)='TEACHER' THEN 'TEACHER' ELSE 'STAFF' END AS "personType"
       FROM employees e
       LEFT JOIN LATERAL (
         SELECT b.status AS "bindingStatus",c.status AS "cardStatus"
           FROM employee_nfc_card_bindings b
           JOIN nfc_cards c ON c.id=b.nfc_card_id AND c.school_id=b.school_id
          WHERE b.employee_id=e.id AND b.school_id=e.school_id
          ORDER BY CASE WHEN b.status IN ('ASSIGNED','ACTIVE','LOCKED') THEN 0 ELSE 1 END,
                   b.id DESC
          LIMIT 1
       ) card ON TRUE
      WHERE e.school_id=$1 AND e.employment_status='ACTIVE'
        AND UPPER(e.employee_type) IN ('TEACHER','STAFF')
        AND ($2::text IS NULL OR CASE WHEN upper(e.employee_type)='TEACHER' THEN 'TEACHER' ELSE 'STAFF' END=$2)
        AND ($3::text IS NULL OR e.employee_no ILIKE $3 OR
          (concat_ws(' ',e.first_name,e.middle_name,e.last_name)) ILIKE $3 OR COALESCE(e.email,'') ILIKE $3)
        AND ($4::text IS NULL OR
          (CASE
            WHEN card."bindingStatus" IS NULL THEN 'UNASSIGNED'
            WHEN upper(card."bindingStatus")='ASSIGNED' THEN 'LOCKED'
            ELSE upper(card."cardStatus")
           END)=$4)
      ORDER BY e.employee_type,e.last_name,e.first_name,e.employee_no
      LIMIT $5 OFFSET $6`,
    [schoolId, requestedPersonType, search ? `%${search}%` : null, requestedStatus, pageLimit, offset],
  );
  const items = await mapInBatches(
    result.rows,
    10,
    (row) => employeeCardView(pool, schoolId, Number(row.employeeId)),
  );
  res.json(items);
}));

router.post("/schools/:schoolId/employee-nfc/cards/assign", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const context = assertEmployeeNfcMutation(req, schoolId);
  await assertTargetSchool(pool, schoolId);
  const employeeId = positiveId(req.body?.employeeId, "employeeId");
  const uid = String(req.body?.uid ?? "").trim();
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!uid || uid.length > 160 || uid.includes("\u0000")) throw new AuthError(400, "uid is required and must be at most 160 characters");
  if (reason.length > 500) throw new AuthError(400, "reason must be at most 500 characters");
  if (req.body?.personType != null) {
    const declaredType = employeeNfcPersonType(req.body.personType);
    if (!declaredType) throw new AuthError(400, "personType must be TEACHER or STAFF");
  }
  const employee = await pool.query(
    `SELECT id,employee_type AS "employeeType" FROM employees
      WHERE id=$1 AND school_id=$2 AND employment_status='ACTIVE'`,
    [employeeId, schoolId],
  );
  if (!employee.rows[0]) throw new AuthError(404, "Employee not found in this school");
  const actualType = employeeContextOrNotFound(employee.rows[0]);
  if (req.body?.personType != null && employeeNfcPersonType(req.body.personType) !== actualType) {
    throw new AuthError(409, "The employee's server-verified person type does not match personType");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const target = await client.query(
      `SELECT id,employee_type AS "employeeType" FROM employees
        WHERE id=$1 AND school_id=$2 AND employment_status='ACTIVE' FOR UPDATE`,
      [employeeId, schoolId],
    );
    if (!target.rows[0]) throw new AuthError(404, "Employee not found in this school");
    const duplicate = await client.query(
      `SELECT id FROM employee_nfc_card_bindings
        WHERE school_id=$1 AND employee_id=$2
          AND status IN ('ASSIGNED','ACTIVE','LOCKED')
        FOR UPDATE`,
      [schoolId, employeeId],
    );
    if (duplicate.rows[0]) {
      throw new AuthError(409, "This employee already has a current NFC card; use replace instead");
    }
    const card = await client.query(
      `SELECT id,school_id AS "schoolId",uid,student_id AS "studentId",status
         FROM nfc_cards
        WHERE school_id=$1 AND lower(uid)=lower($2)
        FOR UPDATE`,
      [schoolId, uid],
    );
    if (!card.rows[0]) throw new AuthError(404, "Provisioned NFC card not found in this school");
    if (card.rows[0].studentId != null) {
      throw new AuthError(409, "This card is assigned to a student and cannot be rebound to an employee");
    }
    if (String(card.rows[0].status).toLowerCase() !== "unassigned") {
      throw new AuthError(409, "Only a prepared, unassigned NFC card may be assigned");
    }
    const binding = await client.query(
      `INSERT INTO employee_nfc_card_bindings(school_id,nfc_card_id,employee_id,status,created_by_user_id)
       VALUES($1,$2,$3,'ASSIGNED',$4)
       RETURNING id`,
      [schoolId, card.rows[0].id, employeeId, context.user.id],
    );
    if (!binding.rows[0]) throw new AuthError(409, "Could not assign the employee NFC card");
    await client.query(
      `UPDATE nfc_cards SET status='locked',issued_at=COALESCE(issued_at,NOW())
        WHERE id=$1 AND school_id=$2 AND student_id IS NULL`,
      [card.rows[0].id, schoolId],
    );
    await auditEmployeeCardAction(req, client, {
      schoolId,
      employeeId,
      bindingId: Number(binding.rows[0].id),
      cardId: Number(card.rows[0].id),
      action: "ASSIGNED",
      previousStatus: String(card.rows[0].status),
      newStatus: "locked",
      reason: reason || "Assigned prepared NFC card to school employee",
    });
    await client.query("COMMIT");
    res.status(201).json(await employeeCardView(pool, schoolId, employeeId));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.patch("/schools/:schoolId/employee-nfc/cards/:cardId", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const cardId = positiveId(req.params.cardId, "cardId");
  const context = assertEmployeeNfcMutation(req, schoolId);
  await assertTargetSchool(pool, schoolId);
  const newBindingStatus = employeeNfcCardActionStatus(req.body?.action);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!newBindingStatus) throw new AuthError(400, "action must be ACTIVATE, LOCK, or DEACTIVATE");
  if (reason.length < 3 || reason.length > 500) throw new AuthError(400, "A 3 to 500 character reason is required");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT b.id AS "bindingId",b.employee_id AS "employeeId",b.status AS "bindingStatus",
              c.id AS "cardId",c.student_id AS "studentId",c.status AS "cardStatus"
         FROM employee_nfc_card_bindings b
         JOIN nfc_cards c ON c.id=b.nfc_card_id AND c.school_id=b.school_id
        WHERE b.nfc_card_id=$1 AND b.school_id=$2
          AND b.status IN ('ASSIGNED','ACTIVE','LOCKED')
        FOR UPDATE OF b,c`,
      [cardId, schoolId],
    );
    const row = current.rows[0];
    if (!row) throw new AuthError(404, "Employee card not found");
    if (row.studentId != null) throw new AuthError(409, "This NFC card is assigned to a student");
    const employee = await client.query(
      `SELECT id FROM employees
        WHERE id=$1 AND school_id=$2 AND employment_status='ACTIVE' FOR SHARE`,
      [row.employeeId, schoolId],
    );
    if (!employee.rows[0]) throw new AuthError(409, "The employee record is inactive; the assigned card is retained");
    if (newBindingStatus === "ACTIVE" &&
        !["ASSIGNED", "LOCKED", "ACTIVE"].includes(String(row.bindingStatus).toUpperCase())) {
      throw new AuthError(409, "Only an assigned or locked employee card may be activated");
    }
    if (newBindingStatus === "ACTIVE" &&
        !["locked", "active"].includes(String(row.cardStatus).toLowerCase())) {
      throw new AuthError(409, "Only an assigned or locked employee card may be activated");
    }
    if (newBindingStatus !== "ACTIVE" &&
        !["ASSIGNED", "ACTIVE", "LOCKED"].includes(String(row.bindingStatus).toUpperCase())) {
      throw new AuthError(409, "The employee card is no longer current");
    }
    await client.query(
      `UPDATE employee_nfc_card_bindings SET status=$1,updated_at=NOW()
        WHERE id=$2 AND school_id=$3`,
      [newBindingStatus, row.bindingId, schoolId],
    );
    await client.query(
      `UPDATE nfc_cards SET status=$1,
          activated_at=CASE WHEN $1='active' AND activated_at IS NULL THEN NOW() ELSE activated_at END,
          deactivated_at=CASE WHEN $1='deactivated' THEN NOW() ELSE deactivated_at END
        WHERE id=$2 AND school_id=$3 AND student_id IS NULL`,
      [newBindingStatus.toLowerCase(), cardId, schoolId],
    );
    await auditEmployeeCardAction(req, client, {
      schoolId,
      employeeId: Number(row.employeeId),
      bindingId: Number(row.bindingId),
      cardId,
      action: newBindingStatus,
      previousStatus: String(row.bindingStatus).toUpperCase(),
      newStatus: newBindingStatus,
      reason,
    });
    await client.query("COMMIT");
    res.json(await employeeCardView(pool, schoolId, Number(row.employeeId)));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/schools/:schoolId/employee-nfc/cards/:cardId/replace", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const cardId = positiveId(req.params.cardId, "cardId");
  const context = assertEmployeeNfcMutation(req, schoolId);
  await assertTargetSchool(pool, schoolId);
  const uid = String(req.body?.uid ?? "").trim();
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!uid || uid.length > 160 || uid.includes("\u0000")) throw new AuthError(400, "A valid prepared replacement card UID is required");
  if (reason.length < 3 || reason.length > 500) throw new AuthError(400, "A 3 to 500 character reason is required");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const previous = await client.query(
      `SELECT b.id AS "bindingId",b.employee_id AS "employeeId",b.status AS "bindingStatus",
              c.uid,c.status AS "cardStatus",c.student_id AS "studentId"
         FROM employee_nfc_card_bindings b
         JOIN nfc_cards c ON c.id=b.nfc_card_id AND c.school_id=b.school_id
        WHERE b.nfc_card_id=$1 AND b.school_id=$2
          AND b.status IN ('ASSIGNED','ACTIVE','LOCKED')
        FOR UPDATE OF b,c`,
      [cardId, schoolId],
    );
    const old = previous.rows[0];
    if (!old) throw new AuthError(404, "Employee card not found");
    if (old.studentId != null) throw new AuthError(409, "Student cards cannot be replaced through the employee NFC workflow");
    const replacement = await client.query(
      `SELECT id,uid,student_id AS "studentId",status
         FROM nfc_cards
        WHERE school_id=$1 AND lower(uid)=lower($2)
        FOR UPDATE`,
      [schoolId, uid],
    );
    if (!replacement.rows[0] || replacement.rows[0].studentId != null ||
        String(replacement.rows[0].status).toLowerCase() !== "unassigned") {
      throw new AuthError(409, "Replacement UID must identify a prepared, unassigned card in this same school");
    }
    const updated = await client.query(
      `UPDATE employee_nfc_card_bindings SET status='REPLACED',updated_at=NOW()
        WHERE id=$1 AND school_id=$2`,
      [old.bindingId, schoolId],
    );
    if (!updated.rowCount) throw new AuthError(409, "This employee card was already replaced");
    await client.query(
      `UPDATE nfc_cards SET status='replaced',replaced_at=NOW(),
          replaced_by_card_id=$1,replaced_by_school_id=$2
        WHERE id=$3 AND school_id=$2 AND student_id IS NULL`,
      [replacement.rows[0].id, schoolId, cardId],
    );
    const binding = await client.query(
      `INSERT INTO employee_nfc_card_bindings(school_id,nfc_card_id,employee_id,status,created_by_user_id)
       VALUES($1,$2,$3,'LOCKED',$4)
       RETURNING id`,
      [schoolId, replacement.rows[0].id, old.employeeId, context.user.id],
    );
    if (!binding.rows[0]) throw new AuthError(409, "Replacement binding could not be recorded");
    await client.query(
      `UPDATE nfc_cards SET status='locked',issued_at=COALESCE(issued_at,NOW())
        WHERE id=$1 AND school_id=$2 AND student_id IS NULL`,
      [replacement.rows[0].id, schoolId],
    );
    await auditEmployeeCardAction(req, client, {
      schoolId,
      employeeId: Number(old.employeeId),
      bindingId: Number(old.bindingId),
      cardId,
      action: "REPLACED",
      previousStatus: String(old.bindingStatus),
      newStatus: "REPLACED",
      reason,
      replacementNfcCardId: Number(replacement.rows[0].id),
    });
    await auditEmployeeCardAction(req, client, {
      schoolId,
      employeeId: Number(old.employeeId),
      bindingId: Number(binding.rows[0].id),
      cardId: Number(replacement.rows[0].id),
      action: "ASSIGNED_AS_REPLACEMENT",
      previousStatus: "unassigned",
      newStatus: "LOCKED",
      reason,
    });
    await client.query("COMMIT");
    res.status(201).json(await employeeCardView(pool, schoolId, Number(old.employeeId)));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.get("/schools/:schoolId/employee-nfc/cards/:cardId/history", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const cardId = positiveId(req.params.cardId, "cardId");
  assertEmployeeNfcRead(req, schoolId);
  const card = await pool.query(
    `SELECT b.id FROM employee_nfc_card_bindings b
       JOIN nfc_cards c ON c.id=b.nfc_card_id AND c.school_id=b.school_id
      WHERE b.nfc_card_id=$1 AND b.school_id=$2 AND c.student_id IS NULL`,
    [cardId, schoolId],
  );
  if (!card.rows[0]) throw new AuthError(404, "Employee card not found");
  const result = await pool.query(
    `SELECT id,school_id AS "schoolId",binding_id AS "bindingId",
            nfc_card_id AS "cardId",employee_id AS "employeeId",action,
            previous_status AS "previousStatus",new_status AS "newStatus",
            replacement_nfc_card_id AS "replacedByCardId",reason,
            actor_user_id AS "actorId",created_at AS "occurredAt"
       FROM employee_nfc_card_history
      WHERE nfc_card_id=$1 AND school_id=$2
      ORDER BY created_at,id`,
    [cardId, schoolId],
  );
  res.json(result.rows);
}));

async function currentUserEmployee(req: Request) {
  const context = currentSchoolContext(req);
  if (isPlatformOwner(context) ||
      !context.roles.some((entry) => entry.status === "ACTIVE" &&
        entry.schoolId !== null && ["TEACHER", "STAFF"].includes(entry.role))) {
    throw new AuthError(403, "Only an authenticated school Teacher or Staff member may view their own employee NFC information");
  }
  const result = await pool.query(
    `SELECT e.id AS "employeeId",e.school_id AS "schoolId",
            e.employee_type AS "employeeType"
       FROM employees e
       JOIN school_memberships m
         ON m.user_id=e.user_id AND m.school_id=e.school_id
        AND m.status='ACTIVE' AND m.role IN ('TEACHER','STAFF')
      WHERE e.user_id=$1 AND e.employment_status='ACTIVE'
      ORDER BY e.school_id,e.id
      LIMIT 3`,
    [context.user.id],
  );
  if (result.rows.length !== 1) {
    throw new AuthError(404, result.rows.length
      ? "More than one employee profile is associated with this account; contact your school administrator"
      : "The authenticated account has no active Teacher/Staff profile");
  }
  const row = result.rows[0];
  return {
    employeeId: Number(row.employeeId),
    schoolId: Number(row.schoolId),
    personType: employeeContextOrNotFound(row),
  };
}

async function getEmployeeNfcIdentity(
  db: DbClient,
  employeeId: number,
  schoolId: number,
  personType: string,
) {
  const result = await db.query(
    `SELECT e.id AS "employeeId",e.school_id AS "schoolId",e.employee_no AS "employeeNo",
            CASE WHEN upper(e.employee_type)='TEACHER' THEN 'TEACHER' ELSE 'STAFF' END AS "personType",
            trim(concat_ws(' ',e.first_name,e.middle_name,e.last_name)) AS "employeeName",
            e.employee_type AS "roleTitle",e.photo,
            s.name AS "schoolName",s.logo AS "schoolLogo",s.address AS "schoolAddress",
            s.phone AS "schoolPhone",binding."cardId",binding.uid,
            binding.status AS "bindingStatus",binding."cardStatus",
            binding.scans,binding."activatedAt"
       FROM employees e
       JOIN schools s ON s.id=e.school_id
       LEFT JOIN LATERAL (
         SELECT b.status,c.id AS "cardId",c.uid,c.status AS "cardStatus",
                c.scans,c.activated_at AS "activatedAt"
           FROM employee_nfc_card_bindings b
           JOIN nfc_cards c ON c.id=b.nfc_card_id AND c.school_id=b.school_id
          WHERE b.employee_id=e.id AND b.school_id=e.school_id
          ORDER BY CASE WHEN b.status IN ('ASSIGNED','ACTIVE','LOCKED') THEN 0 ELSE 1 END,
                   b.id DESC
          LIMIT 1
       ) binding ON TRUE
       WHERE e.id=$1 AND e.school_id=$2 AND e.employment_status='ACTIVE'
         AND UPPER(e.employee_type) IN ('TEACHER','STAFF')
        AND CASE WHEN upper(e.employee_type)='TEACHER' THEN 'TEACHER' ELSE 'STAFF' END=$3`,
    [employeeId, schoolId, personType],
  );
  const row = result.rows[0];
  if (!row) throw new AuthError(404, "Employee NFC profile not found in this school");
  const entitlement = await getEmployeeTermEligibility(db, employeeId, schoolId);
  const cardStatus = row.bindingStatus == null
    ? "UNASSIGNED"
    : String(row.bindingStatus).toUpperCase() === "ASSIGNED"
      ? "LOCKED"
      : String(row.cardStatus ?? "DEACTIVATED").toUpperCase();
  const next = await db.query(
    `SELECT t.id AS "termId",t.name AS "termName",s.name AS "academicYear"
       FROM academic_terms t
       JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
      WHERE t.school_id=$1 AND t.status='ACTIVE' AND s.status='ACTIVE'
        AND t.start_date>CURRENT_DATE
      ORDER BY t.start_date,t.id
      LIMIT 1`,
    [schoolId],
  );
  return {
    ...row,
    uid: row.uid ?? null,
    status: cardStatus,
    termEligibility: entitlement.status,
    paymentRequired: !entitlement.eligible,
    nfcEligible: cardStatus === "ACTIVE" && entitlement.eligible,
    scans: Number(row.scans ?? 0),
    currentTerm: entitlement.currentTerm,
    nextTerm: next.rows[0] ?? null,
  };
}

router.get("/me/employee-nfc", run(async (req, res) => {
  const employee = await currentUserEmployee(req);
  res.json(await getEmployeeNfcIdentity(
    pool,
    employee.employeeId,
    employee.schoolId,
    employee.personType,
  ));
}));

router.get("/schools/:schoolId/employee-nfc/:employeeId/e-id", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const employeeId = positiveId(req.params.employeeId, "employeeId");
  const context = currentSchoolContext(req);
  const ownStaffView =
    !isPlatformOwner(context) && !hasRole(context, "SCHOOL_ADMIN", schoolId) &&
    (hasRole(context, "TEACHER", schoolId) || hasRole(context, "STAFF", schoolId));
  if (ownStaffView) assertSchoolAccess(req, schoolId, ["TEACHER", "STAFF"]);
  else assertEmployeeNfcRead(req, schoolId);
  const employee = await pool.query(
    `SELECT id,employee_type AS "employeeType",user_id AS "userId"
       FROM employees
      WHERE id=$1 AND school_id=$2 AND employment_status='ACTIVE'`,
    [employeeId, schoolId],
  );
  if (!employee.rows[0]) throw new AuthError(404, "Employee E-ID not found");
  const personType = employeeContextOrNotFound(employee.rows[0]);
  if (ownStaffView && Number(employee.rows[0].userId) !== context.user.id) {
    throw new AuthError(404, "Employee E-ID not found");
  }
  if (!ownStaffView &&
      !isPlatformOwner(context) &&
      !hasRole(context, "SCHOOL_ADMIN", schoolId)) {
    throw new AuthError(403, "Employee E-ID is not available to this role");
  }
  res.json(await getEmployeeNfcIdentity(pool, employeeId, schoolId, personType));
}));

router.get("/me/employee-nfc/attendance", run(async (req, res) => {
  const employee = await currentUserEmployee(req);
  const from = req.query.from === undefined ? null : validEmployeeNfcIsoDate(req.query.from);
  const to = req.query.to === undefined ? null : validEmployeeNfcIsoDate(req.query.to);
  if (req.query.from !== undefined && !from) throw new AuthError(400, "from must be a valid YYYY-MM-DD date");
  if (req.query.to !== undefined && !to) throw new AuthError(400, "to must be a valid YYYY-MM-DD date");
  const result = await pool.query(
    `SELECT e.id,e.school_id AS "schoolId",e.employee_id AS "employeeId",
            CASE WHEN upper(p.employee_type)='TEACHER' THEN 'TEACHER' ELSE 'STAFF' END AS "personType",
            e.event_type AS "eventType",e.identification_method AS "identificationMethod",
            e.attendance_status AS status,e.result,e.occurred_at AS "occurredAt",
            e.device_id AS "deviceId",
            EXISTS(SELECT 1 FROM employee_nfc_attendance_discrepancies d
                    WHERE d.attendance_event_id=e.id AND d.school_id=e.school_id) AS discrepancy
       FROM attendance_events e
       JOIN employees p ON p.id=e.employee_id AND p.school_id=e.school_id
      WHERE e.school_id=$1 AND e.employee_id=$2 AND e.student_id IS NULL
        AND ($3::date IS NULL OR e.occurred_at >= $3::date)
        AND ($4::date IS NULL OR e.occurred_at < ($4::date + INTERVAL '1 day'))
      ORDER BY e.occurred_at DESC,e.id DESC
      LIMIT 500`,
    [employee.schoolId, employee.employeeId, from, to],
  );
  res.json(result.rows);
}));

router.get("/schools/:schoolId/employee-nfc/attendance/events", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  assertEmployeeNfcRead(req, schoolId);
  const employeeId =
    req.query.employeeId === undefined ? null : positiveId(req.query.employeeId, "employeeId");
  const from = req.query.from === undefined ? null : validEmployeeNfcIsoDate(req.query.from);
  const to = req.query.to === undefined ? null : validEmployeeNfcIsoDate(req.query.to);
  if (req.query.from !== undefined && !from) throw new AuthError(400, "from must be a valid YYYY-MM-DD date");
  if (req.query.to !== undefined && !to) throw new AuthError(400, "to must be a valid YYYY-MM-DD date");
  if (from && to && from > to) throw new AuthError(400, "from must not be after to");
  const status = req.query.status == null ? null : String(req.query.status).toUpperCase();
  if (status != null && !["PRESENT", "LATE", "ABSENT", "LEFT_EARLY", "EXCUSED", "UNKNOWN", "MISMATCH"].includes(status)) {
    throw new AuthError(400, "Invalid attendance status");
  }
  const result = await pool.query(
    `SELECT e.id,e.school_id AS "schoolId",e.employee_id AS "employeeId",
            CASE WHEN upper(p.employee_type)='TEACHER' THEN 'TEACHER' ELSE 'STAFF' END AS "personType",
            e.event_type AS "eventType",e.identification_method AS "identificationMethod",
            e.attendance_status AS status,e.result,e.occurred_at AS "occurredAt",
            e.device_id AS "deviceId",
            EXISTS(SELECT 1 FROM employee_nfc_attendance_discrepancies d
                    WHERE d.attendance_event_id=e.id AND d.school_id=e.school_id) AS discrepancy
       FROM attendance_events e
       JOIN employees p ON p.id=e.employee_id AND p.school_id=e.school_id
      WHERE e.school_id=$1 AND e.employee_id IS NOT NULL AND e.student_id IS NULL
        AND upper(p.employee_type) IN ('TEACHER','STAFF')
        AND ($2::int IS NULL OR e.employee_id=$2)
        AND ($3::date IS NULL OR e.occurred_at >= $3::date)
        AND ($4::date IS NULL OR e.occurred_at < ($4::date + INTERVAL '1 day'))
        AND ($5::text IS NULL OR e.attendance_status=$5)
      ORDER BY e.occurred_at DESC,e.id DESC
      LIMIT 500`,
    [schoolId, employeeId, from, to, status],
  );
  res.json(result.rows);
}));

router.post("/devices/employee-nfc/attendance/events", run(async (req, res) => {
  const device = await getDevice(req);
  const employeeId = positiveId(req.body?.employeeId, "employeeId");
  const suppliedType = employeeNfcPersonType(req.body?.personType);
  const uid = String(req.body?.nfcUid ?? "").trim();
  const eventType = String(req.body?.eventType ?? "").toUpperCase();
  if (!suppliedType) throw new AuthError(400, "personType must be TEACHER or STAFF; student NFC ingestion is separate");
  if (!uid || uid.length > 160) throw new AuthError(400, "A valid nfcUid is required");
  if (!["SCHOOL_ENTRY", "SCHOOL_EXIT"].includes(eventType)) {
    throw new AuthError(400, "eventType must be SCHOOL_ENTRY or SCHOOL_EXIT");
  }
  const occurred = req.body?.occurredAt == null ? null : new Date(req.body.occurredAt);
  if (!occurred || !Number.isFinite(occurred.getTime()) ||
      occurred.getTime() > Date.now() + 5 * 60_000 ||
      occurred.getTime() < Date.now() - 24 * 60 * 60_000) {
    throw new AuthError(400, "occurredAt must be within five minutes of now and the last 24 hours");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const validatedDevice = await client.query(
      `SELECT d.id AS "deviceId",d.school_id AS "schoolId"
         FROM platform_devices d
         JOIN device_credentials c ON c.device_id=d.id
        WHERE d.id=$1 AND d.school_id=$2 AND d.status='ACTIVE'
          AND d.configuration_status='CONFIGURED' AND c.id=$3
          AND c.school_id=d.school_id AND c.status='ACTIVE'
          AND (c.expires_at IS NULL OR c.expires_at>NOW())
        FOR UPDATE OF d`,
      [device.deviceId, device.schoolId, device.credentialId],
    );
    if (!validatedDevice.rows[0]) throw new AuthError(401, "Device authorization expired before the NFC event was recorded");
    const employeeResult = await client.query(
      `SELECT id,school_id AS "schoolId",employee_type AS "employeeType"
         FROM employees
        WHERE id=$1 AND school_id=$2 AND employment_status='ACTIVE'
        FOR SHARE`,
      [employeeId, device.schoolId],
    );
    if (!employeeResult.rows[0]) throw new AuthError(404, "Employee not found for this NFC device");
    const actualType = employeeContextOrNotFound(employeeResult.rows[0]);
    if (!employeeNfcIdentityMatches(actualType, suppliedType)) {
      throw new AuthError(403, "The employee and submitted NFC person types do not match");
    }
    const identity = await client.query(
      `SELECT e.id,e.employee_type AS "employeeType",
              c.id AS "cardId",b.id AS "bindingId"
         FROM nfc_cards c
         JOIN employee_nfc_card_bindings b
           ON b.nfc_card_id=c.id AND b.school_id=c.school_id
          AND b.employee_id=$3 AND b.status='ACTIVE'
         JOIN employees e ON e.id=b.employee_id AND e.school_id=b.school_id
        WHERE c.school_id=$1 AND lower(c.uid)=lower($2) AND c.student_id IS NULL
          AND lower(c.status)='active' AND e.employment_status='ACTIVE'
        FOR SHARE OF c,b,e`,
      [device.schoolId, uid, employeeId],
    );
    if (!identity.rows[0]) {
      const studentCard = await client.query(
        `SELECT 1 FROM nfc_cards
          WHERE school_id=$1 AND uid=$2 AND student_id IS NOT NULL`,
        [device.schoolId, uid],
      );
      if (studentCard.rows[0]) {
        throw new AuthError(403, "A student NFC card cannot be treated as a teacher or staff NFC card");
      }
      throw new AuthError(403, "This NFC card is not active and linked to the submitted employee");
    }
    if (!employeeNfcIdentityMatches(employeeContextOrNotFound(identity.rows[0]), suppliedType)) {
      throw new AuthError(403, "The verified NFC employee person type does not match the device event");
    }
    const settings = await client.query(
      `SELECT duplicate_suppression_seconds AS "suppressionSeconds",
              entry_window_end AS "entryWindowEnd",exit_window_start AS "exitWindowStart"
         FROM attendance_settings WHERE school_id=$1`,
      [device.schoolId],
    );
    const suppression = Math.max(0, Math.min(3600, Number(settings.rows[0]?.suppressionSeconds ?? 30)));
    const lockKey = `${device.schoolId}:${employeeId}:${device.deviceId}:${eventType}`;
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [lockKey]);
    const recent = await client.query(
      `SELECT id,school_id AS "schoolId",employee_id AS "employeeId",
              event_type AS "eventType",identification_method AS "identificationMethod",
              attendance_status AS status,result,device_id AS "deviceId",
              nfc_card_id AS "nfcCardId",occurred_at AS "occurredAt"
         FROM attendance_events
        WHERE school_id=$1 AND employee_id=$2 AND device_id=$3 AND event_type=$4
          AND occurred_at BETWEEN $5::timestamptz-($6::text||' seconds')::interval
                              AND $5::timestamptz+($6::text||' seconds')::interval
        ORDER BY occurred_at DESC,id DESC LIMIT 1`,
      [device.schoolId, employeeId, device.deviceId, eventType, occurred.toISOString(), suppression],
    );
    if (recent.rows[0]) {
      if (new Date(recent.rows[0].occurredAt).getTime() === occurred.getTime()) {
        const duplicateDiscrepancy = await client.query(
          `SELECT EXISTS(SELECT 1 FROM employee_nfc_attendance_discrepancies
                          WHERE school_id=$1 AND attendance_event_id=$2) AS discrepancy`,
          [device.schoolId, recent.rows[0].id],
        );
        await client.query("COMMIT");
        res.status(200).json({
          ...recent.rows[0],
          personType: suppliedType,
          discrepancy: Boolean(duplicateDiscrepancy.rows[0]?.discrepancy),
        });
        return;
      }
      throw new AuthError(409, "Duplicate employee NFC attendance event");
    }
    await assertEmployeeTermPaid(client, employeeId, device.schoolId);
    const result = await client.query(
      `INSERT INTO attendance_events
         (school_id,student_id,employee_id,device_id,nfc_card_id,
          identification_method,event_type,result,attendance_status,event_date,
          occurred_at,academic_session_id,academic_term_id,dedupe_key)
       SELECT $1,NULL,$2,$3,$4,'NFC',$5,'ACCEPTED',
              CASE
                WHEN $5='SCHOOL_ENTRY' AND st.entry_window_end IS NOT NULL
                  AND ($6::timestamptz AT TIME ZONE 'Africa/Lagos')::time > st.entry_window_end
                  THEN 'LATE'
                WHEN $5='SCHOOL_EXIT' AND st.exit_window_start IS NOT NULL
                  AND ($6::timestamptz AT TIME ZONE 'Africa/Lagos')::time < st.exit_window_start
                  THEN 'LEFT_EARLY'
                ELSE 'PRESENT' END,
              ($6::timestamptz AT TIME ZONE 'Africa/Lagos')::date,$6,
              terms.academic_session_id,terms.id,$7
         FROM (SELECT school_id,entry_window_end,exit_window_start FROM attendance_settings
                WHERE school_id=$1
               UNION ALL
               SELECT $1::int,NULL::time,NULL::time
                WHERE NOT EXISTS(SELECT 1 FROM attendance_settings WHERE school_id=$1)
               LIMIT 1) st
         LEFT JOIN LATERAL (
           SELECT t.id,t.academic_session_id FROM academic_terms t
            WHERE t.school_id=$1 AND t.status='ACTIVE' AND t.is_current=true
              AND CURRENT_DATE BETWEEN t.start_date AND t.end_date
            ORDER BY t.start_date DESC,t.id DESC LIMIT 1
         ) terms ON TRUE
       ON CONFLICT (school_id,dedupe_key) DO NOTHING
       RETURNING id,school_id AS "schoolId",employee_id AS "employeeId",
          event_type AS "eventType",identification_method AS "identificationMethod",
          attendance_status AS status,result,device_id AS "deviceId",
          occurred_at AS "occurredAt"`,
      [
         device.schoolId, employeeId, device.deviceId, identity.rows[0].cardId,
         eventType, occurred.toISOString(),
         createHash("sha256")
           .update(`${device.schoolId}:${employeeId}:${device.deviceId}:${uid.toUpperCase()}:${eventType}:${occurred.toISOString()}`)
           .digest("hex"),
      ],
    );
    const event = result.rows[0];
    if (!event) throw new AuthError(409, "Duplicate employee NFC attendance event");
    await client.query(
      `UPDATE nfc_cards SET scans=scans+1,last_scan=$1,last_device_id=$2
        WHERE id=$3 AND school_id=$4 AND student_id IS NULL`,
      [occurred.toISOString(), device.deviceId, event.nfcCardId ?? identity.rows[0].cardId, device.schoolId],
    );

    const unmatched = await client.query(
      `SELECT EXISTS(
         SELECT 1 FROM attendance_events a
          WHERE a.school_id=$1 AND a.employee_id=$2 AND a.student_id IS NULL
            AND a.event_type='SCHOOL_ENTRY' AND a.occurred_at<=$3
            AND NOT EXISTS (
              SELECT 1 FROM attendance_events x
               WHERE x.school_id=$1 AND x.employee_id=$2 AND x.student_id IS NULL
                 AND x.event_type='SCHOOL_EXIT'
                 AND x.occurred_at>a.occurred_at AND x.occurred_at<=$3
            )
        ) AS "hasUnmatchedEntry",
        EXISTS(
         SELECT 1 FROM attendance_events a
          WHERE a.school_id=$1 AND a.employee_id=$2 AND a.student_id IS NULL
            AND a.event_type='SCHOOL_ENTRY' AND a.id<>$4
            AND a.occurred_at<=$3
            AND NOT EXISTS (
              SELECT 1 FROM attendance_events x
               WHERE x.school_id=$1 AND x.employee_id=$2 AND x.student_id IS NULL
                 AND x.event_type='SCHOOL_EXIT'
                 AND x.occurred_at>a.occurred_at AND x.occurred_at<=$3
            )
        ) AS "hasEarlierUnmatchedEntry"`,
      [device.schoolId, employeeId, occurred.toISOString(), event.id],
    );
    const anomaly = eventType === "SCHOOL_EXIT"
      ? !unmatched.rows[0]?.hasUnmatchedEntry
      : Boolean(unmatched.rows[0]?.hasEarlierUnmatchedEntry);
    if (anomaly) {
      await client.query(
        `INSERT INTO employee_nfc_attendance_discrepancies
           (school_id,employee_id,attendance_event_id,kind,status,details)
         VALUES($1,$2,$3,$4,'OPEN',$5::jsonb)
         ON CONFLICT(school_id,attendance_event_id,kind) DO NOTHING`,
        [
          device.schoolId, employeeId, event.id,
          eventType === "SCHOOL_EXIT" ? "EXIT_WITHOUT_ENTRY" : "DUPLICATE_ENTRY_WITHOUT_EXIT",
          JSON.stringify({
            eventType,
            deviceId: device.deviceId,
            employeeId,
            note: eventType === "SCHOOL_EXIT"
              ? "Exit scan received without an earlier unmatched school entry."
              : "A second school entry scan was received before a school exit scan.",
          }),
        ],
      );
    }
    await client.query(
      `INSERT INTO audit_logs
         ("user",role,school_id,action,module,record_id,severity,event_type,result,metadata)
       VALUES('School NFC device','DEVICE',$1,'Recorded employee NFC attendance',
         'Attendance',$2,'info',
         'EMPLOYEE_NFC_ATTENDANCE_RECORDED','SUCCESS',$3::jsonb)`,
      [device.schoolId, event.id, JSON.stringify({
        employeeId,
        personType: suppliedType,
        eventType,
        deviceId: device.deviceId,
        status: event.status,
      })],
    );
    await client.query("COMMIT");
    res.status(201).json({
      ...event,
      personType: suppliedType,
      discrepancy: anomaly,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.get("/schools/:schoolId/employee-nfc/attendance/daily", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  assertEmployeeNfcRead(req, schoolId);
  const date = req.query.date === undefined
    ? new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" })
    : validEmployeeNfcIsoDate(req.query.date);
  if (!date) throw new AuthError(400, "date must be a valid YYYY-MM-DD school-local date");
  const summary = await pool.query(
    `SELECT COUNT(DISTINCT e.employee_id)::int AS employees,
        COUNT(*) FILTER(WHERE e.event_type='SCHOOL_ENTRY'
                           AND e.attendance_status IN ('PRESENT','LATE'))::int AS entries,
        COUNT(*) FILTER(WHERE e.event_type='SCHOOL_EXIT')::int AS exits,
        COUNT(*) FILTER(WHERE e.event_type='SCHOOL_ENTRY'
                           AND e.attendance_status='LATE')::int AS late,
        (SELECT COUNT(*)::int FROM employee_nfc_attendance_discrepancies d
          JOIN attendance_events a ON a.id=d.attendance_event_id AND a.school_id=d.school_id
          WHERE d.school_id=$1 AND a.event_date=$2 AND d.status='OPEN') AS discrepancies
       FROM attendance_events e
      WHERE e.school_id=$1 AND e.employee_id IS NOT NULL AND e.student_id IS NULL
        AND e.event_date=$2`,
    [schoolId, date],
  );
  res.json({ date, schoolId, ...summary.rows[0] });
}));

router.get("/schools/:schoolId/employee-nfc/attendance/monthly", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  assertEmployeeNfcRead(req, schoolId);
  const month = String(req.query.month ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new AuthError(400, "month must be a valid YYYY-MM calendar month");
  }
  const employeeId = req.query.employeeId == null
    ? null
    : positiveId(req.query.employeeId, "employeeId");
  const result = await pool.query(
    `SELECT $1::int AS "schoolId",e.employee_id AS "employeeId",
            trim(concat_ws(' ',p.first_name,p.middle_name,p.last_name)) AS "employeeName",
            p.employee_no AS "employeeNo",
            CASE WHEN upper(p.employee_type)='TEACHER' THEN 'TEACHER' ELSE 'STAFF' END AS "personType",
            COUNT(DISTINCT e.event_date) FILTER(
              WHERE e.event_type='SCHOOL_ENTRY' AND e.attendance_status IN ('PRESENT','LATE'))::int AS "attendanceDays",
            COUNT(*) FILTER(WHERE e.event_type='SCHOOL_ENTRY' AND e.attendance_status='LATE')::int AS late,
            COUNT(*) FILTER(WHERE e.event_type='SCHOOL_EXIT' AND e.attendance_status='LEFT_EARLY')::int AS "earlyDeparture",
            COUNT(*) FILTER(WHERE e.event_type='SCHOOL_ENTRY')::int AS entries,
            COUNT(*) FILTER(WHERE e.event_type='SCHOOL_EXIT')::int AS exits
       FROM attendance_events e
       JOIN employees p ON p.id=e.employee_id AND p.school_id=e.school_id
      WHERE e.school_id=$1 AND e.employee_id IS NOT NULL AND e.student_id IS NULL
        AND upper(p.employee_type) IN ('TEACHER','STAFF')
        AND e.event_date >= ($2::text||'-01')::date
        AND e.event_date < (($2::text||'-01')::date + INTERVAL '1 month')
        AND ($3::int IS NULL OR e.employee_id=$3)
      GROUP BY e.employee_id,p.first_name,p.middle_name,p.last_name,p.employee_no,p.employee_type
      ORDER BY "employeeName",e.employee_id`,
    [schoolId, month, employeeId],
  );
  res.json(result.rows);
}));

router.get("/schools/:schoolId/employee-nfc/attendance/discrepancies", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const context = assertEmployeeNfcRead(req, schoolId);
  if (!isPlatformOwner(context) && !hasRole(context, "SCHOOL_ADMIN", schoolId)) {
    throw new AuthError(403, "Employee NFC discrepancy reports are school-administrator-only");
  }
  const status = req.query.status == null ? null : String(req.query.status).toUpperCase();
  if (status != null && !["OPEN", "RESOLVED"].includes(status)) {
    throw new AuthError(400, "status must be OPEN or RESOLVED");
  }
  const result = await pool.query(
    `SELECT d.id,d.school_id AS "schoolId",d.employee_id AS "employeeId",
            trim(concat_ws(' ',e.first_name,e.middle_name,e.last_name)) AS "employeeName",
            d.attendance_event_id AS "attendanceEventId",
            a.event_type AS "eventType",d.kind,d.status,
            d.created_at AS "detectedAt",COALESCE(d.details->>'note',d.kind) AS reason,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'resolution',x.resolution,'reason',x.reason,'actorId',x.actor_user_id,
                'occurredAt',x.created_at) ORDER BY x.created_at,x.id)
                FROM employee_nfc_discrepancy_actions x
               WHERE x.school_id=d.school_id AND x.discrepancy_id=d.id
            ),'[]'::jsonb) AS "resolutionHistory"
       FROM employee_nfc_attendance_discrepancies d
       JOIN employees e ON e.id=d.employee_id AND e.school_id=d.school_id
       JOIN attendance_events a ON a.id=d.attendance_event_id AND a.school_id=d.school_id
      WHERE d.school_id=$1 AND ($2::text IS NULL OR d.status=$2)
      ORDER BY d.created_at DESC,d.id DESC
      LIMIT 500`,
    [schoolId, status],
  );
  res.json(result.rows);
}));

router.post(
  "/schools/:schoolId/employee-nfc/attendance/discrepancies/:discrepancyId/resolve",
  run(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "schoolId");
    const discrepancyId = positiveId(req.params.discrepancyId, "discrepancyId");
    const context = assertSchoolAdminDiscrepancyWrite(req, schoolId);
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    const resolution = String(req.body?.resolution ?? "").toUpperCase();
    if (reason.length < 3 || reason.length > 500) {
      throw new AuthError(400, "A 3 to 500 character resolution reason is required");
    }
    if (!["ACCEPT", "IGNORE", "FOLLOW_UP"].includes(resolution)) {
      throw new AuthError(400, "resolution must be ACCEPT, IGNORE, or FOLLOW_UP");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT d.id,d.employee_id AS "employeeId",d.status
           FROM employee_nfc_attendance_discrepancies d
           JOIN attendance_events a ON a.id=d.attendance_event_id AND a.school_id=d.school_id
          WHERE d.id=$1 AND d.school_id=$2 AND a.employee_id=d.employee_id
            AND a.student_id IS NULL
          FOR UPDATE OF d`,
        [discrepancyId, schoolId],
      );
      const discrepancy = current.rows[0];
      if (!discrepancy) throw new AuthError(404, "Employee attendance discrepancy not found");
      if (discrepancy.status !== "OPEN") throw new AuthError(409, "This employee attendance discrepancy is already resolved");
      await client.query(
        `INSERT INTO employee_nfc_discrepancy_actions
           (school_id,discrepancy_id,resolution,reason,actor_user_id)
         VALUES($1,$2,$3,$4,$5)`,
        [schoolId, discrepancyId, resolution, reason, context.user.id],
      );
      await client.query(
        `UPDATE employee_nfc_attendance_discrepancies
            SET status='RESOLVED',resolved_at=NOW(),resolved_by_user_id=$1
          WHERE id=$2 AND school_id=$3 AND status='OPEN'`,
        [context.user.id, discrepancyId, schoolId],
      );
      await client.query(
        `INSERT INTO audit_logs
           ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
            severity,event_type,result,metadata)
         VALUES($1,$2,$3,$4,$5,'Resolved employee NFC attendance discrepancy',
            'Attendance',$6,'info','EMPLOYEE_NFC_DISCREPANCY_RESOLVED','SUCCESS',$7::jsonb)`,
        [
          [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email,
          isPlatformOwner(context) ? "PLATFORM_OWNER" : "SCHOOL_ADMIN",
          context.user.id,context.user.clerkUserId,schoolId,discrepancyId,
          JSON.stringify({ resolution, reason, employeeId: Number(discrepancy.employeeId) }),
        ],
      );
      await client.query("COMMIT");
      const result = await pool.query(
        `SELECT d.id,d.school_id AS "schoolId",d.employee_id AS "employeeId",
                trim(concat_ws(' ',e.first_name,e.middle_name,e.last_name)) AS "employeeName",
                d.attendance_event_id AS "attendanceEventId",
                a.event_type AS "eventType",d.kind,d.status,d.created_at AS "detectedAt",
                COALESCE(d.details->>'note',d.kind) AS reason,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'resolution',x.resolution,'reason',x.reason,'actorId',x.actor_user_id,
                    'occurredAt',x.created_at) ORDER BY x.created_at,x.id)
                    FROM employee_nfc_discrepancy_actions x
                   WHERE x.school_id=d.school_id AND x.discrepancy_id=d.id
                ),'[]'::jsonb) AS "resolutionHistory"
           FROM employee_nfc_attendance_discrepancies d
           JOIN employees e ON e.id=d.employee_id AND e.school_id=d.school_id
           JOIN attendance_events a ON a.id=d.attendance_event_id AND a.school_id=d.school_id
          WHERE d.id=$1 AND d.school_id=$2`,
        [discrepancyId, schoolId],
      );
      res.json(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

export default router;