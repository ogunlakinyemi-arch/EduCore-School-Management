# EduCore staged activation runbook

**23 November 2026 — prepared, not approved or activated.**
Use this runbook for ordered preparation; the
[activation report](production-activation-report.md) remains the prior
observation/evidence record. No shared migration, Production write, publication,
release/rule change, worker restart, provider transaction or message is authorized.

## 1. Delivery route and hard stops

Current Replit guidance documents **Publish for structural schema**, and an
**operator SQL-console procedure for missing functions/triggers**:
[Publish database changes](https://docs.replit.com/features/data-and-storage/publish-database-changes),
[Work with data](https://docs.replit.com/features/data-and-storage/work-with-your-data),
[Database troubleshooting](https://docs.replit.com/help/troubleshooting/databases).
The project has no `REPLIT_DATABASE_MIGRATIONS=app` setting; this package does
not switch migration ownership or add an app-owned migration system.

This updates the older report's blanket statement that no documented operator
route exists. **It does not independently rescind the earlier project-specific
Support restriction or certify this serving target.** If that restriction still
applies, stop: obtain target-specific clearance before execution. No Support
contact or new infrastructure investigation was initiated here.

Before any operational step, separately approve:

- Authoritative serving-primary/resource/revision mapping, runtime role and
  accepted recovery point. A replica/database name/configuration fingerprint
  or a role named `neondb_owner` alone does not prove the target.
- Exact package/source hashes and intended stage; prior object definitions,
  current records and fresh structural diff. Do not overwrite unreviewed drift.
- Any shared Development migration; any Production SQL-console editing;
  publication; rule/release settings; worker changes; external transactions
  and messaging **as distinct actions**. None is approved here.

Keep current free access, each school's actual January 2027 calendar and all
existing independent payment/authorization/history checks. Student ₦3,200,
staff ₦2,000 and independently funded eligible BRO ₦150 remain unchanged.
School-set charges and historical pricing/records remain separate and immutable.

## 2. Prepared package — offline, source-bound, not an installer

Directory: `db/production-activation/`.

| Group | Functions file | After-table triggers file | Read-only verification |
|---|---|---|---|
| Student plus native BRO | `student.functions.sql` | `student.triggers.sql` | `student.verify.sql` |
| Current lifecycle/bulk/withdrawal/SMS | `current.functions.sql` | `current.triggers.sql` | `current.verify.sql` |
| Free Academic Terms | `free-terms.functions.sql` | `free-terms.triggers.sql` | `free-terms.verify.sql` |

`manifest.json` records exact existing migration hashes, **27 structural
tables, seven function body commitments and 29 trigger definitions**, plus
each generated SQL file's SHA-256. `capture-definitions.sql` is SELECT-only
pre-change object-definition evidence, **not a database/data backup**.

The offline compiler accepts only:

```sh
node scripts/src/production-activation-package.mjs --check
# --write regenerates review files only; it never connects or executes SQL.
```

There is no startup/build/Publish hook, database target argument, credential
reader, deployment command or production migration runner. Do not add one.
The SQL files require PostgreSQL 14+ and the managed `neondb_owner` operator;
they neither change ownership nor grant privileges. Triggers preflight all
required parent tables and exact approved function bodies/properties before
changing bindings. Each file is transactional, with 2s lock/30s statement
timeouts. Timeout/error means rollback/stop, never weaken checks or retry blindly.

**Tables are intentionally not recreated by these SQL files.** They remain
the existing reviewed structural candidates and the managed Publish diff.
This is a documented delivery package pending approval, not proof that any
Production schema has been installed.

## 3. Exact structural inventory

All source paths below are under `lib/db/drizzle/`; the manifest binds contents.

- **Stage 1 rules — 0175:** `subscription_rule_proposals`,
  `subscription_payment_assistance_requests`.
- **Stage 1 native — 0176/0177/0178:** `student_direct_live_reviews`,
  `student_direct_live_obligations`, `student_direct_live_attempts`,
  `student_direct_live_events`, `student_direct_live_release_requests`,
  `student_direct_live_release_decisions`, `student_direct_live_review_bindings`,
  `bro_term_commission_entitlements`. The 0179 repair is procedural only.
- **Current lifecycle — 0181:** `current_subscription_operations`,
  `current_subscription_operation_events`, `current_subscription_reference_claims`.
- **Current extensions — 0182:** `current_payment_batches`,
  `current_bulk_allocations`, `current_bulk_confirmations`, `current_bulk_events`,
  `current_bulk_bro_entitlements`, `current_bro_withdrawals`,
  `current_bro_withdrawal_lines`, `current_bro_withdrawal_decisions`,
  `bro_field_sms_permissions`, `bro_field_sms_campaigns`,
  `bro_field_sms_recipients`, `bro_field_sms_events`.
- **Free terms — 0183:** `owner_free_academic_terms`,
  `owner_free_academic_term_events`.

Existing parents/read dependencies are not replacements for these roots:
`schools`, `students`, `app_users`, `school_memberships`, `academic_sessions`,
`academic_terms`, `audit_logs`, `school_partner_attributions`, BRO profiles
and existing subscription/history records. Use the existing
`inspectDirectReleaseSchema` column/permission contract, reconciliation and
fresh structural diff; the packet's table-presence rows alone cannot certify
columns, tenant FKs, CHECKs, indexes, records, RLS or all-writer privileges.
Retain the reviewed 0180 versioned pricing CHECK semantics where applicable.

## 4. Exact procedural inventory

| Group | Functions | Trigger bindings |
|---|---|---|
| Student/native BRO | `guard_student_direct_history`, `guard_student_direct_attempt`, `guard_bro_term_commission_history`, `guard_bro_term_commission_scope` | Nine below |
| Current extension | `guard_current_bulk_scope`; reuses `guard_student_direct_history` | Seventeen below |
| Free terms | `reject_free_term_evidence_mutation`, `validate_free_term_scope` | Three below |

**Student/native BRO — nine:** `student_direct_review_history`,
`student_direct_obligation_history`, `student_direct_event_history`,
`student_direct_attempt_history`, `student_direct_release_request_history`,
`student_direct_release_decision_history`, `student_direct_release_binding_history`,
`bro_term_commission_append_only`, `bro_term_commission_scope_guard`.

**Current lifecycle — three:** `current_subscription_operations_history`,
`current_subscription_events_history`, `current_subscription_claims_history`.

**Current extension history — twelve:** exactly `<table>_history` for the twelve
0182 tables listed above. **Current scope — two:** `current_bulk_allocation_scope`
and `current_bulk_bro_scope`.

**Free terms — three:** `owner_free_terms_immutable`,
`owner_free_term_events_immutable`, `owner_free_terms_scope`.

The manifest and generated SELECTs enumerate every exact table/function binding,
event/type mask and row/statement level. Verification checks normalized exact
bodies, invoker/PLpgSQL/volatile/non-strict/non-leakproof/parallel-unsafe function
properties, no function settings, and normally enabled, unconditional,
non-constraint, zero-argument/non-inherited triggers with no column restriction.
It does not mistake matching names/counts for enforcement.

## 5. Stage status and acceptance

Evidence is reused from the linked prior reports; no new operational acceptance
or all-green combined payment run is implied.

| Stage | Source / disposable evidence | Configuration and schema | Operational acceptance still required |
|---|---|---|---|
| **1 Student ₦3,200** | Existing checkout, independent V3 verification, authenticated ingress, permanent claims, immutable finalization and exact school/term/review/calendar checks retained. No new application defect demonstrated. Prior direct/guard/release evidence reused; new packet rehearsal below. | Correct LIVE runtime/key/hash/merchant/endpoints plus separate `EDUCORE_FLUTTERWAVE_DIRECT_RELEASE=STUDENT_DIRECT_3200_V1` remain required, not set. Student/native BRO group; **also free-term guards where its tables exist**, as in the prior Production observation. | Exact primary schema/rights, merchant/non-split/webhook evidence, saved eligible school term, current priced rule, fresh reconciliation and unexpired Owner-reviewed release; connected scoped reads and later separately authorized real charge/receipt/replay. Before the real eligible term, a free-term refusal is correct, not a failing payment path. |
| **2 Staff ₦2,000** | Pricing/calendar/access logic and prior V3 webhook repair retained. Existing checkout reservation, verifier and refunds still select TEST/SANDBOX. No safe isolated selector change establishes LIVE. No staff LIVE fixture evidence invented. | Requires a coordinated staff-scoped release contract and adapter/mode binding across checkout, webhook, verification, refunds and reconciliation without enabling the already-configured global LIVE mode. Existing eight staff tables below; do not relabel history. | First complete/review that coordinated Development-source path and focused evidence. Then separately accept eligible staff/term checkout, exact independent verification, duplicate/unknown cases, receipt and refund completion. Student approval cannot authorize staff. **Not source-complete for LIVE.** |
| **3 BRO ₦150** | Native accrual and current withdrawal/per-line Owner decisions, frozen verified bank evidence, holds and provider-bound read-back retained; prior PostgreSQL/adapter evidence reused. | Native BRO functions/bindings and current groups; approved effective-dated BRO rule and genuine verified eligible student payments. No transfer initiation added. | Same eligible student counts/earnings for Owner and actual BRO; eligibility/maturity/approval/bank snapshot; real independently completed payout evidence for the exact supported reference. Unsupported incoming recovery/reversal evidence stays held, not “paid” or auto-debited. |
| **4 Aggregate payments/refunds** | Existing single aggregate checkout, independently verified amount, atomic per-student allocation/receipts, duplicate claims, refunds and adverse holds retained. Prior 26-case integration evidence includes later SMS cases; not rerun. | Student direct gate/reviews plus 0181→0182/current group. Aggregate scope is students, not invented mixed staff billing. | Exact batch amount/allocation/fees, receipt/ledger totals, independent refund ID and completed-bank status, duplicates and uncertain outcomes. Failed-reservation release and partial-refund access policies remain explicit holds where unresolved. Never automatically recreate uncertain checkout/refund requests. |
| **Free terms** | Existing Owner-only calendar-term grants/audit and prior 26 PostgreSQL/17 HTTP/24 UI-route checks retained. | Prior report: two tables present but two functions/three triggers missing in Production; Development already installed. Use free group, preserve rows and independent locks. | Exact guard/tenant/calendar/rights parity and authenticated grant/status display. Any actual grant/suspension needs separate business approval; it is not payment, refund or BRO earnings. |
| **Field SMS** | Existing single/multi eligible-list selection, session/cookie fix, exact preview/confirmation and prior layered evidence retained; no rebuild or new browser run. | Four SMS tables plus 0181/0182/current guards; actual provider selection, legitimate per-contact consent and explicit Owner controls. No new provider/settings. | Connected Owner session and mobile selection/preview first, without send. Later separately approved message/recipients/budget and provider/handset evidence. Preserve opt-outs and unknown-send holds. |
| **Notifications** | Existing claim client is released in `finally` before provider dispatch; no proven leak found to repair. Prior continuity/consent/inbox evidence retained. | Prior Production logs: intermittent DB-acquisition timeouts while Telegram config READY; later readiness succeeded. Underlying pool/target/contention cause remains unproven. | Verify primary binding and bounded pool health; correlate communication/teacher jobs and DB waits without customer payloads. Recipient-owned links, consent, channel/launch eligibility, persisted inbox and actual delivery are separate checks. No speculative pool increase, worker restart or backlog replay. |

Stage 2's existing 0031 roots: `staff_nfc_billing_rules`,
`staff_nfc_subscriptions`, `staff_nfc_payments`, `staff_nfc_refunds`,
`staff_nfc_allocations`, `staff_nfc_provider_events`,
`staff_nfc_partner_commissions`, `staff_nfc_receipts`. Reconcile subsequent
approved migrations/current model rather than reapplying the original create SQL.

## 6. Ordered operator procedure — prepared only

1. **Stop gate:** satisfy section 1, select stage scope and recovery coverage;
   record hashes with `--check`. Keep financial release, rules and sends closed.
   Capture existing definitions/enablement with `capture-definitions.sql`.
   Check `SELECT current_database(),current_user,version(),pg_is_in_recovery();`
   against independently established target identity; this query alone is not proof.
2. **Development delivery approval, if needed:** native roots/0179 and free
   terms were previously installed in Development; do not repeat them blindly.
   The prior report has 0181/0182 unapplied. Only after new approval, verify
   parent/guard/target/retention prerequisites and apply the unchanged 0181
   then 0182 candidates to shared Development. This task did not do that.
3. **Pre-Publish functions, separate Production approval:** an approved operator
   uses the documented Production SQL console with editing temporarily enabled.
   Run only the chosen `*.functions.sql` files; these introduce no tables/rows
   and were rehearsed before parent tables existed. Record committed phase and
   disable editing. Do not run full historical migration files in Production.
4. **Structural delivery, separate publication approval:** review one fresh
   managed Publish diff, preserving existing records and dependency order.
   For Stage 1, existing root/free tables may need no structural change;
   later stages require the approved new 0181/0182 structures. Reject destructive
   recreation, wrong CHECK/FK/tenant semantics or drift; do not bypass the preview.
   Functions are not proof that tables/triggers exist.
5. **Post-table triggers, separate Production approval:** after required
   structures exist, the operator applies selected `*.triggers.sql` files.
   For Stage 1 use **student plus free-terms** with the prior table-presence
   state. For later current extensions install student functions first, then
   current functions/triggers after 0181/0182 structures exist.
   Missing tables or mismatched function bodies/properties abort before rebinding.
   Disable SQL-console editing afterwards.
6. **Read-only verification:** run each selected `*.verify.sql`; all required
   function/trigger `matches` must be true. Compare the fresh structural
   preview/actual column, FK, CHECK, index and runtime-rights contracts separately.
   Verify persisted rows/history were preserved and the correct source revision
   serves the app. A ledger entry/empty diff/health 200 is not acceptance.
7. **Runtime and release approval:** perform the stage-specific acceptance above.
   Only then separately consider exact school/term rules and LIVE release
   controls. Current free/calendar gates remain authoritative. Never claim
   verified provider/bank delivery from fixture success or a published build.

No operator action above was performed. If the supported target procedure is
not cleared or the staff source gap remains, report the exact stage blocked;
do not enable all capabilities to make the checklist appear complete.

## 7. Verification queries and recovery

The three `*.verify.sql` and `capture-definitions.sql` files are the exact
parameter-free, SELECT-only schema queries. They were executed **only in the
fresh disposable fixture** here, not against either shared database.

Prepared bounded diagnostics for notification timeouts (not run here):

```sql
SELECT state,wait_event_type,wait_event,count(*) AS connections
FROM pg_stat_activity WHERE datname=current_database()
GROUP BY state,wait_event_type,wait_event ORDER BY connections DESC;
SELECT current_setting('max_connections') AS server_connection_limit,
       current_user,pg_is_in_recovery();
```

No query text, recipient content, tokens or connection strings are collected.
Limited monitoring visibility is not proof of no contention. Compare approved
runtime pool/instance/job concurrency evidence before proposing a source change.

**Recovery:** an error rolls back the current file only. Earlier committed
function/structural phases remain; keep all release/send gates closed and record
that partial state. Prefer a reviewed forward correction. Restore earlier
definitions/enablement only from the captured, reviewed target evidence under
separate approval. Never drop newly populated financial/grant/SMS tables, clear
claims, rewrite history, remove guards or resend ambiguous provider operations.
If a data restore is necessary, stop for the independently accepted recovery
point and explicit data-loss/scope decision; object-definition capture is not
a backup and no new backup service/script was built.

## 8. New focused evidence and remaining boundary

The new offline package checks cover source/hash identity, refusal of changed
source contracts and one pinned Unix-socket-only PostgreSQL fixture. The fixture
rehearses pre-table function installation and rollback, post-table idempotency,
all seven exact bodies/29 bindings, altered/disabled guard detection, missing
parent/body and wrong-operator refusal, and unchanged empty financial/grant/SMS
tables. It imports no application or provider configuration and accepts no
target connection arguments.

Prior business/provider/browser evidence is reused from the activation report,
SMS and free-term completion reports. No new payment suite, browser journey,
shared migration, Production catalog query/configuration change, API restart,
provider API operation or message send was needed. No new Stage 2–4 feature or
unproven notification-pool fix was introduced.

**Prepared package ≠ installed schema ≠ approved release ≠ authenticated runtime
acceptance ≠ real-provider verification.** Stage 1 source is retained with its
protections, and the schema package is review-ready; target clearance, schema
delivery, current configuration/rules/merchant evidence and operational
acceptance remain required before calling student LIVE ready.
