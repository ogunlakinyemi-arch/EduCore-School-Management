type Client = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };
type Identity = { paymentId: number; schoolId: number } | { reference: string; provider: string };

/** Financial gate first; discover without locks, then invoice -> payment -> checkout. */
export async function lockFeePaymentRows(client: Client, identity: Identity) {
  const byId = "paymentId" in identity;
  const found = await client.query(`/* fee-payment-lock-order */
    SELECT id,invoice_id,school_id FROM fee_payments WHERE ${byId
      ? "id=$1 AND school_id=$2" : "reference=$1 AND provider=$2"}`,
    byId ? [identity.paymentId, identity.schoolId] : [identity.reference, identity.provider]);
  for (const row of found.rows) {
    await client.query(`/* fee-payment-lock-order */
      SELECT id FROM fee_invoices WHERE id=$1 AND school_id=$2 FOR UPDATE`, [row.invoice_id, row.school_id]);
    await client.query(`/* fee-payment-lock-order */
      SELECT id FROM fee_payments WHERE id=$1 AND school_id=$2 AND invoice_id=$3 FOR UPDATE`,
      [row.id, row.school_id, row.invoice_id]);
    await client.query(`/* fee-payment-lock-order */
      SELECT id FROM fee_provider_checkout_sessions WHERE payment_id=$1 AND school_id=$2
      ORDER BY id FOR UPDATE`, [row.id, row.school_id]);
  }
  // Callers re-read and validate their complete joined identity after acquiring locks.
}
