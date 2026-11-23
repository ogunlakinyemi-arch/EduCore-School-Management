# Connected payments and Field Operations SMS — Development source evidence

## Result and execution boundary

The former disconnected service candidates now have source-level provider
adapters, authenticated API contracts/routes, current projections and mounted
role-appropriate screens. Aggregate subscriptions, recoverable child posting,
BRO withdrawal requests and Owner-confirmed Field Operations SMS are implemented.
**This is not operational activation, shared-database acceptance, or certification
that real refunds, transfers or messages work.**

Both `0181_current_subscription_lifecycle.sql` and
`0182_current_bulk_withdrawals_field_sms.sql` remain unapplied to shared
Development/Production. Necessary catalog/procedural readiness gates remain
closed when objects are absent. No shared runtime was restarted or preview
activated; no provider, bank, identity, storage, message, configuration, secret,
worker, deployment or publication operation was performed.

Preserved commercial rules: ₦3,200 current student subscription, ₦2,000 staff,
₦150 per eligible student/term BRO earning (ten students = ₦1,500), a separately
funded commission expense, historical ₦5,000/₦100 evidence, the free launch
period, actual school calendars, January 2027 gates and existing release/rule
controls. School-owned fees and ordinary school revenue settlement are unchanged.

## Connected paths

### Direct refunds and BRO lifecycle

- `current-provider-adapters.ts` provides lazy real transport implementations.
  Construction performs no provider request or bank read.
- Refund dispatch uses the existing LIVE direct release/configuration gate,
  independently verified source transaction and permanent pre-POST claim.
  The supported provider minimum is ₦100. The returned provider refund ID is
  retained for independent GET reconciliation; an app reference is not assumed
  to be a provider lookup capability.
- A lost response with no retained provider ID remains permanently held for
  manual reconciliation. It is never automatically POSTed again. Plain provider
  `completed` is not treated as bank completion.
- BRO payouts freeze the existing verified registered-person bank evidence.
  The adapter performs **no transfer POST**: it verifies an already existing
  LIVE transfer against the exact frozen reference, amount, currency and bank.
  Only independently verified success produces paid status. Reversals retain
  history rather than granting automatic retry permission.
- Authenticated current-finance routes expose explicit action commands,
  current accounting and scoped receipts. Server-owned amounts, fresh financial
  authority, request identity, cumulative limits, adverse holds and immutable
  history remain enforced. Extra client settlement fields are rejected.

### Withdrawals and financial visibility

- A BRO selects only their own eligible accrued entitlements. The server freezes
  individual membership and the ₦150 amount, and prevents duplicate/concurrent
  claims. Requests are not approvals or bank credit.
- Owner approves/rejects individual request lines. An approval writes the
  existing entitlement approval event: there is no redundant second approval.
  Existing term-end review/source eligibility remains in force. Approval also
  rechecks the requesting BRO's active identity/membership and ownership.
- Failure/reversal/uncertainty and recovery-review records remain visible.
  Proven failed payouts retain the withdrawal decision but still require current
  payout eligibility; legacy standalone decisions retain their original rules.
- Owner initiation remains available after definitively failed historical
  attempts only when the server restores availability. A replacement uses a
  new request-key generation, including when the earlier response was lost.
  Pending, unknown, paid, reversed and held attempts still block replacement;
  historical attempts remain visible. Rejected withdrawal lines are explicitly
  described as held for review, not released back for another request.
- Owner and own-BRO projections share earned/pending/approved/available/paid
  calculations. BRO responses exclude other BROs, school collection amounts and
  school-wide catalogs. The privacy exception is limited to the exact trusted
  own-finance projection, not a general BRO financial-access expansion.
- The original accrual view is labelled as immutable original evidence, not
  current withdrawal or payout status.

### Genuine aggregate subscriptions

- Authorized school Admin/Accountant users select eligible unpaid students from
  one school/academic term. Owner explicitly selects a school; school membership,
  active/admitted students, actual rollout/rules and reviewed eligibility are
  validated server-side and revalidated before dispatch.
- One batch produces one aggregate checkout and one independently verified
  aggregate provider transaction. Direct attempts are not fabricated, terminal
  direct evidence is not rewritten, and children never receive synthetic or
  duplicated provider transaction IDs.
- Shared individual/bulk serialization and durable reservations reject
  overlapping obligations and concurrent initiation. Unknown checkout outcomes
  retain their claim and never trigger another checkout.
- Aggregate success is retained before child posting. Each allocation posts once;
  a child failure leaves the aggregate confirmed and recovery open. Recovery
  retries only unresolved children, never charging again. A delayed failed
  provider read cannot rewind retained success.
- Posted children feed student subscription access/enforcement and NFC payment
  evidence, each with separate eligible BRO accrual. Existing paid-source and
  January/free-term policies remain authoritative.
- Individual and consolidated receipts show current refunded/net amounts.
  An unresolved batch cannot be presented as a completed receipt.
- Full/partial child refunds bind to the aggregate provider transaction and
  cumulative aggregate limit, while changing only the selected child's
  accounting and BRO hold. Other children remain unchanged.
- Anonymous callbacks may retain independently verified aggregate facts, but
  disclose no students and cannot anonymously post allocations. Authorized
  users complete recovery.

### Owner Field Operations SMS

- Mounted in Owner Field Operations: permission recording, selected/all eligible
  contacts, frozen message/recipient preview, explicit confirmation and history.
- Eligible contacts must be visited, not onboarded, valid and explicitly allowed.
  Existing schools are checked independently of lead status using linked school,
  school identity, phone/address evidence. Onboarding, changed phones, opt-outs
  and "Not Interested" suppression are rechecked when claiming each send.
- The narrow asynchronous campaign purpose does not enable new parent SMS
  categories or unpause existing transport/worker controls.
- Campaign/contact claims and normalized-phone deduplication prevent repeated
  accepted sends. Only proven retryable rejection may retry; PROCESSING/UNKNOWN
  outcomes are held. Accepted is not delivered; no physical delivery is claimed.
- Dispatch is bounded to 20 claimed contacts or a 20-second loop budget per
  confirmation, plus any in-flight provider request. Unclaimed contacts survive;
  the Owner reviews and confirms continuation from campaign history. Unknown and
  accepted contacts are not repeated.
- History records initiator, frozen message/contact, timestamp, provider reference
  and honest per-recipient state. UI campaign timestamps explicitly use WAT.

## Contracts, screens and schema source

Contracts are included through `lib/api-spec/current-finance.yaml` and
`openapi.yaml`; Orval configuration includes referenced schemas. React clients
and Zod contracts are generated.

Mounted frontend entry points:

- BRO commissions: own current ledger and withdrawal requests.
- Owner `/partners/finance`: individual withdrawal decisions and lifecycle review.
- Subscriptions: explicit school/term selection, genuine aggregate checkout,
  independent verification, unresolved allocation recovery and both receipt levels.
- Owner Field Operations: consent/eligibility, preview, confirmation and history.

Core source additions are grouped under:

- `artifacts/api-server/src/services/current-{provider-adapters,finance-access,finance-overview,bro-withdrawals,bulk-subscriptions,bulk-payment-evidence}.ts`
- `artifacts/api-server/src/services/bro-field-sms.ts`
- `artifacts/api-server/src/routes/{current-finance,bro-field-sms}.ts`
- `artifacts/edupulse/src/components/{current-finance-panel,current-finance-receipt,field-sms-campaigns}.tsx`
- `artifacts/edupulse/src/lib/current-finance.ts`
- `lib/db/drizzle/0182_current_bulk_withdrawals_field_sms.sql`
- `lib/db/src/candidates/current-finance.ts`

The ORM file is an **unregistered review candidate**, not a Publish-ready
replacement for legacy raw-SQL schemas. Legacy FK metadata is reference-only.
The SQL candidates remain authoritative for CHECKs/procedural guards. No
automatic schema export, migration runner, startup registration, grant or
procedural-delivery claim is introduced.

## Verification

The table in this section is the retained earlier connected-finance evidence.
The current Owner/notification follow-up and its distinct results are recorded
below; repeated executions are not additional passing tests.

All following checks used clean child environments, fictional fixtures and fake
HTTP/provider functions. No server/application bundle was executed.

| Evidence | Result |
|---|---|
| Earlier affected financial baseline | 61 distinct passing tests, across full and targeted runs; not added again below |
| Final affected backend pass | **86 passed across 7 files** |
| Additional bounded SMS continuation check | **1 passed** in a targeted final run |
| New disposable PostgreSQL integration suite | **23 distinct passed** across the full and targeted runs |
| Of those: real transport adapters with fake HTTP functions | **14 passed** |
| Of those: in-process command/authorization checks | **6 passed** |
| Of those: affected existing direct/access/NFC readers | **44 passed** |
| Earlier frontend helper's full focused component pass | 103 passed; historical run, not an extra distinct total |
| Final changed frontend component/page pass | **16 passed** across 2 files |
| Shared library TypeScript build, API and frontend typechecks | Passed |
| Complete API build to `/tmp/current-finance-api-build` | Passed; not executed |
| Frontend production build to `/tmp/current-finance-ui-build` | Passed; bundle-size advisory only |
| Whitespace/diff check | Passed |
| Authenticated browser, screenshots, shared-runtime acceptance | **Not performed / not authorized** |
| Real provider, bank credit, SMS receipt or LIVE acceptance | **Not performed / not claimed** |

The 23 new integration cases execute candidates over real existing migrations
in a disposable Unix-socket PostgreSQL cluster, including actual transactional
constraints, concurrency, duplicate claims and recovery. The fixture's clock is
explicitly aligned with fictional 2027 financial periods; no shared clock changed.
Initial fixture, literal-type and mock query-count issues were corrected.
The SMS fixture was missing the audit table's school column; retry fixtures also
needed the matching future JS clock. These were not real provider-send failures.
The final targeted continuation run excluded 22 previously passing cases by
selector; they were not failures. Do not add repeated executions to the totals.

Final backend command:

```sh
pnpm --filter @workspace/api-server exec vitest run \
  src/services/current-finance-integration.postgres.test.ts \
  src/services/current-provider-adapters.test.ts \
  src/routes/current-finance.inprocess.test.ts \
  src/services/direct-student-live-payments.test.ts \
  src/services/student-platform-rollout-access.test.ts \
  src/services/student-platform-access.test.ts \
  src/services/student-nfc-payment-evidence.test.ts
```

Final frontend command:

```sh
pnpm --filter @workspace/edupulse exec vitest run \
  src/components/current-finance-panel.test.tsx \
  src/pages/partner/own-commissions.test.tsx
```

## Owner workflows and notification continuity — 2026-11-23

### Confirmed finance defects closed

The earlier findings are retained here explicitly: **PENDING refund
reconciliation disappeared**, and **All Schools allowed a schoolless term query
whose error hid the scope selectors**. Both are now corrected in
`artifacts/edupulse/src/components/current-finance-panel.tsx` and covered by
interactive component regressions. PROCESSING → PENDING → SUCCEEDED uses only
`REFUND_RECONCILE`, never refund redispatch. School-first term selection,
atomic school/term reset, error/unavailable recovery and the query helper's
schoolless-term guard preserve unknown balances as unknown.

`current-finance-overview.ts` now reports submitted requests separately from
pending Owner decisions. Requested totals include submitted lines at later
stages; these are overlapping lifecycle figures, not amounts to add together.
Failed/reversed totals count the latest payout attempt per entitlement, not
every historical retry. Scoped requests contain only in-scope entitlement lines;
the visible total is the sum of those lines, without rewriting the frozen
request. Actual paid totals still require independently verified payout success.
The isolated withdrawal test checks the new totals before request, pending
decision, approval and prepared-but-unpaid payout.

### Durable notification continuity

- `auth-query-provider.tsx` now remounts account-local state only when the
  signed-in identity changes. Replacing only the query cache previously left
  child-local paginated inbox rows mounted across account switches.
  Same-identity refreshes retain state; device/token refreshes are not treated
  as account changes. No persistent inbox, unread or delivery history is deleted.
- `communication-service.ts` keeps selected, authorized Telegram work queued
  while a personal link is missing or service health becomes unavailable.
  These no-send holds do not consume provider attempts and recheck after five
  minutes. Teacher notices no longer disappear at queue creation merely because
  the teacher's verified connection is temporarily missing.
- `telegram-delivery-continuity.ts` distinguishes missing linkage from revoked
  consent, inactive family/teacher relationships and explicit preference
  denial. Dispatch rechecks school selection, Owner controls, launch cutoff,
  current recipient authorization, campaign expiry and current timetable
  applicability before transport. No new arbitrary expiry policy was invented:
  campaigns use their saved expiry, teacher reminders use timetable validity,
  and other notices retain the existing policy.
- Only the old **FAILED / TELEGRAM_UNAVAILABLE** no-provider-attempt branch may
  recover beyond its formerly exhausted attempt count. **CANCELLED** records
  (including legacy conflated link/consent cancellations), delivered/accepted
  work and **PROVIDER_OUTCOME_UNKNOWN** are not revived.
- `telegram-delivery-withdrawal.ts` atomically cancels queued/proven-failed work
  when Telegram consent or an effective preference is withdrawn. Claimed work
  becomes an unknown-outcome hold rather than a false unsent cancellation.
  Existing unknown outcomes and sent/in-app records remain intact. Global
  preference withdrawal respects explicit school-level overrides.
- `telegram-links.ts`, `teacher-telegram.ts` and the preferences route reuse
  that withdrawal behavior. Existing fresh personal challenge, signed-in
  confirmation, encryption and parent/teacher eligibility remain authoritative;
  no Admin invitation or arbitrary chat ID binds an account.
- Inbox channel labels and next actions distinguish waiting, accepted versus
  delivered, expired, cancelled, retry-limited and uncertain work. Telegram
  failures do not suppress an independently selected IN_APP record. Created and
  scheduled-check display use explicit Africa/Lagos WAT; stored UTC timestamps
  and original notification creation times are unchanged.
- Existing provider retry-after, bounded worker claims, SKIP LOCKED claims,
  per-channel uniqueness and unknown-acceptance protections are reused, not
  replaced. A running provider operation cannot be recalled by withdrawal;
  processing-time uncertainty is held for reconciliation, never replayed.

### Owner workflow, readiness and SMS presentation

- BRO navigation keeps five primary destinations and two evidence/detail
  destinations, retaining all seven original routes and role/build gates.
  The Owner sidebar groups the same authorized links without dropping advanced
  functions. Home shortcuts include withdrawal decisions and payment rules.
- Payout labels now say **Prepare payout** and explain external completion,
  recording and independent reconciliation. Preparation is not transfer proof.
- `owner-guided-steps.tsx` maps the eight actual readiness codes explicitly.
  TEST/LIVE, current blockers, review versus activation and retired N/A
  split/hosted workflows are distinct. Independent webhook and bank/settlement
  evidence not separately reported by the endpoint is explicitly **unverified**,
  not inferred from HTTPS configuration or school/term reconciliation.
- Rules expose drafting, evidence, preview, approval and activation stages
  without changing rule authority. NGN 3,200 student, NGN 2,000 staff and the
  separately funded NGN 150 BRO entitlement, free current term, saved January
  2027 second-term calendar gates and immutable NGN 5,000/100 history remain
  unchanged.
- `field-sms-diagnostics.ts` and `field-sms-campaigns.tsx` distinguish route,
  session/permission, unapplied lifecycle/extension schema, missing financial
  guards, runtime/Owner holds and provider configuration. `bro-field-sms.ts`
  separates Owner pause, authorization and activation-review holds using existing
  saved controls only. Diagnostics disclose no private provider payload and
  perform no provider request, configuration change or activation.
  Existing permission, frozen preview, explicit confirmation, eligibility,
  history, deduplication and proven-failure retry remain in place.

### Current focused evidence

All checks below used clean child environments, local disposable PostgreSQL or
fictional component fixtures and fake provider functions. API test network
guards prohibit external traffic. No shared workflow or application bundle was
started or restarted.

| Current evidence | Distinct result |
|---|---|
| `services/communication-service.test.ts` | 70 passed across full + one targeted correction; one stale fixture had to satisfy SMS scope/consent before testing Owner policy |
| `services/telegram.postgres.test.ts` | 59 passed across full + targeted continuation; parallel fixture insertion required matching rows by notification identity, not insertion order |
| `services/current-finance-integration.postgres.test.ts` | 23 passed, including real PostgreSQL withdrawals, bulk checkout/allocation/receipts/refunds, SMS continuation and new summary assertions |
| `routes/communication-inbox.test.ts` | 21 passed |
| Backend distinct union | **173 checks across 4 files**, using the stated full/targeted evidence; not one combined all-green execution |
| `components/current-finance-panel.test.tsx` | 23 passed, including interactive refunds/scope and rendered SMS diagnostics |
| `components/tenant-provider.test.tsx` | 3 passed, including child-local state isolation across identities |
| `components/owner-workflow.test.tsx` | 8 passed, preserving routes, permissions and truthful readiness grouping |
| `lib/notification-continuity.test.ts` | 17 passed |
| Frontend distinct focused union | **51 checks across 4 files**; broader helper checks are retained but not added again |
| API/frontend TypeScript checks | Passed |
| Disposable API/frontend production builds | Passed, under ignored `generated-artifacts/owner-continuity/`; never executed |
| Build advisory | Frontend remains a roughly 2.8 MB minified entry chunk; not a build failure |
| Diff/whitespace check | Passed |

The original financial baseline and earlier UI/backend evidence above remain
historical, not extra new passes. The broader frontend helper pass included
overlapping files and is not added to the distinct totals. Test selectors'
skipped cases are not counted as newly executed.

### Explicitly unverified and inactive

The five current screenshot files were not positively located, so no
screenshot-based comparison or visual acceptance is claimed. No authenticated
browser or shared-preview pass was performed: the approved boundary did not
authorize shared runtime/data operations, and no separately approved isolated
authenticated browser fixture was established. Source/DOM checks are not proof
of mobile fit, real sign-in/device transitions, bank credit, receipt printing or
physical Telegram/SMS delivery.

No migration was added in this follow-up. Candidates **0181 and 0182 remain
unapplied to shared Development/Production**, and the supported procedural
schema delivery blocker remains. All new behavior is source-connected and
disposable-fixture verified, **not activated or operationally accepted**.
Previously queued worker-restart, signed-in Owner layout, withdrawal/bulk and
Field SMS acceptance work remains separate; none was marked complete here.

## Remaining blockers and unverified boundaries

1. **Collection reversal and incoming BRO recovery:** no independently bound
   provider/bank evidence contract is available. These capabilities remain absent
   from real adapters, with explicit errors. Typed evidence from an HTTP request
   is not substituted. No automatic debit or invented recovery assessment.
2. **Shared schema/procedural delivery:** candidates are not applied, and no
   supported shared delivery mechanism for required custom functions/triggers
   has been established. Readiness gates remain. ORM metadata alone does not
   certify schema parity, migration safety, Publish transport or all-writer ACLs.
3. **Provider-bound acceptance:** refund ID retention, completed-bank status and
   exact-reference transfer lookup have fake-contract evidence only. A refund
   accepted without a retained ID needs manual provider reconciliation; the app
   cannot safely search or resend it. Manual payouts made outside the supported
   provider reference contract cannot be called paid through invented proof.
4. **UI/runtime acceptance:** mounted components, generated contracts and builds
   pass source checks, but authenticated cross-role journeys, print layout and
   mobile behavior have not been exercised against an authorized running fixture.
5. **Policy deliberately not invented:** partially refunded subscription access
   restoration, release of failed/abandoned aggregate reservations, and incoming
   recovery assessment require reviewed policy; holds are conservative.
6. **Original numbered contract:** the earlier 65-point document is unavailable.
   This report maps the explicit consolidated task only and does not certify
   an invented numbered acceptance percentage.

Source integration is ready for review within the approved inactive boundary.
This report does not request or imply shared migrations, runtime activation,
message sending, financial operation, preview activation, publication or deployment.

## Owner free academic-term grants — subsequent Development source feature

The separately requested Owner free-term feature is implemented in source.
Its exact changed-file list, calendar/authorization/duplicate-grant safeguards,
preservation evidence and remaining operational gates are recorded in
`docs/owner-free-academic-terms-completion-report.md`.

Evidence: 150 distinct backend checks across a full run and affected
continuation; 40 distinct frontend checks across full/targeted runs; passing
library/API/frontend types and disposable API/web builds. These counts are
separate from the earlier consolidated update's evidence above.

Candidate `0183_owner_free_academic_terms.sql` was tested only in disposable
PostgreSQL and remains unapplied to shared Development/Production. No shared
restart, real grant/suspension, worker/payment/SMS activation, provider-setting
change, publication or deployment occurred. The new Owner journey still needs
separately authorized authenticated runtime acceptance after approved schema
and service delivery.
