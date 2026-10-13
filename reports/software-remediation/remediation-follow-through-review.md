# EduCore remediation follow-through

Date: 2026-10-13. Development verification only; no publication initiated.

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
