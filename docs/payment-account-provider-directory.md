# Shared Nigerian payment-account provider selection

## Scope

One searchable `BankProviderSelect` is used by:

- Owner company settlement details;
- School Admin school settlement details;
- school teacher/staff and company employee payroll bank profiles;
- Partner payout information;
- Flutterwave settlement/subaccount registration;
- school manual bank-transfer instruction settings.

Typing filters options; it never saves a free-text bank name. Keyboard selection,
loading/error states, refresh and a contact-administrator fallback are included.
The payer's source-bank field on a manual-payment report is not a saved recipient
account and is unchanged.

## Source of provider identity and codes

`GET /api/payment-account-providers` is authenticated. The canonical directory is
assembled in `artifacts/api-server/src/lib/nigerian-payment-providers.ts`.
The existing Flutterwave payroll V3 client reads the complete `/banks/NG`
catalogue using its existing account-resolution credential/mode boundary.
No transfer, account resolution, subaccount creation or checkout is made by this
lookup. It makes no database calls itself and never returns credentials.

Every catalogue institution is included, including commercial/other banks,
microfinance and digital providers returned by Flutterwave. Named discovery
entries include Moniepoint, OPay/Paycom and PalmPay. Discovery entries contain
**no static numeric routing codes**. The old fifteen-bank frontend list is
removed. This is not an independent assertion that an institution's licence is
current or that every licensed institution has a compatible Flutterwave route.

Catalogue codes remain strings, preserving leading zeroes. Codes from another
gateway or generic CBN/NIBSS lists are not substituted. Routes incompatible with
the existing 3–6 digit payout requirements remain unverified for selection.
Exact duplicate catalogue rows are deduplicated; conflicting/malformed entries
fail closed. Successful lookups cache for five minutes; failures for fifteen
seconds, preventing a repeated failing request on each form render.

A catalogue listing confirms a code mapping only. It does **not** confirm
account ownership, merchant payout permission, LIVE release or a successful
transfer. TEST catalogue evidence does not authorize LIVE payments.

## Saving and existing records

Settlement, payroll, Partner and registration forms send the selected bank name
and confirmed `bankCode` through their existing request/storage fields.
No synthetic directory ID is put in a transfer-code field. New/changed transfer
providers without a verified compatible code cannot be saved. An unmatched
search clears the previous selection and code. Handler-level catalogue guards
also reject direct/programmatic submits; native form validity is not the only
protection.

Untouched saved legacy providers remain visible without being relabelled as
currently verified or silently rewritten. Existing account-name/number rules,
write-only/masked account-number behavior, authorization, encryption and payout
execution requirements remain in place.

**Storage exception:** school manual-transfer instructions have no bank-code or
provider-ID column in their existing API/table. They now require an actual
directory selection for changed names, but remain name-only instructions.
An unverified directory name in these manual instructions is not a supported
Flutterwave transfer route. Adding server-side provider identity there requires
separate schema approval; no column, name-field encoding or migration is added.

## Recorded verification

- API: **31 passed** across `routes/payment-account-providers.test.ts` and
  `lib/flutterwave-payroll-v3.test.ts`.
- Frontend: **83 passed** across `pages/bank-fields.test.tsx`,
  `pages/bank-save-payloads.test.tsx`, `pages/flutterwave-settlements.test.tsx`,
  `pages/payment-settlement.test.tsx`, `pages/payroll-settlement.test.tsx`.
- OpenAPI generation/shared-library checks, API/web TypeScript, API build and
  whitespace checks passed.
- Provider responses/codes in tests are explicitly fictional. No actual
  catalogue/provider or database writes were used by these checks.
- Public sign-in rendered; protected role pages were verified through component
  and submit-handler tests, not authenticated browser/database acceptance.
- An additional exploratory page-suite run reported eight failures across
  dashboard, my-payslips, operational-role-boundaries and parent-routing tests.
  No clean baseline was established; do not label these proven pre-existing
  failures or claim the full page suite passes.

Production settings/data, payment secrets, migration files, payment allocations,
transfer gates and deployment are unchanged. No publishing or live transfers
were performed. A built API is not deployment evidence; the new route must be
loaded in an approved runtime before the client can obtain its directory.
