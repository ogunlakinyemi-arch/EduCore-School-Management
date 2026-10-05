import { Storage } from "@google-cloud/storage";
import { randomUUID, createHash } from "node:crypto";
import { AuthError } from "../middlewares/auth";
import { readZipEntries, parseXlsx, extractReadablePdf } from "../routes/people-import-service";
import { uploadBytes } from "./exam-record-import";
import { pool } from "@workspace/db";
import { schoolLogoFile } from "../lib/schoolLogoStorage";

const storage=new Storage({credentials:{audience:"replit",subject_token_type:"access_token",token_url:"http://127.0.0.1:1106/token",
  type:"external_account",credential_source:{url:"http://127.0.0.1:1106/credential",format:{type:"json",subject_token_field_name:"access_token"}},
  universe_domain:"googleapis.com"},projectId:""});
function objectFile(path:string) {
  if(!/^\/objects\/exam-questions\/[a-zA-Z0-9/-]+$/.test(path)) throw new AuthError(404,"Question document not found");
  const configured=process.env.PRIVATE_OBJECT_DIR?.replace(/^\/+|\/+$/g,"");
  if(!configured) throw new Error("Private file storage is not configured");
  const [bucket,...parts]=configured.split("/");
  return storage.bucket(bucket).file([...parts,path.slice("/objects/".length)].filter(Boolean).join("/"));
}
const decodeXml=(v:string)=>v.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");
export function questionDocument(body:any) {
  const file=uploadBytes(body);
  let mimeType="",previewText="";
  try {
    if(/\.pdf$/i.test(file.filename)&&file.buffer.subarray(0,5).toString()==="%PDF-") {
      mimeType="application/pdf";
      // Scanned PDFs remain valid original documents; there is no score inference.
      try {previewText=extractReadablePdf(file.buffer);} catch {previewText="Preview the original PDF document. This PDF has no readable text layer.";}
    } else if(/\.docx$/i.test(file.filename)&&file.buffer.subarray(0,2).toString()==="PK") {
      const entries=readZipEntries(file.buffer),xml=entries.get("word/document.xml")?.toString("utf8");
      if(!xml||/<!DOCTYPE|<!ENTITY/i.test(xml)||entries.has("word/vbaProject.bin")) throw Error("Upload a valid macro-free DOCX document");
      mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      previewText=decodeXml(xml.replace(/<w:tab\b[^>]*\/>/g,"\t").replace(/<\/w:p>/g,"\n").replace(/<[^>]*>/g,"")).trim();
      if(!previewText) throw Error("This Word document has no readable questions");
    } else if(/\.xlsx$/i.test(file.filename)&&file.buffer.subarray(0,2).toString()==="PK") {
      mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const rows=parseXlsx(file.buffer);
      if(!rows.length||rows.some(r=>!r.values.Question?.trim())) throw Error("A structured question workbook must have a Question column with a question in every row. Optional columns: Marks, Option A, Option B, Option C, Option D.");
      previewText=rows.map((row,i)=>`${i+1}. ${row.values.Question}\n${["Option A","Option B","Option C","Option D"].filter(k=>row.values[k]).map(k=>`${k}: ${row.values[k]}`).join("\n")}${row.values.Marks?`\nMarks: ${row.values.Marks}`:""}`).join("\n\n");
    } else throw Error("Supported question-paper files are PDF, DOCX and structured XLSX (not legacy DOC or macro-enabled Office files)");
  } catch(error) {throw new AuthError(400,(error as Error).message);}
  if(previewText.length>200000) throw new AuthError(400,"This question paper is too large to preview safely");
  return {...file,mimeType,previewText};
}
export async function storeQuestionDocument(file:ReturnType<typeof questionDocument>,schoolId:number) {
  const objectPath=`/objects/exam-questions/${schoolId}/${randomUUID()}`;
  // No signed write URL is issued: submitted versions cannot be replaced by replaying an upload.
  await objectFile(objectPath).save(file.buffer,{resumable:false,metadata:{contentType:file.mimeType,cacheControl:"private, no-store"}});
  return objectPath;
}
export async function readQuestionDocument(version:any) {
  const [bytes]=await objectFile(version.object_path).download();
  if(createHash("sha256").update(bytes).digest("hex")!==version.sha256) throw new AuthError(409,"The stored document does not match its immutable version; printing is blocked");
  return bytes;
}
const escape=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export async function printableStructuredPaper(paper:any,version:any,bytes:Buffer) {
  const questions=parseXlsx(bytes);
  const school=(await pool.query("SELECT name FROM schools WHERE id=$1",[paper.schoolId])).rows[0];
  const logo=(await pool.query("SELECT object_path,content_type FROM school_branding_logos WHERE school_id=$1 AND is_current=true",[paper.schoolId])).rows[0];
  let logoHtml="";
  if(logo) {
    const [buffer]=await schoolLogoFile(logo.object_path).download();
    logoHtml=`<img alt="School logo" src="data:${escape(logo.content_type)};base64,${buffer.toString("base64")}" style="height:65px;max-width:120px;object-fit:contain">`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(paper.examinationName)}</title><style>
    @page{size:A4;margin:18mm;@bottom-center{content:"Page " counter(page) " of " counter(pages)}}
    body{font:12pt Georgia,serif;color:#111;margin:0}header{text-align:center;border-bottom:1px solid #222;padding-bottom:12px}
    h1{font-size:19pt;margin:7px}h2{font-size:15pt;margin:6px}.details{display:flex;justify-content:space-between;gap:15px}
    .instructions{white-space:pre-wrap}li{break-inside:avoid;margin:18px 0;white-space:pre-wrap}.options{margin-top:8px}
    @media screen{body{max-width:760px;margin:30px auto;padding:20px}}</style></head><body><header>${logoHtml}
    <h1>${escape(school?.name)}</h1><h2>${escape(paper.examinationName)}</h2><p>${escape(paper.sessionName)} — ${escape(paper.termName)}</p>
    <p>${escape(paper.className)} / ${escape(paper.section)} — ${escape(paper.subjectName)}</p></header>
    <p class="details"><span>${paper.duration?`Duration: ${escape(paper.duration)}`:""}</span><span>${paper.totalMarks?`Total marks: ${escape(paper.totalMarks)}`:""}</span></p>
    <p class="instructions">${escape(paper.instructions)}</p><ol>${questions.map(row=>`<li>${escape(row.values.Question)}<div class="options">${
      ["Option A","Option B","Option C","Option D"].filter(k=>row.values[k]).map(k=>`${escape(k)}: ${escape(row.values[k])}`).join("<br>")}</div>${
      row.values.Marks?`<p>(${escape(row.values.Marks)} marks)</p>`:""}</li>`).join("")}</ol></body></html>`;
}
