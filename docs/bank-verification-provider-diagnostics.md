# Owner "Verify bank details" — provider diagnostics

Applies to Payment settlement → School oversight → **Verify bank details**
(`POST /api/platform/finance/payment-settlement/schools/:schoolId`) and to the
same read-only Flutterwave v3 `POST /accounts/resolve` call used by payroll
pre-flight checks.

## Test data note

The school records currently used in Development, including the bank account
entered for this check, are **fictional test data**, not a real school's bank
account. Even TEST credentials contact Flutterwave's real service, which may
reject fictional details (typically as `BANK_RESOLUTION_INVALID_BANK_OR_ACCOUNT`).
That rejection is expected. Do not enter fictional details into LIVE mode; LIVE
verification must use a school's genuine, owned account.

## What the Owner sees

Provider failures still return HTTP 503 with the existing `{ error, code }`
shape (no API contract change). The `code` is one of:

| Code | Meaning |
|---|---|
| `BANK_RESOLUTION_PROVIDER_AUTH_REJECTED` | Provider HTTP 401/403 — credential or permission rejected |
| `BANK_RESOLUTION_INVALID_BANK_OR_ACCOUNT` | Other provider 4xx — bank/account details rejected or unsupported |
| `BANK_RESOLUTION_PROVIDER_RATE_LIMITED` | Provider HTTP 429 |
| `BANK_RESOLUTION_PROVIDER_OUTAGE` | Provider HTTP 5xx |
| `BANK_RESOLUTION_UNEXPECTED_PROVIDER_RESPONSE` | Readable JSON without a status, or a success that did not match the requested account |
| `BANK_RESOLUTION_NON_JSON_PROVIDER_RESPONSE` | Unreadable body (provider status still reported) |
| `BANK_RESOLUTION_PROVIDER_TIMEOUT` / `BANK_RESOLUTION_PROVIDER_NETWORK_FAILURE` | No provider response — outcome uncertain |

The message includes the provider HTTP status and a fixed reason phrase
(e.g. "could not resolve this account number at this bank"). Reasons are chosen
by pattern-matching the provider message; the provider text itself, raw bodies,
keys, full account numbers and holder names are never logged or returned. The
API logs one `warn` line with only `{ code, providerHttpStatus, category, reason }`.

## What does not change

- The profile stays `PENDING_VERIFICATION`: generic provider errors start no
  database transaction, change no status and write no audit event.
- Only a genuine successful resolution with the exact account number and a
  matching holder name sets `VERIFIED` (audit `FLUTTERWAVE_BANK_ACCOUNT_RESOLVED`).
  A name mismatch remains HTTP 409 `SETTLEMENT_BENEFICIARY_MISMATCH` with audit
  `SETTLEMENT_ACCOUNT_NAME_MISMATCH`.
- No automatic retries. Authorization, tenant scoping, idempotency keys and
  provider-mode guards are unchanged. Payroll transfer errors keep their
  existing `PAYROLL_PROVIDER_*` codes.
