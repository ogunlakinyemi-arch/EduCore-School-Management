import { randomUUID } from "node:crypto";
import { Storage, type File } from "@google-cloud/storage";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const UPLOAD_TTL_SECONDS = 180;
const DOWNLOAD_TTL_SECONDS = 300;
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

function privateObject(filePath: string): File {
  const configured = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!configured) throw new Error("PRIVATE_OBJECT_DIR is not configured for private admissions documents");
  const segments = configured.replace(/^\/+|\/+$/g, "").split("/");
  const bucketName = segments.shift();
  if (!bucketName || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("PRIVATE_OBJECT_DIR is invalid for private admissions documents");
  }
  if (!/^\/objects\/admissions\/(?:[1-9]\d*\/[1-9]\d*|intake\/[a-z0-9][a-z0-9-]{2,79})\/(?:photo-)?[0-9a-f-]{36}$/i.test(filePath)) {
    throw new TypeError("Invalid private admissions object path");
  }
  const objectSegments = filePath.slice("/objects/".length).split("/");
  return storage.bucket(bucketName).file([...segments, ...objectSegments].filter(Boolean).join("/"));
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
  if (!response.ok) throw new Error(`Failed to sign private admissions object URL (${response.status})`);
  const body = await response.json() as { signed_url?: unknown };
  if (typeof body.signed_url !== "string") throw new Error("Object storage returned an invalid admissions object URL");
  return body.signed_url;
}

export function newAdmissionDocumentPath(schoolId: number, applicationId: number): string {
  return `/objects/admissions/${schoolId}/${applicationId}/${randomUUID()}`;
}

export function newAdmissionIntakeDocumentPath(portalKey: string): string {
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(portalKey)) {
    throw new TypeError("Invalid admissions portal key for staff document staging");
  }
  return `/objects/admissions/intake/${portalKey}/${randomUUID()}`;
}

export function newAdmissionPhotoPath(schoolId: number, applicationId: number): string {
  return `/objects/admissions/${schoolId}/${applicationId}/photo-${randomUUID()}`;
}

export async function admissionDocumentUploadUrl(objectPath: string, contentType: string): Promise<string> {
  const file = privateObject(objectPath);
  if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    throw new TypeError("Unsupported admissions document content type");
  }
  return signedObjectUrl(file, "PUT", UPLOAD_TTL_SECONDS);
}

export async function admissionDocumentDownloadUrl(objectPath: string): Promise<string> {
  return signedObjectUrl(privateObject(objectPath), "GET", DOWNLOAD_TTL_SECONDS);
}

export async function assertStagedAdmissionObject(
  objectPath: string,
  contentType: string,
  byteSize: number,
): Promise<void> {
  const file = privateObject(objectPath);
  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (error) {
    if ((error as { code?: number })?.code === 404) throw new Error("Uploaded admissions document was not found");
    throw error;
  }
  const size = Number(metadata.size);
  const actualContentType = typeof metadata.contentType === "string"
    ? metadata.contentType.split(";")[0]?.trim().toLowerCase()
    : null;
  if (size !== byteSize || actualContentType !== contentType || size < 1 || size > 10 * 1024 * 1024) {
    throw new Error("Uploaded admissions document metadata does not match the staged upload");
  }
  const [bytes] = await file.download();
  const valid = contentType === "application/pdf"
    ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
    : contentType === "image/jpeg"
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : contentType === "image/png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : contentType === "image/webp"
          ? bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WEBP"
          : false;
  if (!valid || bytes.length !== byteSize) {
    throw new Error("Uploaded admissions document is incomplete or does not match its declared format");
  }
}

export function admissionsObjectPathMatchesApplication(
  objectPath: string,
  schoolId: number,
  applicationId: number,
): boolean {
  return objectPath.startsWith(`/objects/admissions/${schoolId}/${applicationId}/`) &&
    /^\/objects\/admissions\/\d+\/\d+\/(?:photo-)?[0-9a-f-]{36}$/i.test(objectPath);
}

export async function publicAdmissionLogoUrl(objectPath: string | null): Promise<string | null> {
  if (!objectPath || !/^\/objects\/admissions\/\d+\/\d+\/(?:photo-)?[0-9a-f-]{36}$/i.test(objectPath)) {
    return null;
  }
  const file = privateObject(objectPath);
  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (error) {
    if ((error as { code?: number })?.code === 404) return null;
    throw error;
  }
  const contentType = typeof metadata.contentType === "string"
    ? metadata.contentType.split(";")[0]?.trim().toLowerCase()
    : "";
  const size = Number(metadata.size);
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType) || !Number.isSafeInteger(size) || size < 1 || size > 3 * 1024 * 1024) {
    return null;
  }
  return admissionDocumentDownloadUrl(objectPath);
}