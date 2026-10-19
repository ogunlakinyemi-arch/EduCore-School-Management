# Development passport-photo completion and NFC rendering

## Delivered

- Existing and imported students now have a dedicated Passport photo action in
  the student directory, independent of editing class/admission data. Existing
  edit and after-admission uploads remain available.
- Existing teachers and non-teaching employees now have Passport photo actions
  in their directory and an upload/replace control in Edit. These persist only
  private managed object references in the existing `employees.photo` field.
- Both directories offer Photo missing / needs private upload filters across
  all statuses. A legacy/unmanaged public reference counts as needing a private
  upload; it is not fetched or rewritten automatically.
- Student/Teacher/Staff import results now link to the matching photo-completion
  list and explain per-person uploads. Parent import has no photo-upload link.
  Existing whitelist-based imports do not support embedded images or photo URL
  columns, and no such mapping was added. Missing photos never block imports.
- Employee endpoints reuse the existing student private-photo implementation
  through a fixed student/employee router factory. Signed upload targets last
  180 seconds. Confirmation checks 3 MB maximum, MIME/magic-byte agreement,
  full image decoding, bounded dimensions/pixels and person/school path scope.
  Student endpoint behavior and authorization remain covered by existing tests.
- Only the matching School Admin can change photos. Owner is read-only, including
  mixed Owner/Admin identities. Employee image reads allow Owner, same-school
  Admin, or the matching employee through an active applicable school role.
  Private reads return no-store and nosniff headers. No public serving route
  or public image URL is introduced.
- Student edit/details/e-ID views and the employee NFC profile translate saved
  managed references to protected image endpoints rather than raw object paths.
  Unmanaged photo URLs display a neutral missing-photo state instead of causing
  external image fetches. Historical stored values are not changed.

## Actual ID production connection

The existing official NFC renderer already selected `students.photo` or
`employees.photo` for the current assigned person, validated the exact
school/person private path, and embedded decoded images in the PDF. No card
assignment, activation, payment, print permission or lifecycle change was needed.
The same renderer supplies official raster previews.

New routed tests assert the precise student/Teacher/Staff photo reference passed
to the image loader and the real PDF renderer's `/PersonPhoto` image embedding.
Those tests mock the storage loader; they do not establish that a particular
school's bucket or real saved image can currently be read. Existing image-scope
tests reject external and cross-person paths. Absent/unreadable optional images
use the existing renderer placeholder rather than blocking card production.

The Student Directory name/details action still opens its existing student
details/e-ID preview; no new standalone profile route was invented.

## Verification

- 31 focused frontend tests passed across source authorization/normalization,
  directory/forms, simulated upload/confirm requests, and e-ID freshness.
- 72 focused API tests passed across student/employee photos, existing managed
  contracts, image scoping and official printable routes/PDF output.
- OpenAPI codegen, shared-library checks, API and frontend typechecks passed.
- Initial e-ID test failures were stale label and legacy-image expectations;
  fixtures now use valid managed UUIDs, and legacy images expect no external
  fetch. The corrected targeted tests pass.
- Frontend DOM tests emit existing React act/test-prop harness warnings; these
  are not authenticated browser acceptance or a physical NFC test.
- No real record was imported/edited, no real image was uploaded or printed,
  and no application database query/migration was executed for verification.

No parent uploads, schema changes, migrations, payment/subscription changes,
secrets, Production operations, deployment/Publish changes or publishing.
