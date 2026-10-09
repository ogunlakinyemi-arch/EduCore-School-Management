---
name: Authenticated browser evidence
description: How to interpret UI verification when the owner's Clerk session is not shared with the testing browser.
---

The owner can manually confirm the Platform Owner dashboard in their authenticated development tab, but the independent agent testing browser opens at sign-in. A user-confirmed Owner checklist is valid evidence of the visible Owner UI in that session, not proof of School Admin behavior, tenant isolation, or all server-side Finance workflows.

**Why:** An earlier browser attempt could not reuse the owner's Clerk session; the owner subsequently confirmed all requested Owner-side UI boundary checks passed in their own browser.

**How to apply:** Attribute the Owner UI result to the user's manual verification, avoid claiming agent-driven authenticated coverage, and require separate normal Clerk sign-ins and evidence for other roles or payment journeys. A synthetic or invalid Clerk invitation ticket can verify that an unauthenticated route renders instead of a 404 or blank page, but it cannot establish registration, backend activation, or inbox/link delivery; the independent browser may remain at a Turnstile challenge. Call those recipient flows unverified until a real development recipient completes them.

Owner-to-school messaging acceptance requires authenticated dashboard navigation, a direct route refresh, and a real Development message visible in the intended authorised School Admin's existing inbox.

**Why:** The user rejected an earlier implementation report whose isolated API checks passed while the Owner's actual messaging interface was inaccessible.

**How to apply:** Keep verification focused on the complete Owner-send → recipient-inbox journey, including explicit selection, confirmation, retry deduplication and another school's denial. A component's existence or disposable-database persistence cannot substitute for live signed-in UI evidence.

Distinguish a test interceptor's authentication failure from an application's ordinary browser request.

**Why:** A lost-response simulation's forwarded request returned 401 while ordinary requests from the same approved Clerk session succeeded. Forwarding a fresh real session token let the simulation persist the message, and the unmodified browser retry then succeeded without application authentication changes.

**How to apply:** Confirm the ordinary authenticated request before changing application auth. For approved lost-response simulations, forward the genuine session's token internally if needed; never log it, fabricate identity claims, or weaken authentication guards.

For approved passwordless Development fixtures, valid Clerk sign-in tickets can authenticate the existing controlled accounts through Clerk's normal ticket flow. A retained Admin-only session is not a reason to skip Parent/Teacher verification when this fixture mechanism is available.

**Why:** A browser pass stopped role-specific checks after retaining only Admin access, despite the controlled verified fixture identities already existing. Fresh fixture tickets resolved the missing credentials without new users, role changes, fabricated JWTs, or Owner impersonation.

**How to apply:** Verify Development tenant, fixture ownership metadata, and verified email before issuing tickets. Keep ticket values only in private temporary files, never source, reports, logs, or memory. Use normal Clerk sign-in/setActive, and limit this mechanism to approved fixture identities unless the user explicitly authorizes a temporary sign-in to a specific existing Development account. For that exception, confirm the actual active school membership, verified email and approved role; do not add memberships, change roles or substitute identity claims.

An authenticated form's existence or a visibility assertion does not prove that its controls are reachable in the actual scrolled mobile portal.

**Why:** Repeated timetable acceptance reports covered data eligibility but missed a remaining dialog-positioning risk. A genuine Finance reproduction then found a creation form in the DOM with its required selectors above the viewport. Automated selection and API success alone could miss this user-visible failure.

**How to apply:** Open reported-broken forms through normal navigation and unforced clicks, including the page's actual scroll position. Inspect viewport bounds when a dialog appears unresponsive; distinguish normal scrolling inside a dialog from forcing offscreen controls. Complete the genuine role-specific Save → HTTP success → full refresh workflow before reporting it verified.