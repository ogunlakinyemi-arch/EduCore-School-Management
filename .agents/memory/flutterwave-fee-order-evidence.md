---
name: Flutterwave fee-order evidence
description: Support-reported fee-first splitting requires exact recipient payout evidence, not percentage guesses.
---

Flutterwave support was reported by the user to deduct processing fees before
splitting, with a reported existing 40% subaccount / 0% merchant configuration.
Treat that as support-reported information, not an independently inspected
external account state or a universal API guarantee.

**Why:** A gross-based fixed school/Partner entitlement cannot be established by
a percentage of a variable post-fee net. Valid local flat instructions and bank
ownership verification do not establish effective provider split semantics.

**How to apply:** For new deferred-commission payments, require reviewed V3
single-school fixed-amount semantics and exact post-fee school/main-merchant
evidence; do not require or add a Partner checkout subaccount. Older frozen
multi-recipient references retain their original policy. Keep the school
entitlement intact, accrue the eligible Partner internally and expense provider
costs once against the merchant remainder. Never guess percentages or repair
prior history to match dashboard displays.

The user later supplied written Flutterwave support confirmation: use
`flat_subaccount` with explicit fixed recipient charges, omit
`transaction_split_ratio`, and set Settings > Business preference fee bearer
to Merchant. Treat the intended provider semantics as confirmed, not still
blocked by contradictory public prose. This does not change deferred Partner
policy or establish the actual LIVE dashboard setting/recipient ownership.

**Why:** The user's support quote resolves the earlier interpretation question,
but cannot prove the merchant actually made the required account configuration.

**How to apply:** Require separately reviewed Merchant dashboard and genuine
LIVE school-ownership evidence, approved schema/workflow/webhook finalization
and independent transaction-level settlement acceptance. Preserve hard-disabled
release gates until separately authorized. Never promote support prose alone
into actual account verification or money-movement permission.

Structured authority evidence must be committed by the immutable reviewed hash,
not accepted merely because a caller supplies true attestations. Preserve old
generic reviews and completed financial history rather than rewriting them.

**Why:** A generic evidence digest says nothing about fee bearer or ownership;
the authority must bind the exact reviewed document and original recipient.

**How to apply:** Keep approval custody separate from evidence submission, and
recheck the original review before a first operational activation.

An Owner's evidence import preview is read-only validation, never an approval
or authority creation step. A bound document does not independently verify the
dashboard or authorize a real charge, even if the schema tables are present.

**Why:** The user explicitly separated preparation from migration application,
webhook acceptance and real-money release authorization.

**How to apply:** Keep financial gates independent of preview access; do not
reuse an informational match or isolated finalization success as release consent.
