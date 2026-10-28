# Focused unresolved LIVE-payment blockers

## Scope and new observations

This follow-up preserves the ₦3,200 direct collection, zero school/BRO split,
independent BRO expense, school-specific rollout, Option A, immutable history,
audit, idempotency and every fail-closed gate. No approval or release is granted.
No Agent task was in progress at the initial check. Prior test suites and the
settled Support investigation were not repeated.

Two supported `executeSql` SELECT-only calls used `environment: "production"`.
The catalog observation was timestamped **2026-10-28 07:47:30 UTC** and returned
`pg_is_in_recovery() = true`. These are observations of the platform's
Production-routed **replica**, not certification of the app's writable primary,
runtime role, resource binding, current merchant configuration or recovery.
No application/provider credentials were inspected.

| Observed in that replica | Result |
| --- | --- |
| Expected zero-argument public guard functions | **0 of 4 present** |
| Expected public non-internal guard triggers | **0 of 9 present** |
| Student-platform rule proposals | **0** |
| Direct release requests / decisions / review bindings | **0 / 0 / 0** |
| Direct payment events | **0** |
| Valid January 2027 second-term catalog entries | **1**, in one school, active session, start **2027-01-11** |

No eligible school/rule combination was invented to generate a reconciliation
or create a release review. Zero direct events or release records do not prove
absence of older provider correspondence, dashboard registration or delivery
through other workflows. No broad financial-data scan was performed.

## Exact procedural evidence required

The unchanged reviewed artifact is
`lib/db/drizzle/0179_restore_direct_and_bro_guards.sql`, SHA-256:
`09e2f989c23d80d580bc2428ddd38b962715f11d0c70700e975ab5ca9809c21b`.
The hash was recomputed in this follow-up. It is an identifier for review,
**not permission or an instruction to run it against managed Production**.

All four expected functions were absent from the observed replica:

- `public.guard_student_direct_history()`
- `public.guard_student_direct_attempt()`
- `public.guard_bro_term_commission_history()`
- `public.guard_bro_term_commission_scope()`

All nine expected trigger bindings were absent:

| Trigger | Public table | Public function | Type mask |
| --- | --- | --- | --- |
| student_direct_review_history | student_direct_live_reviews | guard_student_direct_history | 27 |
| student_direct_obligation_history | student_direct_live_obligations | guard_student_direct_history | 27 |
| student_direct_event_history | student_direct_live_events | guard_student_direct_history | 27 |
| student_direct_attempt_history | student_direct_live_attempts | guard_student_direct_attempt | 27 |
| student_direct_release_request_history | student_direct_live_release_requests | guard_student_direct_history | 27 |
| student_direct_release_decision_history | student_direct_live_release_decisions | guard_student_direct_history | 27 |
| student_direct_release_binding_history | student_direct_live_review_bindings | guard_student_direct_history | 27 |
| bro_term_commission_append_only | bro_term_commission_entitlements | guard_bro_term_commission_history | 27 |
| bro_term_commission_scope_guard | bro_term_commission_entitlements | guard_bro_term_commission_scope | 7 |

Mask 27 means BEFORE ROW UPDATE/DELETE; 7 means BEFORE ROW INSERT.
The existing runtime contract additionally requires normally enabled (`O`),
unconditional, non-constraint, zero-argument, non-inherited triggers with no
column restriction and exact function identity. Functions require exact approved
bodies, zero arguments, scalar trigger return, PL/pgSQL, invoker security,
volatile, non-strict, non-leakproof, parallel-unsafe and no per-function settings.
Counting objects alone is not acceptance. Direct readiness checks two functions
and seven triggers; separate BRO readiness checks the other two functions and
two triggers. A direct-only pass cannot certify the combined contract.

## Supported delivery decision and minimum outside-code step

No supported installer is available in this workspace for these procedural
objects on the managed Production target. Current platform instructions permit
managed schema delivery through Publish, not an agent-run Production migration.
The already-recorded platform confirmation says Publish does not transfer/track
these objects, and manual SQL-console installation is unsupported.

No new supported mechanism was found in the existing authorized project
infrastructure. No new platform capability investigation or Support contact was
made. Connection access, an empty structural diff, a migration ledger entry or
a successful local rehearsal cannot resolve that limitation.

**There is no app-code-only step that closes this delivery blocker.**
Do not try direct-client SQL, SQL-console installation, startup/build DDL,
custom release hooks, ledger edits, permission elevation or credential workarounds.

Without returning to Support, the minimum actionable outside-code decision is
**Owner authorization for a database-hosting feasibility review** of a
customer-controlled PostgreSQL service with a supported procedural migration
lifecycle, keeping the existing financial model unchanged. This is not
authorization to provision, spend, copy data, change secrets, cut over or install
anything on the current managed target. No such alternative is established as
already provisioned or authorized by this report.

A future separately approved hosting/release plan must bind the serving runtime
to its exact primary/resource and runtime role, attach existing recovery evidence
and a current isolated restore rehearsal, preserve the retained-data baseline,
prove exact post-release catalog definitions/enablement and permission behavior,
and obtain explicit execution authorization. A developer with SQL access alone
cannot turn the current unsupported managed-target path into a supported one.

## Other gates: reuse evidence, do not manufacture it

- **Merchant configuration and approval:** the Owner previously reported merchant
  prerequisites and confirmation emails completed. That is retained evidence,
  not something this pass declares absent. With no authenticated Owner session
  or persisted direct-release snapshot, current serving-runtime configuration
  was not independently inspected. Reuse the existing correspondence/reference
  when available; do not request secrets or substitute Development key presence.
- **Callback/webhook:** configured URLs and successful route tests prove neither
  provider-dashboard registration nor authenticated external delivery. No
  recorded direct release snapshot/event was available in the inspected tables.
  Use existing exact merchant-scoped registration and authenticated delivery
  evidence, with time, public endpoint, provider event/reference, application
  acknowledgement and replay result. Do not generate a real payment to fill this
  evidence gap. No new claim about provider delivery is made.
- **Rollout:** keep the observed school's actual 11 January start and the free
  current term. One school's date cannot be applied to another school. A future
  saved date is not a current collection authorization.
- **Rule/reconciliation/review:** no Student rule or direct-release records were
  observed in the replica. Creating a priced/effective-dated proposal or recording
  an approval is an explicit financial-governance action, not a diagnostics fix.
  After independent authorization, use the existing Owner workflow for an exact
  school, academic term, rule/version, fresh reconciliation digest, reviewed
  non-split evidence and expiry. Preserve legacy obligations; never rebill them.
- **Operational authorization:** remains independent. Review preparation or
  approval does not enable LIVE.
- **Authenticated UI acceptance:** the previously checked independent browser was
  signed out; no authorized session is available in the current context. No new
  login attempt or account creation was made. Component tests are not signed-in
  browser acceptance.

## Separable application fix

Previously, the prerequisite checklist appeared only inside a selected
school/term/rule workspace. An empty/unavailable rule catalog prevented access
to that guidance. It is now also visible before scope selection, explicitly
marked **not evaluated**, with no current Production status inferred and no
mutation controls. The missing-rule message no longer instructs the Owner to
create a rule just to proceed to diagnostics.

This does not bypass scope authorization, query readiness for invented IDs,
record approval, change financial gates or resolve the procedural delivery gap.

## Targeted verification in this follow-up

- `pnpm --filter @workspace/edupulse exec vitest run src/pages/direct-flutterwave-live-readiness.test.tsx`
  — **14/14 passed**, including empty/error catalogs, denied access, selected
  scope, immutable guidance, no unintended mutation/checkout and existing review
  safeguards.
- `pnpm --filter @workspace/edupulse run typecheck` — **passed**.
- `git diff --check` — **passed**.
- Only the changed frontend workflow was restarted. No backend suite or
  disposable PostgreSQL rehearsal was repeated; no backend/SQL code changed.
- GitHub main was checked read-only with `git ls-remote`; its head matched the
  cached main reference. Relevant Replit-only additions were preserved. No push.

These checks do not close authenticated browser acceptance, prove provider
delivery, certify Production enforcement or authorize publishing or LIVE.
