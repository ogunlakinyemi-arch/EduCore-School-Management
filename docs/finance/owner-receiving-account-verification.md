# Owner receiving-account verification

## Purpose and boundaries

Company Profile stores the Platform Owner's receiving account solely for optional
subscription bank-transfer assistance. It is not the Flutterwave merchant
settlement account, a school recipient, a split or a subaccount.

The explicit **Verify account details** action resolves the saved Nigerian bank
account through the existing Flutterwave v3 `/accounts/resolve` capability.
It does not call transfers, payouts, checkout, subaccount or settlement APIs.
Verification is beneficiary evidence only: no money movement, receipt,
subscription entitlement or NFC activation follows from it.

## Conservative matching rule

Both the saved company/account name and the independently returned beneficiary
must be **YETENIA TECHNOLOGIES LIMITED** under this rule:

- ASCII case-insensitive; trim and collapse whitespace.
- Periods, commas and hyphens are word separators.
- The final legal suffix `LTD` may replace `LIMITED`.
- Require exactly the three ordered words. Reject missing, reordered, added,
  approximate, transliterated, personal or alternate business names.
- Saved account numbers must be ten digits, preserving leading zeros.
  Returned account numbers must be strings; only spaces/hyphens may normalize
  away, and the result must equal the complete saved number. No numeric coercion.

Current provider directory code/name mapping must confirm the saved bank.
Missing codes, unsupported/ambiguous mappings and invalid numbers fail closed.
No invented routing code or alternative gateway mapping is used.

## Environment and persistence

Only an active global Platform Owner may explicitly request verification.
The server requires the Production runtime, explicit Flutterwave LIVE mode and
a dedicated syntactically LIVE secret credential. Development, TEST, missing
credentials and sandbox credentials cannot verify an account. This does not
enable collections or payroll and does not depend on a payout release.

Only a successful, well-formed matching resolution can atomically change a
pending/action-required account to VERIFIED. The update checks all encrypted
bank fields against the original snapshot; concurrent saves require a new
explicit attempt. The existing financial audit records the policy version,
LIVE resolution environment and account suffix, never the full account or
raw provider response. Provider failures and uncertain responses retain the
unverified status; returned beneficiary/number mismatches set ACTION_REQUIRED.

Save always resets verification. GET, refresh and page rendering never call
account resolution. Once verified, verification is not automatically repeated;
changing details requires saving and a fresh explicit verification.

## School disclosure

School instructions require VERIFIED status, valid verifier/timestamp, the
official legal name and the matching LIVE policy audit from the same verification
transaction. A legacy VERIFIED label without this policy evidence is insufficient.
No historical row is rewritten: the Owner can explicitly save the account and
verify it again to establish the new evidence.

Unavailable/unverified details remain hidden and schools are told not to transfer
and to contact the Platform Owner. Verified instructions still state that cash
or bank transfers cannot pay a subscription or activate NFC.

## External operational action

No Flutterwave dashboard action, real lookup or Production change was performed
to implement or test this Development change. The change is not deployed.
For a future authorized operational check, the Owner must use an appropriately
configured LIVE runtime and explicitly invoke verification. If Flutterwave
rejects the credential or endpoint permission, confirm LIVE API access for
Nigerian account resolution in the merchant dashboard or with Flutterwave.
No settlement-bank change, subaccount creation, wallet funding, payout enablement,
charge or transfer is a prerequisite or authorized by this workflow.

Student NGN 3,200 pricing, internal-only eligible NGN 150 BRO entitlements,
non-split architecture, financial history and all card/NFC gates are unchanged.
