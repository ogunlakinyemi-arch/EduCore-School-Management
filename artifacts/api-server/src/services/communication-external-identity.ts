import type { CommunicationDispatchPool } from "./communication-service";
/** Keep both child inbox contexts, but send a campaign once per recipient/channel. */
export async function duplicateCampaignDelivery(pool: CommunicationDispatchPool, record: {
  id: number | string; eventKey: string | null; channel: string; schoolId: number | string | null; recipientUserId: number | string;
}): Promise<boolean> {
  const base = record.eventKey?.match(/^COMMUNICATION_CAMPAIGN:\d+:\d+/)?.[0];
  if (!base) return false;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${record.schoolId}:${record.recipientUserId}:${base}:${record.channel}`]);
    const canonical = await c.query<{ id: number | string }>(`SELECT d.id FROM communication_deliveries d
      JOIN communication_notifications n ON n.id=d.notification_id
      WHERE n.school_id IS NOT DISTINCT FROM $1::integer AND n.recipient_user_id=$2 AND d.channel=$3
      AND (n.event_key=$4 OR n.event_key LIKE $4||':STUDENT:%')
      AND d.status <> 'CANCELLED' ORDER BY d.id LIMIT 1`,
      [record.schoolId, record.recipientUserId, record.channel, base]);
    const duplicate = canonical.rows[0] && String(canonical.rows[0].id) !== String(record.id);
    if (duplicate) await c.query(`UPDATE communication_deliveries SET status='CANCELLED',
      error_code='DUPLICATE_CHILD_CONTEXT',last_error='External delivery is tracked on another child context of this campaign.',
      updated_at=NOW() WHERE id=$1 AND status='PROCESSING'`, [record.id]);
    await c.query("COMMIT"); return Boolean(duplicate);
  } catch (error) { await c.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { c.release(); }
}