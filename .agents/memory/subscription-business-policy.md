---
name: Subscription allocation and disclosure policy
description: User-approved future student allocation, history protection and Owner-only full-split disclosure.
---

## Approved bulk subscription product boundaries

Bulk subscriptions use one school and one academic term per batch, one actual
aggregate provider payment and immutable student-level allocations. Initiators
are School Admin and Accountant within their own school, or Platform Owner
within an explicitly selected and authorized school scope. This is an explicit
financial exception, not general Owner authority over ordinary school operations.

Include eligible unpaid ₦3,200 student obligations only. Exclude free, fully
paid, inactive/ineligible, unresolved pending/partially paid and legacy-priced
obligations from ordinary bulk checkout. Freeze selection, source obligations,
amounts and reviewed rule versions before charging. Never substitute repeated
individual checkouts or invented provider transaction identifiers.

Allocation failure keeps the batch in recovery until every student allocation
is reconciled. Retry only unresolved allocations; never automatically charge
again after an uncertain provider outcome. Require individual receipts/ledger
evidence and a consolidated receipt. Student-specific batch refunds must leave
unaffected students unchanged.

Eligible ₦150 BRO liabilities remain independently funded and require individual
Platform Owner approval before release. School pricing and school collections
remain independent: no school subaccount splits or automatic revenue sharing.

**Why:** The user explicitly approved the consolidated Development source build,
superseding the earlier review-only proposal, and supplied these batch decisions.

**How to apply:** Preserve launch/calendar/release gates and historical
₦5,000/₦100 records. Source approval is not migration, runtime or LIVE activation
approval. Never fabricate unresolved recovery amounts or provider capabilities;
retain an auditable hold/recovery review when the applicable policy is missing.

## Current school-date NFC timing

The 2026-11-27 instruction supersedes the former January 2027 second-term
anchor and blanket current-term free pilot for NFC timing. Every saved school
term, of any number/session, has the same platform-wide NFC grace: D through
D+6 inclusive; NFC checkout and required enforcement start at D+7. Use the
school's saved WAT dates, not a national date. Calendar rollover never waits
for grace or payment. Ordinary school invoices have no NFC grace and keep
their own original due dates.

“Automatic term subscription activation after grace” means refreshing the
existing enforcement/checkout-required state at D+7 inside the saved term's
boundaries. It never means initiating checkout, charging Flutterwave or creating
another obligation. Verified students remain entitled; an explicit free-term
grant suppresses charges/enforcement for that exact term only. Calendar opening
remains independent. Non-payment restoration must not be described as verified
payment.

Student platform price remains ₦3,200. An eligible ₦150 BRO liability is a
separate independently verified, exactly-once expense, not a collection split.
Preserve historical prices, amounts, payment evidence, commission eligibility,
explicit free-term grants and independent manual/security/card controls.
Parents/students/teachers must not see internal student platform/remittance or
BRO amounts. Families see only their own school's published charges, even
where the school chose the same numeric price. Paying the school or uploading
a receipt is never platform entitlement.

**Why:** The user explicitly replaced the fixed launch anchor with school-date
NFC-only grace, and separated ordinary school debt and parent-facing fees.

**How to apply:** Separate business effective date, school calendar collection
start, financial activation/release and actual payment verification. Preserve
historical ₦5,000 obligations, payments, commissions and school-configured fees.
Keep manual school locks, security and genuine NFC-use safeguards independent.
Do not change Production/secrets, call payment APIs, charge, publish or bypass
merchant/release gates. Teacher/Staff pricing remains a separate policy.

## School-collected student workflow, subject to launch timing above

For BRO rates, the later [prospective BRO policy](bro-commission-policy.md)
supersedes earlier ₦100 prospective language here, but never historical earnings.

The user now requires a fixed NGN 3,200 student platform subscription per term,
separate from the school's configurable parent-facing “NFC Card & EduCore
Subscription Fee.” Parents pay the school in full, without NFC instalments.
Only after confirmed full parent payment may the school initiate its separate
platform payment. No student checkout split or school subaccount is used for
this requested workflow. These requirements supersede the earlier prospective
NGN 5,000 split/manual-settlement policy below, not historical transactions.

**Why:** The user explicitly requested school-first collection and a separate
fixed platform obligation while preserving existing records and working flows.

**How to apply:** Preserve historical references, amounts and versioned policies.
Do not infer permission to reprice an already initiated checkout. Reuse existing
fee receipts, private evidence, reversals and role controls. School assistance
requires independent Owner verification of actual bank receipt before checkout;
keep that verification after a failed provider attempt. In chargeable terms, only
verified Flutterwave success for the student/term plus existing security checks
grants card eligibility; the school-date grace and explicit free-term grants
remain non-payment entitlements.
BRO entitlement remains separately idempotent and subject to existing eligibility;
staff/teacher payments remain separate. Implementation authorizes neither
Production data/secrets changes, live transactions nor publishing.

### Unpaid transition requires reconciliation and separate approval

Existing unpaid student obligations may transition to the NGN 3,200 per-term
platform policy only after reconciling the student's payment history, outstanding
balance, academic term and existing subscription records. Preserve completed
payments, paid history, receipts, original references and audit trails. Do not
automatically convert ambiguous, duplicate, disputed or unreconciled balances;
leave them unchanged and flag them for Owner review.

**Why:** The user explicitly selected migration of unpaid obligations after
reconciliation rather than limiting the policy to newly issued obligations.
They require a preview/reconciliation report before any apply, and explicit review
and approval before Production data changes.

**How to apply:** Build and review the read-only report first. Candidate status or
an exported digest is not approval, provider verification or permission to write.
Any later apply must independently verify the database target and revalidate
fresh evidence under concurrency controls. Keep school-facing fees separate,
prevent repeat student/term charges and retain the verified-payment plus existing
card-security gates.

Scope clarification: the Owner confirms the published school application works;
the reported real-school onboarding obstacle is Flutterwave LIVE payment
activation, not a general school-product failure.

**Why:** The Owner explicitly separated working published school functionality
from payment readiness and requested the shortest safe LIVE path.

**How to apply:** Keep payment-gate assessments separate from unrelated product
or UX work. This statement is Owner evidence about school functionality, not
proof of LIVE charging, financial finalization or settlement.

The user clarified on 2026-10-24 that there are currently no real schools.
LIVE checkout must fail closed until the selected school has a genuine verified
LIVE subaccount/ownership binding and all LIVE release/webhook checks pass.
Fictional/disposable schools are not real merchants or approved LIVE recipients.
Never invent or use `RS_SCHOOL_LIVE_SUBACCOUNT_ID`, redirect a missing school's
allocation to Yetenia, or fall back to TEST to make a LIVE request succeed.
Code and focused tests are authorized; Production settings/secrets, shared
databases, migration changes, deployment, publishing and real charges are not.

**Why:** The user explicitly said to keep the current split and not pretend
test schools are real school merchants. Implementation is not launch approval.

**How to apply:** Distinguish permission to implement from proof of operational
readiness. Preserve dedicated TEST webhook verification before binding a shared
verifier to LIVE, and do not bypass unreleased persistence/verification gates.
The prior migration-draft reviews are not evidence of applied target migrations.

The requested future student subscription gross is NGN 5,000 per student per
school term. School entitlement is NGN 1,900 through the school-only checkout
subaccount; NGN 3,100 belongs to Yetenia before actual provider fees/taxes.
The remaining merchant proceeds belong to Yetenia's main merchant account.
An eligible Partner's NGN 100 is an internal
accrued payable, NOT a checkout split recipient. Without an eligible Partner,
there is no Partner liability. Owner economic net is the merchant remainder less
the eligible Partner liability; do not confuse it with merchant cash settlement.
Settled history and existing payment references retain their original policies.

Only the Owner may see the full split. Other parties may receive their own
authorized information, not the other recipients' allocations.
Development TEST diagnostic pages and transaction evidence are not exemptions
from this disclosure rule.

**Why:** The user approved deferred Partner commissions and a single Owner bulk
approval at term end, superseding the earlier request for a second checkout
subaccount. They retained the historical-preservation and Owner-only disclosure
boundaries. Split support alone was explicitly not authorization to enable live.

**How to apply:** Keep Partner entitlement, checkout recipients and actual
provider settlement separate. Approve only verified successful non-refunded
student/Partner/term liabilities after the relevant school term ends. Approval
and audited export are not a transfer or Paid evidence; uncertain external sends
must not be retried as a new payout. Refund/dispute exceptions invalidate
unexecuted batches and retain audit/recovery history. Keep live checkout disabled
until exact split semantics, verification, refunds, reconciliation and a controlled
readiness review are proven. Development implementation does not authorize
Production migration, publishing, live keys or live transactions.

## LIVE preparation authorization

## Prospective hosted collection and manual settlement

**Historical only — superseded on 28 October 2026.** The definitive current
business rules are recorded in `replit.md` and
`docs/january-2027-no-split-payment-policy.md`. Do not reimplement the former
₦5,000 hosted/manual distribution below.

**Why:** The Owner explicitly repeated the no-split rules as definitive.

**How to apply:** Retire issuance/configuration/release paths at UI, HTTP and
service/provider boundaries while preserving historical schemas, records and
authorized existing-reference reconciliation. Never use legacy flags as a
fallback when direct LIVE is blocked.

On 2026-10-27 the user explicitly confirmed: “Yes, use the manual ledger.”
New hosted payments may collect the entire NGN 5,000 into Yetenia's merchant
account rather than automatically splitting to a school subaccount. Record NGN
1,900 school liability and NGN 100 eligible BRO liability, leaving NGN 3,000
platform revenue before provider fees (NGN 3,100 without an eligible BRO).
BRO liability is not a second deduction from the NGN 3,000 allocation.

**Why:** The user chose this cash-flow change after being told native Nigerian
merchant/payout eligibility was not established and that manual school settlement
differs from the prior automatic school split.

**How to apply:** Prospective, versioned payments only. Preserve historical
policies, attribution and receipts. Payment verification is not payout evidence;
manual confirmations do not move funds. Preserve term-end Owner approval for BRO
payments. This authorizes implementation, not live calls, Production financial
writes, destructive SQL, publishing, restarts or credential/configuration changes.

## Earlier integrated LIVE preparation authorization

The current TEST payment repair must remain integrated in EduCore: reuse its
database, authentication, subscription, finance and Flutterwave components.
Do not introduce or require a separate payment service for this repair.

**Why:** The user explicitly chose repairing the existing in-app integration
instead of the previously discussed external-payment-service architecture.

**How to apply:** Keep TEST recovery tied to the existing persisted payment and
versioned allocation policy. Architectural extraction requires a new explicit
request; neither this repair nor mocked provider tests authorize LIVE activation.

As of 2026-10-27, the user explicitly authorizes repairing the existing integrated
LIVE configuration and enabling LIVE when its security prerequisites are valid.
This supersedes the earlier blanket prohibition on LIVE configuration enablement;
it does not authorize provider calls, charges, shared/Production database access,
schema or migration changes, deletion, or automatic publishing.

**Why:** The user explicitly requested a simple TEST/LIVE mode configuration
without weakening payment security, while retaining these operational limits.

**How to apply:** Authorization is not readiness evidence. Missing LIVE secrets,
dashboard registration or school-specific LIVE approvals must remain fail-closed;
TEST approvals do not substitute. Do not inspect actual secret values. A restart
requires verified startup safety and must not be inferred from a successful build.
Keep fixture capabilities separate from operational release gates and preserve
all historical payment policies and environment boundaries.
