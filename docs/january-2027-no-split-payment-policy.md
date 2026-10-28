# Definitive payment policy — Replit, January 2027

Approved direction: 28 October 2026. This supersedes old Student split,
subaccount, SCV3 release, hosted/manual ₦5,000 distribution and school-subaccount
settlement procedures. They are historical references, never current instructions.

## Current rules

- Parents pay school fees **directly to the school**. This does not prove that
  the school paid its separate platform subscription.
- The **School Admin dashboard** initiates the distinct Flutterwave platform
  payment: **exactly ₦3,200 NGN per student per academic term**.
- All gross collection proceeds belong to the Platform Owner's merchant account.
  Provider fees remain separately recorded expenses; “all gross” is not a claim
  that Flutterwave charges no fees.
- Checkout must contain **no subaccounts, split instructions, ratios,
  `transaction_charge` or `transaction_charge_type`**.
- A valid, historically eligible BRO association may earn **₦150**, recorded in
  the independent internal entitlement ledger under an approved effective-dated
  BRO policy and verified eligible payment.
- **No eligible BRO means no BRO record, liability or zero-value ledger row.**
  Ambiguous, inactive, missing or out-of-scope attribution is not eligibility.
- BRO entitlement is not a collection deduction, provider split, school
  settlement or automatic transfer. Existing Owner-governed accrual/approval
  remains required; this change does not silently auto-book an entitlement from
  an untrusted webhook. No automatic payout is introduced.
- Current-term free access, each school's actual January 2027 second-term start,
  school-owned calendars, term eligibility and existing grace/manual-lock
  protections remain unchanged. January 1 is not a substitute for saved dates.

## Retired operational entry points

The shared retirement middleware denies old checkout, hosted collection,
recipient/subaccount onboarding, split simulation, school split configuration
and legacy release-approval operations with uncached HTTP 410.
Retirement covers encoded, noncanonical numeric parameter forms as well as
ordinary IDs, so numeric coercion cannot bypass it.

Specifically, the old `/flutterwave/live/release-check`,
`/flutterwave/live/billing-context`,
`/platform/live-readiness/evidence-preview` and receipt review mutations are
not release or configuration alternatives. Old flags and approvals cannot
restore issuance.

Defense in depth also blocks the old LIVE initialization service, school split
authority configuration service, split preparation helper, LIVE transport
checkout method and operational sandbox split probe **before DB/provider calls**.
The generic Flutterwave adapter rejects old SCV2/SCV3 initialization and every
split field, including an explicitly empty field; it no longer serializes split
instructions. Independent non-split fee/staff operations are not blanket-disabled.

The separate direct LIVE transport remains constrained to the exact ₦3,200
request whitelist. Independent transaction GET rejects split/subaccount/charge/
ratio metadata instead of treating it as evidence of a direct collection.

## Historical retention and reconciliation

No schema or historical school, student, subscription, payment, attribution,
receipt, commission, provider event or audit record was deleted or repriced.
Historical allocation helpers/types/contracts are retained for interpretation,
not issuance.

Authenticated transaction-evidence reads, old readiness receipt lists/official
receipts and separately authorized existing-reference callback/webhook
reconciliation remain governed by their original authorization, verification and
immutability checks. New recipient creation, refund/transfer initiation and
release approval are not “read-only history.” This change does not open them.
Old unsent liabilities are not automatically paid or converted.

Legacy setup/release guides are marked retired. API compatibility descriptions
explicitly identify retired split operations; generated compatibility functions
are not proof that their HTTP endpoints remain operational.

## Retained security gates

Preserve independent server verification, V3 authenticated `verif-hash`,
transaction/reference/status/currency/exact amount matching, permanent checkout
reservation, uncertain-request reconciliation, row-locked idempotency,
immutable event history, tenant/term/rule bindings and fresh Owner approvals.
Nothing here grants LIVE release or substitutes for Production enforcement.

## January LIVE on Replit

The product remains hosted on Replit. There is no external-hosting action in
this plan, no new service and no unsupported Production SQL workaround.

LIVE remains blocked until:

1. A supported Replit delivery/lifecycle mechanism for the exact required four
   guard functions/nine triggers is established and verified on the serving
   primary, with runtime permissions and accepted recovery evidence.
2. The actual LIVE merchant and dedicated configuration, non-split evidence,
   exact callback/webhook dashboard registration, authenticated delivery and
   safe replay are independently proven. Previously reported Owner approvals
   are acknowledged, not declared absent.
3. The exact school/term/rule/version, fresh reconciliation, unexpired release
   review and explicit operational authorization qualify. An October review
   cannot authorize January; reviews expire within at most seven days.
4. Missed/pending notification recovery, whole-webhook processing under database
   contention and genuine authorized Owner acceptance are established.

App-side hardening cannot substitute for an unavailable supported database
enforcement mechanism. If this stays unresolved, direct LIVE remains a no-go.
Do not weaken readiness checks, change pricing/free periods or claim activation.

No Production query/migration, shared financial write, secret change, real
payment, notification, publishing, Production redeployment or LIVE enablement
is authorized or performed by this implementation.

Focused verification outcomes are recorded in
`january-2027-no-split-implementation-results.md`.
