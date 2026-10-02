---
name: Development session retention
description: Distinguish account-switch sessions from a newly completed sign-in before diagnosing transport failures
---

Account-switch behavior on a sign-in screen must distinguish a session already active on entry from one created while the screen remains mounted. Invitation acceptance retains its verified-recipient flow.

**Why:** Genuine Clerk ticket exchange and activation succeeded, but an automatic React effect immediately called sign-out on the new session. An initial anonymous authorization 401 was a separate, expected rejection and did not prove broken cookie forwarding.

**How to apply:** Trace the actual session-ending caller before changing authentication transport. Preserve account switching without ending newly created sessions; verify genuine cookie-based sign-in, protected reads, refresh, and explicit logout. Do not add browser bearer-token workarounds for an unrelated session lifecycle bug.