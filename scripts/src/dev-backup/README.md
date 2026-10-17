# Development backup and isolated restore verification

This is **not a migration, Production backup tool, schema synchronizer, Publish
preview, or live restore command**. It never imports the application DB package,
reads `DATABASE_URL`/PG credentials, or offers a live restore destination.

## Authorization boundary

Implementation and synthetic tests do not authorize a live run. A live run must
be separately authorized. No live run was required to implement this utility.
`--dry-run` is the default and opens **zero** DB connections.

Before a live run:

1. Arrange an approved Development write-freeze window. The utility does not stop
   workflows, disable workers, change settings, or lock application tables against
   writers. `--confirm-source-quiesced` is an operator attestation, not enforcement.
2. Independently run the exact `identitySql` SELECT exported by `safety.mjs` through
   Replit's **Development** read-only SQL tool, NOT via this script or the shell
   connection. Do not query Production. Permission failures are blockers.
3. A trusted operator/Agent writes that unmodified identity into a mode-0600 JSON
   file in a private directory outside Git. Use this structure:

   ```json
   {
     "environment": "development",
     "verifiedBy": "replit-development-read-only",
     "verifiedAt": "<UTC ISO timestamp of independent query>",
     "connection": {
       "host": "<explicit absolute local Unix-socket directory>",
       "port": 5432,
       "database": "<independently verified database>",
       "user": "<independently verified role>"
     },
     "identity": { "<all fields>": "<exact independent SELECT result>" }
   }
   ```

   The marker is a trusted operator attestation, **not** a cryptographic Replit
   signature. Do not self-generate the independent evidence using the candidate
   connection. No passwords, URLs or secrets belong in this file. The utility
   requires all identity fields, a proof no older than 30 minutes, a local owned
   socket, exact cluster ID/database OID/data directory/restart/role/version match,
   and an explicit confirmation token. TCP, Production-labelled paths/databases,
   standby servers and deployment processes are refused.
4. Choose a new or already-private (0700) backup directory **outside the workspace
   and `/tmp`/`/var/tmp`**. Its parent must exist. Backups are sensitive, unencrypted
   logical archives protected by Unix permissions. Do not upload them to Library,
   reports, source control or public App Storage. Disk encryption and durable,
   access-controlled retention must be arranged separately; a container filesystem
   is not a guaranteed disaster-recovery copy.

## Commands (workspace root; placeholders must be replaced)

```sh
# Offline tests; no database connections:
node --test scripts/src/dev-backup/safety.test.mjs

# Synthetic fixture test only; creates/removes its own two private local clusters:
pnpm --filter @workspace/scripts run test:dev-backup:synthetic

# Validate confirmation file/path structure, WITHOUT a database connection:
node scripts/src/dev-backup/cli.mjs --dry-run \
  --target-confirmation /private/path/development-confirmation.json \
  --backup-root /private/path/development-backups

# Print non-secret, identity-bound confirmation token (no DB connection):
node scripts/src/dev-backup/cli.mjs --print-confirmation \
  --target-confirmation /private/path/development-confirmation.json

# ONLY after separate authorization and independently verified proof:
node scripts/src/dev-backup/cli.mjs --run \
  --target-confirmation /private/path/development-confirmation.json \
  --backup-root /private/path/development-backups \
  --confirm DEVELOPMENT:<token-sha256> \
  --confirm-source-quiesced
```

Do not put the unquoted `<...>` placeholder into a shell: replace it with the
actual token, or quote the entire argument. No source/restore URL overrides,
password flags, force modes or environment-based target inference exist.

The synthetic package command intentionally uses a clean subprocess environment
without application credentials or deployment labels; it can access only its
freshly created fictional clusters. This is **not** a procedure for stripping
Production flags from a live run. Live execution must be in a verified
non-deployment Development context; ambiguous Production labels remain a blocker.

## What is verified

- Every source session (including `pg_dump`) starts read-only, with deterministic
  formatting and row security disabled only for complete reads. A source role
  without RLS bypass is refused.
- Full custom-format `pg_dump`, no table/schema filters, using an exported snapshot
  shared with pre-backup evidence. Archive checksum is checked before and after
  restore. Sequence changes during dump cause failure.
- All application schemas and data, large objects, sequence values, functions,
  triggers, constraints, indexes, views and other `pg_dump` objects are archived.
  Cluster globals (role definitions/passwords/memberships and tablespaces) are not
  database objects and are **not** included. Ownership/ACL metadata stays in the
  archive, but ownership/ACL restoration is **not** verified in the disposable test.
- Restore runs only in a new private cluster with TCP disabled, a separate system
  identifier and an internally fixed restore DB. Archive SQL runs as a restricted
  non-superuser, not the cluster admin.
- SHA-256 schema-only dump comparison (only generated restrict tokens/source-version
  headers excluded), category catalog digests, exact FK supporting-index names,
  table row counts and sorted SHA-256 row fingerprints, sequence state, large-object
  contents/OIDs, and a fresh source stability comparison.
- No raw row values enter Node, logs or reports. Fingerprints and schema DDL are
  private backup evidence only. Child stderr and raw PostgreSQL errors are never
  echoed or saved. Console output contains sanitized stage/error codes and summary.
- The disposable cluster is stopped and removed on normal success/failure. Backups
  are retained with a private PASS/FAIL result. Interrupted/killed processes may
  leave private disposable files; never delete them while their server still runs.

## Fail-closed limits

PostgreSQL 16, UTF-8 and libc locales only. Extra extensions, foreign tables/servers,
external procedural languages, event triggers, logical replication objects and
non-default tablespaces are refused rather than incompletely restored. Missing
permissions/tools/space, source drift, a restore failure, or any comparison mismatch
returns FAIL. No live object is repaired.

In particular, PostgreSQL can rebind a restored FK to another equivalent unique
index. This utility treats that as a **catalog verification failure**, not success.
Investigate it offline; never rebind the source to make the test pass.

A PASS proves only the stated logical restore checks for the captured state. It
does not prove Production equivalence, durable off-container recovery, sufficient
global roles/ACL restoration, or safety to replace Development/publish Round 1.
