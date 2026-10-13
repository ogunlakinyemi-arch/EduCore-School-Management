---
name: Sandbox callback isolation
description: TEST credentials alone cannot establish that payment callbacks are safe for the application's database and notifications.
---

Do not complete a TEST charge until both its browser callback and dashboard webhook
destination are known to avoid unapproved database access and real notifications.
Provider-only reads are safe to separate from application settlement; standalone
checkouts must never be retroactively bound to student financial history.

**Why:** A TEST payment can still trigger the merchant's configured webhook and
application workers. A valid Development return host and a present verification
hash do not establish the API's actual database target or notification behavior.

**How to apply:** Require an already-configured, explicitly approved disposable
target and bounded synthetic fixture scope before in-app settlement verification.
Do not invoke utilities that create their own PostgreSQL instance under that rule.
If those gates are missing, limit provider work to bound read-only verification
and report mocked financial evidence separately.

Development collection routes should use the dedicated TEST aliases consistently,
without reading or falling back to a potentially live generic credential.

**Why:** Dedicated credentials previously enabled subscription checkout but not
ordinary fee checkout. A generic live key must not interfere with or substitute
for the user's authorized Development TEST credential.

**How to apply:** Preserve deployed configuration separately and fail closed on
missing, invalid or conflicting Development TEST aliases.
