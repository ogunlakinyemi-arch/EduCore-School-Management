---
name: Invitation link evidence
description: Distinguishing application route checks from actual provider-generated email navigation.
---

An HTTP 200 on the public acceptance route and a synthetic ticket test establish only that the app route is reachable; they do not explain an actual recipient's reported email-link 404. Do not attribute such a 404 to a base-path mismatch when the live artifact is mounted at root and the route answers there. Compare the clicked email link's host and path with the development app's host and path, with all ticket/query secrets removed, before claiming its exact cause or a complete fix.

**Why:** Multiple invitation families were reported as 404 even though development navigation to the canonical and legacy routes worked. The recipient's actual redacted clicked URL was not available. Using a full development-host redirect for newly generated invitations is a defensive change, not proof of what happened to earlier emails.

**How to apply:** For future invitation troubleshooting, request only the sanitized host and pathname or provider-side delivery diagnostics. Do not request or log a full ticket-bearing link. Separate code-level tests, synthetic browser navigation, actual emailed-link navigation, and completed recipient registration in the verification report.