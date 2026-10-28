import { openBroPayoutBank, maskedBroBank } from "./bro-bank-verification";
import { AuthError } from "../middlewares/auth";
type Sql = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };
export const BRO_MANUAL_POLICY = "BRO_MANUAL_LEDGER_V1";
export async function payoutBankSnapshot(c: Sql, payoutId: number) {
  const record = (await c.query(`SELECT metadata FROM audit_logs WHERE module='Payouts'
    AND record_id=$1 AND action='Created partner payout' AND metadata->>'policy'=$2
    ORDER BY id DESC LIMIT 1`, [payoutId, BRO_MANUAL_POLICY])).rows[0];
  if (!record?.metadata?.bankSnapshot) return null;
  const bank = openBroPayoutBank(record.metadata.bankSnapshot);
  if (bank.payoutId !== payoutId || bank.verified !== true) throw new AuthError(409, "Payout bank evidence is invalid.");
  return { bank, partnerName: record.metadata.partnerName };
}
export async function enrichBroPayout(c: Sql, row: any) {
  const snapshot = await payoutBankSnapshot(c, row.id);
  const paid = (await c.query(`SELECT actor_user_id FROM audit_logs WHERE module='Payouts' AND record_id=$1
    AND action='Updated partner payout to PAID' ORDER BY id DESC LIMIT 1`, [row.id])).rows[0];
  return { ...row, partnerName: snapshot?.partnerName ?? null,
    bankDetailsAvailable: !!snapshot, bankDetails: snapshot ? maskedBroBank(snapshot.bank) : null,
    paidBy: paid?.actor_user_id ?? null };
}
