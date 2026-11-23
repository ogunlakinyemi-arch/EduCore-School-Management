# Consolidated current-payment completion — Development source only

## Checklist and execution boundary

- [x] Inspect current direct attempts, immutable BRO roots, financial transaction
  gate, bank verification, stabilisation report and Safe Restart report.
- [x] Implement service-level append-only direct refund requests, approval, dispatch claims,
  independently verified outcomes, cumulative limits and adverse-event holds.
- [x] Implement service-level individual current BRO approval, frozen verified bank evidence,
  externally completed payout recording, failure/reversal and recovery review.
- [x] Evaluate true bulk collection against existing source-evidence guards;
  implement only the portion that does not fabricate individual transactions.
- [x] Exercise changed services against disposable PostgreSQL and fake providers.
- [x] Run focused API type, disposable build and whitespace checks.
- [x] Report exact coverage, unapplied migrations and unresolved integration.
- [ ] Connect approved provider evidence adapters, routes, screens and current
  subledger projections. These are not implemented by the service candidates.
- [ ] Implement aggregate collection, allocation, receipts and batch refunds.
  The persisted bulk plan is deliberately review-only.

No shared database, runtime, worker, preview, secret, external provider or
deployment operation is authorized. Migration files are candidates only.

The referenced preceding numbered 65-point specification was not present in
the supplied context or located in the workspace. Acceptance names and numbers
in the completion report will identify the explicit requirements in the latest
instruction, not claim a verbatim match to an unavailable document.

## Known bulk source-evidence constraint

`bro_term_commission_entitlements` requires a unique direct attempt per earning.
Its existing guard requires that attempt to be PAID with a provider transaction.
`student_direct_live_attempts.provider_transaction_id` is unique, and terminal
attempts and entitlement roots are immutable. An aggregate provider transaction
cannot be copied into multiple direct attempts. Synthetic transaction IDs,
repeated single checkouts and bypassing the existing guards are not acceptable.
Bulk completion requires a separately compatible aggregate-allocation source
contract for accrual and all affected readers, not weakening the existing one.
