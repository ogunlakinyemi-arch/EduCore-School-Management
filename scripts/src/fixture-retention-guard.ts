import { createHash } from "node:crypto";

/** Offline CLI only. Never imported by application routes or migrations. */
export const immutableGuards = [
  ["promotion_history", "promotion_history_immutable", "prevent_promotion_history_mutation",
    "promotion history is append-only"],
  ["security_events", "security_events_immutable", "prevent_security_event_mutation",
    "security events are immutable"],
  ["school_security_operation_history", "school_security_operation_history_immutable",
    "prevent_school_security_operation_history_mutation", "school security operation history is append-only"],
] as const;

type Guard = {
  table_name: string; trigger_name: string; enabled: string; definition: string;
  function_name: string; function_schema: string; function_source: string;
  trigger_type: number; argument_count: number; security_definer: boolean;
};

export function validateRetentionGuards(rows: Guard[]) {
  if (rows.length !== immutableGuards.length) throw new Error("Unexpected or missing retention trigger.");
  for (const [table, trigger, fn, message] of immutableGuards) {
    const row = rows.find(r => r.table_name === table && r.trigger_name === trigger);
    const source = `BEGIN RAISE EXCEPTION '${message}'; END;`;
    if (!row || row.enabled !== "O" || Number(row.trigger_type) !== 27 ||
        Number(row.argument_count) !== 0 || row.function_name !== fn ||
        row.function_schema !== "public" || row.security_definer ||
        /\bWHEN\b|\bUPDATE OF\b/i.test(row.definition) ||
        row.function_source.trim().replace(/\s+/g, " ") !== source) {
      throw new Error("Altered or unrecognized immutable-history protection.");
    }
  }
}

export const originalRowExpression = (table: string) => table === "communication_notifications"
  ? "to_jsonb(t)-'archived_at'"
  : table === "communication_campaigns"
    ? "to_jsonb(t)-ARRAY['is_emergency','expires_at']::text[]"
    : "to_jsonb(t)";

type Query = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
type Preserved = Record<string, { columns: string[]; hashes: Record<string, number>; count: number }>;
const identifier = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Unsafe fixture identifier.");
  return `"${name}"`;
};

export async function captureOriginalRows(client: Query, tables: string[]): Promise<Preserved> {
  const result: Preserved = {};
  for (const table of tables) {
    const columns = (await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
      [table],
    )).rows.map(r => String(r.column_name)).filter(name =>
      !(table === "communication_notifications" && name === "archived_at") &&
      !(table === "communication_campaigns" && ["is_emergency", "expires_at"].includes(name)));
    const rows = (await client.query(`SELECT md5((${originalRowExpression(table)})::text) AS hash,
      count(*)::int AS count FROM public.${identifier(table)} t GROUP BY hash`)).rows;
    result[table] = {
      columns, hashes: Object.fromEntries(rows.map(r => [String(r.hash), Number(r.count)])),
      count: rows.reduce((n, r) => n + Number(r.count), 0),
    };
  }
  return result;
}

/** Additional QA/audit rows are allowed; every original row and column must survive. */
export async function verifyOriginalRows(client: Query, baseline: Preserved) {
  const current = await captureOriginalRows(client, Object.keys(baseline));
  let rows = 0; let columns = 0;
  for (const [table, expected] of Object.entries(baseline)) {
    const actual = current[table];
    if (expected.columns.some(c => !actual.columns.includes(c)) ||
        Object.entries(expected.hashes).some(([h, n]) => (actual.hashes[h] ?? 0) < n)) {
      throw new Error("An original business row or column changed; transaction refused.");
    }
    rows += expected.count;
    columns += expected.columns.length;
  }
  return { tables: Object.keys(baseline).length, originalRows: rows,
    originalColumns: columns, changed: 0, missing: 0 };
}

export const preservationDigest = (snapshot: Preserved) =>
  createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");

/** Logical retirement, not an exception to immutable history. Caller owns transaction. */
export async function retireFixture(client: Query, schoolId: number, label: string, users: {
  appUserId: number; clerkUserId: string; email: string;
}[]) {
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0 ||
      !/^EDUCORE-EXPANSION-TEST-[A-F0-9]{16}$/.test(label) || users.length !== 7 ||
      new Set(users.map(u => u.appUserId)).size !== users.length) {
    throw new Error("Incomplete fixture ownership; retirement refused.");
  }
  const school = (await client.query(
    "SELECT id FROM public.schools WHERE id=$1 AND code=$2 AND name=$2 FOR UPDATE",
    [schoolId, label],
  )).rows;
  if (school.length !== 1) throw new Error("Unowned school; retirement refused.");
  for (const user of users) {
    const owned = (await client.query(
      "SELECT id FROM public.app_users WHERE id=$1 AND clerk_user_id=$2 AND lower(email)=lower($3) FOR UPDATE",
      [user.appUserId, user.clerkUserId, user.email],
    )).rows;
    if (owned.length !== 1 || !user.email.endsWith(`-${label.slice("EDUCORE-EXPANSION-TEST-".length).toLowerCase()}@example.com`)) {
      throw new Error("Unowned identity; retirement refused.");
    }
  }
  await client.query("UPDATE public.schools SET status='INACTIVE' WHERE id=$1", [schoolId]);
  await client.query("UPDATE public.app_users SET status='INACTIVE' WHERE id=ANY($1::int[])",
    [users.map(u => u.appUserId)]);
  await client.query("UPDATE public.school_memberships SET status='INACTIVE' WHERE school_id=$1", [schoolId]);
  await client.query("UPDATE public.platform_devices SET status='INACTIVE' WHERE school_id=$1", [schoolId]);
  await client.query("UPDATE public.device_credentials SET status='REVOKED' WHERE school_id=$1", [schoolId]);
  await client.query("UPDATE public.students SET status='inactive' WHERE school_id=$1", [schoolId]);
  await client.query("UPDATE public.parents SET status='INACTIVE' WHERE school_id=$1", [schoolId]);
  await client.query("UPDATE public.employees SET employment_status='INACTIVE' WHERE school_id=$1", [schoolId]);
  await client.query("UPDATE public.nfc_cards SET status='lost',deactivated_at=COALESCE(deactivated_at,NOW()) WHERE school_id=$1 AND status='active'", [schoolId]);
  // Derived, mutable presence is removable; events and all audit/history rows stay.
  await client.query("DELETE FROM public.campus_presence WHERE school_id=$1", [schoolId]);
}