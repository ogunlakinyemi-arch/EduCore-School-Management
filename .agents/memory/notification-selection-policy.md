---
name: Notification permissions versus selections
description: Owner ceilings, school event selections, preferences, and accurate delivery claims.
---

Allowed is only a permission ceiling; it is never a request to send.
For each mapped event, inherit the Owner defaults only if the school has no
explicit selection. An explicit empty school selection disables all channels for
that event. Intersect selections with that event's Owner permissions and Owner
school restrictions; a school cannot enable a globally disallowed channel.

**Why:** The Owner explicitly corrected automatic parent Email behavior that
treated Allowed as Default. Result publication and attendance, including absence,
must follow the settings actually shown in the school notification UI.

**How to apply:** Do not union caller hints or automatically injected Email into
effective selections. Event-specific rows are authoritative: generic Attendance
selections must not silently enable Email for the separate Absence event.
Explicit campaign channels may narrow, never expand, the effective selection.
Recheck current selections and implemented recipient preferences before external
dispatch; preserve existing consent, tenant, launch and deduplication safeguards.

In-App is an independent channel, not an automatic copy of Email or every outbox
record. Existing genuine In-App delivery history remains historical evidence.

**Why:** Disabling In-App must actually prevent new inbox messages and unread
counts even when Email is selected.

**How to apply:** Separate outbox/operational history from personal inbox
visibility. Permission, selection, configured capability, queued intent, provider
acceptance and confirmed receipt are different states. Never describe a selected
but held/unavailable channel as successfully delivered.
