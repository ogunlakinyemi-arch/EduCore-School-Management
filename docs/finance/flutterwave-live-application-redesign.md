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
| Onboarding: `live_school_onboarding_history_fn` | `live_school_onboarding_history` | Freeze encrypted identity/snapshot, claim/approval and provider identity; enforce terminal/uncertain transitions; no delete. **Blocked** pending an atomic all-writer transition boundary. |
| Onboarding: `live_school_onboarding_audit_fn` | `live_school_onboarding_audit` | Audit every insert/update in the same transaction, including unsuccessful/ambiguous provider progression. **Blocked**: current application writes rely on automatic auditing; do not remove it. |
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

### Executed results

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
