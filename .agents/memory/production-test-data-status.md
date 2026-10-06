---
name: Production test-data status
description: User-stated pre-customer Production data status and the read-only readiness-audit boundary.
---

On 2026-10-06, the user stated that Production contains only test schools/test data and no real customer schools or records. This is user-provided context, not an independently verified database census.

**Why:** Production-readiness compatibility audits concern existing test data, but test-only status does not authorize data repair, schema changes or deployment.

**How to apply:** Preserve the explicit read-only boundary of an authorized audit. Independently verify the intended target before application-data queries. Reconfirm test-only status before future operations; this dated statement must not be assumed permanent.
