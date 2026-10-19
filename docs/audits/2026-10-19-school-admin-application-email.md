# Required School Admin application email — Development

The public School Admin form now includes a clearly labelled required email
input before authentication. Partner email remains required. Both frontend and
API reject missing, blank or malformed emails and normalize surrounding spaces
and casing.

The submitted email must match the authenticated Clerk user's verified primary
email. A different email returns an actionable 409 without creating an application
or membership. The entered email is stored in the existing application email
column against that account's user ID; no inferred email or migration is used.
The existing Clerk signup prefill uses the applicant's entered email.

Old School drafts without email cannot auto-submit; the user must enter it.
Pending approval, existing duplicate protections and authorization are preserved.
The Owner's existing review panel displays the saved email. Approval retains it
on the school record and existing notification behavior is unchanged.

## Verified

- 25 focused frontend tests passed: required/invalid School email, draft/edit
  retention, Clerk email prefill props, normalized submission, legacy draft
  protection, Partner form requirements and Owner email rendering.
- 35 disposable-PostgreSQL application tests passed: both types reject omitted,
  blank, malformed and mismatched emails without application/membership writes;
  normalized School email is persisted with the submitting account, returned by
  Owner listing and retained after approval.
- Contract generation/shared-library build and frontend/API typechecks passed.
- Both web/API workflows restarted and are running.
- A 360px full-page screenshot confirms the new field and complete form render
  without clipped controls.

These persistence and Owner-visibility checks used isolated database and
component tests, not a real signup followed by authenticated Owner browser review.
No real accounts, shared Development applications or provider emails were created.
No schema migration, Production, Publish, payment or secrets changes; not published.
