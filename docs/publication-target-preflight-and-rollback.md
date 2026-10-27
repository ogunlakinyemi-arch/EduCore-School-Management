# Publication target preflight and rollback

**Status: Development preparation only; not permission to publish, migrate,
restore, change credentials or activate LIVE.** No Production action was run
for this document. Existing Owner binding/recovery confirmations remain valid
as operator-provided evidence, not an independently verified current target.

## Runtime evidence and health

- `/api/healthz` and `/api/readyz` are mounted before identity/device/payment
  routers. Only these health routes bypass authentication; protected routes do
  not. `readyz` uses the application's existing bounded connection pool, a
  read-only transaction, a local two-second statement limit and `SELECT 1`.
  It rolls back/releases and returns only `{ready,dependency}` with 200/503.
  In-flight/recent probes are coalesced. No pool limits/timeouts are changed.
- Startup `DATABASE_RUNTIME_IDENTITY` logs and the authenticated global Owner
  `/api/platform/pilot-readiness` response include `runtimeDatabase`.
  This reuses the existing resolved pg host/port/database SHA-256 prefix, never
  a raw URL, hostname, username, password or database name.
- `servingRevision` comes only from a valid Cloud Run `K_REVISION`, if the
  platform supplies it. Otherwise it is null with source `UNAVAILABLE`.
  It is NOT a guessed Replit build ID. `platformDatabaseResourceId` is always
  null and `targetBindingVerified` remains false. A configuration fingerprint
  does not prove a writable primary or a successful connection.

## Identity gate, before choosing a migration/restore target

Record, in the operator's existing evidence system:
1. Current serving revision/build and intended platform database resource ID.
2. Its non-secret runtime configuration fingerprint and the independently
   confirmed resource mapping. Use existing control-plane/connection metadata;
   never export credentials or accept a caller's `verified:true` as proof.
3. Read-only catalog output from that same bound target; `pg_is_in_recovery()`
   must distinguish primary from replica. A writable primary observation alone
   does not prove it belongs to this app.
4. Current resource-bound restore point/time and approved isolated recovery
   target. Screenshot backup/PITR settings show configuration, not a successful
   restore. Record restored data/audit/file evidence and measured recovery time.

If any identity differs or cannot be confirmed, STOP. Do not use the workspace
connection, a readable replica, a shared name such as `neondb`, or a secret's
mere presence as a substitute. Capture exact SQL/source hashes before review.

## Reviewed migration scope and known compatibility gaps

Apply no SQL here automatically. Review the complete actual target schema and
ledger, not just filenames or ledger entries. The relevant ordered set is:

| Draft | Required changes |
|---|---|
| 0175 | `staff_nfc_billing_rules.ends_at`; `subscription_rule_proposals`; `subscription_payment_assistance_requests`; proposal-window, queue, open-request and bank-credit uniqueness indexes |
| 0176 | `student_direct_live_reviews`, `student_direct_live_obligations`, `student_direct_live_attempts`, `student_direct_live_events`; open/paid-attempt uniqueness; immutable-history/attempt-transition functions and triggers |
| 0177 | `student_direct_live_release_requests`, `student_direct_live_release_decisions`, `student_direct_live_review_bindings`; latest-decision index and append-only triggers; depends on 0175/0176 |
| 0178 | `bro_term_commission_entitlements`; student/term and direct-attempt uniqueness; append-only and exact verified-payment/attribution/approved-rule guards; depends on 0175/0176 |

Earlier **replica** evidence (27 October 2026, 20:19 UTC) found new tables absent.
After the later publication, replica evidence at 21:46 UTC found all ten expected
tables, staff `ends_at`, validated inspected constraints and valid/ready indexes,
but all four source guard functions and nine triggers were absent. The platform
ledger records 50 statements for that build. Neither this replica observation
nor the ledger establishes the serving primary or procedural source parity.
Table existence alone is not compatibility.

Use the single SELECT in `docs/direct-release-schema-preflight.sql` for
columns/defaults, validated constraints, valid/ready indexes, trigger enablement,
functions, privileges, RLS and endpoint role. Compare its output to exact
0175–0178 source definitions and `inspectDirectReleaseSchema` in the release
service. It deliberately neither declares identity verified nor applies fixes.
Catalog privilege observations must be repeated under the actual application
role; admin/superuser success is not proof of runtime permission.

For the subsequently observed four-function/nine-trigger procedural gap, see
`docs/financial-guard-repair-0179.md`. Source-only 0179 does not authorize a
Production migration; an empty structural Publish diff does not certify guards.

Prerequisites include the existing schools, students, users, sessions/terms,
Partner profiles/attributions and staff billing engine. Resolve pre-existing
objects and same-name/different-definition constraints explicitly; do not
blindly rerun IF NOT EXISTS scripts or infer ledger completion.

## Credential-free rehearsal before a future installation request

Reuse, do not replace, existing native fixtures:

```
env -i PATH="$PATH" HOME=/tmp NODE_ENV=test node scripts/src/owner-subscription-rules-native-check.mjs
env -i PATH="$PATH" HOME=/tmp NODE_ENV=test node scripts/src/bro-commission-native-check.mjs
node scripts/src/direct-student-live-offline-review.mjs
```

The native runners reject inherited app/DB/provider credentials and verify a
fresh disposable Unix-socket PostgreSQL target. Existing fictional fixture
success is NOT proof that the exact serving schema upgrades or restores.
For release approval, rehearse the exact reviewed source/target baseline and
diff on an approved isolated target, including actual indexes/triggers and
runtime-role permissions. Preserve legacy financial/audit snapshots; test
partial-failure rollback, duplicate/lost-response/refund paths, manual locks
and tenant denials. Providers remain mocked and LIVE switches disabled.

**Transaction trap:** 0178 contains its own BEGIN/COMMIT; do not concatenate
all four raw files inside one outer transaction and assume atomicity.
Review any normalized transaction-control plan as a separate exact artifact,
prove it on the fixture, and match its hashes/order before any future execution.
No Production migration or rehearsal against a live database is authorized.

## Concrete rollback procedure for a separately authorized operator

Before change, retain the known-good code/build reference, schema-only catalog
baseline, actual ledger baseline, reviewed migration hashes and same-resource
recovery point. Keep LIVE disabled; record a responsible recovery operator and
approved isolated restore target. Never store credential values in this file.

1. **Failure before commit:** rollback on the same pinned migration connection.
   Verify catalogs, ledger, existing financial/audit counts and retained record
   fingerprints against baseline. If a connection dies, inspect commit state
   read-only; never assume timeout means rollback or retry blindly.
2. **Schema committed, code not released:** leave compatible additive objects
   installed and keep prior code/financial gates unchanged. Do NOT use DROP
   CASCADE, drop `ends_at`, rewrite the ledger, or remove append-only history.
   Prove prior-code compatibility on the isolated upgraded schema first.
3. **Code released then fails:** stop the release; with separate authorization,
   restore the recorded known-good code build while retaining compatible
   additive schema. Verify liveness, DB readiness, tenant/manual-lock checks
   and critical authenticated reads. Do not replay uncertain provider actions.
4. **Data repair/restore required:** do not perform an in-place destructive
   downgrade. Restore the bound pre-change point into the approved isolated
   target, verify history and any post-point financial/audit writes, then
   obtain explicit approval for reconciliation/cutover. New obligations,
   attempts/events, reviews/decisions/bindings, BRO liabilities, assistance
   and external payment outcomes must be retained/reconciled, never discarded.

Stop on identity mismatch, missing recovery proof, unreconciled partial commit,
new financial evidence, changed hashes or dependency ordering. This procedure
does not authorize restarting Production, publishing or executing a restore.
