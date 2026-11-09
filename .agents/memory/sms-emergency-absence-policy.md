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

The Owner confirmed that the configured BulkSMSNigeria sender is approved for
non-OTP transactional SMS. Do not treat an empty sender-list API response as
withdrawal of that approval or call that endpoint as a readiness prerequisite.

**Why:** The Owner obtained approval directly from BulkSMSNigeria and explicitly
corrected the earlier sender-list inference.

**How to apply:** Separate Owner-confirmed sender approval, local configuration,
provider acceptance and device receipt. Changing the configured sender requires
fresh approval evidence. Development worker/payment-test pauses protect
subscription evaluation and financial notification tests as well as delivery;
they are not safe to remove merely to enable SMS or push.
