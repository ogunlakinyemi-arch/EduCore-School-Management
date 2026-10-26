# Flutterwave LIVE — Production-specific human review package

Date: 2026-10-26

**REVIEW ONLY — BLOCKED — NOT APPROVED FOR EXECUTION.**

This is a separate proposed Production-scope addendum. It does not amend or
override any original file, grant execution permission, or certify a supported
Production installation route. It contains no SQL copies or executable installer.

## Intended target and scope decision

The proposed target is **the independently verified writable Production primary
serving Yetenia EduCore**, in the intended `public` schema. It is not the shared
Development database, an Agent replica, or a disposable fixture. The database
name alone (including `neondb`) is insufficient resource identity.

The owner previously reported primary/resource binding, recovery evidence and
Production authorization. Those reports are acknowledged, not independently
renewed by this preparation. This request authorizes review preparation only.

### Unresolved scope conflict — hard stop

The original inbox file says:

> Apply only to a separately verified Development target after review.

The original runbook records Production authorization and describes conditional
manual Production execution, but does not explicitly reconcile that restriction.
The later files depend on the inbox, so **all six stages remain blocked**.

The proposed human decision is:

> Subject to the separate platform-route, target, recovery, compatibility and
> execution prerequisites below, review the unchanged six-file package for the
> verified EduCore Production primary. Any exception to the inbox's
> Development-only restriction must explicitly identify its original SHA-256,
> explain why its exact SQL is appropriate for this Production target, and be
> accepted by an authorized reviewer. This proposed statement is NOT an approval.

Reviewer: **NOT RECORDED**. Scope decision: **PENDING**. Execution approval:
**NOT GRANTED BY THIS PACKAGE**. Record any later signed decision separately;
do not infer it from an open writable SQL console or an earlier general approval.

No Production-specific SQL copy was created. Header editing is not a substitute
for resolving scope. All SQL bytes, including comments, remain in the originals.
If copies are later requested, any header change must be disclosed, the executable
SQL must remain identical, and original/copy hashes must be separately reviewed.

## Additional hard blockers

1. **Supported installation route:** the existing runbook describes manual
   operator installation. For a Replit-managed Production database, current
   project guidance instead designates Publish as the supported schema path.
   This package does not resolve that discrepancy or authorize a bypass.
   A platform-supported operator route for these objects must be established
   before the desktop guidance below is used.
2. **Future Publish retention:** there is no demonstrated guarantee that Publish
   creates or retains all required functions/triggers. Do not install and then
   publish on the assumption that manually installed objects will survive.
3. **Console execution guarantees:** an editable SQL console does not establish
   persistent-session, whole-file or stop-on-error behavior. Do not use fragmented
   mobile copy/paste or run function bodies statement by statement.
4. **Current state:** this package makes no database connection. Object absence,
   permissions, recovery availability and compatibility are not freshly certified.

## Unchanged source files and checksum verification

All paths and checksum commands are relative to the project root. Read each
original in full. The existing runbook and existing forward manifest remain
unchanged; the separate `originals.sha256` also pins all six rollback companions.

File-only verification, which opens no database connection:

```sh
sha256sum -c docs/finance/flutterwave-live-forward.sha256
sha256sum -c docs/finance/flutterwave-live-production-review/originals.sha256
```

Require successful exit and six plus fourteen `OK` results, respectively.
Any mismatch is a hard stop. Checksums prove file identity, not execution approval.

## Prerequisites before any first-stage execution

These are requirements for a later separately authorized operator, not requests
to perform database operations during this review preparation.

- Resolve all hard blockers above. Approve the exact hashes, target/resource,
  operator, application version, preservation baseline and maintenance window.
- Reuse existing owner evidence; at execution time establish that it still
  applies to the selected resource. Privately confirm deployed-app binding.
  Never put credentials, connection strings, bank data or identity records here.
- Identify an actual available pre-change recovery point for that resource,
  with UTC timestamp and recovery procedure. Do not perform a restore as a test.
- In the actual execution session verify `current_database()`, primary status
  (`pg_is_in_recovery() = false`), `transaction_read_only = off` and intended
  schema. Do not force a replica writable or switch connection secrets.
- Through the actual execution role verify schema CREATE, language USAGE and
  required REFERENCES/TRIGGER privileges. Confirm expected integer primary keys
  on `app_users.id`, `schools.id`, `settlement_payroll_profiles.id`. Do not grant
  extra privileges as an automatic workaround.
- Check all expected table, index, function and trigger names for collisions and
  partial installation. Existing objects mean stop and reconcile, not add
  `IF NOT EXISTS`, replace definitions, skip a stage, or rerun all files.
- Verify the full canonical schema and serving application are compatible.
  These six files do not repair missing unrelated application tables or replace
  the complete EduCore schema.
- Coordinate concurrent activity and capture an approved preservation baseline
  for existing records, configuration, financial/audit history and schema.
  Do not reset test data or change payment/notification flags for convenience.
- Establish how subsequent Publish proposals will be checked for deletion,
  omission, replacement or disabling of required objects before publishing.
  This package does not establish long-term retention.

## Required order and per-file review checkpoints

Each basename below is in `lib/db/dev-reconciliation/` and ends in `.up.sql`.
Immediately before each stage, recheck that individual file against
`originals.sha256`; use its complete original bytes.

| Stage | Basename | New tables | Functions / triggers | Cumulative LIVE tables | Dependency / checkpoint |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | `flutterwave-live-webhook-inbox` | 1 | 0 / 0 | 1 | **Blocked by Development-only header**; inbox is not verified payment evidence |
| 2 | `flutterwave-live-finalization` | 5 | 3 / 5 | 6 | Requires inbox; verify immutable snapshots, evidence, holds, financial checks and generated calculations |
| 3 | `flutterwave-live-workflow` | 7 | 2 / 8 | 13 | Requires stages 1–2; verify authority/receipt/audit retention and hold-driven batch invalidation |
| 4 | `flutterwave-live-readiness` | 1 | 0 / 1 | 14 | Requires stages 1–3; verify composite evidence/scope FKs and supporting keys/indexes |
| 5 | `flutterwave-live-runtime` | 4 | 1 / 3 | 18 | Requires stages 1–4; verify checkout claim guard; runtime release table remains empty |
| 6 | `flutterwave-live-school-onboarding` | 3 | 3 / 3 | 21 | Requires canonical user/school/profile keys; verify all three onboarding triggers; onboarding release table remains empty |

Financial constants remain NGN 500,000 kobo gross, 190,000 kobo school allocation
and 310,000 kobo Yetenia gross allocation before actual recorded provider charges.
The eligible BRO liability remains 10,000 kobo, otherwise zero, never another
checkout recipient. Preserve eligibility, term-end Owner review, hold and export
rules; export/approval is not transfer or Paid evidence. No original business
logic, immutable-history rule or constraint is waived by this scope proposal.

## Conditional desktop psql guidance — NOT EXECUTABLE AS PROVIDED

**Do not use while any blocker is unresolved.** This section documents required
client behavior for human review; it is not a new installation script or a
supported-route certification. Never place it in build/startup hooks or an API.

After a later separate approval, use desktop `psql` with `-X` (ignore psqlrc),
`--set=ON_ERROR_STOP=1` and **exactly one original migration file per invocation**.
Use private, approved PostgreSQL service/password configuration; never put
credentials in command arguments, shell history, documents or chat. The approved
client must retain one connection for its guard and the entire file.

The following deliberately invalid placeholders prevent this example selecting
an actual migration. Do not replace them during review preparation:

```text
psql -X --set=ON_ERROR_STOP=1 \
  --dbname='service=REVIEW_BLOCKED_PRIVATE_SERVICE_NOT_SELECTED' \
  --command="<REVIEWED SAME-SESSION GUARD AND TIMEOUTS BELOW>" \
  --file="<REVIEW_BLOCKED_ONE_EXACT_ORIGINAL_UP_FILE>"
```

The guard/timeout argument must be a single properly quoted SQL command containing
the following, before the file in the same psql invocation. This is a document
example only; no SQL is executed by this package:

```sql
SET search_path = public, pg_catalog;
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $target_guard$
BEGIN
  IF current_database() <> 'REPLACE_WITH_INDEPENDENTLY_APPROVED_DATABASE_NAME'
     OR pg_is_in_recovery()
     OR current_setting('transaction_read_only') <> 'off'
     OR current_schema() IS DISTINCT FROM 'public' THEN
    RAISE EXCEPTION 'Approved writable Production primary and public schema required';
  END IF;
END;
$target_guard$;
```

In a shell, preserve dollar-quote delimiters using correct literal quoting;
never let shell expansion alter the guard. The database-name check supplements,
not replaces, independent resource identity. The guard itself cannot establish
authorization, backup availability, completeness or platform support.

Each original already owns its `BEGIN`/`COMMIT`. **Do not use `--single-transaction`,
an outer transaction, concatenate files, or split dollar-quoted function bodies.**
Use a fresh guarded connection for each of the six separately approved stages.
No session settings may be assumed to survive between invocations.

Require exit status zero, successful COMMIT and stage verification before moving
to the next file. Keep a private record of hash, stage, operator, UTC time and
verification outcome. The six stages are not one atomic transaction.

On any guard failure, SQL error, timeout, nonzero exit, disconnect, uncertain
COMMIT, collision or verification discrepancy: **STOP THE ENTIRE SEQUENCE**.
Do not start the next stage or retry blindly. Closing a failed psql connection
rolls back its still-open transaction; if retaining a client session, explicitly
ROLLBACK on that same session. Previously committed stages stay committed.
A lost response may follow a successful COMMIT: establish actual state first.
Never automatically invoke rollback companions or force drops.

## Required verification before declaring installation complete

Match exact object definitions, not counts alone: 21 LIVE tables, nine PL/pgSQL
functions, 20 enabled non-internal triggers, all intended constraints/indexes,
partial predicates and generated calculations. Confirm validated constraints and
valid/ready indexes. Compare preserved canonical data/schema to the approved
baseline. Both LIVE release tables must contain **zero rows**. Stop on any
difference; do not weaken a protection to get a passing result.

Prior local verification is evidence for the exact SQL, not Production contents,
permissions, recoverability, console guarantees or Publish compatibility.
This request does not authorize rerunning that verification.

Leave LIVE mode, release flags, approvals, subaccounts, checkout, collection,
transfers and provider operations untouched. Do not publish. Do not reset data.
The separate three missing application tables are outside this six-file package.

See [REVIEW.md](REVIEW.md) for the preparation outcome and remaining blockers.
