# Direct student LIVE preparation — not released

The prepared student platform charge is **NGN 3,200 per student per academic
term, wholly to Yetenia**. It is not the school's configurable parent-facing
NFC Card & EduCore Subscription Fee. Staff NGN 2,000 billing and separately
governed BRO commission are unchanged.

## Development boundaries

The Owner's old school-subaccount oversight tab is replaced by a **read-only**
school-fee collection view. It uses invoice-line snapshots and confirmed
line-level allocations, shows missing current-term fee configuration as
`NOT_CONFIGURED` rather than zero or paid, distinguishes pending evidence from
verified payment, and marks uncertain refund/waiver/mixed-allocation cases
`REVIEW_REQUIRED`. It excludes receipt file paths, proof URLs, parent contacts
and bank account data. Existing School Admin/accountant payment review remains
the authority; Owner oversight does not mutate school collection.

Old LIVE subaccount request endpoints are archived. Previous school bank-profile
PUTs for independent school financial operations remain subject to their
existing authorization; they do not request or create subaccounts. Historical
split/subaccount/payment/settlement records and callbacks remain retained.

The separate direct LIVE path has a dedicated reference namespace and append-only
review/obligation/event records. Each attempt permanently claims its original
reference before a provider POST. A lost response is **not** retried as a new
payment. Provider verification must independently match transaction ID,
reference, status, currency, NGN 3,200 gross and charged amounts. Failed/cancelled
attempts are retryable only after the provider explicitly reports zero charged
amount. The same bank assistance record remains attached across attempts; a
second transfer is not required. Neither a pending receipt nor the Owner's
bank-credit attestation counts as a platform payment. Direct status becomes
verified only after provider verification.

The direct checkout payload has no subaccounts or split fields. School share and
BRO share are constrained to zero in its prepared schema. This **does not** prove
that the merchant's actual LIVE Flutterwave configuration will settle without
provider-side routing: independent merchant evidence is still required.

## Release blockers

The additive migration `0176_direct_student_live_preparation.sql` is **not
applied** to Development or Production by this change. There is no backfill,
old NGN 5,000 conversion, repricing, deletion or provider transaction.
Production configuration/secrets are untouched. Direct checkout remains
disabled unless all independently hold:

1. Server-side production LIVE configuration, a separately reviewed direct
   release approval and approved HTTPS callback. No TEST credentials are
   accepted as LIVE.
2. A current effective-dated, active NGN 3,200 Student rule with zero school
   share. A draft or intended price is not enough. The Owner governance area
   currently blocks Student activation pending its separately approved
   transition; this work does **not** remove that safeguard.
3. A complete, fresh read-only reconciliation report for the actual school and
   term and an explicit, unexpired matching Owner review with a confirmed
   non-split merchant scope. Students with legacy pending/completed obligations
   require **separate transition review**; they cannot be issued a second
   charge under the "new obligation" path.
4. For the assisted path only: independently verified **actual** bank credit
   with exact amount, date and reference on the existing request, not a claim,
   uploaded receipt or provider checkout link.

Current Development readiness therefore returns blocked before accessing
Flutterwave. Never set a release flag, apply the additive schema to a real
database, publish or use a LIVE merchant without separate target verification,
actual school/term reconciliation, authorization and provider-side non-split
settlement evidence.

Tests run against a credential-free, Unix-socket-only disposable PostgreSQL
fixture, and a synthetic in-memory provider. A fixture can simulate a future
approved rule and merchant response; it cannot establish real bank credit,
actual LIVE webhook delivery, provider fees, merchant routing, production
schema readiness, card-reader behavior or a signed-in Owner browser view.
