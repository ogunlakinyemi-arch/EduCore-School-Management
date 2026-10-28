type Sql = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };

/** Dashboard and Owner use the same ledger projection. New independent ₦150
 * entitlements remain pending approval: never manufacture PAYABLE legacy rows. */
export async function broLedgerBalances(c: Sql, partnerId: number) {
  const row = (await c.query(`SELECT
    COALESCE(sum(amount) FILTER(WHERE status NOT IN ('REVERSED','CANCELLED')),0)::float AS accrued,
    COALESCE(sum(amount) FILTER(WHERE status='PAID'),0)::float AS paid,
    COALESCE(sum(amount) FILTER(WHERE status='PAYABLE' AND payout_id IS NULL
      AND (to_jsonb(l)->>'payment_id') IS NULL AND currency='NGN' AND amount>0),0)::float AS payable,
    COALESCE(sum(amount) FILTER(WHERE status<>'PAID' AND status NOT IN ('REVERSED','CANCELLED')
      AND payout_id IS NOT NULL),0)::float AS reserved,
    COALESCE(sum(amount) FILTER(WHERE status IN ('PENDING','APPROVED','HELD') AND payout_id IS NULL),0)::float AS pending
    FROM commission_ledger l WHERE partner_profile_id=$1`, [partnerId])).rows[0];
  let independent = 0;
  if ((await c.query("SELECT to_regclass('bro_term_commission_entitlements') IS NOT NULL AS present")).rows[0]?.present) {
    independent = Number((await c.query(`SELECT COALESCE(sum(amount_minor),0)::bigint AS pending
      FROM bro_term_commission_entitlements WHERE partner_profile_id=$1 AND status='PENDING_OWNER_APPROVAL'`,
      [partnerId])).rows[0]?.pending ?? 0) / 100;
  }
  const accrued = Number(row.accrued) + independent, paid = Number(row.paid);
  return { accruedCommission: accrued, paidCommission: paid, outstandingCommission: accrued - paid,
    payableCommission: Number(row.payable), reservedCommission: Number(row.reserved),
    pendingApprovalCommission: Number(row.pending) + independent };
}
