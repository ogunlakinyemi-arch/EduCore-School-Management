# TEST split fee-order safety follow-up

## Evidence and scope

User reports Flutterwave support describes an existing 40% subaccount / 0%
merchant configuration and a fee deducted before splitting. No provider read,
dashboard change, credentials, application DB read/write, migration or Publish
action was performed. The effective external TEST configuration is unverified.

Local V3 checkout sends `subaccounts` with `transaction_charge_type:
flat_subaccount`, School 1900 and eligible Partner 100 for SCV2 references.
Recipient creation has flat merchant-commission defaults of 3000 for SCHOOL
and 4900 for PARTNER; those are not proof of existing dashboard configuration
or a valid simultaneous multi-recipient allocation. Recipient read-back checks
bank/identity ownership, not the effective fee bearer, split type or value.
The existing evidence adapter cannot independently confirm a complete recipient
allocation set. Therefore neither payload validation nor TEST_READY proves
School/Partner receive the intended exact post-fee amounts.

## Narrow correction

The real payment adapter now rejects new-policy SCV2 initialization before
provider transport, even with valid flat instructions or without instructions.
There is deliberately no environment override or guessed percentage.
Historical unversioned checkout validation and already-paid verification,
finalization and immutable history are unchanged.

This intentionally blocks new SCV2 TEST checkouts until a reviewed provider
contract and effective configuration can establish the exact payouts. Manual
dashboard changes alone do not remove the code gate. Do not pay again to
investigate an existing successful charge.

The pure post-fee expectation model deducts the total fee once from Owner gross:

| Partner | School | Partner | Owner gross | Fee | Owner net | Provider net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Eligible | 1900 | 100 | 3000 | 70 | 2930 | 4930 |
| None | 1900 | 0 | 3100 | 70 | 3030 | 4930 |

Amounts are NGN; the implementation uses integer minor units. Owner net must
stay positive. The model is a requirement, not observed recipient settlement.
No fee is deducted again from School, Partner or the provider-net remainder.
Actual variable fees must replace illustrative 70; no fixed 70 assumption is
used in checkout.

## Required manual/provider clarification

An authorized operator should review TEST-only subaccount settings with support
and obtain the exact documented V3 multi-subaccount request/configuration that
guarantees flat recipient amounts AFTER merchant-paid processing fees, with a
nonzero merchant remainder in both Partner cases. Clarify whether transaction
overrides supersede defaults, their fee ordering, and how exact recipient amounts
are independently evidenced. Do not simply change 40% to 38%, set a merchant
percentage, or assume multiple subaccount commissions combine as intended.
If the supported model cannot provide those guarantees, retain the gate.

Previously charged payment investigation remains separate and blocked by the
Development diagnostic prerequisites. No reconciliation, webhook replay,
transfer, settlement, retroactive allocation or payment retry was performed.

## Focused verification

Nine adapter/model tests passed: both Partner cases, no platform-only fallback,
repeated blocked attempts produce zero transport calls, positive merchant net,
single fee deduction, cross-version rejection and preserved legacy checkout.
API typecheck and diff whitespace checks passed. These are fictional injected
transport/unit evidence, not provider acceptance or actual bank delivery.
The existing 40-test subscription billing policy suite also passed (49 focused
tests total). No database/provider acceptance test was attempted.
