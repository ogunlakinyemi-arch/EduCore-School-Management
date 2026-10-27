# Default-disabled Flutterwave LIVE SCV3 runtime

## What Development can safely implement

Implemented without real school subaccounts, application database migrations,
Production setting changes, provider requests, charges or publishing:

- Separate TEST and LIVE V3 webhook verifier selection.
- V3 LIVE hosted checkout and independent transaction verification transport.
- A permanent, transaction-bound checkout claim; uncertain initialization is
  never automatically resent or switched to a new reference.
- Strict signed-webhook finalization through the existing isolated LIVE ledger.
- Callback verification that does not trust `status=successful` or manufacture
  webhook authenticity.
- Owner-reviewed school configuration and transaction allocation report records.
- An additive migration draft, guarded rollback, OpenAPI contracts, generated
  clients/validators and credential-safe release checks.

The legacy blocked adapter and Development evidence previews remain available.
The operational runtime is separate and disabled by default. TEST/SANDBOX
financial history is neither converted nor updated.

## Preconditions for a later, explicitly approved release

Current configuration is defined in [the payment-mode guide](flutterwave-payment-mode.md).
The earlier shared-verifier/scope-flag instructions are superseded.

Secure configuration:

- `FLUTTERWAVE_LIVE_SECRET_KEY`: dedicated LIVE V3 merchant secret.
- `FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH`: required dedicated LIVE verifier,
  matching the LIVE dashboard. No shared/generic/TEST fallback is permitted.
- TEST credentials are not a prerequisite for LIVE. If a dedicated TEST verifier
  exists, it must remain distinct from LIVE. Never copy or expose verifier values.

Production-only runtime selection:

- `NODE_ENV=production`
- `EDUCORE_FLUTTERWAVE_MODE=LIVE`
- `EDUCORE_FLUTTERWAVE_RELEASE=SCV3_V1`
- `EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE`: reviewed stable merchant scope.
- `PUBLIC_APP_URL`: explicit reviewed HTTPS application base, without credentials,
  query strings, fragments, development hosts or localhost. This runtime does
  **not** infer a production callback from a request Host header.
- `FLUTTERWAVE_LIVE_WEBHOOK_URL`: exactly
  `<PUBLIC_APP_URL>/api/webhooks/flutterwave/live/student-subscription`, recording
  the reviewed LIVE dashboard registration expectation, not independently
  proving dashboard registration.

`EDUCORE_FLUTTERWAVE_MODE` is the sole mode selector. The obsolete
`EDUCORE_FLUTTERWAVE_LIVE_ENABLED` and
`EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT` flags are ignored.

All of those plus a separately approved target release manifest are required
before outbound HTTP. A missing table, absent manifest, wrong merchant scope or
disabled manifest remains fail-closed. A release check is not proof that every
school or transaction is ready.

The target preflight checks the required LIVE ledger, lifecycle and operator
tables/columns and enabled row-level history guards, not just the presence of
the release marker. Missing or disabled immutable-history protection blocks
outbound checkout before a checkout claim is written. This is a runtime
compatibility check, not a substitute for reviewing/rehearsing the full target
migration and comparing its constraints/indexes against the approved DDL.

Existing TEST adapters remain unchanged and cannot be selected as a LIVE
fallback. The global LIVE/TEST mode selector remains exclusive as before;
separate verifier support does not promise simultaneous TEST checkout in LIVE
mode. Development retains TEST mode.

### Exclusive modes and separate dashboard secrets

| Selected mode | TEST verifier | LIVE verifier |
| --- | --- | --- |
| Unset or `TEST` | Dedicated TEST verifier, or retained legacy TEST verifier when no dedicated one is configured; no LIVE reuse | Disabled |
| `LIVE` | Disabled | Dedicated LIVE verifier only |
| Invalid, blank or padded value | Disabled | Disabled |

Complete/reconcile outstanding TEST attempts before switching modes. Configuration
selection cannot bypass the release manifest, verified school authority or
independent transaction verification.

Both authenticated and guest TEST payment-link checkout checks use this selector;
a dedicated-TEST-only configuration no longer incorrectly requires the shared
variable. Exact constant-time `verif-hash` authentication remains in the adapters.

## Migration review — no automatic application

**Current managed-release blocker and supplied Support guidance:**
[protected SQL Publish handoff](finance/flutterwave-live-managed-publish-blocker.md).
The [minimal checkout package](finance/flutterwave-live-checkout-installation.md)
pins the first five stages; new school-subaccount onboarding is separate.
The sequence below is a dependency/review specification, not permission to run
raw Production DDL. No supported importer is configured in this repository.

Existing reviewed drafts must be installed in dependency order on an explicitly
verified target, with backup and separate migration authorization:

1. `flutterwave-live-webhook-inbox.up.sql`
2. `flutterwave-live-finalization.up.sql`
3. `flutterwave-live-workflow.up.sql`
4. `flutterwave-live-readiness.up.sql`
5. **New:** `flutterwave-live-runtime.up.sql`
6. `flutterwave-live-school-onboarding.up.sql` — separate onboarding capability;
   included in the six-file review package, not a grant of checkout approval.

All are under `lib/db/dev-reconciliation/`. The new draft does not seed an
enabled release. It adds the target release manifest, append-only per-school
authority configuration, one-time checkout claims and immutable transaction-bound
allocation reviews. Rollback refuses populated runtime history. Disable new
checkout using runtime configuration/manifest before any later rollback review;
do not delete financial evidence to force rollback.

No application Development or Production database migration is authorized or
performed by the disposable fixture tests.

## Review/configuration endpoints

All routes are mounted below `/api`; protected routes require existing
authentication and current roles:

- `GET /flutterwave/live/release-check`: Owner-only configuration/target checks.
- `POST /flutterwave/live/school-configuration`: Owner-only, hash-bound LIVE school
  ownership and merchant fee-bearer review. Expires within 30 days; changes append
  a new review rather than rewriting history. No provider account creation.
- `POST /flutterwave/live/allocation-review`: Owner-only review of a real,
  transaction-specific Flutterwave allocation report. Requires independent V3
  readback of the exact transaction/reference/fees before storing the report
  commitment. It does not mark paid or accrue commission.
- `POST /flutterwave/live/checkout`: current School Admin only; canonical SQL
  rechecks role, tenant and active student. Owner is excluded from ordinary
  school payment issuance. Request contains school/student/term IDs and a stable
  idempotency key, not prices, recipients, Partner IDs or commission.

Each school needs its **actual LIVE subaccount** under this merchant. A TEST
recipient, blank ID or `RS_SCHOOL_LIVE_SUBACCOUNT_ID` cannot substitute. Before
renewing an authority review, use a new school-configuration review with the
same evidence binding required by the intended checkout. Never relabel TEST IDs.

## Checkout and verification

The only API origin used by this dedicated transport is
`https://api.flutterwave.com/v3/`, authenticated only by the dedicated LIVE key.
TEST and LIVE V3 share that official API origin; credentials determine the
environment. No sandbox/test origin or TEST credential fallback exists here.

The checkout request fixes NGN 5,000 and exactly one school instruction:
`transaction_charge_type=flat_subaccount`, `transaction_charge=1900`.
There is no Partner checkout recipient or percentage ratio. Merchant fee-bearing
is an independently reviewed dashboard prerequisite, not an invented API field.
The charged amount must verify as exactly NGN 5,000 with explicit fee components.

V3 transaction verification is a real GET transport, with bounded response size,
timeout, strict transaction/reference/currency/amount/charged-amount validation,
no redirects and sanitized errors. A successful collection response alone is
not independent proof of school allocation.

**Allocation evidence limitation:** no undocumented settlement-report endpoint
or response fields are invented. An Owner must review a genuine transaction-bound
Flutterwave report showing NGN 1,900 to the intended school subaccount and record
its digest against the exact transaction/ref/provider ref. Missing, stale or
mismatched allocation evidence blocks finalization, even for an otherwise
successful collection. Echoed `subaccounts` and metadata are never evidence.
This is a deliberate manual reconciliation gate, not automatic report retrieval.

## Callback and webhook behavior

Callback: `{PUBLIC_APP_URL}/api/flutterwave/live/callback`

The callback accepts bounded `transaction_id` and `tx_ref`; the supplied status
is ignored as authority. It independently verifies against a frozen LIVE intent.
It returns 200 only for an already finalized, unheld payment, 202 while awaiting
an authenticated webhook or held, and a non-paid error on uncertainty. It does
not invent a signed inbox receipt or independently credit a Partner.

Webhook: `{PUBLIC_APP_URL}/api/webhooks/flutterwave/live/student-subscription`

The V3 shared `verif-hash` is checked in constant time before any DB acquisition.
After configuration and target gates, the original raw bytes bind the durable
receipt fingerprint. The runtime independently verifies collection and reviewed
allocation, then atomically commits collection evidence, semantic event/result,
term activation, immutable receipt and eligible NGN 100 Partner accrued liability.
Only after the coordinated commit may the runtime return HTTP 200. Holds are
protective states, not successful payments. No payout or Paid commission is
asserted. Legacy diagnostic ingress still returns 503.

Pending/mismatched/unknown outcomes return non-success acknowledgements and
remain unresolved. Configure Flutterwave retries and reconciliation before
release. Original payloads are not retained for replay; provider redelivery or
separately authorized original evidence is required. Duplicate/reordered
deliveries cannot create another collection/accrual, and signed adverse evidence
retains a hold. Callback-only finalization is intentionally unsupported.

## Release checks and verification

Credential-safe, configuration-only check (no DB or network):

`pnpm --filter @workspace/scripts exec tsx src/flutterwave-live-runtime-release-check.mjs`

After independently approving the intended read-only database target, operators
may add `--check-target` to inspect the release manifest/schema using SELECTs.
This command does not apply migrations, populate reviews, enable flags or contact
Flutterwave. A green global result does not certify school ownership or actual
provider settlement.

Run the focused runtime, LIVE configuration, split authority and disposable
workflow/finalization/inbox tests before release. The new runtime tests use only
fictional HTTP and temporary local PostgreSQL; they cover checkout replay and
unknown outcomes, exact allocations, report-gated finalization, HTTP 200 after
commit, duplicate credit protection, callback-before/after-webhook behavior,
role/ownership boundaries and rollback refusal.

Actual merchant credential validity, dashboard webhook binding and fee-bearing,
real school ownership, real provider allocation reports, target migration
approval, controlled real acceptance and publishing remain external release
prerequisites. This implementation does not claim any of them are complete.
