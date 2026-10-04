---
name: Temporary QA evidence
description: Notebook resets can remove private sign-in tickets and preservation baselines.
---

Do not assume private files in `/tmp` survive a notebook or workspace reset.

**Why:** A reset removed both a normal Clerk sign-in ticket and the financial preservation baseline while the source edits survived. The browser session was also lost.

**How to apply:** Regenerate short-lived sign-in tickets from freshly verified existing identities and roles, never from guessed old user IDs. Keep baseline results in durable callback state where possible without logging credentials or personal data. If a baseline was lost, acknowledge the evidence gap; take a new verified read-only baseline before any further mutation rather than claiming an unavailable before/after comparison.