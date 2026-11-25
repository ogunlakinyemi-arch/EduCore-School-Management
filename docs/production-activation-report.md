# Yetenia EduCore — consolidated Production activation report

**Review: 23 November 2026. Decision: NO-GO for declaring all capabilities live.**

For the latest ordered preparation and delivery procedure, use the
[staged activation runbook](production-activation-runbook.md). This report
retains the prior observations and evidence; its procedural-delivery discussion
must be read with the runbook's documented operator route and unresolved
target-specific approval boundary.

Earlier reports are
reused as evidence, not rerun or rewritten. The safe source repair below is
finished; schema delivery, the incomplete staff LIVE path, scoped release
authority and operational/provider acceptance remain separate blockers.

## 1. Authorization and business rules

Only Development source changes, isolated tests and read-only observations were
performed. No shared Development migration, Production write/migration,
publication/deployment, credential or merchant/webhook change, rule activation,
LIVE release change, real payment/refund/transfer, SMS/Telegram send, or
Production worker restart/activation was performed.

- Student platform subscription: **₦3,200 per eligible student/academic term**.
- Teacher/Staff platform subscription: **₦2,000 per eligible staff/term**.
- BRO accrual: **₦150 per eligible, independently verified student/term**,
  separately funded; never deducted from the ₦3,200 or a school-set charge.
- Preserve the free current term and each school's actual January 2027
  second-term/calendar gates. Missing/ambiguous calendars do not authorize
  collection. Today is not an authorization to collect a future-term fee.
- School-set charges remain separate. Do not reprice, rewrite, delete or
  relabel historical subscriptions, payments, allocations, receipts or policies.
- Verification, authenticated webhooks, idempotency, unknown-outcome holds,
  immutable accounting, role/school boundaries and refund/payout evidence
  remain required. Approvals/acceptance are not payment/bank-credit evidence.

## 2. Published versus Development source

The deployment service reported the public autoscale deployment at
**https://educore.yetenia.com**, with a successful current build. Read-only public
checks returned 200 from `/`, `/api/healthz` and `/api/readyz`; readiness returned
`{"ready":true,"dependency":"database"}` at the observation time. These do not
certify financial readiness or sustained worker health.

The published entry script was `/assets/index-DtK9h_gA.js`, 2,806,924 bytes,
SHA-256 `f68c862d1d77d362ddefa17627857664b281048c9f56ca48ca6962d44b02e7aa`.
It contains Free Academic Terms/readiness wording but lacks the two
distinguishing new SMS list-selection strings. This is a limited public-bundle
observation, **not certification of every lazy-loaded module or backend source
revision**. Latest SMS source must not be called published/accepted from this.
No authoritative published backend commit mapping was available.

GitHub `main` was freshly checked at
`14f95c43826eb8142fec3edbb387f8767fbbdb7c`; the local checkpoint was
`11fa327a2d0463723ff54e0483028c5c5a2a1324`, with retained uncommitted SMS work.
Relevant sources/reports differ substantially. Remote main was a reference,
not used to overwrite this workspace; no merge, reset, push or deployment was
performed. A checkpoint named “Published your App” is not source attestation.

## 3. Capability status — do not collapse these evidence levels

**Fixture** means synthetic identities/fake transport or disposable PostgreSQL,
not a connected Production transaction. “Unverified” does not mean absent or
misconfigured. Production SQL observations below are from the platform's
**read-only replica**, not independent certification of the serving primary,
runtime role, database resource binding or recovery.

| Capability | Source implemented | Fixture tested | Configured | Production schema installed | Authenticated runtime verified | Real-provider verified |
|---|---|---|---|---|---|---|
| Student ₦3,200 LIVE | Existing direct checkout, independent verification, scoped reviews/release and calendar gates | Prior direct-payment evidence retained | LIVE mode, key/hash entries and canonical direct URLs present; current direct release selector absent | Direct tables alone are insufficient: required direct functions/7 triggers absent | No current school/term Owner release acceptance | Not established for current release |
| Staff ₦2,000 LIVE | Pricing/free-calendar policy exists; **checkout, verifier and refund adapter selection remain TEST/SANDBOX-only**; V3 auth repaired below | Prior staff evidence plus new focused auth checks; **no staff LIVE fixture certification** | LIVE key presence cannot enable a TEST-only path | Staff tables/history not recertified here; current lifecycle extensions absent | No | No |
| ₦150 BRO accrual/withdrawal | Existing independent entitlements, own-BRO scope, per-line Owner decisions and evidence-bound payout workflow | Prior PostgreSQL/adapter evidence retained | LIVE beneficiary/payout evidence contract not operationally certified | BRO guard functions/2 triggers and current withdrawal extension missing | No | No current withdrawal/bank-credit certification |
| Genuine aggregate student subscriptions | One batch checkout, exact aggregate verification and atomic per-student allocations; not a loop of individual checkouts | Prior real PostgreSQL and fake-provider evidence retained | Uses existing direct LIVE gate/reviews; no staff aggregate capability is claimed | 0181/0182 objects absent | No | No |
| Refunds/reconciliation | Existing current student/bulk lifecycle, retained refund ID/read-back, partial/full safeguards and adverse holds | Prior PostgreSQL/provider evidence retained | Existing LIVE transport remains gated; no new settings | Lifecycle/reference/event tables and required guards missing | No | Refund acceptance/completion not newly verified |
| Receipts/ledger | Existing verified-payment/allocation-backed read models and role-filtered history | Prior fixture/type evidence retained | No separate payment authority inferred from a receipt | New lifecycle/aggregate dependencies absent; legacy schema not globally audited | No current connected receipt/print journey | App receipt is not merchant settlement/bank proof |
| Free Academic Terms | Owner-only, one saved school calendar term, reason/confirmation, audit and no invented payment | Prior 26 PostgreSQL, 17 HTTP and 24 route/component checks retained | Not a payment/provider feature | Both tables present, but **0/2 functions and 0/3 required triggers** in Production replica | Not verified | Not applicable |
| Field Operations SMS | Existing single/multi list selection, session-bound cookie reads, exact preview and explicit confirmation | Prior 144-check layered evidence; partial desktop simulation | Provider/key/sender entries exist; consent/Owner controls/runtime selection not certified | Four SMS tables and common lifecycle absent | Not verified; mobile browser pass was previously skipped | No real SMS sent/receipt verified |
| Telegram/in-app recovery | Existing durable holds, consent withdrawal, channel isolation, identity-local UI and Lagos time display | Prior communication/Telegram/inbox/component evidence retained | Serving logs report Telegram configuration READY; token entry exists | Full notification schema not re-audited; source recovery does not establish target parity | No recipient-owned connected acceptance | No physical/recipient delivery certification |

### Configuration evidence, not activation

Read-only Production configuration inspection found:

- `EDUCORE_FLUTTERWAVE_MODE=LIVE`.
- `EDUCORE_FLUTTERWAVE_RELEASE=SCV3_V1` — an older release identifier, **not**
  the separate current direct-student release approval.
- `EDUCORE_FLUTTERWAVE_DIRECT_RELEASE` has neither an environment value nor a
  secret entry. Its source-required value is `STUDENT_DIRECT_3200_V1`.
  **It was not set.**
- Existing direct callback:
  `https://educore.yetenia.com/api/flutterwave/direct-student/callback`.
- Existing direct webhook:
  `https://educore.yetenia.com/api/webhooks/flutterwave/direct-student`.
- LIVE secret/webhook-hash, BulkSMSNigeria token/sender, SMS selector and
  Telegram bot token entries exist. **No secret values were retrieved.**

Presence and canonical URLs do not prove key validity, dashboard registration,
environment separation, account credit, current merchant binding or delivery.
Retain the Owner's previously reported merchant/sender approvals; this review
does not declare them missing or require unnecessary replacement.

## 4. Genuine source repair made in this effort

**Staff V3 webhook authentication was inconsistent with its own provider.**
Checkout/verification use the existing Flutterwave V3 TEST adapter, but the
staff webhook independently expected `flutterwave-signature` HMAC and the
unrelated `FLUTTERWAVE_WEBHOOK_SECRET` selector.

The current official [webhook guide](https://developer.flutterwave.com/docs/webhooks)
was rechecked: its V3 guidance specifies the configured `verif-hash`.
The older versioned guide URLs returned 404, so stale search snippets were not
used as protocol evidence.

The route now invokes the existing mode-bound V3 adapter's constant-time
authentication **before JSON parsing, database work or financial processing**.
Missing authenticators/configuration or invalid headers fail closed. There is
no HMAC/hash fallback, credential fallback, new provider or new financial
authority. Independent amount/currency/reference/status verification, webhook
raw-body size/simulation checks and durable financial handling remain.

Changed application files:

- `artifacts/api-server/src/routes/staff-nfc-billing.ts`
- `artifacts/api-server/src/routes/staff-nfc-billing-service.ts`

Changed focused fixtures:

- `artifacts/api-server/src/app.local-split-simulation.test.ts`
- `artifacts/api-server/src/routes/staff-nfc-billing-service.test.ts`

The unused, incorrect HMAC helper and its obsolete unit expectation were
removed. Actual-app no-network controls now use the real V3 authenticator with
synthetic configuration. The pre-existing student webhook stub was aligned
with its required synchronous `authenticateWebhook` method, not an obsolete
`handleWebhook`-only shape. No student payment implementation was changed.

**This repair does not implement or activate staff LIVE.** Its remaining exact
source gap spans checkout selection/reservation mode, independent verification,
webhook binding, refunds/reconciliation and an explicit staff-scoped operational
release boundary. Do not substitute a LIVE adapter into the SANDBOX path, reuse
a student approval for staff, relabel stored rows, or rely on a global LIVE
mode switch. Completing that coordinated path remains a prerequisite for
claiming all intended capabilities are source-complete; it was not fabricated
as a configuration fix or replaced with a new payment architecture.

## 5. Targeted schema findings and delivery plan

The current source candidates were **read and hashed, not executed**:

| Reviewed source artifact | Current status | SHA-256 |
|---|---|---|
| `0179_restore_direct_and_bro_guards.sql` | Required restore definitions; no Production installation found | `09e2f989c23d80d580bc2428ddd38b962715f11d0c70700e975ab5ca9809c21b` |
| `0181_current_subscription_lifecycle.sql` | All 3 tables absent in shared Development and Production replica | `dd9c559b3d43b18801e090cd567de32d04f605bea2d35987368a1a78bf9273fe` |
| `0182_current_bulk_withdrawals_field_sms.sql` | All 12 tables absent in both inspected targets | `acdcf3d7ef2ad1671be347fc0d4477d72ad7425e66144c2fd779eb14d7dedacf` |
| `0183_owner_free_academic_terms.sql` | Development installation already approved/completed previously; Production tables present, procedural enforcement missing | `620727863cc3b8d40d42be7929686f3e90eb0a3f05f7d4b6136bc23787608d0b` |

Paths above are under `lib/db/drizzle/`. Hashes identify existing candidates,
**not permission or instructions to execute them in Production**.

All seven targeted zero-argument public functions were absent in Production:

1. `guard_student_direct_history`
2. `guard_student_direct_attempt`
3. `guard_bro_term_commission_history`
4. `guard_bro_term_commission_scope`
5. `guard_current_bulk_scope`
6. `reject_free_term_evidence_mutation`
7. `validate_free_term_scope`

The targeted Production trigger inventory found none of the nine direct/BRO
bindings or the three Free Academic Terms bindings. Shared Development has the
four direct/BRO functions and nine enabled bindings, and the two free-term
functions and three enabled bindings. `guard_current_bulk_scope` is absent
there along with its unapplied extension. This updates older reports that
described 0183 as entirely unapplied or inferred parity from table presence.
This was a presence/binding review; unchanged approved function bodies were
not repeatedly re-certified where already fixture-tested.

### Smallest safe schema order — approval required, not performed

1. Establish authoritative serving-primary/resource/runtime-role mapping and
   accepted recovery coverage. A replica query, database name or configuration
   fingerprint alone is insufficient.
2. Resolve the **supported managed-Production procedural delivery mechanism**
   for these functions/triggers first. Publish's ordinary structural diff does
   not carry the required procedural objects. Do not assume manual SQL,
   startup/build DDL, a custom migration hook, elevated ownership, ledger edits
   or an external database migration is an approved substitute.
3. With separate approval, install **0181 then 0182 in verified shared
   Development**, after confirming existing 0179 prerequisites and the exact
   current target/checkpoint. No repeat 0183 Development installation is needed.
   These introduce 15 new tables, constraints/indexes, 3 lifecycle history
   triggers, 12 extension history triggers, one bulk-scope function and two
   scope triggers. Review locks, FK validation, target data and rollback
   retention; do not run them merely to make a screen load.
4. Review a fresh structural Publish preview against existing Production rows.
   Preserve dependency ordering, tenant keys, CHECK semantics and histories.
   Table/index/CHECK parity is a different acceptance from function/trigger/ACL
   parity. No broad schema rewrite or database replacement is proposed.
5. Only after a supported mechanism and separate Production/publication
   approval exist, deliver the structural and procedural portions in their
   dependency order with payment/notification release gates held closed.
   Verify exact bodies, function properties, trigger table/function/event
   bindings, enablement and runtime rights against existing contracts.

**Free Academic Terms specifically:** preserve the two existing Production
tables and any records. Review their columns, tenant FKs, indexes and CHECKs
against the existing 0183 model; do not recreate tables or blindly reapply the
whole candidate. Deliver/verify the two existing approved functions and
`owner_free_terms_immutable`, `owner_free_term_events_immutable`,
`owner_free_terms_scope` through the supported mechanism. Match the saved
school/session/term, immutable grant/event evidence and role rights. Then
perform separately authorized Owner/read-only status acceptance; creating an
actual free-term grant is a distinct business decision. This grants access,
not payment, refund, bank credit or BRO earnings.

**Stop condition:** no supported procedural mechanism is established in this
workspace. Owner approval alone cannot manufacture it. Until resolved,
direct/BRO/current lifecycle and free-term Production activation remain no-go.
No executable Production installation script was created.

## 6. Operational recovery findings

### Field Operations SMS

Reuse [the focused SMS report](field-operations-sms-fix-completion-report.md).
The earlier `SESSION_REQUIRED` was a generic client label for an HTTP 401.
Logs showed 401 around Clerk refresh, successful protected reads afterwards,
then SMS-specific **503** responses. This is not evidence of permanently broken
sign-in or a need for browser bearer tokens.

Source already waits for an active session, keys by user/session, uses
same-origin cookies and retries only a 401 read once. Selection/preview is
cleared on session change; mutations never automatically retry. Owner list
selection, reasons/exclusions, exact frozen message/count and explicit
confirmation exist. Do not rebuild them. Exact Clerk-internal cause and
authenticated Production acceptance remain unverified; missing storage is a
separate confirmed blocker. Preserve verified consent and unknown-send holds.
The previously skipped mobile browser test was **not rerun**.

### Telegram and in-app

Reuse the durable queue/link/consent recovery already documented in the
completion report. Missing personal linkage/temporary health holds do not
consume provider attempts; explicit opt-outs, expired/inapplicable notices,
accepted/sent work and uncertain outcomes must not be replayed.
Only the documented old no-provider-attempt unavailable failures qualify for
bounded recovery. In-app history remains independent of Telegram delivery.

New serving-log observations on this date:

- Telegram configuration health repeatedly reported `configured:true`,
  `ready:true`, `reason:READY`.
- At **16:31:02 UTC**, the communication delivery worker failed acquiring a
  database connection; at **16:31:18 UTC**, the teacher intent worker and
  communication worker also reported connection-acquisition timeouts.
- The later public `/api/readyz` succeeded. This does not prove sustained pool
  health, backlog processing, recipient consent or message receipt.

Therefore “replace the bot token,” “relink everybody,” “restart workers” and
“replay all failures” are not supported remedies. The exact evidenced runtime
blocker is **intermittent database acquisition failure**, not missing Telegram
configuration. Its underlying cause (connection budget, contention, target
availability or another runtime issue) was not established; no speculative
pool increase, infrastructure change or worker intervention was made.
Recipient-owned links/preferences, channel selections, launch cutoffs and
current authorization still need connected acceptance.

Existing Production workers were observed, not activated by this review.
Development workers remained paused after the single Development restart.

## 7. Smallest ordered go-live checklist

Each unchecked item is a stop gate, not an instruction or authorization.

1. **Resolve technical feasibility first.** Obtain a supported managed-target
   procedure for required functions/triggers and authoritative primary/runtime
   mapping/recovery evidence. Risk: silent missing immutability/scope controls.
   **Needs platform/operator mechanism plus explicit schema/recovery approval.**
   Do not fund repeated broad audits while this hard blocker remains.
2. **Close remaining source-only gaps without changing authority.** Finish the
   coordinated staff ₦2,000 LIVE path with separately reviewed staff release
   gating; retain TEST and historical SANDBOX verification independently.
   Reuse existing components/transports and focused fixtures. No global
   selector swap or student-release reuse. Unsupported incoming BRO recovery/
   collection-reversal evidence and unresolved policy must stay explicit holds,
   not invented capabilities. **No Production permission is implied.**
3. **Approve Development schema delivery once**, then inspect exact scoped
   parity. Deliver 0181→0182 only after target/recovery/prerequisite approval;
   reuse already-installed 0183 and existing fixture evidence. Risk: locks,
   dependencies and retained evidence. **Separate shared-Development approval
   required.**
4. **Approve a single coordinated Production delivery/release candidate**:
   current reviewed source (including SMS and staff V3 correction), structural
   diff and separately supported procedural enforcement. Hold release flags,
   rule activation and send controls closed. Verify target contracts/rights,
   not just build success or migration ledger. Risk: deployment/schema mismatch
   and inadvertent activation. **Production schema and publication approval
   required; neither was requested from a publish action here.**
5. **Complete one connected, authorized runtime acceptance pass**, not a broad
   retest: Owner/BRO/school/staff scoped reads, receipts, free-term status,
   SMS session/selection/preview without sending, current in-app history and
   personal Telegram state. Include previously unverified mobile controls.
   Observe/reconcile notification DB acquisition failures before operational
   release; do not mark a backlog delivered from READY alone.
6. **Approve exact financial scope through existing governance**: saved school
   term/calendar, student/staff price and rule version, independently funded
   BRO rule, exact merchant binding, fresh reconciliation, reviewed unexpired
   release, endpoint/hash environment binding and provider evidence. Only then
   consider the current direct release selector, never the retired SCV3 flag
   as a substitute. **Rule/release/setting changes require their own approval.**
   School collection cannot start before its real eligible January term.
7. **Authorize bounded external acceptance only if required evidence is still
   missing.** Name the eligible school/term, approved recipient/account, exact
   amount/content, one transaction budget and reconciliation/stop procedure.
   Reuse valid prior merchant evidence first. Independently verify the charge,
   retained refund ID/completed refund, correct ledger/receipt and actual bank
   payout separately. A BRO withdrawal must use genuine earned/matured approved
   entitlements; do not create fake earnings. **Real charges, refunds, transfers
   and SMS/Telegram each need explicit separate authorization.**
8. **Approve controlled operational recovery**, only after database health and
   recipient/channel eligibility are established. If worker changes/restarts
   or external delivery activation are needed, name them before action.
   Process only existing authorized queued/proven-unsent work; never replay
   unknown, opted-out, cancelled or accepted work. **Worker/send approval is
   separate from schema, source deployment and financial approval.**

If all intended capabilities must launch together, the staff source gap and
unsupported recovery/evidence boundaries cannot be hidden by enabling student
LIVE. If a later phased scope is chosen, record its exclusions explicitly;
this report does not choose or authorize that scope.

## 8. Evidence reused and new verification cost

Reused, without adding overlapping counts or claiming a fresh combined run:

- [Current payment completion](current-payment-completion-report.md):
  student refunds/BRO lifecycle, real aggregate flow, receipts, durable
  notification recovery, API/component contracts and existing type evidence.
  Its 23 financial-integration cases were subsequently extended to 26 in the
  SMS report; they are not 49 distinct tests.
- [SMS completion](field-operations-sms-fix-completion-report.md):
  144 distinct layered checks, including 26 financial PostgreSQL cases;
  cookie-verifier/transport fixtures, not genuine sign-in or real delivery.
- [Free-term completion](owner-free-academic-terms-completion-report.md):
  26 distinct PostgreSQL, 17 HTTP and 24 route/component checks, exact
  disposable delivery/rollback rehearsal and separately approved Development
  installation. Its latest installation section supersedes older statements.
- [Direct LIVE blockers](live-payment-unresolved-blockers-2026-10-28.md) and
  [January preparation](january-2027-replit-payment-preparation.md):
  prior guard/body, verification, idempotency, calendar and release tests.
  Old empty rule/review counts are historical, not represented as a fresh
  Production financial audit.

New checks only:

- **23 passed, 24 skipped** in the actual-app raw payment-webhook group of
  `app.local-split-simulation.test.ts`; synthetic V3 adapter, blocked
  database/provider/identity/fetch/socket access, no external transaction.
  Correct hash reaches control/parsing; absent/wrong/unsupported authentication
  fails, missing authenticator fails closed, malformed authenticated JSON and
  simulation markers cannot reach accounting.
- API TypeScript and `git diff --check` passed.
- Initial cold full-app fixture import exceeded its 10-second hook; the hook
  now has a bounded 30-second allowance. A pre-existing incomplete student
  adapter mock then produced 503 rather than 401; only the mock contract was
  corrected. Final count above is the passing focused run, not accumulated
  attempts. No runtime timeout or payment gate was relaxed.
- One Development API rebuild/restart; startup explicitly reported all
  Development background workers paused, and `/api/healthz` returned 200.
- Targeted read-only catalogs/configuration/public bundle/health observations.
  No broad schema diff, audit scan, payment-history scan, browser test,
  disposable PostgreSQL rerun or new real-provider exercise was performed.

**Final acceptance boundary:** source repair and focused fixtures are complete.
The report/checklist is ready for review. All-capability source completion,
Production procedural enforcement, authenticated connected acceptance,
financial/worker activation and real-provider confirmation are **not complete
and are not authorized by this report**.
