---
name: Owner and school-operation separation
description: Product intent behind keeping platform administration separate from tenant operations.
---

Platform ownership is not an operational School Admin capability. Even if one identity holds both global Owner and school-scoped roles, its Owner session must not change ordinary school records; cross-school viewing and explicit NFC card/device administration are separate, narrowly authorized capabilities.

**Why:** The product owner explicitly separated Yemait Technologies' platform administration from schools' day-to-day operations. An implicit Owner bypass, including one inherited through another membership, would silently give platform staff school-management power. Backend authorization alone does not keep school-operation controls out of a mixed-role Owner's interface.

**How to apply:** When adding school writes or role guards, require the intended active school-scoped role and exclude a global Owner from operational mutation paths. In the UI, prioritize Owner identity ahead of selected-school and secondary-role branches for dashboards, navigation, and operational controls; verify rendered views as well as API denial. Keep school reads and platform card/device controls explicit; do not infer write access from read access.

Owner-to-school announcements are a separate intentional platform capability, not permission to compose ordinary school operational campaigns. Keep recipients explicit, show the audience before confirmation, and default this platform workflow to in-app delivery rather than silently adding external channels.

**Why:** The requested platform communication exception must not grant ordinary school writes or send unexpected emails/SMS. Current Development scope prohibits provider configuration changes.

**How to apply:** Keep the platform route and its Owner checks separate from tenant communication management; preserve supported recipient preferences and actual delivery statuses.