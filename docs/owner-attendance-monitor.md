# Platform Owner attendance monitor

Open **Attendance Monitor** (`/platform/attendance`) as a Platform Owner. Select a
school by name, Student or Teacher, the school's class for Students, and an
inclusive date range. A single date is a range with the same From and To.

- Student rows show canonical profile names/admission numbers and distinct
  accepted NFC Entry Tag-in, Exit Tag-out and recorded classroom evidence.
  `NFC_GATE_AUTO` remains explicitly provisional, not biometric or teacher
  confirmation. Tag-out never changes classroom evidence.
- Teacher rows use that school's Teacher profiles, not Staff. No classroom
  confirmation is invented. Time in/out are the first/last **recorded NFC gate**
  entry/exit, not separate clock records or calculated hours.
- Missing evidence/time is **Not recorded**, not ABSENT. Explicit recorded
  absence is preserved. Multiple events remain visible; flags report stored
  discrepancies/rejections and disclose other recorded gate sources.
- Historical student scope uses event class snapshots first, then class
  assignments that existed at the event instant. Daily roster membership uses
  recorded assignment date bounds. Only today's roster can fall back to the
  current profile class when no assignment history exists. Unattributed legacy
  events are not retrospectively assigned to a current class. Missing historical
  rosters therefore cannot be reconstructed completely without existing evidence.
- Teacher classification and person names/identifiers come from existing
  school-scoped profiles; this does not invent historical employment-type or
  name-change snapshots.
- Times display in Africa/Lagos; record dates use stored attendance `event_date`.
  Ranges are limited to 31 days, pages to 100 rows, and CSV exports to 5,000 rows.
  CSV exports include **all filtered rows**, not just the current page; over-limit
  requests fail explicitly. Scope metadata is retained even for empty exports
  using an `EXPORT_METADATA` row. Spreadsheet-formula cells are neutralized.
- Both new GET endpoints require an active global Platform Owner. A class from
  another school is rejected. Read/export success is recorded in existing audit
  logs with school and filter metadata. No attendance correction/creation/delete
  operations exist, including for dual-role Owner accounts.

## Verification

Focused React component/navigation tests cover school/class filter reset, stale
scope, separate Student/Teacher evidence, loading/empty/errors and CSV arguments.
The API suite executes actual reporting SQL and HTTP authorization against an
isolated disposable local PostgreSQL fixture, including foreign-school class
rejection, non-Owner/inactive/anonymous denials, dual-role write denials,
same-day class changes, missing/explicit evidence, paging, CSV safety and
over-limit refusal. This fixture is not a migration or Production rehearsal.

No schema change, payment/provider change, SMS configuration, Production
operation or publish is part of this feature.
