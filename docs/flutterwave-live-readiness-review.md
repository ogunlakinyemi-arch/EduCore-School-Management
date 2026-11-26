# Flutterwave LIVE readiness — source-only review

Review date: 2026-11-26.

## Outcome

Verified source-model gaps were corrected and offline checks pass. **This is not
LIVE certification, approval to publish, or approval to collect or move money.**
No application database, real credential, provider endpoint or published
application was accessed. The existing draft PR was left untouched.

## Consolidated findings and corrections

| Area | Finding | Disposition |
| --- | --- | --- |
| Current finance | Existing 15 models plus five prerequisite models already matched their reviewed source definitions. | Retained; expanded parity coverage continues to check them. |
| Direct collection history | `student_direct_live_events` was absent from the active schema. | Added its complete structural model from 0176. |
| Release evidence | Requests, decisions and review bindings from 0177 were absent from the active schema. | Added all three complete models, including source keys, CHECKs, relationships and descending-index NULL ordering. |
| Subscription governance | Two existing 0175 models combined/renamed source CHECKs. | Restored individual source constraints and their names, retaining nullable CHECK behavior. No rule rows were created or activated. |
| Free terms | The two existing 0183 models were not exported by the active schema. | Registered their existing definitions, preserving composite tenant keys and RESTRICT actions. No grant was created. |
| Parity tooling | The narrower reader did not cover these schema-qualified tables, composite FKs or nested normalized-credit index. | Extended only the reviewed grammar and added regression checks; unsupported index expressions fail explicitly. |
| Procedural protection | ORM metadata does not install or verify database functions/triggers. | Left authoritative SQL and strict runtime catalog gates unchanged. Native proof remains outstanding. |

No payment route, webhook, provider adapter or runtime authorization change was
supported as necessary by this source review. Those paths were not relaxed.

## Policy and payment-path boundaries retained

- Student platform collection: **NGN 3,200 per eligible student per academic term**,
  school share zero, collection BRO share zero.
- BRO entitlement: **NGN 150**, separately funded platform expense, only after an
  eligible independently verified collection and approved prospective policy.
  Existing attribution, historical records and manual payout authority remain.
- The current-term free rollout and each school's actual January-2027 second-term
  eligibility remain controlled by existing school-calendar logic.
- Owner free-term grants remain non-payment entitlements with separate audit and
  procedural readiness requirements; exporting their models does not grant one.
- Direct checkout still requires explicit LIVE configuration/release, complete
  reconciliation, matching approved evidence and native-schema readiness.
- Redirect/webhook identifiers never establish payment facts. Independent
  transaction verification, durable claims, uncertain-response reconciliation
  and exactly-once protections remain in place.
- The direct V3 webhook retains constant-time `verif-hash` authentication and
  accepts `charge.completed`. Broader adverse-event handling is not established
  by this path; no V4 HMAC/refund/reversal contract was invented.
- TEST/LIVE credential separation and refusal of cross-mode fallback remain.
  Actual configuration, webhook registration and provider capabilities were
  intentionally not inspected or exercised.

## Verification actually completed

All commands used a clean environment with no inherited application credentials.

- **47 passing offline tests**: 37 expanded model/parity regressions, two packet
  source checks and eight schema-tooling safety checks.
  - Explicit files: `current-finance-schema.test.mjs`,
    `production-activation-package.test.mjs`, `schema-tooling-policy.test.mjs`.
  - The native packet test was expressly excluded with
    `--test-skip-pattern='^isolated PostgreSQL:'`.
  - Parity covers 28 complete models; existing delivery packets still match their
    unchanged SQL sources. Push/force-push gates remain disabled.
- **89 passing existing mocked unit tests across six explicit files**:
  payment-mode selection, Development configuration, financial guard checking,
  rollout policy, verified BRO accrual and current provider adapters.
  - Outbound/database socket guards were installed, along with a native
    PostgreSQL child-process guard.
  - These results are not actual provider, SQL-catalog or concurrency evidence.
- Database package TypeScript check passed:
  `tsc -p lib/db/tsconfig.json --noEmit`.
- Credential-free dependency-ordered metadata export completed: **222 tables,
  799 foreign keys, 1,420 statements**. SQL was generated in memory, not executed.
- `git diff --check` passed.

### Discarded test attempt

An initial command-formatting error selected broad Vitest discovery rather than
one intended file. It failed/timed out under socket guards. A discovered native
suite initialized a fresh temporary local cluster despite the intended scope;
its client connections were blocked. The test processes stopped and the temporary
cluster directory was removed. No application database or provider was reached.
That run is excluded from all validation claims above and supplies **no**
PostgreSQL readiness evidence.

## Remaining blockers and minimum next evidence

1. **No compliant native rehearsal.** The fresh `unshare --net` probe failed with
   `Operation not permitted`. Installed binaries, a socket-only cluster and
   passing mocks do not prove the required no-egress isolation.
2. **No target installation/catalog proof.** Application databases were prohibited,
   including reads. Their schema, guard definitions, roles and release state are
   unknown; source registration is not migration delivery.
3. **No real SQL rollback/concurrency proof.** Installation, retained-history
   protection, replay and exactly-once behavior need the existing native checks
   on an explicitly selected synthetic fixture in a verified no-egress runtime.
4. **No provider/configuration certification.** TEST structure is not TEST
   acceptance; neither is LIVE collection, refund, reversal or payout readiness.
   These require separate authorization and appropriate contract evidence.
5. **No operational release.** Active rule/release evidence, funding and calendar
   eligibility must be established through approved workflows, not seeded for
   this review.

The minimum next step is a fresh credential-free PostgreSQL fixture inside a
runtime that can actually enforce no outbound network, with explicitly scoped
native checks and no application connection fallback. No additional GitHub
workflow experiment is proposed. No app restart, migration, financial SQL,
credential/webhook change, provider operation, activation, publishing or push
was performed.
