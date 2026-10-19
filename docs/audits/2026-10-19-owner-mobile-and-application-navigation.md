# Development Owner mobile layout and application discoverability

## Changes

### Partners and shell

The shell's content flex chain previously lacked explicit shrinkable/full-width
constraints, and the header action group was unconditionally non-shrinking.
The Partner table had no deliberate readable minimum column layout. These allow
intrinsic content widths to escape their intended containers. The exact
narrow-strip/black-area symptom was not reproduced in an authenticated browser;
the changes address the identified width-containment defects rather than
claiming a measured before/after reproduction.

- Content column, main, page wrapper, Partner search and table panel now have
  appropriate full-width/min-width-zero constraints.
- Desktop's fixed 260px sidebar and desktop left padding are retained.
- The header group can shrink on phones; the mobile main has reduced padding.
- Partner table uses a deliberate 920px minimum table width inside a bounded,
  horizontally scrollable region. Name/contact/status columns have readable
  minimum sizing; names wrap and emails can break without losing content.
- Partner tabs scroll within their own bounded region.
- Existing resend, revoke, email correction and NFC actions/identifiers are
  unchanged. No global overflow hiding, zoom tricks or viewport scaling added.

### New Users / Applications

Confirmed discoverability defects: no navigation item or dedicated review route
existed, and the embedded home panel was unreachable behind unrelated loading,
error or selected-school return branches.

- Added Owner-only `/account-applications` using the existing review panel.
- Registered New Users / Applications in both navigation and the Owner allowlist.
- Added a visible Owner-home shortcut before the platform dashboard queries, so
  metrics errors/loading or school selection cannot hide the entry point.
- Retained the existing embedded home panel and existing approval workflow.
- Review uses the existing `/api/platform/account-applications` query and
  `account_applications` store. It refreshes on mount/focus, every 30 seconds, via
  its Refresh button, and after decisions.
- Pending/Approved/Rejected filtering, confirmation, required rejection reason,
  applicant details, notification status and error handling remain available.
- Backend global Owner authorization and role restrictions are unchanged;
  School Admin, Partner and pending applicants gain no Owner review access.

## Verification

- 52 focused frontend tests across route registration, actual rendered Owner
  navigation, home shortcut during metrics loading/error, shell/table containment
  class contracts, resend behavior, review loading/error/empty states, all three
  filters, approval refresh and rejection confirmation.
- 32 disposable-PostgreSQL routed application tests passed. Added coverage submits
  both applicant types through the real application endpoint, reads them from the
  Owner list as PENDING, decides approval or rejection and rereads the updated
  list. The existing suite also checks required profile fields, persistence
  through approval, authorization, concurrency and notification behavior.
- API and frontend typechecks and whitespace check passed.
- Web workflow restarted; no backend runtime change required.
- A bounded browser check had no existing approved Owner session. Both home and
  the dedicated Applications route resolved to sign-in. A separate 360px preview
  screenshot confirmed the sign-in screen renders; this is access-gating evidence,
  not a screenshot of the changed Owner layout. No authentication workaround or
  shared-data decision was attempted.

The SQL runner captures schema only and rehearses existing migrations in an
isolated temporary cluster. It does not redo migrations in Development or create
a duplicate application table. No fixture submissions, decisions, role grants
or email sends were performed against shared Development data.

## Verification boundaries

Layout class tests are not browser width measurements. Existing APIs and
component tests establish the intended navigation/list behavior, not an actual
signed-in Owner click-through on a physical phone. Authenticated screenshots,
mobile table scrolling/drawer behavior, desktop visual preservation and a full
signup-to-Owner-review browser journey require an approved Development Owner
session. No real email delivery is established.

No Production queries/changes, Publish configuration, publishing, payments,
secrets or shared-database schema changes.
