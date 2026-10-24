---
name: Production test-data status
description: User-stated pre-customer Production data status and the read-only readiness-audit boundary.
---

On 2026-10-06, the user stated that Production contains only test schools/test data and no real customer schools or records. This is user-provided context, not an independently verified database census.

On 2026-10-13, the owner explicitly reconfirmed that all schools, students, parents and other Production records are test data. They authorized planning around that fact only, not deletion, resets, destructive changes, Production migrations/schema pushes, publication, real payments or notifications.

On 2026-10-24, the user again stated that every current school, student, partner and related Production record is test data. They authorized implementing a gated reset workflow, but explicitly prohibited executing a destructive Production reset, changing Production secrets/settings, applying migrations or publishing. If trusted primary/backup mechanisms are unavailable, only dry-run/preflight is authorized. Retain audit/financial history and external auth identities by default; preserve Owner/admin access, reusable assets and device inventory/credentials.

On 2026-10-24, the owner further authorized offline retention-policy and rehearsal
preparation only: default to preserving audit/financial history, platform
memberships and device inventory. Consider detachment/inactive relationships only
where both schema and historical/authorization semantics remain valid. Missing a
safe automated path means a hard blocker and explicit operator decision, not
permission to null required context or bypass foreign keys. No Production
connection, real reset, settings/secrets changes, migrations or publication is
authorized by that preparation.

**Why:** Production-readiness compatibility audits concern existing test data, but test-only status does not authorize data repair, schema changes or deployment.

**How to apply:** Preserve the explicit read-only boundary of an authorized audit. Independently verify the intended target before application-data queries. Reconfirm test-only status before future operations; this dated statement must not be assumed permanent.
