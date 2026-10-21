---
name: Provisional gate attendance and notification authority
description: User-approved provisional classroom attendance, SMS governance and retention boundaries.
---

Use valid morning student gate Tag-in as provisional classroom presence while
biometric devices are unavailable. Keep gate entry, gate exit and classroom
evidence distinct. Never label derived NFC presence as biometric or teacher
confirmation, and never let Tag-out erase classroom evidence.

**Why:** The user explicitly said, “let assume the tag in automatically mark class
attendance since biometric device is not available yet.” This is a provisional
business policy, not evidence that classroom hardware exists.

**How to apply:** Preserve original gate/history and teacher decisions, dedupe
derived daily presence, and retain a future explicit roll-call/device-confirmation
path. Flag missing or contradictory class evidence rather than inventing proof.

Notification governance snapshots must survive future audit-log retention or
cleanup changes.

**Why:** The focused no-migration decision reuses retained append-only governance
evidence as operational policy. Removing those snapshots could revert Owner
restrictions to defaults, not merely remove historical display.

**How to apply:** Preserve governance snapshots when pruning ordinary logs.
Moving policy storage later requires an explicitly reviewed continuity plan.
