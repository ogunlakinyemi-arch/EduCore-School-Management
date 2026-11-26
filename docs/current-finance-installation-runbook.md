# Current-finance source installation procedure and rehearsal

## Status and authority

**Unexecuted application-database candidate. Not approved for installation.**

This runbook chooses exactly one source path: **0181, then 0182**, unchanged.
It is not a Production migration runner, a Publish hook or a ledger repair.
The executable harness can address only a newly created private local fixture.
It accepts no connection string, host, role, database or arbitrary SQL arguments.

On 2026-11-26, static validation was possible, but Linux network-namespace creation
was denied (`unshare: Operation not permitted`). The harness therefore refused
before initdb, cluster creation or SQL execution. **No real PostgreSQL rehearsal
has been completed for this procedure.** Available PostgreSQL binaries alone
are not evidence of a safely isolated or successful rehearsal.

Neither application database was queried or changed in preparing this runbook.
Nothing was published. There were no provider calls or persistent environment,
secret, subscription-rule or payment-control changes.

Actual validation results:

| Check | Result |
|---|---|
| Static contract/order/isolation tests | 7 passed |
| Schema/source parity tests, including index NULL ordering | 24 passed |
| Database-package TypeScript check | Passed |
| Syntax checks for all six harness modules | Passed |
| Pinned source/package validation (`--static`) | Passed |
| Real rehearsal (`--rehearse`) | Blocked at isolation probe; exit 2; zero SQL |
| Whitespace/diff validation | Passed |

An initial static assertion incorrectly matched a safety comment containing a
credential variable's name. Its check was narrowed to actual environment access;
the final seven-test run passed. No mock database or socket-only fallback was used.

## Exact installation inputs

| Order | File | SHA-256 |
|---|---|---|
| 1 | `lib/db/drizzle/0181_current_subscription_lifecycle.sql` | `dd9c559b3d43b18801e090cd567de32d04f605bea2d35987368a1a78bf9273fe` |
| 2 | `lib/db/drizzle/0182_current_bulk_withdrawals_field_sms.sql` | `acdcf3d7ef2ad1671be347fc0d4477d72ad7425e66144c2fd779eb14d7dedacf` |

0181 supplies three lifecycle tables and their three history triggers.
0182 supplies five bulk-payment, three withdrawal and four field-SMS tables,
the two additional operations columns, replacement source CHECK, indexes,
bulk-scope function and fourteen further triggers. It reuses the existing
immutable-history function without replacing it.

**Do not put `current.functions.sql` or `current.triggers.sql` into this sequence.**
They are alternative repair packets, not additional dependencies. In particular,
the function packet followed by unchanged 0182 causes a duplicate CREATE FUNCTION.
The harness demonstrates that only as a deliberately failing fixture scenario.
It never uses those packets to complete the successful source installation.

The source-defined constraints, names, defaults, FKs and procedural bodies are
not rewritten. The Drizzle descending event index now explicitly specifies
NULLS FIRST, matching PostgreSQL's source-DDL default for `id DESC`.

## Reproducing static validation

Run from the workspace root. The clean environment below is private to the
validation process; it does not edit Replit environment variables or secrets.
The executable-discovery step avoids wrapper-injected environment variables.

```sh
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  "$(env -i PATH="$PATH" node -p 'process.execPath')" \
  scripts/src/current-finance-rehearsal/cli.mjs --static

env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  "$(env -i PATH="$PATH" node -p 'process.execPath')" \
  --test scripts/src/current-finance-rehearsal/offline.test.mjs

env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  node --import ./scripts/node_modules/tsx/dist/loader.mjs \
  scripts/src/current-finance-schema.test.mjs
```

These commands do not run PostgreSQL. They check source hashes, packet consistency,
the selected order, schema parity (including index null ordering), restrictions
on credentials/targets, and the read-only verification implementation.
Pure identity-validator tests are static checks, not mocked PostgreSQL evidence.

## Running the REAL rehearsal in a capable environment

**Not yet successful here. Do not remove the isolation gate to make it run.**

Requirements: Linux `/proc`, working unprivileged network namespace creation
through `unshare --net --fork`, PostgreSQL 16 `initdb`/`pg_ctl` binaries, Node and
the repository's installed dependencies. Do not install packages or change
host permissions as an automatic fallback.

```sh
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  "$(env -i PATH="$PATH" node -p 'process.execPath')" \
  scripts/src/current-finance-rehearsal/cli.mjs --rehearse
```

Exit 2 with `BLOCKED: network isolation unavailable` is a blocked rehearsal,
**not a pass**. Exit zero is required, along with the real-PostgreSQL case results.
Internal `--isolated-child` is not an operator mode.

The harness:

1. Rejects inherited configuration and accepts only PATH/HOME/LANG/NODE_ENV.
2. Checks namespace capability before loading the SQL runner.
3. Starts its child in a new network namespace, verifies namespace/parent identity,
   and permits only its private Unix-domain PostgreSQL socket. There is no TCP
   listener, application pool, URL fallback, fetch, TLS or provider access.
4. Creates a fresh temporary cluster; checks its PID file, private data directory,
   socket, port and SQL server identity before fixture setup.
5. Installs fictional prerequisite fixtures and the existing protection SQL.
   These are not a Production clone or account/merchant simulation.
6. Uses `finance_rehearsal` / `neondb_owner` with explicit `public, pg_catalog`
   search path, 3-second lock timeout and 30-second statement timeout.
7. Stops and deletes only its own disposable cluster in `finally`.

Do not terminate the process forcibly during cleanup. If it is interrupted,
identify the printed/local temporary cluster before stopping it; never reuse
an application database connection to clean up a failed rehearsal.

## Ordered procedure being reviewed

This is the logical source procedure for the isolated rehearsal, **not permission
to apply raw structural SQL to Replit-managed Production**. Structural delivery
there remains subject to the supported Publish workflow and a reviewed full
schema diff. No application-target execution command is provided.

### A. Preflight — fail closed, no target changes

- Confirm exact reviewed file hashes and all inputs are present.
- Establish independent target/session identity and recovery authorization.
  Existing Owner resource/recovery confirmations are not discarded; current
  writability and a usable recovery point are separate checks.
- Check role/session role, PostgreSQL version, primary/writable state, exact
  effective search path, schema privileges and operation timeouts.
- Check all referenced IDs have the intended types and valid unique keys.
  Preserve the integer `bro_field_leads.id` and source bigint SMS references.
- Run existing `student.verify.sql` and `free-terms.verify.sql`: expect all
  23 and 7 rows respectively to match.
- Capture retained data and catalog/procedural definitions for later comparison.
- Require all 15 targets, their sequences/index names and conflicting row types
  to be absent. Require `guard_current_bulk_scope` to be absent, including overloads.
  Check unexpected schemas too. Complete and partial installations both stop.

The fixture guard intentionally requires its newly-created data directory and
database name. It cannot be repurposed as an application-target preflight merely
by supplying a different environment variable.

### B. Execute unchanged 0181 in its own transaction

Then check, read-only:

- All three lifecycle tables and three source history triggers exist.
- `current_subscription_operations_check` exists with the original contract.
- `current_subscription_source_ck` and the two bulk-source columns are absent.
- The bulk function is still absent. No procedural packet is inserted here.

Do not proceed after an error, missing object, renamed CHECK or unreviewed change.

### C. Execute unchanged 0182 in its own transaction

This extends operations and creates the bulk function exactly once. It installs
all 12 extension tables and their protections; this does not authorize SMS.
It neither creates nor activates subscription rules.

**The files commit separately.** An 0182 failure does not roll back an already
committed 0181. Do not use an outer `--single-transaction` assumption: their
embedded transaction commands do not provide cross-file atomicity.

### D. Read-only post-install verification

The harness invokes `catalog.mjs` and the existing verification packets inside
`BEGIN READ ONLY`, ending with ROLLBACK. The verifier issues SELECT and EXPLAIN
SELECT without ANALYZE, never repair SQL.

It compares the actual catalog with the unchanged source contract:

- Every column's order, type, nullability, default and serial-sequence link.
- PK, UNIQUE, FK and CHECK definitions/names; validated/nondeferrable state.
- Foreign-table/schema/column identity, delete/update actions and MATCH SIMPLE.
- All standalone and constraint-backed indexes: names, columns/order, NULL
  positioning, predicates, uniqueness, method and valid/ready state.
- Table kind, owner and unchanged source RLS defaults.
- Exact function properties/bodies and all trigger bindings/events/enablement
  through the existing packets: current **34/34**, student **23/23**, free **7/7**.
- Retained fixture rows and existing catalog/function/trigger definitions unchanged.
- All 15 newly installed fixture tables initially empty.

PostgreSQL EXPLAIN canonicalizes the expected and stored CHECK/default/predicate
expressions; it does not run the SELECT. This comparator has been statically
checked, but its PostgreSQL execution is still unvalidated because isolation
was unavailable. Do not treat a partial packet pass as structural approval.

## Rehearsal cases implemented, NOT yet executed on PostgreSQL

- Fresh prerequisites and existing protections.
- Missing parent, disabled protection, conflicting relation and conflicting type.
- Wrong role or search path.
- Injected pre-COMMIT failure in 0181: complete phase rollback.
- Wrong order: 0182 without 0181 fails.
- Committed 0181 partial state: fresh-install preflight refuses to proceed.
- Injected failure in 0182: its tables/columns/check replacement roll back;
  committed 0181 remains intact.
- Wrong predecessor CHECK name.
- Separate bulk-function preinstallation: expected duplicate-function failure.
- Correct 0181 → 0182 order and read-only post-verification.
- Entirely rolled-back behavioral probes for immutable history, free-term
  mutation refusal, invalid state and invalid allocation scope.
- Already-complete preflight rejection; raw reruns fail and roll back unchanged.
- Verification detects a removed CHECK, disabled trigger and unexpected index.

The raw source files remain intentionally non-idempotent. The safe operator
rerun policy is **stop without changes**, inspect and verify; never “catch and
continue,” auto-drop, auto-recreate, or silently skip mismatched objects.

## Ledger handling — separate by environment

Do not rewrite either historical ledger to make it resemble the other.

- **Development:** inspect its Drizzle history and catalog separately in a future
  approved read-only session. A repository filename does not establish application.
  This fixture harness writes no Drizzle ledger entry.
- **Production:** platform-managed migration history is not the Development
  ledger. Do not insert synthetic Drizzle rows or modify platform system tables.
  Preserve the actual reviewed Publish evidence and separate procedural evidence.
- Record the reviewed source hashes and verification results as an operator
  record outside the historical database ledgers. This is not payment approval.

## Recovery and remaining approval gates

Before any later application-database installation, a separate review must
approve the delivery route, exact full diff, writer/worker coordination and
resource-bound recovery procedure. Check that the intended pre-change PITR point
is available; do not invent a backup ID or build an in-app backup system.

- Before either source commits: rollback that transaction and verify preservation.
- After 0181 commits but 0182 fails: retain the partial schema, keep the features
  and payments blocked, capture the error/state, and review recovery. Do not
  automatically drop the lifecycle tables or run a down migration.
- After both commit: do not assume dropping 15 tables is safe. They may contain
  newly written financial evidence. Freeze relevant writers with explicit
  authorization, reconcile any financial/external events, and use an approved
  forward repair or recovery operation. A database restore does not undo charges,
  refunds, transfers or notifications outside PostgreSQL.
- The fixture's cleanup is disposable-resource deletion only; it is NOT a
  Production rollback plan or restore drill.

Still blocked: real PostgreSQL rehearsal, executable catalog-comparator evidence,
application-target execution approval, reviewed supported structural delivery,
and subsequent payment/provider acceptance. Keep the free current term, each
school's actual January 2027 paid-term boundary and every LIVE/send gate intact.
No deployment, rule activation, provider call or payment enablement is authorized.
