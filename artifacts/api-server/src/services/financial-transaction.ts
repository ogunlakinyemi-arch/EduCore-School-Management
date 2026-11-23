/**
 * One transaction-scoped gate for the participating financial writers.
 * Acquire immediately after BEGIN, before advisory locks, row locks or writes.
 * Provider I/O must remain outside this transaction. This is deliberately global:
 * approval batches span schools/payments, so a per-payment gate is insufficient.
 * It does not protect against privileged SQL or writers outside this boundary.
 */
export const FINANCIAL_TRANSACTION_GATE_SQL =
  "SELECT pg_advisory_xact_lock(1946482034, 1)";

type Client = { query: (sql: string, values?: any[]) => Promise<any> };

export async function beginFinancialTransaction(client: Client) {
  await client.query("BEGIN");
  await client.query(FINANCIAL_TRANSACTION_GATE_SQL);
}

/** Result/recovery writes need the gate too, not just the initiating transaction. */
export async function financialTransaction<T>(
  pool: { connect: () => Promise<Client & { release: () => void }> },
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await beginFinancialTransaction(client);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** No fallback allocation writer: absence of the database contract must be loud. */
export async function requireFeeAllocationTrigger(client: Client) {
  const result = await client.query(`SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND c.relname='fee_payments'
      AND t.tgname='fee_payment_allocate_lines' AND NOT t.tgisinternal
      AND t.tgenabled='O' AND t.tgtype=21 AND t.tgqual IS NULL
      AND t.tgattr::text='' AND t.tgnargs=0 AND t.tgconstraint=0
      AND pn.nspname='public' AND p.proname='allocate_verified_fee_lines'
      AND p.pronargs=0 AND NOT p.prosecdef
  ) AS ready`);
  if (result.rows[0]?.ready !== true) {
    throw new Error("Fee allocation database protection is unavailable; payment verification blocked");
  }
}
