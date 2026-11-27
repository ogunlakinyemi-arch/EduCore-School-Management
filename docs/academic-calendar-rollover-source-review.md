# Automatic school academic-calendar rollover — source-only delivery

## Status and restrictions

Implemented as candidate source, **not enabled, migrated, runtime-tested or
released**. This extends the previous advance-authorization source preparation;
it does not change its independent financial approval model.

No application database was queried or modified. No migration, test, fixture,
app startup, workflow restart, browser or provider request was executed.
No saved school dates, credentials, webhook/merchant settings, operational
configuration or LIVE switches were changed. No publishing, deployment, merge
or push was performed.

## Rollover behavior

- Runs independently at normal API startup and every 60 seconds while that
  process is running. Existing Development worker pauses remain respected.
- Enumerates ACTIVE schools, rechecking each school's status under transaction.
  A suspended, pending or otherwise inactive school is not operationally reopened.
- Reads actual PostgreSQL time after taking locks; computes the Africa/Lagos
  date explicitly, independent of process timezone and database DateStyle.
- Uses only that school's saved session and term IDs/dates, with inclusive end
  dates. There are no fixed opening dates or academic-year limits.
- Activates the unique saved session containing today, and the unique term
  containing today within that session. A session can be current during a
  saved holiday gap without any current term.
- Closes ended PLANNED/ACTIVE periods as INACTIVE and removes outgoing current
  markers before activating the next session and then term.
- Catches up directly to today's state after missed runs/restarts; skipped
  periods are closed, never temporarily opened or replayed.
- Does not automatically reopen a due period explicitly marked INACTIVE.
- Existing future ACTIVE-but-not-current configuration is retained. Operational
  access still requires current + ACTIVE + actual saved date bounds; the worker
  never creates an early ACTIVE/current period.

No paid/free entitlement, staff subscription obligation, student placement,
promotion, notification, payment, transfer or refund is created by rollover.

## Completeness, edits and ambiguity

Before activation, the due session must contain exactly three saved terms with
recognized first/second/third names, unique ordinals and strictly ordered,
nonoverlapping date ranges contained in its saved session range. Supported
names include First/Second/Third Term, the corresponding Academic Term names,
Term1/2/3, 1st/2nd/3rd Term, standalone ordinal words and 1/2/3, with
case/whitespace/hyphen/underscore normalization.

This deliberately fails closed for unknown labels or other calendar models;
it does not guess missing terms or rename existing rows. A later incomplete
future session may be configured incrementally and does not by itself block
the current complete session; it cannot activate until complete.

All saved school-local period dates, nonempty names, known statuses, session
ownership, parent containment and overlaps are revalidated from fresh locked
rows on every run. Invalid/ambiguous calendars activate nothing, clear unsafe
current markers, close only objectively ended periods, and retain a BLOCKED
record. No dates are repaired, backdated or replaced.

The worker never executes a cached plan after edits. It shares the existing
financial gate -> per-school calendar lock order with calendar editors and
advance checkout revalidation. Candidate statement/row triggers coordinate
other ordinary calendar writers as well. Native partial unique indexes prohibit
multiple current sessions or terms in a school.

## Transactions, idempotency and audits

Each school has its own transaction. One failure does not prevent later schools
from being attempted. Transactions have bounded lock/statement waits; overlapping
in-process ticks are skipped. Multiple processes serialize through native gates.
The plan is rolled back if its observed Lagos date changes during application.

Calendar mutations, append-only rollover history and the existing general audit
entry commit together. History retains school, effective WAT date, wall-clock
recording time, before-calendar snapshot, exact from/to lifecycle changes,
material/source digests, issues and a unique deterministic event key.
History update, delete and truncate are rejected.

A converged valid calendar causes no writes, transition or new entitlement.
A retry after an uncertain committed response reads the converged state.
Unchanged invalid-calendar observations are deduplicated per date, material
digest and issue list. An initial invalid-marker cleanup can have a separate subsequent
stable BLOCKED observation; it does not repeat the lifecycle changes.

Calendar-level validation failures retain audit evidence. A missing schema,
unavailable database, lock timeout or failed audit write cannot be safely
recorded in that same database; it rolls back and emits a sanitized operational
warning for retry. Raw database/connection details are not logged by this worker.

## Preserved checkout and financial boundaries

No financial checkout/review implementation, fee/refund logic, grant logic or
provider configuration was changed by this request.

- Existing authenticated checkout remains the only initiator of collection.
- Actual saved term start/end dates are still independently checked at checkout;
  stale lifecycle markers cannot extend a collection window.
- Expected PLANNED-to-ACTIVE/current transitions preserve bound advance material
  evidence. Closing a previous term/session remains separately scoped.
- Material calendar edits still change retained advance evidence and require
  fresh Owner review, including changed-and-restored dates.
- The approved future authorization, exact reconciliation/student eligibility,
  NGN 3,200 rule and merchant/release gates remain required.
- Original seven-day current-term reviews are unchanged.
- Independent provider verification, refunds, free-term grants, original-school
  ownership and separate eligible NGN 150 BRO liability remain unchanged.
- Neither a term opening nor this worker enables LIVE or charges anyone.

## Test source authored — NONE EXECUTED

### 42 policy/source-contract cases

`artifacts/api-server/src/services/academic-calendar-rollover-policy.test.ts`

Nine opening cases cover all three term numbers in sessions starting in 2026,
2027 and 2028. Additional cases cover staggered school dates, before-start/
after-end checkout denial, final-day/session boundaries, holiday gaps, missed
terms, restart convergence, prior-session closure, missing/duplicate/reversed
term numbers, overlaps, parent containment, impossible/reversed dates, empty
names, unknown statuses, inactive due periods, incomplete future sessions,
calendar edits, tenant isolation, four UTC/WAT midnight boundaries, ordinal
names, expected advance-evidence preservation and sticky material revisions.
Source assertions retain the existing seven-day and financial gates and
exclude charge/entitlement writers from rollover.

### 16 transaction/worker mock cases

`artifacts/api-server/src/services/academic-calendar-rollover-service.test.ts`

Covers exact scoped writes and retained snapshots, restart/no-op idempotency,
a lost committed response, atomic audit failure rollback and retry, an edit
before the locked read, crossing a Lagos date during application, absent schema/
guards, busy/inactive schools, isolation, BLOCKED deduplication, bounded locks
and clock ordering, continued work after invalid data or a failed transaction,
sanitized errors and overlapping in-process ticks.

These mocks cannot prove PostgreSQL locking, trigger or financial semantics.

### 12 isolated native PostgreSQL cases

`artifacts/api-server/src/services/academic-calendar-rollover.isolated.postgres.test.ts`

Covers opening/previous-term closure with snapshots, idempotency, staggered
schools and native early/late activation rejection, incomplete calendars,
overlapping edits, previous-session closure, immutable history, atomic failure,
a genuinely concurrent calendar writer, preserved native advance approval then
material-edit denial, and additional first-/third-term opening calendars.

These use fictional Unix-socket-only lab data with the actual matched
JavaScript/PostgreSQL Lagos day **2027-01-18**, not a mocked SQL clock. The suite
is excluded from default discovery and has a dedicated configuration requiring
a credential-free no-egress namespace. No fixture, namespace or database was
created during this work.

The native advance probe exercises retained bindings/guards, not the complete
authenticated Owner submission/approval/browser flow or external merchant facts.

## Static checks actually executed

Credential-free commands:

1. `pnpm run typecheck:libs` — passed.
2. `pnpm --filter @workspace/api-server run typecheck` — passed.
3. `pnpm --filter @workspace/edupulse run typecheck` — passed.
4. `git --no-optional-locks diff --check` — passed.
5. Read-only changed-file manifest comparison and whitespace scan of both
   tracked and new files — passed; all 19 changed files matched this report.
6. Static TypeScript-AST inventory — 42 policy/source, 16 mock and 12 native
   authored cases; 70 total. This parsed source only and executed no test.

API TypeScript checking was repeated after final API/test-source revisions.
No OpenAPI contract changed, so code generation was unnecessary.
No tests, including pure tests, were executed. TypeScript success does not
validate SQL syntax, native locking, runtime scheduling or deployed behavior.

## Remaining blockers before an operational release

1. Separately authorize review and application of candidate 0187 and its native
   procedural/index definitions and application-role permissions. Do not apply
   it merely because the source exists.
2. Inspect any existing duplicate current markers before candidate index
   creation; duplicates deliberately make installation fail rather than
   authorizing automatic cleanup. No such inspection or repair occurred here.
3. Confirm each intended school's saved calendar completeness, labels, dates
   and explicit inactive statuses through authorized school administration.
   No data correction is included or implied.
4. Execute the authored tests only with separate permission, including the
   dedicated native lab/clock prerequisites. Complete routed/Owner UI acceptance
   and exact advance reconciliation evidence checks separately.
5. Verify application-role access to the new table, sequence and functions,
   audit retention, exact installed triggers/indexes and the intended published
   runtime. Catalog-name inspection is not a proof of function bodies or
   protection against privileged SQL.
6. Confirm a running API worker process and monitoring. In a healthy running
   process transitions are eventually reconciled on its one-minute tick, not
   guaranteed at the exact midnight millisecond. A stopped/scaled-to-zero
   process cannot run a timer; startup catches up and checkout fails closed
   while lifecycle markers are stale. No hosting or worker settings were changed.
7. Independently satisfy the existing merchant, Owner authorization, global
   release and provider-verification requirements before any real collection.

## Every changed file for this request

### Runtime and validation source

- `artifacts/api-server/src/normal-server.ts`
- `artifacts/api-server/src/services/academic-calendar-rollover-policy.ts`
- `artifacts/api-server/src/services/academic-calendar-rollover.ts`
- `artifacts/api-server/src/services/academic-calendar-rollover-worker.ts`

### Test source and isolation configuration

- `artifacts/api-server/src/services/academic-calendar-rollover.test-support.ts`
- `artifacts/api-server/src/services/academic-calendar-rollover-policy.test.ts`
- `artifacts/api-server/src/services/academic-calendar-rollover-service.test.ts`
- `artifacts/api-server/src/services/academic-calendar-rollover.isolated.postgres.test.ts`
- `artifacts/api-server/vitest.calendar-rollover-isolated.config.ts`
- `artifacts/api-server/vitest.config.ts`

### Candidate schema

- `lib/db/drizzle/0187_automatic_academic_calendar_rollover.sql`
- `lib/db/src/schema/academic-calendar-rollovers.ts`
- `lib/db/src/schema/edupulse.ts`
- `lib/db/src/schema/index.ts`

### Delivery and durable policy

- `docs/academic-calendar-rollover-source-review.md`
- `docs/advance-subscription-authorization-source-review.md`
- `.agents/memory/academic-calendar-rollover-policy.md`
- `.agents/memory/advance-subscription-authorization-policy.md`
- `.agents/memory/MEMORY.md`
