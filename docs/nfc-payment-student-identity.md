# NFC payment student identity — Development correction

## Findings

- The public DTO selected the admission identifier but omitted the student name;
  both creation confirmation and public UI therefore displayed no student name.
- The public page captured its token fragment only on mount. Same-tab navigation
  to another fragment could retain the old student. Delayed earlier view responses
  could also overwrite the current context.
- The screenshots' two historical identifiers alone do not establish which
  references/tokens were opened. No historical intent mismatch is claimed or
  silently repaired.

## Focused correction

Creation now verifies the canonical school/student/subscription/session/term
against the server-resolved assisted request, any reused link and its final token
resolution. Public lookup joins the complete authoritative subscription-period
binding and verifies the term's session. Missing/mismatched records do not fall
back to another student.

The allowlisted public DTO adds only `studentName`, resolved from that bound
student's first/last name; blank names fail safely. Both screens display this
server value with the admission identifier, school and period. Public requests
still accept a token, not a student selector or browser-provided identity.
Guardian, contact, birth-date, raw student IDs and private snapshots are excluded.

Fragment changes clear the previous identity and reload the new token. Responses
for superseded tokens are ignored, including before a checkout redirect.
Pending/payment status wording, expiration, simulation/TEST warnings, amounts,
provider verification, credentials and delivery behavior are unchanged.

## Evidence and boundaries

95 focused API tests passed, including seven native SQL identity tests in a fresh
private PostgreSQL cluster;11 frontend tests passed, including creation confirmation
and same-tab/stale-response regressions. OpenAPI/codegen and API/frontend typechecks
passed. No application database or schema was migrated or repaired. Provider calls
in checkout regressions were mocked; no real checkout/payment was initiated.
No Flutterwave LIVE, secret, Production or Publish setting was changed or published.
