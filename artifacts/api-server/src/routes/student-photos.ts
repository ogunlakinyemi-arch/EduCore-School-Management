import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request } from "express";
import { Storage, type File } from "@google-cloud/storage";
import { pool } from "@workspace/db";
import sharp from "sharp";
import {
  AuthError,
  assertDeviceActivationOfficer,
  getUserContext,
  handleAuthError,
  requireAuthentication,
} from "../middlewares/auth";

const router = Router();
router.use(requireAuthentication());

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const MAX_PHOTO_DIMENSION = 8_192;
const MAX_PHOTO_PIXELS = 16_777_216;
const SIGNED_URL_TTL_SECONDS = 180;
const MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

const run =
  (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: NextFunction) =>
    handler(req, res).catch((error) => handleAuthError(error, req, res, next));

function positiveId(value: unknown, label: string): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new AuthError(400, `${label} must be a positive integer`);
  }
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) throw new AuthError(400, `${label} must be a positive integer`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new AuthError(400, `${label} must be a positive integer`);
  return parsed;
}

function querySchoolId(req: Request): number {
  if (Array.isArray(req.query.schoolId) || typeof req.query.schoolId !== "string") {
    throw new AuthError(400, "A valid schoolId is required");
  }
  return positiveId(req.query.schoolId, "schoolId");
}

function bodySchoolId(req: Request): number {
  return positiveId(req.body?.schoolId, "schoolId");
}

function assertSchoolAdmin(req: Request, schoolId: number) {
  const context = getUserContext(req);
  if (context.roles.some((role) =>
    role.role === "PLATFORM_OWNER" && role.schoolId === null && role.status === "ACTIVE"
  )) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
  if (!context.roles.some((role) =>
    role.role === "SCHOOL_ADMIN" && role.schoolId === schoolId && role.status === "ACTIVE"
  )) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
  return context;
}

async function assertPhotoReader(req: Request, schoolId: number) {
  const context = getUserContext(req);
  const schoolRoles = context.roles.filter((role) =>
    role.schoolId === schoolId && role.status === "ACTIVE"
  );
  if (schoolRoles.some((role) =>
    ["SCHOOL_ADMIN", "TEACHER", "STAFF"].includes(role.role)
  )) return;

  if (schoolRoles.some((role) => role.role === "DEVICE_ACTIVATION_OFFICER")) {
    await assertDeviceActivationOfficer(req);
    return;
  }
  throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
}

function managedObjectPath(schoolId: number, studentId: number, value: unknown): string {
  if (typeof value !== "string" ||
    !new RegExp(`^/objects/student-photos/${schoolId}/${studentId}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, "i").test(value)) {
    throw new AuthError(400, "A valid student photo objectPath is required");
  }
  return value;
}

function managedPathForStoredPhoto(schoolId: number, studentId: number, photo: unknown): string | null {
  if (typeof photo !== "string") return null;
  const match = photo.match(/^\/objects\/student-photos\/(\d+)\/(\d+)\/([0-9a-f-]+)$/i);
  if (!match || Number(match[1]) !== schoolId || Number(match[2]) !== studentId) return null;
  try {
    return managedObjectPath(schoolId, studentId, photo);
  } catch {
    return null;
  }
}

function privateBucketAndPrefix() {
  const configured = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!configured) throw new Error("PRIVATE_OBJECT_DIR is not configured for private student photos");
  const segments = configured.replace(/^\/+|\/+$/g, "").split("/");
  const bucketName = segments.shift();
  if (!bucketName || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("PRIVATE_OBJECT_DIR is invalid");
  }
  return { bucketName, prefix: segments.join("/") };
}

function fileForObjectPath(objectPath: string): File {
  const suffix = objectPath.slice("/objects/".length);
  const { bucketName, prefix } = privateBucketAndPrefix();
  const name = [prefix, suffix].filter(Boolean).join("/");
  return storage.bucket(bucketName).file(name);
}

async function signedPutUrl(file: File): Promise<string> {
  const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: file.bucket.name,
      object_name: file.name,
      method: "PUT",
      expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Failed to sign student photo upload URL (${response.status})`);
  const body = await response.json() as { signed_url?: unknown };
  if (typeof body.signed_url !== "string") throw new Error("The object storage service returned an invalid upload URL");
  return body.signed_url;
}

function canonicalMimeFromBytes(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

async function validateDecodedImage(bytes: Buffer, mimeType: string): Promise<void> {
  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MAX_PHOTO_PIXELS,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    const expectedFormat = mimeType === "image/jpeg" ? "jpeg" : mimeType.slice("image/".length);
    const { width, height } = metadata;
    if (
      metadata.format !== expectedFormat ||
      !width ||
      !height ||
      width > MAX_PHOTO_DIMENSION ||
      height > MAX_PHOTO_DIMENSION ||
      width * height > MAX_PHOTO_PIXELS ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new Error("Unsupported image dimensions or format");
    }

    // Force a full pixel decode; parsing headers or reading image metadata alone
    // does not detect truncated/corrupt compressed image data.
    await image.raw().toBuffer();
  } catch {
    throw new AuthError(400, "The uploaded photo is not a valid complete image");
  }
}

async function validatedPhoto(file: File): Promise<{ bytes: Buffer; mimeType: string }> {
  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (error) {
    if ((error as { code?: number })?.code === 404) throw new AuthError(404, "Uploaded student photo not found");
    throw error;
  }
  const size = Number(metadata.size);
  const storedMime = typeof metadata.contentType === "string"
    ? metadata.contentType.split(";")[0].trim().toLowerCase()
    : "";
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PHOTO_BYTES) {
    throw new AuthError(400, "Student photos must be no larger than 3 MB");
  }
  if (!MIME_TYPES.has(storedMime)) {
    throw new AuthError(400, "Student photos must be JPEG, PNG, or WebP images");
  }
  let bytes: Buffer;
  try {
    [bytes] = await file.download();
  } catch (error) {
    if ((error as { code?: number })?.code === 404) throw new AuthError(404, "Uploaded student photo not found");
    throw error;
  }
  if (bytes.length !== size || bytes.length > MAX_PHOTO_BYTES) {
    throw new AuthError(400, "The uploaded photo size does not match its stored metadata");
  }
  const detectedMime = canonicalMimeFromBytes(bytes);
  const canonicalStoredMime = storedMime === "image/jpg" ? "image/jpeg" : storedMime;
  if (!detectedMime || detectedMime !== canonicalStoredMime) {
    throw new AuthError(400, "The uploaded photo content does not match its image metadata");
  }
  await validateDecodedImage(bytes, detectedMime);
  return { bytes, mimeType: detectedMime };
}

async function deleteManagedPhoto(req: Request, schoolId: number, studentId: number, photo: unknown) {
  const path = managedPathForStoredPhoto(schoolId, studentId, photo);
  if (path) {
    try {
      await fileForObjectPath(path).delete({ ignoreNotFound: true });
    } catch (error) {
      if (req.log) req.log.warn({ err: error }, "Could not remove replaced student photo object");
    }
  }
}

router.post("/students/:studentId/photo-upload-request", run(async (req, res) => {
  const studentId = positiveId(req.params.studentId, "studentId");
  const schoolId = bodySchoolId(req);
  assertSchoolAdmin(req, schoolId);
  const contentType = typeof req.body?.contentType === "string"
    ? req.body.contentType.trim().toLowerCase()
    : "";
  const size = req.body?.size;
  if (!MIME_TYPES.has(contentType)) {
    throw new AuthError(400, "contentType must be JPEG, PNG, or WebP");
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PHOTO_BYTES) {
    throw new AuthError(400, "Student photos must be between 1 byte and 3 MB");
  }
  const student = await pool.query(
    `SELECT id FROM students WHERE id = $1 AND school_id = $2`,
    [studentId, schoolId],
  );
  if (!student.rows[0]) throw new AuthError(404, "Student not found in this school");

  const objectPath = `/objects/student-photos/${schoolId}/${studentId}/${randomUUID()}`;
  const uploadURL = await signedPutUrl(fileForObjectPath(objectPath));
  res.json({ uploadURL, objectPath });
}));

router.post("/students/:studentId/photo-confirm", run(async (req, res) => {
  const studentId = positiveId(req.params.studentId, "studentId");
  const schoolId = bodySchoolId(req);
  assertSchoolAdmin(req, schoolId);
  const objectPath = managedObjectPath(schoolId, studentId, req.body?.objectPath);
  const file = fileForObjectPath(objectPath);
  await validatedPhoto(file);
  const update = await pool.query(
    `WITH prior AS (
       SELECT photo FROM students WHERE id = $2 AND school_id = $3 FOR UPDATE
     )
     UPDATE students SET photo = $1, updated_at = NOW()
     WHERE id = $2 AND school_id = $3
     RETURNING (SELECT photo FROM prior) AS "previousPhoto"`,
    [objectPath, studentId, schoolId],
  );
  if (!update.rows[0]) throw new AuthError(404, "Student not found in this school");
  if (update.rows[0].previousPhoto !== objectPath) {
    await deleteManagedPhoto(req, schoolId, studentId, update.rows[0].previousPhoto);
  }
  res.json({ passportUrl: `/api/students/${studentId}/photo?schoolId=${schoolId}` });
}));

router.delete("/students/:studentId/photo", run(async (req, res) => {
  const studentId = positiveId(req.params.studentId, "studentId");
  const schoolId = querySchoolId(req);
  assertSchoolAdmin(req, schoolId);
  const result = await pool.query(
    `WITH prior AS (
       SELECT photo FROM students WHERE id = $1 AND school_id = $2 FOR UPDATE
     )
     UPDATE students SET photo = NULL, updated_at = NOW()
     WHERE id = $1 AND school_id = $2
     RETURNING (SELECT photo FROM prior) AS photo`,
    [studentId, schoolId],
  );
  if (!result.rows[0]) throw new AuthError(404, "Student not found in this school");
  await deleteManagedPhoto(req, schoolId, studentId, result.rows[0].photo);
  res.status(204).end();
}));

router.get("/students/:studentId/photo", run(async (req, res) => {
  const studentId = positiveId(req.params.studentId, "studentId");
  const schoolId = querySchoolId(req);
  await assertPhotoReader(req, schoolId);
  const result = await pool.query(
    `SELECT photo FROM students WHERE id = $1 AND school_id = $2`,
    [studentId, schoolId],
  );
  const objectPath = managedPathForStoredPhoto(schoolId, studentId, result.rows[0]?.photo);
  if (!objectPath) throw new AuthError(404, "Student photo not found");

  const validated = await validatedPhoto(fileForObjectPath(objectPath));
  res.setHeader("Content-Type", validated.mimeType);
  res.setHeader("Content-Length", String(validated.bytes.length));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).send(validated.bytes);
}));

export default router;