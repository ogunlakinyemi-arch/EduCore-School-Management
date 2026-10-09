import { z } from "zod";
import { AuthError } from "../middlewares/auth";
import { isSystemNfcCategory } from "../lib/student-nfc-obligations";

type Db = { query(sql: string, values?: any[]): Promise<{rows:any[]}> };
export const feeCorrectionInput = z.object({
  confirmed: z.literal(true), expectedVersion:z.number().int().positive(),
  reason:z.string().trim().min(3).max(500), requestKey:z.string().uuid(),
  lines:z.array(z.object({
    categoryId:z.number().int().positive(),amountMinor:z.number().int().min(1).max(2147483647),
    description:z.string().trim().max(500).optional(),
  }).strict()).min(1).max(50),
}).strict();

/** Locks the affected invoices. No payment, receipt, allocation or adjustment is rewritten. */
export async function correctionInvoices(db:Db,schoolId:number,structureId:number) {
  const invoices=(await db.query(`SELECT * FROM fee_invoices WHERE school_id=$1 AND structure_id=$2 ORDER BY id FOR UPDATE`,
    [schoolId,structureId])).rows;
  for(const invoice of invoices) {
    const history=(await db.query(`SELECT 1 FROM fee_payments WHERE school_id=$1 AND invoice_id=$2
      UNION ALL SELECT 1 FROM fee_adjustments WHERE school_id=$1 AND invoice_id=$2
      UNION ALL SELECT 1 FROM fee_provider_checkout_sessions WHERE school_id=$1 AND invoice_id=$2
      LIMIT 1`,[schoolId,invoice.id])).rows;
    if(invoice.status!=="UNPAID" || Number(invoice.paid_minor)!==0 || history.length) {
      throw new AuthError(409,"This schedule has paid, cancelled, adjusted or payment-in-progress invoices. Use the existing invoice adjustment/refund/review workflow; historical payments and receipts cannot be repriced.");
    }
  }
  return invoices;
}

export async function createPublishedFeeCorrection(db:Db,schoolId:number,structureId:number,actorId:number,input:z.infer<typeof feeCorrectionInput>) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`fee-structure:${schoolId}:${structureId}`]);
  const source=(await db.query("SELECT * FROM fee_structures WHERE id=$1 AND school_id=$2 FOR UPDATE",[structureId,schoolId])).rows[0];
  if(!source)throw new AuthError(404,"Published fee structure not found");
  if(source.status!=="PUBLISHED" || source.version!==input.expectedVersion)throw new AuthError(409,"Reload the published fee structure before correcting it");
  const newer=(await db.query(`SELECT id FROM fee_structures WHERE school_id=$1 AND academic_session_id=$2 AND academic_term_id=$3
    AND school_class_id=$4 AND section IS NOT DISTINCT FROM $5 AND status='PUBLISHED' AND version>$6 LIMIT 1`,
    [schoolId,source.academic_session_id,source.academic_term_id,source.school_class_id,source.section,source.version])).rows;
  if(newer.length)throw new AuthError(409,"Correct the latest published version, not a superseded schedule");
  const pending=(await db.query(`SELECT fs.id FROM audit_logs a JOIN fee_structures fs ON fs.id=a.record_id AND fs.school_id=a.school_id
    WHERE a.school_id=$1 AND a.module='Finance' AND a.action='fee structure: Created published fee correction draft'
      AND a.metadata->>'correctionOfStructureId'=$2::text AND fs.status='DRAFT' LIMIT 1`,[schoolId,structureId])).rows;
  if(pending.length)throw new AuthError(409,`Correction draft #${pending[0].id} already exists; publish that draft rather than creating another`);
  const oldLines=(await db.query(`SELECT l.*,c.transport_only FROM fee_structure_lines l
    JOIN fee_categories c ON c.id=l.category_id AND c.school_id=l.school_id WHERE l.structure_id=$1 AND l.school_id=$2 ORDER BY l.id`,
    [structureId,schoolId])).rows;
  await correctionInvoices(db,schoolId,structureId);
  const categories=(await db.query(`SELECT id,name,description,transport_only,status FROM fee_categories WHERE school_id=$1 AND id=ANY($2::int[])`,
    [schoolId,input.lines.map(l=>l.categoryId)])).rows;
  if(new Set(input.lines.map(l=>l.categoryId)).size!==input.lines.length || categories.length!==input.lines.length)
    throw new AuthError(400,"Use distinct fee categories belonging to this school");
  for(const line of input.lines) {
    const category=categories.find(c=>c.id===line.categoryId);
    if(category.status!=="ACTIVE" || isSystemNfcCategory(`${category.name} ${category.description??""}`) || isSystemNfcCategory(line.description??""))
      throw new AuthError(400,"Use active ordinary fee categories; NFC is managed separately");
    if(category.transport_only && !oldLines.some(l=>l.category_id===line.categoryId && Number(l.amount_minor)===line.amountMinor))
      throw new AuthError(409,"Bus-only charges use the separate transport correction workflow");
  }
  if(oldLines.some(l=>l.transport_only && !input.lines.some(n=>n.categoryId===l.category_id && n.amountMinor===Number(l.amount_minor))))
    throw new AuthError(409,"Keep bus-only charges unchanged; correct transport invoices through transport controls");
  const ordinaryTotal=input.lines.filter(l=>!categories.find(c=>c.id===l.categoryId).transport_only).reduce((sum,l)=>sum+BigInt(l.amountMinor),0n);
  if(ordinaryTotal>2147483647n)throw new AuthError(400,"Combined invoice amount exceeds the ledger limit");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`fee-version:${schoolId}:${source.academic_session_id}:${source.academic_term_id}:${source.school_class_id}:${source.section??""}`]);
  const next=(await db.query(`SELECT COALESCE(MAX(version),0)+1 AS version FROM fee_structures WHERE school_id=$1
    AND academic_session_id=$2 AND academic_term_id=$3 AND school_class_id=$4 AND section IS NOT DISTINCT FROM $5`,
    [schoolId,source.academic_session_id,source.academic_term_id,source.school_class_id,source.section])).rows[0].version;
  const draft=(await db.query(`INSERT INTO fee_structures(school_id,academic_session_id,academic_term_id,school_class_id,section,version,status,created_by)
    VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7) RETURNING id`,
    [schoolId,source.academic_session_id,source.academic_term_id,source.school_class_id,source.section,next,actorId])).rows[0];
  for(const line of input.lines) {
    const category=categories.find(c=>c.id===line.categoryId);
    await db.query(`INSERT INTO fee_structure_lines(school_id,structure_id,category_id,category_name_snapshot,description_snapshot,amount_minor)
      VALUES($1,$2,$3,$4,$5,$6)`,[schoolId,draft.id,line.categoryId,category.name,line.description||category.description||category.name,line.amountMinor]);
  }
  return {draftId:Number(draft.id),source,oldLines};
}

/** Correction drafts reuse existing invoice IDs. Original schedules remain immutable. */
export async function assertFeeStructureNotSuperseded(db:Db,schoolId:number,structureId:number) {
  const superseded=(await db.query(`SELECT fs.id FROM audit_logs a JOIN fee_structures fs ON fs.id=a.record_id AND fs.school_id=a.school_id
    WHERE a.school_id=$1 AND a.module='Finance' AND a.action='fee structure: Created published fee correction draft'
      AND a.metadata->>'correctionOfStructureId'=$2::text AND fs.status='PUBLISHED' LIMIT 1`,[schoolId,structureId])).rows;
  if(superseded.length)throw new AuthError(409,"This fee schedule was superseded by a published correction; use the corrected version");
}
export async function applyPublishedFeeCorrection(db:Db,schoolId:number,structure:any,lines:any[],actorId:number) {
  await assertFeeStructureNotSuperseded(db,schoolId,structure.id);
  const marker=(await db.query(`SELECT metadata->>'correctionOfStructureId' AS "sourceId" FROM audit_logs
    WHERE school_id=$1 AND record_id=$2 AND module='Finance' AND action='fee structure: Created published fee correction draft'
    ORDER BY id DESC LIMIT 1`,[schoolId,structure.id])).rows[0];
  if(!marker)return;
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`fee-structure:${schoolId}:${marker.sourceId}`]);
  const invoices=await correctionInvoices(db,schoolId,Number(marker.sourceId));
  const ordinary=lines.filter(l=>!l.transport_only);
  if(!ordinary.length && invoices.length)throw new AuthError(409,"A correction must retain ordinary invoice items");
  const amount=ordinary.reduce((sum,l)=>sum+Number(l.amount_minor),0);
  for(const invoice of invoices) {
    const beforeLines=(await db.query("SELECT * FROM fee_invoice_lines WHERE invoice_id=$1 AND school_id=$2 ORDER BY id",[invoice.id,schoolId])).rows;
    await db.query(`INSERT INTO audit_logs("user",role,actor_user_id,school_id,action,module,record_id,event_type,result,metadata)
      SELECT u.email,'SCHOOL_ADMIN',u.id,$1,'Recalculated unpaid invoice from published correction','Finance',$2,'APPLICATION_EVENT','SUCCESS',$3::jsonb
      FROM app_users u WHERE u.id=$4`,
      [schoolId,invoice.id,JSON.stringify({before:invoice,beforeLines,afterStructureId:structure.id,afterTotalMinor:amount}),actorId]);
    await db.query("DELETE FROM fee_invoice_lines WHERE invoice_id=$1 AND school_id=$2",[invoice.id,schoolId]);
    for(const line of ordinary)await db.query(`INSERT INTO fee_invoice_lines(school_id,invoice_id,category_id,category_name_snapshot,description_snapshot,amount_minor)
      VALUES($1,$2,$3,$4,$5,$6)`,[schoolId,invoice.id,line.category_id,line.category_name_snapshot??line.category_name,line.description_snapshot,line.amount_minor]);
    await db.query(`UPDATE fee_invoices SET structure_id=$1,subtotal_minor=$2,total_minor=$2,outstanding_minor=$2
      WHERE id=$3 AND school_id=$4`,[structure.id,amount,invoice.id,schoolId]);
  }
}
