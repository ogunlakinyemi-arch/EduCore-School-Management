---
name: Vendor delivery gate
description: User's delivery prerequisite for physical NFC/GPS/device integrations and vendor-dependent verification.
---
The user reports that the vendor tested its own terminal side, not against EduCore. Real terminal delivery, staging connectivity and end-to-end acceptance remain unconfirmed. The user subsequently authorized software-only NFC Terminal API compatibility and safe local focused tests, with fixed ENTRY or EXIT direction assigned to each terminal (never inferred by alternating scans).

**Why:** The user explicitly separated software implementation from physical/vendor acceptance and prohibited Production, live-secret/payment changes, real external hardware/API calls and publication for the compatibility work.

**How to apply:** Software-only compatibility changes are authorized; keep mocked tests distinct from hardware, staging and PostgreSQL concurrency evidence. Obtain approved isolated staging credentials and explicit permission before any genuine vendor/device test. Vendor-side testing alone does not prove EduCore compatibility.

Terminal direction and protocol receipt audit entries are operational state, not disposable telemetry. Preserve them during audit retention, archival or redaction work.

**Why:** The bounded compatibility implementation deliberately avoids schema migration and a parallel attendance store. Removing these entries can lose the assigned direction or the original payload identity and decision needed for safe retries.

**How to apply:** Any future audit cleanup must preserve terminal direction and receipt identity/decision metadata for the entire supported replay lifetime. Original terminal event IDs and timestamp strings remain immutable; never replace them with retry time.

Keep isolated terminal startup separate from the normal server import path, and never treat the normal Development worker-pause flag as database isolation.

**Why:** Normal startup performs a database identity probe before checking its worker-pause flag. A pause alone therefore cannot satisfy a no-database-access startup check. The local-only test prerequisite deliberately avoids shared database credentials and does not provision or prove server/schema readiness.

**How to apply:** Independently approve/provision the disposable named local target before any actual scan. Configuration/filesystem verification is not database authentication or hardware evidence; do not claim staging exists merely because the safety gate passes.
