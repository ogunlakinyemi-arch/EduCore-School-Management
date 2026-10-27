# Guard repair 0179 — source-only, not applied

## Scope and authority

`lib/db/drizzle/0179_restore_direct_and_bro_guards.sql` restores four functions
and nine triggers from the unchanged approved 0176–0178 SQL. It introduces no
new financial predicates, amounts, rollout dates, eligibility rules or provider
configuration. In particular, the attempt guard freezes identity and terminal
states; it does **not** invent an additional nonterminal transition matrix.
Application-level eligibility checks remain separate and unchanged.

The transaction uses CREATE OR REPLACE, bounded lock/statement timeouts, public
schema-qualified object names and explicit normal trigger enablement. It requires
PostgreSQL 14+. No row updates, destructive downgrade, startup DDL, release hooks,
credential handling, Production launcher or migration-ledger edits are included.
An incompatible same-name function signature is a blocker, not permission to
drop it. A failed transaction rolls back the complete repair.

## Why an empty structural diff was insufficient

The actual latest Publish preview emitted table/column/constraint/index SQL but
not these PL/pgSQL functions/triggers. The platform ledger recorded those emitted
statements, not execution of every statement in the repository's SQL files.
The subsequent structural diff was empty while catalog inspection showed four
functions and nine triggers absent. This is an observed procedural coverage gap,
not evidence that a specific internal platform component has been diagnosed.
This project cannot change the hosted diff generator.

`inspectFinancialGuards` now performs independent SELECT-only catalog verification:
all four zero-argument public trigger functions, exact approved bodies (only outer
whitespace/line endings normalized), language, volatility, invoker security,
strictness/leakproof/configuration, plus all nine table/function bindings, events,
BEFORE ROW timing, normal enablement, no WHEN filter, arguments, constraint or
column restriction. Direct release and BRO storage readiness use their respective
contracts. No readiness check creates or repairs schema.

`docs/direct-release-schema-preflight.sql` now explicitly enumerates every expected
guard and reports missing/misbound/disabled/wrong-event objects even if all tables
exist. Its inventory boolean is **not** full body/semantic certification; use the
definition-level contract as well. An empty structural diff must never override
a failed procedural check.

The existing Drizzle schema models tables/constraints; these guard definitions
are raw SQL migration objects rather than declarative function/trigger models.
Adding another SQL file alone therefore cannot establish that Publish will emit
it. No schema-generator or deployment configuration has been changed to bypass
the supported release mechanism.

## Isolated validation

From the workspace root:

```sh
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  node scripts/src/financial-guards-native-check.mjs
pnpm --filter @workspace/api-server exec vitest run \
  src/services/financial-guard-schema.test.ts \
  src/services/runtime-database-identity.test.ts \
  src/services/bro-commission-policy.test.ts \
  src/services/direct-student-live-payments.test.ts
pnpm --filter @workspace/api-server run typecheck
```

The native runner accepts no connection/target arguments, rejects inherited
application/DB/provider variables, creates a fresh Unix-socket-only PostgreSQL
cluster and independently verifies its PID/data directory/socket/SQL identity.
It compares 0179 and the runtime contract to approved source, exercises actual
guard behavior and rollback/idempotence on fictional populated rows, and removes
the fixture. This is not a Production clone or application-role permission proof.

### Validation recorded during source preparation

- 26 isolated guard-repair/behavior checks passed.
- 9 existing isolated BRO commission checks passed.
- 36 existing isolated financial route integration tests passed.
- 59 focused guard, runtime-identity, BRO and direct-payment unit tests passed.
- 7 existing migration/CHECK regression tests passed.
- API TypeScript check passed.

Validated 0179 SHA-256:
`09e2f989c23d80d580bc2428ddd38b962715f11d0c70700e975ab5ca9809c21b`.
Recompute and compare this hash before future review/application; these results
do not certify a later modified artifact, a serving-primary binding or a live
Production upgrade. No shared Development or Production database was changed.

## Runtime identity

`DATABASE_RUNTIME_IDENTITY` reports a configuration fingerprint, **not** proof of
connection, provider identity, a primary endpoint or resource binding.
`platformDatabaseResourceId` stays null and `targetBindingVerified` stays false.
Explicit UNVERIFIED/UNAVAILABLE status and the reason
`AUTHORITATIVE_INFRASTRUCTURE_MAPPING_UNAVAILABLE` distinguish missing mapping
evidence from a failed connectivity test. Neither successful SELECT 1, K_REVISION,
nor an environment variable claiming verification can establish that mapping.
No connection strings, hosts, users or credential values are logged.

## Exact next approval needed — Production remains blocked

Do **not** run this file against Production, add a custom Production migration
runner, add build/startup hooks, edit the platform ledger, or assume an ordinary
republish will install it. Managed Production schema changes must use Replit's
supported Publish mechanism. The observed structural diff omitted these objects.

1. Obtain confirmation from Replit's supported release tooling/platform support
   of a supported mechanism that includes these exact procedural definitions.
   **Until that mechanism is available and the actual reviewed plan includes all
   four functions and nine triggers, application to managed Production is blocked.**
2. Independently reconcile the serving runtime fingerprint/revision with
   authoritative database resource/primary metadata, using existing operator
   evidence. Verify the resource-bound recovery point and approved isolated
   restore target; do not substitute the replica name for binding evidence.
3. Capture the exact artifact SHA-256, catalog/data/ledger baselines and actual
   runtime-role permissions. Rehearse the approved supported plan against an
   authorized isolated copy of that baseline, including transactional failure,
   retained history and application-role checks. Stop on differences.
4. Obtain separate, explicit Owner approval for that exact supported Production
   release plan/window and recovery procedure. The Owner then initiates the
   supported Publish flow only if its reviewed procedural plan matches.
   This source-preparation request is **not** that approval.
5. After authorized application, independently recheck the serving primary and
   replica catalogs, all 13 definitions/enablement, ledger and retained financial
   history. Keep LIVE disabled; this guard repair does not authorize payments.

An external-primary workflow is not an alternative unless authoritative evidence
first proves the app uses a non-managed primary and the Owner separately approves
that documented operator workflow. No such binding or authority is inferred here.
