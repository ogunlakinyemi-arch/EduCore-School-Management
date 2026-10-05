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

Do not bypass delegated communication permission checks merely because a Teacher has academic assignments. Obtain explicit consent before adding a missing Development grant, then use the existing School Admin grant flow with only the approved permission.

**Why:** Academic eligibility and the shared school-level communication permission are separate. The user approved a minimal Communication Send grant rather than changing authorization rules to make an acceptance test pass.

**How to apply:** Verify the existing account and grant state first. Preserve assignment and family-link data, avoid replacing existing grants, and retain the permission audit. A test-grant approval is not authorization to grant permissions to other accounts or in Production.

Preserve stored notification links when fixing recipient navigation; add an authenticated route compatible with existing links rather than rewriting notification history or bypassing message authorization.

**Why:** Notifications can outlive UI changes. Navigation repairs should not disturb the message, recipient and audit evidence.

**How to apply:** Reuse the existing authorized conversation view and verify Open, refresh and Back without submitting another message. Keep server-side relationship and assignment checks authoritative.