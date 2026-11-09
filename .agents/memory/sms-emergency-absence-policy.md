---
name: Restricted SMS scope
description: Owner-approved SMS events and the boundary between configuration and sending.
---

SMS is approved only for emergency notifications and student absence notifications.
Arrival, exit, late entry, finance, invoices, announcements, ordinary messages,
marketing and all other events are excluded. Emergency SMS still requires an
explicit recipient opt-in; mandatory in-app security does not imply SMS consent.

**Why:** The Owner explicitly approved BulkSMSNigeria with this narrow event scope,
while prohibiting test SMS charges, Production changes and publication.

**How to apply:** Preserve school/Owner selections and tenant authorization, check
SMS scope and consent at enqueue and dispatch, and retain the provider-level event
guard. Keep Development worker/payment-test pauses intact. Credential read access,
sender registration/approval, provider acceptance and physical receipt are separate
claims. Uncertain acceptance requires reconciliation, not blind retries.
