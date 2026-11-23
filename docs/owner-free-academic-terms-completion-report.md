# Owner free academic-term grants — Development source completion

## Controlled shared Development activation — 23 November 2026

**Current status:** 0183 is installed in the verified shared Development
database; the Development API is running with all startup background workers
paused. No grants/events were created. **Production was not changed or
published.** The sections below describe historical pre-activation evidence
and decisions and should not be read as the current database/service status.

The Owner confirmed the database-inclusive Development recovery checkpoint
**“Implement owner-free academic terms functionality and update documentation”,
23 November 2026 at 14:55:45 UTC**. Recovery was identified, not executed;
restoring it would affect both Development code and data and needs a separate
decision if required. The approved scope was 0183 and safe Development API
startup only.

### Execution record and target

- Exact candidate: `lib/db/drizzle/0183_owner_free_academic_terms.sql`,
  SHA-256 `620727863cc3b8d40d42be7929686f3e90eb0a3f05f7d4b6136bc23787608d0b`.
  Content and hash were rechecked immediately before execution.
- Independent read-only checks through Replit's **Development** database tool
  and the actual application `DATABASE_URL` matched: database `heliumdb`,
  PostgreSQL system identifier `7688255936716206099`, role `postgres`,
  postmaster start `2026-11-23 14:38:16.78641+00`, not in recovery.
  The same target gate was enforced **inside the installation transaction**.
  No Production connection was queried for this decision. The workspace's
  previously Support-confirmed Development/Production separation was retained;
  database name alone was not used as proof.
- Preflight verified absent free-term tables/functions, all five parent tables,
  validated session/term tenant uniqueness, schema CREATE and REFERENCES
  permissions; `school_subscription_manual_locks` and payment-summary read
  dependencies were checked. The source model was explicitly exported from
  `lib/db/src/schema/index.ts` only after the candidate's earlier ORM/SQL
  parity review. The existing `push`/`push-force` disablement is unchanged.
- Rehearsed the same unchanged SQL and full catalog/function/trigger assertion
  in a separate disposable PostgreSQL database using a rollback. The rehearsal
  log is `generated-artifacts/free-academic-terms/activation-rehearsal.log`.
  The original disposable fixture and its catalog parity tests remain prior
  evidence, not proof of authenticated runtime behavior.
- Executed the approved transaction with `psql --no-psqlrc`,
  `ON_ERROR_STOP=1`, `BEGIN`, `SET LOCAL lock_timeout='5s'`,
  `SET LOCAL statement_timeout='30s'`, in-transaction target/prerequisite
  preflight, `\i lib/db/drizzle/0183_owner_free_academic_terms.sql`,
  exhaustive assertions on object counts/names, exact procedural bodies,
  trigger bindings/events/enablement and runtime role table/sequence rights,
  **COMMIT**. The server timestamp reported at parity was
  **2026-11-23 15:17:50.248195+00**.
  The exact reviewed execution script and output are in the ignored
  `generated-artifacts/free-academic-terms/activation-0183-development.sql`
  and `activation-shared-dev.log`; neither contains a connection string.
- After commit, independent Development database reads found **both tables,
  15 validated constraints, two exact fixture-matching PL/pgSQL functions,
  three exact fixture-matching enabled guards, zero grants and zero events**.
  The intended API connection role had public-schema USAGE, SELECT/INSERT
  on both tables, serial-sequence USAGE and the previously checked parent
  locking privileges. No shared data row or existing financial record was
  modified by the migration.
- **Migration record distinction:** the existing Drizzle migration ledger
  stayed at **27 rows, last ID 27**, before and after. No active numbered-SQL
  migration runner owns 0183, so no journal/ledger row was fabricated or
  misrepresented as Drizzle-run evidence. This dated execution record, exact
  SHA, target identity, committed transaction log and post-commit catalog
  parity are the truthful record of this explicitly authorized Development
  installation. Future reconciliation must not blindly replay or stamp 0183.

### Safe Development API and Preview

The API workflow was unexpectedly already running at the start of this
activation; its logs showed Telegram polling and conflicts. It was stopped
before work continued. Those earlier logs **do not establish whether a
notification was delivered**; no external send was initiated for this task.

Normal startup previously called the Telegram and Owner notification workers
before the Development worker pause. The smallest Development-only code change
now checks the **existing** `EDUCORE_DEVELOPMENT_WORKERS_PAUSED=true` first,
returns before either worker, any other scheduler/dispatch, and unrelated
startup verification. Production behavior is unchanged. Ordinary authenticated
HTTP routes remain active; no provider setting, secret or environment value
was changed. Focused pause tests **6 passed** (five policy cases plus startup
ordering); focused Owner router tests **17 passed**; library/API types passed.
The managed API's normal `pnpm --filter @workspace/api-server run dev` command
rebuilt and started successfully. Its startup log confirms **“All Development
background workers paused; no startup polling or notification dispatch”**.
No subsequent Telegram/Owner worker startup message appeared in the inspected
running-workflow output. This protects **startup/background workers**, not
arbitrary later manual notification endpoints; none were exercised.

The exact Development Preview path is
**https://f8ad4f13-ad39-4544-9de2-99a39f6d556c-00-1pkz80o0gbypm.riker.replit.dev/subscriptions#free-academic-terms**.
Proxied web and API health each returned HTTP 200; Vite served the current
Owner shortcut. Anonymous Owner GET returned 401. A Preview screenshot
displayed Development sign-in as expected; it was **not** an authenticated
Owner acceptance. A prior web workflow restart showed a port-in-use failure
while an older Vite process continued to serve the current source on 19494.
Do not treat that failed workflow state as proof of a broken Preview, and do
not kill the listener merely to change the status without ownership/quiescence
checks.

**Remaining acceptance limit:** no pre-existing, clearly isolated
school/term and legitimate authenticated disposable Owner session were
established. Therefore no real grant/suspend or operational entitlement was
created. The grant/suspend transaction, school/session/term data loading and
signed-in Owner UI remain unverified against the shared Development API; prior
mocked HTTP/DOM and disposable database tests remain the evidence for those
flows. An Owner can sign in normally to inspect the now-enabled read-only
overview; a future isolated transaction test needs an expressly safe fixture.
Do not assume this Development installation publishes the procedural guards:
Replit Publish omits functions/triggers, so Production remains separately
blocked pending supported delivery review.

## Latest follow-up — discoverability and Development delivery review, 23 November 2026

**Status: shortcut delivered; Development web Preview running and serving current
source. API intentionally not started because its normal startup activates
notification workers. Shared migration and authenticated acceptance remain blocked.**

- Owner navigation remains **Platform collections & rules → Subscriptions**.
  A visible Owner-only shortcut now appears before the existing subscription view:
  **Jump to Free academic terms**. It focuses the existing clearly labelled section,
  including after authorization loads a direct fragment link. No route, permission,
  school-payment behavior or existing section order was replaced.
- Exact Development URL observed and fetched with HTTP 200:
  **https://f8ad4f13-ad39-4544-9de2-99a39f6d556c-00-1pkz80o0gbypm.riker.replit.dev/subscriptions#free-academic-terms**
  Development URLs can change when the workspace reopens. The artifact preview
  path is `/`; the application path remains `/subscriptions`.
- Both workflows initially reported `not_started`, with no listening processes.
  Available evidence does not establish a crash or who stopped them. The prior
  implementation deliberately did not start/restart shared services. The existing
  web command, `pnpm --filter @workspace/edupulse run dev`, started successfully
  without configuration changes. Vite reported ready; proxied requests for both
  changed source modules contained the new shortcut/anchor.
- The existing API command is `pnpm --filter @workspace/api-server run dev`
  (Development build, then normal server). **It was not executed.** Normal startup
  calls `startTelegramWorker()` and `startOwnerNotificationWorker()` before the
  general worker-pause return. Telegram runtime is enabled in Development;
  its tick can check the provider, poll updates, bind links and dispatch queued
  deliveries. The current Development worker pause does not stop that worker;
  the separately configured Development Telegram opt-in is also true. Owner
  notification startup can dispatch selected SMS/push/Telegram according to saved
  controls. Thus starting the normal API is not demonstrably no-send/no-data-write.
  No flags, secrets, provider settings or saved controls were changed to work around it.
- A screenshot of the real Preview rendered the Development Clerk sign-in screen,
  not the Owner section. No sign-in bypass, test identity creation, real grant or
  authenticated/mobile browser acceptance is claimed. The stopped API also blocks
  authorized-context loading; applying 0183 alone would not resolve that.

### Focused verification in this follow-up

The earlier broad verification below was reused, not repeated.

| Check | Result and boundary |
|---|---|
| Subscriptions route + free-term component DOM tests | **24 passed across 2 files**: original behavior plus Owner-only shortcut, exclusion for school accountant, keyboard focus and delayed fragment mount. Hooks are mocked; this is not a live connected UI/API test. |
| Free-term HTTP router tests | **17 passed** using fixture identity middleware/mocked services, including authorization denial and all six status responses; not genuine Clerk sign-in. |
| Real disposable PostgreSQL suite | **26 distinct checks passed** across the initial run and one targeted correction: the existing 24 plus ORM/catalog/procedural parity and direct database CHECK enforcement. Only the catalog test initially failed because PostgreSQL `name[]` arrived as a string; selecting `text[]` corrected the test. The targeted rerun passed 1 check, with 25 skipped, not another 26 passes. |
| Exact delivery-template rehearsal | Passed against a second empty disposable database with minimal parent contracts: the report's transaction/catalog queries executed, then ROLLBACK removed both tables and both functions. No commit was tested against shared data. |
| API/frontend types and DB model types | Passed. No repeated production build or broad suite was needed for this shortcut/candidate-metadata change. |
| Development Preview | HTTP 200; both changed modules served by Vite; anonymous screenshot showed Development sign-in with no manifest rendering failure. API port remained closed. |
| Source whitespace | `git diff --check` passed. |

The real database tests retain current/future/past calendar and WAT boundaries,
school/session/term matching, reason/confirmation, active/non-Owner denial,
immutable history, concurrent/duplicate protection, unresolved-checkout denial,
paid-history preservation, no financial/BRO posting, next-term billing and
independent manual/security controls. Six display states are also covered by the
existing HTTP/DOM tests. This is **layered fixture evidence**, not an end-to-end
authenticated UI talking to PostgreSQL.

The candidate ran only on the already isolated PostgreSQL directory/socket under
`generated-artifacts/free-academic-terms/`, port 55439, database
`free_term_fixture`, with TCP disabled. Its test checks `data_directory` and a Unix
socket before resetting its fictional schema. The disposable server was stopped
after verification. **Never point this destructive fixture suite at shared data.**

New logs: `discovery-ui.log`, `discovery-api-postgres.log`,
`discovery-parity.log`, `discovery-web-types.log`, `discovery-api-types.log`,
`discovery-db-types.log`; catalog definitions:
`generated-artifacts/free-academic-terms/discovery-catalog.json`.
The exact report transaction was extracted to `discovery-delivery-rehearsal.sql`;
its output and verified full rollback are in `discovery-delivery-rehearsal.log`.
All generated evidence remains in the ignored directory.

### Changes and explicit non-changes

- Changed only the two existing UI files, their focused tests, the existing
  PostgreSQL test, the unregistered ORM candidate and this report.
- The ORM candidate now explicitly matches the SQL's five CHECK constraints,
  named uniqueness/foreign keys and `ON DELETE RESTRICT` semantics. It remains
  **unexported/unregistered**; no shared schema generation input was activated.
- `0183_owner_free_academic_terms.sql` was **not changed**. Reviewed SHA-256:
  `620727863cc3b8d40d42be7929686f3e90eb0a3f05f7d4b6136bc23787608d0b`.
- No shared Development/Production DDL/DML, migration ledger changes, real
  grants, real payment/SMS, API/worker activation, publication, deployment,
  configuration changes or secret/provider changes were performed. Only the
  existing Development web workflow was started. Hardware/mockup workflows were
  not started. Automatically returned deployment logs were not used to make any
  Production changes.

### Exact migration approval boundary and Development-only procedure

**There is no EduCore database approval page.** The grant review dialog authorizes
one school entitlement, not schema installation. No migration-0183 approval item is
pending in the app or in Replit Publishing.

This repository deliberately disables `@workspace/db push`/`push-force`, and its
post-merge setup skips schema writes. The ORM candidate is absent from
`lib/db/src/schema/index.ts`; 0183 is absent from the migration journal. Merely
adding a SQL file, starting Preview or publishing does not execute it. The
`replit.md` line advertising `db push` is not the current executable policy; the
package scripts and disabled-write guard are authoritative.

For managed Production, Replit Publish reviews a Development→Production structural
diff, not repository migration filenames. Functions/triggers are not delivered
by that diff. **Do not use Drizzle push or Publish as an 0183 procedural installer.**
See [Publish database changes](https://docs.replit.com/features/data-and-storage/publish-database-changes)
and [Database troubleshooting](https://docs.replit.com/help/troubleshooting/databases).
Production delivery is outside this Development-only procedure.

**Required separate authorization before shared Development execution:**

> Approve installation of the reviewed 0183 SQL and matching ORM registration
> in the independently verified shared Development database only, using one
> atomic transaction and catalog verification; no grants, notification sending,
> Production changes or publishing. Separately approve a demonstrated no-send
> Development API startup method before runtime acceptance.

That statement is the scope to review, **not approval already received**.
Do not execute the following procedure under the current task.

1. **Establish the exact Development target.** Select Development in Replit's
   Database tool and independently match the proposed write connection to the
   database intended for this Development API. Reuse existing binding evidence,
   but do not infer identity from `neondb`, an environment label, a read replica
   or a successful sign-in. Do not print connection strings or credentials.
   Reconfirm the unchanged candidate hash above. Keep a recovery/checkpoint
   reference according to the existing Development workflow; create no backup
   tables or alternative database inside shared schema.
2. **Review prerequisites and conflicts read-only.** Require `public.schools`,
   `app_users`, `school_memberships`, `academic_sessions`, `academic_terms`;
   real IDs and the existing unique `(id,school_id)` keys on sessions/terms.
   Review the existing subscription-summary/manual-lock read dependencies as well.
   Both new tables and both new zero-argument functions must be absent for this
   clean-install procedure. If any already exists, stop for exact catalog/parity
   reconciliation: `IF NOT EXISTS` is not an upgrade or proof of compatibility.
3. **Review ORM registration separately with the same change.** Export
   `./owner-free-academic-terms` from the schema index only in the approved
   delivery change, after reviewing the aligned candidate. This registration is
   metadata, not execution. Leave disabled push commands/post-merge policy intact.
   There is no active numbered-file runner to register by adding a journal entry;
   do not fabricate an applied journal record or replay all historical files.
   Any chosen execution-ledger mechanism needs its own reviewed contract, written
   only after successful delivery.
4. **Confirm migration/runtime permissions without widening them automatically.**
   The installer needs schema CREATE, REFERENCES on parent keys, and permission
   to create the two tables/sequences, PL/pgSQL functions and their triggers.
   Retain platform-managed ownership; do not transfer ownership to a new role.
   The API needs schema USAGE, SELECT/INSERT on the two evidence tables and USAGE
   on their serial sequences, plus its existing SELECT rights on actor/membership,
   calendar/school and subscription/payment-summary dependencies. The service's
   `FOR SHARE` queries also require UPDATE privilege on at least one column of
   each locked parent (`app_users`, `school_memberships`, `academic_terms`,
   `academic_sessions`, `schools`); reuse existing legitimate rights, not new
   blanket grants. Trigger-function execution is automatic; no API function call
   replaces the trigger. The fixture proved table INSERT/SELECT and sequence
   USAGE for its fixture owner only, **not shared runtime ACLs**.
   A table owner/superuser can disable/drop triggers; the immutable-history claim
   does not imply protection from a privileged database administrator.
5. **Execute only the reviewed candidate, once, atomically in Development.**
   After secure target selection, an authorized operator can use a PostgreSQL
   client with `ON_ERROR_STOP` and a single transaction. From the workspace root,
   the following is the exact transaction shape; the symbolic DSN must already
   have been securely bound to the verified Development target:

   ```sh
   psql --no-psqlrc --dbname="$APPROVED_DEVELOPMENT_DSN" --set=ON_ERROR_STOP=1 <<'SQL'
   BEGIN;
   SET LOCAL lock_timeout = '5s';
   SET LOCAL statement_timeout = '30s';
   SET LOCAL search_path = public, pg_catalog;
   DO $preflight$
   BEGIN
     IF to_regclass('public.owner_free_academic_terms') IS NOT NULL
       OR to_regclass('public.owner_free_academic_term_events') IS NOT NULL
       OR to_regprocedure('public.reject_free_term_evidence_mutation()') IS NOT NULL
       OR to_regprocedure('public.validate_free_term_scope()') IS NOT NULL THEN
       RAISE EXCEPTION 'Existing free-term objects require separate reconciliation';
     END IF;
   END $preflight$;
   \i lib/db/drizzle/0183_owner_free_academic_terms.sql
   SELECT a.attrelid::regclass AS table_name,a.attname,
     format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,
     pg_get_expr(d.adbin,d.adrelid) AS default_expression
   FROM pg_attribute a LEFT JOIN pg_attrdef d
     ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid IN ('owner_free_academic_terms'::regclass,
     'owner_free_academic_term_events'::regclass)
     AND a.attnum>0 AND NOT a.attisdropped
   ORDER BY a.attrelid::regclass::text,a.attnum;
   SELECT conrelid::regclass AS table_name,conname,contype,convalidated,
     pg_get_constraintdef(oid) AS definition
   FROM pg_constraint WHERE conrelid IN ('owner_free_academic_terms'::regclass,
     'owner_free_academic_term_events'::regclass)
   ORDER BY conname;
   SELECT p.proname,l.lanname,p.prosecdef,p.provolatile,p.proconfig,
     pg_get_functiondef(p.oid) AS definition
   FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.pronamespace='public'::regnamespace AND p.pronargs=0
     AND p.proname IN ('reject_free_term_evidence_mutation','validate_free_term_scope')
   ORDER BY p.proname;
   SELECT tgname,tgenabled,pg_get_triggerdef(oid) AS definition
   FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN
     ('owner_free_academic_terms'::regclass,'owner_free_academic_term_events'::regclass)
   ORDER BY tgname;
   SELECT current_user,has_schema_privilege(current_user,'public','USAGE') AS schema_usage,
     name,has_table_privilege(current_user,name,'SELECT') AS can_read,
     has_table_privilege(current_user,name,'INSERT') AS can_insert,
     has_sequence_privilege(current_user,pg_get_serial_sequence(name,'id'),'USAGE') AS sequence_usage
   FROM (VALUES ('public.owner_free_academic_terms'),
     ('public.owner_free_academic_term_events')) AS tables(name);
   -- COMMIT is deliberately omitted from this review template.
   -- Use ROLLBACK for a rehearsal; authorize a final COMMIT only after exact checks.
   ROLLBACK;
   SQL
   ```

   This is a **review/rehearsal template that rolls back**, not a delivered apply
   runner. Compare the returned catalog definitions with step 6 and the retained
   fixture catalog, rehearse the exact transaction against a disposable fixture,
   and explicitly approve replacing the final ROLLBACK with COMMIT only after
   those comparisons and target/permission checks pass. The current-user query
   describes the installer connection; repeat permission reads under the
   independently identified API role before runtime activation. No automated
   shared-target installer or credential-handling script was added in this task.
   A timeout/error must abort the transaction; do not retry with weaker guards.
6. **Verify full catalog parity before committing and again through the intended
   runtime connection afterwards, using SELECT only.** Required objects:

   | Object | Exact requirement |
   |---|---|
   | `owner_free_academic_terms` | 10 columns; primary key; school/actor RESTRICT FKs; tenant session/term RESTRICT FKs; unique school/term; trimmed reason 5–500; status exactly `TRIAL_GRANTED`; end date ≥ start; serial ID/DB timestamp/default status |
   | `owner_free_academic_term_events` | 6 columns; primary key; grant/actor RESTRICT FKs; unique grant/status; trimmed reason 5–500; status `TRIAL_GRANTED` or `SUSPENDED`; serial ID/DB timestamp |
   | `reject_free_term_evidence_mutation()` | Exact reviewed PL/pgSQL body; returns trigger; SECURITY INVOKER; volatile |
   | `validate_free_term_scope()` | Exact reviewed PL/pgSQL body matching saved school/session/term/dates; returns trigger; SECURITY INVOKER; volatile |
   | `owner_free_terms_immutable` | Grants table, BEFORE UPDATE OR DELETE OR TRUNCATE, FOR EACH STATEMENT, reject function, enabled `O` |
   | `owner_free_term_events_immutable` | Events table, same statement events/reject function, enabled `O` |
   | `owner_free_terms_scope` | Grants table, BEFORE INSERT, FOR EACH ROW, scope function, enabled `O` |

   Inspect `pg_attribute`/defaults, `pg_constraint` with
   `pg_get_constraintdef`, `pg_proc` with `pg_get_functiondef`, and `pg_trigger`
   with `pg_get_triggerdef`, enablement and function/table bindings. Compare exact
   definitions with the reviewed SQL and the retained disposable catalog, not
   table existence or a migration count alone. Readiness requires both tables and
   all three enabled guards, but that lightweight runtime check alone is **not**
   full schema parity. Verify actual `has_schema_privilege`,
   `has_table_privilege`, `has_any_column_privilege`, and sequence USAGE against the
   intended API role. Do not run mutation/immutability test writes on shared rows.
7. **Runtime acceptance is a separate no-send-gated step.** First approve/prove a
   normal Development startup that cannot poll/send or mutate unrelated worker
   data; the current general pause alone is insufficient. Only then start the
   existing API workflow. Sign in normally as an active global Development Owner,
   load the above URL and confirm readiness, saved calendar selection and history.
   Do not create real grants for acceptance: use a separately approved disposable
   app/database plus legitimate isolated authentication if mutation acceptance is
   required. If no such authenticated fixture is available, retain the blocker.
   After any committed grant, do not drop tables or delete evidence as rollback;
   use the audited suspension policy. No destructive down-migration is approved.

### Remaining gates

1. Explicit, target-specific shared Development migration/registration approval.
2. Completed atomic transaction catalog checks and target/runtime permission proof.
3. Separately reviewed no-send/no-unrelated-write API startup.
4. Genuine authenticated disposable UI/API acceptance. Current DOM/HTTP/PostgreSQL
   layers are not a substitute; no connected signed-in grant/suspend pass occurred.
5. Any Production procedural delivery/publication remains separately out of scope.

## Final status

Implemented in Development source on 23 November 2026, using the merged
subscription/calendar implementation. Isolated tests, typechecks and disposable
API/web builds passed. **Not migrated to shared databases, activated, deployed
or accepted in an authenticated running Owner session.**

The Owner workflow is in **Subscriptions → Free academic terms**. It accepts any
existing school from the full school list, then that school's saved academic
session and term. An inactive school can receive an audited grant but remains
inactive; a grant never creates school authorization or clears a manual lock.

## Delivered behavior

- Required, trimmed reason and separate review/confirmation for both
  **Grant Free Academic Term** and **Suspend**. The request includes the dates
  reviewed by the Owner; stale or cross-school/session/term requests are denied.
- Server-authenticated administrator ID and database-generated timestamp,
  school/session/term, original date snapshot, reason and action status are
  retained in append-only grant/event records.
- Trial Granted before the saved start date; Active during the inclusive saved
  date range; Completed after its end, evaluated in Africa/Lagos/WAT.
  Suspended represents withdrawn or invalidated free entitlement or an
  independent school lock in the Owner overview. Payment Required/Paid come
  from existing normal term eligibility/verified school coverage, not grants.
- The grant's stored initial status is `TRIAL_GRANTED` (the granting action).
  Active and Completed are read-time calendar states, not worker-created
  financial transactions. Suspension appends an event; it does not edit history.
- Any change to the granted term's saved dates makes the grant inapplicable
  rather than silently extending it. Completed/suspended grants cannot be
  replaced with duplicate grants. There is no reinstatement/date-adjustment
  operation in this feature.
- Exact school/term uniqueness, a shared school transaction lock, matching
  school/session/term validation and an overlap check prevent duplicate,
  concurrent or ambiguous grants. Direct and aggregate Student checkout and
  Staff checkout share the lock around their fresh eligibility checks.
- Existing unresolved direct, aggregate or Staff checkouts prevent a new grant:
  they must be reconciled rather than cancelled or repriced. Existing verified
  payments can coexist with a grant and remain unchanged.
- A valid grant suppresses new ordinary platform subscription collection and
  supplies non-payment usage eligibility through existing access/enforcement
  services. No payment, receipt, invoice-paid flag, refund, BRO liability,
  commission or financial-ledger posting is created by a grant or suspension.
- Current free-launch access, each school's January 2027 second-term anchor,
  approved prices, seven-day normal Student grace, and historical verification
  remain unchanged. Suspension cannot introduce payment during the free launch.
  The next term has no inherited grant and follows its own saved calendar and
  ordinary billing/release rules.
- Historical payment finalization and BRO eligibility retain the base rollout:
  a later free grant does not rewrite the eligibility of an earlier genuine
  payment. A grant itself supplies no paid evidence.
- Manual school locks, role/tenant authorization, inactive identities and
  physical NFC/card/device safety checks remain independent. This is free
  platform usage, not NFC activation or payment verification.
- Owner-only selection, status/date overview, immutable history with WAT
  timestamps, loading/error/empty states and mutation cache refresh are wired.
  An ambiguous submit requires a status refresh; it is never retried
  automatically. Database uniqueness also protects reload/re-entry.

## Exact source files

### API, access and billing integration

- `artifacts/api-server/src/routes/owner-free-academic-terms.ts`
- `artifacts/api-server/src/routes/subscription-enforcement.ts`
- `artifacts/api-server/src/routes/staff-nfc-billing.ts`
- `artifacts/api-server/src/services/owner-free-academic-terms.ts`
- `artifacts/api-server/src/services/owner-free-academic-term-read.ts`
- `artifacts/api-server/src/services/student-platform-rollout.ts`
- `artifacts/api-server/src/services/student-platform-access.ts`
- `artifacts/api-server/src/services/subscription-enforcement.ts`
- `artifacts/api-server/src/services/staff-free-rollout.ts`
- `artifacts/api-server/src/services/direct-student-live-payments.ts`
- `artifacts/api-server/src/services/current-bulk-subscription-plan.ts`
- `artifacts/api-server/src/services/current-bulk-subscriptions.ts`

### Owner UI and focused new tests

- `artifacts/edupulse/src/components/owner-free-academic-terms.tsx`
- `artifacts/edupulse/src/pages/subscriptions.tsx`
- `artifacts/edupulse/src/components/owner-free-academic-terms.test.tsx`
- `artifacts/api-server/src/routes/owner-free-academic-terms.test.ts`
- `artifacts/api-server/src/services/owner-free-academic-terms.postgres.test.ts`

### Contract and unapplied schema candidates

- `lib/api-spec/owner-free-academic-terms.yaml`
- `lib/api-spec/openapi.yaml`
- `lib/api-spec/orval.config.ts`
- `lib/db/drizzle/0183_owner_free_academic_terms.sql`
- `lib/db/src/schema/owner-free-academic-terms.ts`

The ORM candidate is deliberately **not exported into automatic shared schema
generation**. SQL includes checks, tenant foreign keys, uniqueness, immutable
UPDATE/DELETE/TRUNCATE guards and saved-calendar insert validation. Runtime
readiness checks require enabled guard triggers. Partial/disabled guard delivery
fails closed rather than treating an existing grant as a new payable obligation.
Schema export/parity, supported procedural delivery and operational database
permissions still require separate review; model metadata is not migration proof.

### Regenerated files

- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/changeOwnerFreeAcademicTerm200.ts`
- `lib/api-zod/src/generated/types/freeAcademicTermSelection.ts`
- `lib/api-zod/src/generated/types/getOwnerFreeAcademicTerms200.ts`
- `lib/api-zod/src/generated/types/getOwnerFreeAcademicTerms200HistoryItem.ts`
- `lib/api-zod/src/generated/types/getOwnerFreeAcademicTerms200TermsItem.ts`
- `lib/api-zod/src/generated/types/getOwnerFreeAcademicTerms200TermsItemStatus.ts`
- `lib/api-zod/src/generated/types/getOwnerFreeAcademicTermsParams.ts`

## Verification evidence

All new database operations ran only in an isolated local PostgreSQL cluster
under ignored `generated-artifacts/free-academic-terms/`. Tests verify the exact
data directory and Unix-socket connection before resetting that disposable
fixture. No shared database connection was used. API tests strip credentials,
use fake identities/transports where appropriate, and prohibit external fetches.

| Evidence | Final result |
|---|---|
| `services/owner-free-academic-terms.postgres.test.ts` | **24 passed**: actual candidate applied twice; enabled guards; inactive/non-Owner denial; school/session/term mismatch; reason/confirmation; existing/inactive-school grants; concurrent duplicate grants; calendar/WAT boundaries; suspension; immutable history; retained paid rows; no financial/student changes; Student/Staff free usage; next-term/other-school billing; changed dates; unresolved checkouts; manual locks; launch-policy preservation; partial-guard denial |
| `routes/owner-free-academic-terms.test.ts` | **17 passed**: anonymous and cross-role GET/POST denial, non-global Owner denial, exact school query/history, six status paths, verified Paid vs grants, school lock, unapplied storage, authenticated actor and unsupported scope/action rejection |
| `services/staff-free-rollout.test.ts` | **17 passed** |
| `services/student-platform-rollout-access.test.ts` | **6 passed** |
| Affected backend continuation | **64 passed across 4 files** |
| Final calendar-close correction | **24 PostgreSQL tests passed** again after asserting that a normally closed `COMPLETED` term stays Completed, not Suspended; no additional distinct tests counted |
| Other unchanged passing files in preceding coherent backend run | **86 passed**: `routes/subscription-enforcement.test.ts` (20), `routes/staff-free-checkout.routes.test.ts` (2), `services/direct-student-live-payments.test.ts` (7), `services/student-platform-rollout.test.ts` (7), `services/staff-subscription-access.test.ts` (39), `services/student-nfc-payment-evidence.test.ts` (11) |
| Backend distinct union | **150 checks across 10 files**, combining the 147-check run and the affected 64-check continuation; not 211 distinct tests or one 150-test execution |
| `components/owner-free-academic-terms.test.tsx` | **11 passed**, fake hooks/DOM: exact once-only confirmed body, reason/calendar/status rules, suspension, changed calendar, unapplied storage, failure/refresh/no retry, errors and WAT history |
| `pages/subscriptions.test.tsx` | **10 passed** |
| `pages/subscription-enforcement.render.test.tsx` | **14 passed** |
| `pages/subscription-enforcement.test.ts` | **5 passed** |
| Frontend distinct union | **40 checks across 4 files**, combining the 21-check run and the affected 30-check continuation without double-counting the 11 component checks |
| Contract generation and library types | Passed |
| API/frontend TypeScript checks | Passed |
| Disposable API and web production builds | Passed; bundles never executed |
| Web build advisory | Entry chunk approximately **2,805.70 kB** minified; existing size advisory, not a build failure |
| Diff/whitespace check | Passed |

The PostgreSQL fixture uses the actual new migration and minimal existing-table
contracts for retained payment/history reads, plus explicit retained
invoice/receipt/BRO/ledger evidence snapshots. It does **not** certify the full
shared schema, real provider behavior or production privileges. Preservation is
shown in the isolated fixture and by the absence of financial DML in grant paths,
not claimed as a shared-data comparison.

Initial verification exposed a fake-clock test-loading timeout from a heavy
dynamic import and test response typing errors. The reader was isolated and
typing corrected; the final affected tests and typechecks above passed.
An initial frontend invocation named a nonexistent enforcement `.test.tsx`;
its actual `.test.ts` and `.render.test.tsx` files were subsequently executed
and are counted explicitly above.

Logs retained (ignored, not deployment inputs):

- `generated-artifacts/free-academic-terms/backend-final.log`
- `generated-artifacts/free-academic-terms/backend-corrections.log`
- `generated-artifacts/free-academic-terms/calendar-final.log`
- `generated-artifacts/free-academic-terms/frontend-final.log`
- `generated-artifacts/free-academic-terms/frontend-corrections.log`
- `generated-artifacts/free-academic-terms/api-types-final.log`
- `generated-artifacts/free-academic-terms/web-types-final.log`
- `generated-artifacts/free-academic-terms/types.log`
- `generated-artifacts/free-academic-terms/api-build.log`
- `generated-artifacts/free-academic-terms/web-build.log`

## Blockers and operational boundary

1. **0183 remains unapplied to shared Development/Production.** No grant has
   been created in either shared environment. The Owner panel disables writes
   until schema/guard delivery is available. Existing 0181/0182 candidates are
   also unchanged and unapplied by this work.
2. **Authenticated runtime acceptance remains unverified.** No approved
   isolated signed-in Owner fixture was established. The only preview capture
   was an anonymous `/subscriptions` request, which rendered sign-in; it is not
   evidence of the Owner grant flow. Component/HTTP/PostgreSQL tests are not an
   authenticated browser or mobile-layout acceptance pass.
3. **During the original implementation, no shared service restart or operational activation occurred.** Disposable
   compilation does not establish that the running shared API serves the new
   endpoints. No worker, payment, SMS, secret, provider setting, publication or
   deployment was enabled or changed.
4. **Calendar amendments and reinstatement are deliberately conservative.**
   Changed dates invalidate free entitlement; suspended/completed grants are
   not replaced or automatically resumed. A future reinstatement/date-review
   workflow would require separately agreed policy rather than historical edits.

This report documents source completion only, not permission to apply a
migration, restart a service or exercise the controls against real schools.
