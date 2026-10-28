# EduCore customer-controlled PostgreSQL: scoped feasibility decision

Review date: **28 October 2026**.

## Decision

**Conditionally feasible in PostgreSQL; not yet a verified hosting solution or
an approved migration.** The four required guard functions and nine triggers use
ordinary PostgreSQL/PL/pgSQL facilities, not a Replit-specific engine feature.
A customer-controlled service that permits owner-managed procedural migrations
could remove the *delivery-method* limitation. No candidate provider, plan,
account, permissions, network path or recovery service has been verified.

**GO:** use this assessment to review a specific provider/plan and obtain the
separate approvals below. **NO-GO:** provisioning, data export/copy, migration,
credential changes, Production connection/cutover, publishing or LIVE activation.
The current Production blocker is **not resolved** by this review.

Preserve the existing schema and financial behavior: ₦3,200 direct Student
collection (320000 kobo), zero school/BRO allocation in that collection,
school-specific January-term rollout, separate approved BRO expense, Option A,
audit/idempotency and retained history. No financial-model redesign is needed
or authorized.

## Evidence boundary

Only checked-in source, existing reports and non-secret reference metadata were
used. No database, hosting or payment-provider connection was opened. No
Production SQL was executed. No accounts, services, secrets or data changed.
No Support contact, login attempt or broad test/rehearsal rerun occurred.
No Agent task was in progress at the initial task check.

### Established from current source

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| `lib/db/src/index.ts`, `connection-resilience.ts` | Node `pg`/Drizzle pool accepts the configured `DATABASE_URL`; startup does not perform schema installation; connection acquisition is bounded at 10 seconds. | External reachability, TLS configuration, capacity, target identity or authority to change the URL. |
| `lib/db/drizzle/0179_restore_direct_and_bro_guards.sql` | Transactional restoration of the four functions/nine triggers; PostgreSQL 14+ syntax; 2-second lock and 30-second per-statement timeouts. | Production installation, acceptable downtime or host permissions. |
| `artifacts/api-server/src/services/financial-guard-schema.ts` | Exact body, execution-property, binding, event and enablement contract. | A lifecycle installer, recovery service or protection from privileged DDL. |
| Current repository inventory | 180 numbered SQL files, 54 entries in the checked-in Drizzle journal and 34 schema TypeScript modules. | Current Production ledger, catalog, row counts, size or a replayable complete baseline. |
| `scripts/src/schema-export/README.md` | Dependency-ordered, credential-free audit export; raw ORM order can put FKs before supporting unique indexes. It emits no functions, triggers, extensions or backfills. | A full database backup, approved target initializer or Production migration runner. |
| `lib/db/package.json`, `schema-tooling-policy.mjs` | Schema push commands are disabled and workspace tooling is review-only. | Permission to bypass those restrictions for a new host. |

The journal/files mismatch is a concrete reason **not** to run all files or call
the existing journal a complete migration history. It is not a finding that the
current Production ledger has a particular state.

### Existing, not newly reproduced, evidence

- `docs/next-term-readiness-2026-10-28.md` and
  `docs/financial-guard-repair-0179.md` record successful isolated guard/body/
  behavior/rollback checks. They do not establish a provider's permissions,
  source version or a production-sized restoration.
- `docs/live-payment-unresolved-blockers-2026-10-28.md` records the earlier
  Production-routed **replica** observation: zero of the four expected functions
  and nine triggers; no Student rule/direct-release records; one saved January
  second-term start of **11 January 2027**. This review did not repeat those
  queries or treat that replica as the serving primary.
- The Owner previously reported binding/recovery and merchant confirmations.
  Retain and reuse that evidence. Its original correspondence and a current,
  primary-bound restore rehearsal were not independently inspected here.
- Older Phase 11B/11C counts concern an earlier Development schema and cannot
  size or certify today's Production database.

Reviewed 0179 SHA-256:
`09e2f989c23d80d580bc2428ddd38b962715f11d0c70700e975ab5ca9809c21b`.
The underlying SQL/guard contract is unchanged. This identifies the previously
reviewed artifact; it is not an execution instruction or authorization.

## Technical acceptance requirements

### 1. Engine and compatibility

- **PostgreSQL 14 is a source syntax floor**, because 0179 uses
  `CREATE OR REPLACE TRIGGER`. It is not a recommendation to buy a particular
  major/version. Choose an actively maintained provider-supported major after
  identifying the actual source major and rehearsing compatibility. The actual
  current Production version, encoding, locale/collation and timezone settings
  are **unknown from the evidence used here**.
- All four target functions use trusted PL/pgSQL, ordinary tables, transactions,
  trigger row records and exceptions. No additional extension is referenced by
  these functions. A static statement-head scan of the 180 SQL files found no
  explicit `CREATE EXTENSION`, role/ACL DDL, RLS-enabling DDL or
  `NULLS NOT DISTINCT` declaration. That scan is not a live catalog inspection;
  installed extensions, RLS, provider defaults, role grants and generated/dynamic
  statements remain unverified.
- Inventory the **whole** source catalog before any approved move. Earlier
  migrations define other financial, device, security and operational triggers;
  moving only the 13 target objects would be incomplete. Preserve other
  functions, constraints, sequences, views, grants, extension dependencies and
  object identities/references as applicable.
- Validate source/target text sorting, case comparisons, timestamp behavior and
  `Africa/Lagos` timezone data. Preserve exact numeric amounts, identifiers,
  dates, default expressions, JSON and sequence ownership. Do not use a host
  move to normalize historical financial records.
- Choose `pg_dump`/`pg_restore` binaries compatible with the source server and
  the planned target. Do not assume that a dump can be restored to an older
  PostgreSQL major or that a major-version change is risk-free.

### 2. Owner, migration and runtime permissions

A provider must allow an authorized database owner/migration role to create or
replace trusted PL/pgSQL trigger functions, create triggers, enable them and
manage the existing schema. The reviewed 0179 does not itself request superuser.
Creation requires the relevant schema/language/function/table privileges;
replacing functions and altering table trigger enablement require appropriate
ownership. A service offering only data-API access is insufficient.

Use separate ownership/migration and runtime identities. Runtime must have the
existing required SELECT/INSERT/UPDATE and sequence permissions, including
SELECT access needed by the invoker-security BRO scope function. Explicitly
rehearse those rights. Runtime should not own the schema/tables or have
superuser, role-creation, replication, trigger-disable or unrestricted DDL
authority. Precise grants are **not established** by the current source: no
complete current Production ACL inventory was available.

The verifier deliberately expects invoker security, exact bodies and
`proconfig = NULL`. Do not add `SECURITY DEFINER` or per-function settings to
make a restrictive provider work. Secure schema ownership/CREATE rights and
verify name resolution/search path without changing the approved contract.
Do not introduce RLS, tenant-role redesign or new financial permissions as a
side effect of hosting.

Ordinary triggers do not protect against a privileged owner disabling them,
TRUNCATE or DDL. The attempt guard also does not enforce the application's
entire nonterminal transition matrix. Keep Option A and all application guards;
this move would not establish all-writer equivalence.

### 3. Supported migration lifecycle

A candidate is acceptable only if its documented service permissions and
supported operator workflow permit the complete lifecycle:

1. Capture a versioned, hashed, authoritative baseline and permissions map.
2. Apply reviewed versioned procedural changes using an authenticated,
   separately authorized **operator-run** mechanism, not application startup,
   build hooks or a disguised managed-Production runner.
3. Serialize execution; fail on unexpected target identity, catalog drift or
   artifact hash changes. Record actual success/failure and rollback outcome.
4. Use transactional DDL and bounded locks where supported; measure the
   operation under realistic data/load. Existing timeouts are not a maintenance
   window or a total transaction-duration guarantee.
5. Verify exact post-application definitions, permissions, bindings and behavior.
6. Maintain reviewed forward fixes, incident rollback/recovery procedures and
   evidence for later upgrades.

Do not edit the legacy ledger/journal to pretend unapplied migrations ran.
Preserve it as historical data; explicitly document a new baseline and the
separate approved lifecycle/bookkeeping if one is implemented. Do not remove
the current review-only tooling restrictions to shortcut this process.
No such runner or lifecycle was implemented by this assessment.

### 4. Ordering and smallest data-transfer approach

**Preferred candidate, subject to sizing:** a single controlled write-freeze and
full logical dump/restore into an isolated external target, followed by the
reviewed guard migration and verification **before any application writers
connect**. This is usually simpler to reason about than initial replication,
but no acceptable duration can be promised without actual size and timings.

Do not initialize by replaying all 180 migrations, by using the raw ORM export
or by treating the audit-only ordered export as a complete backup.
Use the approved current authoritative source baseline, not Development data.

An eventual reviewed restore plan should:

- Preserve all required data and existing ledger/history, sequence values,
  defaults, object dependencies and external-reference identifiers.
- Follow a reviewed archive TOC: pre-data definitions, data and sequence state,
  then post-data indexes/constraints/triggers. Ensure parent tables and existing
  supporting unique keys exist before dependent FKs; preserve index-versus-
  constraint ownership and PostgreSQL's physical identifier limits.
- Explicitly map source owners/grants to target identities. Never restore
  obsolete privileged roles blindly, silently discard ACLs or use a superuser
  bypass to ignore permission failures.
- Restore existing source procedural objects. Install the 13 approved missing
  guards only after prerequisite tables, retained data and dependent scope
  records are available. Keep target access isolated while protection is
  incomplete; do not disable guards on an active source or exposed destination.
- Verify the full source-to-target catalog/data baseline plus the **explicitly
  approved guard additions**. A target with intentionally added missing guards
  is not byte-identical to the source catalog; document that delta.
- Check financial aggregates and immutable history, references, tenant keys,
  ledger preservation and sequence safety. Compare canonical evidence/hashes
  rather than rewriting rows to make counts match.

If size, write activity or the downtime requirement prevents that approach,
stop for a separately approved replication/CDC design. Source logical
replication privileges, WAL/slot settings, DDL/sequence handling and available
supported export mechanisms are **unknown**. No replication is proposed as an
already-supported shortcut.

### 5. Connectivity and application boundary

- The existing Node driver supports ordinary PostgreSQL connections. It does
  not prove DNS/routing, outbound access, firewall allowlisting, static egress,
  regional latency, TLS trust or the provider's connection limits.
- Initial migration/restore must use an endpoint suitable for DDL and complete
  transactions. Prefer direct or session-pooled application connectivity for
  the first reviewed deployment. Whole-app transaction-pool compatibility is
  **unverified**; direct payment code uses transaction-scoped advisory locks and
  checked-out clients. Do not select a pooling mode from its price alone.
- The application passes a connection string without explicit production CA/TLS
  options here. Require verified TLS and hostname/CA validation using the
  selected provider's supported client configuration. Never disable certificate
  checking to make a connection succeed. No URL or secret was inspected or
  changed for this review.
- Budget the complete app/worker pool count across instances plus migrations,
  monitoring and recovery. Current connection usage, scaling behavior and
  acceptable latency are unknown; do not assume one pool or one server.
- Runtime fingerprints identify configuration, not authoritative resource or
  primary binding. Match the exact approved target to serving revision, owner-
  controlled resource evidence, runtime role and recovery inventory before
  declaring a future switch successful.
- Keep Development/disposable fixtures isolated. Prevent any legacy Publish,
  push or testing path from targeting the external Production database.
  Existing tests use explicit disposable targets; preserve those safeguards.

### 6. Backup, recovery, rollback and incoming writers

- Require encrypted, access-controlled full backups, explicit retention/PITR,
  restore permissions and an independently isolated restore test. Establish
  achievable **RPO/RTO**, not just “backups enabled.” Provider backup terms and
  restoration timings are unknown.
- `scripts/src/dev-backup/README.md` describes a Development-only/local-socket
  tool; it refuses Production/TCP. Do not repurpose it, strip deployment
  markers or remove guards to export Production. An approved source export
  route must be established separately before migration can be executable.
- Inventory every writer: API requests, workers/schedulers, devices/NFC,
  callbacks/webhooks, background reconciliation and operators. LIVE disabled
  does not mean all school or historical-payment writes are stopped. A freeze
  must preserve incoming events and provider retry/idempotency behavior.
  No complete write-quiescence mechanism or durable ingress plan was verified.
- A consistent dump alone does not preserve writes committed afterward.
  Quiesce writers through final export and verification, or approve and prove a
  separate catch-up method. Do not permit simultaneous old/new writers.
- Before any target writes, rollback can mean aborting the isolated target and
  retaining the unchanged source; verify compatibility and resume the source
  under the approved plan. A failed transactional guard install must leave its
  prior state intact. Never “roll back” by removing history protections.
- **After any target writes, simply repointing to the old database can lose or
  duplicate financial events.** Freeze both sides, retain both evidence sets
  and use an explicitly approved reconciliation/recovery plan before deciding
  direction. No automatic reverse replication or blanket switch-back.
- Retain the original source and its recovery evidence read-only for an
  approved rollback/retention period. Disposal requires a separate approval.
- Database backups contain sensitive school/child data. Never put dumps, raw
  rows, credentials or private recovery artifacts in Git, Library, reports or
  public storage. Approve private encrypted storage and access/retention.
  The database move must preserve existing App Storage, identity-provider and
  provider-reference links; it does not move those services automatically.

## Unknowns that block provider selection or an executable migration

| Unknown from available evidence | Minimum evidence/decision needed later |
| --- | --- |
| Current source major, extensions, collation, ACLs and full procedural inventory | Separately authorized, resource-bound source inventory through an approved route. |
| Database/table/index/TOAST sizes, archive size, growth and WAL/write rate | Authorized measurements plus a timed full export/restore; no sizing from repository bytes or old table counts. |
| Supported Production export access | Operator-owned approved export mechanism; do not substitute the Development-only utility or a credential workaround. |
| Specific host/plan lifecycle and role limits | Provider-documented CREATE/REPLACE/ENABLE rights and versioned migration/backup/restore workflow for the exact plan. |
| Network/TLS/pooling/latency/capacity | Approved isolated runtime-to-candidate connectivity and load/permission tests. |
| Data location, subprocessor terms, security and access controls | Owner acceptance appropriate to retained school/child/financial data. |
| Downtime, RPO/RTO, current restore point and write freeze | Accepted maintenance/recovery objectives and a successful isolated rehearsal. |
| Actual prices, resource sizing and ownership | Provider quote/plan terms, budget ceiling and named operational owner. |

Absence of this evidence is not a conclusion that the corresponding capability
is impossible. It means this assessment cannot approve it or estimate it.

## Smallest safe implementation plan — future, approval-gated

1. **Provider/plan paper review:** identify one customer-controlled PostgreSQL
   option meeting the technical and data-location requirements. Confirm its
   supported procedural lifecycle and export/backup/exit options. No account,
   purchase or credential collection is authorized by this report.
2. **Approve a bounded non-Production rehearsal:** after separate budget,
   privacy and provisioning authorization, establish distinct owner/runtime
   roles on an isolated target. First test the unchanged guard contract and
   restricted role behavior using fictional fixtures; then use a real baseline
   only if a separately approved private export/copy is available.
3. **Approve and measure the full rehearsal:** demonstrate compatible
   dump/restore ordering, all retained data/ACLs/sequences, exact guard
   verification, application-role behavior, TLS/connectivity, backup restoration,
   incoming-writer handling and rollback. Record observed durations and costs.
   This stage must determine whether a maintenance-window dump/restore is viable.
4. **Obtain a separate Production change approval:** only after satisfactory
   evidence, approve exact source/target IDs, hashed artifacts, operator, window,
   freeze/ingress plan, backup/restore point, RPO/RTO and stop/rollback criteria.
   Credential rotation/configuration changes need their own explicit authority.
5. **Execute only that approved plan, then verify:** require full catalog/data,
   permissions, target binding and app acceptance evidence before resuming
   writers. A future database cutover does **not** authorize Publish, alter
   academic calendars, create a financial rule or enable LIVE.

This is a decision sequence, **not a runnable migration or authority to execute
any stage**. Stop rather than improvise if any prerequisite cannot be met.

## Cost categories — no quotes or invented estimates

- Database compute/availability tier and any separate rehearsal environment.
- Primary data/index/TOAST storage, operational headroom and WAL capacity.
- Backup/PITR retention, isolated restore capacity and encrypted export storage.
- Network egress/transfer, cross-region traffic and any paid pooling/proxy tier.
- Monitoring/log retention, security controls and support/service level.
- Engineering/operator time for inventory, ACL design, migration lifecycle,
  rehearsal, permission tests, maintenance, rollback and incident response.
- Temporary dual-running costs, contingency and later data-export/exit costs.

No provider, size, region, pricing currency, recurring total or free-tier
eligibility is established. Require an actual quote and spending ceiling before
provisioning. Existing Replit application/identity/storage dependencies remain
unless separately changed; moving PostgreSQL does not remove their costs.

## Exact Owner approvals required

The present approval covers **feasibility review only**. Before any external
service or migration, obtain explicit approval for:

1. **Provider, region, account owner and data/privacy terms**, including who may
   administer retained child/school/financial data and the acceptable service
   and security controls.
2. **Provisioning and budget:** exact plan, rehearsal/dual-running charges,
   recurring ceiling, backup/transfer costs and cancellation responsibility.
3. **Source inventory/export and isolated copy:** exact source identity,
   supported access mechanism, data scope, encryption, access list, destination,
   retention and deletion rules. Review authorization is not data-copy consent.
4. **Migration lifecycle and roles:** baseline provenance, approved SQL hashes,
   owner/runtime separation, execution bookkeeping, no ledger fabrication,
   operator and acceptance/rollback contract.
5. **Maintenance and recovery:** freeze/ingress ownership, downtime, RPO/RTO,
   current backup/restore evidence, rollback window and post-write recovery plan.
6. **Production credentials and cutover:** exact source/target, secret/config
   changes, rotation/revocation, serving revision and verification/stop criteria.
   This approval must follow a successful rehearsal; none is granted here.
7. **Later retirement of the old source/backups**, if ever appropriate, after the
   separately approved retention/recovery period.

Publishing or activating LIVE would require their own subsequent explicit
authorization and the existing merchant, endpoint, school-term, rule,
reconciliation and release-review gates. No hosting approval substitutes for
those financial approvals.

## Narrow app diagnostics correction

The Owner page previously called review storage “missing” for every
`schemaReady = false`. Tables may exist while function definitions, triggers or
permissions fail. The warning now says required schema, permissions or history
guards have **not passed verification**; the existing server issue detail remains
visible. Creation/approval gates and all backend behavior remain unchanged.

No new disposable fixture was necessary: the SQL/guard contract was not changed,
and existing isolated checks already cover it. Only the changed frontend
diagnostics regression file and typecheck are appropriate for this change.

### Verification performed in this review

- `pnpm --filter @workspace/edupulse exec vitest run src/pages/direct-flutterwave-live-readiness.test.tsx`
  — **15/15 passed**, including separate guard-definition and table/permission
  diagnostic cases, blocked creation, unauthorized access, scope handling and
  no unintended financial mutations.
- `pnpm --filter @workspace/edupulse run typecheck` — **passed**.
- `git diff --check` — **passed**.
- Recomputed 0179 SHA-256 matched the unchanged reviewed hash above.
- GitHub main was checked read-only against the cached main reference; current
  Replit-only readiness work was preserved. No push or publishing.

These tests do not certify an external host, authenticated browser acceptance,
Production permissions, restoration, provider delivery or LIVE readiness.
