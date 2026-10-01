import { Storage, type File } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const SIGNED_UPLOAD_TTL_SECONDS = 180;
const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const MAX_LOGO_DIMENSION = 4_096;
const MAX_LOGO_PIXELS = 12_000_000;

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

function privateBucketAndPrefix() {
  const configured = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!configured) throw new Error("PRIVATE_OBJECT_DIR is not configured for private school logos");
  const segments = configured.replace(/^\/+|\/+$/g, "").split("/");
  const bucketName = segments.shift();
  if (!bucketName || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("PRIVATE_OBJECT_DIR is invalid for private school logos");
  }
  return { bucketName, prefix: segments.join("/") };
}

export function newSchoolLogoObjectPath(schoolId: number): string {
  if (!Number.isSafeInteger(schoolId) || schoolId < 1) {
    throw new TypeError("A positive integer school ID is required");
  }
  return `/objects/school-logos/${schoolId}/${randomUUID()}`;
}

export function canonicalSchoolLogoVersionUrl(schoolId: number, logoId: number): string {
  if (!Number.isSafeInteger(schoolId) || schoolId < 1 ||
    !Number.isSafeInteger(logoId) || logoId < 1) {
    throw new TypeError("Positive integer school and confirmed logo IDs are required");
  }
  return `/api/schools/${schoolId}/branding/logo-versions/${logoId}`;
}

export function isManagedSchoolLogoObjectPath(schoolId: number, value: unknown): value is string {
  if (!Number.isSafeInteger(schoolId) || schoolId < 1 || typeof value !== "string") return false;
  return new RegExp(
    `^/objects/school-logos/${schoolId}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
    "i",
  ).test(value);
}

export function schoolLogoFile(objectPath: string): File {
  const schoolIdText = /^\/objects\/school-logos\/([1-9]\d*)\/[0-9a-f-]{36}$/i.exec(objectPath)?.[1];
  if (!schoolIdText || !isManagedSchoolLogoObjectPath(Number(schoolIdText), objectPath)) {
    throw new TypeError("Invalid private school logo object path");
  }
  const segments = objectPath.slice("/objects/".length).split("/");
  const { bucketName, prefix } = privateBucketAndPrefix();
  const objectName = [prefix, ...segments].filter(Boolean).join("/");
  return storage.bucket(bucketName).file(objectName);
}

export async function signedSchoolLogoUploadUrl(objectPath: string): Promise<string> {
  const file = schoolLogoFile(objectPath);
  const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: file.bucket.name,
      object_name: file.name,
      method: "PUT",
      expires_at: new Date(Date.now() + SIGNED_UPLOAD_TTL_SECONDS * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to sign private school logo upload URL (${response.status})`);
  }
  const body = await response.json() as { signed_url?: unknown };
  if (typeof body.signed_url !== "string") {
    throw new Error("Object storage returned an invalid school logo upload URL");
  }
  return body.signed_url;
}

export function detectSchoolLogoMime(
  bytes: Buffer,
): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/** Read only the caller's school-scoped object; never return a signed download URL. */
export async function readValidatedSchoolLogo(
  schoolId: number,
  objectPath: unknown,
): Promise<{ bytes: Buffer; contentType: "image/jpeg" | "image/png" | "image/webp" }> {
  if (!isManagedSchoolLogoObjectPath(schoolId, objectPath)) {
    throw new TypeError("The private school logo is not bound to this school");
  }
  const file = schoolLogoFile(objectPath);
  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (error) {
    if ((error as { code?: number })?.code === 404) throw new Error("Private school logo object not found");
    throw error;
  }
  const size = Number(metadata.size);
  const declaredMime = typeof metadata.contentType === "string"
    ? metadata.contentType.split(";")[0]!.trim().toLowerCase()
    : "";
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_LOGO_BYTES ||
    !["image/jpeg", "image/png", "image/webp"].includes(declaredMime)) {
    throw new Error("Private school logo metadata is invalid");
  }
  let bytes: Buffer;
  try {
    [bytes] = await file.download();
  } catch (error) {
    if ((error as { code?: number })?.code === 404) throw new Error("Private school logo object not found");
    throw error;
  }
  const byteMime = detectSchoolLogoMime(bytes);
  if (!byteMime || bytes.length !== size || bytes.length > MAX_LOGO_BYTES || byteMime !== declaredMime) {
    throw new Error("Private school logo content does not match its validated metadata");
  }
  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MAX_LOGO_PIXELS,
      sequentialRead: true,
    });
    const dimensions = await image.metadata();
    if (
      dimensions.format !== (byteMime === "image/jpeg" ? "jpeg" : byteMime.slice(6)) ||
      !dimensions.width ||
      !dimensions.height ||
      dimensions.width > MAX_LOGO_DIMENSION ||
      dimensions.height > MAX_LOGO_DIMENSION ||
      dimensions.width * dimensions.height > MAX_LOGO_PIXELS ||
      (dimensions.pages ?? 1) !== 1
    ) {
      throw new Error("Unsupported dimensions or format");
    }
    await image.raw().toBuffer();
  } catch {
    throw new Error("Private school logo is incomplete, corrupt or has unsupported dimensions");
  }
  return {
    bytes,
    contentType: byteMime,
  };
}

export const SCHOOL_LOGO_UPLOAD_URL_TTL_SECONDS = SIGNED_UPLOAD_TTL_SECONDS;