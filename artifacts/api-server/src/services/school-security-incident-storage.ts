import { randomUUID } from "node:crypto";
import { Storage, type File } from "@google-cloud/storage";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const UPLOAD_TTL_SECONDS = 120;
const DOWNLOAD_TTL_SECONDS = 120;
export const INCIDENT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const INCIDENT_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

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

function privateIncidentObject(filePath: string): File {
  const configured = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!configured) throw new Error("PRIVATE_OBJECT_DIR is not configured for private school security attachments");
  const configuredSegments = configured.replace(/^\/+|\/+$/g, "").split("/");
  const bucketName = configuredSegments.shift();
  if (!bucketName || configuredSegments.some((part) => !part || part === "." || part === "..")) {
    throw new Error("PRIVATE_OBJECT_DIR is invalid for private school security attachments");
  }
  if (!/^\/objects\/school-security\/[1-9]\d*\/[1-9]\d*\/[0-9a-f-]{36}$/i.test(filePath)) {
    throw new TypeError("Invalid private school security attachment path");
  }
  const objectSegments = filePath.slice("/objects/".length).split("/");
  return storage.bucket(bucketName).file([...configuredSegments, ...objectSegments].filter(Boolean).join("/"));
}

async function signedObjectUrl(file: File, method: "PUT" | "GET", ttlSeconds: number): Promise<string> {
  const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: file.bucket.name,
      object_name: file.name,
      method,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Failed to sign private school security object URL (${response.status})`);
  const body = await response.json() as { signed_url?: unknown };
  if (typeof body.signed_url !== "string") {
    throw new Error("Object storage returned an invalid school security attachment URL");
  }
  return body.signed_url;
}

export function newSchoolSecurityIncidentAttachmentPath(schoolId: number, incidentId: number): string {
  if (!Number.isSafeInteger(schoolId) || schoolId < 1 || !Number.isSafeInteger(incidentId) || incidentId < 1) {
    throw new TypeError("Invalid school or incident ID for attachment path");
  }
  return `/objects/school-security/${schoolId}/${incidentId}/${randomUUID()}`;
}

export function isSchoolSecurityIncidentAttachmentPath(
  objectPath: string,
  schoolId: number,
  incidentId: number,
): boolean {
  return objectPath.startsWith(`/objects/school-security/${schoolId}/${incidentId}/`) &&
    new RegExp(`^/objects/school-security/${schoolId}/${incidentId}/[0-9a-f-]{36}$`, "i").test(objectPath);
}

export async function schoolSecurityIncidentAttachmentUploadUrl(objectPath: string): Promise<string> {
  return signedObjectUrl(privateIncidentObject(objectPath), "PUT", UPLOAD_TTL_SECONDS);
}

export async function schoolSecurityIncidentAttachmentDownloadUrl(objectPath: string): Promise<string> {
  return signedObjectUrl(privateIncidentObject(objectPath), "GET", DOWNLOAD_TTL_SECONDS);
}

function hasExpectedContentSignature(contentType: string, bytes: Buffer): boolean {
  switch (contentType) {
    case "application/pdf":
      return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/webp":
      return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP";
    default:
      return false;
  }
}

export async function assertSchoolSecurityIncidentObject(
  objectPath: string,
  schoolId: number,
  incidentId: number,
  expectedContentType: string,
  expectedSize: number,
): Promise<void> {
  if (!isSchoolSecurityIncidentAttachmentPath(objectPath, schoolId, incidentId)) {
    throw new TypeError("Incident attachment object ownership path does not match this school and incident");
  }
  if (!(INCIDENT_ATTACHMENT_TYPES as readonly string[]).includes(expectedContentType) ||
      !Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > INCIDENT_ATTACHMENT_MAX_BYTES) {
    throw new TypeError("Incident attachment metadata is outside the allowed content or size limits");
  }
  const file = privateIncidentObject(objectPath);
  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (error) {
    if ((error as { code?: number })?.code === 404) {
      throw new Error("Uploaded school security attachment was not found");
    }
    throw error;
  }
  const actualSize = Number(metadata.size);
  const actualContentType = typeof metadata.contentType === "string"
    ? metadata.contentType.split(";")[0]?.trim().toLowerCase()
    : null;
  if (!Number.isSafeInteger(actualSize) || actualSize !== expectedSize ||
      actualContentType !== expectedContentType || actualSize < 1 ||
      actualSize > INCIDENT_ATTACHMENT_MAX_BYTES) {
    throw new Error("Uploaded school security attachment metadata does not match the staged upload");
  }
  const [bytes] = await file.download();
  if (bytes.length !== actualSize || !hasExpectedContentSignature(expectedContentType, bytes)) {
    throw new Error("Uploaded school security attachment content does not match its declared file type");
  }
}

export function schoolSecurityIncidentUploadExpiresAt(): Date {
  return new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000);
}