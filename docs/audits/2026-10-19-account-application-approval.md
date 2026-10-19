# Development account registration and Owner approval

## Scope and status

Implemented in Development following explicit approval for additive application
storage. No Production query/migration, Publish configuration change, publishing,
payment logic change, secret change, or live account/role reassignment performed.
Existing Development notification controls remain unchanged.

Public account creation is now the identity step of an application, not an
operational role grant. After verified Clerk account creation, the applicant
completes the School Admin or Partner application. Submission persists PENDING.
Creating a Clerk identity alone never grants a portal role.

## Exact schema change

Applied only `lib/db/drizzle/0169_account_applications.sql` to the independently
verified Development target. It creates one table, `account_applications`,
its serial sequence, primary-key index and three secondary indexes. There are
no ALTER, UPDATE, DELETE or DROP statements and no existing-table data rewrite.
No migration runner, startup DDL or publishing hook was added.

All 21 columns:

| Column | Type / nullability / default |
|---|---|
| id | serial primary key |
| user_id | integer NOT NULL, FK app_users |
| applicant_type | text NOT NULL |
| first_name | text NOT NULL |
| last_name | text NOT NULL |
| email | text NOT NULL |
| phone | text NOT NULL |
| school_name | text nullable |
| business_name | text nullable |
| city | text NOT NULL |
| state | text NOT NULL |
| address | text nullable |
| referral_link_id | integer nullable, FK partner_referral_links |
| status | text NOT NULL DEFAULT 'PENDING' |
| created_at | timestamptz NOT NULL DEFAULT now() |
| reviewed_at | timestamptz nullable |
| reviewed_by | integer nullable, FK app_users |
| rejection_reason | text nullable |
| school_id | integer nullable, FK schools |
| partner_profile_id | integer nullable, FK partner_profiles |
| notification_status | text NOT NULL DEFAULT 'NOT_REQUESTED' |

Secondary indexes:

- Unique `user_id`: one immutable review lifecycle per account.
- Unique `lower(email)`: no parallel applications for the same verified address.
- `(status, created_at)`: review directory.

Five CHECK constraints:

- Applicant type only SCHOOL_ADMIN or PARTNER.
- Status only PENDING, APPROVED or REJECTED.
- Notification status only NOT_REQUESTED, SENDING, ACCEPTED, FAILED, UNKNOWN
  or UNAVAILABLE.
- School applicants require a nonempty school name of at least two characters.
- Pending records have no reviewer, decision timestamp, rejection reason or
  activated resource. Rejected records require reviewer, timestamp and reason,
  with no activated resource. Approved records require reviewer/timestamp and
  exactly the resource appropriate to the applicant type, with no rejection
  reason.

Catalog verification after apply: 21 columns, five foreign keys, five CHECKs,
four indexes including the primary key. Zero live application records existed
at verification; all mutation acceptance fixtures ran in a disposable database.

## Backend behavior

- The authenticated application API accepts only the two fixed applicant types,
  validates details and derives email from the verified primary Clerk address.
  Client identity, decision/status and arbitrary role fields are rejected.
- Existing memberships or linked person/Partner/company profiles cannot be
  converted through public application submission. No existing role/status is
  rewritten by the migration or approval flow.
- Application and user row locks serialize duplicate submissions and decisions.
  Repeat/conflicting decisions return 409 without another grant or email.
- Only a current global Platform Owner can decide. Self-review is prohibited.
- Approval creates a new active school and SCHOOL_ADMIN membership, or an active
  Partner profile/profile-user and PARTNER membership. School referral
  attribution is validated and retained only at approval.
- Rejection records its reason, reviewer and time, but creates no school,
  Partner profile or operational membership.
- Authentication reloads application eligibility on subsequent requests. Pending
  and rejected applications expose no roles and cannot access operational APIs,
  even if a role was independently inserted. The authorized-context handler
  also skips invitation activation for such applicants.
- Public legacy referral onboarding now requires Owner authentication and
  authorization before any school creation or invitation dispatch. Public
  referral links enter the application UI instead. Existing Owner-led school
  creation and genuine invited-user activation remain separate supported flows.
- Submission, decision and notification outcome use the existing audit log.
  Responses for application endpoints are private/no-store.

## User interface

- Public signup offers only School Admin and Partner; genuine invitation-ticket
  signup retains its existing acceptance route.
- The selected type and explicit Owner-approval requirement remain above the
  Clerk signup form. Applicants can change the selected type.
- `/apply` provides completion, pending, rejected-with-reason and approved states.
  Approved navigation refreshes server authorization before opening the portal.
- The Owner dashboard includes New Users / Applications, status filters,
  contact/school details, reviewer/time/rejection reason, confirmation actions,
  required rejection reason, refresh/error states and email outcome.
- Existing login portal options remain intact.

## Email behavior and limitation

Decision notifications reuse the existing Resend/HTTP email adapters and
Development recipient restrictions. Both approved applicant types receive copy
confirming approval and that they can now log in; rejection copy includes the
recorded reason.

The send claim is persisted after the decision commits. Provider acceptance is
reported as ACCEPTED, not delivery. Failed/uncertain/unavailable sends remain
visible without revoking approval or automatically sending again. A process
interrupted during SENDING requires review, not an automatic resend.

Development's existing controlled notification/worker pause remains enabled.
Suppressed/simulated providers are recorded as UNAVAILABLE, never as real email
delivery. No provider settings or secrets were changed, and no real email was
sent or inbox receipt verified.

## Verification

- OpenAPI/codegen and shared-library TypeScript build passed.
- 21 focused frontend tests passed: responsive shell/chooser, signup approval
  notice, application request payload, pending/rejected/approved controls,
  authorization refresh, Owner decision confirmation/reason, email wording,
  existing dashboard branches and session retention.
- 16 focused API authorization/context tests passed, including preventing
  invitation activation for pending/rejected applications.
- 2 focused legacy referral-onboarding tests passed; 57 unrelated tests in that
  file were deliberately excluded by the test-name filter.
- 18 isolated PostgreSQL tests passed against a read-only capture of the current
  Development schema, excluding the new table before replay. Covered both
  applicant approvals, rejection, verification and role tampering, existing
  membership preservation, concurrent submissions/decisions, operational denial,
  real constraints/transactions, referral attribution, provider mocks,
  uncertain-send safety and suppressed-provider reporting.
- Migration replay and intentional duplicate-apply rejection passed. The
  isolated runner cleans up its temporary PostgreSQL cluster.
- Frontend and API typechecks passed. API build and both managed workflows
  started cleanly. Whitespace check passed.
- Anonymous live Development calls to applicant status, Owner application list
  and legacy onboarding returned 401.
- A bounded browser pass measured document width equal to viewport at 320px and
  360px, confirmed the two signup choices, retained login portal choices,
  referral redirect, signed-out `/apply` denial, and desktop two-column layout.
- That pass identified lost approval messaging after choosing a type. The
  messaging was fixed, covered by focused tests, and confirmed by a fresh 320px
  full-page screenshot with real Clerk signup controls.
- No fatal browser errors observed. Clerk development-key/structural-CSS and
  autocomplete warnings remain; React DOM tests emit act-environment warnings.

## Not verified

No existing authorized browser session was available. A real applicant's
completed Clerk signup, live Development application submission, authenticated
Owner review, resulting live portal login and email inbox delivery were not
exercised. The routed SQL and component tests do not substitute for that live
end-to-end acceptance. No physical Android device was used.
