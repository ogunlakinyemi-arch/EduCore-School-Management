import { Storage } from "@google-cloud/storage";
import sharp from "sharp";
import { isManagedSchoolLogoObjectPath, readValidatedSchoolLogo } from "./schoolLogoStorage";

export type PrintableImage = { bytes: Buffer; width: number; height: number };

const STORAGE_ENDPOINT = "http://127.0.0.1:1106";
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${STORAGE_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${STORAGE_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateBucketAndPrefix() {
  const configured = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!configured) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  const segments = configured.replace(/^\/+|\/+$/g, "").split("/");
  const bucketName = segments.shift();
  if (!bucketName || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("PRIVATE_OBJECT_DIR is invalid");
  }
  return { bucketName, prefix: segments.join("/") };
}

function scopedPhotoPath(schoolId: number, personId: number, raw: unknown, kind: "student" | "employee") {
  if (typeof raw !== "string") return null;
  const collection = kind === "student" ? "student-photos" : "employee-photos";
  const pattern = new RegExp(
    `^/objects/${collection}/${schoolId}/${personId}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
    "i",
  );
  return pattern.test(raw) ? raw : null;
}

async function readScopedPhoto(path: string): Promise<Buffer> {
  const { bucketName, prefix } = privateBucketAndPrefix();
  const objectName = [prefix, path.slice("/objects/".length)].filter(Boolean).join("/");
  const file = storage.bucket(bucketName).file(objectName);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  const mime = typeof metadata.contentType === "string"
    ? metadata.contentType.split(";")[0]?.toLowerCase()
    : "";
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_IMAGE_BYTES ||
      !["image/jpeg", "image/png", "image/webp"].includes(mime ?? "")) {
    throw new Error("Managed image metadata is invalid");
  }
  const [bytes] = await file.download();
  if (bytes.length !== size || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Managed image size does not match its metadata");
  }
  const image = sharp(bytes, { failOn: "warning", limitInputPixels: 16_777_216 });
  const meta = await image.metadata();
  if (!meta.width || !meta.height || meta.width > 8192 || meta.height > 8192 ||
      meta.width * meta.height > 16_777_216 || (meta.pages ?? 1) !== 1 ||
      meta.format !== (mime === "image/jpeg" ? "jpeg" : mime?.slice("image/".length))) {
    throw new Error("Managed image is corrupt or unsupported");
  }
  // Re-encoding strips metadata and normalizes image components for the PDF.
  return image.rotate().flatten({ background: "#ffffff" }).toColourspace("srgb").jpeg({ quality: 90 }).toBuffer();
}

async function prepared(bytes: Buffer): Promise<PrintableImage> {
  const jpeg = await sharp(bytes).rotate().resize({
    width: 1600,
    height: 1600,
    fit: "inside",
    withoutEnlargement: true,
  }).flatten({ background: "#ffffff" }).toColourspace("srgb").jpeg({ quality: 90 }).toBuffer();
  const metadata = await sharp(jpeg).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Prepared image dimensions are unavailable");
  return { bytes: jpeg, width: metadata.width, height: metadata.height };
}

/** Missing, corrupt or cross-school managed assets are optional and omitted. */
export async function loadPrintablePhoto(
  schoolId: number,
  personId: number,
  path: unknown,
  kind: "student" | "employee",
): Promise<PrintableImage | null> {
  const objectPath = scopedPhotoPath(schoolId, personId, path, kind);
  if (!objectPath) return null;
  try {
    return await prepared(await readScopedPhoto(objectPath));
  } catch {
    return null;
  }
}

/** School logo reads use the existing validator and strict school-bound paths. */
export async function loadPrintableSchoolLogo(
  schoolId: number,
  path: unknown,
): Promise<PrintableImage | null> {
  if (!isManagedSchoolLogoObjectPath(schoolId, path)) return null;
  try {
    const validated = await readValidatedSchoolLogo(schoolId, path);
    return await prepared(validated.bytes);
  } catch {
    return null;
  }
}