import { Router, type NextFunction, type Request } from "express";
import { createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { AuthError, assertRoles, getUserContext, requireAuthentication } from "../middlewares/auth";

const router = Router();
const run = (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: NextFunction) => handler(req, res).catch(next);

router.use(requireAuthentication());

const deviceFields = `d.id,d.serial_number AS "serialNumber",d.name,d.device_type AS "deviceType",
  d.status,d.school_id AS "schoolId",s.name AS "schoolName",d.location,
  d.school_class_id AS "classId",d.configuration_status AS "configurationStatus",
  d.last_seen_at AS "lastSeenAt",
  d.created_at AS "createdAt",d.updated_at AS "updatedAt"`;

type DeviceInput = {
  serialNumber: string;
  name: string;
  deviceType: string;
  schoolId: number | null;
};

async function audit(
  req: Request,
  action: string,
  module: string,
  recordId: number,
  db: { query: (text: string, values?: unknown[]) => Promise<any> } = pool,
) {
  const context = getUserContext(req);
  await db.query(
    `INSERT INTO audit_logs
      ("user",role,actor_user_id,clerk_user_id,action,module,record_id,event_type,result)
     VALUES($1,'PLATFORM_OWNER',$2,$3,$4,$5,$6,$7,'SUCCESS')`,
    [
      [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email,
      context.user.id,
      context.user.clerkUserId,
      action,
      module,
      recordId,
      module === "Devices" ? "PLATFORM_DEVICE_CHANGED" : "PLATFORM_NOTIFICATION_READ",
    ],
  );
}

export async function createPlatformDeviceRecord(req: Request, input: DeviceInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO platform_devices(serial_number,name,device_type,school_id,status)
       VALUES($1,$2,$3,$4,'ACTIVE')
       RETURNING id`,
      [input.serialNumber, input.name, input.deviceType, input.schoolId],
    );
    await audit(req, "Registered platform device", "Devices", result.rows[0].id, client);
    const device = await client.query(
      `SELECT ${deviceFields} FROM platform_devices d
       LEFT JOIN schools s ON s.id=d.school_id WHERE d.id=$1`,
      [result.rows[0].id],
    );
    await client.query("COMMIT");
    return device.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

router.get("/platform/devices", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const result = await pool.query(
    `SELECT ${deviceFields} FROM platform_devices d
     LEFT JOIN schools s ON s.id=d.school_id ORDER BY d.created_at DESC`,
  );
  res.json(result.rows);
}));

router.post("/platform/devices", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const serialNumber = String(req.body?.serialNumber ?? "").trim().toUpperCase();
  const name = String(req.body?.name ?? "").trim();
  const deviceType = String(req.body?.deviceType ?? "").toUpperCase();
  const schoolId = req.body?.schoolId == null ? null : Number(req.body.schoolId);
  if (!serialNumber || !name || !["NFC", "BIOMETRIC", "HYBRID"].includes(deviceType)) {
    throw new AuthError(400, "serialNumber, name, and a valid deviceType are required");
  }
  if (schoolId !== null && (!Number.isInteger(schoolId) || schoolId < 1)) {
    throw new AuthError(400, "A valid schoolId is required");
  }
  const device = await createPlatformDeviceRecord(req, { serialNumber, name, deviceType, schoolId });
  res.status(201).json(device);
}));

// The raw secret is returned exactly once. Only its SHA-256 digest is persisted.
router.post("/platform/devices/:deviceId/credentials", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId) || deviceId < 1) throw new AuthError(404, "Device not found");
  const identifier = `dev_${randomBytes(12).toString("hex")}`;
  const secret = randomBytes(32).toString("base64url");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const device = await client.query(
      `SELECT id,school_id AS "schoolId" FROM platform_devices
       WHERE id=$1 AND school_id IS NOT NULL FOR UPDATE`, [deviceId],
    );
    if (!device.rows[0]) throw new AuthError(404, "Assigned device not found");
    await client.query(
      `UPDATE device_credentials SET status='REVOKED',revoked_at=NOW()
       WHERE device_id=$1 AND school_id=$2 AND status='ACTIVE'`,
      [deviceId, device.rows[0].schoolId],
    );
    await client.query(
      `INSERT INTO device_credentials
        (school_id,device_id,credential_identifier,secret_hash,status)
       VALUES($1,$2,$3,$4,'ACTIVE')`,
      [device.rows[0].schoolId, deviceId, identifier, createHash("sha256").update(secret).digest("hex")],
    );
    await audit(req, "Created platform device credential", "Devices", deviceId, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  res.status(201).json({ credential: `${identifier}.${secret}`, credentialIdentifier: identifier });
}));

router.post("/platform/devices/:deviceId/assign", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const id = Number(req.params.deviceId), schoolId = Number(req.body?.schoolId);
  if (!Number.isInteger(id) || !Number.isInteger(schoolId) || schoolId < 1) throw new AuthError(400, "A valid schoolId is required");
   const client = await pool.connect();
   try {
     await client.query("BEGIN");
     const old = await client.query(`SELECT id,school_id AS "schoolId",location,school_class_id AS "classId" FROM platform_devices WHERE id=$1 FOR UPDATE`, [id]);
     if (!old.rows[0]) throw new AuthError(404, "Device not found");
     if (req.body?.classId != null) {
       const klass = await client.query(`SELECT id FROM school_classes WHERE id=$1 AND school_id=$2`, [Number(req.body.classId), schoolId]);
       if (!klass.rows[0]) throw new AuthError(400, "classId is not a class in the assigned school");
     }
     await client.query(`UPDATE platform_devices SET school_id=$1,location=$2,school_class_id=$3,configuration_status='CONFIGURED',status='ACTIVE',updated_at=NOW() WHERE id=$4`, [schoolId, req.body?.location ?? null, req.body?.classId == null ? null : Number(req.body.classId), id]);
      if (old.rows[0].schoolId !== null) {
        await client.query(`UPDATE device_credentials SET status='REVOKED',revoked_at=NOW() WHERE device_id=$1 AND status='ACTIVE'`, [id]);
      }
     await client.query(`INSERT INTO device_assignment_history(school_id,device_id,previous_school_id,previous_location,location,action,reason,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [schoolId,id,old.rows[0].schoolId,old.rows[0].location,req.body?.location ?? null,old.rows[0].schoolId == null ? "ASSIGNED" : "REASSIGNED",req.body?.reason ?? null,getUserContext(req).user.id]);
     await audit(req, old.rows[0].schoolId == null ? "Registered platform device assignment" : "Reassigned platform device", "Devices", id, client);
     const device = await client.query(`SELECT ${deviceFields} FROM platform_devices d LEFT JOIN schools s ON s.id=d.school_id WHERE d.id=$1`, [id]);
     await client.query("COMMIT");
     res.json(device.rows[0]);
   } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));

router.post("/platform/devices/:deviceId/suspend", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const id = Number(req.params.deviceId);
   const client = await pool.connect();
   try {
     await client.query("BEGIN");
     const locked = await client.query(`SELECT id,school_id AS "schoolId" FROM platform_devices WHERE id=$1 FOR UPDATE`, [id]);
     if (!locked.rows[0]) throw new AuthError(404, "Device not found");
     await client.query(`UPDATE platform_devices SET status='SUSPENDED',updated_at=NOW() WHERE id=$1`, [id]);
     await client.query(`UPDATE device_credentials SET status='REVOKED',revoked_at=NOW() WHERE device_id=$1 AND status='ACTIVE'`, [id]);
     await audit(req, "Suspended platform device", "Devices", id, client);
     const device = await client.query(`SELECT ${deviceFields} FROM platform_devices d LEFT JOIN schools s ON s.id=d.school_id WHERE d.id=$1`, [id]);
     await client.query("COMMIT");
     res.json(device.rows[0]);
   } catch (error) {
     await client.query("ROLLBACK");
     throw error;
   } finally { client.release(); }
}));

router.post("/platform/devices/:deviceId/credential", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const id = Number(req.params.deviceId);
  const identifier = `dev_${randomBytes(12).toString("hex")}`, secret = randomBytes(32).toString("base64url");
   const client = await pool.connect();
   try {
     await client.query("BEGIN");
     const device = await client.query(`SELECT id,school_id AS "schoolId" FROM platform_devices WHERE id=$1 AND school_id IS NOT NULL FOR UPDATE`, [id]);
     if (!device.rows[0]) throw new AuthError(404, "Assigned device not found");
     await client.query(`UPDATE device_credentials SET status='REVOKED',revoked_at=NOW() WHERE device_id=$1 AND school_id=$2 AND status='ACTIVE'`, [id, device.rows[0].schoolId]);
     await client.query(`INSERT INTO device_credentials(school_id,device_id,credential_identifier,secret_hash,status) VALUES($1,$2,$3,$4,'ACTIVE')`, [device.rows[0].schoolId,id,identifier,createHash("sha256").update(secret).digest("hex")]);
     await audit(req, "Rotated platform device credential", "Devices", id, client);
     await client.query("COMMIT");
   } catch (error) {
     await client.query("ROLLBACK");
     throw error;
   } finally { client.release(); }
   res.json({ deviceId: id, credential: `${identifier}.${secret}` });
}));

router.patch("/platform/devices/:deviceId", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const deviceId = Number(req.params.deviceId);
  const schoolId = req.body?.schoolId === null ? null :
    req.body?.schoolId === undefined ? undefined : Number(req.body.schoolId);
  const status = req.body?.status === undefined ? undefined : String(req.body.status).toUpperCase();
  if (!Number.isInteger(deviceId) || deviceId < 1) throw new AuthError(404, "Device not found");
  if (schoolId !== undefined && schoolId !== null && (!Number.isInteger(schoolId) || schoolId < 1)) {
    throw new AuthError(400, "A valid schoolId is required");
  }
   if (status !== undefined && !["ACTIVE", "INACTIVE", "SUSPENDED", "UNASSIGNED", "MAINTENANCE"].includes(status)) {
    throw new AuthError(400, "Invalid device status");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
      const before = await client.query(`SELECT id,school_id AS "schoolId",location,school_class_id AS "classId" FROM platform_devices WHERE id=$1 FOR UPDATE`, [deviceId]);
     if (!before.rows[0]) throw new AuthError(404, "Device not found");
      const reassigned = (req.body?.schoolId !== undefined && before.rows[0].schoolId !== schoolId) ||
        status === "UNASSIGNED";
      const targetSchoolId = schoolId === undefined ? before.rows[0].schoolId : schoolId;
      const classId = req.body?.classId === null ? null :
        req.body?.classId === undefined ? (reassigned ? null : before.rows[0].classId) : Number(req.body.classId);
      if (classId !== null && classId !== undefined) {
        if (!Number.isInteger(classId) || classId < 1) throw new AuthError(400, "A valid classId is required");
        const klass = await client.query(`SELECT id FROM school_classes WHERE id=$1 AND school_id=$2`, [classId, targetSchoolId]);
        if (!klass.rows[0]) throw new AuthError(400, "classId is not a class in the assigned school");
      }
      const unassigned = schoolId === null || status === "UNASSIGNED";
      if (unassigned && before.rows[0].schoolId === null) {
        throw new AuthError(409, "Device is already unassigned");
      }
     const result = await client.query(
      `UPDATE platform_devices SET
          school_id=CASE WHEN $1::boolean THEN $2::int ELSE school_id END,
          school_class_id=CASE WHEN $3::boolean THEN $4::int ELSE school_class_id END,
          location=CASE WHEN $3::boolean THEN $5::text ELSE location END,
          configuration_status=CASE WHEN $3::boolean THEN CASE WHEN $8::boolean THEN 'PENDING' ELSE 'CONFIGURED' END ELSE configuration_status END,
          status=COALESCE($6,status),updated_at=NOW()
        WHERE id=$7 RETURNING id`,
       [req.body?.schoolId !== undefined || unassigned, unassigned ? null : schoolId ?? null,
         req.body?.schoolId !== undefined || req.body?.classId !== undefined || req.body?.location !== undefined || unassigned,
         unassigned ? null : classId,
         unassigned ? null : (req.body?.location !== undefined ? req.body.location : before.rows[0].location),
         status === "UNASSIGNED" ? "UNASSIGNED" : status ?? null, deviceId, unassigned],
    );
     if (!result.rows[0]) throw new AuthError(404, "Device not found");
     if (reassigned) {
        await client.query(`UPDATE device_credentials SET status='REVOKED',revoked_at=NOW() WHERE device_id=$1 AND status='ACTIVE'`, [deviceId]);
        await client.query(`INSERT INTO device_assignment_history(school_id,device_id,previous_school_id,previous_location,location,action,reason,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [schoolId ?? before.rows[0].schoolId, deviceId, before.rows[0].schoolId, before.rows[0].location,
            unassigned ? null : (req.body?.location !== undefined ? req.body.location : before.rows[0].location),
            unassigned ? "UNASSIGNED" : "REASSIGNED", req.body?.reason ?? null, getUserContext(req).user.id]);
     }
      if (status === "SUSPENDED") {
        await client.query(`UPDATE device_credentials SET status='REVOKED',revoked_at=NOW() WHERE device_id=$1 AND status='ACTIVE'`, [deviceId]);
      }
    await audit(req, "Updated device assignment or status", "Devices", deviceId, client);
    const device = await client.query(
      `SELECT ${deviceFields} FROM platform_devices d
       LEFT JOIN schools s ON s.id=d.school_id WHERE d.id=$1`,
      [deviceId],
    );
    await client.query("COMMIT");
    res.json(device.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.get("/platform/notifications", run(async (req, res) => {
  const context = assertRoles(req, ["PLATFORM_OWNER"]);
  const result = await pool.query(
    `SELECT id,title,message,severity,is_read AS "isRead",created_at AS "createdAt"
     FROM platform_notifications
     WHERE recipient_user_id IS NULL OR recipient_user_id=$1
     ORDER BY is_read,created_at DESC LIMIT 100`,
    [context.user.id],
  );
  res.json(result.rows);
}));

router.patch("/platform/notifications/:notificationId/read", run(async (req, res) => {
  const context = assertRoles(req, ["PLATFORM_OWNER"]);
  const id = Number(req.params.notificationId);
  if (!Number.isInteger(id) || id < 1) throw new AuthError(404, "Notification not found");
  const result = await pool.query(
    `UPDATE platform_notifications SET is_read=true,read_at=NOW()
     WHERE id=$1 AND (recipient_user_id IS NULL OR recipient_user_id=$2)
     RETURNING id,title,message,severity,is_read AS "isRead",created_at AS "createdAt"`,
    [id, context.user.id],
  );
  if (!result.rows[0]) throw new AuthError(404, "Notification not found");
  await audit(req, "Marked notification as read", "Notifications", id);
  res.json(result.rows[0]);
}));

export default router;