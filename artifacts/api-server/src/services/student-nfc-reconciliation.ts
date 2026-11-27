import { classifyStudentNfcPreview, reconciliationDigest, evidenceInteger,
  RECONCILIATION_REPORT_VERSION, RECONCILED_STUDENT_PRICE_MINOR,
  type EvidenceRecord, type ReconciliationEvidence, type StudentNfcReconciliationReport } from "./student-nfc-reconciliation-policy";
type StudentNfcReconciliationSource = StudentNfcReconciliationReport["sources"][number];

type Sql = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };
type Pool = { connect: () => Promise<Sql & { release: () => void }> };
export class ReconciliationPreviewError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export const NFC_PREVIEW_SOURCES: Record<string,string[]> = {
  schools: ["id","name","status"], academic_terms: ["id","school_id","academic_session_id","name","start_date","end_date","status"],
  academic_sessions: ["id","school_id","status"], students: ["id","school_id","status","admission_status"],
  subscriptions: ["id","school_id","student_id","term","amount","status","verification_status","provider_reference","expires_at","allocation_snapshot"],
  student_subscription_terms: ["school_id","student_id","academic_session_id","academic_term_id","subscription_id","legacy_invoice_id"],
  fee_invoices: ["id","school_id","student_id","academic_session_id","academic_term_id","total_minor","paid_minor","outstanding_minor"],
  student_subscription_payments: ["id","subscription_id","school_id","student_id","academic_session_id","academic_term_id","reference","status","gross_amount_minor"],
  student_subscription_allocations: ["subscription_id","school_id","student_id","payment_id"],
  fee_invoice_lines: ["school_id","invoice_id","category_name_snapshot","description_snapshot","amount_minor"],
  fee_payments: ["id","school_id","invoice_id","amount_minor","status","reference"],
  fee_receipts: ["school_id","invoice_id","payment_id","receipt_number"],
  fee_payment_line_allocations: ["school_id","invoice_id","payment_id","line_id","amount_minor"],
  fee_adjustments: ["school_id","invoice_id"],
  fee_refunds: ["school_id","invoice_id","payment_id"],
  fee_provider_checkout_sessions: ["school_id","invoice_id"],
  fee_provider_webhook_events: ["school_id"],
  hosted_checkout_orders: ["reference","school_id","student_id","subscription_id","term_id"],
  hosted_checkout_events: ["order_reference","kind"],
  flutterwave_live_subscription_intents: ["id","school_id","student_id","term_id"],
  flutterwave_split_payments: ["school_id","subscription_id"],
  flutterwave_split_adjustments: ["payment_id"],
  deferred_commission_adverse_events: [],
};
const LIMIT = 5000;
const ROOTS = ["schools","academic_terms","academic_sessions","students","subscriptions","student_subscription_terms","fee_invoices",
  "student_subscription_payments","fee_payments","hosted_checkout_orders","flutterwave_live_subscription_intents"];
const EXTRA = /^(?:flutterwave_live_|student_subscription_|hosted_checkout_|deferred_commission_)[a-z_]+$/;
const LINKS = ["school_id","student_id","subscription_id","invoice_id","order_reference","intent_id","payment_id","payment_reference","reference"];

/** No DDL, provider request, lock-for-update, audit insert or other business write. */
export async function previewStudentNfcReconciliation(pool: Pool, scope: { schoolId: number; termId: number }): Promise<StudentNfcReconciliationReport> {
  return collectReconciliation(pool,scope);
}
/** Separate stable review evidence; never changes the ordinary dated report.
 * Caller owns the pinned transaction and its locks. No nested BEGIN/COMMIT. */
export async function previewAdvanceReconciliation(c:Sql,scope:{schoolId:number;termId:number}){
  return collectReconciliation({connect:async()=>({...c,query:c.query.bind(c),release(){}})},scope,true);
}
/** Ordinary dated evidence on an already pinned transaction; no nested BEGIN. */
export async function previewPinnedCurrentReconciliation(c:Sql,scope:{schoolId:number;termId:number}){
 return collectReconciliation({connect:async()=>({...c,query:c.query.bind(c),release(){}})},scope,false,true);
}
async function collectReconciliation(pool:Pool,scope:{schoolId:number;termId:number},advance=false,pinned=false):Promise<StudentNfcReconciliationReport>{
  const c = await pool.connect();
  let transaction = false;
  try {
    if(!advance&&!pinned){await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); transaction = true;}
    await c.query("SET LOCAL statement_timeout = '8s'");
    await c.query("SET LOCAL lock_timeout = '2s'");
    const catalog = await c.query(`SELECT t.relname AS name,t.relkind, row_security_active(t.oid) AS rls,
      has_table_privilege(t.oid,'SELECT') AS readable,
      array_agg(a.attname::text ORDER BY a.attname) FILTER(WHERE a.attnum>0 AND NOT a.attisdropped) AS columns
      FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
      LEFT JOIN pg_attribute a ON a.attrelid=t.oid
      WHERE n.nspname='public' AND (t.relname=ANY($1::text[]) OR t.relname ~ $2)
      GROUP BY t.oid,t.relname,t.relkind ORDER BY t.relname`,
    [Object.keys(NFC_PREVIEW_SOURCES), "^(flutterwave_live_|student_subscription_|hosted_checkout_|deferred_commission_)"]);
    const metadata = new Map(catalog.rows.map(r=>[r.name,r]));
    const names = [...ROOTS, ...Object.keys(NFC_PREVIEW_SOURCES).filter(n=>!ROOTS.includes(n)),
      ...catalog.rows.filter(r=>!NFC_PREVIEW_SOURCES[r.name] && EXTRA.test(r.name) &&
        LINKS.some(col=>(r.columns ?? []).includes(col))).map(r=>String(r.name))];
    const evidence: ReconciliationEvidence = {};
    const sources: StudentNfcReconciliationSource[] = [];
    const ids = (table: string, field = "id") => (evidence[table] ?? []).map(r=>r[field])
      .filter(v=>v!=null).map(String);
    const queryValues = () => [String(scope.schoolId), ids("students"), ids("subscriptions"), ids("fee_invoices"),
      ids("hosted_checkout_orders","reference"), ids("flutterwave_live_subscription_intents"),
      [...ids("student_subscription_payments"),...ids("fee_payments")],
      [...ids("student_subscription_payments","reference"),...ids("fee_payments","reference")], LIMIT+1];
    for (const name of names) {
      const m = metadata.get(name);
      const issues: string[] = [];
      if (!m) issues.push("TABLE_NOT_AVAILABLE");
      else {
        if (!["r","p"].includes(m.relkind)) issues.push("AUTHORITATIVE_BASE_TABLE_REQUIRED");
        if (!m.readable) issues.push("SELECT_NOT_AUTHORIZED");
        if (m.rls) issues.push("ROW_SECURITY_MAY_HIDE_EVIDENCE");
        for (const col of NFC_PREVIEW_SOURCES[name] ?? []) if (!m.columns?.includes(col)) issues.push(`MISSING_COLUMN:${col}`);
      }
      const source = { name, complete: issues.length===0, recordCount: 0, issues };
      sources.push(source); evidence[name] = [];
      if (!source.complete) continue;
      // Only hardcoded or catalog-whitelisted identifiers may reach SQL interpolation.
      if (!/^[a-z_]+$/.test(name)) throw new ReconciliationPreviewError(503,"Invalid evidence source identity.");
      const record = "to_jsonb(r)";
      let predicate: string;
      let values: any[];
      if (name==="schools") { predicate=`${record}->>'id'=$1`; values=[String(scope.schoolId),LIMIT+1]; }
      else if (name==="academic_terms") {
        predicate=`${record}->>'school_id'=$1 AND ${record}->>'id'=$2`; values=[String(scope.schoolId),String(scope.termId),LIMIT+1];
      } else if (name==="academic_sessions") {
        predicate=`${record}->>'school_id'=$1 AND ${record}->>'id'=ANY($2::text[])`;
        values=[String(scope.schoolId),ids("academic_terms","academic_session_id"),LIMIT+1];
      } else {
        predicate=`(${record}->>'school_id'=$1 OR ${record}->>'student_id'=ANY($2::text[])
          OR ${record}->>'subscription_id'=ANY($3::text[]) OR ${record}->>'invoice_id'=ANY($4::text[])
          OR ${record}->>'order_reference'=ANY($5::text[]) OR ${record}->>'intent_id'=ANY($6::text[])
          OR ${record}->>'payment_id'=ANY($7::text[]) OR ${record}->>'payment_reference'=ANY($8::text[]))`;
        values=queryValues();
        if (!(m.columns ?? []).some((col:string)=>LINKS.includes(col))) {
          source.complete=false; source.issues.push("NO_SUPPORTED_SCOPE_LINK"); continue;
        }
      }
      const rows = await c.query(`SELECT ${record} AS record FROM public."${name}" r
        WHERE ${predicate} ORDER BY ${record}::text LIMIT $${values.length}`, values);
      source.recordCount = Math.min(rows.rows.length,LIMIT);
      if (rows.rows.length>LIMIT) { source.complete=false; source.issues.push("SOURCE_TRUNCATED_NO_CONVERSION_ALLOWED"); }
      evidence[name]=rows.rows.slice(0,LIMIT).map(r=>r.record as EvidenceRecord);
    }
    if(advance){
      // Only PLANNED/ACTIVE lifecycle transitions are accepted by the separate
      // authorization service. All other fields, including dates, stay bound.
      for(const name of ["academic_terms","academic_sessions"]){
        evidence[name]=evidence[name].map(({is_current,status,updated_at,...material})=>({...material,status:"ACTIVE"}));
      }
    }
    const school=evidence.schools?.find(r=>Number(r.id)===scope.schoolId);
    const term=evidence.academic_terms?.find(r=>Number(r.id)===scope.termId && Number(r.school_id)===scope.schoolId);
    if (!sources.filter(s=>["schools","academic_terms"].includes(s.name)).every(s=>s.complete))
      throw new ReconciliationPreviewError(503,"School and term identity could not be read safely.");
    if (!school || !term) throw new ReconciliationPreviewError(404,"School or matching academic term not found.");
    if(String(school.status).toUpperCase()!=="ACTIVE") {
      const source=sources.find(s=>s.name==="schools")!;
      source.complete=false; source.issues.push("SCHOOL_STATUS_REQUIRES_REVIEW");
    }
    const session=evidence.academic_sessions?.find(r=>r.id===term.academic_session_id);
    const roster=(evidence.students ?? []).filter(st=>Number(st.school_id)===scope.schoolId);
    const subjects=new Map(roster.map(st=>[Number(st.id),st]));
    const studentSource=sources.find(s=>s.name==="students")!;
    if(subjects.size!==roster.length) { studentSource.complete=false; studentSource.issues.push("DUPLICATE_STUDENT_IDENTITIES"); }
    // Historical obligations whose student is missing/transferred cannot disappear
    // from a report merely because the current school roster no longer joins them.
    const historicalSubjects=[...(evidence.student_subscription_terms ?? []),
      ...(evidence.student_subscription_payments ?? []),...(evidence.hosted_checkout_orders ?? []),
      ...(evidence.flutterwave_live_subscription_intents ?? [])]
      .filter(r=>Number(r.school_id)===scope.schoolId && Number(r.academic_term_id ?? r.term_id)===scope.termId);
    for(const history of historicalSubjects) {
      const studentId=evidenceInteger(history.student_id);
      if(!studentId || !subjects.has(studentId)) {
        studentSource.complete=false;
        if(!studentSource.issues.includes("ORPHANED_FINANCIAL_SUBJECT_REQUIRES_REVIEW"))
          studentSource.issues.push("ORPHANED_FINANCIAL_SUBJECT_REQUIRES_REVIEW");
        if(studentId)subjects.set(studentId,{id:studentId,school_id:scope.schoolId,first_name:"Student record unavailable",
          status:"UNRESOLVED",admission_status:"UNRESOLVED"});
      }
    }
    const complete=sources.every(s=>s.complete);
    const stamp=(await c.query(`SELECT transaction_timestamp()::text AS generated_at,
      (transaction_timestamp() AT TIME ZONE 'Africa/Lagos')::date::text AS today`)).rows[0];
    const evidenceDay=advance?String(term.start_date):stamp.today;
    const rows=[...subjects.values()].map(student=>
      classifyStudentNfcPreview({ evidence, student, term, session, schoolId:scope.schoolId, complete, today:evidenceDay }))
      .sort((a,b)=>a.studentId-b.studentId);
    const report: StudentNfcReconciliationReport = {
      reportVersion: RECONCILIATION_REPORT_VERSION, readOnly:true, applyAvailable:false, approvalRequired:true,
      generatedAt:stamp.generated_at, schoolId:scope.schoolId, termId:scope.termId,
      academicSessionId:evidenceInteger(term.academic_session_id), schoolName:String(school.name ?? ""),
      termName:String(term.name ?? ""), termStart:term.start_date ?? null, termEnd:term.end_date ?? null,
      platformAmountMinor:RECONCILED_STUDENT_PRICE_MINOR, sourceStatus:complete?"COMPLETE":"INCOMPLETE", sources, rows,
      summary:{ candidates:rows.filter(r=>r.status==="CANDIDATE_AFTER_REVIEW").length,
        newObligations:rows.filter(r=>r.status==="NEW_OBLIGATION_AFTER_REVIEW").length,
        ownerReview:rows.filter(r=>r.status==="OWNER_REVIEW").length,
        preserved:rows.filter(r=>r.status==="PRESERVE_COMPLETED_HISTORY").length },
      warnings:[
        "READ_ONLY_PREVIEW_NO_MIGRATION_PAYMENT_OR_CARD_ACTIVATION",
        "SEPARATE_EXPLICIT_REVIEW_APPROVAL_AND_FRESH_REVALIDATION_REQUIRED_BEFORE_ANY_APPLY",
        "DATABASE_TARGET_NOT_APPROVED_FOR_WRITES_BY_THIS_REPORT",
        "PROVIDER_NOT_CONTACTED_EXISTING_ATTEMPTS_REQUIRE_INDEPENDENT_RECONCILIATION",
        "PARENT_FACING_NFC_FEE_IS_SEPARATE_NEVER_SUBTRACT_PARENT_PAYMENTS_FROM_PLATFORM_PRICE",
        "PARENT_FEE_CONFIGURATION_AND_NEW_CHECKOUT_POLICY_NOT_APPROVED_BY_THIS_PREVIEW",
        ...(!complete?["INCOMPLETE_SOURCES_NO_CANDIDATES_MAY_BE_APPLIED"]:[]),
      ],
      evidenceDigest:reconciliationDigest({ version:RECONCILIATION_REPORT_VERSION,effectiveDate:evidenceDay,scope,sources,evidence,
        decisions:rows.map(r=>({studentId:r.studentId,status:r.status,evidenceDigest:r.evidenceDigest})) }),
    };
    if(transaction)await c.query("COMMIT"); transaction=false; return report;
  } catch(error) {
    if(transaction) await c.query("ROLLBACK").catch(()=>undefined);
    throw error;
  } finally { c.release(); }
}
