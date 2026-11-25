# Controlled payment remediation — implementation and verification outcome

## Outcome

**Partially completed; Production remediation remains blocked. LIVE collection
was not activated. No Production migration or rule mutation was executed.**

The Owner's Option A remains authoritative: the current term is free; the first
paid period is each school's actual configured January 2027 second term, not an
invented universal January start. No collection date or financial policy changed.

## Source changes

- `artifacts/api-server/src/services/current-bulk-subscriptions.ts`: fixed a
  reproduced race where a delayed checkout response appended READY or UNKNOWN
  after an independently verified callback had already recorded VERIFIED or
  COMPLETED. Checkout outcomes now append only while the batch is PROCESSING,
  under the existing financial transaction gate. No provider retry was added.
- `current-finance-integration.postgres.test.ts`: added four real-PostgreSQL
  cases covering anonymous/authenticated verification followed by a successful
  or lost checkout response. All four failed before the fix. They now retain
  one confirmation, two allocations and two eligible BRO entitlements, with one
  checkout invocation and no revived checkout URL.
- `financial-history-writes.test.ts`: corrected the application-source scan to
  recognize disposable `.test-support.ts` helpers. Runtime imports of those
  helpers are explicitly rejected; application SQL centralization remains checked.
- `owner-subscription-rules.postgres.test.ts`: corrected concurrency observation
  to recognize the existing global financial gate as well as commission/row
  locks. Added a genuine eligible calendar to the foreign-school payment test:
  a missing calendar intentionally leaves a school non-chargeable and cannot
  prove payment-scope isolation.
- `current-subscription-policy.test.tsx`: Owner assertions explicitly render the
  internal policy view; a new assertion preserves BRO privacy in the default
  school view. No production UI text or role permissions changed.

Current GitHub main was fetched and compared before editing. Relevant payment
implementation exists in the Replit checkout beyond main. No source was reset,
discarded or pushed.

## Fresh Production observations

These are SELECT-only observations through the Production replica, not primary
write access or a certification of the serving deployment's source revision.
Existing Owner confirmations of serving-resource identity and recovery settings
are accepted, not requested again.

| Object/evidence | Observed result |
| --- | --- |
| Student/direct/BRO verification packet | All 4 function definitions and 9 trigger bindings matched |
| Direct/release/rule/BRO table-presence checks | All 10 passed |
| Free-term functions | Both definition checks failed |
| Free-term triggers | All 3 binding checks failed |
| Free-term tables | Both present |
| Current lifecycle tables | All 3 absent |
| Bulk-payment tables | All 5 absent |
| Current BRO withdrawal tables | All 3 absent |
| Field-SMS extension tables | All 4 absent |
| Current bulk-scope function/bindings | Did not match / missing dependencies |
| Student rule | One DRAFT NGN 3,200 rule, not activated |
| BRO rule | No BRO_COMMISSION row returned |
| Scoped direct reviews, release requests, decisions and bindings | Zero in each table |
| PAID direct attempts / BRO entitlements | Zero in each table |

The observed student draft starts at `2027-01-10T23:00:00Z` and ends at
`2027-04-15T23:00:00Z` (11 January / 16 April at midnight WAT). Neither timestamp
was changed or adopted as a universal school calendar.

Failed verification checks mean "not matching the approved contract"; a false
function check alone is not proof of object absence. This exercise did not
reinstall or alter the already matching Stage 1 functions/triggers.

## Production mutation register

| Requested step | Actual outcome and exact blocker |
| --- | --- |
| Confirm recovery before migration | Existing reported PITR/resource confirmations retained. No callback exposes a current restorable timestamp or backup inventory. No restore test or new snapshot was claimed or created. |
| Apply missing structural schema | Not executed. Production SQL access is SELECT-only; supported managed structural delivery is Publish, expressly prohibited for this exercise. No alternate connection or runner was created. |
| Apply missing free/current procedural objects | Not executed. No authenticated writable Production operator session was available; recovery preconditions were not independently completed. |
| Create/activate Student/BRO rules | Not executed. Owner policy authorization is accepted, but there is no authenticated writable Production execution context; no Owner identity/audit actor was fabricated. Student scheduling also requires the existing scoped review process. |
| School/term reconciliation and release decisions | No records created. No existing scoped release reviews/decisions were returned; missing school/merchant/reconciliation evidence cannot be fabricated. |
| Enable LIVE / set merchant scope or direct release | Not executed; expressly prohibited. |
| Publish / republish / Production restart | Not executed. |

Existing schema candidates were preserved, not duplicated:

- `0181_current_subscription_lifecycle.sql`: operations, events, reference claims.
- `0182_current_bulk_withdrawals_field_sms.sql`: bulk collection, withdrawals and
  field-SMS extension, plus required guards.
- Existing `db/production-activation` procedural and verification packets.

The current extension guard expects the complete existing extension contract,
including field-SMS tables. Installing just five bulk tables would not satisfy
it. The bundle must not be partially represented as a complete payment release
or silently expanded into operational SMS authorization.

The structural SQL candidates are transactional, one-time migrations, **not
idempotent production runners**. First application was exercised only on fresh
disposable schemas. Procedural packet replay/idempotency was separately tested.
Neither fixture result proves compatibility with every populated Production
object or grants permission to apply structural DDL outside the supported flow.

## Automated verification actually performed

All payment tests used a clean environment without inherited application
credentials. PostgreSQL fixtures created independently checked private
Unix-socket clusters. Provider behavior was synthetic/injected and external
network calls were denied in the payment suites.

| Verification | Final outcome |
| --- | --- |
| Focused API suite: 14 files | 317 passed |
| Frontend payment/policy suite: 5 files | 40 passed |
| Isolated Owner-rule/direct-payment routed suite | 44 passed |
| Isolated BRO native checks | 12 passed |
| Offline/disposable activation-package suite | 3 passed |
| API TypeScript check | Passed |
| Whitespace/diff validation | Passed |

Coverage includes individual checkout reservation/replay, uncertain checkout
recovery, V3 verif-hash authentication, independent transaction GET verification,
amount/currency/reference checks, release and calendar refusals, concurrent
finalization, exactly-once BRO accrual, legacy-earning preservation, one genuine
aggregate checkout, aggregate verification, per-student allocation/recovery,
individual/consolidated receipts, refunds, and BRO withdrawal/payout evidence.

Initial failures are not omitted: the API source scan initially failed on a
test helper; the new four-case race regression initially failed in all cases;
the frontend Owner assertion initially used the default school view; and the
Owner-route fixture initially failed first on lock instrumentation, then on
the foreign school's missing calendar. Those defects/fixtures were corrected
without relaxing runtime payment, rollout, authorization or history guards.

Representative commands:

```text
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test CI=1 \
  pnpm --filter @workspace/api-server exec vitest run [14 focused payment files] --maxWorkers=2 --minWorkers=1
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test CI=1 \
  pnpm --filter @workspace/edupulse exec vitest run [5 focused payment files] --maxWorkers=2 --minWorkers=1
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  node scripts/src/owner-subscription-rules-native-check.mjs
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  node scripts/src/bro-commission-native-check.mjs
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  node --test scripts/src/production-activation-package.test.mjs
pnpm --filter @workspace/api-server run typecheck
git diff --check
```

These are offline/disposable acceptance results, not real LIVE charges, merchant
settlement proof, bank-credit proof, or authenticated Production browser acceptance.

The Development API was rebuilt/restarted once, after confirming the existing
Development worker pause. Startup logs confirmed all Development background
workers remained paused. The anonymous app preview rendered the sign-in page;
it does not certify signed-in payment screens. The separate NFC hardware test
workflow remained failed and was not restarted or repaired in this scope.
The combined log snapshot also contained Production connection-acquisition
timeouts; these were not diagnosed or represented as resolved here.

## Configuration and money movement

Production presence was inspected through secret-existence metadata only:

- Dedicated LIVE server key, LIVE public key and LIVE webhook hash: present.
- LIVE mode and expected direct callback/webhook URLs: configured.
- Merchant-scope selector: absent.
- Direct-release selector: absent.

No actual secret value was read or printed. No setting or secret was changed.
Presence does not prove credential validity, dashboard registration or settlement.

No real Flutterwave checkout, charge, refund, transfer, subaccount operation or
message send was initiated. No historical rows, split tables, allocations,
receipts, student/school records or BRO earnings were rewritten or deleted.
No shared Development financial fixture or rule was inserted.

The remaining Owner-controlled and delivery gates are explicit: supported
structural delivery within the no-publish boundary is unavailable; writable
operator access and a usable recovery point are not established here; Student
and BRO rules remain unscheduled; scoped release evidence/decisions remain
absent; merchant scope/direct release remain unset. LIVE remains disabled and
the first paid period remains each school's January 2027 second term.
