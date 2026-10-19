# Narrow School Admin retention follow-up — 2026-10-19

Previous handoff: [photo blocker and promotion preview](2026-10-19-photo-blocker-promotion-preview.md).

## Scope and repository reference

Read that handoff and inspected the working tree before editing; it was clean.
Fetched GitHub main and compared the relevant source, retaining prior local work.
The assignment route and page matched fetched main before this fix.
No push or publishing.

This is one bounded retention fix, not completion of every School Admin edit/
delete path. Subscription allocation, exports, titles and promotion preview work
were not repeated.

## Findings

- Student and person maintenance paths inspected use tenant-scoped UPDATEs
  rather than hard-deleting the student/person and cascading their history.
  Inspected student-care DELETE handlers archive records, retain revisions and
  use school/student scope. This limited inspection is not certification of
  every route, dependency or concurrent write.
- **Concrete defect:** PATCH `/api/academic/assignments/:assignmentId` accepted
  content/scope/date/teacher/maximum-score changes when the existing assignment
  was ARCHIVED. Its transition map prevented reopening, but allowed keeping
  ARCHIVED while rewriting retained academic content. School Admins could use
  this path; the assignment page also offered Edit for archived rows.
  Regression cases were added before the fix and failed against that behavior.
- Matching-school authorization and tenant predicates already existed for this
  assignment path. No new financial authorization or payment behavior was needed.

## Completed

- Reject all archived-assignment PATCH requests with HTTP 409 and a clear
  read-only-history explanation. A replacement requires a new assignment.
- Check authorization first, then archival state, while holding the existing
  school-scoped assignment row lock. Unassigned teachers do not receive the
  archival conflict instead of their existing permission denial.
- Rejected edits roll back without changing academic records; ordinary denied
  request security audit entries remain allowed. Existing successful-edit audit
  writes remain in the same transaction.
- Preserve matching-school Admin and assigned-teacher operation for unarchived
  assignments. Owner, including dual-role Owner, gains no school write access.
- Replace the archived row's Edit button with “Read-only history” and exclude
  archived rows from the edit-modal branch.
- Show create/update errors in the assignment form, including an archival
  conflict when another administrator archives a record after an editor opens it.
  Existing successful-save closure and list invalidation remain unchanged.
- Continue allowing normal draft editing and archiving published assignments
  without deleting or rewriting their retained content during a status-only save.

## Verification

- **29 API tests passed:** 19 focused retention/authorization/normal-operation
  tests plus 10 existing academic-work tests.
- **3 frontend tests passed:** retained archived display without Edit, draft
  Edit availability and visible server conflict in a stale editor.
- API and frontend typechecks and diff whitespace check passed.
- API route tests use mocked SQL responses with the real authorization checks,
  except test identity injection. Frontend tests are static React renders.
  No live financial/provider operation or application test-data write was used.
- Both managed services restarted. Development health returned 200 and an
  unauthenticated assignment PATCH returned 401. Public sign-in rendered.
- **Authenticated browser acceptance was not performed.** No real Admin
  archive/edit/reload flow, multi-session race test or real-database rollback
  rehearsal was run. Existing row-lock/transaction SQL was not changed; the
  new protection is an application-level check, not a database-wide guarantee.

## Remaining gaps

- Other School Admin edits/deletes and write/audit atomicity still need bounded
  review. This fix does not certify the financial history retention of the
  entire product or change payment, invoice, refund or settlement records.
- Non-archived assignment edits and separate assessment/result/report workflows
  were not newly certified or made immutable by this pass.
- Broader preservation against direct database access or future alternate write
  paths is not provided by this route check.
- The previous handoff's policy-dependent promotion execution, guardian photo
  persistence, reliable timetable import, rollout and authenticated acceptance
  gaps remain. No sign-in/link fallback was needed because a concrete safe
  retention fix was available.
- The pre-existing NFC Hardware Test failure remains outside this pass.

No schema/migration files were changed and no migration, including 0168, was
applied. No secrets, payroll, live payments, Production data or deployment
settings were changed. Test Mode and paused Development workers were preserved.
