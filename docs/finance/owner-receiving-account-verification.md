# Owner receiving-account verification

## Purpose and boundaries

Company Profile stores the Platform Owner's receiving account solely for optional
subscription bank-transfer assistance. It is not the Flutterwave merchant
settlement account, a school recipient, a split or a subaccount.

The Owner selects a supported Nigerian bank and enters the ten-digit account
number. After a 500 ms debounce EduCore automatically resolves the beneficiary
through the existing Flutterwave v3 `/accounts/resolve` capability, displays the
matching company name read-only and enables **Save Details**. There is no
separate manual Verify action; the old endpoint returns 410.
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

Only an active global Platform Owner may look up or save the account.
The server requires the Production runtime, explicit Flutterwave LIVE mode and
a dedicated syntactically LIVE secret credential. Development, TEST, missing
credentials and sandbox credentials cannot verify an account. This does not
enable collections or payroll and does not depend on a payout release.

Only a successful, well-formed matching resolution issues a five-minute
AES-GCM-encrypted save proof, bound to the requesting Owner, exact bank/name/code/
number, official beneficiary, timestamp and policy. This proof exposes neither
the account number nor a provider credential in its browser-visible fields.
The lookup itself writes no profile, verification status or financial history.

Save validates the proof, expiry, current LIVE environment, official company
name and exact submitted fields, and rechecks the supported bank directory.
It never performs resolution or accepts a typed name as evidence. Invalid,
expired, altered or another Owner's proof fails before writes. Expiry is checked
again inside the save transaction. A matching save atomically persists the
encrypted account, VERIFIED status and existing financial audit evidence.
Audit metadata includes policy, LIVE resolution environment, lookup time and
account suffix, never full numbers, proof contents or raw provider responses.

Failures never save or verify the proposed account. Existing saved records are
not changed by typing, failed lookup or failed save. GET and refresh never call
resolution or create evidence. The UI clears name/proof and disables Save as
soon as the selected bank/number changes, discards superseded in-flight results
and disables expired evidence. Loading/error and retry states are explicit.

## School disclosure

School instructions require VERIFIED status, valid verifier/timestamp, the
official legal name and the matching LIVE policy audit from the same verification
transaction. A legacy VERIFIED label without this policy evidence is insufficient.
No historical financial row is rewritten: the Owner can complete automatic
lookup and save the matched account to establish the required evidence.

Unavailable/unverified details remain hidden and schools are told not to transfer
and to contact the Platform Owner. Verified instructions still state that cash
or bank transfers cannot pay a subscription or activate NFC.

## External operational action

No Flutterwave dashboard action, real lookup or Production change was performed
to implement or test this Development change. The change is not deployed.
For a future authorized operational check, the Owner must use an appropriately
configured LIVE runtime and enter the bank/account for automatic lookup. If Flutterwave
rejects the credential or endpoint permission, confirm LIVE API access for
Nigerian account resolution in the merchant dashboard or with Flutterwave.
No settlement-bank change, subaccount creation, wallet funding, payout enablement,
charge or transfer is a prerequisite or authorized by this workflow.

Student NGN 3,200 pricing, internal-only eligible NGN 150 BRO entitlements,
non-split architecture, financial history and all card/NFC gates are unchanged.
