type Db = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };

/**
 * Catalog-only inspection: no app rows, credentials, provider calls or DDL.
 * A table's presence alone does not establish its usable column contract.
 */
export async function inspectTelegramStorage(db: Db): Promise<{ ready: boolean; missing: string[] }> {
  const result = await db.query(`WITH required_columns(table_name, columns) AS (VALUES
    ('parent_telegram_links', ARRAY['parent_id','bot_id','chat_ciphertext','chat_hash','consented_at','revoked_at','updated_at']),
    ('telegram_link_challenges', ARRAY['id','parent_id','school_id','bot_id','token_hash','pending_ciphertext','chat_hash','created_at','expires_at','claimed_at','confirmed_at','revoked_at']),
    ('telegram_poll_state', ARRAY['id','bot_id','last_update_id'])
  ), required_channels(table_name) AS (VALUES
    ('communication_deliveries'), ('communication_preferences'), ('communication_templates')
  ), missing AS (
    SELECT 'table:' || table_name AS item FROM required_columns WHERE to_regclass(table_name) IS NULL
    UNION ALL
    SELECT 'column:' || table_name || '.' || column_name
      FROM required_columns CROSS JOIN LATERAL unnest(columns) AS column_name
      WHERE to_regclass(table_name) IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass(table_name) AND attname = column_name AND NOT attisdropped AND attnum > 0)
    UNION ALL
    SELECT 'channel_check:' || table_name FROM required_channels
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass(table_name)
          AND c.conname IN (table_name || '_channel_check', table_name || '_telegram_channel_check')
          AND c.contype = 'c' AND c.convalidated
          AND pg_get_constraintdef(c.oid) LIKE '%''TELEGRAM''%')
  ) SELECT item FROM missing ORDER BY item`);
  const missing = result.rows.map(row => String(row.item));
  return { ready: missing.length === 0, missing };
}
