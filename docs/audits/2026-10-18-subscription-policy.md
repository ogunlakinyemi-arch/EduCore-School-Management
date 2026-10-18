# Subscription policy follow-up — 2026-10-18

## Delivered scope

New student NFC checkouts use NGN 5,000 gross: School NGN 1,900,
Owner NGN 3,000 and eligible Partner NGN 100. Without an eligible Partner,
Owner receives NGN 3,100. Actual provider fees remain separate platform
expenses; they do not reduce the School or Partner credits.

New server-generated payment references select the new policy. Existing
references, frozen instructions, paid allocations and saved receipts are not
rewritten. Checkout, commission-rule matching, guest-link forecasts,
provider instructions, settlement expectations, receipt snapshots and
cumulative refund calculations use the matching version. Missing eligible
Partner rules reject new reservations before provider initialization. Owner
commission-rule creation defaults to the new School amount without editing
existing rules. Independently configurable employee billing rules are unchanged.

Subscription JSON filtering now covers staff subscriptions, payment responses,
finance summaries and receipts, in addition to the existing student surfaces.
Only the Owner receives the full breakdown. School finance users retain their
authorized School amounts; other users do not receive other recipients' shares.
JSON dates survive filtering. API contracts and generated clients were updated.
Public guest-link responses no longer expose the internally stored allocation
forecast; the immutable stored instructions themselves are retained.
This is not a claim that every unrelated report or notification was audited.

## Database and rollout boundary

`lib/db/drizzle/0167_student_allocation_v2.sql` upgrades the split-payment and
settlement CHECKs while retaining legacy amounts for legacy references. It was
executed only in a disposable local PostgreSQL cluster. It has **not** been
applied to either application database.

New-policy provider-split checkout fails closed with an explicit upgrade error
when the old database CHECK remains installed. The existing default-off split
setting is unchanged. A verified Development target, reviewed migration apply
and suitable effective-dated Partner rule remain prerequisites for enabling the
new split path. Publishing and Production migration are not authorized by this
work.

## Verification

- OpenAPI generation and shared-library build passed.
- API and frontend TypeScript checks passed.
- Allocation, provider-fee, legacy calculation, versioned frozen instruction,
  replay, schema-upgrade gate, disclosure and cumulative refund tests passed.
- Real PostgreSQL executed the migration and tested legacy/new accepted amounts,
  rejected repricing and incorrect amounts, and settlement CHECKs.
- Routed PostgreSQL acceptance passed for both Partner/no-Partner credits,
  concurrent/repeated finalization, Owner versus family/teacher disclosure,
  guest checkout and family integration, tenant isolation and history retention.
  Provider operations were mocked; no real provider request was made.
- The actual first-term PATCH route passed against PostgreSQL with no staff
  billing rule, preserving its saved dates.
- The separate correction-workspace case was not rerun.
- API/frontend managed workflows restarted successfully and public sign-in
  rendered. This is not an authenticated browser acceptance run.

Refund arithmetic/replay and frozen-plan tests do **not** establish real bank
settlement or a complete routed provider refund/recovery acceptance. Those
remain release gates, along with authorized recipients and the unapplied
application-database migration. No Live collection capability was added.

## Not performed

No application-database migration, historical financial rewrite, Production
repair, secret/payroll change, publish, Git push, real payment, transfer, refund,
message delivery or hardware action was performed. Development background
workers remained paused. Existing NFC Hardware Test failure and separately
observed Production communication-worker errors are not resolved by this pass.

Person titles, wider protected CRUD/deactivation, complete promotion acceptance,
timetable import, guardian-photo completion and additional exports remain open.
The original audit's remaining-scope list still applies to those areas.
