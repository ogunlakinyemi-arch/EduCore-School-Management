# Strict local Development payment diagnostic

## Disposition

Implemented, not used to look up application data. The existing execution guard
reported `PRODUCTION_EXECUTION_REFUSED`; the independent binding file is absent.
No diagnostic lookup or application-data query was executed. Do not remove
deployment flags, create self-attested evidence from the candidate connection,
or use the diagnostic to work around that refusal.

The screenshot supplies candidate exact app reference
`SCV2_fee_f84ba48e6b8e42959901f2c4eaa9e4e4` and Flutterwave reference
`0081341457511792393470202`. The candidate app value may still be truncated.
Payment status, saved plan, allocations/receipt, webhook outcome and recipient
settlement records remain unverified.

## Contract and boundary

`GET /api/dev/payment-diagnostic?txRef=EXACT_APP_REFERENCE`

Alternatively `?flutterwaveReference=EXACT_FLW_REF`. Exactly one parameter;
no school override, wildcard, prefix, pagination or arbitrary SQL input.
This pipeline does not persist `flw_ref`. That selector explicitly returns
`LOOKUP_UNAVAILABLE / FLUTTERWAVE_REFERENCE_NOT_PERSISTED`, never a fabricated
mapping or a misleading NOT_FOUND. Provider transaction ID is not flw_ref.
Adding historical flw_ref mapping would require independent durable evidence,
not guessing, replaying a webhook, or rewriting existing payment history.

Mount precedes normal identity-provisioning/eligibility middleware.
Clerk request authentication is inspected without provider calls; an active app
user and active GLOBAL Platform Owner membership are checked via SELECT only.
Restricted internal officer/accountant identities are denied. School-only roles
are denied. No Owner school-operation permissions are added.

Environment must be Development, with neither deployment key present (even an
empty value is refused), and no Production environment label.
Every request needs fresh independent binding before connecting. The pinned
REPEATABLE READ / READ ONLY transaction compares database/cluster/restart/role
identity before querying authorization or financial records. Statement and lock
timeouts bound reads. Exact parameterized base-table lookup is limited to one
Flutterwave SANDBOX payment. Child records match the original payment's school,
student and subscription. Ledger and settlement lists have explicit limits and
truncation flags. Errors are sanitized and clients receive Cache-Control no-store.

Only allow-listed scalar evidence is returned. No raw receipt/JSON snapshots,
customer names, bank details, recipient identifiers, credentials or free-text
reconciliation notes are returned. Historical split amounts are read unchanged.
Receipt presence, ledger entry kinds/amounts, recorded provider fee/net and
recipient settlement statuses do not prove actual bank delivery in TEST.

Webhook outcome stays UNKNOWN: the subscription handler has no independent
durable per-delivery outcome journal, and finalization is shared with browser
returns. The saved SIGNED_WEBHOOK_PROVIDER_VERIFICATION_UNCERTAIN failure code,
if present, is disclosed only as a persisted uncertainty flag, not a successful
delivery or verification claim.

## Independent binding setup (not performed)

First establish a genuinely non-deployment Development execution context.
An authorized operator must run the exact independent identity SELECT documented
in scripts/src/dev-backup/safety.mjs through the Development read-only facility,
and attest its provenance and time. Never query Production for comparison.
Use the same full identity fields in this credential-free document:

    {
      "environment": "development",
      "verifiedBy": "replit-development-read-only",
      "verifiedAt": "ACTUAL_UTC_ISO_TIMESTAMP",
      "identity": { "ALL_EXACT_INDEPENDENT_IDENTITY_FIELDS": "UNMODIFIED_VALUES" }
    }

This is an operator attestation, not a cryptographic platform signature.
Place it at /home/runner/.config/educore/development-payment-diagnostic.json,
outside the repository, owned by the runtime user, regular file, mode 0600,
with private parent directories and no symlink components. Do not use environment
variables, credentials or URLs. Proof expires after 30 minutes; any restart or
identity mismatch requires fresh independent verification. The API compares
its own pinned connection against the independent identity, not just a name.

Only then, using an authorized Owner session, request the candidate exact app
reference once. A NOT_FOUND result means no exact SANDBOX match on that verified
Development target; it does not prove an absent charge elsewhere or justify a
prefix search, new payment or provider reconciliation.

## Verification

21 focused tests passed, API typecheck passed, OpenAPI code generation and
generated-library checks passed, and diff whitespace checks passed. The API
workflow restarted successfully; the public sign-in page still renders.

Focused fixture tests cover pinned read-only SQL and parameterization, global
Owner authorization, child tenant scope, missing plans, NGN 70 fee/NGN 4,930 net,
both Partner allocations, historical saved amounts, unsupported flw_ref mapping,
exact-reference absence, independent identity mismatch, proof expiry and
fail-closed deployment flags. These mocks are not actual database acceptance or
evidence about this payment. No migration (including 0168), provider call,
webhook resend, secret/payroll change, Production access or publishing is allowed
by this implementation.
