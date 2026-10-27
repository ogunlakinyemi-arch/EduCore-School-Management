# School pilot and January 2027 release preflight

## Current decision: Production changes blocked

Review date: 27 October 2026. This document is a checklist, not financial release
approval, permission to migrate, a new backup claim or proof of live acceptance.
Reuse the existing recovery, calendar, January rehearsal, direct-release,
merchant and webhook work rather than duplicate it.

Owner previously confirmed Production database/recovery and merchant
prerequisites. Current tooling did not independently bind a current recovery
point and restore target to the serving writable primary. This is unverified
execution evidence, not a claim that those approvals or backups do not exist.

Read-only observations:
- Public deployment is https://educore.yetenia.com; latest observed successful
  build is 26 October 2026, 10:18 UTC, predating this work.
- Acquisition timeouts recurred; latest observed 27 October 2026 19:50:41 UTC.
  They do not establish bad credentials, network failure, slow SQL or pool
  exhaustion. Do not increase pool capacity or timeouts on speculation.
- Production-routed replica is readable. A read replica and a static healthz
  200 do not establish serving-primary health or authenticated acceptance.
- New direct-payment review tables are absent on the queried replica.
  The direct LIVE release, callback/webhook and merchant-scope environment
  settings are not configured in inspected Production metadata; live secret
  presence alone is not release authorization.

## Before any Production restart, migration, configuration change or publish

1. Reuse existing operator correspondence and resource evidence. Establish
   exact deployed revision, serving primary resource/configuration fingerprint,
   current accessible resource-bound recovery point, isolated restore evidence
   and responsible recovery operator. Do not expose credentials.
2. Compare actual serving schema/migration ledger with the exact reviewed
   deployment schema diff. Rehearse that precise dependency-ordered diff on an
   authorized isolated fixture; preserve history, protective locks and retention
   evidence. An empty-schema test or readable replica is insufficient.
3. Record rollback of code, compatible database changes and configuration;
   identify which changes cannot safely be reversed after new writes. Set
   explicit stop conditions and verify restoration before execution.
4. Observe acquisition timings, total/idle/waiting counts and DB-side capacity,
   active queries/locks and network/auth diagnostics, without changing pool
   settings. Identify the actual fault before remediation.
5. After preflight passes and authorized alignment, require DB-backed readyz
   success and fresh authenticated acceptance on the serving deployment.
   healthz remains process liveness only.

No migrations, restarts, secrets changes, provider calls, charges or publishing
are authorized by this implementation or checklist.

## Free pilot access

- Student and Teacher/Staff current-term platform access is free under the
  business policy effective 27 October 2026. No new fee obligation or checkout,
  automatic overdue restriction or card/device prerequisite for ordinary
  authorized platform tasks. RBAC, employee status and manual locks remain.
- Teacher/Staff normal price remains NGN 2,000, platform-only; never reprice
  employees at the Student rate.
- Preserve existing paid/unpaid obligations, references, allocations, receipts
  and provider reconciliation. Do not cancel, rewrite, rebill or falsely mark
  historical records paid.
- Missing/ambiguous calendars do not authorize guessed January billing.
  School Admin reviews actual sessions, current flags, dates, classes and
  teacher assignments. Owner calendar review lists active records, not a
  declaration that every listed school is a confirmed pilot customer.

## Authenticated acceptance after safe deployment alignment

Select actual pilot schools with the Owner. On each selected school's saved
calendar, verify sign-in/dashboard, own-school records, Teacher/Staff authorized
operations without payment/NFC, manual attendance and correction/audit history,
parent access only to linked children, denied neighboring-school resources,
manual-lock denial, historical receipts and read-only recovery paths.
Record each role, route, expected denial/success and deployment revision.
Development tests or an Owner's separate browser session do not prove these
Production flows. Do not create live fixtures or send notifications as a test.

## January Student non-split release, separately controlled

1. Confirm each school's actual January 2027 SECOND term and later eligible
   terms. No universal January day, ambiguous anchor or retroactive collection.
2. Exact gross Student payment: NGN 3,200 (320000 minor units), directly to
   Yetenia. School share 0; BRO share inside collection 0; no subaccounts/split
   objects or deductions to fund BRO. Provider fees are separate cost evidence.
3. Review and approve the correct effective-dated prospective monetary rule and
   exact school/term/merchant-bound release through authenticated Owner
   governance. Business approval metadata is not financial release approval.
4. Reviewed Production callback:
   https://educore.yetenia.com/api/flutterwave/direct-student/callback
   and webhook:
   https://educore.yetenia.com/api/webhooks/flutterwave/direct-student .
   Verify provider dashboard registration, merchant identity, signature contract
   and independent server-side transaction verification before enabling.
5. Exercise duplicates, lost responses, expiry, refunds, reconciliation and
   missing webhook handling with authorized isolated tests; no provider calls
   or real charges are part of this request.
6. Retain historical NGN 5,000 Student and NGN 100 BRO records unchanged.
   Preserve school fees and parent-to-school payments.
7. BRO entitlement is a separate NGN 150 (15000 minor units) expense only after
   an exact eligible future-term verified Student payment, with original valid
   attribution and refund/reversal/deduplication safeguards. Term-end release
   and Owner approval remain separate; never pay through collection splitting.
8. Enable nothing until binding, recovery, exact schema, health, authenticated
   acceptance, rollback and all merchant/release approvals pass.
