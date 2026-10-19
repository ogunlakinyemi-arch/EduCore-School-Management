# Development title storage and Reporting Library

## Migration disposition: NOT APPLIED

Only the existing backup execution-environment guard was invoked. It refused this
process with `PRODUCTION_EXECUTION_REFUSED`. That flag is a blocker, not evidence
that an application connection actually targets Production. No independent
application/Development target match or recoverable backup was established in this
pass. Do not unset environment flags or weaken the guard to proceed.

No application database DDL/DML, Production access, provider calls, keys, payroll,
or publishing were performed. PostgreSQL query tests use a new disposable local
cluster containing fictional fixture data, not an application connection.

`lib/db/drizzle/0168_person_titles.sql` remains prepared only. Its single
transaction adds nullable title columns and allow-list CHECKs to parents and
employees. It does not backfill or rewrite names/history. Existing API guards
still reject unsupported non-null title saves before changing a person; a null
title remains usable on pre-migration databases. The Parent and Employee forms
now explain the exact prerequisite before Save, including the No title path.
This notice is a prerequisite explanation, not a claim that storage is ready.

## Exact safe rollout sequence (not executed)

1. Obtain an approved Development write-freeze window and a genuinely
   Development execution context that passes the existing guard. Do not clear
   Production/deployment flags to disguise the current process.
2. Follow `scripts/src/dev-backup/README.md`. Run the exact exported `identitySql`
   from `scripts/src/dev-backup/safety.mjs` using the independent **Development**
   read-only SQL facility. Permission errors or any ambiguous target stop rollout.
   Independently establish that the running application's connection resolves to
   this same cluster/database/role, not merely the same database name or an
   environment label. Compare the exact identity, including cluster ID, database
   OID, data directory, server restart identity, address, port and role.
3. Place the unmodified, fresh independent identity and explicit local-socket
   connection in the private 0600 confirmation JSON described in that README.
   Proof expires after 30 minutes. No credentials belong in this file.
4. Arrange durable access-controlled backup retention and an owned private
   backup directory outside the workspace and temporary directories. Quiesce
   source writers; the CLI's confirmation flag does not stop them.
5. Using **real verified paths**, run:

   ```sh
   node scripts/src/dev-backup/cli.mjs --dry-run \
     --target-confirmation /PRIVATE/confirmation.json --backup-root /PRIVATE/backup
   node scripts/src/dev-backup/cli.mjs --print-confirmation \
     --target-confirmation /PRIVATE/confirmation.json
   node scripts/src/dev-backup/cli.mjs --run \
     --target-confirmation /PRIVATE/confirmation.json --backup-root /PRIVATE/backup \
     --confirm DEVELOPMENT:THE_PRINTED_IDENTITY_DIGEST --confirm-source-quiesced
   ```

   Require PASS and inspect the utility's backup/restore-verification evidence.
   A dry run or backup without successful isolated restore is insufficient.
   Keep backup files private; never attach them to Library or this repository.
6. Rehearse **only 0168** on a separate disposable clone restored from that
   backup. Verify the intended public parent/employee tables, absent title
   columns/constraints, constraints and migration ledger before proceeding.
   Partial application or ledger drift requires review, not blind re-running.
   Do not run all outstanding migrations or a schema push.
7. Reconfirm the unchanged Development identity and quiescence. On that exact
   verified local target, apply the file with explicit connection parameters:

   ```sh
   PGOPTIONS='-c search_path=public -c lock_timeout=5s -c statement_timeout=30s' \
   psql -X -v ON_ERROR_STOP=1 \
     --host VERIFIED_SOCKET --port VERIFIED_PORT \
     --username VERIFIED_ROLE --dbname VERIFIED_DEVELOPMENT_DATABASE \
     --file lib/db/drizzle/0168_person_titles.sql
   ```

   These are placeholders, not executable connection settings. The file owns its
   BEGIN/COMMIT transaction. Stop on any error; do not retry individual statements.
   Record the approved application according to the existing ledger procedure,
   without falsely marking other prepared migrations as applied.
8. Verify both nullable text columns and exact CHECK definitions through read-only
   schema queries. Verify unchanged names/history and row counts against the
   preservation baseline. Use approved, provider-isolated Development fixtures
   to check Parent and Employee title create/edit/clear and no-title saves,
   reload persistence, rejected invalid titles and read-only Owner behavior.
   Do not send invitations or external messages as a side effect.
9. Before COMMIT, failures roll back the transaction when the connection closes.
   After COMMIT, do not drop columns containing newly saved titles. If recovery
   is needed, freeze writes and review a restore/reconciliation plan using a
   separate verified restore target and backup; never overwrite the running
   database casually. Resume writers only after verification.

Nothing in this sequence authorizes Production changes, Live payments or Publish.

## Reporting correction

- Dates remain native date pickers. Other catalog-listed selectors use native
  dropdowns with readable labels, an Any choice, a single-column mobile grid,
  bounded widths and at least 44px control height.
- A read-only report-specific option endpoint uses the same definition whitelist,
  authentication, report roles and tenant/filter-object validation as report reads.
  Family/Teacher option catalogs are relationship/assignment scoped. Financial
  and academic report queries remain authoritative; options confer no permission.
- School changes clear subordinate filters. Session changes clear term, class,
  section, subject and student. Class changes clear section, subject and student.
  Filter changes reset pagination. Report switching/remounting starts clean.
- Status/method choices come from authorized source records and existing report
  enums (including computed library OVERDUE). Owner network
  status/method choices remain available; academic catalogs require a school.
  Oversized lists explicitly report truncation and ask for narrower selectors.
- Display and downloads retain the shared parameter serializer and exact applied
  filters/page. Download is disabled during table refresh or read failure.
- Failed option reads show a retry message, not manual ID inputs or invented data.

The earlier split-dashboard work was inspected via its existing implementation and
handoff. It was not repeated or changed by this correction.
