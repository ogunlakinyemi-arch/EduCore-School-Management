# Controlled Production test-tenant cleanup — implementation only

This is an operator CLI, not an API route, migration, startup job or Publish hook.
No Production connection or execution was performed while implementing it.
The original `production-reset:preflight --execute` remains unconditionally refused.

## Important: preservation can make an empty-tenant reset impossible

All existing test schools must be explicitly listed, not auto-selected. New schools
appearing after review invalidate the scope. Only the conservative school-scoped
candidate tables in `manifest.mjs` can be deleted, children before parents.
All auth users/memberships (including Owner and every legitimate administrator),
financial/audit/academic history, devices/credentials/bindings, reusable assets,
communication/provider settings and unlisted tables are preserved.

If any retained table still contains selected-tenant rows or has FK references to
candidate rows, the **entire operation is refused**, not partially committed.
Neither a token nor a test-data assertion overrides this policy. In the audited
Production state, school memberships, audit/history and device bindings are likely
blockers. The resolved default is to retain those records and their required
tenant/person/class/term ancestors; an empty-tenant outcome is not promised.
[RETENTION.md](RETENTION.md) records exact nullable/status possibilities, hard
blockers and the remaining operator decisions. No detachment or inactive/archive
mutation is implied. Do not delete/repoint history merely to make the gate pass.

A deterministic fictional relationship/rollback rehearsal and exact future
isolated commands are in [REHEARSAL.md](REHEARSAL.md). The SQL printer is offline;
the database procedure has not been run or authorized by this implementation.

## Offline by default

```sh
pnpm --filter @workspace/scripts run production-reset:cleanup -- --school-ids 1,2 --dry-run
pnpm --filter @workspace/scripts run production-reset:cleanup -- --help
pnpm --filter @workspace/scripts run production-reset:cleanup -- --identity-sql
```

These commands do not connect. The last prints the exact primary-identity SELECT
for independent operator verification; it does not run it. `--identity-sql` cannot
be combined with execution. No force/all/retention override/URL argument exists.
All non-committing modes return exit 2 (except help/SQL printing).

## Manual prerequisites that cannot be safely automated

1. **Primary binding:** the Owner privately verifies the current published
   `https://educore.yetenia.com` connection against the intended Replit Production
   resource. Independently obtain database OID, role and cluster system identifier
   on the actual writable primary using the printed SELECT. A database name,
   workspace URL or proxy address alone is insufficient. The operator's role must
   already have permission for `pg_control_system()` and full `pg_stat_activity`
   visibility (superuser or membership of `pg_read_all_stats`). Missing permission
   refuses execution; this tool never grants roles or changes configuration.
2. **Maintenance:** stop/disconnect ALL app processes, pools, workers and other
   primary client sessions; block HTTP onboarding and device ingress; pause/reject
   provider callbacks and external auth hooks without acknowledging them as paid.
   Arrange safe redelivery after maintenance. Do not merely stop a scheduler while
   leaving other API instances running. Table locks cannot stop future external
   replay, so the Owner must attest the external freeze and its expiry.
3. **Recovery:** confirm a current, resource-bound scheduled/PITR point at or after
   the maintenance freeze, then verify restoration into a separately approved
   isolated destination. Record the exact point, recovery horizon and report hash.
   Screenshots showing enabled backups/7-day PITR establish availability only,
   not that a particular current point was restored successfully. No automatic
   backup/restore or Production restore is performed. Object bytes, external
   identities and provider settings need independent preservation/recovery.
4. **Retention review:** explicitly classify the school allowlist as test-only
   and review logical/JSON/external references, which SQL FKs cannot fully prove.
   Resolve retained-row blockers without erasing history. This implementation
   never deletes external Clerk identities, stored objects or device credentials.

The binding/backup/maintenance documents below are **private Owner attestations**,
not cryptographic Replit API proofs. A `verified:true` flag is not accepted. The
executor independently rechecks the connected primary and actual data; backup
restore reports and external maintenance still require an accountable operator.

## Authorization document

Use a private, owned mode-0600 JSON file outside Git. Do not include passwords,
connection strings, raw auth identifiers or secret values. All SHA-256 fields
refer to separately retained reviewed evidence. This example is a format only;
none of its placeholders or booleans is actual authorization.

```json
{
  "version": 1,
  "environment": "production",
  "resourceId": "<owner-verified-Replit-resource-id>",
  "appUrl": "https://educore.yetenia.com",
  "verifiedAt": "<fresh UTC ISO timestamp>",
  "bindingEvidenceSha256": "<64 lowercase hex>",
  "target": {
    "host": "<exact-primary-connection-host>",
    "port": 5432,
    "database": "neondb",
    "databaseOid": "<independently-observed-digits>",
    "role": "<independently-verified-role>",
    "systemIdentifier": "<independently-observed-cluster-digits>"
  },
  "authority": {
    "role": "PLATFORM_OWNER",
    "authorizationSha256": "<64 lowercase hex>",
    "retainedLogicalReferencesReviewed": true,
    "testSchoolIds": [1, 2]
  },
  "maintenance": {
    "resourceId": "<same-resource-id>",
    "verifiedAt": "<freeze timestamp>",
    "expiresAt": "<expiry no more than 30 minutes after freeze>",
    "evidenceSha256": "<64 lowercase hex>",
    "ingressBlocked": true,
    "workersStopped": true,
    "devicesStopped": true,
    "callbacksPaused": true,
    "authHooksPaused": true,
    "registrationStopped": true
  },
  "backup": {
    "resourceId": "<same-resource-id>",
    "kind": "PITR",
    "pointId": "<exact-recovery-point-reference>",
    "recoverableAt": "<point at or after freeze>",
    "verifiedAt": "<verification timestamp>",
    "retentionUntil": "<after maintenance expiry>",
    "evidenceSha256": "<64 lowercase hex>",
    "restoreDrill": {
      "resourceId": "<same-resource-id>",
      "pointId": "<same-point-reference>",
      "verifiedAt": "<restore verification timestamp>",
      "evidenceSha256": "<64 lowercase hex>"
    }
  }
}
```

All verification/recovery/drill timestamps must be no more than 15 minutes old.
The maintenance window must still be active. Refresh/re-review expired evidence;
there is no age override. For a longer restore operation, a new reviewed policy
would be necessary rather than fabricating fresh timestamps.

## Separately authorized future preview/execution

Credentials must be supplied by the operator through a protected process
environment as `PRODUCTION_RESET_DATABASE_URL`. No secret is requested/created by
this implementation. There is **no fallback to workspace `DATABASE_URL`**.
The URL host/port/database/role must match the authorization document; TLS
certificate verification is mandatory. Optional URL parameters are limited to
`sslmode=verify-full`; credential values are never printed.

Only after separate permission for a Production connection:

```sh
# Connects read-only; returns actual evidence and a blocked/ready plan.
pnpm --filter @workspace/scripts run production-reset:cleanup -- --school-ids 1,2 \
  --authorization /private/owner-authorization.json --preview

# Offline review of the saved preview JSON; no connection.
pnpm --filter @workspace/scripts run production-reset:cleanup -- --school-ids 1,2 \
  --authorization /private/owner-authorization.json --evidence-file /private/preview.json
```

Save preview output privately (0600, no pnpm log wrapper). The file can contain the
returned JSON object or its raw `evidence` value. Review actual per-table counts,
all retained-reference blockers and the confirmation token. If any blocker remains,
do not proceed. The token binds the authorization, scope, manifest, full table
fingerprints/counts and schema/migration/FK evidence.

The destructive mode is **not authorized by this code change**. A later, separately
authorized operator may invoke the same command with `--execute`,
`--evidence-file /private/preview.json` and
`--confirm 'PRODUCTION-CLEANUP:<exact-reviewed-digest>'` only after every gate passes.
Never paste a guessed token, include credentials in arguments or automate retries.

## Transaction and verification

- One bounded connection, no pool, no automatic retry, no provider calls.
- Three timed read probes, exact primary/cluster/role checks, no other primary
  client sessions, and no unreviewed custom triggers, rewrite rules, RLS,
  partitioned or foreign tables. Unsupported side effects require separate review.
- One READ COMMITTED transaction with a cleanup advisory lock and deterministic
  ACCESS EXCLUSIVE NOWAIT locks on all public/system application tables. Fresh
  statement snapshots after locks avoid a stale pre-lock SERIALIZABLE snapshot.
  All scoped/protected counts and fingerprints are rechecked under those locks.
- Only allowlisted parameterized DELETEs. Each affected row count must match the
  reviewed count. No cascade into preserved data, constraint/trigger disabling,
  sequence calls, schema changes, migration or identity restart.
- Before COMMIT: no FK orphans, unchanged FK inventory/schema/migrations,
  unchanged preserved tables and out-of-scope rows, unchanged actual primary
  sequence positions, surviving active Owner and no other primary clients.
  Authorization freshness is checked again during deletion and before commit.
- Any pre-commit error triggers rollback. An unconfirmed rollback is reported as
  uncertain. A failed/lost COMMIT response is **unknown**, never asserted rolled
  back and never automatically retried.

After any future successful commit, keep maintenance active until a human verifies
Owner/admin sign-in, external/provider preservation and safe resumption of workers,
callbacks and devices. SQL verification does not certify these external behaviors.
Cleanup does not activate LIVE payments.
