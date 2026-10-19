---
name: Admin form presentation boundary
description: Keep confirmed Owner/Admin add/edit forms viewport-visible without changing business behavior.
---

Platform Owner and School Admin add/edit forms must remain visible above long
lists, with internal scrolling, a reachable close/cancel action, background
scroll locking, and sensible focus restoration.

**Why:** The user reported that school Edit, student Add/Edit and subject
Add/Edit required scrolling through long lists to find the open form. They
explicitly requested a small reusable presentation fix, preserving validation,
save handlers, permissions and schemas, with no financial or Production work.

**How to apply:** Reuse the viewport dialog presentation and opt in confirmed
affected callers instead of globally replacing unrelated legacy dialogs. Audit
animated/transformed ancestors, which can contain fixed-position descendants.
Do not duplicate the form or change its ownership/state/save flow to relocate
it. Preserve existing authorization boundaries even when a dialog becomes
accessible from more screen sizes. Distinguish DOM/short-viewport tests from
actual signed-in browser and physical keyboard verification.
