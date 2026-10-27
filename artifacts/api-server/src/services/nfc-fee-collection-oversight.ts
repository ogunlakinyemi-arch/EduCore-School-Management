import type { CommunicationQueryClient } from "./communication-service";

/** One read-only catalog query, not one request per school or session.
 * Retired schools and historical terms remain selectable for retained invoices. */
export async function readNfcFeeCollectionFilterOptions(db:CommunicationQueryClient,schoolId?:number){
  const {rows}=await db.query(`
    SELECT
      ($1::int IS NULL OR EXISTS(SELECT 1 FROM schools WHERE id=$1)) AS "schoolExists",
      COALESCE((SELECT jsonb_agg(s ORDER BY s.name,s.id) FROM (
        SELECT id,name FROM schools
      ) s),'[]'::jsonb) AS schools,
      COALESCE((SELECT jsonb_agg(t ORDER BY t."schoolName",t."startDate" DESC,t.id) FROM (
        SELECT t.id,t.school_id AS "schoolId",sc.name AS "schoolName",
          ses.name AS "sessionName",t.name,t.start_date::text AS "startDate",t.end_date::text AS "endDate",
          (t.is_current=true AND ses.is_current=true AND upper(t.status)='ACTIVE'
            AND upper(ses.status)='ACTIVE' AND lower(sc.status)='active'
            AND (now() AT TIME ZONE 'Africa/Lagos')::date BETWEEN t.start_date AND t.end_date) AS "isCurrent"
        FROM academic_terms t
        JOIN schools sc ON sc.id=t.school_id
        JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
        WHERE ($1::int IS NULL OR t.school_id=$1)
      ) t),'[]'::jsonb) AS terms
  `,[schoolId??null]);
  return rows[0] as {schoolExists:boolean;schools:{id:number;name:string}[];terms:{
    id:number;schoolId:number;schoolName:string;sessionName:string;name:string;startDate:string;endDate:string;isCurrent:boolean;
  }[]};
}

export const collectionStatuses=["FULLY_PAID","UNPAID","PENDING_EVIDENCE","UNDER_REVIEW","REJECTED","PARTIALLY_PAID","NOT_CONFIGURED","CANCELLED","REVIEW_REQUIRED"] as const;
export function collectionStatus(amount:number|null,paid:number,paymentStates:string[],invoiceStatus:string){
  if(amount===null)return "NOT_CONFIGURED";
  if(invoiceStatus==="CANCELLED")return "CANCELLED";
  if(["WAIVED","ADJUSTMENT_REVIEW","REFUND_REVIEW","ALLOCATION_REVIEW"].includes(invoiceStatus) || amount===0)return "REVIEW_REQUIRED";
  if(paid>=amount)return "FULLY_PAID";
  if(paid>0)return "PARTIALLY_PAID";
  if(paymentStates.includes("PROCESSING"))return "UNDER_REVIEW";
  if(paymentStates.includes("PENDING"))return "PENDING_EVIDENCE";
  if(paymentStates.includes("REJECTED"))return "REJECTED";
  return "UNPAID";
}

/** Invoice snapshots and line allocations are authoritative, not a student's current school.
 * Never select proof URLs, object paths, family contacts, reviewer notes or bank details. */
export async function readNfcFeeCollectionOversight(db:CommunicationQueryClient,filters:{
  schoolId?:number;termId?:number;search?:string;status?:string;limit:number;offset:number;
}){
  const result=await db.query<any>(`
    WITH fees AS (
      SELECT i.id AS "invoiceId",l.id AS "lineId",i.school_id AS "schoolId",sc.name AS "schoolName",
        i.student_id AS "studentId",i.student_name_snapshot AS "studentName",
        i.admission_no_snapshot AS "admissionNo",i.academic_term_id AS "termId",t.name AS "termName",
        l.category_name_snapshot AS "feeName",l.amount_minor AS "amountMinor",i.currency,
        CASE WHEN i.status='CANCELLED' THEN i.status
          WHEN EXISTS(SELECT 1 FROM fee_refunds f WHERE f.invoice_id=i.id AND f.school_id=i.school_id AND f.status='APPROVED') THEN 'REFUND_REVIEW'
          WHEN i.discount_minor>0 OR i.waiver_minor>0 THEN 'ADJUSTMENT_REVIEW'
          WHEN i.paid_minor>0 AND i.status<>'PAID' AND NOT EXISTS(
            SELECT 1 FROM fee_payment_line_allocations a WHERE a.school_id=i.school_id AND a.invoice_id=i.id AND a.line_id=l.id)
            THEN 'ALLOCATION_REVIEW' ELSE i.status END AS "invoiceStatus",
        CASE WHEN i.status='PAID' AND i.outstanding_minor=0 AND i.paid_minor=i.total_minor
          AND i.discount_minor=0 AND i.waiver_minor=0
          AND (SELECT COALESCE(sum(p.amount_minor),0) FROM fee_payments p
            WHERE p.school_id=i.school_id AND p.invoice_id=i.id AND p.status='VERIFIED')>=i.total_minor
          THEN l.amount_minor::float8 ELSE COALESCE((SELECT sum(a.amount_minor) FROM fee_payment_line_allocations a
          JOIN fee_payments p ON p.id=a.payment_id AND p.school_id=a.school_id AND p.invoice_id=a.invoice_id
          WHERE a.school_id=i.school_id AND a.invoice_id=i.id AND a.line_id=l.id AND p.status='VERIFIED'),0)::float8 END AS "paidMinor",
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',p.id,'reference',COALESCE(p.transfer_reference,p.provider_transaction_id,p.verification_evidence_ref,p.reference),'receiptNumber',r.receipt_number,
          'method',p.method,'date',COALESCE(p.verified_at,p.transfer_date::timestamptz,p.created_at),
          'amountMinor',p.amount_minor,'status',p.status,
          'recordedBy',NULLIF(trim(concat(u.first_name,' ',u.last_name)),''),
          'reviewedBy',NULLIF(trim(concat(v.first_name,' ',v.last_name)),''))
          ORDER BY p.created_at DESC,p.id DESC)
          FROM fee_payments p
          LEFT JOIN fee_receipts r ON r.payment_id=p.id AND r.school_id=p.school_id AND r.invoice_id=p.invoice_id
          LEFT JOIN app_users u ON u.id=p.submitted_by
          LEFT JOIN app_users v ON v.id=p.verified_by
          WHERE p.invoice_id=i.id AND p.school_id=i.school_id
            AND ((p.selected_line_ids IS NULL OR l.id=ANY(p.selected_line_ids))
              OR EXISTS(SELECT 1 FROM fee_payment_line_allocations a
                WHERE a.payment_id=p.id AND a.line_id=l.id AND a.school_id=i.school_id AND a.invoice_id=i.id))
        ),'[]'::jsonb) AS payments
      FROM fee_invoices i JOIN fee_invoice_lines l ON l.invoice_id=i.id AND l.school_id=i.school_id
      JOIN schools sc ON sc.id=i.school_id
      JOIN academic_terms t ON t.id=i.academic_term_id AND t.school_id=i.school_id
      WHERE i.student_id IS NOT NULL AND l.category_name_snapshot ~* '(nfc.*subscription|subscription.*nfc)'
      UNION ALL
      SELECT NULL::int,NULL::int,st.school_id,sc.name,st.id,trim(concat(st.first_name,' ',st.last_name)),
        st.admission_no,t.id,t.name,NULL::text,NULL::int,'NGN','NOT_CONFIGURED',0::float8,'[]'::jsonb
      FROM students st JOIN schools sc ON sc.id=st.school_id
      JOIN academic_terms t ON t.school_id=st.school_id AND t.is_current=true
      JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id AND ses.is_current=true
      WHERE lower(st.status)='active' AND upper(t.status)='ACTIVE' AND upper(ses.status)='ACTIVE'
        AND NOT EXISTS(SELECT 1 FROM fee_invoices i JOIN fee_invoice_lines l ON l.invoice_id=i.id AND l.school_id=i.school_id
          WHERE i.school_id=st.school_id AND i.student_id=st.id AND i.academic_term_id=t.id
            AND l.category_name_snapshot ~* '(nfc.*subscription|subscription.*nfc)')
    ), classified AS (
      SELECT *,CASE WHEN "amountMinor" IS NULL THEN 'NOT_CONFIGURED'
        WHEN "invoiceStatus"='CANCELLED' THEN 'CANCELLED'
        WHEN "invoiceStatus" IN ('WAIVED','ADJUSTMENT_REVIEW','REFUND_REVIEW','ALLOCATION_REVIEW') OR "amountMinor"=0 THEN 'REVIEW_REQUIRED'
        WHEN "paidMinor">="amountMinor" THEN 'FULLY_PAID'
        WHEN "paidMinor">0 THEN 'PARTIALLY_PAID'
        WHEN payments @> '[{"status":"PROCESSING"}]'::jsonb THEN 'UNDER_REVIEW'
        WHEN payments @> '[{"status":"PENDING"}]'::jsonb THEN 'PENDING_EVIDENCE'
        WHEN payments @> '[{"status":"REJECTED"}]'::jsonb THEN 'REJECTED'
        ELSE 'UNPAID' END AS status FROM fees
    ), filtered AS (
      SELECT * FROM classified
      WHERE ($1::int IS NULL OR "schoolId"=$1) AND ($2::int IS NULL OR "termId"=$2)
        AND ($3::text IS NULL OR concat("schoolName",' ',"studentName",' ',"admissionNo") ILIKE '%'||$3||'%')
        AND ($4::text IS NULL OR status=$4)
    )
    SELECT (SELECT count(*)::int FROM filtered) AS total,
      COALESCE((SELECT jsonb_agg(page) FROM (
        SELECT * FROM filtered ORDER BY "schoolName","termId" DESC,"studentName","studentId","lineId"
        LIMIT $5 OFFSET $6) page),'[]'::jsonb) AS items
  `,[filters.schoolId??null,filters.termId??null,filters.search??null,filters.status??null,filters.limit,filters.offset]);
  const row=result.rows[0]??{items:[],total:0};
  return{items:row.items,total:row.total,limit:filters.limit,offset:filters.offset};
}
