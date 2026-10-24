# Deterministic isolated relationship and executor rollback rehearsal

Passed on 2026-10-24 in a newly created, private, socket-only PostgreSQL 16.10
cluster, including the actual executor rollback tests below. See
[REHEARSAL-RESULTS.md](REHEARSAL-RESULTS.md) for scope and source hashes.
No existing application database, Production connection or real reset was used.
Further runs still require explicit isolated-rehearsal approval.

## Scope

The generated fixture uses fixed fictional IDs and minimal tables representing
the reviewed relationships, not a Production dump or an application migration.
It runs the actual preflight SQL generator against that fixture. It verifies:

- Exact FK refusal for audit-only, payment-only, inactive-membership-only,
  historical-credential, historical-device-assignment and durable-device-binding tenant roots.
- Candidate deletion rolls back; every preserved row and schema/ledger fingerprint
  remains identical; Owner membership and sequence state remain unchanged.
- A fictional unused reader's nullable current school/class binding can be
  unassigned together, with its transition rolled back. Historical relationships
  on another device stay on their original schools.
- A school `inactive` label is representable and rolled back. This is **not**
  evidence that all app authorization paths treat that label as archival.

The separate executor harness reaches actual local DELETEs and checks rollback,
protected-record refusal, competing sessions and stale previews. It never sends
COMMIT. It does **not** certify the full Production schema, live resource binding,
backup restoration, auth/provider behavior or readiness for real deletion.
The database filename/connection checks are deliberately incompatible with the
Production cleanup CLI. Do not edit its primary gates to run a local fixture.

## Offline commands

From the workspace root:

```sh
pnpm --filter @workspace/scripts run test:production-reset
node scripts/src/production-reset/rehearsal.mjs --help
# Prints SQL only. Do not pipe this into any existing database.
node scripts/src/production-reset/rehearsal.mjs --print-sql
```

The printer imports no pg client, reads no credentials and has no execute,
connection-string, host or target flag. Its output is byte-for-byte deterministic.

## Exact rerun commands — require isolated-rehearsal approval first

Run from the workspace root only after approval. PostgreSQL 16 `initdb`, `pg_ctl`
and `psql` must already be available. A missing tool/version is a blocker, not
permission to install dependencies/change project configuration in this task.

The following **single foreground shell** creates and removes only its own private,
fresh local cluster. It does not use application database helpers, Development
backup proofs, a restored archive, cloud APIs, credentials or network listeners.
No shared environment settings or Replit secrets are changed.

```sh
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  PGPASSFILE=/dev/null PGSERVICEFILE=/dev/null \
  bash --noprofile --norc <<'ISOLATED_REHEARSAL'
set -euo pipefail
test "$(id -u)" -ne 0
test -f scripts/src/production-reset/rehearsal.mjs
for tool in initdb pg_ctl psql; do
  "$tool" --version | grep -Eq '\(PostgreSQL\) 16\.'
done
umask 077
WORK="$(mktemp -d /tmp/educore-reset-rehearsal.XXXXXXXX)"
STARTED=0
cleanup() {
  # Never stop another cluster or remove a caller-supplied path.
  case "$WORK" in /tmp/educore-reset-rehearsal.*) ;; *) return 1 ;; esac
  if [ "$STARTED" = 1 ]; then
    pg_ctl -D "$WORK/data" -m fast -w -t 30 stop >/dev/null || return 1
  fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -m 700 "$WORK/socket"
initdb -D "$WORK/data" --username=rehearsal_admin --encoding=UTF8 \
  --no-locale --auth-local=trust --auth-host=reject >"$WORK/init.log" 2>&1
cat >>"$WORK/data/postgresql.conf" <<CONFIG
listen_addresses = ''
unix_socket_directories = '$WORK/socket'
unix_socket_permissions = 0700
port = 55483
log_statement = 'none'
CONFIG
STARTED=1
pg_ctl -D "$WORK/data" -l "$WORK/server.log" -w -t 30 start >/dev/null
# All connection fields are literal/local; no inherited PG*/DATABASE_URL or app pool.
psql -X -w -h "$WORK/socket" -p 55483 -U rehearsal_admin -d postgres \
  -v ON_ERROR_STOP=1 -v fixture_data="$WORK/data" -v fixture_socket="$WORK/socket" <<'CREATE_FIXTURE'
SELECT current_database()='postgres' AND current_user='rehearsal_admin'
 AND inet_server_addr() IS NULL AND current_setting('listen_addresses')=''
 AND current_setting('data_directory')=:'fixture_data'
 AND current_setting('unix_socket_directories')=:'fixture_socket'
 AND current_setting('port')='55483' AS fresh_cluster
\gset
\if :fresh_cluster
CREATE DATABASE reset_rehearsal;
\else
\quit 3
\endif
CREATE_FIXTURE
node scripts/src/production-reset/rehearsal.mjs --print-sql >"$WORK/rehearsal.sql"
psql -X -w -h "$WORK/socket" -p 55483 -U rehearsal_admin -d reset_rehearsal \
  -v ON_ERROR_STOP=1 -v fixture_data="$WORK/data" -v fixture_socket="$WORK/socket" \
  -f "$WORK/rehearsal.sql"
node scripts/src/production-reset/executor-isolated.mjs \
  --data-dir "$WORK/data" --socket-dir "$WORK/socket"
ISOLATED_REHEARSAL
```

Expected successful output includes
`FICTIONAL_RELATIONSHIP_REHEARSAL_PASS_NOT_PRODUCTION_OR_EXECUTOR_CERTIFICATION`,
then executor JSON with `status: "PASS"`, all five named checks and
`commitStatementsSent: 0`.
Any error/nonzero exit is failure. The SQL checks the exact newly created data
directory, socket directory, fixed port, database/role, absence of TCP listeners
and empty public/system schemas **before fixture DDL**. Never provide an existing
database, skip that guard or treat this fixture's snapshots as Production evidence.

### Separate existing-account access rehearsal

For the same-email Partner refinement, use the dedicated
`reapplication-rehearsal.sh`, documented in `PARTNER-REAPPLICATION.md`. It uses a
fresh socket-only fixture, not a dump or connection to a current database.

For the access-revocation checks, run the same clean isolated shell in another
fresh temporary cluster, replacing **only** `executor-isolated.mjs` with
`access-archive-isolated.mjs`. Keep every path, ownership, environment and cleanup
guard. It creates a separate fictional `access_archive_rehearsal` database and
tests real block/restore audit appends, rollback, competing locks, unreviewed
audit triggers, Owner/unrelated access and protection of existing business rows.

Unlike the deletion executor's rollback-only rehearsal, this separate access
rehearsal commits a fictional BLOCK and RESTORE to prove durable reversibility.
It never connects to Production, Clerk or a workspace database. Audit sequence
gaps after rolled-back appends are normal PostgreSQL behavior; no sequence is
reset. Expected output is access JSON `status: "PASS"` with all twelve named
checks. Source identity and scope are recorded separately in REHEARSAL-RESULTS.

If startup/SQL fails, stop and diagnose that isolated failure. Never substitute
workspace/Production connection variables. If the exit cleanup cannot confirm
shutdown, it leaves its directory rather than deleting a running cluster; inspect
only that generated local path. The procedure does not resume workers, change
settings or invoke provider/auth/device operations.
