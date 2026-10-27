# Platform Owner subscription and payment rules

The new **Subscription & Payment Rules** entry is restricted to an active,
global Platform Owner in both the dashboard and API. It extends the existing
staff NFC billing and BRO commission ledgers. It is not a second checkout,
payment settlement, bank verification provider, or commission payout engine.

## What an Owner can do

- Save and edit effective-dated drafts with an academic-term scope, positive
  NGN amount, zero school share, optional end date and reason. Edits are
  version-checked. Students default to an **intended** ₦3,200; Teacher/Staff
  drafts default to ₦2,000 and the server refuses a different staff amount
  until its policy has been separately reviewed.
- Preview a draft on the server, then explicitly confirm its fresh digest
  before activation. Only supported ₦2,000, zero-school-share,
  zero-BRO-share staff rules can become scheduled native staff billing rule
  versions. The existing staff checkout eligibility and immutable
  subscription snapshots remain in control.
- Review active, scheduled, retired and legacy native staff versions alongside
  the existing BRO commission rules. Retiring the latest supported staff rule
  stops new generation; older versions must not automatically become active.
- View an Owner-only audit with actor, timestamp, reason, before/after values,
  draft changes, activation and retirement. No delete or history rewrite
  endpoint is added. All mutations and their audit entry share a transaction.
- Record an assistance request against a real student, school and term. An
  Owner may separately attest a personally and independently checked,
  matching bank credit with bank name, statement reference, date and amount.
  A request/upload is never bank proof. This area does **not** initiate a
  Flutterwave payment because a verified ₦3,200 platform checkout and
  transition is not yet supported.

Student and BRO drafts can be recorded for review, but activation is
explicitly **blocked** until their separate subscription/entitlement policies
are reviewed and integrated. Existing parent-to-school NFC fees are configured
by schools and remain separate from school-to-Yetenia platform obligations.
Legacy BRO rules and payouts are not rewritten or reclassified. This work
neither activates ₦3,200 checkout nor resolves existing unpaid staff checkout
transition blockers. The page deliberately does not expose provider keys or
infer Flutterwave readiness from the presence of credentials.

## Development-only schema

The additive Development schema adds nullable `ends_at` to the native staff
rule table and two management tables for proposals and assistance requests.
No existing subscriptions, receipts, audit entries, invoices, allocation
snapshots or payment records were updated. The source migration is
`lib/db/drizzle/0175_owner_subscription_rule_management.sql`; it was
rehearsed on a credential-free disposable local PostgreSQL cluster and
applied only after comparing the application's connection to the independently
identified Development database. No Production SQL, data changes, secret
changes, provider transaction, deployment or publish occurred.

## Verification boundary

The native test runner `scripts/src/owner-subscription-rules-native-check.mjs`
starts a private Unix-socket-only disposable PostgreSQL process with no
inherited app credentials. It validates real additive DDL, role rejection,
draft/preview/activation concurrency, expiry/retirement, zero school share,
historical row preservation, audit events and matching bank attestations.
Staff checkout safeguards and page helper tests run separately.

This is not a live-provider acceptance test or permission to convert unpaid
student/staff records. Before any later Production rollout, review a real
reconciliation report, verify the target and explicitly approve each change
under the separate transition policy.
