---
name: Guest NFC subscription payments
description: Parent access and assisted-payment requirements for NFC subscriptions.
---

Parents must be able to pay a student's termly NFC subscription without an EduCore account. School Admins must be able to share or print student-specific payment instructions, including for school-assisted payment when the parent has no suitable device.

**Why:** The user explicitly requires access for parents without dashboards, smartphones, or internet access.

**How to apply:** Extend the existing payment system with narrowly scoped, unguessable public links; do not expose school-wide financial records or let public callers choose student, term, amount, or allocations. Assisted cash collection must never be labelled a verified Flutterwave payment. Do not claim provider split settlement merely because internal allocation records exist.

Development simulation remains available. On 2026-10-11 the user reported Flutterwave business approval and authorized connecting the existing NFC workflow to genuine Flutterwave TEST MODE in Development only.

**Why:** The earlier simulation authorization did not permit real transactions. Business approval now permits the requested sandbox integration, but does not establish reviewed school/partner subaccounts, provider-fee arrangements or settlement capabilities.

**How to apply:** Simulated completion is not a verified payment, real receipt, subscription activation or bank settlement. Require independent server-side Flutterwave verification for genuine sandbox success. Preserve NGN 5,000 per student per term and existing allocations/bindings. Keep live credentials, real-money settlement, automatic provider splits and Production changes disabled. Never treat a supplied account number as an API key or subaccount ID.
