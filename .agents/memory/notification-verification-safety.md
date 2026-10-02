---
name: Notification verification safety
description: Development-only delivery evidence and the approval boundary for contacting recipients
---

Notification-channel integration is Development-only. Configured provider credentials do not authorize real sends, real emergency broadcasts, or contact with real parents. Use isolated fixtures and no-network adapters until the user explicitly approves a controlled provider test.

**Why:** The notification specification expressly forbids publishing, Production changes and unauthorized messages. A pre-existing SMS credential is not permission to send. Simulated acceptance, native receipt fixtures and browser mocks cannot establish physical delivery.

**How to apply:** Keep missing delivery credentials and physical installation/push marked Not Yet Verified. Retire temporary identity-provider accounts, revoke their device credentials and preserve immutable school history. Report signed-in browser verification separately from unit, native SQL and anonymous screenshot results.