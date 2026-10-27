---
name: Payment receipt policy
description: User-approved evidence-only uploads for school settlements and parent bank transfers.
---

Receipt images/PDFs are evidence submissions, never proof of bank receipt.
Parents/guardians may upload instead of typing a transaction reference; keep
the payment pending until an authorized school finance/admin review, with a
rejection reason if rejected. No allocation or paid flag follows an upload.

**Why:** The user explicitly requested this separation on 2026-10-27 while
retaining Flutterwave collections and manual school settlement.

**How to apply:** Keep files private and role/tenant-scoped, validate bytes/size,
deduplicate where feasible and retain uploader/context plus review/audit history.
Platform Owners attach school settlement receipts only for transfers they affirm
are already completed, recording actual amount/date/reference and uploader.
An Owner confirmation is not independently provider-verified bank delivery.
Do not use sandbox-only payment tables for LIVE evidence, change financial rules
or infer permission to mutate Production, publish or call live providers.
