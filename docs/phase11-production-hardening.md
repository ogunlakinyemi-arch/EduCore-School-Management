# YEMAIT EDUCORE PRODUCTION HARDENING REPORT

**Scope:** Development code and disposable local PostgreSQL only. This is a readiness review, not a deployment.  
**Overall status:** **HARDENING COMPLETE — BLOCKERS REMAIN.** Do not publish on the strength of this report.

## A. Baseline before fixes

- Existing product: Yemait EduCore web app and API; platform, school, family, student, partner, Finance, attendance, academics, communication, Library, Operations and Reporting routes. Backend permission checks, not navigation visibility, are the authority.
- Phase 10 recorded 565 passing tests (544 API, 21 web), 0 failed, 0 skipped, and 30 read-only PostgreSQL reporting smoke checks.
- Clerk is Replit-managed in development. Development and production credentials/accounts must not be conflated. Authenticated browser verification was already limited by session isolation.
- Repository contains 31 checked-in PostgreSQL SQL migrations (`0000`–`0030`). The development schema was known to be ahead of its migration ledger; no migration was applied to the existing development database during this audit.
- Initial review found permissive credentialed CORS, a null-school role matching weakness, an ambiguous student timetable identity lookup, incomplete maintenance asset validation at the API boundary, payout reversal/reference and decimal-selection weaknesses, raw exception logging, and incorrect JSON-parser error statuses. The Owner's school-metadata update is intentionally a platform-management function, not evidence of ordinary school-operation access.
- No manifest/service worker, tested provider delivery, application-level backup runbook, or distributed request limiter was established at baseline.

## B. Security findings and changes

| Severity before fix | Area | Evidence / consequence | Development fix | Verification / remaining limitation |
| --- | --- | --- | --- | --- |
| HIGH | Tenant roles | `hasRole` matched a null-school non-owner role against an arbitrary school, allowing routes using it to become cross-tenant. | Scoped non-owner school checks to exact membership; global Partner remains usable only without a school scope. | Direct role-boundary tests; a database invariant for malformed historical memberships was not added. |
| HIGH | Student timetable | Self lookup selected a current assignment for an arbitrary profile without active-status or unambiguous school identity. | Require an active school membership/profile, match school throughout, reject multiple profiles/assignments. | Direct inactive, ambiguous, valid-self and cross-school tests. |
| HIGH | Maintenance | Asset ID was accepted without an API-level same-school lookup. | Validate on create and update inside the existing transaction. | Cross-school API tests and PostgreSQL composite-FK rejection. |
| HIGH | Partner payouts | Reversal could lack a reference; floating-point tolerance could accept incorrect amount matching; ordered selection could reject an exact later entry. | Require a validated reversal reference, retain original payment reference, use exact integer minor units and bounded whole-entry subset selection. | Reversal/repeat/precision/subset/budget tests. No provider payout was performed. |
| HIGH | Credentialed CORS | API reflected arbitrary request origins with credentials. | Production exact-origin allowlist using `CORS_ALLOWED_ORIGINS`; absent allowlist denies cross-origin CORS, while same-origin/no-Origin requests continue. Development preview behavior remains. | Allowed/denied/preflight tests. Approved production origins are **not configured or verified** here. |
| MEDIUM | Owner imports | School import preview relied on a general school-access helper that can allow platform read access. | Require operational School Admin membership for import preview and confirmation. | Direct Owner-denial tests. Owner school metadata and platform controls remain intentionally available. |
| MEDIUM | Errors and logs | Malformed/oversized JSON became 500; central and Finance retry logs could serialize raw exceptions. | Generic 400/413 parser responses; safe fixed-category/allow-listed-code logs; generic 500 response. | Parser, synthetic secret-bearing exception and Finance retry tests. Other log paths still require operational monitoring. |

**Not a finding:** An initial static review called Owner `PATCH /schools/:schoolId` a School Admin escalation. Route semantics show school metadata management is an intentional platform capability. Other audited school-operation mutation routes use an operational membership check or explicit permissions. Do not replace Owner school-management access with school-admin authority.

## C. Effective RBAC matrix

| Role | Authorized surface, subject to server-side object/school checks | Not implied |
| --- | --- | --- |
| Platform Owner | Platform schools/partners/employees/cards/devices, authorized cross-school reads and platform reports | Ordinary school attendance, academics, Finance, staff/class/parent mutations |
| School Admin | Own-school administration and operations, invitations, own-school reports | Other schools or Owner-only platform management |
| Teacher | Assigned school/class/subject academic and attendance operations; scoped reports | Unassigned classes/subjects, other schools, platform Finance |
| Accountant | Own-school Finance and permitted reports | Partner management, academic administration, other schools |
| Parent | Linked children, family Finance/attendance/academics/Library and scoped reports | Unlinked students, other parents, school management |
| Student | Own timetable/results/attendance/Library and permitted reports | Another student's records or academic writes |
| Partner | Own referral/commission portal according to partner-profile privileges | School Admin access or unrelated school/student details |
| Staff | Own-school authorized attendance/Library/Operations subset | Platform or unrestricted academic/Finance controls |

This is an effective-role summary, not an assertion that every route was exercised in an authenticated browser session. A dual-role Platform Owner remains barred from ordinary school-operation mutations by the operational access helper.

## D. Tenant isolation

School ID, object ID and family relationship are server-side boundaries. Direct tests cover cross-school requests, parent/student identities, teacher assignments, export authorization, Owner operational denial, maintenance assets and timetable scope. On the disposable migrated schema, a School B `nfc_card_history` referencing a School A card and a School A maintenance request referencing a School B asset each raised a composite foreign-key violation; their fixture transaction was rolled back and left zero fixture schools. The authoritative Reporting route reuses scope resolution for on-screen results and CSV/XLSX/PDF exports.

## E. Database, migration and recovery evidence

- **Clean replay:** 31 SQL files applied to an empty disposable PostgreSQL 16 database. `drizzle-kit migrate` independently applied 31 migrations to another empty disposable database; rerunning it was a no-op with ledger still at 31. The replay has 91 public tables, 1,127 columns, 334 indexes and 623 constraints.
- **Current development schema:** 91 tables, 1,127 columns, 338 indexes, 613 constraints. Three public function definitions and six non-internal trigger definitions matched the disposable replay. The catalog differences are 14 additional legacy single-column FKs in replay and four named tenant-unique constraints/backing indexes in development; composite school FKs remain on both. Do not discard historical migrations or these tenant protections.
- **Known deployment gate:** Development's `drizzle.__drizzle_migrations` contains only five rows (through ID 5) despite the later schema objects. A disposable **schema-only clone** with that five-row ledger failed to run migration `0005_tenant_reference_keys.sql` because its named tenant key already exists. This proves the development clone's ledger/schema mismatch, **not** the state of production. The live development ledger was **not changed**. Existing-schema migration/reconciliation is not verified and must be reviewed and rehearsed against representative disposable data before a controlled release.
- **Backup/restore exercise:** `pg_dump`/`pg_restore` of the disposable migrated database preserved 91 tables, 334 indexes, 623 constraints, 31 ledger entries and the audit table. This proves a schema/ledger restore in a disposable environment, **not** that a production backup exists or that school data and uploads have been restored successfully.
- **Recovery requirement:** Specify backup frequency, retention, encryption/access, RPO/RTO and a documented restore drill. Include school records, migration ledger and audit/history; back up uploaded file bytes/App Storage independently of PostgreSQL if persistent uploads are introduced. Never assume a database snapshot protects object files.
- No constraint was removed or migration executed against production. No existing development migration was replayed against the live development database.

## F. Authentication

Clerk identity is the trusted source of request identity; active application users and memberships are reloaded server-side. Unauthenticated report endpoints return 401. Invitation code uses provider invitation state, an email proof, expiration/revocation controls and one-time acceptance paths; provider-side lifecycle and session expiry were not exercised live. Production Clerk settings, session length, MFA, issuer/origins and actual production account access remain **NOT VERIFIED**. Development setup endpoints require their setup key and owner-absence checks; remove or gate setup access according to the approved production bootstrap procedure.

## G. Finance and H. NFC

Finance webhook code performs raw-body signature checks, event deduplication, reference/amount/currency/school matching and locked settlement; automated replay/collision tests pass. Manual bank verification remains restricted to school personnel. Exact partner payout matching and auditable reversal references were strengthened. **No live or sandbox provider transaction was performed.** Provider delivery/signatures require a separately approved sandbox exercise.

NFC device/card historical tenant bindings and composite keys remain intact. Disposable database cross-school card-history insertion was rejected. Actual hardware scans and device reassignment with physical devices were not verified.

## I. Communication and J. Reporting

The communication worker rechecks recipient/tenant authorization before send and has retry/backoff/idempotency paths in code and tests; no SMS, email or push was actually delivered. Development adapters can simulate sends and must not be reported as provider acceptance.

Reports and exports share authorization and declared visible columns. Filter, role, tenant and export tests passed. PDF generation still uses a basic Latin font: some non-ASCII names and `₦` may become `?`. CSV/XLSX preserve Unicode. No Unicode-capable font is bundled with this application; avoid depending on a font installed only in the development container.

## K. PWA and L. Performance

**PWA is not ready:** no install manifest, service worker, installability proof or verified push dispatcher/device-revocation journey. Mobile sign-in layout is responsive, but signed-in role screens were not browser-verified.

Report/export work is synchronous; imports buffer up to approximately 5 MB per request; no distributed limiter or concurrent-upload budget was established. Frontend production build warns about a roughly 1.17 MB JavaScript chunk. No representative load test or indexed-query performance benchmark was performed. These need explicit limits and load evidence before a high-traffic release.

## M. Dependencies

Dependency audit: **0 critical, 0 high, 2 moderate** (development-only `vitest` and `@vitest/mocker` 3.2.7; the suggested remediation is a major version change). Static-code scan and privacy/dataflow scan returned zero findings; scanner silence does not negate the manual findings above. No major package upgrade was made.

## N. Test evidence

**Final full suite:** 574 API + 21 web = **595 passed, 0 failed, 0 skipped** across 68 API and 6 web files. The Phase 10 reference was 565 pass / 0 fail / 0 skip; this is 30 additional passing tests, not evidence of production readiness. Focused post-review payout/error/CORS checks: 20 passed. Root typecheck, backend build, frontend build and `git diff --check` passed. Frontend build still warns about a large chunk. The dependency/static/privacy scans and disposable PostgreSQL migration, integrity and backup/restore outcomes are recorded above; they are not production tests.

## O. Browser verification

**Verified:** unauthenticated sign-in rendering at desktop and mobile sizes, a protected `/reporting` visit resolving to sign-in, and 401 on protected unauthenticated API requests. Browser logs showed the expected development-key warning, not an application crash.  
**Not verified:** signed-in Owner, Admin, Teacher, Accountant, Parent, Student, Partner and Staff navigation/mutations in a real browser session. The agent's browser does not share the user's Clerk session. Do not claim successful authenticated role journeys.

## P. Production and configuration checklist

**Production untouched:** No Publish/deploy; no production SQL or migration; no production users, secrets, environment variables, authentication, payment, notification settings or records modified; no production webhook, payment or real notification triggered.

For a **later, separately approved** release, verify the following without pasting values into tickets or logs:

- **Required at runtime:** `DATABASE_URL`, API `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY`, web `VITE_CLERK_PUBLISHABLE_KEY`; host-provided `PORT`/`BASE_PATH` and `NODE_ENV=production` must match the artifact routing. Use the production Clerk tenant, not development keys.
- **Production-only allowlist:** `CORS_ALLOWED_ORIGINS` is required when the production browser and API are cross-origin; omit only when verified same-origin. It must list exact approved origins.
- **Optional/feature-dependent:** `LOG_LEVEL`, `FEE_PAYMENT_RETURN_URL`, `PAYOUT_ENCRYPTION_KEY` or the versioned `PAYOUT_ENCRYPTION_KEYS`/`PAYOUT_ENCRYPTION_KEY_VERSION` (required before encrypted payout details are used), provider-specific webhook verification settings, sender/storage configuration. `SESSION_SECRET` exists as a workspace secret but was not established as an active requirement of this Clerk-based app; do not substitute it for Clerk configuration.
- **Setup-only:** `EDUPULSE_SETUP_KEY` is for the restricted first-Owner bootstrap mechanism, not routine requests; limit exposure according to the approved production setup procedure.
- **Test/sandbox-only:** `PAYSTACK_TEST_SECRET_KEY` and `FLUTTERWAVE_TEST_SECRET_KEY` cannot serve as proof of live payment readiness. No provider key values were inspected or disclosed.

- [ ] Production `DATABASE_URL` identity, approved backup/restore and migration strategy; reconcile historical development ledger on a verified disposable copy before any target change. Replit-managed schema diff ordering must preserve named tenant uniqueness prerequisites before dependent composite FKs; do not substitute `drizzle-kit push-force`.
- [ ] Production Clerk publishable/secret keys, web client's `VITE_CLERK_PUBLISHABLE_KEY`, issuer/session/logout behavior and allowed application URL/origins; configure exact `CORS_ALLOWED_ORIGINS`. `NODE_ENV`, `PORT` and `BASE_PATH` must match runtime routing. Review `SESSION_SECRET` usage and cookie policy.
- [ ] `EDUPULSE_SETUP_KEY` only within the approved initial-Owner setup window; never expose it in browser code. Validate school-owner invitation flows after setup.
- [ ] Payout encryption configuration (`PAYOUT_ENCRYPTION_KEY` or key-ring/version variables) before payout-information use. Payment provider test/live keys, return URL, webhook verification settings and endpoint signatures only when those providers are enabled; do not assume the current sandbox is operational. Remita is not operationally verified.
- [ ] SMS/email/push provider credentials, sender IDs/domains and worker configuration, including lease/claim behavior across replica counts; do not interpret simulated delivery as real delivery.
- [ ] Storage and upload policy, file backup/restore, HTTPS/proxy trust, redacted `LOG_LEVEL`/observability, body-size and distributed rate/concurrency limits, monitored 429/413/error rates.

No secret values are in this report. Production configuration status is **NOT VERIFIED** because production inspection/change was outside this phase.

## Q. Remaining blockers and R. recommended next step

1. **BLOCKER — migration release path:** the development-schema clone's five-entry ledger cannot advance normally through already-present schema. Establish and rehearse a reviewed existing-schema reconciliation/forward migration with representative data before considering any release. Do not infer production's ledger or schema from this clone.
2. **BLOCKER — recovery readiness:** no verified production backup policy or data-and-file restore drill. The disposable empty-schema restore is insufficient.
3. **HIGH / release gate — provider and configuration verification:** production Clerk/CORS, payment and communication credentials/delivery are unverified; configure only in a later authorized release process and verify sandbox behavior without real money or messages.
4. **HIGH — abuse resistance:** distributed limits and concurrency budgets for uploads, reports/exports, payment/webhook/invitation and communication endpoints have not been demonstrated.
5. **MEDIUM — PWA and PDF:** installability/push are incomplete; PDF lacks Unicode text fidelity. Do not advertise either as ready.

**Recommended next step: 1. Fix blockers.** Do not Publish automatically. After the migration and recovery gates are resolved, perform a final authenticated role-browser audit and a separately controlled production migration/deployment review.