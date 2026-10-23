# Dashboard responsive/overlay audit

## Scope and safety

Development-only presentation work. No Production changes, migrations, secret
changes, payment activation or notification sends. Existing form/save handlers,
authorization, attendance governance and payment safeguards remain authoritative.

## Shared fixes

- `.fade-up` previously retained a transform after animating, containing fixed
  descendants. It now uses backwards fill without retaining that transform.
- Legacy `Modal` now uses the existing Radix `ViewportFormDialog`: body portal,
  focus trap/restoration, Escape, background scroll lock, viewport sizing and
  internal scrolling. Draft-safe non-dismissal on backdrop is retained.
- Dialog/alert-dialog use dynamic viewport height and horizontal gutters;
  sheet/drawer scroll within viewport caps; popover/dropdown cap available height.
- Shared page headings stack actions until larger screens and allow wrapping.
- The mobile sidebar fits narrow/short viewports, scrolls, locks background
  scrolling, contains keyboard focus and closes on Escape, backdrop, navigation
  or desktop resize. Authorization loading no longer changes shell hook order.
- Document tables scroll within their screen box; print CSS is unchanged.
- Library book detail now uses the shared modal rather than a fixed inline
  overlay. It uses the common max-w-lg width instead of its former max-w-2xl.
- Inline nav groups, fee-notification disclosures and toasts are not reclassified
  as modal forms or relocated into dialogs.

## Attendance → Schedule

- Active School Admins get an Attendance-group Schedule link and a direct
  `/attendance/schedule` route, independent of attendance-summary loading.
- The selected school is checked again before the form mounts; inactive,
  wrong-school, other-role and dual-role Owner cases do not mount editable UI.
- Closing and missing-tag-out review times come first, with weekday/Friday
  controls. Exemption rows and footer actions wrap on narrower screens.
- Existing schedule hooks, GET/PUT routes, required reasons, revision conflict
  checks and append-only audit snapshots are reused; no parallel storage.
- An Admin who also has Teacher membership is no longer forced into the
  teacher-only attendance view. Missing tag-out still means review, not proof
  of physical absence.

## Role/page source audit

Source searches covered Owner/Admin/Teacher dashboards, Parent/Student family
pages, Partner pages, school finance/Accountant, Company Accountant, Driver,
Device Activation Officer and Staff/librarian paths. This includes both shared
shell routes and the existing dedicated Parent/Partner portal layouts; it does
not assert that every role uses the same root layout.

Partner, payroll, reporting, transport, security, company-accountant, promotion,
curriculum, exam-record and imports tables already have local overflow wrappers.
Remaining fixed-layer hits are the intentional sidebar scrim, notification
disclosure, finance toast and UI primitives. No unrelated role workflow was
rewritten.

## Verification and evidence boundary

- Focused DOM/source tests cover navigation, tenant access, schedule closing-time
  submission/reload, revision/error states, portal placement, Escape/focus,
  mobile-menu lifecycle and shell containment.
- In-memory HTTP tests exercise the real existing schedule router, validation
  and tenant-operation guards with PostgreSQL and authentication transport
  replaced; they test GET/PUT/reload, stale revisions and denied roles/tenants.
  They do not prove persistence in an environment database.
- Verification passed: 39 focused frontend checks across seven test files,
  31 API/service checks across two files, frontend and API typechecks, frontend
  build and `git diff --check`. The changed-test subsets were rerun after their
  final edits; previously passing unchanged checks were not repeated.
- The build reports a large application bundle warning; no bundling refactor.
  The managed frontend workflow was restarted once and came up cleanly.
- Genuine authenticated browser verification was blocked by the lack of an
  approved Development session. The browser reached sign-in without mutations;
  see `dashboard-browser-check.md`. The mobile sign-in page was also inspected
  at 360×740. This is not dashboard visual evidence.
- Signed-in role-by-role desktop/mobile screenshots, touch/physical keyboard
  checks, select/popover edge collision and real Admin save/reload remain
  unverified. None is inferred from source, DOM or mocked API checks.
