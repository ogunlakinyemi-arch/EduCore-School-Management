# LIVE readiness additive migration review — 2026-10-21

## Decision

**PASS on a source-derived representative target; NOT approved for application-target apply.**
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

The family contract adds a non-unique partial expression index,
`live_family_receipt_reference_idx`, on LIVE inbox environment and diagnostic
reference where signature verification is true. It supports failure-report
presentation only, never verified entitlement or financial attribution. It does
not compete with the existing authenticated-inbox upsert uniqueness arbiter.

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
receipts, authority reviews or operator audits. Empty reverse stage4 → stage1 and
full reapply were executed on the representative target. All four down drafts
refused retained evidence. No CASCADE drop or history deletion is used by down scripts.
`TRUNCATE ... CASCADE` occurs only in the disposable test fixture reset, never as
an application recovery or migration operation.

ALTER TABLE, FK validation and ordinary index creation can take locks and scan
existing rows. The draft intentionally does not use NOT VALID, disable triggers,
rewrite conflicting rows or hide failures with IF NOT EXISTS. A real target
requires a separately reviewed lock/timeout/window and preservation plan; index
creation cannot simply be changed to CONCURRENTLY inside this transaction.

## Executed compatibility checks and limits

The earlier minimal fixture remains useful workflow evidence. This pass additionally
generated the **complete current declared schema** offline and initialized a new
Unix-socket PostgreSQL cluster from its dependency-ordered statements:

- **184 canonical tables, 690 validated canonical FKs, 1,241 statements.**
- Schema-source fingerprint:
  `948384891604f45539958c884bacf1ee28112e8ab99f8f82a4e46cd48924bfde`.
- Unchanged raw export execution: **FAIL**, “there is no unique constraint matching
  given keys for referenced table `staff_nfc_subscriptions`”.
- Dependency-ordered export: **PASS**, preserving the exact duplicate-aware
  statement multiset; **no supporting keys or constraints were synthesized**.
  Multiset fingerprint:
  `1a795752cb552c5ab09d399cf911b0eb1359ea2db8d3432d3a13ea125c97ddf7`.
- The generic export guard separately remains **non-green**: it expects UNIQUE
  INDEX ownership for `subscriptions_id_school_student_uq`,
  `school_partner_attributions_id_partner_uq` and `parents_id_school_unique`.
  Current source declares those same-name/same-column keys as UNIQUE constraints.
  This is not absence of usable uniqueness. Neither source ownership nor the
  generic guard was rewritten. The scoped rehearsal records this discrepancy;
  it does not waive provenance review for an application target.
- Four LIVE drafts added **14 tables, 19 validated FKs and 40 total LIVE indexes**
  (including constraint-owned indexes). Wrong ordering failed atomically.
  Duplicate up applies refused as one-shot drafts without partial schema changes.
- Empty full reverse/reapply passed. A populated earlier-draft upgrade preserved
  an authenticated diagnostic receipt and a legacy design intent; new authority
  columns stayed null and state stayed PENDING. No activation was manufactured.
- Cross-school authority, wrong environment/fixed amounts, audit UPDATE/DELETE
  and retained-evidence rollback were refused.
- All canonical column/default, constraint/validation and index definitions,
  and all fields of fictional shared user/school/student/subscription sentinels,
  matched the pre-migration snapshots. No shared historical record was rewritten.

Reproduce without application credentials:
`pnpm --filter @workspace/api-server exec vitest run src/services/flutterwave-live-target-schema.postgres.test.ts`.
The test regenerates SQL from current source, uses constructor-only isolated DB
access and removes the cluster. The exporter has no application-connection or
migration/push capability.

This is a representative **source-model** target, not an inspected live Development
or Production catalog, historical dump, migration ledger, existing business-data
volume, or historical trigger/function inventory. Actual-target drift/collisions,
existing-row CHECK/FK compatibility, historical key ownership/provenance, lock/
timeout windows, preservation/recovery plans and separate apply approval remain
required. The unrelated NFC hardware-test export failure was not repaired or
restarted. No application-target database was queried or migrated.

## Acceptance references

Current distinct acceptance: **268 API tests across 11 executed files**, including
60 coordinated tests and eight representative-target tests; **55 frontend tests
across seven files**. Another 38 existing application-database opt-in tests stayed
skipped; they were not redirected to an application database.

The selected API full pass completed all 268 assertions but initially exceeded
the representative fixture's default ten-second teardown deadline. Only that
test-only cleanup deadline was extended to60 seconds; the affected eight-test
suite was rerun successfully. Passing application suites were not repeated.
API/frontend typechecks, Development API build/restart and diff checks passed.
The public sign-in screenshot is not authenticated LIVE browser acceptance.
See `flutterwave-live-workflow-review.md` for the exact coverage and remaining
provider/bank blockers. This review authorizes no migration or LIVE operation.
