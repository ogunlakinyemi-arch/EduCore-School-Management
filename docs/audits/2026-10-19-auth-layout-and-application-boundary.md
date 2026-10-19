# Authentication layout and application workflow boundary

Historical boundary report: the user subsequently authorized Development-only
additive storage. See
[the completed workflow report](2026-10-19-account-application-approval.md)
for the implemented scope, exact schema change and current verification.

## Delivered in Development

- Authentication shell has zero-minimum responsive grid tracks and constrained
  widths; narrow screens use reduced spacing.
- Scoped Clerk styles constrain cards/inputs, stack provider buttons and wrap
  footer/error text on mobile, rather than hiding page overflow.
- Portal choices and authentication/session behavior are unchanged.
- Real unauthenticated preview screenshots show the initial sign-in and sign-up
  forms fitting 320px width, and the desktop sign-in retaining its two-column
  layout at 1440px.
- 7 focused frontend tests and 14 existing API authorization/context tests pass.
  Frontend and API TypeScript checks pass. Whitespace check passes.
- Initial test script invocations with an extra `--` unintentionally selected
  the broad suites. Frontend: 786 passed and two new-test failures caused by a
  named/default import mismatch, since fixed. API: 2249 passed, 9 failed,
  206 skipped; this is not a passing full-suite result. Database-dependent
  failures included connection refusal to the isolated test port. Corrected
  `exec vitest run <files>` invocations selected only the intended suites.

## Stopped before schema changes

The requested School Admin/Partner application workflow is NOT implemented.
Public signup, existing referral onboarding and existing access checks remain
as before. No claim is made that the requested approval gate is now enforced.

Existing app_users and school_memberships represent identities and authorization,
not reviewable applications. Partner profiles/invitations and school referral
onboarding are already used by existing operational flows. In particular, referral
onboarding creates a pending school and dispatches an Admin invitation; it is not
the requested Owner-reviewed application system. Student admissions applications
are a different tenant-scoped domain and must not be reused for platform applicants.

A minimal additive platform account-application table is recommended:
verified applicant identity, fixed SCHOOL_ADMIN/PARTNER type, submitted contact/
school details, PENDING/APPROVED/REJECTED status, submission/review timestamps,
reviewer identity, rejection reason and resulting school/partner references.
Use existing audit infrastructure for transitions and email infrastructure for
decision notifications. Do not repurpose audit logs as the mutable application
store or change existing users' statuses/roles.

After schema approval, implement submission and Owner-only, transactionally
locked decisions; create operational memberships only on approval, guard every
activation path (including referral invitations), preserve existing invited-user
flows, add the Owner review UI and explicit applicant pending/rejected states,
and track notification acceptance/failure without rolling back committed
approval or automatically resending after an uncertain provider response.

Existing email adapters include Resend and configured HTTP email. Their presence
does not prove sender readiness or inbox delivery. Development recipients are
restricted. No email was sent and no provider configuration or secret was read
or changed.

## Limits and preservation

- No migration/schema change, application database query/write, user/role change,
  payment change, secrets change, Production operation, Publish configuration
  change or publishing performed.
- Existing Replit source compared with freshly fetched GitHub main for relevant
  authentication files; Replit-only work preserved; no push.
- No real Android-device interaction, completed sign-in/signup, authenticated
  Owner approval, or email delivery verified.
- Clerk warns about structural CSS selectors depending on its component DOM.
  No dependency change was introduced; future Clerk UI upgrades should recheck
  these mobile layouts.
