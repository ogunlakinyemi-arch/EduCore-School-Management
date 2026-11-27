# Advance school subscription authorization — source-only delivery

## Status

Implemented as candidate source. **Not operationally released or runtime-tested.**
No application database was connected, no migration or test was executed,
no provider was contacted, and no payment, transfer or refund was created.
No credentials, webhook/provider settings or LIVE switches were changed.
No workflow was restarted and no preview/browser was requested. Nothing was
published, deployed, merged or pushed.

## Behavior

The Owner's existing Direct Flutterwave LIVE Readiness page now has a separate
future-term section. The Owner selects an existing school, saved term and
activated/scheduled NGN 3,200 Student rule, refreshes exact evidence, supplies
reviewed non-split merchant evidence and saves an explicit review. Approval is a
second action against the retained evidence digest and a separate confirmation.

The initial authorization must precede the saved term's start. Re-review of an
existing advance scope can occur in-term if it becomes stale; no authorization
can be created after its term ends. New reviews supersede older advance reviews
for the same school/term with retained withdrawal history. A replayed request
key returns its original record, never resurrecting a withdrawn approval.

The immutable authorization binds:

- Exact school, term and academic session.
- Saved calendar material fields and a retained material revision.
- Eligible new-student IDs, full stable reconciliation digest and its sources.
- Student rule ID/version, NGN 320000 minor units, currency, term billing,
  effective window and zero school/BRO collection shares.
- Merchant scope, exact callback/webhook URLs and V3 verification contract.
- Free-term grant identity when present and material grant changes.
- Owner-reviewed merchant evidence reference/hash, reason and decision history.

Its not-before is the saved opening date at 00:00 Africa/Lagos. Its exclusive
expiry is midnight immediately after the saved final day. This is a separate
authorization model; 0177's seven-day constraint and the ordinary current-term
review implementation remain intact.

## Calendar-driven availability, not charging or calendar automation

Normal School Admin / existing Owner-assisted checkout still initiates any
provider request. No job, timer or term-start handler creates payments.
Global LIVE mode, production merchant configuration and the explicit direct
release switch remain separate gates. Review/approval never changes them.

At checkout, the service revalidates all bound evidence and requires the actual
Africa/Lagos day within the saved term, one current active term and one current
active session. Native candidate triggers independently gate new direct
obligations, new attempts and aggregate allocations tied to advance reviews.
Late independent verification of a previously started collection is not
reclassified as a new checkout.

Only expected PLANNED-to-ACTIVE and not-current-to-current lifecycle changes are
normalized in advance evidence. The ordinary dated reconciliation report is
unchanged. Closing the previous term/session records a revision for that
previous calendar scope, not for the reviewed target term.

**No calendar-rollover scheduler was added.** The school's authorized calendar
process must make the correct term/session current and active at opening.
If it does not, checkout stays blocked even after the saved start date. This
change removes the need for an opening-day Owner *financial approval*; it does
not bypass academic calendar governance or promise calendar state transitions.

## Stale evidence, concurrency and retention

The candidate installs retained revision tracking on current authoritative
reconciliation sources, pricing and optional free-term evidence. Revision scope
distinguishes school and calendar identities. An update followed by a reversal
still changes the retained material version. Link-only legacy evidence without
a direct school key invalidates conservatively across scopes; it is never
silently ignored. This may require more re-reviews, not broader payment access.

Authoritative evidence is collected on the same pinned client. Financial
transactions and SHARE locks across reviewed source tables close the interval
between revalidation and checkout reservation. Runtime inspection fails closed
for missing columns, access privileges, history/scope/date guards or revision
coverage on newly discovered sources.

The history endpoint reconciles stale/expired records into append-only
decisions. Explicit checkout preflight also commits observed invalidation or
expiry independently of a later checkout denial. Readiness GETs and evidence
previews do not create payments. Ordinary direct readiness retains its
no-business-write behavior. Withdrawal or a newer advance review cannot
resurrect an older ordinary/advance approval.

Material configuration mismatches are checked against observed runtime
configuration. Source cannot establish unobserved external configuration-change
history. Operational changes to reviewed merchant/endpoints should explicitly
withdraw affected authorizations and obtain fresh reviews, including when
returning to an older configuration.

The schema is an application protection contract, not a claim that privileged
administrators cannot disable guards or directly rewrite database objects.
Exact deployed procedural definitions and privileges require operational review.

## Preserved financial boundaries

- NGN 3,200 per eligible student per academic term.
- Separately funded eligible NGN 150 BRO liability only after independently
  verified payment and valid attribution; existing savepoint isolation retained.
- School-owned January-2027 second-term anchor and per-school calendars.
- Existing free-term grants and original-school financial ownership.
- Independent Flutterwave GET verification, strict amount/reference/fee facts,
  webhook authentication, permanent dispatch claims and uncertain-send handling.
- No retired NGN 5,000 split/subaccount model, automatic charging, historical
  conversion or repricing.

## Authored tests — NOT EXECUTED

`advance-subscription-policy.test.ts` contains 23 parameterized policy/source
cases: WAT window, early denial, different school opening dates, current/active
requirements, opening/final-day behavior, term-end expiry, missing January
anchor, lifecycle normalization, exact calendar/roster/reconciliation/pricing/
merchant/endpoint binding, retained revision invalidation and seven-day source
preservation.

`advance-subscriptions.isolated.postgres.test.ts` contains 13 parameterized native
guard cases: future approval with early denial, mandatory separate review,
changed digest rejection, opening-day acceptance, changed-and-restored dates
and roster, lifecycle transition, previous-term closure, withdrawal before a new
attempt, immutable history, term-end expiry and original seven-day SQL rejection.
These raw fictional evidence cases test native guards, not full routed/UI
acceptance or real provider responses.

The native suite is excluded from ordinary Vitest discovery and requires
`vitest.advance-subscriptions-isolated.config.ts`. Its pre-collection guard
requires a distinct no-egress namespace and no inherited application
credentials. The fixture requires actual matched JS/PostgreSQL clocks on its
fictional 2027-01-18 opening date. No clock rewriting, application-database
fallback or broad test discovery is authorized. None was attempted here.

## Checks actually executed

All final checks ran in a credential-free environment:

1. `pnpm --filter @workspace/api-spec run codegen`
   - OpenAPI generation passed.
   - Its chained `pnpm -w run typecheck:libs` / `tsc --build` passed.
2. `pnpm --filter @workspace/api-server run typecheck` — passed.
3. `pnpm --filter @workspace/edupulse run typecheck` — passed.
4. `git diff --check` — passed.
5. Credential-free changed-file manifest comparison — matched all 39 changed
   files listed below.

No tests, native SQL, app runtime, browser, routing or provider verification was
executed. Static success is not LIVE-readiness evidence.

## Operational requirements and remaining blockers

1. Review the candidate `0186_advance_subscription_authorizations.sql` and exact
   prerequisite direct-payment/release schema. It is additive; no seed,
   historical update or automatic startup application is registered.
2. Run isolated policy, native PostgreSQL, schema-contract and routed/Owner UI
   acceptance verification under separate authorization. Include real concurrent
   calendar/roster edits during revalidation and retained non-advance flows.
3. Confirm target schema/functions/triggers/privileges with separate authorized
   target inspection. Existing 0181/0182/0185 source presence is not evidence of
   application. If aggregate tables are installed, the advance aggregate guard
   is mandatory; install/review ordering accordingly. New reconciliation tables
   also need explicit revision-trigger coverage.
4. Grant only reviewed application privileges for new authorization, decision
   and revision tables. Ordinary source-table writes invoke revision tracking;
   missing privileges must be resolved before any operational rollout.
5. Verify saved school calendars, unique current-term/session governance and
   the authorized opening-day calendar transition process.
6. Independently verify the production build, merchant setup, dedicated LIVE
   configuration, exact registered endpoints and explicit global release.
7. Complete Owner advance reviews before school opening. Calendar/roster/rule/
   merchant evidence must remain unchanged, or be explicitly re-reviewed.

No launch, migration or real-payment permission is implied by this report.

## Exact changed files

### Application and contracts

- `artifacts/api-server/src/routes/direct-student-live-release.ts`
- `artifacts/api-server/src/services/advance-subscription-authorizations.ts`
- `artifacts/api-server/src/services/advance-subscription-policy.ts`
- `artifacts/api-server/src/services/current-bulk-subscriptions.ts`
- `artifacts/api-server/src/services/direct-student-live-payments.ts`
- `artifacts/api-server/src/services/direct-student-live-release.ts`
- `artifacts/api-server/src/services/student-nfc-reconciliation.ts`
- `artifacts/edupulse/src/components/advance-subscription-authorization.tsx`
- `artifacts/edupulse/src/pages/direct-flutterwave-live-readiness.tsx`
- `lib/api-spec/advance-subscriptions.yaml`
- `lib/api-spec/openapi.yaml`
- `lib/api-spec/orval.config.ts`
- `lib/db/drizzle/0186_advance_subscription_authorizations.sql`
- `lib/db/src/schema/advance-subscription-authorizations.ts`
- `lib/db/src/schema/index.ts`

### Test source and isolation configuration

- `artifacts/api-server/src/services/advance-subscription-policy.test.ts`
- `artifacts/api-server/src/services/advance-subscriptions.isolated.postgres.test.ts`
- `artifacts/api-server/vitest.advance-subscriptions-isolated.config.ts`
- `artifacts/api-server/vitest.config.ts`

### Generated contracts

- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/advanceSubscriptionAuthorization.ts`
- `lib/api-zod/src/generated/types/advanceSubscriptionDecision.ts`
- `lib/api-zod/src/generated/types/advanceSubscriptionDecisionInput.ts`
- `lib/api-zod/src/generated/types/advanceSubscriptionDecisionInputAction.ts`
- `lib/api-zod/src/generated/types/advanceSubscriptionFacts.ts`
- `lib/api-zod/src/generated/types/advanceSubscriptionFactsCalendar.ts`
- `lib/api-zod/src/generated/types/advanceSubscriptionFactsRule.ts`
- `lib/api-zod/src/generated/types/advanceSubscriptionFactsSession.ts`
- `lib/api-zod/src/generated/types/advanceSubscriptionInput.ts`
- `lib/api-zod/src/generated/types/advanceSubscriptionReadiness.ts`
- `lib/api-zod/src/generated/types/getAdvanceSubscriptionReadinessParams.ts`
- `lib/api-zod/src/generated/types/listAdvanceSubscriptionAuthorizations200.ts`
- `lib/api-zod/src/generated/types/listAdvanceSubscriptionAuthorizationsParams.ts`

### Review and durable project policy

- `docs/advance-subscription-authorization-source-review.md`
- `.agents/memory/MEMORY.md`
- `.agents/memory/advance-subscription-authorization-policy.md`
