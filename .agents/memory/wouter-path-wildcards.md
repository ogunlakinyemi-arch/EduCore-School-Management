---
name: Wouter path wildcards
description: Avoid assuming an appended star is a subtree matcher.
---

Use separate exact portal-root and slash-star descendant patterns in Wouter. Do not assume a pattern such as `/partner*` includes `/partner/nfc-activation`.

**Why:** Wouter's regexparam parser interpreted the appended star as a regular-expression quantifier on the preceding character, not a subtree wildcard. Deep links then depended on unrelated fallback/role-routing branches instead of their explicit portal guard.

**How to apply:** Test representative root, descendant, neighboring portal and unknown paths with the actual router/parser when changing portal routing. Keep canonical landing redirects scoped to a verified portal and known entry path; preserve genuine unknown-page errors.
