# Photo blocker and promotion evidence preview — 2026-10-19

Next handoff: [narrow archived-assignment retention fix](2026-10-19-assignment-retention.md).
Photo and promotion execution boundaries below remain unchanged.

## Bounded scope

Read the person-title and non-financial handoffs first, checked the clean
working tree, and fetched current GitHub main for reference. Preserved all
prior subscription, export and title work. This is a small follow-up, not
completion of the full audit.

## Exact photo blocker

Student photos already have a managed private-storage pattern: short-lived
upload requests, size/type/pixel validation, protected reads and a saved
student photo reference. This pass did not replace it or claim new acceptance
of student passport/ID-card rendering.

The Parent profile has no photo reference or managed-photo association.
The existing student upload endpoints bind paths, authorization and confirmation
to a student, not to a parent/guardian profile. Reusing a child's photo field,
placing image bytes in an unrelated text field, making a private photo public,
or using arbitrary external URLs would not safely complete guardian photos.
A persistent parent/guardian photo reference/association requires a separately
reviewed schema addition. That is outside this pass's no-schema-change boundary.
No photo routes, storage settings or data were changed.

## Implemented fallback: read-only promotion validation

Added GET `/api/school/academics/promotions/readiness` and a validation card
on the existing promotion preparation screen. A selected school and source
session are required.

- Server enforces the active matching-school School Admin operational role.
  Owner (including dual-role Owner), other-school Admin, family and other
  roles cannot read this operational preview.
- Validates the source session's school and resolves exactly its `Third` term.
  Missing/ambiguous Third never substitutes an earlier term.
- Counts only active current placements in that school/session. Flags multiple
  current placements rather than choosing one silently.
- Evidence requires a PUBLISHED result with publication timestamp, matching
  school/session/Third term, student/assignment/class/section and valid score
  bounds. Earlier terms, drafts and unrelated/historical placements do not count.
- Shows cohort, evidence and missing-evidence counts plus blockers/warnings.
  It does not label any student Passed or Eligible.
- No staging rows, history entries, assignments or calendar records are written.
  Repeated previews do not create batches or duplicate mutations.

## Unresolved policy and execution boundary

The existing batch service has a hard-coded recommendation heuristic
(average score at least 50 and attendance at least 75%). No separately saved,
school-approved promotion pass/required-subject completeness policy was found.
Grading bands alone do not establish promotion eligibility. This pass does not
invent such a policy or treat that heuristic as approval.

The new response always says `executionEnabled: false` and
`policyStatus: REQUIRES_APPROVED_POLICY`, even when every student has some
published evidence. Counts alone cannot prove complete required subject coverage.

**Existing batch preparation/review/finalization endpoints remain unchanged.**
The preview is not an enforcement gate for them, a confirmation token, or
certification of their execution safety. Full promotion acceptance still needs
approved criteria, fresh server-side validation at execution, explicit
confirmation, audit/idempotency acceptance and preservation of subject/teacher
assignments. Existing batch history/idempotency capabilities were not replaced
or re-certified. The new preview itself cannot move or modify any records.

## Verification

- API: **15 tests passed** (12 preview route checks and 3 existing promotion
  contract checks).
- Frontend: **9 tests passed** (3 preview rendering checks and 6 existing
  promotion logic checks).
- OpenAPI generation/shared-library build and API/frontend typechecks passed.
- Actual evidence SQL passed against a newly initialized disposable local
  PostgreSQL cluster, including earlier-term/draft/unpublished/invalid-score,
  tenant/session/class/section/assignment exclusions, placement conflicts,
  missing term and empty cohort.
  Run `node scripts/src/promotion-readiness-native-check.mjs` to repeat.
  The fixture refuses non-disposable targets. No application database credentials
  or application migration is used; the cluster is stopped and removed.
- API/frontend workflows restarted successfully. Development health returned
  200; unauthenticated readiness returned 401. Public sign-in rendered.
- Route tests use mocked database responses; UI tests use server rendering.
  **No authenticated School Admin browser selection/refresh acceptance** or
  real application-database preview acceptance was performed. The public
  screenshot does not verify the protected preview screen.

## Remaining and safety boundary

Guardian photos and full student/guardian profile/ID-card photo acceptance
remain incomplete. Promotion execution acceptance remains incomplete for the
reasons above. Title migration rollout, authenticated exports, timetable
import, wider record-management safeguards and unresolved sign-in/link journeys
also remain open.

No application schema change, migration application (including 0168), live
payment/provider call, secrets/payroll change, Production data change,
publishing or Git push occurred. Test Mode and paused Development workers
were preserved. Existing NFC Hardware Test and separate Production-worker
issues remain outside this pass.
