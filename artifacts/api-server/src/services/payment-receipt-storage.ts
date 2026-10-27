import { createHash } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import sharp from "sharp";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { HostedPaymentError } from "../lib/hosted-manual-policy";

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const storage = new Storage({
  credentials: { audience: "replit", subject_token_type: "access_token", token_url: "http://127.0.0.1:1106/token",
    type: "external_account", credential_source: { url: "http://127.0.0.1:1106/credential",
      format: { type: "json", subject_token_field_name: "access_token" } }, universe_domain: "googleapis.com" },
  projectId: "",
});
export function receiptDigest(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }
export async function validateReceiptBytes(bytes: Buffer, declaredType: string) {
  if (!bytes.length || bytes.length > RECEIPT_MAX_BYTES) throw new HostedPaymentError(400, "INVALID_RECEIPT_SIZE", "Receipt must be between 1 byte and 5 MiB.");
  const type = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
    : bytes.subarray(0,5).toString() === "%PDF-" ? "application/pdf" : "";
  if (!type || type !== declaredType) throw new HostedPaymentError(400, "INVALID_RECEIPT_TYPE", "Upload a genuine JPEG, PNG or PDF with its matching file type.");
  try {
    if (type === "application/pdf") {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
      if (!pdf.getPageCount() || pdf.getPageCount() > 20) throw new Error();
      const banned = ["JS","JavaScript","OpenAction","AA","EmbeddedFiles","EF","XFA","RichMediaContent"];
      const visited=new Set<unknown>();
      let inspected=0;
      for (const [,object] of pdf.context.enumerateIndirectObjects()) {
        const visit = (value: unknown, depth = 0): void => {
          if (value===null || typeof value!=="object" || visited.has(value)) return;
          visited.add(value);
          if (depth > 30 || ++inspected>20000) throw new Error();
          if (value instanceof PDFArray) {
            for (let n=0;n<value.size();n++) visit(value.get(n),depth+1);
          }
          if (value instanceof PDFDict) {
            if (banned.some(n => value.has(PDFName.of(n)))) throw new Error();
            const action = value.get(PDFName.of("S"));
            if (action instanceof PDFName && ["JavaScript","Launch","SubmitForm","ImportData","GoToR"].includes(action.decodeText())) throw new Error();
            for (const [,child] of value.entries()) visit(child, depth + 1);
          }
          if ((value as {dict?:unknown}).dict instanceof PDFDict) visit((value as {dict:PDFDict}).dict,depth+1);
        };
        visit(object);
      }
      if (!bytes.subarray(-1024).includes(Buffer.from("%%EOF"))) throw new Error();
      return { bytes, contentType: type, sha256: receiptDigest(bytes) };
    }
    // Decode to enforce real image content and strip EXIF/active/polyglot trailing data.
    const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "error" }).rotate();
    const safe = await (type === "image/png" ? image.png() : image.jpeg({ quality: 95 })).toBuffer();
    if (safe.length > RECEIPT_MAX_BYTES) throw new Error();
    return { bytes: safe, contentType: type, sha256: receiptDigest(safe) };
  } catch { throw new HostedPaymentError(400, "UNSAFE_RECEIPT", "Receipt is damaged, oversized, encrypted or contains unsupported active/embedded content."); }
}
function file(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid receipt identifier");
  const base = process.env.PRIVATE_OBJECT_DIR?.replace(/^\/+|\/+$/g,"");
  if (!base || base.split("/").length < 2 || base.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Private receipt storage is unavailable");
  for (const path of (process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? "").split(",")) {
    const p = path.trim().replace(/^\/+|\/+$/g,"");
    if (p && (base === p || base.startsWith(`${p}/`) || p.startsWith(`${base}/`))) throw new Error("Receipt storage overlaps a public search path");
  }
  const [bucket,...prefix] = base.split("/");
  return storage.bucket(bucket).file([...prefix,"financial-receipts",id].join("/"));
}
export const privateReceiptStorage = {
  async save(id: string, bytes: Buffer, contentType: string) {
    const f = file(id);
    try {
      await f.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType, cacheControl: "private, no-store", metadata: { visibility: "private" } } });
    } catch (e) {
      // Storage acceptance followed by a lost DB commit must not replace evidence.
      if ((e as {code?:number}).code !== 412) throw e;
      const [existing]=await f.download();
      if (receiptDigest(existing)!==receiptDigest(bytes)) throw new Error("Stored receipt differs from retry");
    }
    return `financial-receipts/${id}`;
  },
  async read(id: string) { const [bytes] = await file(id).download(); return bytes; },
};
