import { AuthError } from "../middlewares/auth";
import { isSystemNfcCategory } from "../lib/student-nfc-policy";

export async function feeLineBalances(client: any, invoice: any) {
  const rows = await client.query(`SELECT l.id,l.category_name_snapshot AS name,l.amount_minor AS "amountMinor",
    COALESCE(sum(a.amount_minor) FILTER(WHERE p.status='VERIFIED'),0)::int AS "paidMinor"
    FROM fee_invoice_lines l LEFT JOIN fee_payment_line_allocations a
      ON a.line_id=l.id AND a.invoice_id=l.invoice_id AND a.school_id=l.school_id
    LEFT JOIN fee_payments p ON p.id=a.payment_id AND p.school_id=a.school_id
    WHERE l.invoice_id=$1 AND l.school_id=$2 GROUP BY l.id ORDER BY l.id`,[invoice.id,invoice.school_id]);
  const allocated = rows.rows.reduce((sum: number,r: any)=>sum+Number(r.paidMinor),0);
  const selectable = Number(invoice.discount_minor)===0 && Number(invoice.waiver_minor)===0 && allocated===Number(invoice.paid_minor)
    && rows.rows.reduce((sum: number,r: any)=>sum+Number(r.amountMinor),0)===Number(invoice.subtotal_minor);
  return {invoiceId:invoice.id,selectable,reason:selectable ? null : "This invoice has unallocated historical payments or adjustments. Pay its remaining invoice balance; individual line allocation requires finance review.",
    lines:rows.rows.map((r: any)=>({...r,outstandingMinor:["PAID","WAIVED","CANCELLED"].includes(invoice.status) ? 0 : Math.max(0,r.amountMinor-r.paidMinor)}))};
}

export async function selectedFeeAmount(client: any, invoice: any, raw: unknown, existingPayment=false) {
  if(raw===undefined || raw===null) {
    if(existingPayment)return null;
    const legacy=await client.query(`SELECT 1 FROM fee_invoice_lines l WHERE l.invoice_id=$1 AND l.school_id=$2
      AND (l.category_name_snapshot ~* '(nfc.*subscription|subscription.*nfc)' OR l.description_snapshot ~* '(nfc.*subscription|subscription.*nfc)')
      AND l.amount_minor>COALESCE((SELECT sum(a.amount_minor) FROM fee_payment_line_allocations a JOIN fee_payments p
        ON p.id=a.payment_id AND p.school_id=a.school_id WHERE a.line_id=l.id AND a.school_id=l.school_id AND p.status='VERIFIED'),0)
      LIMIT 1`,[invoice.id,invoice.school_id]);
    if(!existingPayment && legacy.rows.length) throw new AuthError(409,"A legacy school NFC charge requires Owner reconciliation. Select ordinary fee lines only; NFC subscriptions use Platform Owner Flutterwave.");
    return null;
  }
  if(!Array.isArray(raw)||!raw.length||raw.length>1000||raw.some(v=>!Number.isSafeInteger(v)||v<1)||new Set(raw).size!==raw.length) {
    throw new AuthError(400,"Select distinct valid fee line IDs");
  }
  const balances=await feeLineBalances(client,invoice);
  if(!balances.selectable) throw new AuthError(409,balances.reason!);
  const selected=balances.lines.filter((line: any)=>raw.includes(line.id)&&line.outstandingMinor>0);
  if(selected.length!==raw.length) throw new AuthError(409,"A selected fee is paid, unavailable, or belongs to another invoice");
  if(!existingPayment && selected.some((line:any)=>isSystemNfcCategory(line.name??""))) {
    throw new AuthError(403,"NFC subscriptions use Platform Owner Flutterwave, not the school's payment account");
  }
  return selected.reduce((sum: number,line: any)=>sum+line.outstandingMinor,0);
}