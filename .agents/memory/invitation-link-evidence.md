---
name: Invitation link evidence
description: Distinguishing application route checks from actual provider-generated email navigation.
---

An HTTP 200 on the public acceptance route and a synthetic ticket test establish only that the app route is reachable; they do not explain an actual recipient's reported email-link 404. Do not attribute such a 404 to a base-path mismatch when the live artifact is mounted at root and the route answers there. Distinguish the initial emailed href from the browser's final address after redirects, with all ticket/query secrets removed, before claiming the exact cause. A Clerk-hosted ticket-acceptance href does **not** prove the 404 occurs at Clerk: development tests showed both a new and a revoked test invitation redirected to the app from that endpoint. The final browser address/status is needed to locate the failure.

**Why:** Multiple invitation families were reported as 404 even though development navigation to the canonical and legacy routes worked. A copied clicked href identified Clerk's ticket endpoint, but controlled non-delivered test invitations returned HTTP 303 to the app, including after revocation. The provider's read-only invitation list included both pending and revoked links under that path; neither status nor the initial href identifies the 404. Using a full development-host redirect for newly generated invitations is a defensive change, not proof of what happened to earlier emails.

**How to apply:** For future invitation troubleshooting, request the sanitized host and pathname shown in the browser **when the error page is visible**, not the email button's destination. Do not request or log a full ticket-bearing link. Separate code-level tests, synthetic browser navigation, actual emailed-link navigation, and completed recipient registration in the verification report.

For externally delivered production invitations, use the canonical public origin verified through deployment metadata; do not infer that origin from incoming headers or workspace domains. Development invitations remain scoped to the development Clerk instance. A redirect fix does not rewrite existing emailed links or transfer development-issued tickets to the production user store.

**Why:** A recipient's sanitized final URL identified Replit's private-development gateway, not an application or Clerk authentication failure. Changing authentication to accommodate that gateway would address the wrong layer. Replit-managed Clerk has separate Development and Production stores.

**How to apply:** Verify the deployment's public visibility and origin before changing invitation destinations. Keep synthetic URL-generation evidence separate from publication and actual recipient acceptance; do not claim existing invitations were repaired by an unpublished code change.