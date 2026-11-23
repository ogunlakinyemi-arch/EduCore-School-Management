type Client = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };

/**
 * Called only after the financial gate. Include every member of an existing
 * grouped payout, not just the commission that prompted revalidation.
 * Discovery is non-authoritative: callers reread eligibility after all locks.
 */
export async function lockDeferredCommissionEvidence(client: Client, ids: number[]) {
  const found = await client.query(`SELECT l.id,l.payment_id,l.partner_profile_id,
      p.subscription_id,p.academic_term_id,p.academic_session_id
    FROM commission_ledger l LEFT JOIN student_subscription_payments p ON p.id=l.payment_id
    WHERE l.id=ANY($1::int[]) OR l.payout_id IN
      (SELECT payout_id FROM commission_ledger WHERE id=ANY($1::int[]) AND payout_id IS NOT NULL)`, [ids]);
  const values = (key: string) => [...new Set(found.rows.map(row => row[key]).filter(value => value != null))]
    .sort((a, b) => a - b);
  // Explicit separate statements avoid planner-dependent multi-table row locking.
  for (const [table, column, key, mode] of [
    ["student_subscription_payments", "id", "payment_id", "UPDATE"],
    ["flutterwave_split_payments", "payment_id", "payment_id", "UPDATE"],
    ["subscriptions", "id", "subscription_id", "SHARE"],
    ["academic_sessions", "id", "academic_session_id", "SHARE"],
    ["academic_terms", "id", "academic_term_id", "SHARE"],
    ["partner_profiles", "id", "partner_profile_id", "SHARE"],
    ["commission_ledger", "id", "id", "UPDATE"],
  ]) {
    await client.query(`SELECT ${column} FROM ${table} WHERE ${column}=ANY($1::int[])
      ORDER BY ${column} FOR ${mode}`, [values(key)]);
  }
}
