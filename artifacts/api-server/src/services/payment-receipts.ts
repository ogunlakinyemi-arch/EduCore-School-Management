import type { UserContext } from "../middlewares/auth";
import type { StudentSubscriptionSqlClient } from "../lib/student-subscription-billing";
import { HostedPaymentError } from "../lib/hosted-manual-policy";
import { hostedOrderView, loadHostedOrder } from "./hosted-payment-store";

export const receiptDownloadPath = (id: string) => `/api/payment-receipts/${id}/download`;
export const receiptDate = (date: unknown) => date instanceof Date ? date.toISOString().slice(0,10) : String(date).slice(0,10);
export const receiptOwner = (ctx: UserContext) => ctx.roles.some(r => r.role === "PLATFORM_OWNER" && r.schoolId === null && r.status === "ACTIVE");
export async function auditReceipt(c: StudentSubscriptionSqlClient, ctx: UserContext,
  row: Record<string, any>, action: string, extra: Record<string, unknown> = {}) {
  await c.query(`INSERT INTO audit_logs ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,severity,event_type,result,metadata)
    VALUES ($1,$2,$3,$4,$5,$6,'Finance',$7,'info','PAYMENT_RECEIPT_EVENT','SUCCESS',$8::jsonb)`,
  [ctx.user.email, receiptOwner(ctx) ? "PLATFORM_OWNER" : ctx.roles.find(r=>r.schoolId===Number(row.school_id)&&r.status==="ACTIVE")?.role ?? "PARENT",
    ctx.user.id,ctx.user.clerkUserId,row.school_id,action,row.student_id ?? null,
    JSON.stringify({ receiptId: row.id, kind: row.kind, targetId: row.target_id, ...extra })]);
}
export async function requireReceiptAccess(c: StudentSubscriptionSqlClient, ctx: UserContext, row: Record<string, any>) {
  if (row.kind === "SCHOOL_SETTLEMENT") {
    if (!receiptOwner(ctx)) throw new HostedPaymentError(404,"NOT_FOUND","Receipt not found.");
    return;
  }
  // Owner authority does not grant school finance/parent operational rights.
  if (!receiptOwner(ctx) && ctx.roles.some(r => r.status==="ACTIVE" && r.schoolId===Number(row.school_id)
    && ["SCHOOL_ADMIN","ACCOUNTANT"].includes(r.role))) return;
  if (receiptOwner(ctx) || Number(row.uploaded_by) !== ctx.user.id) throw new HostedPaymentError(404,"NOT_FOUND","Receipt not found.");
  const linked = await c.query(`SELECT 1 FROM parents p JOIN parent_student_relationships r ON r.parent_id=p.id
    WHERE p.user_id=$1 AND p.school_id=$2 AND p.status='ACTIVE' AND r.student_id=$3 AND r.status='ACTIVE'`,
  [ctx.user.id,row.school_id,row.student_id]);
  if (!linked.rows.length) throw new HostedPaymentError(404,"NOT_FOUND","Receipt not found.");
}
export async function receiptTarget(c: StudentSubscriptionSqlClient, ctx: UserContext, input: {
  kind: "PARENT_BANK_TRANSFER" | "SCHOOL_SETTLEMENT"; invoiceId?: number; orderReference?: string;
  amountMinor: number; transferCompleted?: boolean; transferDate?: string;
}) {
  if (input.kind === "SCHOOL_SETTLEMENT") {
    if (!receiptOwner(ctx) || !input.orderReference || !input.transferCompleted) throw new HostedPaymentError(403,"OWNER_CONFIRMATION_REQUIRED","The Owner must confirm an already completed school transfer.");
    const o = await loadHostedOrder(c,input.orderReference,true), v = await hostedOrderView(c,o);
    if ((v.status!=="PAID"&&!v.schoolPayoutSucceeded) || (v.hold&&!v.schoolPayoutSucceeded) ||
      (v.schoolSettled&&!v.schoolPayoutSucceeded) || v.settlementReceiptId ||
      (v.schoolPayoutClaimed&&!v.schoolPayoutSucceeded) || input.amountMinor!==v.schoolDueMinor)
      throw new HostedPaymentError(409,"SETTLEMENT_RECEIPT_BLOCKED","Attach proof for an unreserved manual settlement or an independently verified successful provider transfer only.");
    const paid=await c.query(`SELECT created_at FROM hosted_checkout_events WHERE order_reference=$1 AND kind='PAYMENT_VERIFIED'`,[o.reference]);
    const paidDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos"}).format(new Date(paid.rows[0].created_at));
    if(!input.transferDate || input.transferDate<paidDate) throw new HostedPaymentError(400,"INVALID_SETTLEMENT_DATE","A school settlement cannot predate verified collection.");
    return { targetId:o.reference,schoolId:Number(o.school_id),studentId:Number(o.student_id),termId:Number(o.term_id) };
  }
  if (receiptOwner(ctx) || !input.invoiceId || !ctx.roles.some(r=>r.role==="PARENT"&&r.status==="ACTIVE")) throw new HostedPaymentError(403,"PARENT_REQUIRED","An authorized parent or guardian is required.");
  const r = await c.query(`SELECT i.* FROM fee_invoices i JOIN parents p ON p.school_id=i.school_id AND p.status='ACTIVE'
    JOIN parent_student_relationships rel ON rel.parent_id=p.id AND rel.student_id=i.student_id AND rel.status='ACTIVE'
    WHERE i.id=$1 AND p.user_id=$2 FOR SHARE OF i`,[input.invoiceId,ctx.user.id]);
  const i = r.rows[0];
  if (!i) throw new HostedPaymentError(404,"NOT_FOUND","Invoice not found.");
  if (!Number.isSafeInteger(Number(i.academic_term_id)) || Number(i.academic_term_id)<1) {
    throw new HostedPaymentError(409,"INVOICE_TERM_REQUIRED","The invoice needs an authoritative school term before uploading evidence.");
  }
  if (["PAID","CANCELLED","WAIVED"].includes(i.status) || input.amountMinor>Number(i.outstanding_minor)) throw new HostedPaymentError(409,"INVOICE_NOT_PAYABLE","Receipt amount must fit an outstanding invoice.");
  return {targetId:String(i.id),schoolId:Number(i.school_id),studentId:Number(i.student_id),termId:Number(i.academic_term_id)};
}
export async function requireParentReceipt(c: StudentSubscriptionSqlClient, ctx: UserContext,
  id: string, invoiceId: number, amountMinor: number, transferDate: string) {
  const r = await c.query(`SELECT * FROM payment_receipt_uploads WHERE id=$1 AND state='AVAILABLE' FOR SHARE`,[id]);
  const row = r.rows[0];
  if (!row || row.kind!=="PARENT_BANK_TRANSFER" || row.target_id!==String(invoiceId) ||
    Number(row.uploaded_by)!==ctx.user.id || Number(row.amount_minor)!==amountMinor ||
    receiptDate(row.transfer_date)!==transferDate) throw new HostedPaymentError(400,"RECEIPT_SCOPE_MISMATCH","Upload a receipt for this invoice, amount and transfer date.");
  await requireReceiptAccess(c,ctx,row);
  return row;
}
