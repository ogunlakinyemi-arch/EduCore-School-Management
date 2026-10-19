# Bounded person-title follow-up — 2026-10-19

## Scope

Read the non-financial handoff and inspected the clean working tree before
editing. Freshly fetched GitHub main was compared with the relevant local
forms/routes; the prior local audit/export work was preserved. No push.

This pass prepares optional, separately stored honorifics for school Parent,
Teacher and Staff profiles. It does not complete the full audit.

## Changes

- Parent and Employee create/edit forms now offer a shared title dropdown,
  including an explicit No title option. The API accepts a fixed title enum,
  rejects unsupported values, preserves omitted titles and supports explicit
  null clearing. Legal/name fields are not prefixed or rewritten.
- Parent and Employee directory displays include the saved title. These are
  display changes, not changes to historical academic/financial snapshots.
- Prepared nullable title columns and CHECKs in the canonical schema and
  `lib/db/drizzle/0168_person_titles.sql`. Existing rows remain untitled.
- Legacy database reads use a compatible row-to-JSON projection so a missing
  new column returns null rather than breaking existing lists/details.
- Selected-title writes check storage availability before any person write.
  Without the new column they return HTTP 409 with a visible explanation;
  no person is partially created or changed. No-title saves continue to work.
- Preserved matching-school School Admin write access and Platform Owner
  read-only policy. Fixed the Employee page's Add/Edit and empty-state Add
  controls, which had been visible to read-only users despite server denial.
  Owner can read saved titles, but was not granted ordinary school write access.
- Regenerated API clients and validators from the contract.

## Rollout boundary — important

**Title persistence is not enabled on an unupgraded application database.**
The migration is prepared only and has not been applied to either application
database. Selecting a title there fails explicitly; choosing No title retains
existing operation. This is staged implementation, not a claim of completed
application-database title persistence or rollout.

Any later apply needs separate authorization and verified target selection.
Do not run a broad schema push or the prepared subscription upgrade to enable
titles. Review the specific additive migration and current target independently.

## Verification

- **26 API tests passed**: four create/edit contract validations, missing-column
  gates, omission/null behavior, routed Parent/Employee create/edit, explicit
  clearing, same-school writes, cross-school denials, Owner read-only and
  existing employee read-scope checks.
- **7 frontend tests passed**: no-title clearing, separate names, create/edit
  initialization for Parent/Teacher/Staff, visible migration failure, and
  read-only Owner display/control rendering.
- Code generation/shared-library build and API/frontend typechecks passed.
- Disposable local PostgreSQL rehearsal passed: legacy reads before migration,
  additive DDL, INSERT/UPDATE RETURNING projections, saved titles, null clearing,
  legacy-name preservation and CHECK rejection of unsupported values.
  The rehearsal used only a new private socket cluster under `/tmp`, guarded by
  its data-directory path, and stopped/removed it afterward.
  Reproducible SQL is in `scripts/src/person-title-schema-acceptance.sql`.
- Routed tests use mocked database responses; UI tests are server-rendered,
  not an authenticated browser pass or proof of application-database persistence.
- API/frontend managed workflows restarted successfully; Development health
  returned 200. Public sign-in rendered without a fatal browser error.

## Remaining

- Authorized title migration rollout and real create/edit/reload acceptance;
  broader title presentation outside these school profile forms/directories.
- Student passport and guardian photo upload/display completion and acceptance.
  Existing student photo facilities were inspected but not changed. No new
  guardian storage or photo route was introduced.
- Published-third-term promotion acceptance, explicit pass criteria,
  preview/confirmation/audit/idempotency and assignment preservation.
- Reliable review-only timetable extraction; wider edit/delete safeguards;
  reproducible remaining sign-in/link defects.
- Authenticated directory download acceptance from the previous pass.

No export or subscription implementation was repeated. Test Mode, payroll,
secrets and Production data were untouched. No application migration, live
provider call, publish or Git push occurred. Development workers remain paused.
The separate NFC Hardware Test failure and Production communication-worker
failure remain unresolved and outside this pass.
