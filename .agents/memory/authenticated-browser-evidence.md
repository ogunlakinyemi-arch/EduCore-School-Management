---
name: Authenticated browser evidence
description: How to interpret UI verification when the owner's Clerk session is not shared with the testing browser.
---

The owner can manually confirm the Platform Owner dashboard in their authenticated development tab, but the independent agent testing browser opens at sign-in. A user-confirmed Owner checklist is valid evidence of the visible Owner UI in that session, not proof of School Admin behavior, tenant isolation, or all server-side Finance workflows.

**Why:** An earlier browser attempt could not reuse the owner's Clerk session; the owner subsequently confirmed all requested Owner-side UI boundary checks passed in their own browser.

**How to apply:** Attribute the Owner UI result to the user's manual verification, avoid claiming agent-driven authenticated coverage, and require separate normal Clerk sign-ins and evidence for other roles or payment journeys. A synthetic or invalid Clerk invitation ticket can verify that an unauthenticated route renders instead of a 404 or blank page, but it cannot establish registration, backend activation, or inbox/link delivery; the independent browser may remain at a Turnstile challenge. Call those recipient flows unverified until a real development recipient completes them.

For approved passwordless Development fixtures, valid Clerk sign-in tickets can authenticate the existing controlled accounts through Clerk's normal ticket flow. A retained Admin-only session is not a reason to skip Parent/Teacher verification when this fixture mechanism is available.

**Why:** A browser pass stopped role-specific checks after retaining only Admin access, despite the controlled verified fixture identities already existing. Fresh fixture tickets resolved the missing credentials without new users, role changes, fabricated JWTs, or Owner impersonation.

**How to apply:** Verify Development tenant, fixture ownership metadata, and verified email before issuing tickets. Keep ticket values only in private temporary files, never source, reports, logs, or memory. Use normal Clerk sign-in/setActive, and limit this mechanism to approved fixture identities unless the user explicitly authorizes a temporary sign-in to a specific existing Development account. For that exception, confirm the actual active school membership, verified email and approved role; do not add memberships, change roles or substitute identity claims.