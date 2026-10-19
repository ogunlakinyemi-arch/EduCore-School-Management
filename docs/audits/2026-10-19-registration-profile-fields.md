# Development integrated registration profiles

Later same-day correction: School Admin applicants must explicitly enter a
required email before authentication. The email-origin description below records
the earlier implementation; see `2026-10-19-school-admin-application-email.md`
for the corrected validation, persistence and verification.

## Delivered

Public signup now collects the requested profile before the existing Clerk
signup widget. Submit Application validates and saves a short-lived browser
draft; Clerk email/password or Google authentication then completes account
verification. The `/apply?submit=1` return submits the validated draft once.
Neither the profile step nor Clerk account creation grants an operational role.
Submission persists PENDING; only an Owner decision grants access.

Both the direct `/apply` route and the roleless protected-entry route handle the
authentication-completion flag. Errors keep the form editable and refetch status
to recover a successful submission whose response was lost. Duplicate
submissions/decisions retain the existing database locks and unique constraints.
Genuine invitation signup and existing login roles/session-switch behavior stay
separate.

## Fields and persistence through approval

| Applicant / field | Application storage | Approved operational record |
|---|---|---|
| School Name, required | school_name | schools.name |
| School Address, optional | address | schools.address |
| School Admin Full Name, required | first_name / last_name; fullName derived for the API | app_users.first_name / last_name |
| School Admin Phone Number, required | phone, normalized | app_users.phone and schools.phone |
| School account email, from verified Clerk identity | email | schools.email; existing verified app_users identity retained |
| Partner Full Name, required | first_name / last_name | partner_profiles.full_name and app_users names |
| Partner Email, required | normalized email, must equal verified Clerk identity | partner_profiles.email |
| Partner Phone Number, required | normalized phone | partner_profiles.phone and app_users.phone |
| Business Name, optional | business_name | partner_profiles.business_name |
| Partner Type, required | partner_type | partner_profiles.type: BUSINESS or INDIVIDUAL |

Business and Individual are the existing signup/Owner-invitation choices; the
new flow no longer hardcodes RESELLER for newly typed applications. Existing
untyped legacy applications retain their earlier approval behavior, and no
existing Partner profile is reclassified.

City/state are no longer required on the new registration forms. Their existing
columns and historical values remain intact; omitted values on new applications
are stored as empty optional text, not invented locations.

## Validation and draft safety

- Both sides enforce applicant-specific required fields and supported Partner
  types; School applications cannot carry Partner type/business details.
- Names are trimmed and whitespace-normalized; a full name is stored without
  inventing a surname for single-name applicants.
- Emails are trimmed, lowercased and validated. A Partner form email different
  from the verified Clerk primary address gets an actionable 409 before a record
  is inserted. Approval also rejects an application whose account email changed.
- Phone input accepts international `+`/`00` formats and Nigerian mobile format.
  Separators are removed and Nigerian numbers become +234; the stored result
  must match the international digit-length/range rule. This is syntax validation,
  not proof that a phone is reachable.
- The browser draft expires after 30 minutes and is cleared after submission.
  It contains no password or authentication credential. Browser-storage failure
  blocks the handoff with an explanation instead of losing required details.
- Changing applicant type discards incompatible fields. School referral intent
  is retained through the typed signup link and takes precedence over an older
  draft's referral.
- Existing post-commit approval/rejection notifications and uncertain-send
  safeguards remain unchanged.

## Approved schema change

Applied only `lib/db/drizzle/0170_account_application_partner_type.sql` after the
user explicitly approved it. The actual application connection and independent
Development SQL connection agreed on the Development database identity before
apply; the transaction also checked that exact identity.

The migration adds nullable text `account_applications.partner_type` and one CHECK:

    partner_type IS NULL OR
    (applicant_type='PARTNER' AND partner_type IN ('BUSINESS','INDIVIDUAL'))

No default, existing-row update, role grant, table replacement or other
existing-column change was applied. The application table has 22 columns
afterward. It contained zero application rows before and after the migration.
The new required-type rule for new submissions is enforced in the API; allowing
NULL in the database preserves historical rows.

## Verification

- Contract/code generation and shared-library TypeScript build passed.
- 28 disposable-PostgreSQL routed application tests passed, including all
  applicant-specific required fields, phone/email normalization, mismatched
  verified email, invalid/mixed types, both Partner type approvals, school
  address/contact persistence, pending/rejected denial, concurrency, immutable
  decisions and notification outcomes.
- Migration rehearsal ran against a schema-only Development snapshot in a
  disposable `/tmp` cluster. No live rows were copied and no fixture writes
  targeted the shared Development database.
- 16 authorization/context tests passed.
- 26 focused frontend tests cover profile fields, validation and Clerk handoff,
  draft expiry, one-time submission, lost-response recovery, pending/rejected
  UI, approved authorization refresh, Owner review and existing session policy.
- Frontend and API typechecks passed. Both managed workflows restarted cleanly.
- One bounded real-browser pass covered both applicant types at 320px and 360px.
  Each form's document width matched the viewport, with no clipped controls.
  Empty submissions produced errors without signup/application requests.
  Valid profiles reached the real Clerk widget; Partner email was prefilled;
  email/password and Google remained available. Edit restored entered details.
  Exactly one Sign in link appeared on the profile and widget stages.
- No fatal browser errors. Existing non-blocking Clerk development-key and
  structural-CSS warnings remain.

## Limits and preserved scope

The browser stopped at the authentication widget: no real account was created,
credentials submitted, Google flow completed, application/Owner decision made,
or email sent. Authenticated browser submission, live Owner review/portal entry,
and inbox delivery remain unverified; disposable database and component tests
do not substitute for that evidence.

Development only. No Production query/migration, Publish configuration change,
publishing, payments change or secrets/provider configuration change. No
existing school, Partner, invitation or account-role records were rewritten.
