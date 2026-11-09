# BRO Field Operations — release preflight

Historical BRO-only scope. The later all-recent-features authorization and current
prepared release are documented in `recent-features-production-release.md`.

Date: 2026-11-09. **Status: BLOCKED — prepared and tested, not released.**

## Authorized scope

Only release the existing Field Operations feature for authenticated PARTNER/BRO
and PLATFORM_OWNER accounts. Preserve current role, active-BRO, ownership,
transfer approval, attribution and financial boundaries.

The source patch removes only Field Operations-specific environment gates from:

- BRO desktop/mobile navigation and the Owner Field Operations tab;
- the Field Operations page;
- the Field Operations API middleware.

No teacher Telegram, teacher period notification, notification delivery control,
commission-action or other Development-only gate was removed.

## Observed preflight result

The deployment service reports a public, successful autoscale deployment at
https://educore.yetenia.com. Its response does not identify the serving app's
database resource or current backup/recovery points.

Read-only Production SQL returned:

| Check | Exact observation | Result |
|---|---|---|
| Database | `neondb` | Identifies the queried database, not the serving primary |
| Database OID | `16394` | Replica observation only |
| SQL role | `neondb_owner` | Does not establish primary execution access |
| `pg_is_in_recovery()` | `true` | **Replica; not an executable primary target** |
| `transaction_read_only` | `on` | **No Production DDL execution path established** |
| Server start | `2026-11-09 13:10:06.129706+00` | Observation, not resource-binding proof |
| Existing BRO tables | `bro_field_leads`, `bro_field_claims`, `bro_field_transfers` | Present |
| Required guard functions | `0` | Missing |
| Required protection triggers | `0` | Missing |
| Recovery UI evidence received 2026-11-09 | Production Database Settings: PITR on for the last 7 days; scheduled backups on, kept 7 days; last backup 14 hours ago at capture | **Current UI recovery evidence inspected; runtime resource binding and primary execution remain separate** |

Earlier Owner confirmations of Production binding/backups are documented and
remain acknowledged. No new approval is being requested. The supplied Settings
screenshot supports configured recovery and an observed recent backup; it does
not show a tested restoration or an individual backup identifier. The second
screenshot shows the Production Database overview and tables, not the deployed
application's database binding or a writable primary session. These are not
reasons to call backups absent or ask for the same screenshots again.

Still required before execution: correlate this Production resource with the
serving app and establish an authorized, non-replica primary-console/platform
execution path. Agent's available connection remains read-only. No Production
DDL was attempted on the basis of these screenshots.

### Publish isolation check

The read-only Publish preview reports:

- 8 pending SQL statements;
- all 8 concern `teacher_telegram_links` / `teacher_telegram_challenges`;
- 0 install the BRO guard functions/triggers;
- no structural data-loss warning.

These statements are nevertheless **outside this release authorization**.
Do not publish the entire current Development schema as a BRO-only release.
Do not assume Publish will deliver procedural objects merely because the three
BRO tables exist. Prepare an isolated BRO-only release from the verified serving
source/baseline without overwriting current Development work, and confirm its
final Publish preview excludes all unrelated schema changes.

## Reviewed SQL candidate

`lib/db/reviewed-releases/bro-field-protections.sql`

This is reviewable SQL, not a custom Production migration runner and not connected
to startup, build, deployment hooks or automatic execution.

It installs only:

| Function | Trigger | Existing table |
|---|---|---|
| `bro_field_immutable()` | `bro_field_claim_history` | `bro_field_claims` |
| `bro_field_owner_guard()` | `bro_field_ownership` | `bro_field_leads` |
| `bro_field_transfer_guard()` | `bro_field_transfer_history` | `bro_field_transfers` |
| `bro_field_audit_guard()` | `bro_field_audit_history` | `audit_logs` |

Safeguards:

- one transaction, five-second lock timeout and thirty-second statement timeout;
- refuses a read-only or recovery-mode connection and missing prerequisite tables;
- creates missing objects only; retains exact existing approved definitions;
- refuses unexpected function definitions, trigger bindings/events or disabled
  triggers instead of silently replacing them;
- no table recreation, row copying, backfill, deletes, resets or sequence changes.

The SQL's primary/read-only check is necessary but **does not** prove that a
writable database is the serving app's actual resource. Operator binding and
recovery verification remain mandatory outside this file.

For managed Production, use the supported operator Production SQL-console or
platform-assisted procedural-schema process after those checks. Do not bypass
Agent's read-only Production access using credentials, startup DDL or a new
Production migration runner.

## Completed validation

Command:

`pnpm --filter @workspace/api-server exec vitest run src/routes/bro-field-operations.postgres.test.ts`

Result: **9 passed** against disposable local PostgreSQL only.

Checks include:

- Production-mode BRO and Owner API access with authentication retained;
- denial for unrelated roles, inactive BROs and cross-BRO reads/edits;
- reason-required Owner-approved transfers and access changes;
- duplicate claim protection and original attribution retention;
- removing/reinstalling only the eight procedural objects in an isolated fixture;
- applying the SQL twice without changing populated lead, claim, transfer or
  audit rows;
- matching the original approved function definitions;
- rejecting direct history/ownership tampering and unexpected disabled triggers.

API typecheck, frontend typecheck and `git diff --check`: **passed**.

## Not performed / next release gates

No Production migration, publishing, service restart, settings/secret change,
real notification or real-record mutation was performed.

Before release:

1. Correlate the serving deployment's configured database with the exact
   Production primary resource; verify that connection is not a replica.
2. Use the inspected current recovery UI evidence and existing confirmation for
   that same resource; confirm operator recovery access and the applicable restore
   procedure. Do not repeat the request for backup-enabled screenshots.
3. Have the authorized operator execute the exact reviewed SQL through the
   supported primary-console/platform path and inspect all four function bodies,
   trigger bindings and enablement afterward.
4. Confirm a BRO-only release source and Publish preview, excluding the eight
   teacher Telegram statements and all other unauthorized changes.
5. Publish that corrected build, then perform read-only signed-in BRO/Owner checks
   of desktop/mobile navigation, options, lists and existing-record detail.
   Verify cross-BRO reads remain denied. Do not create a real lead or execute a
   real transfer merely to test the release; mutation protections have isolated
   PostgreSQL evidence.

Until these gates pass, live navigation/page/API verification and Production
protection verification are **not complete**.
