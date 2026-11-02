---
name: Vendor delivery gate
description: User's delivery prerequisite for physical NFC/GPS/device integrations and vendor-dependent verification.
---
On 2026-11-02 the user confirmed the physical terminal works in school mode against the Production school-terminal endpoint and HTTP 401 no longer appears. This supersedes the earlier vendor-only evidence, but does not independently establish Owner capture, unknown-card transmission, queue behavior or all-card hardware acceptance. The combined-attendance request permits Entry Only, Exit Only, and Entry and Exit on one reader; combined direction follows recorded school-day state and reviewed rules, never blindly alternates on every tap.

**Why:** The user explicitly separated software implementation from physical/vendor acceptance and prohibited Production, live-secret/payment changes, real external hardware/API calls and publication for the compatibility work.

**How to apply:** Software-only compatibility changes are authorized; keep mocked tests distinct from hardware, staging and PostgreSQL concurrency evidence. Obtain approved isolated staging credentials and explicit permission before any genuine vendor/device test. Vendor-side testing alone does not prove EduCore compatibility.

Terminal direction and protocol receipt audit entries are operational state, not disposable telemetry. Preserve them during audit retention, archival or redaction work.

**Why:** The bounded compatibility implementation deliberately avoids schema migration and a parallel attendance store. Removing these entries can lose the assigned direction or the original payload identity and decision needed for safe retries.

**How to apply:** Any future audit cleanup must preserve terminal direction and receipt identity/decision metadata for the entire supported replay lifetime. Original terminal event IDs and timestamp strings remain immutable; never replace them with retry time.

Keep isolated terminal startup separate from the normal server import path, and never treat the normal Development worker-pause flag as database isolation.

**Why:** Normal startup performs a database identity probe before checking its worker-pause flag. A pause alone therefore cannot satisfy a no-database-access startup check. The local-only test prerequisite deliberately avoids shared database credentials and does not provision or prove server/schema readiness.

**How to apply:** Independently approve/provision the disposable named local target before any actual scan. Configuration/filesystem verification is not database authentication or hardware evidence; do not claim staging exists merely because the safety gate passes.
