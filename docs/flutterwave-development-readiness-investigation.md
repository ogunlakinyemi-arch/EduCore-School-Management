# Flutterwave LIVE readiness — Development investigation, 2026-10-22

## Safety boundary

No LIVE key was enabled. Checkout, verification transport, financial webhook
processing, refunds and transfers remain hard-disabled. No Flutterwave request,
real/TEST transaction, notification send, application migration, secret change,
Production configuration change or publication was performed.

Current Replit source was compared with freshly fetched GitHub main. Main lacks
some of the local readiness/resilience work; it was used as reference only.
No local work was replaced and nothing was pushed.

## Database/communication-worker findings

Verified from implementation and sanitized managed-workflow diagnostics:

* The communication worker uses the API's imported singleton pool. It has no
  independent database URL or credential configuration.
* The normal pool's source is runtime-managed `DATABASE_URL`, resolved by pg.
  The explicit local-terminal-test mode is a separate fail-closed branch.
  The API artifact's Development command does not override the database URL.
* The current managed Development process reported target fingerprint
  `e309d02798c9fa41ee61a22c`, source `DATABASE_URL_PG_RESOLUTION`, and
  `communicationWorkerUsesApiPool: true`. This fingerprints host/port/database
  routing only, not credentials, connectivity, provider ownership or schema.
* The inspected Development log snapshots contain no class-28 authentication
  failure; they report paused workers. Historical **deployment** log snapshots
  contain SQLSTATE `28000` communication-worker failures. Those are not evidence
  of a separate or currently broken Development worker connection.
* The secret-existence check reports `DATABASE_URL` runtime-managed and present.
  No secret values were inspected or printed.

**Not established:** the original backend reason for `28000`, current successful
worker authentication, the historical deployed target/credential identity, or
matching Development/Production catalog state. The worker is paused, so absence
of errors is not evidence of worker recovery. No credential/source rewrite is
justified by the available evidence.

Minimal safe change: Development startup now emits only an opaque target
fingerprint, configuration-source label and shared-pool fact. Authorization
diagnostics additionally classify known password/role/access-rule rejection
wording into fixed codes, without returning raw error messages, names, URLs or
credentials. Unknown `28000` causes remain `UNSPECIFIED`.

Existing recovery behavior is retained: dropped idle connections do not crash
the pool; only clearly transient **pre-SQL connection acquisition** is retried.
Class-28 authorization failures are not retried inside a tick. SQL, writes,
transactions and entire job runs are never automatically replayed. The next
scheduled tick is the recovery opportunity; persisted per-job idempotency is
still required. Workers were not unpaused to test recovery.

## Development-safe readiness fixes

1. The read-only Owner preview now checks critical processing columns across all
   isolated LIVE tables, not just the authority-review table. Missing columns
   are reported even when every table name exists. This remains an observation,
   not migration acceptance or release approval.
2. The Owner UI clears evidence and reports when the authenticated Owner identity
   changes, including Owner-to-Owner switching. Requests remain authenticated
   and non-Owners are refused before database access.
3. Readiness explicitly preserves historical allocation policy. SCV3 is NGN
   5,000 checkout with one school `flat_subaccount` allocation of NGN 1,900,
   omitted split ratio, no Partner checkout recipient, and eligible Partner NGN
   100 as internal accrued payable. Historical SCV2 rows/allocations are unchanged.

## Migration draft review — no execution

The four drafts remain outside the automatic migration journal:

| Order | Draft in lib/db/dev-reconciliation | SHA-256 |
|---|---|---|
| 1 | flutterwave-live-webhook-inbox.up.sql | ab644e6a38bdd1d9d4ef63f52cd971a05153e777b65d730567dac1ed231f874d |
| 2 | flutterwave-live-finalization.up.sql | 62f70bc39f92852fd8219b0da063fc2299f3530fd8a4356fe197049f40eb4b1a |
| 3 | flutterwave-live-workflow.up.sql | a7e83947d2338d762a1830814d68f2be470e19866c46be84a8bccfad08d3c67a |
| 4 | flutterwave-live-readiness.up.sql | 88e4bfa3eae084e6072b33d77125f9dc17bc74d5445fea1b28458522d9991a8c |

Static tests read the drafts only: referenced LIVE tables precede dependent
tables, authority uniqueness is declared before dependent intent constraints,
critical preview column names exist in the appropriate CREATE/ALTER blocks,
and no shared subscription/payment DDL/backfill is introduced. Reverse order
remains mandatory for a separately reviewed rollback.

These checks do **not** prove actual-target schema/ledger compatibility, index
ownership, populated-record acceptance, successful DDL or rollback. The detailed
prior review is in `flutterwave-live-migration-review.md`. No SQL draft changed.

## Webhook/finalization/reconciliation evidence

Mocked storage tests show exact redelivery reuses a receipt identity and counts
delivery attempts without financial writes. A lost COMMIT response is not
acknowledged; redelivery can recover that receipt. Default workflow capability
rejects finalization/reconciliation before database access. An authenticated
Owner can inspect missing-schema readiness, but operational receipt-review
routes remain 503 with default runtime construction.

These are mocked application-contract tests, not actual PostgreSQL concurrency,
provider delivery, semantic financial-finalization or bank-settlement evidence.
The existing public LIVE ingress remains receipt-only/non-finalizing and does
not acknowledge financial success. There is no runtime-enabled replay worker.

## Exact remaining blockers / next approval

| Blocker | Required evidence or approval |
|---|---|
| Historical database authorization cause | If reproduced, sanitized fixed-code diagnostics from the affected runtime plus configuration-owner verification of its provisioning. A pool fingerprint or SQLSTATE alone cannot justify changing credentials. |
| Application target migration readiness | Read-only verification of the exact intended target, catalog, constraints/index ownership and migration ledger, then explicit approval of the exact ordered drafts and rollback/recovery plan. No target apply was authorized here. |
| Merchant fee bearer and LIVE school identity | Reviewed, redacted real merchant-dashboard/account evidence binding merchant, school and LIVE subaccount, including ownership and fee-bearer settings. RS_ naming and TEST success do not prove this. |
| Independently authenticated recipient reader | A reviewed actual provider contract/reader and transaction-bound school NGN 1,900 evidence. Checkout metadata or aggregate settlement is not sufficient; no endpoint is invented or called here. |
| Public webhook acceptance | Approved environment-bound authentication/version, public HTTPS routing, TEST/LIVE verifier separation, adverse-event handling, durable finalization, uncertainty/reconciliation and recovery acceptance. |
| Owner/family acceptance | Genuine signed-in Development browser review remains separate from fixture-identity HTTP/DOM tests. The current screenshot can verify only the signed-out shell. |
| Final financial acceptance | Separate approval for controlled provider/account verification, transactions and bank settlement/cost reconciliation. No test or real transaction was authorized by this investigation. |
| LIVE release | Explicit reviewed release plan and authorization. Credentials/configuration or a matching evidence preview must never bypass the hard-coded operational gates. |

**Next approval:** authorize the evidence/target-verification stage and review the
redacted merchant evidence and exact migration plan before considering any
application DDL or controlled provider acceptance. Merely authorizing a LIVE key
toggle would not clear these independent blockers.
