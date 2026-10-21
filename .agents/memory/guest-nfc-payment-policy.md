---
name: Guest NFC subscription payments
description: Parent access and assisted-payment requirements for NFC subscriptions.
---

Parents must be able to pay a student's termly NFC subscription without an EduCore account. School Admins must be able to share or print student-specific payment instructions, including for school-assisted payment when the parent has no suitable device.

Public payment identity must show the intended canonical student's name and
admission identifier for its school and period, without guardian/contact/private
profile details or a browser-controlled student override.

**Why:** The user requires payers to confirm whom they are paying for and reported
different student identifiers across creation and public screenshots. Such a report
does not authorize repairing or reassigning historical payment records.

**How to apply:** Resolve identity from the authorized bearer payment context;
reject incomplete or contradictory bindings. Treat same-page fragment changes as
identity changes and discard superseded asynchronous responses. Do not infer the
cause of historical screenshots without their actual reference evidence.

**Why:** The user explicitly requires access for parents without dashboards, smartphones, or internet access.

**How to apply:** Extend the existing payment system with narrowly scoped, unguessable public links; do not expose school-wide financial records or let public callers choose student, term, amount, or allocations. Assisted cash collection must never be labelled a verified Flutterwave payment. Do not claim provider split settlement merely because internal allocation records exist.

Development simulation remains available. On 2026-10-11 the user reported Flutterwave business approval and authorized connecting the existing NFC workflow to genuine Flutterwave TEST MODE in Development only.

**Why:** The earlier simulation authorization did not permit real transactions. Business approval now permits the requested sandbox integration, but does not establish reviewed school/partner subaccounts, provider-fee arrangements or settlement capabilities.

**How to apply:** Simulated completion is not a verified payment, real receipt, subscription activation or bank settlement. Require independent server-side Flutterwave verification for genuine sandbox success. Preserve NGN 5,000 per student per term and existing allocations/bindings. Keep live credentials, real-money settlement, automatic provider splits and Production changes disabled. Never treat a supplied account number as an API key or subaccount ID.

Assisted NFC requests may cover the current term or a valid future ACTIVE/PLANNED term within the school's current ACTIVE session. Future payment must not be treated as payment for the current term.

**Why:** The user explicitly requested advance payment for the following term while preserving academic-period validation. Extending payment to historical terms or other sessions would exceed that request.

**How to apply:** Apply the same eligibility policy at request creation, checkout initialization and successful-payment finalization. Keep the in-progress term's explicit current designation, valid session/term dates, original-school binding and independent provider verification. Do not infer that creating a future reservation activates a subscription or issues a paid receipt.
