import { Router, type NextFunction, type Request } from "express";
import { pool } from "@workspace/db";
import { AuthError, assertRoles, getUserContext, requireAuthentication } from "../middlewares/auth";

const router = Router();
const run = (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: NextFunction) => handler(req, res).catch(next);

router.use(requireAuthentication());

const deviceFields = `d.id,d.serial_number AS "serialNumber",d.name,d.device_type AS "deviceType",
  d.status,d.school_id AS "schoolId",s.name AS "schoolName",d.last_seen_at AS "lastSeenAt",
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
  if (status !== undefined && !["ACTIVE", "INACTIVE", "MAINTENANCE"].includes(status)) {
    throw new AuthError(400, "Invalid device status");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE platform_devices SET
         school_id=CASE WHEN $1::boolean THEN $2::int ELSE school_id END,
         status=COALESCE($3,status),updated_at=NOW()
       WHERE id=$4 RETURNING id`,
      [req.body?.schoolId !== undefined, schoolId ?? null, status ?? null, deviceId],
    );
    if (!result.rows[0]) throw new AuthError(404, "Device not found");
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