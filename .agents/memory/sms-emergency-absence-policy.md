---
name: Restricted SMS scope
description: Owner-approved SMS events and the boundary between configuration and sending.
---

## Field Operations follow-up exception

The user additionally approved building an Owner-controlled SMS follow-up for
schools recorded as visited but not onboarded. Owner previews the message and
recipients, chooses selected or all eligible contacts, and confirms bulk dispatch.
Recheck actual onboarding at send time; deduplicate campaign/recipient sends,
retain provider outcome/audit evidence and retry only proven failures, not unknown
acceptance or successful sends. No WhatsApp integration is authorized.

**Why:** The user explicitly requested this Field Operations purpose using the
already configured SMS provider, alongside the existing financial integration.

**How to apply:** Add a narrowly scoped Owner-only purpose rather than mislabel
follow-up as emergency/absence or remove global SMS safeguards. Preserve existing
permissions, opt-outs, sender configuration and worker suppressions. Building the
feature does not authorize test messages, real dispatch or worker activation.

Reminder selection belongs directly in the visited-schools list: a single-school
action selects exactly that school, and multi-selection/select-all uses eligible
visible rows. Selection never grants contact permission; missing permission must
remain explicit and use the reason-bearing verified-permission process.

**Why:** The Owner explicitly requested single/multiple school reminders from
Field Operations rather than a separate, hard-to-find campaign selector.

**How to apply:** Keep the exact-message preview and explicit send confirmation,
exclude onboarded/opted-out/invalid contacts, and never enable automatic outreach.

## Existing parent/school notification restriction

SMS also supports the fixed Monday/Friday WAT financial reminder purpose
approved on 2026-11-27: positive, fresh school fee balances to relevant
guardians, and appropriately scoped unpaid NFC reminders. This is not general
SMS permission for arbitrary finance/invoice messages, arrival, exit, late
entry, announcements or marketing. Preserve explicit recipient opt-in,
Owner ceilings and operational delivery pauses; a school does not approve or
disable each scheduled financial run.

**Why:** The user expanded the earlier emergency/absence-only notification scope
specifically for mandatory scheduled financial reminders, without authorizing
test charges, operational activation, Production changes or publication.

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
