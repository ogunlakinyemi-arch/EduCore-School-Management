---
name: Flutterwave capability evidence
description: Keep collection configuration, bank verification, payout permission and actual split settlement separate.
---

TEST payment collections must be reported independently from payroll/payout configuration. Read-only TEST bank-account resolution may use an approved dedicated TEST collection credential without enabling transfers.

**Why:** The user needs Development testing while awaiting the company bank account. A payout-only banner falsely implied the existing TEST collection credential was absent, and tied bank verification to unimplemented subaccounts.

**How to apply:** Never implicitly enable transfers from collection readiness. Preserve explicit transfer-mode gates, Development-only credential isolation, independent webhook authentication and provider verification. A credential passing local format validation is not proof Flutterwave accepts it.

Bank-verification UX work and its tests must not implicitly authorize real
account-resolution requests. Actual verification is only appropriate for
intentional test bank data or genuine school details.

**Why:** The user explicitly required mock-only verification of the bank-check
UX and a warning that TEST credentials can still contact Flutterwave's real
service.

**How to apply:** Use mocked APIs/providers for UI regression checks. Do not
click the operational verification action or infer permission from the presence
of configured TEST credentials.

Read-only authentication evidence must not be reported as payment, webhook or settlement evidence. Compare an authenticated read with an unauthenticated control before treating a successful catalog response as proof the credential was accepted.

**Why:** A public catalog could succeed without checking credentials; even authenticated catalog access establishes none of the financial operations.

**How to apply:** Record only sanitized status/count evidence and the control result. Keep all payment, callback, persistence and payout claims explicitly unverified until their own checks succeed.

The user reported on 2026-10-11 that the Flutterwave business account is approved and its dashboard exposes API Keys and Payment Links. Treat this as merchant-approval information, not evidence of transfer or split-settlement permissions.

**Why:** Merchant approval must not be confused with either missing integration configuration or verified financial operations.

**How to apply:** Continue ordinary TEST checkout checks without asking for a new business account or implicitly enabling live operations.

Official checkout documentation examples are not necessarily an exhaustive list of sandbox return hosts. Compare the genuine authenticated TEST response with local URL validation before diagnosing initialization as provider failure.

**Why:** A successful provider response was rejected locally because the sandbox returned a different exact host from the documented canonical example. The same rejection also existed in downstream link projection and browser navigation.

**How to apply:** Verify all downstream URL validators together. Allow only the specifically verified HTTPS sandbox origin and hosted-checkout path under Development guards; never permit wildcard domains or relax deployed validation. Retain private reference evidence before an initialization attempt and never automatically retry a POST whose outcome may be uncertain.

Bank-account verification, a stored subaccount identifier and internal commission allocations are distinct evidence, none of which proves automatic provider settlement.

**Why:** Flutterwave documents collection subaccounts, but the current merchant's permissions and per-transaction school/partner settlement must still be established; the user expressly rejects simulated transfers presented as settlement.

**How to apply:** Describe missing application integration as not integrated, not unsupported by Flutterwave. Keep unverified automatic splits disabled. Require current provider contract/permissions, recipient ownership and explicit verified transaction/settlement evidence before claiming school or partner money moved. Do not require recipients for schools that have not joined.

On 2026-10-11 the user stated that no real schools had onboarded for commercial use yet. The next split-settlement phase is authorized in Development with TEST credentials only.

**Why:** Building onboarding does not authorize inventing commercial recipients, substituting the platform's bank account for a school's account, or enabling real settlements.

**How to apply:** Require each school's own verified settlement details and separately verified provider subaccount. Preserve the agreed gross school/partner/platform allocations, disclose provider fees separately, and obtain explicit approval before live operations, Production migrations or publication.

The user selected **“Yetenia covers fees”** on 2026-10-11: the payer total remains ₦5,000; the school receives a fixed gross ₦2,000, an eligible Partner ₦100, and platform gross is ₦2,900 (₦3,000 without an eligible Partner).

**Why:** Provider fees must not silently reduce the agreed school/Partner shares or increase the payer total.

**How to apply:** Treat provider fees and applicable VAT as separate platform expenses. Distinguish platform gross from net, and require provider evidence of the actual charged amount. Never infer VAT treatment or a bank deposit from internal allocations alone.

Collection-subaccount list results and creation permissions are separate evidence. A provider's HTTP 400 “Subaccounts not found” must not automatically be called permission denial or TEST-feature unavailability.

**Why:** The version-specific official guide supports TEST collection subaccounts, while the no-record list message does not establish whether that merchant's creation POST will be accepted.

**How to apply:** Preserve the exact sanitized domain response, compare optional list filters/pagination with the correct API-version contract, and require merchant-dashboard/provider confirmation or an explicitly authorized TEST creation/read-back before claiming entitlement. Provider-only test bank fixtures must not be represented as owned commercial-school recipients.

The user relayed Flutterwave Support confirmation: TEST collection subaccounts can be created through POST `/v3/subaccounts` without special enablement; NGN flat splits are supported, split payments require automatic settlement, successful split payments attract 7.5% VAT on the fee, and “Subaccounts not found” is consistent with no existing subaccounts.

**Why:** This resolves the earlier support/enablement uncertainty, but is not evidence that this project's TEST dashboard uses automatic settlement or that any recipient has actually been created.

**How to apply:** Do not ask for special TEST subaccount enablement again absent a contradictory genuine response. Do not use a synthetic fixture as an owned school or Partner. The later user instruction also authorized one provider-only TEST split transaction attempt, but not transfers, Live changes, Production migrations, publication or EduCore split-mode enablement.

Dashboard transfer/collection preferences do not establish the settlement choice. Flutterwave's current official manual-settlement guide presents the relevant choice as “How do you want to get your earnings?” with bank-account versus payout-balance options, rather than necessarily displaying literal automatic/manual labels.

**Why:** Enabling API collections or disabling transfers can coexist with an unverified earnings destination; those switches are not proof that automatic split settlement is configured.

**How to apply:** Inspect the actual earnings choice in TEST mode and interpret it using current official guidance. The guide describes payout-balance settlement followed by merchant-initiated transfers as the alternative to default automatic bank settlement. Do not change any preference merely to inspect it or infer completed settlement from the selection.

Flutterwave Support later clarified that TEST settlements are inactive: TEST transactions do not settle into balances, though transaction/webhook fields may report split details. The Live bank-settlement choice does not prove the TEST setting.

**Why:** The earlier plan made confirmation of a separate TEST earnings setting a creation prerequisite, even though Support found no additional TEST enablement step and said TEST cannot actually settle.

**How to apply:** Permit authorized provider-only TEST diagnostics without presenting TEST funds as settled. Do not enable real school split flags from this evidence; Live requires separately reviewed automatic settlement and real recipient ownership.

The actual merchant's TEST creation endpoint required `business_email` despite the reviewed public reference calling it optional. A rejected validation response is not an uncertain accepted create, but do not automatically retry it; first establish the exact rejection and no-record read-back before a bounded corrected request.

**Why:** The first isolated TEST create returned a definitive missing-email validation error; only a second correctly populated request created a single recipient. Supplying a synthetic email for an actual school would be a false contact/ownership claim.

**How to apply:** Require a genuine reviewed business contact for real school/Partner onboarding. Keep provider-only reserved-domain contacts outside EduCore's commercial entities. Record rejected and accepted attempts distinctly, never re-POST after an ambiguous response.

Treat an unexpected or unidentifiable merchant identity on a hosted TEST checkout as a stop before card entry, even when the amount and sandbox host look right.

**Why:** The genuine hosted link displayed the requested amount and TEST banner, but its displayed identity could not be recognized as the approved Yetenia merchant; completing a charge would have assumed the recipient merchant was correct.

**How to apply:** Confirm the authorized merchant's registered TEST/trading identity through the user's authenticated Flutterwave dashboard before using the existing link. A returned hosted link only proves checkout initialization; it does not prove payment, split allocation, webhook receipt or settlement.

Support's general statement that transaction/webhook fields may report split details does not establish their exact schema, transaction linkage or complete recipient coverage.

**Why:** The restricted offline investigation could not substantiate a complete allocation response/report contract. That is an evidence gap, not proof that Flutterwave never offers one; synthetic normalized comparisons cannot close it.

**How to apply:** Consult `docs/flutterwave-test-transaction-evidence-contract.md`. Obtain official schema/completeness semantics and authorized genuine redacted evidence before adding a complete-allocation mapper; collection success alone remains insufficient.

The user relayed Flutterwave Support clarification on 2026-10-13: a collection subaccount's business name is separate from the main merchant's business name. An unfamiliar checkout identity does not, by itself, justify renaming a matching TEST subaccount.

**Why:** The prior browser observation compared an unlabeled identity row with the synthetic checkout customer/name expectations, without provider evidence establishing whether that row represented the main merchant, customer or subaccount.

**How to apply:** Distinguish main merchant authentication, split-recipient IDs, subaccount labels, bank-holder names and checkout customer/customization fields. Verify main merchant identity independently; do not use cosmetic checkout customization or a subaccount rename as ownership proof. A GET that omits the business email does not establish that the submitted email was deleted or empty.

Bank-resolution failures must preserve the provider HTTP status and a sanitized category/reason, never a generic 503. The user stated on 2026-10-21 that the Development school bank account they entered is fictional, so a real-provider rejection of it is expected, not a defect.

**Why:** A 503 with no detail could not distinguish credential rejection, invalid fictional account data, rate limits, outages or network uncertainty.

**How to apply:** Keep diagnostics allowlisted (fixed reason codes from pattern matching, never echoed provider text). Generic provider errors must not change verification status or write success/mismatch audits. Do not treat a fictional-account rejection as evidence the credential or integration is broken, and never suggest fictional data for LIVE.
