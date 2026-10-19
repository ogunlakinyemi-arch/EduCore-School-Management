# Focused Records, employment access and passport-photo follow-up

## Delivered

- School Admin employee rows now expose confirmed Deactivate (ACTIVE → INACTIVE)
  and Reactivate (INACTIVE → ACTIVE) actions through the existing status endpoint.
  Suspended, resigned and terminated employees do not get one-click reactivation.
- Removed the misleading employment-status selector from ordinary profile edits:
  that endpoint ignores status. Profile editing remains separate from the
  confirmed status action. List caches refresh after successful changes.
- Existing status API keeps school matching, School Admin operational
  authorization and `EMPLOYEE_STATUS_CHANGED` auditing. Existing live
  authorization excludes matching inactive Teacher/Staff employment memberships.
  No identity sessions, independent family/other-school memberships, assignments
  or historical records are deleted or rewritten.
- Added `/records` navigation for School Admin and Platform Owner, linking the
  existing Student, Parent and combined Teacher/Staff directories. No duplicate
  data source. Owner employee-directory access now uses the existing read-only
  guard, consistent with the existing parent/student directory guards.
- Student name selection and View details / e-ID card open the existing protected
  student e-ID/details preview, not an invented profile route.
- Student admission now stays open after a successful create and offers the
  existing private photo control for the returned student ID, with Done/skip.
  Edit retains its existing uploader. JPEG/PNG/WebP, 3 MB, byte/dimension checks,
  protected reads and signed upload/confirmation authorization are unchanged.

## Parent/guardian photo blocker — not implemented

The current parent model has no persisted photo reference and no corresponding
managed parent-photo API. A student's photo cannot safely substitute.

The smallest proposed database addition is one nullable text object-reference
column on `parents` (for example `photo_object_path`), with existing rows left
NULL and no historical rewrite. This alone is insufficient: it also needs a
parent-ID/school-scoped signed upload/confirmation and private read API, file
validation, contract updates and create-after-save/edit controls following the
student pattern. Store only a private object reference, never image bytes,
temporary signed URLs or arbitrary public image URLs.

No migration file, schema declaration or database change was made or authorized.

## Verification and limits

- Focused frontend suites: 20 passing tests across form/action rendering and
  mutation arguments, Owner navigation, Records links and student photo-step
  rendering. Records SSR uses a mocked router link; real route permissions are
  provided by the existing RoleGuard configuration.
- Focused backend suites: 28 passing tests across people boundaries/status and
  existing auth tests. Status checks cover tenant-scoped update parameters,
  audit invocation, invalid status and Owner/other-school/Teacher denials.
- Frontend typecheck and diff whitespace check passed.
- No backend runtime code or API contract changed. No API rebuild was needed.
- Web workflow restarted once and Vite came up cleanly. `/records` correctly
  rendered sign-in in the unauthenticated screenshot, with no fatal browser
  error. It does not prove authenticated layout or actual private-photo upload.
- No real employee was disabled/reactivated, no student was admitted and no file
  was uploaded. Tests used mocked data, not application-database writes.
- GitHub main was freshly fetched for reference. Relevant existing local
  differences were preserved; no push occurred.

No broad audit, application SQL, migration, secrets, Flutterwave/subscription,
report filters/exports, academic history/promotion, Production or Publish changes.
