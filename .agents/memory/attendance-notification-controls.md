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

Historical monitoring must distinguish missing evidence from an explicit
recorded absence. Teacher time-in/out derived from NFC gates are not independent
clock records or classroom confirmation.

**Why:** The Owner requested separate gate/classroom evidence and explicitly
prohibited invented teacher classroom evidence or unsupported timestamps.

**How to apply:** Show unsupported evidence as "Not recorded"; preserve each
record's actual source and timestamp and label derived gate summaries honestly.

Notification governance and school attendance schedule/rule snapshots must
survive future audit-log retention or cleanup changes.

**Why:** The focused no-migration decision reuses retained append-only governance
evidence as operational policy. Removing those snapshots could revert Owner
restrictions to defaults, not merely remove historical display.

**How to apply:** Preserve governance and school attendance policy snapshots when pruning ordinary logs.
Moving policy storage later requires an explicitly reviewed continuity plan.

Missing tag-out is unknown exit evidence, never proof of physical absence.
Closures/exemptions suppress automated assessments without erasing authentic
gate evidence or weakening device/tenant authorization.

**Why:** The combined NFC attendance request requires configurable school rules
and explicitly separates missing exit evidence from actual absence. Approved
teacher/manual corrections must remain authoritative.

**How to apply:** Create reviewable discrepancies, not invented ABSENT events;
retain original NFC provenance when corrections change status. Device keys and
VAPID configuration alone never authorize real Development notification sends.
