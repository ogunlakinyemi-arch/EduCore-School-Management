# Owner split dashboard policy correction — 2026-10-19

Previous handoffs: [subscription policy](2026-10-18-subscription-policy.md) and
[assignment retention](2026-10-19-assignment-retention.md).

## Source of the stale amounts

The working tree was clean. Read the current handoffs, fetched GitHub main and
compared the relevant files without overwriting prior local work.

The financial split section is `FlutterwaveSettlementsPage`, backed by
GET `/api/flutterwave/split-dashboard`, not the general dashboard totals API.
Its rules banner hard-coded School 2,000 / Owner 2,900 / Partner 100 and
Owner 3,000 without a Partner. It did not consume the versioned checkout policy.
The dashboard API supplied saved payment breakdowns but no separate current
policy metadata, so changing allocation calculations alone did not fix the UI.

The server already responds no-store; the client refetches on mount and every
30 seconds using identity-scoped keys. These mechanisms could not refresh a
hard-coded banner. A new cache-key namespace prevents reuse of pre-change
dashboard response shapes; no static financial fallback replaces missing metadata.

## Completed

- Added a current-policy accessor using the same version mapping selected by
  newly generated subscription references. Existing legacy-reference selection
  and missing-reference legacy defaults remain unchanged.
- Added an Owner-only `currentAllocationPolicy` API field and generated contracts:
  School 190,000 minor units; Owner 300,000 with an eligible Partner;
  eligible Partner 10,000; Owner 310,000 without an eligible Partner.
- The current banner renders that metadata, explicitly states both scenarios,
  and identifies processing fees as separate Owner expenses rather than
  deductions from the School/Partner credits. Missing metadata shows a warning,
  never historical values masquerading as the current policy.
- Saved payment references remain on their original recorded allocation and
  are separately labelled. No database rows, references, frozen instructions,
  paid allocations, receipts or historical provider fees were rewritten.
- Closed a disclosure gap: School Admin/Partner dashboards previously received
  complete split-payment objects, and School Admin could request full transaction
  evidence or reconciliation responses. Non-Owner dashboards now return null
  current policy and no full payment breakdowns; the full evidence/reconciliation
  endpoints require Owner before reading payment details or invoking services.
- Non-Owner school/Partner recipient-account submission and status remain
  available within their existing scopes. Other parties' full splits are hidden
  in the UI even if an older/overbroad response is supplied.

## Verification

- Code generation/shared-library build passed.
- **84 API/policy tests passed:** 24 split route/report tests, 8 versioned policy
  tests, 40 subscription allocation/billing tests and 12 split-checkout tests.
- Tests cover current amounts with separate legacy Partner/no-Partner saved
  histories, actual saved-row reporting projection, separate provider fees,
  read-only history access, Owner authorization, non-Owner dashboard filtering,
  and evidence/reconciliation denial for School Admin, Partner, Parent, Student,
  Teacher and Staff. Unauthenticated dashboard access is denied.
- **24 frontend tests passed:** current scenarios, absence of 2,000/2,900 in the
  current banner, unchanged historical display, metadata-unavailable warning,
  non-Owner hiding, identity isolation and existing offline verification controls.
- API/frontend typechecks and diff whitespace check passed.
- Managed API/frontend restarted cleanly. Development health returned 200;
  actual unauthenticated split dashboard returned 401; public sign-in rendered.
- Tests used mocked identities/database/provider interfaces and offline React
  interactions, not authenticated Clerk browser sessions or live bank evidence.
  **Authenticated browser acceptance remains unperformed.** No real application
  database historical-data comparison was made; preservation evidence is focused
  policy/projection tests plus the absence of any data-migration/write operation.

## Boundaries and separate remaining work

- This fixes workspace source; it is not published and does not change a
  previously published deployment.
- The prepared allocation migration remains unapplied. Displaying the intended
  current policy does not enable provider-split checkout, migrate CHECKs,
  confirm actual settlements or change default-off split settings.
- A separate TEST transaction-evidence reader still validates frozen plans with
  legacy constants. Version-aware read-only evidence validation and real
  signed-in Owner/non-Owner acceptance were proposed separately. Neither is
  claimed complete by this dashboard fix; provider reads were not attempted.
- The separately labelled local fictional simulation retains its own scenario;
  it is not used as the current-policy source or operational approval.
- Pre-existing NFC Hardware Test and Production communication-worker issues
  remain outside this pass.

No application schema/migration changes or migration applies, including 0167
and 0168; no live providers, real payments, secrets/payroll changes, Production
data changes, publishing or Git push. Test Mode and paused Development workers
were preserved. Unrelated audit fixes were not repeated.
