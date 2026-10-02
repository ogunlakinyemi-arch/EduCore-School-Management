---
name: EduCore campus security and parent engagement
description: Product requirements for extending permanent NFC identity and existing communications without competing workflows.
---

Treat EduCore NFC as permanent school identity supporting campus security, not just attendance. Extend the existing card, device, person, placement, attendance and communication infrastructure; do not create a competing NFC or attendance system.

**Why:** The user explicitly describes the product as school management, digital identity, campus security and parent engagement connected through the same identity.

**How to apply:** Resolve the current person and school record from the existing UID. Keep gate, classroom and exit events distinguishable. Card replacement keeps the same person and preserves old card/event history.

An identity/access decision does not prove a physical gate unlocked, a reader LED changed or a buzzer sounded. Campus presence must indicate discrepancies instead of inventing certainty. A normal exit does not prove an authorized early pickup.

**Why:** Physical capabilities depend on the actual reader/controller, and student-release authorization is a separate safeguarding decision.

**How to apply:** Require explicit pickup approval and completion evidence. Report hardware and offline-device capabilities as unverified until confirmed. Prepare Yemait Track integration points without fabricated GPS.

Parent communication is an event-driven, child-specific service, not merely announcements. Reuse existing delivery infrastructure, resolve live authorized parent-child relationships, prevent duplicate event messages and keep provider statuses truthful. Email is optional; security-critical preferences must follow explicit school policy.

**Why:** The user identifies parents as the ultimate service users/payors and requires proactive, reliable communication across available channels.

**How to apply:** Support multiple-child selection and scoped timelines. Distinguish queued, sent, delivered and read evidence; never claim provider delivery or supported push when unavailable.