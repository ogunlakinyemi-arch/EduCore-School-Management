# EduCore remediation follow-through

Date: 2026-10-13. Development verification only; no publication initiated.

## Latest continuation: verified fixes and remaining gates

This section supersedes the earlier status recheck below. This continuation
repaired the 14 non-native API contract failures and the 22 outstanding UI
regressions without weakening production authorization, enrollment, device,
NFC billing, or publication safeguards.

### Fresh verification

| Check | Passed | Failed | Skipped | Scope |
|---|---:|---:|---:|---|
| Full API Vitest run | 1,796 | 9 | 189 | The nine failures are native PostgreSQL tests hitting the intentionally unreachable loopback target |
| Full UI Vitest run | 684 | 0 | 0 | All current component and routing tests |
| SQL/schema/private-file tooling | 38 | 0 | 0 | Existing 34 checks plus four identifier/query-boundary checks |
| Root workspace TypeScript check | pass | 0 | — | Shared libraries and all configured leaf packages |
| Strengthened NFC delegation assertions | 5 | 0 | 0 | Single/bulk invoice tests additionally checked after the full API run |
| Final API TypeScript check | pass | 0 | — | Confirms the added delegation assertions type-check |

Full run evidence was captured in `/tmp/educore-continue-api-full.json`,
`/tmp/educore-continue-ui-full.json`, and their matching logs. These temporary
files are execution evidence, not durable acceptance records. Tooling and
delegation outputs are in `/tmp/educore-continue-tooling-complete.log` and
`/tmp/educore-continue-nfc-delegation.log`.

The API is **not fully green**. Two Owner recovery tests, three Phase 3 database
history tests, and four Phase 4 Partner integrity tests require an independently
approved native database target. They were not mocked into success, skipped
into success, pointed at existing application records, or run against a newly
created database. The database-backed finance integration file remains excluded
by the existing test configuration.

Most repairs align fixtures with current SQL guards and generated query hooks.
The positive draft-result test now uses its authorized Teacher role; a new
negative assertion verifies School Admin cannot insert scores or notify through
that route. Invoice tests assert automatic NFC-obligation delegation receives
the correct school, student, session and term, while an unauthorized bulk
request never invokes it. Timetable tests now handle lazy state initializers
and assert the current management label. The one runtime UI fix avoids reading
`window` during server rendering of timetable URL filters.

### SQL utility findings: reviewed, not suppressed

A fresh SAST run still reports three CRITICAL SQL findings in
`scripts/src/educore-extension-validation.mjs`. Their actual argument paths are:

1. A constant catalog query listing `public`/`drizzle` tables.
2. A constant column query with schema/table **values bound as `$1`/`$2`**.
3. A fingerprint query whose identifiers are individually validated and quoted
   before composition; identifiers cannot be replaced by value placeholders.

The quoting boundary is now a small separately tested helper. It rejects
non-strings, quote/comment/expression injection, qualified names, commas,
wildcards and control characters, including the trailing-newline regex edge.
Both fingerprint projections and generated disposable database names use that
same boundary. Static catalog queries use ordinary string literals. Four
no-network tests cover accepted identifiers, malicious input, bound catalog
values and every identifier-composition path.

For these inspected input paths, the findings are reviewed SQL-injection false
positives, **not three demonstrated application vulnerabilities**. Scanner
counts remain three; no suppression, exclusion, rule alteration or assertion
of scan clearance was added. The utility itself was never executed against a
database, and no native DDL/replay acceptance is inferred from its unit tests.

### Dependency audit: compatible fixes unavailable

The fresh audit remains **2 critical, 1 high and 3 moderate advisory records**:

| Dependency | Current remediation constraint |
|---|---|
| Vitest and `@vitest/mocker` | Fixed range starts at 4.1.11; current compatible line is 3.x |
| `tinypool` (two critical advisories) | Fixed ranges start at 2.1.1 and 2.1.2; the current Vitest dependency is 1.x |
| `postcss-selector-parser` | Fixed range starts at 7.1.6; latest typography parent still pins 6.0.10 |
| `braces` | Registry audit reports no patched version; latest release remains affected |

No compatible release was found that resolves these advisories. No packages or
lockfile were changed, and no major upgrade, forced override, security
suppression or release-age bypass was used. These alerts remain unresolved.

### Managed Development workflow recovery

Both managed services initially reported failed while earlier untracked
listeners still served their ports. Before process action, exact process
identity, artifact directory, listener ownership and quiescence were checked.
Both listeners had zero established TCP connections; a read-only Development
query found zero other active queries and zero other open transactions. The API
process was unpublished Development with worker pause enabled, and startup
source showed the pause exits before scheduling delivery/subscription work.

Only those two confirmed orphaned service processes received SIGTERM. They
exited without force killing; no database or unrelated process was terminated.
The existing API and web workflows were restarted sequentially, once each.
Both now report **running** on their unchanged managed ports. Fresh API output
confirms the Development worker pause. Proxied API health and web requests both
return HTTP 200. A screenshot confirms the public Development sign-in renders;
it does not establish signed-in timetable or payment acceptance.

### Flutterwave reference lookup and genuine TEST charge gate

The previous standalone lookup returned HTTP 400, `status: error`, and
`No transaction was found for this id`. This establishes only that this lookup
did not retrieve a transaction for that reference/key context. It does not
establish a completed charge, delivered webhook, application settlement, or
that the merchant/dashboard configuration is correct.

Flutterwave's documented v3 lookup is
`GET /v3/transactions/verify_by_reference?tx_ref=<exact-reference>`, authorized
by the corresponding secret key. `tx_ref` is the merchant/application's unique
transaction reference, not the numeric provider ID, `flw_ref`, checkout URL,
invoice number or webhook event ID. The application stores the original
reference, permits 8–100 ASCII letters/digits/underscores/hyphens, and URL-encodes
it; do not generate or alter it to make an unknown lookup appear successful.
Use the same independently confirmed TEST merchant/key context in which the
checkout was initialized. A created checkout URL alone is not a successful
transaction.

After a successful exact-reference lookup, independently verify its returned
numeric ID with `/v3/transactions/{id}/verify`. Provider success, exact reference,
transaction ID, NGN currency, and the expected integer minor-unit amount must
all agree with the persisted application payment. A successful API envelope
without `data.status: successful`, or a missing/mismatched reference or ID,
must remain unverified. The existing Development adapter implements this
two-step lookup; no production provider behavior was changed.

Reference documentation:
https://developer.flutterwave.com/v3.0/reference/verify-transaction-with-tx_ref

The genuine EduCore TEST charge remains **BLOCKED**:

| Required gate | Evidence / gap |
|---|---|
| Actual TEST dashboard destination | No authenticated dashboard evidence; application endpoint/credential existence is insufficient |
| Owner-approved merchant identity | Not independently confirmed for the selected TEST keys |
| Approved isolated target and financial fixture | Not established; no new database or financial fixture created |
| Notification suppression for the complete real fixture flow | Development workers are paused; isolated-flow delivery suppression still needs confirmation |
| Genuine reference/ID/amount/currency verification | No successful charge initiated by this continuation |
| Genuine delivery and application settlement | No newly observed provider webhook or native settlement/receipt acceptance |

No checkout or charge was submitted in this continuation. No payout, refund,
real notification, identity change, hardware integration, Production access,
publish action, migration, application-record write or test-record deletion was
performed. Existing test history was not repurposed as payment evidence.

## Earlier status recheck (retained historical evidence)

The source-change/test batch has ended, but the overall remediation and genuine
TEST payment acceptance are incomplete. No new tests or payments were initiated
for this status recheck; the results below are the latest saved executions.

Both Development HTTP checks currently return 200. However, the managed API and
web workflows report **failed**: a later API start at 19:45 UTC encountered
`EADDRINUSE` on port 8080, and web encountered its occupied managed port.
Read-only listener inspection identifies the API as the same process started
at 19:38 UTC whose rebuilt source and worker pause were previously verified.
The web listener is also the earlier 19:38 UTC Vite process. Thus the updated API
still serves requests, but successful health responses do **not** establish
healthy managed workflow ownership. No process was stopped or service restarted
during this recheck. Recovery of managed process ownership remains outstanding.

Fresh managed Development SQL reconfirmed session 358, 2026/2027, and term 20,
FIRST, both ACTIVE and current for school 1393. No record was changed.

The separate webhook inspection selected **“Elsewhere or not confirmed”**:
no authenticated Flutterwave dashboard connection or confirmed TEST destination
was available. Dedicated TEST credential/hash existence and receiving routes
do not establish dashboard routing. No genuine delivered webhook was observed.
The dependency-remediation, native replay, invoice-fixture and Partner UI
follow-ups remain queued; their pending status is not completed work.

## Diagnosis before source changes

One bounded, dedicated-TEST GET against the existing private provider-only
reference returned HTTP 400, status `error`, message **“No transaction was found
for this id”**, and null data. No charge or checkout was created by this request.
The saved browser observation separately records zero charge submissions.

This establishes the provider's reason for this lookup failure, not a successful
payment, invalid endpoint, universal absence across merchants, or failed charge.
No transaction ID was available for independent ID verification.

The review tool now projects this exact response as `NO_TRANSACTION_RECORDED`
without exposing the response body, treating it as a failed payment, or settling
anything. Unknown errors remain unconfirmed. Its regression test retains the
one-request bound and false settlement/verification claims.

## Development target and school 1393

Independent managed Development SQL and a read-only connection using the
application's configured workspace Helium target agreed on database and
PostgreSQL postmaster identity.

School 1393 already has:

| Record | State |
| --- | --- |
| Session 358, 2026/2027 | ACTIVE, current; 2026-09-14 through 2027-07-23 |
| Term 20, FIRST | ACTIVE, current; 2026-09-21 through 2026-12-18 |
| Session 369, 2027/2028 | INACTIVE, not current |

No academic records were changed. New component regressions exercise the real
Academic Calendar page with mocked API data reflecting this saved state: the
current session is selected despite the future session sorting first, and both
sessions remain selectable without a mutation. These are not authenticated
browser acceptance or actual save evidence.

A separately guarded, read-only query found **zero subscription payments**
matching the private standalone probe reference. It was not retroactively
attached to a student or school. This is negative matching-record evidence,
not PostgreSQL settlement or replay evidence.

## Runtime and compatible changes

- Added an explicit worker pause restricted to unpublished Development. Default
  behavior and Production behavior are unchanged.
- Configured that pause for this verification run. It remains enabled: scheduled
  Development subscription enforcement and notification dispatch do not run
  until it is explicitly removed. Request handlers are not disabled.
- Restarted the managed API after the batch. It rebuilt its bundle and logged
  the pause from the updated source. Development `/api/healthz` returned HTTP 200.
- Updated React and React DOM together from 19.1.0 to 19.1.9, preserving the
  existing framework/major/minor line, release-age policy and package scripts.
- Restarted web and component preview services after dependency optimization.
  The public sign-in page rendered; its anonymous authorization request returned
  the expected 401. No authenticated role journey was exercised.

No provider settings, real notification, payout, refund, Clerk identity or
physical device operation was initiated. Database queries were read-only.
No Production connection/write, schema migration, deletion/reset or publication
was initiated by this work. Independent user/worker/deployment activity is not
certified unchanged.

## Verification results

Counts overlap; do not add rows as unique tests.

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Full API execution | 1,781 | 23 | 189 |
| Payment-specific files within that execution | 201 | 0 | 0 |
| Development worker-pause tests within that execution | 5 | 0 | 0 |
| Initial full UI execution | 660 | 24 | 0 |
| Final current-period and academic form execution | 25 | 0 | 0 |
| Schema-export, schema-policy and private-file tooling | 34 | 0 | 0 |

Workspace TypeScript passed for shared libraries, API, web, sandbox and scripts.
Web TypeScript also passed after repairing the new test's shared-component mock.
`git diff --check` passed.

Nine API failures attempted an unavailable PostgreSQL target at loopback port 1,
which the no-external-network harness deliberately substitutes for the
application database. No unsafe target substitution was attempted. Fourteen
other route assertions require further fixture/contract investigation; missing
SQL answers and changed authorization/eligibility expectations were observed.
These failures were not converted into passes by weakening application checks.

The initial UI run included two failures in the newly added test's incomplete
shared-component mock; those were fixed and the final focused execution passed.
Twenty-two failures in six other UI files remain unresolved, including missing
API/authentication context mocks and outdated route/invitation expectations.
The full UI suite was not rerun after the focused fixture correction.

Source logs are in `/tmp/educore-complete-api-remediation.log`,
`/tmp/educore-complete-ui-remediation.log`,
`/tmp/educore-period-remediation-final.log`,
`/tmp/educore-complete-types-remediation.log` and
`/tmp/educore-complete-tooling-remediation.log`. Temporary logs are not durable
deliverables and may expire.

## Revenue and payment evidence

Passing payment tests retain NGN 5,000 gross per student/term:

| Allocation | With eligible assigned Partner | Without Partner |
| --- | ---: | ---: |
| School | NGN 2,000 | NGN 2,000 |
| Partner | NGN 100 | NGN 0 |
| Yetenia Technologies Limited, platform gross | NGN 2,900 | NGN 3,000 |

Provider fees/VAT remain separate platform costs. Coverage includes exact
amount/currency/reference/transaction-ID binding, failed/pending states,
authenticated and invalid webhook handling, repeat/concurrent callbacks,
receipt snapshots and allocation/subscription finalization.

Provider and financial persistence responses in these tests are mocked. A
genuine successful TEST charge, provider-delivered webhook, persisted receipt,
subscription activation, financial allocation and durable replay idempotency
were **not** established. No native finance integration target was approved or
configured in this run; no disposable PostgreSQL server was started.

Charge submission remains gated on independently confirmed TEST dashboard
webhook destination, authorized merchant identity, and a bounded approved
financial fixture/target. The Development runtime and its worker pause are now
verified, but they cannot establish dashboard routing. TEST settlement cannot
be represented as an actual recipient bank deposit.

## Security

Fresh dependency audit after the compatible patch still reports **2 critical,
1 high and 3 moderate** entries: tinypool twice, braces, Vitest, its mocker and
postcss-selector-parser. Available Vitest/tinypool fixes require a staged major
test-tooling upgrade; no forced override or security-policy bypass was applied.

SAST reported three critical SQL findings in the Development-only
`educore-extension-validation.mjs` utility. Inspection found static catalog SQL,
parameter binding and catalog-derived identifiers passed through a strict
identifier validator. They were not demonstrated application request-input
injection, and the findings were not suppressed or counted as remediated.
The privacy scanner reported one low finding. Both scanner observations remain
distinct from the dependency audit.

Existing dependency-remediation and database-backed replay work remains queued.
Separate invoice-fixture and Partner invitation component-test follow-ups were
proposed; neither creates genuine provider, identity or database evidence.
