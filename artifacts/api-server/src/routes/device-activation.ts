import {activeSchoolNfcDevicesSql} from "../lib/nfc-device-first";
import { Router, type NextFunction, type Request } from "express";
import { pool } from "@workspace/db";
import {
  AuthError,
  assertDeviceActivationOfficer,
  assertRoles,
  getUserContext,
  handleAuthError,
  requireAuthentication,
} from "../middlewares/auth";

const router = Router();
router.use(requireAuthentication());

const run =
  (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: NextFunction) =>
    handler(req, res).catch((error) => handleAuthError(error, req, res, next));

const activationEIdQuery = `
  SELECT s.id AS "schoolId", s.name AS "schoolName", s.code AS "schoolCode",
    s.logo AS "schoolLogo", s.address AS "schoolAddress",
    st.id AS "studentId", st.admission_no AS "admissionNo",
    st.first_name AS "firstName", st.middle_name AS "middleName",
    st.last_name AS "lastName", st.class_name AS "className",
    st.section, st.photo,
    card.id AS "cardId", card.uid AS "cardNumber",
    card.activated_at AS "activatedAt"
  FROM schools s
  JOIN students st ON st.school_id = s.id
  LEFT JOIN LATERAL (
    SELECT nc.id, nc.uid, nc.activated_at
    FROM nfc_cards nc
    WHERE nc.school_id = s.id AND nc.student_id = st.id AND lower(nc.status) = 'active'
    ORDER BY nc.activated_at DESC NULLS LAST, nc.id DESC
    LIMIT 1
  ) card ON TRUE
  WHERE s.id = $1 AND st.id = $2`;

function id(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new AuthError(400, `${label} must be a positive integer`);
  }
  return parsed;
}

async function assertOfficerSchool(
  req: Request,
  schoolId: number,
  db: { query: (sql: string, values?: unknown[]) => Promise<any> } = pool,
  lock = false,
) {
  const context = await assertDeviceActivationOfficer(req);
  const authorized = await db.query(
    `SELECT 1
     FROM school_memberships sm
     JOIN app_users au ON au.id = sm.user_id
     JOIN platform_company_employees pce
       ON lower(pce.email) = lower(au.email) AND pce.status = 'ACTIVE'
     JOIN schools s ON s.id = sm.school_id
     WHERE sm.user_id = $1 AND sm.school_id = $2
       AND sm.role = 'DEVICE_ACTIVATION_OFFICER' AND sm.status = 'ACTIVE'
       AND au.status = 'ACTIVE' AND lower(au.email) = lower($3)
     LIMIT 1${lock ? " FOR SHARE OF sm, au, pce" : ""}`,
    [context.user.id, schoolId, context.user.email],
  );
  if (!authorized.rows[0]) {
    throw new AuthError(404, "School not found or Device Activation Officer access is not active", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
  return context;
}

function isActivePlatformOwner(req: Request) {
  return getUserContext(req).roles.some(
    (assignment) =>
      assignment.role === "PLATFORM_OWNER" &&
      assignment.schoolId === null &&
      assignment.status === "ACTIVE",
  );
}

async function assertActivationSchool(
  req: Request,
  schoolId: number,
  db: { query: (sql: string, values?: unknown[]) => Promise<any> } = pool,
  lock = false,
) {
  if (isActivePlatformOwner(req)) {
    const school = await db.query(
      `SELECT id FROM schools WHERE id = $1${lock ? " FOR SHARE" : ""}`,
      [schoolId],
    );
    if (!school.rows[0]) {
      throw new AuthError(404, "School not found", "CROSS_TENANT_ACCESS_ATTEMPT");
    }
    return getUserContext(req);
  }
  return assertOfficerSchool(req, schoolId, db, lock);
}

async function auditActivation(
  req: Request,
  db: { query: (sql: string, values?: unknown[]) => Promise<any> },
  schoolId: number,
  cardId: number,
  metadata: Record<string, unknown>,
) {
  const context = getUserContext(req);
  const name = [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email;
  const role = isActivePlatformOwner(req) ? "PLATFORM_OWNER" : "DEVICE_ACTIVATION_OFFICER";
  await db.query(
    `INSERT INTO audit_logs
      ("user", role, actor_user_id, clerk_user_id, school_id, action, module,
       record_id, severity, event_type, result, metadata)
      VALUES ($1, $7, $2, $3, $4,
       'Activated NFC card for student', 'NFC Activation', $5, 'info',
       'NFC_CARD_ACTIVATED', 'SUCCESS', $6::jsonb)`,
    [name, context.user.id, context.user.clerkUserId, schoolId, cardId, JSON.stringify(metadata), role],
  );
}

async function auditGrant(
  req: Request,
  db: { query: (sql: string, values?: unknown[]) => Promise<any> },
  schoolId: number,
  userId: number,
  action: "GRANTED" | "REVOKED",
) {
  const context = getUserContext(req);
  const name = [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email;
  await db.query(
    `INSERT INTO audit_logs
      ("user", role, actor_user_id, clerk_user_id, school_id, action, module,
       record_id, severity, event_type, result, metadata)
     VALUES ($1, 'PLATFORM_OWNER', $2, $3, $4, $5, 'Device Activation Access',
       $6, 'info', $7, 'SUCCESS', $8::jsonb)`,
    [
      name,
      context.user.id,
      context.user.clerkUserId,
      schoolId,
      `${action === "GRANTED" ? "Granted" : "Revoked"} Device Activation Officer access`,
      userId,
      `DEVICE_ACTIVATION_ACCESS_${action}`,
      JSON.stringify({ userId, role: "DEVICE_ACTIVATION_OFFICER" }),
    ],
  );
}

router.get("/platform/schools/:schoolId/device-activation-officers", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const schoolId = id(req.params.schoolId, "schoolId");
  const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : undefined;
  if (req.query.email !== undefined &&
      (typeof req.query.email !== "string" || (email?.length ?? 0) > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? ""))) {
    throw new AuthError(400, "email must be a valid email address");
  }
  const school = await pool.query(`SELECT id FROM schools WHERE id = $1`, [schoolId]);
  if (!school.rows[0]) throw new AuthError(404, "School not found");
  const values: unknown[] = [schoolId];
  const emailFilter = email ? ` AND lower(au.email) = lower($2)` : "";
  if (email) values.push(email);
  const result = await pool.query(
    `SELECT sm.id, sm.user_id AS "userId", sm.school_id AS "schoolId",
       sm.role, sm.status, au.email, pce.full_name AS "fullName"
     FROM school_memberships sm
     JOIN app_users au ON au.id = sm.user_id
     LEFT JOIN platform_company_employees pce ON lower(pce.email) = lower(au.email)
     WHERE sm.school_id = $1 AND sm.role = 'DEVICE_ACTIVATION_OFFICER'${emailFilter}
     ORDER BY lower(au.email), sm.user_id`,
    values,
  );
  res.json(result.rows);
}));

router.post("/platform/schools/:schoolId/device-activation-officers", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => key !== "userId" && key !== "email") ||
      (req.body.userId === undefined) === (req.body.email === undefined)) {
    throw new AuthError(400, "Provide exactly one of userId or email");
  }
  const schoolId = id(req.params.schoolId, "schoolId");
  const userId = req.body.userId === undefined ? undefined : id(req.body.userId, "userId");
  const email = req.body.email === undefined ? undefined : String(req.body.email).trim().toLowerCase();
  if (email !== undefined && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new AuthError(400, "email must be a valid email address");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const school = await client.query(`SELECT id FROM schools WHERE id = $1 FOR SHARE`, [schoolId]);
    if (!school.rows[0]) throw new AuthError(404, "School not found");
    let targetUserId = userId;
    if (email !== undefined) {
      const users = await client.query(
        `SELECT id, email, status FROM app_users WHERE lower(email) = lower($1) FOR UPDATE`,
        [email],
      );
      if (users.rows.length > 1) {
        throw new AuthError(409, "Multiple app accounts use this email; resolve the duplicate accounts before granting access");
      }
      const user = users.rows[0];
      if (!user || user.status !== "ACTIVE") {
        throw new AuthError(409, "The employee must sign in once to create an active app account before access can be granted");
      }
      const employee = await client.query(
        `SELECT id FROM platform_company_employees
         WHERE lower(email) = lower($1) AND status = 'ACTIVE'
         FOR SHARE`,
        [email],
      );
      if (!employee.rows[0]) {
        throw new AuthError(409, "An active Yemait Technologies employee profile matching this email is required");
      }
      targetUserId = Number(user.id);
    } else {
      const user = await client.query(
        `SELECT au.id, au.email
         FROM app_users au
         JOIN platform_company_employees pce
           ON lower(pce.email) = lower(au.email) AND pce.status = 'ACTIVE'
         WHERE au.id = $1 AND au.status = 'ACTIVE'
         FOR UPDATE OF au, pce`,
        [targetUserId],
      );
      if (!user.rows[0]) {
        throw new AuthError(409, "An active app user with a matching active Yemait Technologies employee email is required");
      }
    }
    if (targetUserId === undefined) throw new AuthError(400, "Provide exactly one of userId or email");
    const conflictingRoles = await client.query(
      `SELECT role FROM school_memberships
       WHERE user_id = $1 AND status = 'ACTIVE'
         AND role <> 'DEVICE_ACTIVATION_OFFICER'`,
      [targetUserId],
    );
    if (conflictingRoles.rows.length) {
      throw new AuthError(409, "Device Activation Officer access is restricted to accounts without other active platform or school roles");
    }
    const result = await client.query(
      `INSERT INTO school_memberships (user_id, school_id, role, status)
       VALUES ($1, $2, 'DEVICE_ACTIVATION_OFFICER', 'ACTIVE')
       ON CONFLICT (user_id, school_id, role)
       DO UPDATE SET status = 'ACTIVE', updated_at = NOW()
       RETURNING id, user_id AS "userId", school_id AS "schoolId", role, status`,
      [targetUserId, schoolId],
    );
    await auditGrant(req, client, schoolId, targetUserId, "GRANTED");
    await client.query("COMMIT");
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.delete("/platform/schools/:schoolId/device-activation-officers/:userId", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const schoolId = id(req.params.schoolId, "schoolId");
  const userId = id(req.params.userId, "userId");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const school = await client.query(`SELECT id FROM schools WHERE id = $1 FOR SHARE`, [schoolId]);
    if (!school.rows[0]) throw new AuthError(404, "School not found");
    const result = await client.query(
      `UPDATE school_memberships SET status = 'INACTIVE', updated_at = NOW()
       WHERE user_id = $1 AND school_id = $2
         AND role = 'DEVICE_ACTIVATION_OFFICER'
       RETURNING id, user_id AS "userId", school_id AS "schoolId", role, status`,
      [userId, schoolId],
    );
    if (!result.rows[0]) throw new AuthError(404, "Device Activation Officer grant not found");
    await auditGrant(req, client, schoolId, userId, "REVOKED");
    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.get("/activation/schools", run(async (req, res) => {
  if (isActivePlatformOwner(req)) {
    const result = await pool.query(
      `SELECT id, name, code, city, state, logo
       FROM schools
       ORDER BY name, id`,
    );
    res.json(result.rows);
    return;
  }
  const context = await assertDeviceActivationOfficer(req);
  const result = await pool.query(
    `SELECT DISTINCT s.id, s.name, s.code, s.city, s.state, s.logo
     FROM school_memberships sm
     JOIN app_users au ON au.id = sm.user_id
     JOIN platform_company_employees pce
       ON lower(pce.email) = lower(au.email) AND pce.status = 'ACTIVE'
     JOIN schools s ON s.id = sm.school_id
     WHERE sm.user_id = $1 AND lower(au.email) = lower($2)
       AND au.status = 'ACTIVE'
       AND sm.role = 'DEVICE_ACTIVATION_OFFICER' AND sm.status = 'ACTIVE'
     ORDER BY s.name, s.id`,
    [context.user.id, context.user.email],
  );
  res.json(result.rows);
}));

router.get("/activation/schools/:schoolId/devices", run(async (req, res) => {
  const schoolId = id(req.params.schoolId, "schoolId");
  await assertActivationSchool(req, schoolId);
  const result = await pool.query(
    activeSchoolNfcDevicesSql,
    [schoolId],
  );
  res.json(result.rows);
}));

router.get("/activation/schools/:schoolId/students", run(async (req, res) => {
  const schoolId = id(req.params.schoolId, "schoolId");
  await assertActivationSchool(req, schoolId);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  if (search.length > 100) throw new AuthError(400, "search must be at most 100 characters");
  const result = await pool.query(
    `SELECT st.id, st.admission_no AS "admissionNo", st.first_name AS "firstName",
       st.middle_name AS "middleName", st.last_name AS "lastName", st.class_name AS "className",
       st.section, st.photo
     FROM students st
     WHERE st.school_id = $1
       AND ($2 = '' OR st.admission_no ILIKE '%' || $2 || '%'
         OR st.first_name ILIKE '%' || $2 || '%'
         OR st.middle_name ILIKE '%' || $2 || '%'
         OR st.last_name ILIKE '%' || $2 || '%'
         OR st.class_name ILIKE '%' || $2 || '%'
         OR st.section ILIKE '%' || $2 || '%')
     ORDER BY st.last_name, st.first_name, st.id
     LIMIT 100`,
    [schoolId, search],
  );
  res.json(result.rows);
}));

router.get("/activation/schools/:schoolId/history", run(async (req, res) => {
  const schoolId = id(req.params.schoolId, "schoolId");
  await assertActivationSchool(req, schoolId);
  const result = await pool.query(
    `SELECT h.id, h.nfc_card_id AS "cardId", nc.uid AS "cardNumber",
       h.student_id AS "studentId", st.admission_no AS "admissionNo",
       st.first_name AS "firstName", st.last_name AS "lastName",
       h.action, h.previous_status AS "previousStatus", h.new_status AS "newStatus",
       h.reason, h.actor_user_id AS "actorUserId", h.created_at AS "createdAt"
     FROM nfc_card_history h
     JOIN nfc_cards nc ON nc.id = h.nfc_card_id AND nc.school_id = h.school_id
     LEFT JOIN students st ON st.id = h.student_id AND st.school_id = h.school_id
     WHERE h.school_id = $1
     ORDER BY h.created_at DESC, h.id DESC
     LIMIT 200`,
    [schoolId],
  );
  res.json(result.rows.map((row) => {
    // The reason records the reader at activation time. The card's
    // last_device_id changes on later scans and cannot describe history.
    let deviceId: number | null = null;
    let deviceSerialNumber: string | null = null;
    if (row.action === "ACTIVATED" && typeof row.reason === "string") {
      try {
        const snapshot = JSON.parse(row.reason);
        if (Number.isSafeInteger(snapshot?.deviceId) && snapshot.deviceId > 0 &&
            typeof snapshot?.deviceSerialNumber === "string") {
          deviceId = snapshot.deviceId;
          deviceSerialNumber = snapshot.deviceSerialNumber;
        }
      } catch {
        // Older history entries may contain a human-readable reason.
      }
    }
    return { ...row, deviceId, deviceSerialNumber };
  }));
}));

router.post("/activation/schools/:schoolId/assign", run(async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => !["deviceId", "studentId", "cardNumber"].includes(key))) {
    throw new AuthError(400, "Only deviceId, studentId, and cardNumber may be provided");
  }
  const schoolId = id(req.params.schoolId, "schoolId");
  const deviceId = id(req.body?.deviceId, "deviceId");
  const studentId = id(req.body?.studentId, "studentId");
  const cardNumber = typeof req.body?.cardNumber === "string" ? req.body.cardNumber.trim() : "";
  if (cardNumber.length < 4) {
    throw new AuthError(400, "cardNumber must contain at least 4 characters");
  }
  const context = await assertActivationSchool(req, schoolId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assertActivationSchool(req, schoolId, client, true);
    const device = await client.query(
      `SELECT d.id, d.serial_number AS "serialNumber", d.name,
         d.device_type AS "deviceType", d.status, d.location
       FROM platform_devices d
       JOIN device_school_bindings b ON b.device_id = d.id AND b.school_id = $2
       WHERE d.id = $1 AND d.school_id = $2
         AND upper(d.device_type) IN ('NFC', 'HYBRID') AND upper(d.status) = 'ACTIVE'
         AND d.configuration_status='CONFIGURED'
        FOR SHARE OF d`,
      [deviceId, schoolId],
    );
    if (!device.rows[0]) {
      throw new AuthError(404, "An active NFC or HYBRID device linked to this school was not found");
    }
    // Physical card UIDs are globally unique (case-insensitive here as in the
    // registration path); the advisory lock closes concurrent activation races.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext(LOWER($1)))`, [cardNumber]);
    const existing = await client.query(
      `SELECT id, school_id AS "schoolId", student_id AS "studentId", status
       FROM nfc_cards WHERE lower(uid) = lower($1) FOR UPDATE`,
      [cardNumber],
    );
    if (existing.rows[0]) {
      const existingCard = existing.rows[0];
      if (Number(existingCard.schoolId) !== schoolId) {
        throw new AuthError(409, "This NFC card is already registered to another school");
      }
      if (existingCard.studentId !== null || String(existingCard.status).toLowerCase() !== "unassigned") {
        throw new AuthError(409, "This NFC card is already bound or is not eligible for activation");
      }
    }

    // Locking the student row serializes concurrent activation/reassignment attempts.
    const student = await client.query(
      `SELECT id, admission_no AS "admissionNo", first_name AS "firstName",
         middle_name AS "middleName", last_name AS "lastName",
         class_name AS "className", section, photo
       FROM students WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [studentId, schoolId],
    );
    if (!student.rows[0]) throw new AuthError(404, "Student not found in this school");

    const activeCard = await client.query(
      `SELECT id FROM nfc_cards
       WHERE school_id = $1 AND student_id = $2 AND lower(status) = 'active'
       LIMIT 1`,
      [schoolId, studentId],
    );
    if (activeCard.rows[0]) throw new AuthError(409, "Student already has an active NFC card");

    let card;
    if (existing.rows[0]) {
      const row = existing.rows[0];
      const activated = await client.query(
        `UPDATE nfc_cards
         SET student_id = $1, status = 'active', activated_at = NOW(),
             deactivated_at = NULL, last_device_id = $2
         WHERE id = $3 AND school_id = $4 AND student_id IS NULL AND lower(status) = 'unassigned'
         RETURNING id, school_id AS "schoolId", uid, student_id AS "studentId",
           status, scans, last_scan AS "lastScan", activated_at AS "activatedAt"`,
        [studentId, deviceId, row.id, schoolId],
      );
      if (!activated.rows[0]) throw new AuthError(409, "This NFC card is no longer available");
      card = activated.rows[0];
    } else {
      const created = await client.query(
        `INSERT INTO nfc_cards
           (school_id, uid, student_id, status, issued_at, activated_at, last_device_id)
         VALUES ($1, $2, $3, 'active', NOW(), NOW(), $4)
         RETURNING id, school_id AS "schoolId", uid, student_id AS "studentId",
           status, scans, last_scan AS "lastScan", activated_at AS "activatedAt"`,
        [schoolId, cardNumber, studentId, deviceId],
      );
      card = created.rows[0];
    }
    await client.query(
      `INSERT INTO nfc_card_history
       (school_id, nfc_card_id, student_id, action, previous_status, new_status, reason, actor_user_id)
       VALUES ($1, $2, $3, 'ACTIVATED', $4, 'active', $5, $6)`,
      [
        schoolId,
        card.id,
        studentId,
        existing.rows[0] ? "unassigned" : null,
        JSON.stringify({ deviceId, deviceSerialNumber: device.rows[0].serialNumber }),
        context.user.id,
      ],
    );
    await auditActivation(req, client, schoolId, card.id, {
      deviceId,
      deviceSerialNumber: device.rows[0].serialNumber,
      studentId,
      cardNumber: card.uid,
    });
    const eId = await client.query(activationEIdQuery, [schoolId, studentId]);
    if (!eId.rows[0]) throw new Error("Could not load the persisted student E-ID");
    await client.query("COMMIT");
    res.status(201).json({ ...card, student: student.rows[0], device: device.rows[0], eId: eId.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string })?.code === "23505") {
      throw new AuthError(409, "This NFC card number has already been registered");
    }
    throw error;
  } finally {
    client.release();
  }
}));

router.get("/activation/schools/:schoolId/students/:studentId/e-id", run(async (req, res) => {
  const schoolId = id(req.params.schoolId, "schoolId");
  const studentId = id(req.params.studentId, "studentId");
  await assertActivationSchool(req, schoolId);
  const result = await pool.query(activationEIdQuery, [schoolId, studentId]);
  if (!result.rows[0]) throw new AuthError(404, "Student not found in this school");
  res.json(result.rows[0]);
}));

export default router;