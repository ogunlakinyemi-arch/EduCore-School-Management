# Flutterwave LIVE — runtime-role and Publish lifecycle decision

## Quinn's latest response supplied by the user

The user supplied this exact guidance on 2026-10-27:

> Replit cannot confirm a separate restricted production PostgreSQL login is supported;
> Publish doesn't synchronize custom roles/grants/memberships/default privileges;
> credential regeneration only changes the production connection-string password
> and redeploys; PITR role/privilege behavior is undocumented.

This supersedes the open role-lifecycle investigation below. Do not request the
same confirmation again, introduce a custom runtime login, or treat password
regeneration as role isolation. There is no new Support escalation.

### Concrete design without a custom role

Keep the **original nine functions and twenty triggers** under the existing
documented database credential. The six reviewed forward files contain no
`CREATE ROLE`, `SET ROLE`, `GRANT`, `REVOKE`, owner reassignment or
`SECURITY DEFINER`. They do not require the separate-role prototype to enforce
their normal DML invariants. This is not a promise that a database owner cannot
deliberately disable/drop a trigger with DDL.

`requireLiveRelease` already uses the ordinary application pool and checks the
approved manifest, required columns and enabled row-level guards. It has no
custom-login requirement. Role-free acceptance and fail-closed missing-guard
behavior are now explicit mocked-catalog regression tests.

Application least privilege remains useful for HTTP authorization and narrowing
service entry points, but cannot replace these database guarantees. The shared
`ResilientPool` accepts arbitrary SQL; another service path, operator or SQL
injection with that same credential does not have to use a wrapper's checks.
CHECK/UNIQUE/FK constraints validate current state, not immutable OLD-to-NEW
history, permanent claims or mandatory atomic auditing. The existing
counterexample review demonstrates those gaps. No new wrapper/ORM/framework
would make it an all-writer database boundary.

### Installation, not a missing runtime-role implementation, is blocked

The Drizzle configuration is offline/review-only, push commands refuse writes,
post-merge skips schema changes and the audit exporter emits no functions or
triggers. Adding custom SQL to a folder or journal does not make managed Publish
execute it. No documented custom-SQL Publish extension was established.

Replit's documented **Database → My Data → SQL console** runs SQL commands;
Production editing is a separate explicit UI action. It is an owner/operator
manual SQL feature, not a Publish importer, not an Agent write capability, and
not a documented guarantee of whole-file session/transaction/error handling for
this package or preservation during later Publish.

**Smallest next step:** retain the original single-credential/trigger design.
If an owner-operated installation is chosen, use the existing reviewed package
and runbook—not a role redesign—and first establish an authorized execution
procedure with the required transaction/session/stop-on-error guarantees and
matching Development/future-Publish review. That would be a separately authorized
manual Production SQL operation, excluded from the current request. Within a
Publish-only/no-Production-SQL release, there is no executable installation step
established here; leave LIVE fail-closed until Publish can carry the protected
objects. No Production SQL, restart, deployment or approval seed was performed.

Reference: https://docs.replit.com/features/data-and-storage/work-with-your-data

Focused validation after this decision: **148 tests passed across five files**,
including the role-free acceptance case and false/null/absent guard-readiness
denials; API TypeScript check passed. Only documentation, project memory and
regression tests changed. No runtime implementation, protected SQL, credentials
or database was changed; no deployment or restart was performed.

## Historical prototype review — not an adopted release design

**Release verdict: NO-GO.** PostgreSQL role separation works in isolation for
append-only history; the current application has no established role separation,
and no documented end-to-end managed-Replit provisioning/Publish/restore workflow
was established. This is not evidence that Replit cannot support custom roles.
It is insufficient evidence to adopt them as a financial release prerequisite.

## Current application: verified from files, not database access

- `lib/db/src/index.ts` constructs one shared `ResilientPool` from `DATABASE_URL`,
  with a separate explicit Unix-socket terminal-test mode. There is no runtime
  role selection, `SET ROLE`, separate migration DSN or role capability check.
  Financial services accept this general SQL-pool interface.
- The **actual authenticated role, object owners, grants, memberships, CREATEROLE
  capability and deployed target infrastructure remain uninspected**. Neither
  the variable name nor a historical database name establishes these facts.
  No secret values, connection strings or shared database catalogs were read.
- `lib/db/drizzle.config.ts` is credential-free/offline review configuration.
  `lib/db/package.json` routes `push` and `push-force` to
  `schema-write-disabled.mjs`, which opens no connection.
- `scripts/post-merge.sh` installs dependencies and explicitly skips schema writes.
- The API artifact's production build runs the API build script; the run command
  starts the compiled server. `build.mjs` bundles code. No role/grant provisioning
  or schema migration is configured in these build/run paths.
- `.replit` has the managed deployment and dependency-maintenance configuration;
  no independent ACL-management lifecycle is declared.

These source observations do not prove that an out-of-band actor has never
configured roles. They prove that the repository is not a documented mechanism
for provisioning and maintaining the proposed boundary.

## Official Replit evidence and its limits

Official sources consulted (the first three fetched directly; the fourth returned
by targeted official-documentation search):

1. [Development and production databases](https://docs.replit.com/features/data-and-storage/development-and-production)
   documents separate databases, use of production `DATABASE_URL` by the
   published app, and applying Development structural changes at Publish.
   It explicitly mentions **custom PostgreSQL roles** in the **Neon-to-Helium
   upgrade** section: roles/permissions migrate, but custom-role passwords must
   be reset. This is affirmative evidence about that infrastructure upgrade,
   **not** a promise that normal Publish provisions roles or retains ACLs.
2. [Connection details](https://docs.replit.com/features/data-and-storage/connection-details)
   documents production access from PostgreSQL-compatible external clients.
   It also documents regeneration of **Neon Production** credentials: password
   changes, host/database/role do not, and supported deployments are redeployed.
   It does not document selection/rotation of an additional runtime role, a
   separate Publish migration principal, or equivalent Helium custom-login behavior.
3. The [Production databases URL](https://docs.replit.com/cloud-services/storage-and-databases/production-databases)
   currently returns the same Development/Production documentation.
4. [Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets)
   is the official reference returned for configuring external deployment
   credentials. No credential or setting was changed during this review.

Targeted official-documentation searches did not establish the managed-role
creation procedure, the app's CREATEROLE entitlement, separate runtime/Publish
credential selection, ownership of newly created tables, default-privilege policy,
or role/grant retention after ordinary Publish/recreation/restore.
An initial search-generated migration summary conflicted with the primary page
and managed-database guidance; it was not used as authorization or implementation
advice. No deploy-build migration hook was added.

**Conclusion:** an external SQL client is a connection capability, not proof of
role-management permission or a supported ACL reconciliation process.

## Isolated prototype: enforceable subset and precise remaining limitation

Only the existing disposable six-migration PostgreSQL harness was used. It checks
database name, private temporary data directory, socket-only server and fixture
identity before creating synthetic roles. No application connection is imported.
The earlier constraint-only candidate is reused as setup, not rerun as a test.

Three fresh roles exist **only inside that temporary cluster**:

- NOLOGIN schema owner.
- LOGIN, NOINHERIT, non-superuser runtime, with no owner membership or role/database
  creation privilege, no bypass-RLS privilege and no schema CREATE.
- Separate LOGIN migration actor permitted to explicitly assume the schema owner.

Only candidate-schema objects change ownership/ACLs. The original tables,
functions and triggers are untouched. The prototype selectively grants history
SELECT/INSERT and mutable-column UPDATE; it is **not a complete application
permission matrix** and is not wired into the app.

| New focused test | Proven outcome |
| --- | --- |
| Runtime history protection and escalation refusal | Direct SQL fee/audit updates, result/event/checkout deletion, audit TRUNCATE, table ALTER, owner `SET ROLE`, session-authorization change and self-grant of owner membership fail with SQLSTATE 42501. Intended event/audit INSERTs succeed. |
| Controlled schema ownership and replacement lifecycle | Migration actor must explicitly assume owner. Owner-specific default SELECT applies to a new/recreated probe. Explicit INSERT permission is lost on recreation, denies writes until regranted, then permits them. This simulates PostgreSQL DDL, **not actual Publish**. |
| Mutable-state limitation | Runtime's column UPDATE grants permit intent unhold, accrual release, activation reactivation, batch reapproval and UNKNOWN-to-RESERVED checkout reset. Revoking the state grant also denies the legitimate hold. |

Thus an **append-only DML boundary is enforceable against arbitrary SQL executed
as this restricted runtime login**, for the objects/operations tested. That
statement excludes trusted owner/migration administrators and a different
privileged login. A runtime using the owner login followed by `SET ROLE` would
not provide the same boundary; its original session authority remains available.
Owner credentials must not be available to the serving process.

Role separation does **not** make mutable status columns monotonic. Grants do not
inspect OLD/NEW or constrain the WHERE predicate. A later append-only hold/
completion/decision model with derived readers may address that, but the current
state machines, financial readers and all other writers would need a separate
demonstrated equivalent redesign. Nothing here authorizes removing their guards.
INSERT permission is also not provider-verification evidence: these tests do not
replace any server-side verification or release gate.

## Missing supported lifecycle contract

Before this can underpin a managed-Replit release, one authoritative workflow must
establish **all** of the following for this app's actual database:

1. Supported creation/management of the restricted login and separate schema owner,
   including who is authorized to create them and how custom logins authenticate.
2. Published runtime receives **only** restricted credentials while Publish keeps
   owner/schema authority outside the serving process. Development credentials
   must not become a Production fallback.
3. Publish's actual DDL creator/owner and how its grants/default privileges are
   maintained for creation, rename, replacement and new sequences. Defaults are
   per creating role; they do not automatically transfer explicit old-table ACLs.
4. Supported credential rotation, restore/PITR, infrastructure upgrade, and
   redeployment behavior for both principals. A restore must not silently widen
   runtime access or leave broken custom-role authentication.
5. A supported verification/failure policy: serving must stay blocked if ownership,
   memberships, ACLs or credential binding differ. No startup DDL, automatic
   fallback-to-owner, or unreviewed Publish grants-repair hook.

No live catalog access, privilege change or credential experiment is needed to
ask Replit for this contract. The safest next request is:

> Is a restricted custom runtime login, with an independent Publish/schema owner,
> supported for this managed database? Please identify the documented provisioning,
> credential-selection, grants/default-privileges and rotation/restore workflow,
> including behavior when Publish creates or recreates tables and sequences.

## Safest viable options

1. **Now:** retain all existing protections/gates and keep LIVE unreleased.
2. **Preferred investigation:** obtain the managed-Replit contract above, then
   separately authorize Development-only validation. Even a positive answer does
   not solve mutable-state irreversibility; that redesign remains necessary.
3. **Conditional alternative, not permission to migrate:** an explicitly selected
   external managed PostgreSQL service with documented owner/runtime roles and a
   separately controlled migration lifecycle. Replit can host the app using
   external deployment credentials, but its managed Publish schema flow must not
   be assumed to manage that external database. This is a larger architecture/
   operations decision, not an automatic fix, and requires explicit authorization
   and full history-preservation planning before any change.

**Can Replit Publish maintain the boundary? NOT ESTABLISHED.** A local role/ACL
test cannot certify that platform lifecycle. The upgrade/password documentation
does not supply the missing normal-Publish contract.

## Exact changes and executed checks

Changed files:

1. `artifacts/api-server/src/test/flutterwave-live-permission-boundary.ts` — new
   guarded, test-only permission prototype.
2. `artifacts/api-server/src/services/flutterwave-live-six-migrations.postgres.test.ts`
   — three new focused cases.
3. `docs/finance/flutterwave-live-permission-boundary-review.md` — this decision.
4. `docs/finance/flutterwave-live-application-redesign.md` — link to this review.
5. `.agents/memory/managed-role-lifecycle.md` — durable documentation-scope rule.
6. `.agents/memory/MEMORY.md` — index link to that rule.

Actually executed:

- `pnpm --filter @workspace/api-server exec vitest run src/services/flutterwave-live-six-migrations.postgres.test.ts -t 'permission boundary:' --reporter=dot`
  — **three passed, seventeen previously completed tests skipped**. Only the
  existing disposable setup/identity/preservation/cleanup harness was reused.
- `pnpm --filter @workspace/api-server run typecheck` — **passed**.
- `git diff --check` — **passed**.
- `sha256sum -c docs/finance/flutterwave-live-production-review/originals.sha256`
  — **all fourteen matched**.
- Protected-path `git diff --exit-code` — **no changes** to original migrations,
  rollbacks, runbook, manifest or Production review package.

No completed audit or earlier focused test was rerun. No runtime code, shared/
Production SQL, application-data reset, secrets/settings, publish or LIVE
activation changed. Original migration/rollback/review files are preserved.
Allocation remains NGN 500000 = 190000 school + 310000 Yetenia gross, with the
eligible 10000-kobo BRO liability deducted from Yetenia, never another checkout
recipient. Provider verification, finalization, idempotency and reconciliation
are unchanged.
