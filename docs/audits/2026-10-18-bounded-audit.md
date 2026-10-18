# Yetenia EduCore bounded audit — 2026-10-18

## Completion boundary

This was a partial audit/fix pass, not completion of the entire request and not
authorization to publish. No Production data repairs, application database
migrations, secret changes, deployment changes, Git pushes, real Flutterwave
transactions, transfers or refunds were performed. TEST/payroll configuration
and financial allocation rules were not changed.

Fresh GitHub main was fetched and compared with the local committed baseline:
the relevant admission, academic, authorization, subscription and app-routing
files matched. Local changes were preserved.

## Changes made

| Area | Work delivered | Evidence / boundary |
| --- | --- | --- |
| Admission Portal Settings | Missing settings return a closed draft without a GET-side write. The authorized first PUT initializes a random persisted key transactionally and retains existing keys. Unconfigured links cannot be copied/previewed as real portals. | Admission route tests pass, including first load/save and existing Owner/tenant denials. This establishes the missing-row case, not every possible Production failure. |
| Current term/session save | An explicitly absent effective staff-NFC rule no longer blocks calendar changes. The absence is logged; no substitute financial rule or subscription is fabricated. Other errors still propagate for rollback. | Targeted policy tests pass. Actual reported Production first-term error was not reproduced end to end. |
| Calendar scope | Generated-calendar refresh joins the actual event term/session and school rather than unrelated terms. | Query predicate regression tests pass. No existing events were repaired or edited. |
| Sign-in/navigation | Authorization waits until Clerk reports a loaded signed-in identity. Authorization failures offer a retry instead of claiming the account has no roles. Parent root/subtree routes are explicit. | Frontend route/tenant tests and typecheck pass; sign-in screenshot renders. No authenticated Production browser acceptance or root-cause proof for intermittent startup failures. |
| Subscription privacy | Non-Owner subscription lists omit the platform share. NFC obligation responses remove other recipients' allocations, with school-own access checked against each row's school. Full split text/summary display is Owner-only. API contracts were regenerated. | Recursive response-projection tests pass; stored receipts/allocations are not mutated. This is not a completed audit of every payment response, staff subscription, export or notification. |
| Employee deactivation | Live authorization excludes an inactive employee's matching Teacher/Staff membership. Independent Parent/Owner/other-school roles are not globally revoked. | The actual query passed an isolated PostgreSQL check for active, inactive, legacy and independent memberships. Clerk sessions were not terminated; matching role permissions are denied on subsequent server requests. |

## Still incomplete

- **Allocation policy:** no implementation of the requested future NGN 5,000
  split: School 1,900; Owner 3,000 plus eligible Partner 100; otherwise Owner
  3,100. The existing 2,000/3,000 or 2,000/2,900/100 policy remains unchanged.
  Future work must version new charge/settlement expectations, preserve paid
  history and attribution, reconcile actual provider fees separately, and
  exercise isolated DDL plus routed settlement/refund replay.
- **Live collections:** no new Live adapter/path or flags were enabled or
  implemented. Invoice/student-NFC and webhook selection need a separate,
  production-only, explicitly disabled-by-default path. Canonical Live secret,
  webhook authentication, credential conflict checks, idempotency, verification,
  provider-mode constraints and safe callback handling must be completed
  without changing TEST or payroll settings.
- **Split confidentiality:** finish server/UI/export/notification review across
  all subscription products. Do not interpret the two corrected read surfaces
  as comprehensive coverage.
- **Person titles:** not added to storage, contracts or forms.
- **School record management:** existing edit/status/retention facilities were
  retained. No broad CRUD, hard-deletion or history-rewrite work was added.
- **Promotions:** an existing result-based promotion service was identified and
  retained. The complete third-term/result eligibility and teacher/subject
  preservation acceptance was not performed.
- **Timetable import:** no new import or OCR. Existing people XLSX parsing is
  not a timetable-import implementation.
- **Photos:** existing student upload facilities were retained. No new guardian
  photo implementation or full photo acceptance pass.
- **Exports:** no new Excel/CSV export buttons or endpoints.

## Verification

- OpenAPI code generation and shared-library TypeScript build passed.
- Frontend TypeScript check passed.
- Focused API checks: 42 tests passed across the initial and corrected
  admissions runs; the final admissions run passed all 19 tests.
- Frontend checks: 31 tests passed in four files (NFC helpers, app routes,
  tenant provider, parent routing).
- Two opt-in student-NFC PostgreSQL integration tests were skipped; these are
  not evidence of settlement or financial database readiness.
- Separate disposable PostgreSQL execution validated the actual employee-role
  membership SQL. The temporary database was stopped and removed.
- API build/restart succeeded; frontend restart succeeded; Development
  `/api/healthz` returned 200; sign-in screenshot rendered.
- Full API typecheck remains blocked by five errors in the unchanged
  `src/lib/api-bootstrap.test.ts`. Do not describe all project checks as green.
- The unrelated NFC Hardware Test workflow remains failed; hardware work was
  not attempted. Production deployment logs also showed communication-worker
  errors; these were not resolved or treated as proof of the reported bugs.

No authenticated Production admission/term-save journey, real payment delivery,
physical NFC acceptance, migration rollout or publish readiness is claimed.
