# Bounded non-financial follow-up — 2026-10-19

Subsequent follow-up: [staged person-title forms and safeguards](2026-10-19-person-titles.md).
That report supersedes the title portion of the remaining-scope list below,
subject to its unapplied migration and acceptance boundaries.
Latest follow-up: [photo blocker and promotion validation preview](2026-10-19-photo-blocker-promotion-preview.md).

## Scope and repository reference

Read both prior audit handoffs before changing code. The initial working tree
was clean. GitHub main was freshly fetched and compared with the current local
checkout; local prior-pass work was retained. No push was performed.

To keep this pass bounded, delivered one coherent area: Excel-compatible
directory exports for students, classes, parents, non-teaching staff and teachers.
This is **partial completion**, not a new broad audit or a release approval.
The financial-priority pass was not repeated.

## Delivered

- Added five fixed-projection directory definitions to the existing authenticated
  reporting/export pipeline. Both Excel and CSV use its existing spreadsheet
  formula protection, private/no-store responses and export audit logging.
- Only Platform Owner and active matching-school School Admin roles may read
  these directories. Other school roles, family roles and Partners are denied.
  Even Owner must explicitly select a school; there is no all-school PII export.
- Added Excel buttons to Students, Classes, Parents and Teachers & Staff.
  Non-teaching staff includes employee types other than Teacher, not merely
  employees labelled General Staff.
- Each file has at most 200 records, deterministic ordering and a page selector.
  Successful downloads report exported row count, total and page count. These
  are all-status directory exports, explicitly independent of the page's search
  filters. Successive files are separate reads, not a frozen database snapshot.
- Exported columns exclude payroll, bank data, medical notes, identity-provider
  identifiers, guardian authorization details and financial allocation data.
  Empty exports still contain column headings.

No database schema change or migration was needed.

## Verification and limitations

- API/report checks: **41 passed** across directory projection, routed reporting
  and existing serializer/core tests.
- Frontend checks: **10 passed** across export authorization rendering and the
  existing Students-page tests.
- API and frontend TypeScript checks passed; diff whitespace check passed.
- Routed checks cover Owner/Admin access, other-tenant denials, excluded roles,
  unauthenticated denial, bounds, rejected unsupported filters, audit generation,
  XLSX responses, CSV formula protection and fixed-column disclosure.
- These are mocked-database route/projection tests and server-rendered UI tests,
  **not** a real database export or an authenticated browser download acceptance.
  No Excel desktop application was driven.
- Both affected managed workflows restarted successfully. Development health
  returned HTTP 200 and the actual unauthenticated export endpoint returned 401.
  Public sign-in rendered without a fatal browser error. This does not verify
  the protected directory layouts or the browser's download interaction.

## Remaining scope

- Persisted person-title dropdowns across parent, teacher and staff entry forms
  and their API contracts/storage.
- Guardian photo completion and student/guardian upload/display acceptance.
- Third-term published-result promotion acceptance: pass criteria, preview,
  confirmation, concurrency/idempotency, audit and assignment preservation.
- Reliable timetable extraction with human review; no uncertain auto-apply.
- Wider School Admin editing/deletion and immutable/audited financial and
  academic record treatment.
- Remaining authenticated sign-in/invitation-link journeys.
- Existing employee deactivation authorization was preserved, not reimplemented
  or given new acceptance evidence by this pass.
- Real authorized Development export/download acceptance, including multi-page
  schools and independent sessions, remains unverified.

## Safety boundary

No application-database upgrade, migration application, historical record edit,
Production data change, secret change, payroll change, provider operation,
publishing or Git push was performed. Test Mode and the prepared financial
migration were untouched. Development background workers remain paused.
The pre-existing NFC Hardware Test failure and separately observed Production
communication-worker failure remain outside this pass.
