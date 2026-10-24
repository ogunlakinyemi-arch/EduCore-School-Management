---
name: Production test-data status
description: User-stated pre-customer Production data status and the read-only readiness-audit boundary.
---

On 2026-10-06, the user stated that Production contains only test schools/test data and no real customer schools or records. This is user-provided context, not an independently verified database census.

On 2026-10-13, the owner explicitly reconfirmed that all schools, students, parents and other Production records are test data. They authorized planning around that fact only, not deletion, resets, destructive changes, Production migrations/schema pushes, publication, real payments or notifications.

On 2026-10-24, the user again stated that every current school, student, partner and related Production record is test data. They authorized implementing a gated reset workflow, but explicitly prohibited executing a destructive Production reset, changing Production secrets/settings, applying migrations or publishing. If trusted primary/backup mechanisms are unavailable, only dry-run/preflight is authorized. Retain audit/financial history and external auth identities by default; preserve Owner/admin access, reusable assets and device inventory/credentials.

**Why:** Production-readiness compatibility audits concern existing test data, but test-only status does not authorize data repair, schema changes or deployment.

**How to apply:** Preserve the explicit read-only boundary of an authorized audit. Independently verify the intended target before application-data queries. Reconfirm test-only status before future operations; this dated statement must not be assumed permanent.
