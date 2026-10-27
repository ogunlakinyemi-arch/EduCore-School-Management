# Archived payment workflows and student platform access

## Records are retained

Existing test records are being repurposed as real records. This change does
not modify application database data, run a migration, convert subscriptions,
reprice balances, delete records, or initiate provider transactions.

School/Partner split recipients, subaccount IDs, split settings and payment
allocation snapshots remain in their existing tables. Hosted checkout orders,
events, references, receipts, settlement records, BRO ledgers and audits also
remain. Removing these rows or tables would break receipt provenance,
verification/replay protection, foreign-key relationships and historical
reporting. Old allocations remain historical facts; they are not rewritten as
zero-school-share payments.

## Product retirement

- Split Settlements and Hosted Payments are removed from active navigation.
  Their previous web routes show an archive notice, not the old components.
- The server returns uncached HTTP 410 for hosted-payment operations, split
  workflows, school subaccount onboarding/configuration, legacy student
  checkout/payment-link creation and old assisted-request creation.
- The old split simulation route is archived.
- Automatic NFC subscription provisioning now reads existing student/term
  bindings only. It cannot create another legacy NGN 5,000 school-split
  subscription or silently bind/reclassify an unreviewed historical invoice.
- Separately authorized historical verification, receipts and raw provider
  callbacks are retained. No callback, cancellation or provider call was
  triggered during this work. Already-issued provider links outside the app
  were not revoked; doing so would require a separately authorized provider
  operation. The app no longer offers those links as active checkout actions.

Teacher/Staff NGN 2,000 platform-only billing and separate BRO entitlement
records are retained. Parent-to-school fee collection and private pending
receipt evidence are separate from the student's platform obligation.

## Student enforcement

The server resolves the student from the authenticated user, never a supplied
student ID. It requires an unambiguous active current academic term and a
successful, reconciled provider payment bound to the same school, student,
term and subscription. Legacy sandbox evidence is considered only in its
existing non-LIVE context; it is not promoted into LIVE payment evidence.
Existing LIVE coverage readers keep their own verified-target and evidence
requirements. Historical verified hosted coverage remains read-only evidence,
not a new checkout engine.

An active/verified subscription flag alone, a waiver, school cash, parent
payment, receipt upload, transfer claim, pending/failed transaction or wrong
student/term payment cannot establish coverage. A genuine historic verified
payment retains its original amount; no automatic NGN 3,200 conversion occurs.
The existing independent Owner school lock remains authoritative.

Protected core functionality includes student academics, assignments,
assessments, exam records/results, timetable, own attendance, reporting and
library access. The UI withholds core contents while status is loading,
unavailable or restricted. It polls/refetches fresh evidence and restores
rendering only after the server confirms coverage.

Sign-in, account, My Subscription status/instructions, school fees and receipt
evidence, inbox/help, notification preferences, calendar and essential
welfare/transport access remain available subject to their existing
authorization. NFC attendance/activation uses the stricter payment prerequisite
alongside existing card, UID, school and device security checks. Neither a
payment nor this access check creates or activates a card.

The separate school-configured parent-facing NFC fee must be paid in full;
receipts remain pending school evidence, not proof of the school's platform
payment. New intended NGN 3,200 platform rules remain inactive until the
existing reconciliation and explicit activation/transition approvals are
completed. Owner Subscription & Payment Rules remains the governance area.
No actual school/term report was approved and no conversion was performed.

## Verification boundary

Tests exercise real SQL against a fresh, credential-free, Unix-socket-only
disposable PostgreSQL fixture, with fictional rows only. They cover matching
student/school/term evidence, false payment claims, restoration, role
restrictions, manual school locks and preservation of historical amounts.
Separate tests check retired endpoint interception before downstream handlers,
read-only obligation lookup, UI loading/error denial, essential access and
restoration, retained Owner rules, staff allocation and reconciliation policy.
They do not prove physical NFC hardware behavior or live provider processing.
