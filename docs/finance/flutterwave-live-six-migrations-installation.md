# Six Flutterwave LIVE migrations: safety review and installation runbook

Date: 2026-10-26. This supersedes the two rollback findings in
`bobadex-verification-production-draft-review.md`, not its historical file hashes.

## Status

**Draft-code safety fixes and source-derived rehearsal: PASS.**
**Production target/recovery certification and installation approval: PENDING.**

No application Development or Production DDL/DML was executed. No secrets,
payment settings, release approvals, subaccounts or publishing were changed.
All executable rehearsal DDL ran only in a newly created, identity-checked,
temporary Unix-socket PostgreSQL cluster with no application connection string.

## Fixes

### Workflow rollback

`flutterwave-live-workflow.down.sql` now checks every locked evidence root:
intents, authority reviews, Partner accruals, activations, official receipts,
commission batches, commission items, workflow audits and reconciliation cases.
A commission batch or audit cannot be discarded merely because no intents exist.
The Partner-accrual table is also locked before changing its trigger. All checks
and drops remain in one transaction. Local lock/statement limits are 5s/30s.

### Runtime rollback

`flutterwave-live-runtime.down.sql` acquires ACCESS EXCLUSIVE locks on all four
runtime tables **before** checking emptiness and keeps them until commit.
Its local lock/statement limits are 5s/30s. An earlier writer must finish before
the check; committed evidence then makes rollback refuse. A later writer cannot
commit between the emptiness check and DROP. If lock acquisition times out, the
transaction fails closed rather than dropping a subset of tables.

Both down scripts remain **empty-only rollback tools**, not recovery mechanisms
for populated business history. Never remove their checks, disable triggers or
use cascading drops to force a rollback.

## Executed tests

Command:

```sh
pnpm --filter @workspace/api-server exec vitest run \
  src/services/flutterwave-live-six-migrations.postgres.test.ts \
  src/services/flutterwave-live-workflow.e2e.postgres.test.ts --reporter=dot
pnpm --filter @workspace/api-server run typecheck
git diff --check
```

Results: **120 tests passed across two files; API typecheck and diff check passed.**
The new migration suite contains 13 cases, including:

- The complete current declared schema: **189 canonical tables, 696 canonical
  foreign keys, 1,258 source statements**. No hardcoded historical schema counts.
- All six exact forward drafts applied in order, creating 21 LIVE tables.
  All constraints validated; both release tables stayed empty.
- Empty six-draft reverse order and complete forward reapply.
- Standalone commission batch, audited standalone batch and independent authority
  review all refuse workflow rollback and retain their records.
- Each of the four runtime evidence tables independently refuses rollback.
- A runtime writer that started first commits its record; waiting rollback then
  sees that record and refuses.
- A writer arriving after rollback locks are held remains blocked; after the
  empty-table drop it receives a relation-missing error, not a lost successful
  insert. The test pauses at the exact script's lock/check boundary without
  changing its SQL.
- Real lock timeout leaves all runtime tables intact.
- A concurrent workflow batch writer commits; waiting rollback refuses and keeps
  the batch.

Every case compares all canonical table rows, canonical indexes and canonical
constraints with the fixture baseline, including a historical TEST subscription.
Separate pinned sessions, observed pg_locks state and explicit transaction cleanup
are used for concurrency tests. All temporary case databases and the cluster are
removed afterward.

This is stronger than the earlier minimal fixture, but it is still a
**source-derived representative schema, not a restored Production copy or proof
of Production permissions, data recovery or target binding**.

## Production observations and certification boundary

Read-only inspection returned:

- Database name: `neondb`; `pg_is_in_recovery()=true`;
  `transaction_read_only=on`.
- Zero public `flutterwave_live_*` tables.
- No collisions for the forward drafts' public table/index/zero-argument
  function names.
- Required canonical `app_users.id`, `schools.id` and
  `settlement_payroll_profiles.id` exist as single-column integer primary keys.

These are observations from **Agent replica access**. They neither identify a
writable primary nor establish the deployed application's private binding.
The database name alone does not establish hosting provider.

The available read-only interface does not expose an actual selectable Production
PITR timestamp/backup record. Earlier operator confirmations are not invalidated,
but this run cannot independently certify their current availability. **Do not
claim primary/recovery confirmation or begin installation based on this report.**

## Operator confirmation — no writes or restore required

1. Open **Tools → Replit Cloud → Database → Production Database → Settings**.
   Privately match the selected database resource/connection target to the
   deployed application's actual database binding. Do not paste credentials or
   connection strings into chat.
2. Inspect the selected Production database's available PITR range and recovery
   controls. For scheduled backup evidence: **Settings → Advanced → Scheduled
   backups → View all backups**. Identify an existing restorable point, its
   database association and timestamp/time zone. Record a pre-change point in
   UTC; Africa/Lagos is UTC+1. A schedule enabled or a documented retention limit
   is not evidence that a particular completed restore point exists.
3. Do not press Restore, type the restore confirmation, change retention or
   schedule settings, or restore the live database as a readiness test.
4. For a later approved installation, Replit's operator editing path is
   **Production Database → My Data → Enable Editing → SQL console**.
   This does not make Agent's replica writable and is not a substitute for
   verifying the selected target.
5. In the intended operator SQL session, confirm:

   ```sql
   SELECT current_database() AS database_name,
          pg_is_in_recovery() AS in_recovery,
          current_setting('transaction_read_only') AS transaction_read_only,
          current_schema() AS selected_schema;
   ```

   Require the independently approved resource, primary (`in_recovery=false`),
   read-write session (`transaction_read_only=off`) and intended public schema.
   If any check is wrong, **stop**; never force read-write mode on a replica or
   replace database secrets to bypass the failure.

## Exact installation sequence — only after separate approval

1. Approve the target, exact file hashes below, available recovery point, operator,
   compatible application version, preservation baseline and maintenance window.
   Verify CREATE privileges in the target schema and REFERENCES privileges on
   the three canonical parent tables through the operator's actual role.
   Coordinate concurrent application activity without changing payment flags.
2. Recheck existing objects and partial-installation state immediately before
   execution. These are one-shot drafts: an existing table, function, index or
   prior stage is a reason to stop and reconcile, not use IF NOT EXISTS or rerun
   everything. Review any separately generated deployment/schema proposal so it
   cannot subsequently drop manually installed LIVE tables.
3. Use a verified primary SQL session. The Replit SQL console can run the whole
   file in one **Run**; do not execute statement fragments across pooled sessions.
   If session/transaction behavior is uncertain, use an approved SQL client with
   private Settings connection details, explicit stop-on-error behavior and
   guaranteed transaction cleanup. Agent must not execute these against its replica.
4. Before each whole-file execution, in that same operation/session establish:

   ```sql
   SET search_path = public, pg_catalog;
   SET lock_timeout = '5s';
   SET statement_timeout = '60s';
   DO $$
   BEGIN
     IF current_database() <> 'REPLACE_WITH_VERIFIED_PRODUCTION_DATABASE_NAME'
        OR pg_is_in_recovery()
        OR current_setting('transaction_read_only') <> 'off' THEN
       RAISE EXCEPTION 'Approved writable Production primary required';
     END IF;
   END $$;
   ```

   Replace the database-name placeholder only from the independently verified
   target. That name/guard is necessary, not sufficient, target evidence.
   Do not change the reviewed DDL. Apply each complete file, including its own
   BEGIN and COMMIT, in this order:

   1. `lib/db/dev-reconciliation/flutterwave-live-webhook-inbox.up.sql`
   2. `lib/db/dev-reconciliation/flutterwave-live-finalization.up.sql`
   3. `lib/db/dev-reconciliation/flutterwave-live-workflow.up.sql`
   4. `lib/db/dev-reconciliation/flutterwave-live-readiness.up.sql`
   5. `lib/db/dev-reconciliation/flutterwave-live-runtime.up.sql`
   6. `lib/db/dev-reconciliation/flutterwave-live-school-onboarding.up.sql`

   School onboarding independently depends on the existing canonical user,
   school and settlement-profile keys; placing it last is a reviewed valid order.
5. Inspect each result before continuing. Each file commits separately; the six
   files are **not one atomic transaction**. On any error, stop, explicitly
   ROLLBACK on the same session, verify actual installed state and preserve
   already committed stages. Never retry blindly or automatically run down scripts.
6. Verify 21 expected LIVE tables, expected indexes/constraints/history triggers,
   no unvalidated constraints, unchanged canonical preservation baseline, and
   **zero rows in both release tables**. Verify all three school-onboarding
   history/audit triggers are enabled. Retain a private execution record of file
   hashes, operator, UTC times and before/after observations.
7. Leave all financial/provider activation separate: do not insert enabled release
   rows, approve school authority, set LIVE mode/enablement flags, create
   subaccounts, collect payments, transfer funds or publish.

If an empty-only reverse is later approved, the order is school-onboarding →
runtime → readiness → workflow → finalization → inbox. Any retained LIVE evidence
requires a new preservation/recovery plan, not destructive rollback. PITR also
rewinds legitimate data changes and must not be used casually; database restore
and code rollback are separate coordinated operations.

## Package identities (SHA-256)

All six forward hashes and four other down hashes are unchanged.

```text
webhook-inbox up   ab644e6a38bdd1d9d4ef63f52cd971a05153e777b65d730567dac1ed231f874d
webhook-inbox down fd3475aa057a05f8c6dd7bace8e8ae8a47e64366240839be2631ab94cf9f3d39
finalization up   62f70bc39f92852fd8219b0da063fc2299f3530fd8a4356fe197049f40eb4b1a
finalization down 0914fc1b11c8fbce2f8cadfd11e7da23788b34537919c14c7f28f3a3b5843cc5
workflow up       a7e83947d2338d762a1830814d68f2be470e19866c46be84a8bccfad08d3c67a
workflow down     05a2d79bd56284ab49566243e2cf66dad417a717896ce117bc77d69752148e74
readiness up      88e4bfa3eae084e6072b33d77125f9dc17bc74d5445fea1b28458522d9991a8c
readiness down    98b933998cc2e12e531267e72a8f70023ae7f8b2d1744cc7ef4ad101a006495f
runtime up        27754570bba1743944516b4200c9ca5198754d5d19076917788b46b958d2b77c
runtime down      2dab746225a292fa56fe78b3383c49b0b791ed749211eb845b649b8459c64b02
school-onboarding up   6808b70544f2f417b7ce2e39195301ae29fbb6781194fb1d0f62b58b3acc53f3
school-onboarding down 645b090cf28102bf0e4c41c4de2056437432136b578d1759db09358a5e3a2b98
```

Official Replit references:

- https://docs.replit.com/features/data-and-storage/work-with-your-data
- https://docs.replit.com/features/data-and-storage/connection-details
- https://docs.replit.com/features/data-and-storage/data-recovery
