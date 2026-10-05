import { Storage } from "@google-cloud/storage";
import { PDFDocument } from "pdf-lib";
import { randomUUID, createHash } from "node:crypto";
import { AuthError } from "../middlewares/auth";

export const LESSON_PDF_MAX = 10 * 1024 * 1024;
const storage = new Storage({ credentials: {
  audience: "replit", subject_token_type: "access_token", token_url: "http://127.0.0.1:1106/token",
  type: "external_account", credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
  universe_domain: "googleapis.com",
}, projectId: "" });

export function lessonPdfFile(path: string) {
  if (!/^\/objects\/lesson-notes\/\d+\/\d+\/[a-f0-9-]+\/(staging|original)$/.test(path))
    throw new AuthError(404, "Lesson-note PDF not found");
  const configured = process.env.PRIVATE_OBJECT_DIR?.replace(/^\/+|\/+$/g, "");
  if (!configured) throw Error("Private lesson-note storage is not configured");
  const [bucket, ...parts] = configured.split("/");
  return storage.bucket(bucket!).file([...parts, path.slice("/objects/".length)].join("/"));
}
export function lessonPdfPaths(school: number, note: number) {
  const root = `/objects/lesson-notes/${school}/${note}/${randomUUID()}`;
  return { stagingPath: `${root}/staging`, objectPath: `${root}/original` };
}
export async function signLessonPdfUpload(path: string) {
  const file = lessonPdfFile(path);
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket_name: file.bucket.name, object_name: file.name, method: "PUT",
      expires_at: new Date(Date.now() + 180000).toISOString() }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error("Lesson-note upload storage is unavailable");
  const data = await response.json() as { signed_url?: string };
  if (typeof data.signed_url !== "string") throw Error("Invalid private storage response");
  return data.signed_url;
}
export function validateLessonPdfMetadata(filename: unknown, size: unknown) {
  if (typeof filename !== "string" || filename.length > 180 || !/\.pdf$/i.test(filename) ||
      /[\/\\\x00-\x1f\x7f]/.test(filename)) throw new AuthError(400, "Choose a PDF filename without path characters");
  if (!Number.isSafeInteger(size) || Number(size) < 1 || Number(size) > LESSON_PDF_MAX)
    throw new AuthError(400, "Lesson-note PDFs must be between 1 byte and 10 MB");
  return { filename, size: Number(size) };
}
export async function validateLessonPdfBytes(bytes: Buffer) {
  if (!bytes.length || bytes.length > LESSON_PDF_MAX || !/^%PDF-1\.[0-9]|^%PDF-2\.0/.test(bytes.subarray(0, 8).toString()) ||
      !/%%EOF\s*$/.test(bytes.subarray(-1024).toString()))
    throw new AuthError(400, "The uploaded file is not a valid PDF");
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    if (pdf.isEncrypted || pdf.getPageCount() < 1) throw Error("Unsupported PDF");
  } catch { throw new AuthError(400, "Upload a readable, unencrypted PDF; renamed or damaged files are rejected"); }
}
export async function finalizeLessonPdf(stagingPath: string, objectPath: string, expectedSize: number) {
  const source = lessonPdfFile(stagingPath);
  let metadata;
  try { [metadata] = await source.getMetadata(); }
  catch (e) { if ((e as { code?: number }).code === 404) throw new AuthError(400, "Upload the PDF before confirming"); throw e; }
  if (Number(metadata.size) !== expectedSize || expectedSize > LESSON_PDF_MAX || metadata.contentType !== "application/pdf")
    throw new AuthError(400, "PDF upload size or content type does not match");
  // Pin the staging generation so replaying its signed URL cannot swap bytes during validation.
  const [bytes] = await source.bucket.file(source.name, { generation: metadata.generation }).download();
  if (bytes.length !== expectedSize) throw new AuthError(400, "PDF size changed during upload");
  await validateLessonPdfBytes(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const original = lessonPdfFile(objectPath);
  try {
    await original.save(bytes, { resumable: false, contentType: "application/pdf",
      preconditionOpts: { ifGenerationMatch: 0 }, metadata: { cacheControl: "private, no-store" } });
  } catch (error) {
    // If a prior confirmation saved bytes but its transaction failed, reconcile
    // the identical immutable object instead of replacing it or trapping a retry.
    if ((error as { code?: number }).code !== 412) throw error;
    const [existing] = await original.download();
    if (createHash("sha256").update(existing).digest("hex") !== sha256)
      throw new AuthError(409, "This PDF version already contains different bytes; start a new upload");
  }
  return sha256;
}
export function lessonDocumentContext(note: Record<string, any>) {
  return Object.fromEntries(["schoolId","teacherId","sessionId","termId","classId","section","subjectId",
    "curriculumMappingId","curriculumVersionId","topicId","subTopicId"].map(key => [key, note[key] ?? null]));
}
export const lessonDocumentColumns = `id,filename,byte_size AS "byteSize",note_revision AS "noteRevision",ready_at AS "createdAt",sha256`;
