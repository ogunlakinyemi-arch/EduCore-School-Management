import { isDeepStrictEqual } from "node:util";
import type { StudentSubscriptionSqlClient } from "../lib/student-subscription-billing";
import { LiveOnboardingBlocked } from "../lib/flutterwave-live-onboarding-provider";

type Row = Record<string, any>;
const frozen = ["id", "environment", "merchant_scope", "school_id", "profile_id",
  "snapshot_sha256", "snapshot_ciphertext", "encryption_key_version", "bank_fingerprint",
  "account_last4", "submitted_by", "created_at"];
const statuses = ["SUBMITTED", "BANK_VERIFIED", "ACTION_REQUIRED", "STALE", "REJECTED",
  "CREATING", "CREATION_UNKNOWN", "LIVE_VERIFIED"];
function refuse(code: string): never { throw new LiveOnboardingBlocked(code); }
function same(a: Row, b: Row, keys: string[]) {
  return keys.every(key => isDeepStrictEqual(a[key], b[key]));
}

/** Mirrors the original onboarding history function for the application path.
 * This does NOT prevent mutations by writers outside this boundary. */
export function assertLiveOnboardingTransition(before: Row | null, after: Row): void {
  if (after.environment !== "LIVE" || !statuses.includes(after.status)) {
    refuse("LIVE_ONBOARDING_TRANSITION_INVALID");
  }
  if (after.creation_claimed_at == null
      ? ["CREATING", "CREATION_UNKNOWN", "LIVE_VERIFIED"].includes(after.status)
      : after.approved_by == null || after.approval_evidence == null) {
    refuse("LIVE_ONBOARDING_CLAIM_REQUIRED");
  }
  if (after.status === "LIVE_VERIFIED"
    && (after.provider_id == null || after.provider_subaccount_id == null)) {
    refuse("LIVE_ONBOARDING_PROVIDER_IDENTITY_REQUIRED");
  }
  if (!before) {
    if (after.status !== "SUBMITTED" || after.creation_claimed_at != null
      || after.provider_id != null || after.provider_subaccount_id != null) {
      refuse("LIVE_ONBOARDING_INITIAL_STATE_INVALID");
    }
    return;
  }
  if (!same(before, after, frozen)) refuse("LIVE_ONBOARDING_SNAPSHOT_IMMUTABLE");
  if (before.creation_claimed_at != null
    && !same(before, after, ["creation_claimed_at", "approved_by", "approval_evidence"])) {
    refuse("LIVE_ONBOARDING_CLAIM_IMMUTABLE");
  }
  if (["provider_id", "provider_subaccount_id"].some(key =>
    before[key] != null && !isDeepStrictEqual(before[key], after[key]))) {
    refuse("LIVE_ONBOARDING_PROVIDER_IDENTITY_IMMUTABLE");
  }
  if ((["CREATING", "CREATION_UNKNOWN"].includes(before.status)
      && !["CREATING", "CREATION_UNKNOWN", "LIVE_VERIFIED"].includes(after.status))
    || (["LIVE_VERIFIED", "STALE", "REJECTED"].includes(before.status)
      && before.status !== after.status)) {
    refuse("LIVE_ONBOARDING_TRANSITION_INVALID");
  }
}

const auditFields = ["onboarding_id", "school_id", "merchant_scope", "previous_status",
  "status", "approved_by", "actor_id", "provider_id", "provider_subaccount_id",
  "error_code", "provider_http_status"];

/** Internal, trusted-SQL-only mutation boundary. Never accepts SQL from an API.
 * Caller mode REQUIRES an existing transaction on this exact pinned client;
 * its caller must roll back on ANY error. Own mode wraps a single mutation.
 * Existing triggers stay enabled: use their audit, or append the same audit if
 * absent. Exactly one matching audit must exist before commit.
 * No provider calls, connection acquisition, DDL, history UPDATE/DELETE or retries.
 */
export async function mutateLiveOnboarding(
  db: StudentSubscriptionSqlClient,
  input: { transaction: "own" | "caller"; merchantScope: string; id?: number;
    sql: string; values: unknown[] },
): Promise<Row | undefined> {
  const owns = input.transaction === "own";
  const sql = input.sql.trim();
  const verb = input.id === undefined
    ? /^INSERT\s+INTO\s+flutterwave_live_school_onboarding\s*\(/i
    : /^UPDATE\s+flutterwave_live_school_onboarding\s+SET\b/i;
  // A missing RETURNING could otherwise commit a changed row with no audit.
  // This is a narrow accidental-misuse guard, not a parser/security sandbox.
  if (!verb.test(sql) || !/\bRETURNING\s+\*\s*$/i.test(sql) || sql.includes(";")) {
    refuse("LIVE_ONBOARDING_MUTATION_SHAPE_INVALID");
  }
  try {
    if (owns) {
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout='2s'");
      await db.query("SET LOCAL statement_timeout='3s'");
    }
    const before = input.id === undefined ? null : (await db.query(
      `SELECT * FROM flutterwave_live_school_onboarding
         WHERE id=$1 AND merchant_scope=$2 AND environment='LIVE' FOR UPDATE`,
      [input.id, input.merchantScope],
    )).rows[0];
    if (input.id !== undefined && !before) refuse("LIVE_SCHOOL_ONBOARDING_NOT_FOUND");
    // Row lock serializes application mutations and all normal trigger-backed
    // updates. MAX is compared as a bigint in SQL, never converted to JS Number.
    const baseline = before ? (await db.query(
      `SELECT COALESCE(MAX(id),0) AS last_id FROM flutterwave_live_school_onboarding_audits
         WHERE onboarding_id=$1`, [before.id],
    )).rows[0].last_id : 0;
    const changed = (await db.query(input.sql, input.values)).rows;
    if (changed.length > 1 || (!before && changed.length !== 1)) {
      refuse("LIVE_ONBOARDING_MUTATION_CARDINALITY");
    }
    const after = changed[0];
    if (after) {
      if (after.merchant_scope !== input.merchantScope) refuse("LIVE_ONBOARDING_SCOPE_MISMATCH");
      assertLiveOnboardingTransition(before, after);
      const expected: Row = {
        onboarding_id: after.id, school_id: after.school_id, merchant_scope: after.merchant_scope,
        previous_status: before?.status ?? null, status: after.status,
        approved_by: after.approved_by ?? null, actor_id: after.last_actor_id,
        provider_id: after.provider_id ?? null, provider_subaccount_id: after.provider_subaccount_id ?? null,
        error_code: after.error_code ?? null, provider_http_status: after.provider_http_status ?? null,
      };
      // A separate command sees the AFTER trigger's row in this transaction.
      // Never use a CTE snapshot to guess whether that trigger has already run.
      await db.query(
        `INSERT INTO flutterwave_live_school_onboarding_audits
           (onboarding_id,school_id,merchant_scope,previous_status,status,approved_by,
            actor_id,provider_id,provider_subaccount_id,error_code,provider_http_status)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
         WHERE NOT EXISTS (
           SELECT 1 FROM flutterwave_live_school_onboarding_audits
             WHERE onboarding_id=$1 AND id>$12
         )`, [...auditFields.map(key => expected[key]), baseline],
      );
      const audits = (await db.query(
        `SELECT * FROM flutterwave_live_school_onboarding_audits
           WHERE onboarding_id=$1 AND id>$2 ORDER BY id`, [after.id, baseline],
      )).rows;
      if (audits.length !== 1 || !same(expected, audits[0], auditFields)) {
        refuse("LIVE_ONBOARDING_AUDIT_MISMATCH");
      }
    }
    if (owns) await db.query("COMMIT");
    return after;
  } catch (error) {
    if (owns) await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
