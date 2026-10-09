---
name: Guest NFC subscription payments
description: Parent access and assisted-payment requirements for NFC subscriptions.
---

Parents must be able to pay a student's termly NFC subscription without an EduCore account. School Admins must be able to share or print student-specific payment instructions, including for school-assisted payment when the parent has no suitable device.

**Why:** The user explicitly requires access for parents without dashboards, smartphones, or internet access.

**How to apply:** Extend the existing payment system with narrowly scoped, unguessable public links; do not expose school-wide financial records or let public callers choose student, term, amount, or allocations. Assisted cash collection must never be labelled a verified Flutterwave payment. Do not claim provider split settlement merely because internal allocation records exist.

Development simulation is authorized while genuine settlement remains deferred until YETENIA's CAC and Flutterwave account setup are approved.

**Why:** On 2026-10-09 the user explicitly replaced stopping for unavailable settlement configuration with an independently labelled Development simulation, without authorizing real transactions.

**How to apply:** Simulated completion is a test outcome, not a verified payment, real receipt, subscription activation or bank settlement. Keep financial ledgers intact and record expected allocations separately. Do not enable real payment paths merely because credentials later appear; account approval and reviewed settlement configuration are separate prerequisites.
