---
name: School billing authority policy
description: Why School Admin mode discovery and LIVE billing identity must be server-owned and separate from legacy TEST records.
---

School Admin billing must obtain effective payment mode, eligible student,
numeric current term and recoverable LIVE status from an authenticated,
school-scoped server contract. Browser settings, credentials being present,
legacy subscription IDs/text terms, TEST payments and redirects are not LIVE
identity or paid evidence. A blocked LIVE selection must not fall back to TEST.

**Why:** The user explicitly required a safe contract extension rather than
guessing the connection or weakening Owner-only release controls. Preserving
existing TEST behavior does not authorize using its records to represent LIVE.

**How to apply:** Keep release approval and school billing discovery separate.
New UI flows must remain disabled when server identity/recovery is ambiguous.
Preserve original-payment binding when processing refunds; a refund identifier
is not the original collection identifier.
