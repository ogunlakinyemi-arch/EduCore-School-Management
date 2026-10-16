---
name: Repository reference policy
description: Use both current Replit source and freshly verified GitHub main when preparing fixes.
---

Compare the current Replit checkout with the current GitHub repository main
branch before making fixes; do not assume a cached remote reference is current
or overwrite Replit-only work to match GitHub.

**Why:** The user explicitly instructed: “Always use Replit and GitHub for
reference to fix the necessary issues.”

**How to apply:** Check the working tree, verify/fetch the configured remote main,
and inspect relevant differences before editing. Report unavailable GitHub
access or divergence honestly. Reference access does not authorize pushing,
especially directly to main, or deploying the result.
