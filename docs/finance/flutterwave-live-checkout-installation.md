> **ARCHIVED legacy installation guide — not execution authority.** Split checkout is retired; no Production SQL, migration or old flag activation is authorized. Current policy: `../january-2027-no-split-payment-policy.md`.

# Minimal LIVE subscription checkout package

**REVIEW ONLY — no Production execution or LIVE activation is authorized.**

This narrows the reviewed six-file package to checkout/split collection only.
It does not change any SQL or weaken any financial or authentication guard.
Installation remains conditional: there is no verified custom-SQL Publish
importer, and the Production SQL console has not been certified for whole-file
transactions, dollar-quoted bodies, error recovery or subsequent lifecycle
preservation. This document is not a new automated Production migration path.

The [console rehearsal evidence](flutterwave-live-sql-console-rehearsal.md)
records the actual outcome: blocked before SQL because an independently verified
disposable Replit target and authenticated console control were not established.

## Minimum dependency-ordered package

Files remain under `lib/db/dev-reconciliation/`:

| Order | Forward file | New tables | Functions | Triggers |
| --- | --- | ---: | ---: | ---: |
| 1 | `flutterwave-live-webhook-inbox.up.sql` | 1 | 0 | 0 |
| 2 | `flutterwave-live-finalization.up.sql` | 5 | 3 | 5 |
| 3 | `flutterwave-live-workflow.up.sql` | 7 | 2 | 8 |
| 4 | `flutterwave-live-readiness.up.sql` | 1 | 0 | 1 |
| 5 | `flutterwave-live-runtime.up.sql` | 4 | 1 | 3 |
| **Total** | **Five unchanged files** | **18** | **6** | **17** |

Pair each with its identically named `.down.sql` companion. All ten exact hashes
are pinned in `flutterwave-live-checkout-review.manifest.json`. The manifest is
offline review metadata, not a merchant/school/release approval.

The sixth `flutterwave-live-school-onboarding` pair remains unchanged and deferred:
it creates three additional tables, three functions and three triggers for
creating new LIVE school subaccounts. Checkout's `requireLiveRelease`, configuration
lookup and runtime transport do not depend on these onboarding tables.
This exclusion is valid only when a **genuine, already-existing, independently
approved LIVE school subaccount** can be configured. If none exists, checkout
remains blocked; this package does not create an account or bypass onboarding.

Do not drop workflow batches, accruals, receipts, reconciliation or operator
review objects merely because they are not on the initial checkout screen.
The existing runtime preflight and financial lifecycle require them. The five
whole reviewed files are the minimum established here; a smaller table-level
rewrite has not been proved safe.

## Reproducible offline preparation — no credentials or writes

From the workspace root:

```sh
node scripts/src/flutterwave-live-review.mjs --checkout
node --test scripts/src/flutterwave-live-review.test.mjs
```

The existing reviewer now supports a bounded checkout profile. It reads only
the manifest and ten source files, checks full hashes, transaction boundaries,
dependency/key order, rollback refusal markers, required invariants and inventory,
and prints expected function/trigger/table/index/constraint names. Its trigger
bindings include exact table, function, timing and events for independent review.
It cannot connect, execute SQL, write files, approve records or select a target.
Unknown/apply/approval/target options are refused.

The older four-stage manifest's workflow rollback hash was stale. It is reconciled
to the safety-fixed hash already recorded by the later six-stage installation
runbook: `05a2d79bd56284ab49566243e2cf66dad417a717896ce117bc77d69752148e74`.
No rollback SQL changed and no business evidence was reapproved by that metadata fix.
Historical review captures with the earlier hash remain historical evidence.

## Non-negotiable execution gates

1. **Console capability first, outside Production.** A separately authorized,
   independently verified disposable Replit SQL-console rehearsal must establish
   whole-file/dollar-quote handling, same-connection BEGIN/COMMIT, deliberate-error
   rollback, stop-on-error reporting and recovery after cancellation/disconnect.
   A native PostgreSQL/client rehearsal is not proof of console behavior. Never
   use the application's ordinary Development connection as an assumed disposable
   target. No rehearsal or Production SQL was executed to prepare this document.
2. **Target, privilege and recovery confirmation.** An authorized operator must
   establish the actual writable primary and resource binding, effective credential,
   intended schema, required create/reference/trigger/function/runtime privileges,
   available recovery point and recovery procedure. Prior Owner confirmations
   remain acknowledged, but are not a fresh console-session execution attestation.
   Do not create a custom role or regenerate credentials.
3. **State and preservation baseline.** Review the target for conflicts and
   partial installation; capture existing canonical data/schema evidence. Stop
   if an expected new object already exists or differs. Do not use IF NOT EXISTS,
   rename/drop objects, overwrite data or rerun blindly to conceal differences.
4. **Future release protection.** A matching Development source/baseline and the
   entire later Publish proposal must be reviewed so a subsequent Publish cannot
   remove the manually installed objects. Neither the console documentation nor
   Quinn's response establishes preservation through Publish/PITR. Never treat
   password rotation, general PITR availability or a partial diff as that proof.

Only after these gates and explicit authorization may an owner/operator use the
console feature. It is not an Agent Production SQL capability. Reuse the reviewed
target/session and timeout requirements in the six-stage installation runbook,
not a newly generated executor. Keep school/payment operations unable to write
to the new lifecycle until full independent verification.

Submit **one complete, byte-identical forward file at a time**, in the order
above, only if the console's execution contract has been demonstrated. Each file
commits separately; five files are not one transaction. Do not concatenate or
wrap them in another BEGIN and claim package-level atomicity.
Inspect the result and verify the committed stage before continuing. On an error
or lost response, stop, establish transaction/session state, explicitly roll back
an open failed transaction on that same connection, and inspect durable state.
Do not resend an uncertain commit or automatically execute a down file.

## Independent verification — not just the application readiness flag

An authorized verifier must compare the original, hash-bound SQL to actual
catalog definitions and preservation evidence, independently of the installer's
success message and the reviewer's declaration counts:

- All 18 expected tables, exact columns/types/defaults, PK/UNIQUE/CHECK/FK
  definitions and supporting indexes; no unexpectedly unvalidated constraints.
- All six function signatures, full definitions, language and ownership. Normal
  DML is guarded; the existing owner credential is not thereby forbidden from
  deliberately issuing DDL to disable/drop protections.
- All 17 triggers: the exact table/function binding, enabled normal/always state,
  row-level firing and correct BEFORE/AFTER events. Inspect `pg_get_functiondef`,
  `pg_get_triggerdef`, trigger-function linkage and catalog enablement—not counts
  alone. Checkout needs all 17, not only the subset in its lightweight preflight.
- Existing credential/schema/table/function privileges and actual object owners;
  no new roles, memberships, grants or default-privilege assumptions.
- Original canonical rows, TEST history, indexes and constraints remain unchanged.
  On a fresh installation the new release, authority, school-configuration and
  financial tables remain empty. Do not insert fictional approval rows to test.
- On the disposable console target only, test immutable evidence, irreversible
  holds, permanent checkout/delivery/event claims, deduplication, cross-school
  denial, required/expired authority evidence and transactional finalization.
  API fixture tests additionally cover signature/provider verification,
  amount/currency/reference matching and fail-closed release selection.

Record exact file hashes, operator, resource/session identity, UTC times, stage
results and independent verification. Do not put credentials, bank data or
private reviewer identities into project documentation.

## Rollback and recovery

- An uncommitted failed stage should be rolled back on its own established
  session. Previously committed stages are not undone by that rollback.
- For a separately approved **empty-only** reversal: runtime → readiness →
  workflow → finalization → inbox, using the exact pinned `.down.sql` companions.
  Their locking/refusal checks are mandatory. Never force CASCADE, remove guards
  or delete evidence to make reversal pass.
- Once release/authority/financial evidence exists, stop and preserve it; use a
  separately reviewed forward repair/recovery plan rather than destructive down
  scripts. PITR is not a stage rollback: it can rewind unrelated legitimate data
  and needs its own authorization, verified protection inventory and coordinated
  code recovery. Role/privilege behavior is undocumented per Quinn.

## Exact authorization required before Production execution

No execution is authorized now. Before any Production SQL, the owner must
explicitly identify all bracketed items and authorize the actual operator:

> I authorize [named owner/operator] to install only the five unchanged forward
> files pinned by [reviewed checkout manifest identity] on [independently verified
> Production resource] during [UTC window], after [disposable-console capability
> evidence], [preservation baseline] and [available recovery evidence] are
> accepted. Use the existing documented credential, one complete file per
> transaction, inspect each stage, stop on any error or uncertain result, and do
> not retry automatically. This authorizes schema installation only: no approval
> seeds, existing business-data changes, secret/settings changes, role creation,
> publishing, restart, provider requests or payments. Down scripts and restores
> require separate authorization. LIVE activation remains blocked until real
> merchant/school/account/evidence/expiry and all existing security gates pass.

Owner authorization cannot supply missing console guarantees or override the
Agent's read-only Production tooling. If any execution gate remains unproved,
the Production decision stays **NO-GO**, even after this review package passes.

## Validation of this preparation

- Offline reviewer: **12 tests passed**, including legacy behavior, all ten
  checkout hashes, missing/reordered stages, runtime guard/binding changes,
  credential-free CLI operation and refusal of execution options.
- Checkout inventory review passed: five stages, 18 tables, six functions and
  seventeen exact trigger bindings. Console capability and installation authority
  remain explicitly false in its output.
- API security/runtime/provider/webhook fixtures: **148 tests passed in five files**.
  These use synthetic data/mocked dependencies, not Production or provider calls.
- API TypeScript check and whitespace/diff check passed.
- No forward/rollback SQL, runtime implementation, Production data, settings,
  secrets, deployment or process was changed. No SQL execution was performed.

References: [six-stage runbook](flutterwave-live-six-migrations-installation.md),
[Quinn decision](flutterwave-live-permission-boundary-review.md),
[managed-release evidence](flutterwave-live-managed-publish-blocker.md).
