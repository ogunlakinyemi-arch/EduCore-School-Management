# School-date NFC, ordinary arrears and financial reminders

Date: 2026-11-27. **Source implementation and focused unit/static validation
completed. Not activated, not deployed, and not native PostgreSQL acceptance.**

## Implemented behavior

- NFC uses each school's saved current term **and session**, for any term number
  or session. D through D+6 is grace; checkout and required enforcement begin
  at D+7, within the saved term. The nationwide January/second-term dependency
  is removed from prospective student/staff NFC timing. Explicit free-term
  grants and independent manual/card/security controls remain separate.
- The shared boundary covers student usage, advance checkout, aggregate retry,
  staff collection, enforcement and card-readiness dates. Calendar rollover
  remains independent and does not wait for grace or payment.
- Student platform pricing remains NGN 3,200. No commission ledger, BRO pricing,
  verified-payment allocation, refund or provider-finalization algorithm was
  replaced. Separate eligible NGN 150 liabilities and historical amounts remain
  under their existing independent evidence and exactly-once controls.
- Ordinary school debt remains on its original invoices across terms. There is
  **no second debt ledger, copied invoice, term balance reset or automatic
  cross-invoice reallocation**. Existing explicit invoice/line allocation is
  retained. Parent/student lists are ordered by original due date and invoice ID;
  prior-term arrears are displayed separately using saved term identity.
  Discounts, waivers, refunds, reversals and allocations remain authoritative
  through the existing accounting balances. Ordinary fees do not get NFC grace.
- Family lists and invoices use school publication provenance, not a numeric
  price filter. A genuinely published school charge of NGN 3,200 is still a
  school charge. Schools may explicitly create a **School NFC…** category
  independently of the reserved legacy platform category. Receipt submission
  and school payment never create platform entitlement.
- The reconciliation reader derives publication provenance server-side.
  Published explicitly school-owned NFC charges do not become legacy platform
  debt merely because their names mention NFC/subscription. Legacy bindings
  still take precedence; missing publication proof remains review evidence.
  The original school invoice and payment history stay in the evidence.
- Family balances no longer request or combine the internal NFC ledger.
  Teacher/family callers cannot use that legacy ledger through the panel or
  its scoped API. Historical platform records stay available to authorized
  finance roles. Old public platform NFC payment-link endpoints now return
  **410** before looking up a token or disclosing internal amounts. No token,
  historical payment or ledger row was deleted.
- Separately authorized replacement-card invoices retain their existing
  parent/student payment-method, checkout and receipt access under live
  ownership checks. That bounded exception does not place replacement
  requests in school-fee arrears or weekly school-fee reminder selection.
- Monday/Friday reminders use **Africa/Lagos** dates. The normal server's
  existing background task structure now produces intents for the existing
  communication queue; there is no new delivery engine or outbox. Due,
  positive school balances go only to currently authorized guardians.
  Internal student NFC reminders go to school finance, not guardians or
  teachers; employee NFC reminders are scoped to the employee.
- One reminder per recipient/obligation/term/scheduled day is protected by
  transaction advisory locking, existing notification uniqueness and a stable
  scope check. The body is tied to its original balance snapshot. A later
  partial payment cancels stale remaining deliveries rather than creating
  repeated same-day reminders; the next scheduled day uses fresh balances.
- External attempts freshly recheck the scheduled day, original charge,
  balance, recipient/child/employee eligibility and applicable entitlement.
  Paid, changed, no-longer-authorized or stale events are cancelled with
  retained history. Independent Owner locks do not become unpaid employee
  claims or prevent other ordinary-fee reminders.
- Fixed financial channel selection is independent of school campaign
  approval/default switches. In-app, Telegram, push, SMS and email remain
  subject to Owner ceilings, recipient preferences/consent, configured
  transports, launch cutoffs and existing operational pauses. Older saved
  Owner ceilings can still hold financial SMS; settings were not rewritten.
  Financial SMS is a narrowly scoped scheduled purpose, not permission to
  send arbitrary financial SMS. Existing retry/ambiguity behavior is retained.

## What was executed

All test commands below ran with a clean child environment and the repository's
unit-test network safeguards. No application database connection was used.
Mocks are **not** evidence of real SQL execution or physical message delivery.

### API unit/source checks — 227 passed across nine files

| File under `artifacts/api-server/src/services/` | Passed | Scope |
| --- | ---: | --- |
| `school-date-financial-policy.test.ts` | 16 | D/D+6/D+7, all term numbers, separate schools, WAT, original balances and publication/replacement selectors |
| `weekly-financial-reminders.test.ts` | 7 | Producer and fresh-eligibility mocks, duplicate prevention, independent channels, stale balances, employee/Owner-lock exclusions |
| `advance-subscription-policy.test.ts` | 23 | Updated D+7 policy and retained review/evidence contracts |
| `student-platform-rollout.test.ts` | 7 | School-date rollout, independent release/actor gates, unchanged commission eligibility assertions |
| `subscription-enforcement-policy.test.ts` | 22 | Grace, per-student restrictions and restoration policy |
| `notification-channel-policy.test.ts` | 18 | Owner ceilings, selections and configuration safety |
| `staff-subscription-access.test.ts` | 39 | Existing role/operational access regressions |
| `communication-service.test.ts` | 70 | Existing queue and dispatcher regression tests |
| `student-nfc-reconciliation-policy.test.ts` | 25 | Legacy protection and published school-charge separation |

The final executed version of each listed file passed. Intermediate failures
were corrected; there is no claim that the entire repository test suite passed.
The initial command also named a nonexistent `sms-event-policy.test.ts`;
Vitest did not execute that file. Scheduled SMS scope is exercised in
`weekly-financial-reminders.test.ts` and channel-policy regressions instead.

### Web rendering/unit checks — 9 passed across two files

- `artifacts/edupulse/src/components/family-fee-balances.test.tsx`: 6.
- `artifacts/edupulse/src/pages/student-fee-visibility.test.tsx`: 3.

These are mocked/static React rendering checks, not an authenticated browser
journey or screenshot of the running application.

### Static/contract checks

- `pnpm --filter @workspace/api-spec run codegen`: passed, including its chained
  `typecheck:libs`. Generated optional invoice due-date/period fields match the
  server response and UI. No schema was pushed.
- `pnpm --filter @workspace/api-server run typecheck`: passed.
- `pnpm --filter @workspace/edupulse run typecheck`: passed.
- `git diff --check`: passed.

## Authored/updated but not executed

- `advance-subscriptions.isolated.postgres.test.ts`: added native current-term
  grace denial and D+7 admission cases. The fictional school's saved start
  date establishes D+7; the actual OS/PostgreSQL clock is not overridden.
- `finance-calendar-upgrade.isolated.postgres.test.ts`: the aggregate retry
  scenario uses a fictional D+7 financial term; separate rollover fixtures keep
  their original resumption dates.
- No native run was started for those files, the company-bank-remittance
  isolated suite or the academic-calendar-rollover isolated suite.

**Blockers:** non-root UID was confirmed, but `unshare --net true` failed with
`Operation not permitted`. The existing no-egress namespace guard was not
weakened. The native fixtures also retain their required actual 2027-01-18
clock gate; the current date is 2026-11-27. No injectable application/runtime
clock flag, global clock change or fallback to an application database was
introduced. The permission to use an isolated test clock was not treated as
permission to simulate native acceptance here.

SQL publication/provenance predicates, native authorization behavior,
transaction/concurrency semantics, real provider capabilities and physical
delivery still need authorized isolated acceptance. Unit/source checks cannot
substitute for that evidence.

## Candidate and operational boundaries

- **0185 and 0187 were not changed in this pass.**
- **0186 changed only its two checkout/retry date lower bounds from D to D+7.**
  Its corrected evidence, revision installation, installer/readiness and
  deferred-integrity protections were not removed.
- No migration applied to any database; no application/dev/production database
  accessed; no provider call, message, charge, payout, credential inspection,
  operational setting change, LIVE enablement, deployment, manual merge/push,
  reset or application workflow restart.
- Existing app processes were not used to exercise these changes. Restarting
  the API could start background workers and access application data, so it
  was deliberately not done. Source completion is not operational activation.
- New derived reconciliation provenance changes evidence digests. Prior
  approvals must not be assumed reusable; the normal fresh review and
  authorization checks remain necessary.
- Existing older reports' historical test status does not establish native
  acceptance; this report records only the checks listed above.

## Every changed file in this consolidated pass

### API application source

```text
artifacts/api-server/src/lib/student-nfc-obligations.ts
artifacts/api-server/src/lib/student-nfc-policy.ts
artifacts/api-server/src/normal-server.ts
artifacts/api-server/src/routes/finance.ts
artifacts/api-server/src/routes/nfc-payment-links.ts
artifacts/api-server/src/routes/student-nfc-obligations.ts
artifacts/api-server/src/services/advance-subscription-policy.ts
artifacts/api-server/src/services/bulk-retry-authorization.ts
artifacts/api-server/src/services/communication-service.ts
artifacts/api-server/src/services/direct-student-live-release.ts
artifacts/api-server/src/services/fee-line-balances.ts
artifacts/api-server/src/services/financial-reminder-eligibility.ts
artifacts/api-server/src/services/financial-reminder-policy.ts
artifacts/api-server/src/services/financial-reminder-worker.ts
artifacts/api-server/src/services/nfc-term-grace.ts
artifacts/api-server/src/services/notification-channel-policy.ts
artifacts/api-server/src/services/school-fee-carry-forward.ts
artifacts/api-server/src/services/sms-event-policy.ts
artifacts/api-server/src/services/staff-free-rollout.ts
artifacts/api-server/src/services/staff-subscription-access.ts
artifacts/api-server/src/services/student-card-readiness.ts
artifacts/api-server/src/services/student-nfc-reconciliation-policy.ts
artifacts/api-server/src/services/student-nfc-reconciliation.ts
artifacts/api-server/src/services/student-platform-rollout.ts
artifacts/api-server/src/services/subscription-enforcement-policy.ts
artifacts/api-server/src/services/subscription-enforcement.ts
```

### API tests

```text
artifacts/api-server/src/services/advance-subscription-policy.test.ts
artifacts/api-server/src/services/advance-subscriptions.isolated.postgres.test.ts
artifacts/api-server/src/services/finance-calendar-upgrade.isolated.postgres.test.ts
artifacts/api-server/src/services/notification-channel-policy.test.ts
artifacts/api-server/src/services/school-date-financial-policy.test.ts
artifacts/api-server/src/services/student-nfc-reconciliation-policy.test.ts
artifacts/api-server/src/services/student-platform-rollout.test.ts
artifacts/api-server/src/services/weekly-financial-reminders.test.ts
```

### Web source/tests, API contract/generated files and SQL candidate

```text
artifacts/edupulse/src/components/family-fee-balances.test.tsx
artifacts/edupulse/src/components/family-fee-balances.tsx
artifacts/edupulse/src/components/student-nfc-obligations.tsx
artifacts/edupulse/src/pages/finance.tsx
lib/api-client-react/src/generated/api.schemas.ts
lib/api-spec/openapi.yaml
lib/api-zod/src/generated/api.ts
lib/api-zod/src/generated/types/feeInvoice.ts
lib/api-zod/src/generated/types/feeInvoice4b96100.ts
lib/db/drizzle/0186_advance_subscription_authorizations.sql
```

### Documentation and durable policy corrections

```text
docs/migration-0185-0187-source-validation.md
docs/school-date-nfc-financial-reminders-validation.md
.agents/memory/MEMORY.md
.agents/memory/subscription-business-policy.md
.agents/memory/staff-subscription-policy.md
.agents/memory/sms-emergency-absence-policy.md
.agents/memory/scheduled-financial-reminder-policy.md
.agents/agent_assets_metadata.toml
```

The asset metadata entry was updated automatically when this report was
registered as a downloadable document.
