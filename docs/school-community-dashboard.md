# School community dashboards

## Scope and safety

The existing school, parent, student and driver dashboards use a read-only,
school-scoped community endpoint. Each portal explicitly requests its own view;
a dual teacher/parent account does not receive teacher-only cards in its parent
portal. Platform ownership is not school operational membership. No endpoint
grants new attendance, payment, consent or student-directory permissions.

### Calendar

Manual create/edit/cancel and calendar regeneration compare public event state
inside the mutation transaction. Meaningful changes create an audit revision and
deduplicated **IN_APP-only** communication intents for the explicit school and
audience. Unchanged regeneration, audience reordering and private-note-only edits
do not generate another notice. Older intents for the changed event are archived.
Recipients with several matching roles are selected once.

Notification text is generic; details are fetched under current portal membership
and the event's current audience. Private calendar notes are absent from public
snapshots, notification bodies and community responses, and are redacted from
non-manager calendar reads. Cancellation cards remain audience-filtered. The
dashboard shows at most 60 recent/current/upcoming notices, with recent changes
retained for 14 days and event dates retained through 30 days after their end.

**Driver targeting is prepared but gated.** The existing database CHECK permits
only Teacher, Staff, Parent and Student. The separate SQL draft
`schema-drafts/school-calendar-driver-audience.sql` has **not** been applied to any
application database. Driver/all-community writes return an explicit approval
error until the existing CHECK actually permits DRIVER. Legacy audience sets and
defaults remain unchanged; ordinary four-audience operations do not require the
draft. After separate approval, align the ORM CHECK with the approved target as
part of that reviewed rollout; do not publish or automatically push a schema here.

### Closing time

Closing information comes from the saved attendance schedule, using the same
IANA timezone, operating days, Friday rule and explicit closures as attendance
operations. A persisted schedule revision and its save timestamp are read
together. Revision zero is explicitly **not configured**; the operational fallback
is not advertised as a saved time. Private closure/exemption reasons and student
exemptions are never returned. Calendar holidays do not silently rewrite
attendance policy; a school closure must still exist in that authoritative policy.

### Bus duties

Existing `transport_route_staff` rows remain the assignment authority. An optional
validated duty period and instructions are kept in the existing immutable
transport-history snapshots, with no new table or application migration.
The reader follows the existing executable transport migration/runtime history
columns rather than introducing a second store.

School Admin can set/edit dates, daily local start/end times and instructions in
the existing companions form. Omitted duty data survives removal/restoration.
The community response contains only the assigned active employee's rows, or the
authorized School Admin overview, with no students or employee directory.
Parent, Student and Driver community views do not receive companion assignments.
Inactive employees/assignments/routes and expired periods disappear. Future,
off-duty and non-route-day states are explicit; an undated legacy assignment
does not claim an active period.

## Verification boundary

Focused route tests use a freshly initialized PostgreSQL cluster under a private
temporary Unix socket, never application database credentials. Provider queuing
is mocked in those tests and an external-network test guard remains enabled.
The existing application databases, provider configuration and secrets are not
changed. No external SMS, push, email or Telegram sends are used for verification.
