---
name: Financial approval boundaries
description: Canonical, lossless evidence commitments and withdrawal authority in retained approval history.
---

Financial approval commitments must use whitelisted server-owned facts,
canonical object ordering and lossless timestamps. Do not let form-only fields,
JSON key order or JavaScript millisecond rounding change an otherwise identical
financial scope.

**Why:** Isolated direct-release rehearsals rejected unchanged scopes when a
structurally compatible request carried extra fields, and when PostgreSQL
microsecond effective dates were round-tripped through JavaScript Date.
Conversely, changed financial facts must invalidate the approval.

**How to apply:** Keep evidence construction independent of request object shape;
preserve database precision for exact comparisons and use the same bound facts
at final approval and payment initiation.

Withdrawing or expiring a newer approval must not resurrect an older approval
for the same release scope through a query that searches for any still-approved
historical candidate.

**Why:** Retaining append-only financial evidence is not continuing authorization
to charge. An Owner's withdrawal must remain effective while history is preserved.

**How to apply:** Separate authority selection from historical retention. Evaluate
the latest approved authority and its subsequent decisions; require a fresh,
explicit approval to restore permission after withdrawal or expiry.
