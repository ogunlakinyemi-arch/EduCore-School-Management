# Flutterwave LIVE application redesign — development slice

Status: **partial implementation, NOT a Publish-ready replacement**.
Original SQL, rollback companions, manifests and Production review package are
unchanged. No schema application, data conversion or LIVE activation is authorized.

## Responsibility map (before removing any database protection)

The six files contain nine functions and twenty triggers, not six functions.

| Stage / function | Trigger(s) | Responsibility and disposition |
| --- | --- | --- |
| Inbox: none | none | Authenticated delivery fingerprint uniqueness, delivery counters and untrusted claims. Keep server authentication and existing unique key; receipt is not payment evidence. |
| Finalization: `guard_flutterwave_live_intent` | `live_intent_history_guard` | No deletion, freeze snapshot, verified identity and permanent holds. Application allocation precheck added; full immutability equivalence **blocked**. |
| Finalization: `retain_flutterwave_live_history` | `live_collection_history_guard`, `live_event_history_guard`, `live_receipt_result_guard` | Reject all evidence updates/deletes. **Blocked**: checks on a current row cannot prevent all other writers. |
| Finalization: `guard_flutterwave_live_accrual` | `live_accrual_history_guard` | No deletion, immutable liability, HELD is irreversible. **Blocked** pending complete write-boundary/role design. |
| Workflow: reused `retain_flutterwave_live_history` | `live_authority_history`, `live_official_receipt_history`, `live_reconciliation_history`, `live_commission_items_history`, `live_workflow_audit_history` | Preserve authority, receipts, reconciliation, batch membership and audits. **Blocked** on equivalent append-only enforcement. |
| Workflow: `guard_live_workflow_state` | `live_activation_history`, `live_batch_history` | Only status changes; no delete/unhold; REVIEW_REQUIRED batch irreversible. **Blocked** on all-writer transition enforcement. |
| Workflow: `hold_live_workflow` | `live_hold_invalidates_export` | A HELD accrual invalidates every containing export batch. Explicit application update added in the finalizer's existing transaction. Trigger retained as defense in depth; no global equivalence claim. |
| Readiness: reused `retain_flutterwave_live_history` | `live_operator_history` | Preserve operator decisions/retry evidence. **Blocked** on append-only enforcement. |
| Runtime: reused `retain_flutterwave_live_history` | `live_school_config_history`, `live_allocation_review_history` | Preserve school authority and transaction-bound allocation review. **Blocked** on append-only enforcement. |
| Runtime: `guard_live_checkout_attempt` | `live_checkout_attempt_history` | One permanent claim; RESERVED may become READY/UNKNOWN only, identity and creation time frozen; no delete/reset/retry. Existing insert-on-conflict and conditional updates already cover normal application flow; bypass-writer protection **blocked**. |
| Onboarding: `live_school_onboarding_history_fn` | `live_school_onboarding_history` | Freeze encrypted identity/snapshot, claim/approval and provider identity; enforce terminal/uncertain transitions; no delete. Application mutation boundary now mirrors these checks; **all-writer replacement remains blocked**. |
| Onboarding: `live_school_onboarding_audit_fn` | `live_school_onboarding_audit` | Audit every insert/update in the same transaction, including unsuccessful/ambiguous provider progression. Application boundary now appends or validates exactly one audit; trigger retained. **All-writer replacement remains blocked**. |
| Onboarding: `live_school_onboarding_no_audit_mutation` | `live_school_onboarding_audit_history` | Audit rows cannot be changed/deleted. **Blocked** on append-only enforcement. |

## Implemented application behavior

`assertLiveIntentAllocation` rejects malformed intent amounts/currency/eligible
BRO binding before provider verification or financial writes. Exact minor units:
500000 gross = 190000 school + 310000 Yetenia gross; BRO liability is 10000 only
when a positive integer BRO profile is bound, otherwise zero. Existing verification
still requires one transaction-bound school recipient, actual nonnegative fees,
and positive Yetenia remainder after fees and any BRO liability. BRO is never a
checkout recipient; no fee or entitlement is inferred from a signed notification.

The finalizer now explicitly invalidates containing BRO export batches after
placing the accrual on hold and before lifecycle/reconciliation and receipt-result
writes. It uses the *same client and transaction* while the original intent lock
is held; it does not connect, commit, swallow errors or perform provider operations.
It scopes the update to LIVE, the intent's merchant and an actually HELD accrual.
No batch is necessary for an unbatched liability; repeating the hold is safe.
The existing immutable adverse finalization event is its transaction-bound audit
evidence; no history is rewritten to manufacture a successful payment.

Collection verification, original-byte receipt matching, semantic-event/result
idempotency, callback policy, immutable receipts, reconciliation and COMMIT
acknowledgement remain in the existing finalizer/runtime. Any batch update failure
rolls back the finalization transaction; it is never acknowledged as success.
Approval/export already lock original intents before accruals and batches.
The new query follows that order; actual PostgreSQL concurrency remains unproven
for a trigger-free replacement.

## Supported relational primitives and remaining design boundary

Keep the originals' table structure, NOT NULL/CHECKs, foreign keys, unique/partial
indexes, generated fee calculations and idempotency keys as the baseline.
Ordinary CHECK constraints cannot compare OLD/NEW or enforce append-only history;
foreign keys cannot automatically invalidate an export or append an audit row.
Moving those responsibilities solely into TypeScript without constraining *all*
writes would reduce security. No triggers, release checks or constraints have
been removed or weakened, and no parallel financial tables have been introduced.

A future schema-source design must express the full relational model through the
normal Development → Publish path, after separate permission to modify Development.
It must also establish a supported, enforceable write boundary for evidence,
onboarding and terminal states (or an equivalent append-only relational redesign).
Any role/privilege solution needs its own platform capability confirmation; none
is presumed available or configured here. Adding Drizzle declarations alone
would not solve the missing guarantees.

**Publish compatibility:** the new TypeScript code requires no custom functions,
triggers, startup DDL or deployment hooks of its own. The *complete LIVE design
still requires the original protections*. Therefore it is **not yet truly
Publish-compatible** and must remain unreleased. Future Publish retention of those
existing database objects is not established by this change.

## Verification boundary

Focused tests exercise the real finalizer with an in-memory SQL protocol double,
no simulated trigger side effects, and synthetic verification. They cover both
BRO branches, allocation rejection, adverse hold/replay, rollback on batch failure,
verification/receipt rejection, fee limits and default refusal. This checks
application ordering/error handling, not PostgreSQL SQL semantics, constraints,
lock races, durability, real provider verification or bank settlement.
Do not treat these tests as trigger-removal acceptance.

No shared/Production SQL, provider request, schema push, publish, settings change,
workflow restart or previously completed PostgreSQL audit is part of this slice.

### Executed results (initial slice; not rerun for the continuation below)

- `pnpm --filter @workspace/api-server exec vitest run src/services/flutterwave-live-application-guards.test.ts --reporter=dot`
  — **32 passed, one file**, using the existing credential-scrubbing/network-blocking
  test setup. No database client was created.
- `pnpm --filter @workspace/api-server run typecheck` — **passed**.
- `git diff --check` — **passed**.
- `sha256sum -c docs/finance/flutterwave-live-production-review/originals.sha256`
  — **all fourteen originals matched**. Review-package files were not edited.

No prior general audit/test suite was rerun. No running service was restarted,
to avoid invoking existing shared-database startup/background behavior.

### Exact changed files for this slice

1. `artifacts/api-server/src/services/flutterwave-live-finalization-design.ts`
   — calls the new allocation precheck and transactional hold-invalidation step.
2. `artifacts/api-server/src/services/flutterwave-live-application-guards.ts`
   — new application checks and explicit batch update.
3. `artifacts/api-server/src/services/flutterwave-live-application-guards.test.ts`
   — new isolated tests.
4. `docs/finance/flutterwave-live-application-redesign.md` — this map/report.
5. `.agents/memory/financial-verification-depth.md` — durable safety rule for
   future trigger-removal work; not an application/configuration change.

## Continuation: unresolved-protection write-path trace

This continuation adds onboarding protections only; it does not redo the initial
allocation/hold implementation or its completed test suite.

### Immutable payment/audit history — replacement BLOCKED

`retain_flutterwave_live_history`, `guard_flutterwave_live_intent`,
`guard_flutterwave_live_accrual`, `guard_live_workflow_state` and
`live_school_onboarding_no_audit_mutation` remain required. Static application
write paths, excluding tests:

- `flutterwave-live-intents.ts`: insert frozen issued intent, replay existing
  issuer key without rewriting the snapshot.
- `flutterwave-live-finalization-design.ts`: bind verified transaction/provider
  identity; insert collection evidence, semantic event, receipt result and optional
  BRO accrual; update intent state/hold and accrual hold.
- `flutterwave-live-lifecycle.ts`: insert activation/official receipt; hold
  activation; insert authenticated reconciliation cases (including failure path).
- `flutterwave-live-application-guards.ts`: update held export-batch status only.
- `flutterwave-live-commissions.ts`: insert approved export-only batch, membership
  and approval audit; append export audit. No transfer/Paid operation.
- `flutterwave-live-configuration.ts`: insert immutable authority review, school
  configuration and allocation review; check conflicting replay rather than update.
- `flutterwave-live-operator.ts`: append operator review; no history rewrite.
- `flutterwave-live-onboarding-mutations.ts`: append/validate onboarding audit;
  never update/delete an audit.

There is no ordinary application DELETE of LIVE financial history. This does not
prove that arbitrary database writers cannot mutate/delete it. No supported
append-only role boundary has been established, and ordinary CHECK/FK constraints
cannot provide OLD/NEW or delete protection. No trigger was removed or weakened.

### Irreversible payment state transitions — replacement BLOCKED

`guard_flutterwave_live_intent`, `guard_flutterwave_live_accrual`,
`guard_live_workflow_state`, `guard_live_checkout_attempt` and
`live_school_onboarding_history_fn` govern these transitions.

The finalizer owns intent locks and transaction-bound hold/collection writes;
lifecycle owns activation hold; the initial application guard invalidates batches.
Commission approval/export rechecks locked original intents/accruals before
approving or exporting. Runtime checkout updates only RESERVED to READY/UNKNOWN.
Those paths are unchanged. No application operation releases a financial hold.
Global irreversibility still requires the database guards.

Onboarding now has independently tested application OLD/NEW checks for the frozen
snapshot, permanent claim/approval, established provider identity, uncertain states
and terminal states. This is per-path protection, not permission to remove its
history trigger.

### Permanent provider-event claims — replacement BLOCKED

Do not confuse three different identities:

1. `flutterwave-live-webhook-inbox.ts` inserts authenticated delivery fingerprints;
   conflict updates only delivery count/time, not payment status.
2. Finalization inserts semantic events with unique intent/kind and semantic keys,
   binds verified provider identity, and binds each receipt result to the existing
   event. Conflicts are checked, not overwritten. Callback only delegates to the
   gated existing verification/finalization flow; it cannot invent a signature.
3. `flutterwave-live-runtime.ts` permanently reserves one checkout attempt per
   intent, with conditional READY/UNKNOWN updates and no expired-claim retry.
   School onboarding permanently records creation claim/approval before provider
   creation; recovery verifies the existing provider object rather than POST again.

Existing UNIQUE/FK constraints handle concurrent collisions while rows are retained.
They cannot make those claims permanent if another writer deletes their history.
The event/result immutability and checkout-history triggers are therefore still
necessary. No event expiry, delete/reinsert, reset or retry mechanism was added.

### Automatic onboarding audits — IMPLEMENTED for all traced application mutations

All eleven INSERT/UPDATE sites in `flutterwave-live-school-onboarding.ts` now call
`mutateLiveOnboarding`:

- Submit transaction: stale prior snapshot, insert fresh frozen request.
- Bank resolution: verification success or bounded error/holder-mismatch record.
- Review: Owner rejection; read-only preflight error; durable creation claim.
- Creation/recovery: captured provider ID, verified completion/profile-change
  outcome, recovery failure and uncertain-creation outcome.

For existing rows the boundary locks the original row before recording the current
audit ID. It applies one conditional mutation with `RETURNING *`, validates OLD/NEW,
then uses the already-generated trigger audit or appends the corresponding audit.
A subsequent command verifies **exactly one** new audit with matching previous/new
status, actor, approval, school/merchant, provider identity and error metadata.
Audit insert/validation failure rejects the operation and rolls back its row change.
An UPDATE matching no row appends no fictitious audit.

Standalone mutations own BEGIN/COMMIT/ROLLBACK. Mutations inside submit/creation
claim use the caller's pinned transaction and never commit it. No provider call is
inside the boundary and no provider creation is attempted before the permanent
claim's existing COMMIT acknowledgement. An uncertain COMMIT is not retry permission.
The narrow trusted-SQL shape guard refuses DELETE, unrelated targets, multiple
statements and missing RETURNING; it is not an SQL sandbox or a substitute for
controlling every writer.

The original audit trigger is deliberately kept. Adding a second audit without
checking it would duplicate history; using a same-statement CTE snapshot to detect
its insert would be unreliable. Separate commands in one transaction avoid both.
Audits from bypass writers remain protected/created by the existing triggers:
global trigger-free auditing/immutability is **still BLOCKED**.

### Focused continuation verification

The existing disposable PostgreSQL onboarding harness is reused. New app-only
cases create NEW tables with `LIKE ... INCLUDING ALL` in temporary schemas; this
copies column constraints/indexes, **not triggers or foreign keys**. No original
trigger is disabled, removed or altered. These cases prove the new application
transition/audit mechanism, not the full canonical relational model or arbitrary
writer protection.

Tests cover original-trigger coexistence without duplicate audits, app-only
auditing, snapshot/claim/provider identity refusal, audit-failure rollback,
caller-controlled atomicity, concurrent claim uniqueness and lost COMMIT
acknowledgement retaining the permanent claim. Policy tests also run without
database triggers. The routed test uses synthetic injected provider transport.
No shared database, actual provider request or previously completed general suite
is used.

Executed final checks:

- `pnpm --filter @workspace/api-server exec vitest run src/services/flutterwave-live-onboarding-mutations.test.ts --reporter=dot`
  — **28 passed** (initial 24-case pass was expanded with four SQL-shape refusals).
- `pnpm --filter @workspace/api-server exec vitest run src/routes/flutterwave-live-school-onboarding.test.ts -t 'application safeguard:' --reporter=dot`
  — **six passed, 29 pre-existing cases skipped**. Only the six new focused cases
  ran; the existing cluster/identity-check/cleanup harness was reused.
- `pnpm --filter @workspace/api-server run typecheck` — **passed** after fixing
  the new nullable mutation-result type check.
- `git diff --check` — **passed**.
- `sha256sum -c docs/finance/flutterwave-live-production-review/originals.sha256`
  — **all fourteen matched**.
- Protected-path `git diff --exit-code` — **no changes** to original SQL,
  rollback SQL, manifests, runbook or the Production review package.

The initial development slice's completed 32-test suite and general PostgreSQL
audits were not rerun. No workflow was restarted, to avoid shared-database startup
or background behavior. Only synthetic disposable fixtures received SQL.

### Exact changed files in this continuation

1. `artifacts/api-server/src/services/flutterwave-live-school-onboarding.ts`
2. `artifacts/api-server/src/services/flutterwave-live-onboarding-mutations.ts` (new)
3. `artifacts/api-server/src/services/flutterwave-live-onboarding-mutations.test.ts` (new)
4. `artifacts/api-server/src/routes/flutterwave-live-school-onboarding.test.ts`
5. `docs/finance/flutterwave-live-application-redesign.md`

**Overall verdict remains NOT genuinely Publish-compatible.** New per-path
onboarding checks/audits need no new database objects, but immutable financial/audit
history, irreversible financial state and permanent claim retention still depend
on the existing triggers. A proven all-writer design and supported full relational
schema-to-Publish path remain necessary before release. No release gate, allocation,
verification, reconciliation or original migration/review/checksum file is changed.

## Next narrow step: constraint-only boundary evidence

**Decision: no additional operational safeguard promoted. Equivalence failed.**
The only implementation in this step is a guarded test-only candidate and four
focused PostgreSQL tests. Application code, schema declarations and release gates
are unchanged. The candidate is not a migration, supported installation procedure
or replacement for the reviewed SQL.

### Writer boundary and supported relational enforcement

The current writer map above was checked against the remaining static write sites;
no new general audit or previous general test suite was run. Relevant writers:

| Protection | Existing function/trigger boundary | Relevant application writers | Constraint + transaction assessment |
| --- | --- | --- | --- |
| Frozen financial identity and evidence | `guard_flutterwave_live_intent`; `retain_flutterwave_live_history` and its collection/event/result, authority, receipt, reconciliation, membership, workflow/operator audit, configuration/allocation triggers | Intents: `flutterwave-live-intents.ts`; verified evidence/events/results: finalization; activation/receipts/reconciliation: lifecycle; reviews/configuration/allocation: configuration; batches/items/audits: commissions; operator audit: operator | CHECK/NOT NULL enforce allowed current values; FKs enforce current identity bindings; generated columns enforce arithmetic. None freezes an earlier valid value. Application locks/transactions coordinate participating writers only. **Historical immutability blocked.** |
| Irreversible holds and states | Intent/accrual guards; `guard_live_workflow_state`; `hold_live_workflow`; checkout guard | Finalization updates intent identity/state/hold/accrual; lifecycle holds activation; application guards invalidate batches; commissions approve/export after locked recheck; runtime completes checkout | Allowed-state CHECKs do not encode OLD → NEW. Existing locks, conditional updates and batch invalidation remain necessary, but an ordinary UPDATE outside that path can reverse a valid state. **All-writer irreversibility blocked.** |
| Permanent authenticated delivery, semantic-event and checkout claims | Inbox namespace key; immutable event/result guards; `guard_live_checkout_attempt` | Inbox upserts only counters/time; finalization inserts/rechecks semantic event and receipt result; runtime permanently reserves checkout and conditionally completes it. Callback does not mint an authenticated receipt; operator review does not reissue the claim | Unique keys prevent reuse while retained; FKs prevent deleting a referenced parent. Deleting mutable dependency leaves first frees claims. No expiry/reset/reinsert path is authorized. **Permanent retention blocked.** |
| Onboarding permanent claim and audit history (prior implementation retained) | Onboarding history/audit/immutable-audit functions | Eleven submit/review/create/recover mutations all use `mutateLiveOnboarding`; audit INSERT/validation is inside that boundary | Prior tests prove per-path transitions and atomic auditing. That module does not restrict another raw-SQL writer or make audit rows globally immutable. **All-writer replacement still blocked.** |

Here, “all relevant writers” means ordinary DML writers, including another code
path using the SQL pool, not an administrator deliberately disabling protections
with DDL. Both original triggers and the candidate were tested under identical
fixture privileges using ordinary INSERT/UPDATE/DELETE only. No claim is made
about uninspected Production grants. The source exposes a general SQL pool, not
an established per-table append-only write-role boundary.

### Focused evidence, including foreign keys missing from the earlier LIKE clones

The existing six-migration disposable harness supplies canonical parents and an
independently identity-checked Unix-socket PostgreSQL target. A **separate test
schema** is constructed from the six unchanged SQL texts, omitting only their
nine functions and twenty triggers in memory. The original objects remain intact.
The fixture refuses a non-disposable target, a changed stage count or an unexpected
function/trigger count. It has no connection string, CLI, build hook or app caller.

Unlike the earlier LIKE-only onboarding clones, this candidate keeps the full
foreign keys. Tests compare constraint definitions/validation, index definitions,
column types/nullability/defaults and generated expressions against the original
21-table model, normalizing schema qualification only. They verify zero candidate
functions/triggers and all twenty original triggers still enabled.

| Focused case | Observed result |
| --- | --- |
| Retain relational shape and test scalar/identity enforcement | Exact relational-shape match. Invalid school/BRO allocations and negative fees rejected with CHECK violations; retained duplicate event/checkout claims rejected with UNIQUE violations; referenced event deletion rejected with FK violation. |
| Rewrite otherwise-valid history | Changing an actual recorded fee, official receipt snapshot or workflow audit action succeeds in the candidate; original triggers reject all three. Generated net recalculates, demonstrating arithmetic consistency does **not** prove original-fee authenticity. |
| Reverse irreversible state | Intent unhold, accrual release, activation reactivation, batch reapproval and UNKNOWN → RESERVED checkout reset all succeed in the candidate; original guards reject each. |
| Delete dependency leaves and reuse claims | Candidate permits deleting receipt result then semantic event and reinserting the same semantic claim under another event ID; checkout deletion/re-reservation also succeeds. Originals reject the leaf/claim deletions. Existing uniqueness/FKs do not establish permanence. |

These are successful **counterexample tests**, not a successful trigger-free
payment implementation. No actual provider operation or payment was performed.
They do not disprove every conceivable future relational redesign; they disprove
the current model's equivalence when procedural protections are omitted.

### What is fully covered, and what is not

**Covered in this step:** exact candidate relational-shape preservation; the
specified scalar allocation/fee checks; retained-row event/checkout uniqueness;
referential protection of the referenced event; reproducible counterexamples
against the same privileged DML writer. Existing server-side verification,
transactional finalization, idempotency and reconciliation are preserved, not
newly recertified by this test.

**No remaining global protection is newly fully covered without triggers.**
Adding a CHECK that allows only a final state would reject legitimate initial
states, not reproduce transitions. Adding another unique/FK index cannot freeze
non-key history or keep an unreferenced claim from being deleted. An append-only
event ledger still needs enforceable insert-only access and safe projections;
merely adding a ledger/hash chain permits rewriting/deleting its unprotected tail.
Locks/CAS predicates do not constrain writers that do not participate in them.

The next necessary design input is a supported, enforceable table/column write
boundary: e.g. an approved append-only role model plus guarded mutable-state
transactions, or another demonstrated protected ledger/root design. It must cover
every writer and be reconciled with Publish ownership/permissions. No such
capability is established here. Creating roles/grants, changing credentials or
installing a bypass migration is outside this authorization. Without that input,
another application wrapper or scalar CHECK would not close the proven gap.

**Publish verdict: NOT genuinely Publish-compatible.** Relational primitives are
the intended supported schema direction, but this candidate is deliberately not
adopted: it fails required protection semantics. The exact future Publish diff
and permission lifecycle remain unverified. Do not drop functions/triggers or
relax release checks based on these tests.

### Files and executed verification for this step

Changed files only:

1. `artifacts/api-server/src/test/flutterwave-live-constraint-candidate.ts` (new,
   test-only fixture).
2. `artifacts/api-server/src/services/flutterwave-live-six-migrations.postgres.test.ts`
   (four new focused cases; existing cases unchanged).
3. `docs/finance/flutterwave-live-application-redesign.md` (this finding).

Executed:

- `pnpm --filter @workspace/api-server exec vitest run src/services/flutterwave-live-six-migrations.postgres.test.ts -t 'constraint-only evidence:' --reporter=dot`
  — **four passed, thirteen pre-existing tests skipped**. The existing isolated
  fixture setup/preservation checks ran; the old general tests did not.
- `pnpm --filter @workspace/api-server run typecheck` — **passed**.
- `git diff --check` — **passed**.

No Production/shared database, actual provider, reset of application data,
settings/secrets, workflow restart, publish or LIVE activation is involved.
The NGN 500000 = 190000 + 310000 allocation and eligible 10000-kobo BRO deduction
remain unchanged; no code or configuration affecting payment behavior changed.

Final preservation verification:
`sha256sum -c docs/finance/flutterwave-live-production-review/originals.sha256`
returned **fourteen matches**. Protected-path `git diff --exit-code` confirmed
no changes to the six original forwards, six rollbacks, runbook, original manifest
or Production review package.

## Permission-boundary follow-up

See [runtime-role and Publish lifecycle decision](flutterwave-live-permission-boundary-review.md)
for the narrow role/ACL prototype, current connection/migration configuration,
official Replit evidence and unresolved lifecycle contract. Three new isolated
tests prove a restricted-login append-only subset, but also prove that mutable
column grants do not prevent state reversals. Normal Publish maintenance of the
role/ACL split remains unestablished. **Release verdict remains NO-GO.**
