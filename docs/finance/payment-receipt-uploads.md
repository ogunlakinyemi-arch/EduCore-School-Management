# Private payment receipts

## Business boundary

Flutterwave remains the online provider. The original receipt-backed settlement
path remains an Owner-confirmed **external/manual transfer**. The separately
gated daily payout workflow can now initiate a documented Flutterwave transfer;
see owner-school-payouts.md. Receipt attachment never initiates one.
An uploaded document is evidence submitted by a person, never bank confirmation.
No financial rates, BRO eligibility, term-end approval or historic allocations
change. Full per-order school settlement remains NGN 1,900; partial/batch payouts
are not introduced by this feature.

### Parent / guardian

The existing bank-transfer form accepts a private JPEG, PNG or PDF in place of
typing a transaction reference. Bank, date, amount and invoice remain required.
Invoice, student, school and academic term are resolved server-side through the
current parent's authorized child relationship. The authenticated uploader,
purpose, declared amount/date, upload time, file digest and storage metadata are
recorded.

The server assigns `RECEIPT_<uuid>` only as an internal submission identity, not
a claimed bank transaction number. A receipt-derived idempotency key prevents
new payment rows on submission retries. Files cannot be attached to another
invoice, amount, date or payer. Same-target/file duplicates reuse the original
authorized uploader's document; conflicting metadata is rejected.

The existing payment remains **PENDING**. Only the existing School Admin /
school Accountant verification route can verify or reject it. That route still
requires independent bank-credit evidence and reviewer notes, retains rejection
reasons, and applies the existing duplicate-credit and allocation safeguards.
Receipt creation/upload/download does not update invoices or allocate money.

### Platform Owner school settlements

Only an active Platform Owner can upload proof for an already verified,
unheld and unsettled manual school liability, or append evidence after an
independently verified successful provider transfer. The Owner must affirm that the transfer
has actually happened, supply its actual date, upload the receipt and confirm
the external transaction reference. Date cannot precede collection or be in
the future; amount must equal the existing liability.

Confirmation derives the SHA-256 from the server's uploaded file metadata and
appends one settlement journal event, including receipt ID, actual date,
external reference, amount, uploader and confirming Owner. Retrying the same
confirmation does not create another settlement; conflicting confirmations fail.
This records the Owner's external-transfer confirmation. It does not independently
verify bank delivery and never moves funds. BRO confirmation remains its original
term-end Owner-controlled path.

## Storage / access

- Only JPEG, PNG and PDF, maximum 5 MiB. Server checks signatures and decodes
  images; image metadata/trailing content are removed. PDFs must parse, have
  1–20 pages and contain no supported detected active-action/embedded-file
  structures. This is not a claim of antivirus scanning.
- Bytes are written only to private App Storage under
  `PRIVATE_OBJECT_DIR/financial-receipts/<uuid>`. Database stores metadata, not
  base64 or document bytes. Overlap with configured public search paths fails.
- No public/signed URL is given to the browser. Authorized download is served
  through `/api/payment-receipts/<uuid>/download`, with no-store, attachment,
  nosniff and a restrictive CSP. Stored digest/size are checked before serving.
- Parent proof: original uploader with a current child relationship, or active
  finance/admin membership in that school. Platform ownership alone does not
  confer access to parent bank documents or school verification authority.
- School-settlement proof: active Platform Owners only.
- Successful upload requests, uploads, duplicate reuse and downloads are audited.
  Attachment/submission, verification and rejection retain existing finance audit
  events; settlement has an append-only journal event linked to its file.
- Uploaded evidence has no replacement/deletion endpoint. A storage write followed
  by an uncertain database outcome can recover the same bytes without overwriting.

## Configuration and release status

The existing private App Storage configuration is reused; no credentials or
bucket settings were changed. The additive `payment_receipt_uploads` metadata
table is declared in the schema source, **not applied**. Existing general
`fee_payments` is reused for pending school-bank submissions; sandbox-only student
subscription tables are not used for LIVE receipt payments.

The earlier hosted manual journal also remains preparatory: its two additive
tables and exact immutable-history guards must be verified before its runtime
will enable. Managed Publish is not assumed to install/preserve custom guards.
No startup DDL, Production migration runner, approval seed or automatic enabling
was added. No SQL rehearsal was performed for this receipt work.

Backend reload and approved schema/storage readiness are prerequisites to
end-to-end use. No workflow restart or publishing was performed. API behavior
was checked using isolated in-memory SQL/storage fixtures, not Production
financial records or a live payment provider.
