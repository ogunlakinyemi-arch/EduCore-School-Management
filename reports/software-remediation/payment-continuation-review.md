# Yetenia EduCore payment verification continuation

Date: 2026-10-13. Development source changes only; no publication or API restart.

## Genuine provider evidence

The dedicated TEST credential was used internally for one GET to
`/v3/transactions/verify_by_reference`, scoped to the existing private
provider-only probe reference and its recorded NGN 5,000 amount.

- Provider response: HTTP 400.
- Outcome: unverified. The response does not establish a completed transaction
  or explain why the reference could not be verified.
- No transaction ID was established; the ID verification endpoint was not called.
- No checkout creation, card submission, payout, refund, provider settings
  mutation, callback navigation, application database access or notification.
- No credentials, private checkout URL, reference, customer data, raw upstream
  body or exception text are included in the public evidence.

Earlier bank-catalog authentication evidence remains separate: authenticated
HTTP 200 with 598 entries and unauthenticated HTTP 401. It is not payment evidence.
An existing hosted checkout was created in earlier work, but its saved observation
records no charge submission and it is not bound to EduCore financial records.

## Configuration and source review

Dedicated TEST secret/public/encryption credentials and a webhook verification
hash exist. Existence is not dashboard webhook configuration or delivery evidence.

The configured fee return URL is HTTPS, has no user information and matches the
workspace Development host. Its authenticated journey and the merchant's actual
TEST dashboard webhook destination were not verified. Do not infer webhook safety
from a browser return URL.

The existing disposable-parent-test target and acknowledgment are absent. No
existing, explicitly approved disposable finance target was established. No
database was started or connected to. Native finance integration tests were not run.
The existing script that starts its own PostgreSQL instance was intentionally
not executed. API target/startup-side-effect verification and restart remain held.

## Actual source changes

1. Development ordinary fee/staff checkout now selects the dedicated TEST aliases,
   as subscription checkout already did. It does not read or fall back to the
   generic potentially live key in Development. Conflicting/invalid TEST aliases
   fail closed. Deployed configuration and Paystack behavior are unchanged.
2. Provider webhook header extraction rejects repeated/ambiguous signature
   headers instead of selecting the first value. Single-header handling remains.
3. Added a provider-only existing-reference review tool: Development guards,
   known probe-reference scope, at most two bound GET transports, bounded timeouts,
   no redirects and sanitized evidence. It cannot initialize/complete a payment,
   settle records or create receipts/subscriptions.
4. Added 25 mocked safety tests and updated the prior credential-isolation
   expectation. Repaired the checkout fixture's missing ordinary-invoice answer
   to the existing legacy-NFC-charge query. The application financial check was
   not weakened.

## Exact checks in this continuation

| Check | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| Initial selected regression execution, 10 files | 184 | 11 | 0 |
| Corrected final execution, 11 passing files and one skipped file | 200 | 0 | 1 |

The initial 11 failures were in the checkout fixture, which did not handle the
current legacy-NFC invoice lookup. An initially mistyped transaction-binding file
argument was also corrected. Final counts are execution counts, not additive
unique totals across runs.

Final passing-file breakdown:

- New checkout/read-only/header safety: 25.
- Provider adapters: 45.
- Dedicated credential isolation: 6.
- Transaction-ID binding: 5.
- Reference verification: 13.
- Bank probe safety: 8.
- Fee webhook settlement: 29.
- Checkout reservation/reconciliation: 17.
- Subscription billing: 38.
- Subscription webhooks: 6.
- Subscription return URLs: 8.

The skipped test requires an approved disposable relationship-test target.
Provider/identity/persistence responses are mocked. Storage, locking, uniqueness
and rollback in PostgreSQL are not established by these counts. Test log messages
about notification failure are synthetic fault injection, not real sends.

Workspace TypeScript passed for shared references, API, web, sandbox and scripts.
No compiler settings or dependencies were weakened.

Fresh dependency audit: two critical, one high and three moderate entries remain:
tinypool (two), braces, vitest, @vitest/mocker and postcss-selector-parser.
No compatible tested patch was identified; no major upgrade or override was forced.

## Payment guarantees and evidence limits

The inspected v3 adapter matches Flutterwave's documented `verif-hash` protocol:
constant-time comparison, rejection before expected-record lookup on invalid hash,
then independent transaction verification. This is not a claim of raw-body HMAC
authentication or actual delivered webhook evidence.

Automated tests cover reference, returned/requested transaction ID, exact amount
and currency, pending/failed states, duplicate/concurrent callbacks, settlement
and receipt handling. Inspected settlement code uses transactional row locks,
duplicate guards and commit/rollback, with financial and subscription updates
following independent successful verification.

Those record updates were exercised with mocks only. No actual invoice credit,
subscription activation, receipt, finance allocation or durable idempotency was
verified. Never retroactively attach a standalone probe payment to a student.

## Blockers and preservation

A genuine in-app run requires a configured and explicitly approved existing
disposable target, approved synthetic payment records, suppression of real
notifications, verified TEST dashboard webhook routing and a safely verified
API runtime. The saved merchant-identity ambiguity also remains unresolved;
checkout display names/subaccount labels are not ownership evidence.

No Production connection/write, migration/schema push, deletion/reset,
publish/republish, API restart, real payment/notification, Clerk account/email,
or physical NFC/GPS/vendor change was initiated. These statements concern this
continuation's actions, not independent activity by existing workers/users.
