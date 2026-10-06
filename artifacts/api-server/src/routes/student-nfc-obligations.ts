import { Router } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { getUserContext, isPlatformOwner, requireAuthentication } from "../middlewares/auth";
import { studentNfcReadScope } from "../lib/student-nfc-obligations";

const router=Router();
router.use(requireAuthentication());
const filters=z.object({
  schoolId:z.coerce.number().int().positive().optional(),
  studentId:z.coerce.number().int().positive().optional(),
  sessionId:z.coerce.number().int().positive().optional(),
  termId:z.coerce.number().int().positive().optional(),
  className:z.string().max(120).optional(),
  section:z.string().max(80).optional(),
}).strict();

export function nfcObligationStatus(row:any) {
  if(row.legacyInvoiceId!=null) return "LEGACY_REVIEW";
  if(String(row.subscriptionStatus).toLowerCase()==="waived" && String(row.verificationStatus).toLowerCase()==="verified") return "EXEMPT";
  if((String(row.subscriptionStatus).toLowerCase()==="active" || row.lastPaymentStatus==="PAID")
      && String(row.verificationStatus).toLowerCase()==="verified") return "PAID";
  if(["PENDING","RECONCILIATION_REQUIRED"].includes(row.lastPaymentStatus)) return "PENDING";
  if(["FAILED","CANCELLED"].includes(row.lastPaymentStatus)) return "FAILED";
  return "UNPAID";
}

router.get("/student-nfc/obligations",async(req,res,next)=>{
  try {
    const f=filters.parse(req.query);
    const values:unknown[]=[];
    const scope=studentNfcReadScope(req,values,"st",true,"binding.academic_session_id");
    const payerScope=studentNfcReadScope(req,values,"st",false);
    const conditions=[scope];
    const add=(sql:string,value:unknown)=>{if(value!==undefined){values.push(value);conditions.push(`${sql}=$${values.length}`);}};
    add("st.school_id",f.schoolId);add("st.id",f.studentId);
    add("binding.academic_session_id",f.sessionId);add("binding.academic_term_id",f.termId);
    add("st.class_name",f.className);add("st.section",f.section);
    const ctx=getUserContext(req);
    const owner=isPlatformOwner(ctx);
    const teacherOnly=!owner && ctx.roles.some(r=>r.status==="ACTIVE" && r.role==="TEACHER")
      && !ctx.roles.some(r=>r.status==="ACTIVE" && ["SCHOOL_ADMIN","ACCOUNTANT","PARENT","STUDENT"].includes(r.role));
    const result=await pool.query(`SELECT binding.school_id AS "schoolId",sc.name AS "schoolName",
      st.id AS "studentId",st.first_name||' '||st.last_name AS "studentName",st.class_name AS "className",st.section,st.status AS "studentStatus",
      binding.academic_session_id AS "sessionId",ses.name AS "sessionName",
      binding.academic_term_id AS "termId",t.name AS "termName",
      binding.subscription_id AS "subscriptionId",binding.legacy_invoice_id AS "legacyInvoiceId",
      s.status AS "subscriptionStatus",s.verification_status AS "verificationStatus",
      latest.id AS "lastPaymentId",latest.status AS "lastPaymentStatus",latest.reference AS "reference",latest.paid_at AS "paidAt",
      ${payerScope} AS "payerAllowed",s.provider_reference AS "providerReference",
      (t.is_current AND ses.is_current AND upper(t.status)='ACTIVE' AND upper(ses.status)='ACTIVE'
        AND t.start_date<=CURRENT_DATE AND t.end_date>=CURRENT_DATE) AS "currentTerm",
      EXISTS(SELECT 1 FROM fee_invoices i WHERE i.school_id=st.school_id AND i.student_id=st.id
        AND i.academic_session_id=binding.academic_session_id AND i.academic_term_id=binding.academic_term_id
        AND i.status<>'CANCELLED') AS "ordinaryFeesAssigned",
      COALESCE((SELECT sum(i.total_minor) FROM fee_invoices i WHERE i.school_id=st.school_id AND i.student_id=st.id
        AND i.academic_session_id=binding.academic_session_id AND i.academic_term_id=binding.academic_term_id
        AND i.status<>'CANCELLED'),(SELECT sum(fl.amount_minor) FROM fee_structure_lines fl WHERE fl.structure_id=
          (SELECT fs.id FROM fee_structures fs JOIN school_classes cls ON cls.id=fs.school_class_id AND cls.school_id=fs.school_id
           WHERE fs.school_id=st.school_id AND fs.academic_session_id=binding.academic_session_id
             AND fs.academic_term_id=binding.academic_term_id AND cls.name=st.class_name
             AND (fs.section IS NULL OR fs.section=st.section) AND fs.status IN ('DRAFT','PUBLISHED')
           ORDER BY fs.version DESC,fs.created_at DESC LIMIT 1)
          AND fl.category_name_snapshot !~* '(nfc.*subscription|subscription.*nfc)'
          AND fl.description_snapshot !~* '(nfc.*subscription|subscription.*nfc)'),0)::float AS "ordinaryFeesMinor",
      COALESCE((SELECT sum(CASE a.entry_type WHEN 'REVERSAL' THEN -a.amount_minor ELSE a.amount_minor END) FROM student_subscription_allocations a
        WHERE a.payment_id=latest.id AND a.recipient_type='SCHOOL' AND a.entry_type IN ('CREDIT','REVERSAL')),0)::float AS "schoolAllocatedMinor",
      COALESCE((SELECT sum(CASE a.entry_type WHEN 'REVERSAL' THEN -a.amount_minor ELSE a.amount_minor END) FROM student_subscription_allocations a
        WHERE a.payment_id=latest.id AND a.recipient_type='PLATFORM' AND a.entry_type IN ('CREDIT','REVERSAL')),0)::float AS "platformAllocatedMinor",
      COALESCE((SELECT sum(CASE a.entry_type WHEN 'REVERSAL' THEN -a.amount_minor ELSE a.amount_minor END) FROM student_subscription_allocations a
        WHERE a.payment_id=latest.id AND a.recipient_type='PARTNER' AND a.entry_type IN ('CREDIT','REVERSAL')),0)::float AS "partnerAllocatedMinor"
      FROM student_subscription_terms binding JOIN students st ON st.id=binding.student_id AND st.school_id=binding.school_id
      JOIN schools sc ON sc.id=st.school_id
      JOIN academic_sessions ses ON ses.id=binding.academic_session_id AND ses.school_id=binding.school_id
      JOIN academic_terms t ON t.id=binding.academic_term_id AND t.school_id=binding.school_id AND t.academic_session_id=ses.id
      LEFT JOIN subscriptions s ON s.id=binding.subscription_id AND s.school_id=binding.school_id AND s.student_id=binding.student_id
      LEFT JOIN LATERAL(SELECT p.id,p.status,p.reference,p.paid_at FROM student_subscription_payments p
        WHERE p.subscription_id=s.id AND p.school_id=s.school_id
        ORDER BY CASE WHEN p.status='PAID' THEN 0 ELSE 1 END,p.created_at DESC,p.id DESC LIMIT 1) latest ON TRUE
      WHERE ${conditions.join(" AND ")}
      ORDER BY sc.name,st.class_name,st.section,st.first_name,binding.academic_term_id DESC`,values);
    const rows=result.rows.map(row=>{
      const status=nfcObligationStatus(row);
      const amountMinor=status==="EXEMPT" || status==="LEGACY_REVIEW"?0:500000;
      const ordinaryFeesMinor=teacherOnly || (!owner && !row.payerAllowed)?0:Number(row.ordinaryFeesMinor);
      const schoolAllocatedMinor=status==="PAID"?Number(row.schoolAllocatedMinor):0;
      const platformAllocatedMinor=status==="PAID"?Number(row.platformAllocatedMinor):0;
      return {
        schoolId:Number(row.schoolId),schoolName:row.schoolName,studentId:Number(row.studentId),studentName:row.studentName,
        className:row.className,section:row.section??"",sessionId:Number(row.sessionId),sessionName:row.sessionName,
        termId:Number(row.termId),termName:row.termName,subscriptionId:row.subscriptionId==null?null:Number(row.subscriptionId),
        legacyInvoiceId:row.legacyInvoiceId==null?null:Number(row.legacyInvoiceId),status,amountMinor,ordinaryFeesMinor,
        ordinaryFeesAssigned:!!row.ordinaryFeesAssigned,
        totalMinor:ordinaryFeesMinor+amountMinor,schoolShareMinor:200000,platformShareMinor:300000,
        schoolAllocatedMinor,platformAllocatedMinor:teacherOnly?0:platformAllocatedMinor,
        partnerAllocatedMinor:owner && status==="PAID"?Number(row.partnerAllocatedMinor):0,
        lastPaymentId:row.lastPaymentId==null?null:Number(row.lastPaymentId),reference:row.reference??null,
        paidAt:row.paidAt?new Date(row.paidAt).toISOString():null,
        paymentMethod:"Flutterwave — Platform Owner",systemFee:true,
        canPay:!owner && !!row.payerAllowed && !teacherOnly && !!row.currentTerm && String(row.studentStatus).toLowerCase()==="active"
          && ["UNPAID","FAILED"].includes(status) && row.subscriptionId!=null && !row.providerReference,
      };
    });
    const paid=rows.filter(r=>r.status==="PAID");
    res.json({rows,summary:{
      eligible:rows.filter(r=>!["EXEMPT","LEGACY_REVIEW"].includes(r.status)).length,
      paid:paid.length,unpaid:rows.filter(r=>r.status==="UNPAID").length,
      pending:rows.filter(r=>r.status==="PENDING").length,failed:rows.filter(r=>r.status==="FAILED").length,
      legacyReview:rows.filter(r=>r.status==="LEGACY_REVIEW").length,exempt:rows.filter(r=>r.status==="EXEMPT").length,
      collectedMinor:paid.reduce((n,r)=>n+r.amountMinor,0),
      schoolAllocatedMinor:paid.reduce((n,r)=>n+r.schoolAllocatedMinor,0),
      platformAllocatedMinor:paid.reduce((n,r)=>n+r.platformAllocatedMinor,0),
      partnerAllocatedMinor:paid.reduce((n,r)=>n+r.partnerAllocatedMinor,0),
    }});
  } catch(error){if(error instanceof z.ZodError){res.status(400).json({error:"Invalid NFC subscription filters"});return;}next(error);}
});
export default router;
