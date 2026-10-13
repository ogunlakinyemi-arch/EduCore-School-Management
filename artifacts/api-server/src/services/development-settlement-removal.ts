import { pool, DatabaseClient, type DatabasePoolClient } from "@workspace/db";
import { AuthError } from "../middlewares/auth";

// Independently matched through the platform Development connection and the
// application's DB module. Not a credential. A server replacement invalidates
// this receipt: never learn/refresh it from the database being checked.
const approvedDevelopmentTarget = {
  host: "helium",
  port: 5432,
  database: "heliumdb",
  fingerprint: "c95705198e31d45bbfbfeb688a774412",
} as const;

export type RemovalScope = {
  scope: "YEMAIT_COMPANY" | "SCHOOL";
  schoolId: number | null;
};
export type RemovalConfirmation = {
  expectedProfileId: number;
  expectedVersion: string;
  confirmation: string;
};
type ProfileMetadata = {
  id: number;
  scope: RemovalScope["scope"];
  school_id: number | null;
  business_name: string;
  verification_status: string;
  version: string;
  verified_time_present: boolean;
  verified_by_present: boolean;
  subaccount_present: boolean;
};

const metadataColumns = `id,scope,school_id,business_name,verification_status,
  to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version,
  (verified_at IS NOT NULL) AS verified_time_present,
  (verified_by IS NOT NULL) AS verified_by_present,
  (provider_subaccount_id IS NOT NULL) AS subaccount_present`;

export function assertRemovalEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "development" || env.REPLIT_DEPLOYMENT) {
    throw new AuthError(404, "Development settlement removal is unavailable");
  }
}

function assertConfiguredTarget() {
  // Parse the actual pool configuration without connecting or exposing secrets.
  // Refuse a non-Development destination BEFORE even querying its metadata.
  const configured = new DatabaseClient(pool.options);
  if (configured.host !== approvedDevelopmentTarget.host
    || configured.port !== approvedDevelopmentTarget.port
    || configured.database !== approvedDevelopmentTarget.database) {
    throw new AuthError(503, "Development database isolation is not confirmed; removal is disabled");
  }
}

export async function assertRemovalDatabase(client: Pick<DatabasePoolClient, "query">, lockTables = false) {
  const identity = (await client.query(
    `SELECT current_database() AS database_name,pg_is_in_recovery() AS is_replica,
     md5(current_database()||COALESCE(inet_server_addr()::text,'LOCAL')||
       pg_postmaster_start_time()::text) AS development_fingerprint`,
  )).rows[0];
  if (!identity || identity.database_name !== approvedDevelopmentTarget.database
    || identity.is_replica !== false
    || identity.development_fingerprint !== approvedDevelopmentTarget.fingerprint) {
    throw new AuthError(503, "Development database isolation is not confirmed; removal is disabled");
  }
  if (lockTables) {
    // Prevent concurrent trigger/FK DDL between catalog review and DELETE.
    // Ordinary row-level writes remain allowed; no guard is disabled.
    await client.query("LOCK TABLE settlement_payroll_profiles,settlement_payroll_audit_events IN ROW EXCLUSIVE MODE");
  }
  const guards = (await client.query(
    `SELECT
     (SELECT count(*)::int FROM pg_constraint WHERE contype='f'
       AND confrelid='public.settlement_payroll_profiles'::regclass) AS incoming_foreign_keys,
     (SELECT count(*)::int FROM pg_trigger
       WHERE tgrelid='public.settlement_payroll_profiles'::regclass
       AND NOT tgisinternal) AS profile_triggers,
     (SELECT count(*)::int FROM pg_trigger
       WHERE tgrelid='public.settlement_payroll_audit_events'::regclass
       AND tgname='settlement_payroll_audit_append_only'
       AND tgenabled IN ('O','A') AND (tgtype & 24)=24
       AND tgfoid='public.prevent_settlement_payroll_audit_mutation()'::regprocedure) AS audit_guards`,
  )).rows[0];
  if (!guards || guards.incoming_foreign_keys !== 0
    || guards.profile_triggers !== 0 || guards.audit_guards !== 1) {
    throw new AuthError(503, "Settlement database guards differ from the reviewed configuration; removal is disabled");
  }
}

function eligible(row: ProfileMetadata) {
  return row.verification_status === "PENDING_VERIFICATION"
    && row.verified_time_present === false && row.verified_by_present === false && row.subaccount_present === false;
}

async function transaction<T>(readOnly: boolean, run: (client: DatabasePoolClient) => Promise<T>) {
  assertRemovalEnvironment();
  assertConfiguredTarget();
  const client = await pool.connect();
  try {
    await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
    await assertRemovalDatabase(client, !readOnly);
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyRemovalRuntimeTarget() {
  try {
    // Startup evidence from the real serving process: metadata only, no profile
    // reads, writes, identity-provider requests or automatic target rebinding.
    return await transaction(true, async () => true);
  } catch {
    return false;
  }
}

export async function reviewSettlementRemoval(scope: RemovalScope) {
  return transaction(true, async (client) => {
    const row = (await client.query<ProfileMetadata>(
      `SELECT ${metadataColumns} FROM settlement_payroll_profiles
       WHERE scope=$1 AND school_id IS NOT DISTINCT FROM $2`,
      [scope.scope, scope.schoolId],
    )).rows[0];
    return {
      developmentOnly: true as const,
      scope: scope.scope,
      schoolId: scope.schoolId,
      profileId: row?.id ?? null,
      businessName: row?.business_name ?? null,
      version: row?.version ?? null,
      status: row?.verification_status ?? "NOT_CONFIGURED",
      eligible: !!row && eligible(row),
      notice: "Review only. Removal requires a separate explicit confirmation. Audit and payment history are retained.",
    };
  });
}

export async function removePendingSettlementProfile(
  scope: RemovalScope,
  input: RemovalConfirmation,
  writeAudit: (client: DatabasePoolClient, profileId: number) => Promise<void>,
) {
  if (input.confirmation !== `REMOVE PROFILE ${input.expectedProfileId}`) {
    throw new AuthError(400, "Type the exact profile confirmation before removal");
  }
  return transaction(false, async (client) => {
    const row = (await client.query<ProfileMetadata>(
      `SELECT ${metadataColumns} FROM settlement_payroll_profiles
       WHERE id=$1 AND scope=$2 AND school_id IS NOT DISTINCT FROM $3 FOR UPDATE`,
      [input.expectedProfileId, scope.scope, scope.schoolId],
    )).rows[0];
    if (!row) throw new AuthError(404, "Settlement profile not found");
    if (row.version !== input.expectedVersion) {
      throw new AuthError(409, "The profile changed; review its current ID and version again");
    }
    if (!eligible(row)) {
      throw new AuthError(409, "Only pending, unverified profiles without a provider subaccount can be removed");
    }
    const removed = await client.query(
      `DELETE FROM settlement_payroll_profiles
       WHERE id=$1 AND scope=$2 AND school_id IS NOT DISTINCT FROM $3
       AND to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=$4
       AND verification_status='PENDING_VERIFICATION'
       AND verified_at IS NULL AND verified_by IS NULL AND provider_subaccount_id IS NULL
       RETURNING id`,
      [row.id, scope.scope, scope.schoolId, input.expectedVersion],
    );
    if (removed.rowCount !== 1) throw new AuthError(409, "The profile changed; nothing was removed");
    await writeAudit(client, row.id);
    return {
      removed: true as const,
      profileId: row.id,
      scope: scope.scope,
      schoolId: scope.schoolId,
      status: "NOT_CONFIGURED" as const,
    };
  });
}
