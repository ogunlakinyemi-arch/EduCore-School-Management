/**
 * Existing records were declared TEST-only before first-school launch.
 * This floor must never move backwards. No records or credentials are changed.
 */
export const NOTIFICATION_TEST_DATA_FLOOR = "2026-10-23T12:34:38.000Z";

export function productionNotificationRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production" || !!env.REPLIT_DEPLOYMENT;
}

/**
 * Explicit, non-secret launch configuration. Missing/malformed/backdated/future
 * settings hold external delivery. Development mocks retain existing behavior.
 */
export function notificationLaunchBoundary(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): { allowed: boolean; liveFrom: string | null } {
  if (!productionNotificationRuntime(env)) return { allowed: true, liveFrom: null };
  const value = env.EDUCORE_NOTIFICATION_LIVE_FROM;
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return { allowed: false, liveFrom: null };
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value
    || time < Date.parse(NOTIFICATION_TEST_DATA_FLOOR) || time > now.getTime()) {
    return { allowed: false, liveFrom: null };
  }
  return { allowed: true, liveFrom: value };
}

/** Fixed SQL identifiers only; the cutoff is always a bound parameter. */
export function notificationLaunchSql(parameter: "$2" | "$4" | "$6"): string {
  return `(${parameter}::timestamptz IS NULL OR (
    d.created_at >= ${parameter}::timestamptz
    AND EXISTS (
      SELECT 1 FROM communication_notifications launch_n
      JOIN app_users launch_u ON launch_u.id = launch_n.recipient_user_id
      LEFT JOIN schools launch_s ON launch_s.id = launch_n.school_id
      WHERE launch_n.id = d.notification_id
        AND launch_n.created_at >= ${parameter}::timestamptz
        AND launch_u.created_at >= ${parameter}::timestamptz
        AND (launch_n.school_id IS NULL OR launch_s.created_at >= ${parameter}::timestamptz)
    )
  ))`;
}
