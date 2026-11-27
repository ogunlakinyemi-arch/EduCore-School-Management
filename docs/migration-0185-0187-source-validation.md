# 0185–0187 source corrections and disposable acceptance

**Status: source and tests authored; native, service and policy tests have not
been executed for this correction. This document is not migration approval.**

No application database, provider, credential, operational setting or release
flag is needed for static validation. Do not import/start the application to
typecheck these changes. Do not run native suites before their real date gates.

## Corrected source contracts

- 0185 evidence is an object, with a JSON string terminal status and a JSON
  numeric amount exactly zero. CASE protects the numeric cast; the resulting
  CHECK must be `IS TRUE`. Missing properties, SQL/JSON nulls, wrong JSON types,
  nonterminal states and fractional/nonzero amounts reject. The Drizzle CHECK
  matches the candidate.
- Aggregate retry rechecks its exact frozen allocation/review IDs, school,
  current/open session and term, student eligibility, rollout/free grants,
  reconciliation, rule, merchant and endpoint evidence. It uses the existing
  canonical advance evaluator without falling back after a terminal advance
  decision. Ordinary reviews use freshly collected dated evidence on the same
  pinned transaction with source locks, not their old saved digest alone.
- Revalidation occurs before any verification GET, again immediately before
  attempt insertion, and in a final durable dispatch-authorization transaction.
  Provider I/O remains outside SQL transactions. A known stale authorization
  sends no provider request; a change during GET blocks the subsequent POST.
  A failure after reservation retains `NOT_SENT` and does not auto-resend.
  It must not rewind independently confirmed/posted payment state.
- The final committed dispatch authorization is the ordering boundary. A later
  withdrawal cannot atomically recall an already authorized HTTP dispatch.
  There is no atomic PostgreSQL/Flutterwave transaction and no such claim here.
- 0186 guards raw aggregate retry insertion as well as initial allocations and
  direct attempts. It checks frozen reviews/current calendar/pricing and applies
  the same latest advance decision, window and revision checks. Native guards
  cannot discover fresh provider/merchant configuration outside PostgreSQL;
  application canonical revalidation remains mandatory.
- Both split evidence tables are in revision installation and runtime coverage
  checks. The operator-only `public.install_advance_subscription_guards()` installs
  missing known/prefix-matched guards and verifies existing ones without silently
  replacing a disabled or differently defined trigger.
- For a later-created authoritative table, the **separately approved creation
  migration must call that installer in the same transaction**. Application
  runtime only verifies and fails closed; it never installs guards. Existing
  deployments of an older 0186 need a separately reviewed forward migration,
  not a replay of this non-idempotent file.
- Candidate functions pin `pg_catalog,public,pg_temp` and remain invoker functions.
  `public` must not be writable by application/untrusted roles.
- 0187 retains immediate one-current unique indexes and pre-write serialization.
  It defers cross-row validation until transaction end, reading final stored
  rows, including after deletes and noncurrent-sibling mutations. Clear outgoing
  markers before activating incoming markers.
- A current session needs three complete, ordered terms. A saved due term must
  be ACTIVE/current. A genuine holiday may have no current term. An incomplete
  noncurrent session may still be configured. Current terms cannot outlive their
  current session. Calendar writes and deferred validation refuse RLS-filtered
  calendar visibility rather than elevate or certify a hidden subset.
- Deferred triggers validate the schools touched by calendar writes. Installing
  them does not retrospectively repair or certify untouched retained calendars;
  stale/malformed existing state still needs preflight review and the separately
  approved catch-up workflow. No migration-time calendar repair is included.
- Existing Admin session activation now pairs the saved due term in the same
  transaction; explicitly deactivating a current term clears its session marker.
  Changes are included in the existing actor audit transaction. New sessions
  should be saved noncurrent, their three terms configured, then activated.
  No dates/terms are invented and explicitly inactive due terms are not reopened.
  Before 0187 is installed, the coordinator leaves legacy CRUD behavior intact.
  Clearing a marker alone is not a permanent pause of the automatic worker.

## Explicit combined manifest

`artifacts/api-server/src/services/fixtures/finance-calendar-upgrade-manifest.json`
lists the prerequisite subset, candidate order, helper and dedicated config.
It does not discover arbitrary migrations.

The shared fixture installs the actual `bro_field_leads` parent declaration from
the retained BRO source before 0182. Its real 0182 FK is not skipped. The combined
fixture adds the calendar composite tenant key/FK needed by 0183. Optional split
tables remain deliberately minimal revision-source fixtures, not a financial
provider schema or complete reconciliation fixture.

The new native suite authors:

1. 0185 → 0186 → 0187 installation with populated legacy payment/commission and
   aggregate confirmation/allocation history, compared verbatim before/after.
2. A clone of the real 0185 CHECK for malformed evidence, plus positive zero cases.
3. The real 0182 missing-lead FK rejection.
4. Optional split evidence present during installation; a later-created split
   table that fails readiness until explicit installation; disabled-guard refusal.
5. Aggregate native retry acceptance and rejection after withdrawal, an EXPIRED
   decision, roster/split/pricing changes. Service seam tests separately check
   expiry/configuration/calendar/digest changes and that no checkout is sent.
6. Committed complete-calendar onboarding, failed final-state commits,
   sibling edits/deletes/moves, parent FK deletion, repaired intermediate states,
   due-term rollover and retained audit behavior.
7. A restricted fixture role: required revision INSERT/sequence permissions,
   RLS-filtered writes and role changes before deferred validation,
   temporary-table search-path shadowing, installer denial and denied TRUNCATE.
8. Injected failure immediately before 0187 COMMIT, explicit rollback, retained
   0185/0186 availability/history, then forward application of 0187 only.

These are **authored cases, not passing results**. Service tests use canonical
evaluator seams/mocks and are not proof of its PostgreSQL predicates. The
combined native fixture is not a full routed Owner/School Admin acceptance test.
An EXPIRED-decision case does not prove wall-clock crossing of a term end.

## Isolation and actual dates — unchanged

Use only a disposable Linux/WSL2 lab with preinstalled Linux Node 24,
PostgreSQL 16 and lockfile-compatible dependencies. Run nonroot within the
existing verified no-egress network namespace and a cleared environment.
Do not pass DATABASE_URL, database/provider credentials or use a Windows/shared
PostgreSQL service. Preserve `/proc`, loopback-only, route, socket/data-directory
and cleanup checks. Do not change clocks, dates or assertions.

Working directory: `artifacts/api-server`. Dedicated new config:
`vitest.finance-calendar-upgrade-isolated.config.ts`. It is excluded from the
ordinary config and calls the existing isolation guard before collection.
The new suite requires actual JavaScript **and** PostgreSQL Lagos day
**2027-01-18**. The existing bank/advance/calendar configs and their actual-clock
assertions remain in force. No native command was started for this change.

## Partial failure and recovery

Each candidate has its own transaction. The three-file sequence is **not**
atomic and cannot simply be rerun. A failed connection response is not proof
that COMMIT failed: establish the committed schema boundary independently before
retrying anything.

The authored injection proves only the intended *disposable* rollback boundary
when execution visibly fails before 0187 COMMIT, not ambiguous commit recovery,
backup restoration, process crash recovery or a populated production upgrade.
No such coverage is claimed as executed.

After a known 0187 rollback, retain committed 0185/0186 and financial evidence.
Review the cause and forward-apply only the absent approved file. Do not restore
0185's old NOT NULL/uniqueness assumptions by deleting bank rows or reused
allocations. Do not truncate history, reprice payments, or run a down migration
to manufacture a clean result.

## Remaining approval evidence

- Native execution on the genuine required date in the approved isolated lab.
- Real application-role grants, sequences, RLS/default ACLs, schema ownership,
  search path and installed function/trigger definitions. A fixture superuser
  or its synthetic restricted role cannot certify deployed permissions.
- No TRUNCATE/DDL/ownership authority for application roles on retained history
  or revision sources. 0185/0186 UPDATE/DELETE history guards are **not** universal
  owner/superuser TRUNCATE protection. 0187 additionally rejects calendar/history
  truncation. Do not infer privilege safety from the SQL files alone.
- Representative full-schema retained-history upgrades, mixed/partial versions,
  the complete source-table catalog, lock contention and recovery drills.
- Canonical end-to-end retry revalidation and authenticated Admin onboarding/
  edit/rollover acceptance, including callbacks racing a blocked dispatch.
- Real term-end clock-boundary acceptance and abnormal fixture-process cleanup.

No publish/deploy, merge/push, LIVE enablement, settings/credentials change,
application database migration/query or Flutterwave request is authorized here.

## Static validation performed for this correction

- API TypeScript checking, with no emit and incremental output disabled.
- Database library TypeScript checking, with no emit, composite output disabled
  and declaration typing explicitly enabled to preserve its compiler contract.
- Syntax parsing of all 19 changed/new TypeScript files.
- Static equality of the 0185 and Drizzle evidence CHECK expressions.
- Static installer coverage of all 23 declared authoritative reconciliation
  source names, including prefix-covered sources.
- Manifest JSON/order/path checks and function search-path header checks.
- Confirmation that the existing isolation utility/configs and actual-date
  assertions were unchanged, plus `git diff --check`.

These checks did not import application modules, execute tests, validate
PL/pgSQL inside PostgreSQL, start a database, or contact any provider. They do not
replace the acceptance evidence listed above.
