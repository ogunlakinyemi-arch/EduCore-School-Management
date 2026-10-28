# Direct Flutterwave LIVE — consolidated readiness evidence

Inspected 28 October 2026, approximately 11:21–11:30 UTC.
**Overall: NO-GO. Operational acceptance is blocked, not approved.**
One coordinated check; no separate tasks, provider transactions or deployment.

## Production schema and supported installation route

- The supported Production SQL callback explicitly reached a **read-only replica**:
  `pg_is_in_recovery()=true`, `transaction_read_only=on`.
- All ten direct-payment/rule/assistance/BRO tables were observed there.
- None of the four required guard functions or nine required triggers were
  observed. Function bodies, trigger bindings and enablement therefore cannot
  pass the procedural contract.
- The platform migration ledger had eight entries and 1,321 statements; its latest
  timestamp was 27 October 2026 at 21:27:47 UTC. These are replica observations,
  not proof that repository migrations or procedures ran on the serving primary.
- A fresh supported Publish preview returned success, zero statements and no
  structural diff. This does **not** certify procedural equivalence.
- Replit's managed-database migration instructions expose Publish as the
  supported production-schema mechanism, prohibit custom production runners,
  deploy-build/startup DDL and direct Production DDL, and expose no supported
  install/maintenance route for these protected procedural objects.
- Prior supplied Support confirmation remains applicable. Generated documentation
  search advice suggesting deploy-build migration commands conflicts with the
  explicit managed-database instructions and was not followed.

**Exact blocker:** no exposed, supported Replit route to install, preserve and
verify these four functions/nine triggers on the independently identified writable
serving primary. No SQL installation or post-install success is claimed.

No migration was attempted, so no backup or rollback was executed. Before any
future supported installation, require authoritative primary/resource binding,
accepted restore-point/recovery evidence, reviewed exact function/trigger
definitions and ownership, bounded-lock preflight, transactional minimal
installation and catalog/behavior verification on that same primary. On failure,
roll back the uncommitted installation; do not remove financial evidence or
restore older approvals. A replica or disposable fixture cannot certify recovery.

## Configuration and public endpoint checks

- Deployment metadata: public Autoscale deployment, successful build reported,
  primary URL `https://educore.yetenia.com`. This does not prove its source revision.
- Production settings select `EDUCORE_FLUTTERWAVE_MODE=LIVE`.
- Dedicated LIVE secret key, public key and webhook verifier: **present** through
  existence-only inspection. Their values were not read, printed or tested
  against Flutterwave; presence is not merchant authentication.
- The saved legacy release remains `SCV3_V1`; the direct release switch and
  merchant scope are absent. Neither was enabled or fabricated.
- Staged and read back only these non-secret Production URL settings:
  - `EDUCORE_FLUTTERWAVE_DIRECT_CALLBACK_URL=https://educore.yetenia.com/api/flutterwave/direct-student/callback`
  - `EDUCORE_FLUTTERWAVE_DIRECT_WEBHOOK_URL=https://educore.yetenia.com/api/webhooks/flutterwave/direct-student`
- Official guidance says changed Production settings need republishing to take
  effect. No publishing/redeployment was performed; saved URL values do not prove
  the serving runtime loaded them or that Flutterwave registered them.
- An unsigned, identifier-free `{}` POST to the direct webhook returned **401**
  `WEBHOOK_AUTHENTICATION_FAILED`.
- A callback with an invalid/foreign reference and nonnumeric transaction ID
  returned **409** `DIRECT_LIVE_RELEASE_DISABLED`.
- These probes demonstrate reachable routes and fail-closed responses only:
  **no real signature acceptance, Flutterwave dashboard registration or genuine
  webhook delivery was verified.**

Previously reported Owner/provider confirmations are acknowledged. They are not
replaced with invented merchant identifiers or new, scoped release approvals.

## Non-charging acceptance evidence

62 focused application checks passed across direct transport/configuration,
public callback/webhook handling, student NFC evidence and BRO policy.
Four selected private disposable-PostgreSQL scenarios passed, without inherited
application credentials, TCP exposure or real provider transport:

1. Missing procedural-object gates block callbacks/webhooks.
2. Failed event persistence rolls back the attempt transition.
3. Expiry is derived without mutating history; explicit expiry appends evidence.
4. A reviewed direct checkout binds its reference and exact NGN 320,000 minor
   amount, with no split/subaccount payload. Unknown references fail before
   provider access. Pending/failed payments and assistance receipts cannot pass
   NFC eligibility. A successful independently verified payment passes only for
   its correct school/student/current term. Separate assisted checkout succeeds
   without converting its offline receipt into a paid provider transaction.
   Replays preserve the attempt and one success event.

The fourth scenario now holds the actual attempt row and observes **two**
independent verifiers waiting on PostgreSQL locks before releasing it. Both
return the same paid result; only one verified-success event exists afterward.
This proves isolated service-level contention behavior, **not full deployed
HTTP webhook throughput or provider retry/delivery under contention**.

API TypeScript check passed. These focused checks are not a full browser,
physical-hardware or external merchant acceptance test.

## Operational gates still requiring evidence

- Replica observations: zero price-rule proposals, scoped direct reviews,
  release requests, release decisions, bound approvals, direct attempts/events
  and independent BRO entitlements. No approvals or financial rows were seeded.
- A current eligible calendar observation remains a first term ending
  18 December 2026. A January second-term observation starts 11 January 2027,
  is not current and is inactive. Observations belong to their own schools:
  no cross-school calendar or release is inferred.
- No current effective NGN 3,200 rule and exact school/student/term release scope
  can be certified from these observations. Ordinary current-term free access
  remains unchanged. January activation needs the school's genuine calendar,
  effective rule, fresh reconciliation and explicit unexpired Owner release.
- Direct verification preserves pending/unknown references rather than creating
  replacement charges. Existing-reference callback/webhook verification can
  reconcile when a valid transaction identity is available. Automated recovery
  of a completely missed event/unknown transaction ID, delayed parent
  notification delivery and operational escalation remain unproven.
- Genuine Owner operational acceptance and exact provider-side merchant,
  non-split settlement, callback/webhook registration and delivery/retry evidence
  remain required. No external dashboard action was performed.

## Preserved boundaries

No real LIVE/TEST provider charge, transfer, notification, Production financial
write/deletion, secret change, DDL, release approval, LIVE enablement or public
publishing/redeployment. Cash/bank assistance is not payment. Eligible NGN 150
BRO entitlement stays internal; no split or automatic transfer was introduced.
Free ordinary app access and hardware, assignment and security locks are intact.
