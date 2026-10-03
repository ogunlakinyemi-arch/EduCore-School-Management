# Development termly subscription enforcement

Date: 3 October 2026. Environment: Replit Development only.

## Implemented policy

- Uses the existing current academic session and term, with Lagos calendar dates.
- Seven calendar days of grace; enforcement begins on term start plus seven days.
- Only verified current-term coverage counts. Starting checkout, receiving transfer instructions, and pending verification do not restore access.
- Partially paid schools keep paid students active. Only unpaid students, their card usage, and their child-specific parent functions are restricted. Teachers and readers are not locked school-wide because of partial payment.
- Fully unpaid schools receive the school-wide teacher and reader restrictions after grace.
- The next term is evaluated independently and starts with fresh grace.
- Missing or ambiguous calendars do not manufacture unpaid locks. Eligibility errors preserve reliably confirmed current-term restrictions rather than inventing new ones or carrying earlier-term restrictions forward.

## Implemented functionality

1. Centralized, serialized subscription evaluation and reconciliation, shared by automatic enforcement, confirmed Owner actions, and verified restoration.
2. Recurring evaluation integrated into the existing delivery/job loop, without a second scheduler.
3. Independent persisted subscription restrictions, separate from permanent card, account, credential, and reader lifecycle states.
4. Backend student NFC/manual-attendance enforcement and school-wide employee NFC enforcement for fully unpaid schools.
5. `SUBSCRIPTION_REQUIRED` denials without confidential financial details. Blocked student software taps do not create normal attendance.
6. Teacher restrictions on attendance, protected academic operations, and lesson-note mutations. Historical lesson-note reads retain their existing authorization.
7. Child-specific parent attendance, academic, timetable, and message-write restrictions. Login, account, inbox, notification preferences, and payment-resolution routes remain accessible.
8. Parent relationships resolved using the child's school. Cross-school relationships additionally require the appropriate live Parent membership; no duplicate parent profile is created.
9. Verified payment restores eligible services immediately through fresh eligibility reads, with persisted reconciliation and restoration audits handled automatically.
10. Restoration does not overwrite lost, revoked/blocked, locked, or otherwise unrelated permanent card restrictions, or reactivate disabled accounts. Existing payment finalization no longer activates previously locked cards.
11. Existing notification architecture receives idempotent ACCOUNT notifications and in-app/push/SMS/email delivery requests. Verification used Development simulation providers, not live recipient delivery.
12. School Admin read-only status, dates, amounts, affected counts, and independent card/device restrictions.
13. Owner overview filters, single/multiple school selection, explicit confirmation, stale-term/duplicate-selection rejection, per-school results, and shared audited enforcement. No unrestricted unpaid-school unlock was added.
14. Role and child restriction banners, mobile-fit overview metrics, and settled academic-denial panels with manual Retry instead of automatic retry/loading loops.
15. Student self-service checks cannot be bypassed using an ignored, caller-supplied foreign student identifier.

Subscription pricing, shares, commissions, existing calendar generation, and payment methods were not replaced.

## Automated verification

| Check | Result |
|---|---|
| Backend aggregate | 1,285 passing tests across 109 passing files; 58 opt-in cases skipped |
| Frontend aggregate | 313 passing tests across 55 files |
| Subscription calendar policy | 19 passing cases, included in backend aggregate |
| Owner HTTP permission/confirmation boundary | 6 passing cases, included in backend aggregate; identity explicitly mocked |
| Native PostgreSQL subscription integration | 21 passing cases against a schema-only disposable database |
| Backend TypeScript | Passed |
| Frontend TypeScript | Passed |
| Diff whitespace/error check | Passed |
| Managed Development services | Restarted successfully; API and frontend running |

The native suite exercises real SQL, migration replay, tenant-bound term foreign keys, pending versus verified coverage, grace, partial coverage, reader/teacher behavior, paid siblings, cross-school parents, foreign-parent privacy, timetable restrictions, ignored-identifier spoofing, repeated enforcement/restoration, permanent state preservation, disabled-account preservation, notification queueing, stale selections, next-term grace, and known-state outage behavior.

The general backend command explicitly excludes the pre-existing NFC current-record integration suite because its safety guard requires a different disposable cluster path. Other opt-in PostgreSQL suites are skipped in that aggregate. The dedicated subscription PostgreSQL suite was run separately, not counted as an aggregate success while skipped.

## Migration and Development targeting

- Additive subscription-enforcement migration applied transactionally to the independently matched Development database.
- Platform and shell database identities matched before Development writes.
- Migration replay ran twice in the disposable database; cross-school term references were rejected by the real foreign key.
- No Production migration or data operation was performed.

## Signed-in browser verification

Used genuine Clerk Development SDK sessions for owned temporary Parent, Student, Teacher, and School Admin accounts. No fabricated JWTs, Owner identity, or mocked browser API responses were used.

- Unpaid child: authenticated attendance, results, report-card, and timetable reads rejected with HTTP 403 and `SUBSCRIPTION_REQUIRED`.
- Paid child under the same parent: attendance, results, report cards, and timetable returned HTTP 200 and normal empty states.
- Parent inbox and account/notification preferences remained accessible; in-app restriction notices were visible.
- Unpaid parent message creation was denied before payload creation. No actual message was submitted; the composer contained only an unsent local draft.
- Student sign-in/dashboard stayed accessible with the own-unpaid restriction banner; attendance was denied.
- Owned software NFC event returned HTTP 403; normal attendance remained zero and permanent card/device/credential states were unchanged. This was not physical hardware testing.
- Teacher attendance was allowed for partial coverage. Changing only owned synthetic coverage to pending caused attendance and lesson-note POST denial; restoring verified coverage immediately restored teacher attendance. The temporary payment-row change was restored in `finally`.
- School Admin overview showed one of three students covered, no school-wide teacher/reader lock, correct dates, and ₦15,000 due / ₦5,000 covered / ₦10,000 outstanding for the synthetic fixture.
- At 402, 768, and 1365px, the corrected enforcement page had no document-level horizontal overflow. The badge distinguishes student-only restriction.
- Denied academic tabs showed a settled subscription message and Retry control, without an automatic retry loop.

The initial browser pass found mobile clipping and unsettled denied academic panels. Both were fixed; the existing tester performed one focused recheck of those fixes and the same-parent paid-child case, which passed.

## Data preservation and cleanup

- Before signed-in verification: 841 existing row fingerprints across 164 public tables.
- After verification and fixture retirement: all 841 fingerprints still matched. No original row was missing or modified.
- Seven owned temporary Clerk identities were deleted; their application memberships were retired.
- The owned device credential was revoked. Historical school, relationship, attendance/security, notification, financial, and audit evidence was retained.
- The disposable PostgreSQL verification process was stopped after testing.

## Not yet verified / limits

- Genuine Platform Owner browser selection, filters, confirmation, lock results, and audit viewing: unavailable in the agent browser. Owner HTTP boundaries were tested with mocked identity; this is not a substitute for a genuine Owner UI session.
- Real payment-provider settlement and real funds: not exercised. Browser coverage used an explicitly synthetic verified legacy subscription row.
- Physical NFC readers and real on-device messages: not exercised.
- Physical push, SMS, and email delivery: not verified. SMS/email verification used Development simulation providers.
- The Student timetable screen's existing ancillary school-catalog requests returned cross-tenant denials in the fixture. The student restriction/attendance path was verified; a complete live timetable journey was not.
- No real school acceptance test or Production deployment was performed.

## Production

Nothing was Published. No Production database, schema, or data was modified.

The Replit Publish-generator issue remains untouched and continues to be handled separately through Replit Support.