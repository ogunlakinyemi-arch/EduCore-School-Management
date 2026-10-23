---
name: Dashboard overlay presentation boundary
description: All-role dashboard UX scope; genuine overlays above content, inline expansions in flow, unchanged business behavior.
---

Dashboard UX scope now includes every existing role, not only Platform Owner and
School Admin. Genuine dialogs/forms must remain above long lists and fit short
and mobile viewports, with internal scrolling, reachable close/cancel actions,
background scroll locking, focus containment and restoration.

**Why:** After the earlier targeted Owner/Admin form request, the user explicitly
broadened the dashboard audit to Teacher, Parent, Student, Accountant, Partner
and other existing roles on 2026-10-23. This supersedes the earlier restriction
to opt-in fixes for individually confirmed Admin callers, not the preservation
of validation, state, save handlers, permissions or business rules.

**How to apply:** Prefer shared layout and genuine-overlay fixes across roles;
keep inline expanders/disclosures in normal flow. Audit transformed ancestors
and portal placement. Do not duplicate forms or change ownership/state/save
flows to relocate them. Preserve draft-safe backdrop behavior and authorization.
Development-only UX work does not authorize Production work, migrations,
secret changes, payment activation or notification sends. Distinguish source
and DOM checks from genuine authenticated browser/touch/keyboard evidence.
