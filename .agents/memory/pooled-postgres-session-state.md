---
name: Pooled PostgreSQL session state
description: Session-local SQL state is not retained across independent pool queries after errors.
---

Do not assume consecutive pool queries use the same PostgreSQL session, even
when tests execute serially. Use a pinned client for TEMP tables and other
session-local state that must survive expected SQL failures.

**Why:** The pool can discard a connection after an expected CHECK violation;
the next query then uses a different session and cannot see its TEMP tables.
This can turn a successful constraint assertion into a misleading missing-table
failure on the next assertion.

**How to apply:** Pin and release one client for session-scoped fixtures, or use
ordinary scratch tables only inside a wholly disposable database/cluster.
Never use application tables as a workaround.
