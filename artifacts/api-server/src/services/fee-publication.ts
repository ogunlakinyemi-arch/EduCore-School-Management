import type { Request } from "express";
import { AuthError } from "../middlewares/auth";
import { ensureTransportInvoiceForTerm } from "../routes/transport";
import { classFeeBillingStudents } from "../lib/class-fee-billing-scope";
import { applyPublishedFeeCorrection } from "./published-fee-corrections";

type Sql = { query(sql:string, values?:any[]):Promise<{rows:any[]}> };
type InvoiceWriter = (db:any,req:Request,schoolId:number,structure:any,student:any,lines:any[],issueDate:string,dueDate:string,actor:number,bulk?:boolean)=>Promise<number>;

/** Run inside the publication transaction. Audited corrections may reprice eligible unpaid invoices; payments are never edited. */
export async function assignPublishedClassFees(db:Sql,req:Request,schoolId:number,structureId:number,actor:number,writeInvoice:InvoiceWriter) {
  const result=await db.query(`SELECT fs.*,t.start_date::text AS start_date,t.end_date::text AS end_date,t.is_current AND session.is_current AS current_period
    FROM fee_structures fs JOIN academic_terms t ON t.id=fs.academic_term_id AND t.school_id=fs.school_id
      AND t.academic_session_id=fs.academic_session_id
    JOIN academic_sessions session ON session.id=t.academic_session_id AND session.school_id=t.school_id
    WHERE fs.id=$1 AND fs.school_id=$2 AND fs.status='PUBLISHED'`,[structureId,schoolId]);
  const structure=result.rows[0];
  if(!structure) throw new AuthError(409,"Fee period or published structure is invalid");
  const lines=(await db.query(`SELECT l.*,c.name AS category_name,c.transport_only FROM fee_structure_lines l
    JOIN fee_categories c ON c.id=l.category_id AND c.school_id=l.school_id
    WHERE l.structure_id=$1 AND l.school_id=$2 ORDER BY l.id`,[structureId,schoolId])).rows;
  const ordinary=lines.filter(l=>!l.transport_only);
  if(!lines.length) throw new AuthError(409,"Add at least one fee before publishing");
  const sum=ordinary.reduce((v,l)=>v+BigInt(l.amount_minor),0n);
  if(sum>2147483647n) throw new AuthError(400,"Combined invoice amount exceeds the ledger limit");
  await applyPublishedFeeCorrection(db,schoolId,structure,lines,actor);
  const students=await classFeeBillingStudents(db,schoolId,structure.academic_session_id,structure.academic_term_id,structure.school_class_id,structure.section);
  let assignedCount=0;
  for(const student of students) {
    if(ordinary.length) {
      const prior=await db.query(`SELECT id FROM fee_invoices WHERE school_id=$1 AND student_id=$2 AND structure_id=$3`,[schoolId,student.id,structureId]);
      if(!prior.rows.length) {
        await writeInvoice(db,req,schoolId,structure,student,ordinary,structure.start_date,structure.end_date,actor,true);
        assignedCount++;
      }
    }
    if(lines.some(l=>l.transport_only)) {
      const assignments=await db.query(`SELECT id FROM transport_student_assignments WHERE school_id=$1 AND student_id=$2 AND status='ACTIVE' AND effective_date<=$3::date ORDER BY id FOR UPDATE`,[schoolId,student.id,structure.end_date]);
      for(const a of assignments.rows) await ensureTransportInvoiceForTerm(db as any,{
        req,assignmentId:Number(a.id),schoolId,academicTermId:structure.academic_term_id,
        actorUserId:actor,actorRole:"SCHOOL_ADMIN",effectiveReason:"Published class transport fee",
      });
    }
  }
  return {assignedCount,eligibleCount:students.length};
}