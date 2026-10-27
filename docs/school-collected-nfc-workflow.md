# School collection, receipts and student NFC: implementation boundary

## Completed cash/receipt increment

The existing school finance ledger, invoice, receipt, private-upload and
authorization paths are retained. No database migration is needed for this
increment.

- Same-school active School Admins and Accountants can record actual cash.
  Platform ownership alone is not school cash-recording authority.
- Collection records include the actual Nigerian calendar date separately from
  the server's recording/verification timestamps. The date cannot precede invoice
  issuance or be in the future. Legacy callers may omit it.
- Ordinary invoice-balance payments retain the school's partial-payment setting.
  Staff can also select ordinary fee categories in full from the existing line
  balance API. Those selections persist their payment-line allocations under the
  invoice lock, so a subsequent category payment has accurate balances.
- Receipts snapshot school branding, student/admission information, received-from
  details, fee categories, staff identity, reference, collection date, receipt
  number and balance information. Invoice-level credits are explicitly labelled;
  listing a charge does not falsely certify that category as fully paid.
- The existing receipt preview offers printing and browser Save as PDF. School
  receipt requests now include the school scope required by the API.
- The existing idempotency/evidence uniqueness rules remain in force. An exact
  retry returns the existing receipt; a changed payload using its key conflicts.
  Confirmed cash entries are not silently edited or deleted.
- Receipt creation, line allocation, balance update and audit insertion share a
  transaction. Receipt persistence failure rolls them all back.
- Existing family-authorized receipt retrieval remains authoritative; an unrelated
  parent or student cannot retrieve another family's receipt.

Private parent evidence submission/review continues to use the existing private
receipt workflow. This increment does not turn an uploaded document into verified
funds, authorize a school-to-Yetenia transfer, or change card activation.

## Student NFC: reconciliation preview implemented; conversion not applied

The requested prospective policy is NGN 3,200 per student per term, separate from
the school's configurable parent-facing NFC fee. This document is not activation
or migration evidence for that policy.

Existing student obligations/checkouts enforce the earlier NGN 5,000 policy.
Existing unpaid obligations and provider references must not be silently
repriced. The user selected migration of eligible unpaid obligations **after**
reconciliation, with a preview/report and separate review before any apply.
No student price/rule, original payment reference, allocation, subscription,
invoice or card state has been converted.

### Owner report

The existing Hosted payments screen now contains an Owner-only **Student NFC
reconciliation preview**. Select the school and term and explicitly request a
preview. The underlying GET endpoint is
`/api/owner/finance/student-nfc-reconciliation?schoolId=…&termId=…`.

- Authorization requires an active global Platform Owner and active account
  before acquiring a database connection.
- Reads use a single PostgreSQL `REPEATABLE READ READ ONLY` transaction.
  There is no apply endpoint, business-data write, DDL, provider call, notification
  send or card activation.
- The report includes original subscription amounts/outstanding where these can
  be determined safely, separate school-invoice totals/paid/outstanding, original
  references, receipt numbers, classifications/reasons, evidence-source status
  and a deterministic digest bound to the policy version and Nigerian date.
- Sources include legacy student payments/allocations, school fees and receipts,
  checkout claims/webhooks, hosted journals, LIVE intents and discoverable linked
  LIVE history, split adjustments and adverse commission evidence.
- Missing tables/columns, insufficient visibility, row-security-hidden evidence,
  truncation, orphaned subjects, duplicate obligations and scope mismatches make
  the report incomplete or flag the subject for Owner review; absence of readable
  evidence is never treated as an unpaid clean slate.
- Any previous provider attempt, including a locally failed attempt, is held for
  independent provider reconciliation. The report never asserts provider-side
  terminal failure or receipt of bank funds.
- Clearly unattempted, singly bound NGN 5,000 obligations can be listed as
  **candidates after review**, proposing NGN 3,200 without creating a charge.
  New term obligations are separately labelled. Completed history is preserved.
  Legacy parent-facing NFC invoices always require separate review.
- CSV/JSON exports reflect the displayed report. CSV cells neutralize formula
  prefixes, including leading whitespace. Exports are not signed approval tokens.
- Re-preview creates a new query; changing school, term or identity removes the
  previous report. Failed refreshes cannot leave an old report downloadable.

This is a source implementation of the preview stage. No real application-data
report was generated by the agent. Signed-in Owner runtime acceptance has not
been performed, and no managed workflow restart was performed.

### Remaining before conversion/payment

Still required for the student extension:

- Review a real report for a specifically selected and independently verified
  target, then obtain explicit per-scope apply approval. Approval cannot be
  inferred from clicking Preview, exporting data or a candidate label.
- Implement the separately approved apply path with fresh locked reconciliation,
  stable student/term identity, immutable adoption evidence, idempotency and
  applicable schema/guard review. Do not replace global historical price constants.
- Required non-duplicated parent-facing NFC category configuration, term and
  deadline, with explicit no-instalment rules under the new policy.
- Full confirmed parent payment as the prerequisite for a separate
  School-Admin-initiated platform checkout, without school splits/subaccounts.
- An Owner assistance queue and notification; independent bank-receipt evidence
  and verification before assisted checkout.
- Durable verified transfer retention and controlled retries after a definitively
  failed attempt, without duplicating money movement or BRO entitlement.
- Verified-provider-only current-term NFC eligibility, plus the existing card
  registration/device/security gates.
- Policy-specific commission idempotency, callbacks/webhooks, role interfaces
  and executable verification of the new workflow.

Historical NFC lines remain protected from ordinary school-account collection
pending the versioned transition. The separate Teacher/Staff NGN 2,000 direct
Flutterwave policy is unchanged.

## Checks actually executed for the cash/receipt increment

- API code generation and shared-library typecheck: passed.
- API and web-app typechecks: passed.
- 22 cash-route tests against an independently verified private disposable
  PostgreSQL process: passed. These exercise real route SQL, concurrency,
  receipt-failure rollback, authorization, collection dates, line allocations,
  partial payments and family isolation.
- 35 existing finance bank-transfer, private-receipt and money tests: passed.
- 5 cash form tests and 2 existing receipt-preview tests: passed. The latter
  emitted React `act` environment warnings, not test failures.
- Anonymous application screenshot: sign-in screen rendered. This does not prove
  signed-in cash collection, a real provider transaction or physical delivery.

Reproduce the cash SQL fixture from the workspace root:

```sh
NODE_REAL=$(node -p 'process.execPath')
env -i PATH="$PATH" HOME=/tmp LANG=C.UTF-8 NODE_ENV=test \
  "$NODE_REAL" scripts/src/cash-collection-native-check.mjs
```

The controller disables TCP and verifies process, filesystem and SQL target
identity. It stops the private PostgreSQL server and removes its own temporary
directory. The tests use fictional minimal tables, not a full application-schema
migration replay. Notification delivery is mocked; role and tenant checks and
cash/receipt SQL are real.

No application database, Production database, secret, provider transaction,
deployment or publishing was changed/executed. No managed workflow restart was
performed.

## Reconciliation-preview verification

The preview has separate executable policy, read-only route/PostgreSQL and
frontend checks. Native verification uses a new independently identified
disposable, Unix-socket-only PostgreSQL instance. It exercises real catalog
inspection, GET authorization, repeatable read-only SQL, missing-source/schema
holds, linked hosted/LIVE evidence, orphaned history, truncation and row security.
Source data is compared before/after. Fixtures use minimal fictional tables,
not a full application migration replay or actual provider/bank evidence.

```sh
NODE_REAL=$(node -p 'process.execPath')
env -i PATH="$PATH" HOME=/tmp LANG=C.UTF-8 NODE_ENV=test \
  "$NODE_REAL" scripts/src/student-nfc-reconciliation-native-check.mjs
```
