# Owner free academic-term grants — Development source completion

## Final status

Implemented in Development source on 23 November 2026, using the merged
subscription/calendar implementation. Isolated tests, typechecks and disposable
API/web builds passed. **Not migrated to shared databases, activated, deployed
or accepted in an authenticated running Owner session.**

The Owner workflow is in **Subscriptions → Free academic terms**. It accepts any
existing school from the full school list, then that school's saved academic
session and term. An inactive school can receive an audited grant but remains
inactive; a grant never creates school authorization or clears a manual lock.

## Delivered behavior

- Required, trimmed reason and separate review/confirmation for both
  **Grant Free Academic Term** and **Suspend**. The request includes the dates
  reviewed by the Owner; stale or cross-school/session/term requests are denied.
- Server-authenticated administrator ID and database-generated timestamp,
  school/session/term, original date snapshot, reason and action status are
  retained in append-only grant/event records.
- Trial Granted before the saved start date; Active during the inclusive saved
  date range; Completed after its end, evaluated in Africa/Lagos/WAT.
  Suspended represents withdrawn or invalidated free entitlement or an
  independent school lock in the Owner overview. Payment Required/Paid come
  from existing normal term eligibility/verified school coverage, not grants.
- The grant's stored initial status is `TRIAL_GRANTED` (the granting action).
  Active and Completed are read-time calendar states, not worker-created
  financial transactions. Suspension appends an event; it does not edit history.
- Any change to the granted term's saved dates makes the grant inapplicable
  rather than silently extending it. Completed/suspended grants cannot be
  replaced with duplicate grants. There is no reinstatement/date-adjustment
  operation in this feature.
- Exact school/term uniqueness, a shared school transaction lock, matching
  school/session/term validation and an overlap check prevent duplicate,
  concurrent or ambiguous grants. Direct and aggregate Student checkout and
  Staff checkout share the lock around their fresh eligibility checks.
- Existing unresolved direct, aggregate or Staff checkouts prevent a new grant:
  they must be reconciled rather than cancelled or repriced. Existing verified
  payments can coexist with a grant and remain unchanged.
- A valid grant suppresses new ordinary platform subscription collection and
  supplies non-payment usage eligibility through existing access/enforcement
  services. No payment, receipt, invoice-paid flag, refund, BRO liability,
  commission or financial-ledger posting is created by a grant or suspension.
- Current free-launch access, each school's January 2027 second-term anchor,
  approved prices, seven-day normal Student grace, and historical verification
  remain unchanged. Suspension cannot introduce payment during the free launch.
  The next term has no inherited grant and follows its own saved calendar and
  ordinary billing/release rules.
- Historical payment finalization and BRO eligibility retain the base rollout:
  a later free grant does not rewrite the eligibility of an earlier genuine
  payment. A grant itself supplies no paid evidence.
- Manual school locks, role/tenant authorization, inactive identities and
  physical NFC/card/device safety checks remain independent. This is free
  platform usage, not NFC activation or payment verification.
- Owner-only selection, status/date overview, immutable history with WAT
  timestamps, loading/error/empty states and mutation cache refresh are wired.
  An ambiguous submit requires a status refresh; it is never retried
  automatically. Database uniqueness also protects reload/re-entry.

## Exact source files

### API, access and billing integration

- `artifacts/api-server/src/routes/owner-free-academic-terms.ts`
- `artifacts/api-server/src/routes/subscription-enforcement.ts`
- `artifacts/api-server/src/routes/staff-nfc-billing.ts`
- `artifacts/api-server/src/services/owner-free-academic-terms.ts`
- `artifacts/api-server/src/services/owner-free-academic-term-read.ts`
- `artifacts/api-server/src/services/student-platform-rollout.ts`
- `artifacts/api-server/src/services/student-platform-access.ts`
- `artifacts/api-server/src/services/subscription-enforcement.ts`
- `artifacts/api-server/src/services/staff-free-rollout.ts`
- `artifacts/api-server/src/services/direct-student-live-payments.ts`
- `artifacts/api-server/src/services/current-bulk-subscription-plan.ts`
- `artifacts/api-server/src/services/current-bulk-subscriptions.ts`

### Owner UI and focused new tests

- `artifacts/edupulse/src/components/owner-free-academic-terms.tsx`
- `artifacts/edupulse/src/pages/subscriptions.tsx`
- `artifacts/edupulse/src/components/owner-free-academic-terms.test.tsx`
- `artifacts/api-server/src/routes/owner-free-academic-terms.test.ts`
- `artifacts/api-server/src/services/owner-free-academic-terms.postgres.test.ts`

### Contract and unapplied schema candidates

- `lib/api-spec/owner-free-academic-terms.yaml`
- `lib/api-spec/openapi.yaml`
- `lib/api-spec/orval.config.ts`
- `lib/db/drizzle/0183_owner_free_academic_terms.sql`
- `lib/db/src/schema/owner-free-academic-terms.ts`

The ORM candidate is deliberately **not exported into automatic shared schema
generation**. SQL includes checks, tenant foreign keys, uniqueness, immutable
UPDATE/DELETE/TRUNCATE guards and saved-calendar insert validation. Runtime
readiness checks require enabled guard triggers. Partial/disabled guard delivery
fails closed rather than treating an existing grant as a new payable obligation.
Schema export/parity, supported procedural delivery and operational database
permissions still require separate review; model metadata is not migration proof.

### Regenerated files

- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/changeOwnerFreeAcademicTerm200.ts`
- `lib/api-zod/src/generated/types/freeAcademicTermSelection.ts`
- `lib/api-zod/src/generated/types/getOwnerFreeAcademicTerms200.ts`
- `lib/api-zod/src/generated/types/getOwnerFreeAcademicTerms200HistoryItem.ts`
- `lib/api-zod/src/generated/types/getOwnerFreeAcademicTerms200TermsItem.ts`
- `lib/api-zod/src/generated/types/getOwnerFreeAcademicTerms200TermsItemStatus.ts`
- `lib/api-zod/src/generated/types/getOwnerFreeAcademicTermsParams.ts`

## Verification evidence

All new database operations ran only in an isolated local PostgreSQL cluster
under ignored `generated-artifacts/free-academic-terms/`. Tests verify the exact
data directory and Unix-socket connection before resetting that disposable
fixture. No shared database connection was used. API tests strip credentials,
use fake identities/transports where appropriate, and prohibit external fetches.

| Evidence | Final result |
|---|---|
| `services/owner-free-academic-terms.postgres.test.ts` | **24 passed**: actual candidate applied twice; enabled guards; inactive/non-Owner denial; school/session/term mismatch; reason/confirmation; existing/inactive-school grants; concurrent duplicate grants; calendar/WAT boundaries; suspension; immutable history; retained paid rows; no financial/student changes; Student/Staff free usage; next-term/other-school billing; changed dates; unresolved checkouts; manual locks; launch-policy preservation; partial-guard denial |
| `routes/owner-free-academic-terms.test.ts` | **17 passed**: anonymous and cross-role GET/POST denial, non-global Owner denial, exact school query/history, six status paths, verified Paid vs grants, school lock, unapplied storage, authenticated actor and unsupported scope/action rejection |
| `services/staff-free-rollout.test.ts` | **17 passed** |
| `services/student-platform-rollout-access.test.ts` | **6 passed** |
| Affected backend continuation | **64 passed across 4 files** |
| Final calendar-close correction | **24 PostgreSQL tests passed** again after asserting that a normally closed `COMPLETED` term stays Completed, not Suspended; no additional distinct tests counted |
| Other unchanged passing files in preceding coherent backend run | **86 passed**: `routes/subscription-enforcement.test.ts` (20), `routes/staff-free-checkout.routes.test.ts` (2), `services/direct-student-live-payments.test.ts` (7), `services/student-platform-rollout.test.ts` (7), `services/staff-subscription-access.test.ts` (39), `services/student-nfc-payment-evidence.test.ts` (11) |
| Backend distinct union | **150 checks across 10 files**, combining the 147-check run and the affected 64-check continuation; not 211 distinct tests or one 150-test execution |
| `components/owner-free-academic-terms.test.tsx` | **11 passed**, fake hooks/DOM: exact once-only confirmed body, reason/calendar/status rules, suspension, changed calendar, unapplied storage, failure/refresh/no retry, errors and WAT history |
| `pages/subscriptions.test.tsx` | **10 passed** |
| `pages/subscription-enforcement.render.test.tsx` | **14 passed** |
| `pages/subscription-enforcement.test.ts` | **5 passed** |
| Frontend distinct union | **40 checks across 4 files**, combining the 21-check run and the affected 30-check continuation without double-counting the 11 component checks |
| Contract generation and library types | Passed |
| API/frontend TypeScript checks | Passed |
| Disposable API and web production builds | Passed; bundles never executed |
| Web build advisory | Entry chunk approximately **2,805.70 kB** minified; existing size advisory, not a build failure |
| Diff/whitespace check | Passed |

The PostgreSQL fixture uses the actual new migration and minimal existing-table
contracts for retained payment/history reads, plus explicit retained
invoice/receipt/BRO/ledger evidence snapshots. It does **not** certify the full
shared schema, real provider behavior or production privileges. Preservation is
shown in the isolated fixture and by the absence of financial DML in grant paths,
not claimed as a shared-data comparison.

Initial verification exposed a fake-clock test-loading timeout from a heavy
dynamic import and test response typing errors. The reader was isolated and
typing corrected; the final affected tests and typechecks above passed.
An initial frontend invocation named a nonexistent enforcement `.test.tsx`;
its actual `.test.ts` and `.render.test.tsx` files were subsequently executed
and are counted explicitly above.

Logs retained (ignored, not deployment inputs):

- `generated-artifacts/free-academic-terms/backend-final.log`
- `generated-artifacts/free-academic-terms/backend-corrections.log`
- `generated-artifacts/free-academic-terms/calendar-final.log`
- `generated-artifacts/free-academic-terms/frontend-final.log`
- `generated-artifacts/free-academic-terms/frontend-corrections.log`
- `generated-artifacts/free-academic-terms/api-types-final.log`
- `generated-artifacts/free-academic-terms/web-types-final.log`
- `generated-artifacts/free-academic-terms/types.log`
- `generated-artifacts/free-academic-terms/api-build.log`
- `generated-artifacts/free-academic-terms/web-build.log`

## Blockers and operational boundary

1. **0183 remains unapplied to shared Development/Production.** No grant has
   been created in either shared environment. The Owner panel disables writes
   until schema/guard delivery is available. Existing 0181/0182 candidates are
   also unchanged and unapplied by this work.
2. **Authenticated runtime acceptance remains unverified.** No approved
   isolated signed-in Owner fixture was established. The only preview capture
   was an anonymous `/subscriptions` request, which rendered sign-in; it is not
   evidence of the Owner grant flow. Component/HTTP/PostgreSQL tests are not an
   authenticated browser or mobile-layout acceptance pass.
3. **No shared service restart or operational activation occurred.** Disposable
   compilation does not establish that the running shared API serves the new
   endpoints. No worker, payment, SMS, secret, provider setting, publication or
   deployment was enabled or changed.
4. **Calendar amendments and reinstatement are deliberately conservative.**
   Changed dates invalidate free entitlement; suspended/completed grants are
   not replaced or automatically resumed. A future reinstatement/date-review
   workflow would require separately agreed policy rather than historical edits.

This report documents source completion only, not permission to apply a
migration, restart a service or exercise the controls against real schools.
