# Current finance: source-only schema reconciliation

## Boundary

This stage changes TypeScript schema metadata only. It does not establish an
applied migration, database compatibility, recovery readiness or payment release.
No application/service behavior, protection SQL, migration ledger, schema-write
gate, environment variable or provider configuration is changed.

## Sources and active models

The final structure of `0181_current_subscription_lifecycle.sql` followed by
`0182_current_bulk_withdrawals_field_sms.sql` is represented by:

- `current-subscription-lifecycle.ts`: three lifecycle tables, including the
  final `current_subscription_source_ck`, parent self-FK, reference-claim
  composite primary key and descending event-order index.
- `current-bulk-payments.ts`: five bulk tables.
- `current-bro-withdrawals.ts`: three withdrawal tables.
- `current-field-sms.ts`: four SMS evidence tables; no transport activation.

All are exported by the existing active schema barrel. No previous export was
removed. Column/constraint/index names, CHECK expressions, defaults, nullability,
FK targets and delete actions follow the SQL sources, not the older candidate.
In particular, NO ACTION is retained where the SQL does not request RESTRICT;
this reconciliation does not invent stricter financial rules.

`current-finance-prerequisites.ts` replaces the four ID-only candidate stubs with
five complete models: direct reviews, obligations, attempts, direct BRO
entitlements and field leads. Obligations are included because attempts and
entitlements reference them. Sources are 0176, 0178 and
`lib/db/dev-reconciliation/bro-field-operations.sql`. Field lead IDs are serial
(integer); the existing source's bigint SMS FK columns are retained.

`src/candidates/current-finance.ts` is now a compatibility re-export of the same
15 active table objects, not a second collection of models.

## SQL installation ordering: unchanged and still gated

All requested SQL packets exist. No migration or procedural packet was edited
or regenerated in this stage.

- The complete source-fixture path is 0181, then 0182. Those files already create
  the current function and triggers; the separate procedural packets are not
  additional required steps on that path.
- The procedural repair path is `current.functions.sql`, then
  `current.triggers.sql`, **after a separately approved structural delivery**.
  The trigger packet validates the shared history and bulk-scope functions.
- Do not install `current.functions.sql` before running unchanged full 0182:
  its plain CREATE FUNCTION would conflict. Neither structural source is a safe
  rerun/reconciliation installer. Their separate COMMITs are not cross-file atomic.

A merged installer, historical migration-ledger repair and changing the
one-time SQL sources would require a separately reviewed delivery procedure and
isolated executable SQL evidence. This stage deliberately does not make those
changes or claim the ordering conflict has disappeared.

Replit-managed structural delivery still requires the reviewed Publish flow.
Functions/triggers are separately tracked procedural objects; active ORM
metadata does not cause them to be installed. Never add startup/build DDL or
re-enable push/push-force as a workaround. The newly active models affect future
offline exports, so review a fresh full schema diff before any later release.
Existing raw-SQL objects elsewhere in the project still need to be accounted for;
this is not a claim that every historical database object is now in Drizzle.

## Offline evidence

Run from the workspace root, without inherited credentials:

```sh
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  node --import ./scripts/node_modules/tsx/dist/loader.mjs \
  scripts/src/current-finance-schema.test.mjs

env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  node --test scripts/src/schema-tooling-policy.test.mjs

env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 \
  ./node_modules/.bin/tsc -p lib/db/tsconfig.json --noEmit \
  --tsBuildInfoFile /tmp/educore-db-source-reconciliation.tsbuildinfo
```

The schema tests block network/socket/fetch access before importing pure schema
modules. They compare all 20 complete models to the exact repository SQL source
definitions, verify active-model FK parents/no duplicates, check write gates,
and compare all existing generated protection/verification packets unchanged.
The reader is deliberately limited to this source dialect, not a PostgreSQL
engine; passing it does not certify executable DDL or actual database catalogs.

Results for this stage:

- 24 source/metadata tests passed.
- 8 tooling-policy tests passed.
- Database-package TypeScript check passed.
- Credential-free dependency-ordered full schema export passed: 218 tables,
  1,405 statements assembled in memory; no SQL executed or migration file written.

An initial offline test exposed the reader's wrong default-name assumption for
an inline CHECK referring to two columns. The reader was corrected; the model's
existing PostgreSQL-style name was preserved.

No database-connected tests, application startup, browser flows, payment
sandbox calls or LIVE calls were run. Existing student/BRO/free-term SQL and
verification files remain untouched. No Development or Production SQL was
executed, and nothing was published.
