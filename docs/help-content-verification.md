# Yetenia EduCore Help Centre: content boundary

Reviewed against the current workspace source on 25 October 2026. This is a
source review, not evidence that Production configuration, hardware, provider
permissions or external delivery have been activated or verified.

The guides share one content module so search results and printed manuals cannot
silently describe different workflows. Help is public and contains no tenant,
identity, bank-account or operational data. Operational links retain the app's
existing authentication and role guards. Guide selection never assigns a role.

## Source evidence used

| Guidance | Implemented surfaces checked |
| --- | --- |
| Public applications and invitation access | `src/App.tsx`, `src/pages/apply.tsx`, existing invitation acceptance routes |
| Role navigation and school permissions | `src/components/shared.tsx`, `src/App.tsx` |
| People, classes, parents and assignments | Existing guarded routes; Students/Classes forms and teacher assignment links |
| Import Records | `src/pages/people-imports.tsx`; API `src/routes/people-imports.ts` inspect/preview/confirm workflow; CSV templates, CSV/XLSX/tabular PDF support |
| Attendance and NFC | `src/pages/attendance.tsx`; guarded Schedule, NFC Cards, Employee NFC and self-service routes |
| Academics and results | Guarded Academic Work, Curriculum, Lesson Notes and Timetable routes; `src/pages/exam-record.tsx` assigned-teacher submission and Admin review/publication |
| School finance and settlement | Existing Finance/Finance Workspace, settlement and subscription routes; current shared bank-directory validation; `docs/finance/live-school-subaccount-onboarding.md` |
| Partner schools and finance | `src/pages/partner/portal.tsx`, its role-restricted navigation and Add School, Commissions, Payouts and Settings routes |
| Partner activation | Existing conditional NFC Activation navigation and guarded Staff NFC Commissions route |
| Employee services and communications | Existing My Employee E-ID, My NFC Subscription, My Payslips, Inbox and Notification settings routes and navigation permissions |

Frontend paths above are relative to `artifacts/edupulse/`; API paths are relative
to `artifacts/api-server/`.

## Deliberate limitations

- Public applications are for School Admins and Partners, not open Teacher/Staff
  role assignment. School or organisation membership remains authoritative.
- A feature in source is not proof of external service availability. NFC reader
  delivery/readiness, account acceptance and notification delivery are separate.
- Saving, reviewing and publishing results are different stages.
- Directory membership is not account ownership or transfer permission.
- LIVE bank onboarding does not enable LIVE checkout or prove settlement.
- Partner entitlements and payout records do not establish a completed transfer.
- No unverified public support address or telephone number is supplied.
- Manuals use the browser's Print / Save as PDF flow. They do not claim a direct
  PDF download. All manual sections are expanded and included in the print layout.

When changing a documented workflow, review the shared guide content and update
its source-review date. Do not add setup instructions for planned screens or
describe TEST or mocked evidence as operational Production success.
