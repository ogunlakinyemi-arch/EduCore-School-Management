---
name: Subscription allocation and disclosure policy
description: User-approved future student allocation, history protection and Owner-only full-split disclosure.
---

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
