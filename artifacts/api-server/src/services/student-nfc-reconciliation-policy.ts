import { createHash } from "node:crypto";
import { PreviewStudentNfcReconciliationResponse } from "@workspace/api-zod";
import type { z } from "zod";
export type StudentNfcReconciliationReport = z.infer<typeof PreviewStudentNfcReconciliationResponse>;
export type StudentNfcReconciliationRow = StudentNfcReconciliationReport["rows"][number];

export type EvidenceRecord = Record<string, any>;
export type ReconciliationEvidence = Record<string, EvidenceRecord[]>;
export const RECONCILED_STUDENT_PRICE_MINOR = 320_000;
export const RECONCILIATION_REPORT_VERSION = "SCHOOL_COLLECTED_NFC_PREVIEW_V1";

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function reconciliationDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function evidenceInteger(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
/** Exact decimal conversion, never float multiplication or parent-payment subtraction. */
export function subscriptionMinor(value: unknown): number | null {
  const match = String(value ?? "").match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const amount = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}
const upper = (v: unknown) => String(v ?? "").toUpperCase();
const str = (v: unknown) => typeof v === "string" ? v : "";
const same = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);
const unique = <T,>(items: T[]) => [...new Set(items)];
const day = (v: unknown) => str(v).slice(0, 10);
function nextDay(value: unknown) {
  const d = new Date(`${day(value)}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10);
}
const nfc = (r: EvidenceRecord) => /nfc.*subscription|subscription.*nfc/i.test(
  `${r.category_name_snapshot ?? ""} ${r.description_snapshot ?? ""}`);
function safeSum(values: Array<number | null>): number | null {
  if (values.some(v => v === null)) return null;
  const sum = values.reduce<number>((s, n) => s + n!, 0);
  return Number.isSafeInteger(sum) && sum >= 0 ? sum : null;
}

/**
 * A candidate is only a proposal for later review, never an instruction to write.
 * Every existing provider attempt remains held for independent reconciliation.
 */
export function classifyStudentNfcPreview(input: {
  evidence: ReconciliationEvidence; student: EvidenceRecord; term: EvidenceRecord;
  session: EvidenceRecord | undefined; schoolId: number; complete: boolean; today: string;
}): StudentNfcReconciliationRow {
  const { evidence: e, student: st, term, session, schoolId, complete, today } = input;
  const all = (name: string) => e[name] ?? [];
  const subject = (r: EvidenceRecord) => same(r.student_id, st.id);
  const inTerm = (r: EvidenceRecord) => same(r.academic_term_id ?? r.term_id, term.id);
  const inSchool = (r: EvidenceRecord) => same(r.school_id, schoolId);
  const bindings = all("student_subscription_terms").filter(r => subject(r) && inTerm(r));
  const boundIds = bindings.map(r => evidenceInteger(r.subscription_id)).filter((n): n is number => n !== null);
  const subscriptions = all("subscriptions").filter(r => boundIds.includes(Number(r.id)) ||
    (subject(r) && (same(r.allocation_snapshot?.termId, term.id) ||
      (r.term === term.name && day(r.expires_at) === nextDay(term.end_date)))));
  const subIds = unique(subscriptions.map(r => Number(r.id))).sort((a,b) => a-b);
  const relatedSub = (r: EvidenceRecord) => subIds.includes(Number(r.subscription_id));
  const payments = all("student_subscription_payments").filter(r => relatedSub(r) || (subject(r) && inTerm(r)));
  const orders = all("hosted_checkout_orders").filter(r => relatedSub(r) || (subject(r) && inTerm(r)));
  const intents = all("flutterwave_live_subscription_intents").filter(r => relatedSub(r) || (subject(r) && inTerm(r)));
  const boundInvoices = bindings.map(r => Number(r.legacy_invoice_id)).filter(n => n > 0);
  const schoolInvoices = all("fee_invoices").filter(r => (subject(r) && inTerm(r) &&
    all("fee_invoice_lines").some(l => same(l.invoice_id, r.id) && same(l.school_id,r.school_id) && nfc(l)
      && !(r.school_published_fee===true&&/^school\s+nfc\b/i.test(str(l.category_name_snapshot)))))
    || boundInvoices.includes(Number(r.id)));
  const invoiceIds = unique(schoolInvoices.map(r => Number(r.id))).sort((a,b) => a-b);
  const invoiceRelated = (r: EvidenceRecord) => invoiceIds.includes(Number(r.invoice_id));
  const feePayments = all("fee_payments").filter(invoiceRelated);
  const receipts = all("fee_receipts").filter(invoiceRelated);
  const orderRefs = orders.map(r => r.reference);
  const intentIds = intents.map(r => r.id);
  const payIds = payments.map(r => r.id);
  const feePayIds = feePayments.map(r => r.id);
  const refs = unique([...subscriptions.map(r => r.provider_reference), ...payments.map(r => r.reference),
    ...orders.map(r => r.reference), ...intents.map(r => r.reference ?? r.tx_ref),
    ...feePayments.flatMap(r => [r.reference, r.transfer_reference])].filter(v => typeof v === "string" && v.trim()));
  const related: ReconciliationEvidence = {};
  for (const [name, rows] of Object.entries(e)) {
    related[name] = rows.filter(r => relatedSub(r) || (subject(r) && inTerm(r)) || invoiceRelated(r) ||
      orderRefs.includes(r.order_reference) || intentIds.some(id => same(id,r.intent_id)) ||
      (name.startsWith("fee_") ? feePayIds : payIds).some(id => same(id,r.payment_id)) ||
      refs.includes(r.payment_reference) || refs.includes(r.reference));
  }
  const reasons: string[] = [];
  if (!complete) reasons.push("INCOMPLETE_EVIDENCE");
  if (!same(st.school_id, schoolId) || upper(st.status) !== "ACTIVE" || upper(st.admission_status) !== "ADMITTED")
    reasons.push("STUDENT_ENROLMENT_REQUIRES_REVIEW");
  if (!session || !same(term.school_id, schoolId) || !same(session.school_id,schoolId) ||
      !same(session.id,term.academic_session_id) || !["ACTIVE","PLANNED"].includes(upper(term.status)) ||
      !["ACTIVE","PLANNED"].includes(upper(session.status)) || !/^\d{4}-\d{2}-\d{2}$/.test(day(term.start_date)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day(term.end_date)) ||
      day(term.start_date) > day(term.end_date) || day(term.end_date) < today)
    reasons.push("TERM_OR_SESSION_REQUIRES_REVIEW");
  if (bindings.length > 1 || subscriptions.length > 1) reasons.push("DUPLICATE_OBLIGATIONS");
  if (bindings.some(r => !inSchool(r) || !same(r.academic_session_id,term.academic_session_id) ||
      (r.subscription_id != null && !subscriptions.some(s => same(s.id,r.subscription_id))) ||
      (r.subscription_id == null) === (r.legacy_invoice_id == null)) ||
      subscriptions.some(r => !inSchool(r) || !subject(r)))
    reasons.push("OBLIGATION_IDENTITY_MISMATCH");
  if (subscriptions.length && bindings.length !== 1) reasons.push("ACADEMIC_TERM_BINDING_REQUIRES_REVIEW");
  // A same-name unmatched historical subscription must not be mistaken for absence.
  if (all("subscriptions").some(r => subject(r) && r.term === term.name && !subIds.includes(Number(r.id)) &&
      !all("student_subscription_terms").some(b=>same(b.subscription_id,r.id) && same(b.student_id,st.id) &&
        same(b.school_id,r.school_id) && b.academic_term_id!=null && !same(b.academic_term_id,term.id))))
    reasons.push("UNRESOLVED_SAME_NAME_TERM_HISTORY");
  const amounts = subscriptions.map(r => subscriptionMinor(r.amount));
  if (amounts.some(a => a === null || a <= 0)) reasons.push("INVALID_SUBSCRIPTION_AMOUNT");
  if (amounts.some(a => a !== null && a !== 500000)) reasons.push("HISTORICAL_PRICE_OR_EXISTING_NEW_POLICY_REQUIRES_REVIEW");
  if (schoolInvoices.length) reasons.push("LEGACY_PARENT_NFC_FEE_REQUIRES_SEPARATE_REVIEW");
  if (schoolInvoices.some(i => !inSchool(i) || !subject(i) || !inTerm(i) ||
      !same(i.academic_session_id,term.academic_session_id))) reasons.push("SCHOOL_INVOICE_IDENTITY_MISMATCH");
  for (const i of schoolInvoices) {
    const total = evidenceInteger(i.total_minor), paid = evidenceInteger(i.paid_minor);
    const outstanding = evidenceInteger(i.outstanding_minor);
    const verified = safeSum(feePayments.filter(p => same(p.invoice_id,i.id) && upper(p.status)==="VERIFIED")
      .map(p => evidenceInteger(p.amount_minor)));
    if (total === null || paid === null || outstanding === null || total !== paid + outstanding || verified !== paid)
      reasons.push("SCHOOL_BALANCE_DOES_NOT_RECONCILE");
  }
  if (feePayments.some(p => upper(p.status)==="PENDING")) reasons.push("PENDING_PARENT_PAYMENT_CLAIM");
  if (payments.some(p => !inSchool(p) || !subject(p) || !inTerm(p) ||
      !same(p.academic_session_id,term.academic_session_id))) reasons.push("PAYMENT_IDENTITY_MISMATCH");
  if (payments.some(p => all("student_subscription_payments").filter(q =>
      p.reference && q.reference===p.reference).length > 1)) reasons.push("DUPLICATE_PAYMENT_REFERENCE");
  const paid = subscriptions.some(r => upper(r.verification_status)==="VERIFIED" && ["ACTIVE","WAIVED"].includes(upper(r.status))) ||
    payments.some(r => upper(r.status)==="PAID") ||
    (related.hosted_checkout_events ?? []).some(r => r.kind==="PAYMENT_VERIFIED") ||
    Object.entries(related).some(([name,rows]) => name.startsWith("flutterwave_live_") &&
      rows.some(r => ["PAYMENT_VERIFIED","COLLECTION_VERIFIED"].includes(upper(r.kind ?? r.event_type))));
  const history = payments.length || orders.length || intents.length ||
    subscriptions.some(r => r.provider_reference) ||
    Object.entries(related).some(([name,rows]) => rows.length &&
      (name.startsWith("flutterwave_live_") || name==="flutterwave_split_payments"));
  const adverse = Object.entries(related).some(([name,rows]) => rows.length &&
    (/refund|adjustment|adverse|dispute/i.test(name) || rows.some(r =>
      r.on_hold===true || /refund|disput|chargeback|(?:reconcil|adverse).*hold|review_required/i.test(
        `${r.kind ?? ""} ${r.status ?? ""} ${r.state ?? ""} ${r.event_type ?? ""}`))));
  if (adverse) reasons.push("REFUND_DISPUTE_OR_ADJUSTMENT_REQUIRES_REVIEW");
  if (history && !paid) reasons.push("PROVIDER_HISTORY_REQUIRES_INDEPENDENT_RECONCILIATION");
  if (!paid && (related.student_subscription_allocations ?? []).length) reasons.push("ALLOCATION_WITHOUT_RECONCILED_PAYMENT");
  if (!paid && subscriptions.some(r => !["PENDING","UNPAID","FAILED","CANCELLED"].includes(upper(r.status)) ||
      !["PENDING","UNVERIFIED","FAILED"].includes(upper(r.verification_status))))
    reasons.push("UNRESOLVED_SUBSCRIPTION_STATE");
  const blocking = unique(reasons);
  const status: StudentNfcReconciliationRow["status"] = blocking.length ? "OWNER_REVIEW"
    : paid ? "PRESERVE_COMPLETED_HISTORY" : subscriptions.length ? "CANDIDATE_AFTER_REVIEW" : "NEW_OBLIGATION_AFTER_REVIEW";
  if (paid) blocking.push("COMPLETED_HISTORY_MUST_REMAIN_UNCHANGED");
  if (!blocking.length) blocking.push("PREVIEW_ONLY_SEPARATE_APPROVAL_AND_FRESH_REVALIDATION_REQUIRED");
  const originalAmount = amounts.length===1 ? amounts[0] : null;
  return {
    studentId: Number(st.id), studentName: [st.first_name,st.last_name].filter(Boolean).join(" ") || "Student",
    admissionNo: str(st.admission_no ?? st.admission_number), status, reasons: blocking, subscriptionIds: subIds,
    originalAmountMinor: originalAmount,
    originalOutstandingMinor: status==="PRESERVE_COMPLETED_HISTORY" ? 0 : status==="CANDIDATE_AFTER_REVIEW" ? originalAmount : null,
    proposedPlatformAmountMinor: ["CANDIDATE_AFTER_REVIEW","NEW_OBLIGATION_AFTER_REVIEW"].includes(status) ? RECONCILED_STUDENT_PRICE_MINOR : null,
    invoiceIds, schoolFeeTotalMinor: schoolInvoices.length ? safeSum(schoolInvoices.map(r=>evidenceInteger(r.total_minor))) : null,
    schoolFeePaidMinor: schoolInvoices.length ? safeSum(schoolInvoices.map(r=>evidenceInteger(r.paid_minor))) : null,
    schoolFeeOutstandingMinor: schoolInvoices.length ? safeSum(schoolInvoices.map(r=>evidenceInteger(r.outstanding_minor))) : null,
    paymentReferences: refs.sort(), receiptNumbers: unique(receipts.map(r=>str(r.receipt_number)).filter(Boolean)).sort(),
    evidenceDigest: reconciliationDigest({ version:RECONCILIATION_REPORT_VERSION, today,
      student: st, term, session, bindings, subscriptions, related, complete }),
  };
}
