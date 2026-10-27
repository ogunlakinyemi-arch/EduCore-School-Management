---
name: School billing authority policy
description: Why School Admin mode discovery and LIVE billing identity must be server-owned and separate from legacy TEST records.
---

The School Admin NFC section is for the fixed NGN 3,200 Student platform fee to Yetenia, scoped to one student and academic term. It must not configure that amount or modify the separate parent-to-school NFC fee workflow.

**Why:** The user explicitly corrected a change that had incorrectly routed this action into school-configurable parent fee invoices.

**How to apply:** Reuse the separate direct non-split platform ledger and release gates. A school fee receipt, TEST result or redirect cannot satisfy the platform obligation; independently verified successful Flutterwave evidence must match the exact student/term.

School Admin billing must obtain effective payment mode, eligible student,
numeric current term and recoverable LIVE status from an authenticated,
school-scoped server contract. Browser settings, credentials being present,
legacy subscription IDs/text terms, TEST payments and redirects are not LIVE
identity or paid evidence. A blocked LIVE selection must not fall back to TEST.

**Why:** The user explicitly required a safe contract extension rather than
guessing the connection or weakening Owner-only release controls. Preserving
existing TEST behavior does not authorize using its records to represent LIVE.

**How to apply:** Keep release approval and school billing discovery separate.
New UI flows must remain disabled when server identity/recovery is ambiguous.
Preserve original-payment binding when processing refunds; a refund identifier
is not the original collection identifier.
