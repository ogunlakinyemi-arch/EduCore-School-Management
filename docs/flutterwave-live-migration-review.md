# LIVE readiness additive migration review — 2026-10-20

## Decision

**PASS for isolated fixture rehearsal; NOT approved for application-target apply.**
Only disposable Unix-socket PostgreSQL was used. Neither Development application
nor Production schema/data was queried or migrated during this pass. The drafts
are not registered in the automatic migration journal.

## Order and dependencies

Apply only after separate target verification and approval, in this order:

1. `flutterwave-live-webhook-inbox.up.sql`
2. `flutterwave-live-finalization.up.sql`
3. `flutterwave-live-workflow.up.sql`
4. `flutterwave-live-readiness.up.sql`

All live in `lib/db/dev-reconciliation/`. Stage4 is additive to the isolated LIVE
schema: no shared/SANDBOX financial table is altered, relabelled or backfilled.
Reverse order is mandatory. These are one-shot drafts, not idempotent deployment
scripts: rerunning an applied up draft fails rather than swallowing drift.

## Correctness and tenant/environment isolation

- All financial tables retain fixed LIVE checks. Merchant scope is validated.
- New authority uniqueness is created **before** the intent composite FK binding
  reviewed authority to exact environment/merchant/school/school-subaccount.
  The prior simple authority-ID FK remains; the additional composite FK prevents
  an otherwise valid review ID from authorizing another school or merchant.
- New verified-identity unique keys precede collection/event FKs. The existing
  finalizer binds verified identifiers before inserting either dependent row.
  Invented collection transaction/reference pairs now fail in PostgreSQL.
- Events reference the existing inbox provider/environment/fingerprint key.
  The new fixed FLUTTERWAVE source discriminator is justified by the existing
  inbox's single-provider CHECK. It does not initialize money, success or authority.
- A tested alternative second inbox fingerprint unique constraint broke a
  concurrent `ON CONFLICT` upsert. It was removed; no inbox uniqueness definition
  or upsert contract is changed by the final draft.
- Existing null-authority design intents remain null; they are not converted
  into operational intents. Application issuance/access still requires complete
  authoritative snapshots and coordinated evidence.
- No FK to a student's **current** school is added to immutable financial history:
  such a key would conflict with legitimate later school transfers. Original
  canonical identity is checked at issuance and frozen. This is not permission
  to trust browser-provided IDs or infer school ownership from receipt claims.
- Receipt-result semantic matching still requires the application finalizer:
  re-encoded authenticated deliveries may share a semantic event but have different
  fingerprints. SQL FK existence alone is not independent provider verification.

## Indexes

Stage4 adds authority lookup, application school/term/student scope, authority-ID
FK, receipt-result event, event-source, workflow-audit batch and operator receipt
indexes. Existing primary/unique keys already cover activation/official-receipt/
collection/accrual intent lookups, batch items and operator key replay. New parent
unique keys support the exact composite FK column order.

The bounded review list is newest-first and limits100 rows; exact-receipt review
uses a primary-key predicate, not a search through only the latest100. Unmatched
receipts remain unassigned; the Owner's selected review namespace is not a claim
that the pending transaction belongs to that merchant.

## Retention, rollback and locks

Operator audits reject UPDATE/DELETE through the existing immutable-history
trigger. No raw payload, headers, bank data or credentials are added to audit
storage. Only fingerprint-bound action/reason/outcome metadata is retained.
There are no Paid, transfer, refund-completed or hold-release review actions.

Stage4 down locks the affected evidence roots and refuses any retained intents,
receipts, authority reviews or operator audits. Empty reverse stage4 → stage3 and
reapply were executed. No CASCADE drop or history deletion is used by down scripts.
`TRUNCATE ... CASCADE` occurs only in the disposable test fixture reset, never as
an application recovery or migration operation.

ALTER TABLE, FK validation and ordinary index creation can take locks and scan
existing rows. The draft intentionally does not use NOT VALID, disable triggers,
rewrite conflicting rows or hide failures with IF NOT EXISTS. A real target
requires a separately reviewed lock/timeout/window and preservation plan; index
creation cannot simply be changed to CONCURRENTLY inside this transaction.

## Executed compatibility checks and limits

The corrected stage1–4 stack executed on disposable PostgreSQL alongside canonical
identity/calendar fixtures and retained shared/SANDBOX history sentinels.
Catalog checks showed new FKs validated and expected indexes present.
Cross-school reviewed authority, invented collection identity and unauthenticated
event source were rejected. Concurrent receipt delivery, full finalization,
approval/export, adverse events, access reads and operator retries passed.
No shared historical sentinel changed. Empty reverse/reapply passed; retained
evidence refused rollback.

This is **not** a rehearsal of the complete current application or Production
schema, data volume or drift. A verified historical/schema export, collision and
existing-row CHECK/FK validation, migration-ledger comparison, lock rehearsal and
separate apply approval remain required. The existing columns queried by the new
consumers were exercised in fixtures, not assumed to certify every target schema.
No claim is made that missing source uniqueness in an unrelated hardware-test
export is fixed by these LIVE-only drafts.

## Acceptance references

Final relevant suite:221 tests across nine files, including41 coordinated
workflow/application/operator/migration tests; API/frontend typechecks and diff
checks passed. See `flutterwave-live-workflow-review.md` for exact counts and the
provider/bank evidence that remains unavailable.
