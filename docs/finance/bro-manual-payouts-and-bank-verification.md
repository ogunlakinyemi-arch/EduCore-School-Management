# BRO manual payout and bank-verification boundary

## Owner payout workflow

The BRO Payouts page selects an active BRO by name, code or email rather than
accepting an arbitrary BRO ID and amount. Owner selection and the BRO dashboard
use the same authoritative ledger totals:

- accrued: retained commission earnings excluding cancelled/reversed entries,
  plus independent earned NGN 150 entitlements where that storage exists;
- paid: commission ledger entries with PAID status;
- outstanding: accrued minus paid, not a promise that the entire amount is payable;
- available for payout: positive NGN PAYABLE commission entries without an
  existing payout reservation or deferred-payment binding;
- reserved: outstanding entries already linked to a payout;
- pending approval/held: entries not yet payable, including independent NGN 150
  entitlements still pending their existing Owner approval boundary.

Independent entitlement history remains append-only and is not copied into
legacy payable rows. Existing deferred-batch exports remain non-executable and
cannot be manually marked Paid through this workflow. No rate, earning, approval,
refund, policy activation or financial-history rewrite is implied.

Creation requires a successfully saved verified bank, an active BRO, NGN and
exact equality with the complete available payable balance. It reserves all
selected entries in one transaction, under BRO and ledger locks, with existing
durable idempotency-key recovery. A changed balance returns 409; refresh instead
of changing the amount. No transfer provider API is imported or called here.

A new payout audit stores an encrypted, immutable bank snapshot and commission
identifiers. Lists show only masked details. The Owner explicitly reveals full
details in a private, no-store, audited request for an external manual transfer.
Subsequent BRO bank edits do not change the destination frozen on that payout.
Older records without provenance are retained but never invented into verified
bank instructions.

The Owner must independently complete the external transfer, supply a reference
and confirm completion before recording Paid. Payout existence/status, reserved
entry status, partner, currency and exact amount are rechecked under transaction
locks. Recording Paid atomically reconciles ledger entries and records Owner
identity and payment time. Duplicate/concurrent attempts do not pay or audit
twice. References remain uniquely reserved, including after reversal.

## BRO bank lookup

Select a current supported Nigerian bank and enter ten digits. After a 500 ms
debounce the server checks the bank mapping and resolves through Flutterwave v3
`POST /accounts/resolve`, with the dedicated LIVE credential. The existing Owner
LIVE guard is reused: production runtime, explicit LIVE mode and syntactically
LIVE dedicated credential are all mandatory. Development/TEST responses cannot
verify a real account. Directory metadata alone is never beneficiary evidence.

### Conservative registered-name rule

Compare the returned beneficiary to the BRO profile's current registered full
name. Both must contain at least two nonempty ordered name tokens. Only ASCII
case, whitespace, and periods, commas, hyphens and straight apostrophes as word
separators normalize away. Do not strip honorifics, expand initials, reorder
tokens, accept added/missing names, use business names, transliterate or fuzzy
match. A single-token or non-ASCII registered name fails closed for review rather
than silently loosening the rule.

A matching lookup issues five-minute encrypted evidence bound to the requesting
actor, BRO, registered full name/owner, exact bank/account/name, current saved-bank
revision and policy. Lookup writes nothing. Changing the bank, number or profile
name invalidates evidence. Save validates the proof and current bank directory;
it does not resolve an account. Expiry is rechecked after directory access inside
the locked transaction. Concurrent saves cannot reuse an older revision.

Only a verified save with matching policy audit evidence exposes bank details.
Legacy ACTIVE records alone are insufficient; retained records are not erased.
Full numbers remain encrypted at rest; BRO reads and Owner lists are masked.
Owner-only account/snapshot reveal is explicit and audited. Refresh never verifies.

## Verification and operational limits

Focused tests use fictional identities, mock provider transport and a separate
disposable PostgreSQL cluster, never the Development application's database.
They exercise real transaction locking, duplicate requests/references, rollback,
ledger totals, bank evidence, identity changes and expiry.

No real LIVE lookup, external transfer, Production change or publishing is part
of this implementation. Real provider credential/permission and beneficiary
acceptance require separately authorized LIVE verification. Nothing changes
merchant settlement, subaccounts, student NGN 3,200 pricing, prospective internal
NGN 150 policy, or NFC/card eligibility.
