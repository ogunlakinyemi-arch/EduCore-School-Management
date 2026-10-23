# Flutterwave Development readiness: follow-up evidence

Date: **2026-10-23**. Decision: **HOLD**. Companion to
[the approval package](flutterwave-live-development-approval-package.md), §9.
This is investigation evidence, not application migration or release authority.

## 1. Reproduction and evidence identity

Only a fresh local PostgreSQL 16.10 cluster was connected. It used an owner-only
temporary directory, explicit fresh role/socket/database arguments, no TCP
listener, no inherited application/provider configuration, no application
database imports and explicit UTF8 encoding. Matching the fresh postmaster PID,
data directory, socket directory and system identifier preceded scenario SQL.
Node was **24.22.1**; the prior run's exact Nix executable path no longer existed,
so the actual executable was discovered rather than reusing a stale store path.

```sh
NODE_BIN="$(env -i PATH="$PATH" node -p process.execPath)"
env -i PATH="$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8 "$NODE_BIN" \
  scripts/src/flutterwave-readiness-followup.mjs
env -i PATH="$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8 "$NODE_BIN" \
  scripts/src/flutterwave-provenance-followup.mjs
env -i PATH="$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8 "$NODE_BIN" --test \
  scripts/src/flutterwave-rehearsal/pg-check-tree.test.mjs
env -i PATH="$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm \
  --filter @workspace/api-server exec vitest run src/lib/database-resilience.test.ts
```

Both entry points reject configuration/target arguments. The native entry
requires the retained, hash-verified prior evidence directory from §8; it does
not silently regenerate a different baseline if that directory is missing.
Each command is independent: the provenance-only command never starts PostgreSQL.
The API tests use fictional error/client fixtures, not a runtime pool connection.

Evidence under ignored `generated-artifacts/flutterwave-readiness-followup/`:

| Run | Result / scope | report.json SHA-256 |
|---|---|---|
| `edupulse-fw-followup-jPVZAu` | `ISOLATED_FINDINGS_VERIFIED_HOLD`; 26 named checks; 02:01:21.392–02:02:04.948 UTC | `5809ee84597baebbac0418431df7a4d157fa89f8866ce2095e2050d76929d177` |
| `fw-provenance-only-stqjSS` | `SOURCE_NOT_FOUND_HOLD`; refs/reflogs plus unreachable-tree extension; 02:04:55.864–02:05:05.639 UTC | `5ae14c58c4e521691f145b729489b237bacc7e1be79daa008322a4752f870e84` |

The native system identifier was `7699677560214656050`, private socket/data root
`/tmp/edupulse-fw-followup-jPVZAu`. The server was stopped and its directory
deleted. The provenance-only temporary directory was also deleted. Numbered
command arguments/stdin/stdout/stderr and native server/lock logs remain local
in the generated evidence directory, not Git or a managed backup.

Five new parser/matrix unit tests and **30** focused database-resilience tests
passed. No full API suite, UI/browser test, provider test or real recovery test
is being claimed as a fresh run.

## 2. Unchanged raw export: late key, not absent model uniqueness

The same retained raw and dependency-ordered exports were hash-verified against
the earlier report. All 1,249 statements have an identical duplicate-aware
SHA-256 multiset; the ordered version is a permutation, not revised DDL.

The first failing FK is `staff_nfc_allocations_subscription_owner_term_fk`,
referencing `staff_nfc_subscriptions` columns:
`(id, employee_id, school_id, academic_session_id, academic_term_id)`.
The parent has a single-column id primary key, which is not a qualifying
five-column referenced key. The model also declares the required nonpartial
btree unique index `staff_nfc_subscriptions_id_employee_school_term_uq`, but the
raw export does not create it until after the FK:

| Declaration | Raw statement position (1-based) | Ordered position |
|---|---:|---:|
| Supporting unique index | 1103 | 315 |
| Dependent FK | 556 | 1098 |

Native evidence, all in new disposable databases:

1. Complete unchanged raw export failed with **42830**, atomically, with an
   unchanged empty catalog after connection rollback.
2. The two original parent/child CREATE TABLE declarations followed by the
   original FK reproduced **42830** without partial FK/catalog change.
3. Creating the **same original** unique index before the **same original** FK
   succeeded. The validated FK's supporting-index catalog association matched
   that original index name.
4. Complete unchanged dependency-ordered export installed **187 tables and
   693 validated FKs**, with valid/ready indexes.

Thus PostgreSQL's error describes missing qualifying uniqueness **at execution
time**, not absent uniqueness in the model. The generic raw emitter's phase
ordering is unsuitable for this source model. In that earlier pass, no emitter,
source SQL, historical migration, key ownership or generic guard was changed.
The later workflow-only correction and regression are recorded in §8. Use the reviewed
dependency-aware path only for explicitly approved disposable schema audits;
neither version is an approved application-target migration or Publish diff.

## 3. The two CHECKs: equivalent semantics, different retained trees/text

Constraints:
`transport_history_event_reason_check` and `transport_routes_weekdays_check`.

The exact original source CHECKs were taken from the retained raw export,
including BETWEEN. Each was created on matching typed fixture columns; its
PostgreSQL-deparsed definition matched the retained original catalog definition.
The corresponding retained restored CHECK text was parsed separately on matching
columns in a second disposable database.

PostgreSQL lowers BETWEEN to >= and <= joined by AND. Its deparser/parser
round-trip changes left-nested AND grouping. The native `pg_constraint.conbin`
trees are **not byte-identical**; the old inventory's text discrepancy remains
true. Both original source strings, restored input strings, deparsed strings,
complete parsed trees and all outcomes are retained in `report.json`.

The separate, explicitly analytical comparison:

* Parses PostgreSQL node-tree structure, not a regex-rewritten SQL expression.
* Removes only `:location` source-position fields and flattens associative AND
  nesting for comparison; it preserves every other field and predicate order.
* Retains function/operator IDs, input/result type and collation fields,
  column references, constant types and values. Those typed leaves match.
* Verifies referenced functions/operators are immutable `pg_catalog` builtins.
* Confirms AND associativity with **all 27** TRUE/FALSE/NULL triples in native
  PostgreSQL. This is three-valued logic, not a two-valued shortcut.
* Has negative unit tests preserving differences in bounds, column references,
  operator IDs and OR versus AND, and rejects malformed/duplicate tree fields.

This comparison is an explained semantic analysis, **not** silent SQL/catalog
normalization, a rewrite of historical evidence or a generic equivalence waiver.

### Native behavior

**72** history inputs covered trimmed lengths below/at/above 3, 80 and 1000,
empty strings, ASCII space padding, NULL combinations, accented text and emoji
in explicit UTF8. Four typed predicate leaves remain the same: event length
>=3 and <=80, reason length >=3 and <=1000.

**15** weekday inputs covered NULL, empty array, one/all seven allowed uppercase
days, unknown/lowercase/empty/padded elements, duplicates, seven/eight entries,
NULL elements, mixed valid/invalid elements and multidimensional arrays.
The same predicates require cardinality 1–7 and containment in the same
seven-element text array. Both versions continue to allow qualifying duplicates
and multidimensional arrays; no new policy restriction was invented.

Every input was evaluated and inserted against both variants: **174 insertion
trials**, each checked against an independent expected truth value and SQLSTATE.
FALSE gives **23514**; TRUE or UNKNOWN satisfies the CHECK. NOT NULL enforcement
was then tested separately in both variants for both constraints (**23502**).
CHECK's acceptance of UNKNOWN is not permission to bypass the source columns'
NOT NULL restrictions.

**Conclusion:** these two expressions are semantically equivalent under the
tested PostgreSQL builtins/types/three-valued logic. The finite examples support
the structural argument; they are not the sole basis of it. The original
exact-text mismatch is not erased, and no existing application constraint was
queried or changed. This does not establish exact-resource backup recoverability.

## 4. Read-only provenance extension

Target remains
`eda974665826aa4d5affc07f24f658122ac81502a7190313f0edcd99d24206ba`.

Fresh local Git inspection covered all available refs and reflogs, including
locally present origin refs, plus **31** unreachable trees reported by successful
`git fsck --full --unreachable`. SQL-path entries from each unreachable tree were
included; they supplied no additional distinct SQL blob beyond the **207**
already reachable candidates. Raw Git blob bytes were hashed without decoding,
line-ending conversion, timestamp reconstruction or source guessing:
**zero unreadable SQL candidates, zero matching hashes**.

The associated current `0004_platform_operations.sql` still hashes to
`02d011d931579f8177b2a71794a39bea78f23214da41c3606a3375ab1e3505ca`.
This path association is not proof of the missing original SQL or execution.
No remote fetch, application connection, migration replay, journal/ledger access,
reconstruction or exception occurred.

Unclassified blobs with no known SQL path and unavailable executor/remote/archive
artifacts are not claimed searched. A matching artifact, if supplied later,
must be verified byte-for-byte and its executor/target evidence separately
reviewed. No result here makes the source known or waives the blocker.

## 5. Fresh platform metadata: what was and was not exposed

Only read-only deployment metadata/build listings and official documentation
were requested. No application endpoint, database client, SQL callback, live
authentication attempt, credential-reading tool or runtime-log sweep was used.

`getDeploymentInfo()` succeeded, reporting published/autoscale and a successful
current build. Its entire key set was:
`additionalUrls, deploymentType, hasSuccessfulBuild, isDeployed, primaryUrl,
success, visibility`. No database-resource binding or recovery-point fields.

`listDeploymentBuilds({limit:3})` succeeded. Build fields were
`id, provider, status, timeCreated, timeUpdated, user`; user values were not
emitted. Latest listed successful build:
`497eebd6-a7ed-4731-91da-963f25e8c2c4`,
created **2026-10-21 12:39:56.449 UTC**, updated **12:43:30.177 UTC**.
The listing alone does not prove that revision is serving, that a specific
database is bound to it, or that it emitted earlier authorization errors.

Current source passes the API pool to the communication worker. That code
observation is not attestation of the serving revision's source/configuration
or of any independently deployed worker.

Official documentation consulted:

* [Production databases](https://docs.replit.com/features/data-and-storage/development-and-production)
* [Connection details](https://docs.replit.com/features/data-and-storage/connection-details)
* [Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets)
* [Data recovery](https://docs.replit.com/features/data-and-storage/data-recovery)
* [Publishing monitoring](https://docs.replit.com/features/publishing/monitoring-a-deployment)
* [Database monitoring](https://docs.replit.com/features/data-and-storage/monitor-your-database)
* [Database troubleshooting](https://docs.replit.com/help/database)

Documentation identifies owner UI inspection paths; it is not project-specific
binding, backup or authentication evidence. The callbacks above did not expose
the missing evidence. This does not claim that no privileged owner/platform
surface could expose it.

## 6. Precise owner-operated verification still required

These are evidence requirements, **not instructions to execute changes now**.
Record only redacted attestations/IDs, timestamps and permitted fingerprints.
Never paste credentials, full connection strings or unredacted sensitive logs.

### A. Published API/worker → exact resource

1. In Publishing, identify the actually serving revision/build and its immutable
   source/build artifact; distinguish it from merely the latest successful build.
2. Privately inspect **Adjust settings → Production app secrets**, including any
   `DATABASE_URL` override, and the effective configuration of each worker/process.
   Do not edit/reset/reveal values. Prove which configuration snapshot belongs to
   that serving revision rather than using current workspace configuration.
3. In Database, select the intended environment and **Settings**. Match the
   effective endpoint/database to a provider/platform resource ID and writable
   primary/branch, not just a familiar database name or read replica.
4. Have the authorized owner compare routing privately using the already reviewed
   fingerprint algorithm (SHA-256 of JSON `[lowercase host, numeric port, database]`,
   first 24 hex characters). A fingerprint alone is not a resource ID, credential
   identity, successful connection or historical mapping.
5. Record revision, resource/branch ID, configuration snapshot reference, timestamp,
   API and worker association, and verifier. If the worker shares the API process,
   attest that specific deployed artifact's single-pool wiring; otherwise attest
   the worker's own resource/configuration separately.

If the UI cannot expose authoritative linkage, the resource/configuration owner
must obtain a platform/provider attestation linking those exact revision and
resource IDs. Do not infer it from deployment success, replica access or secret
existence. HOLD remains until this linkage is evidenced.

### B. Exact-resource backup and isolated restore

1. **After A**, inspect the identified resource's recovery inventory. For managed
   Production, official docs direct the owner to **Database → intended Production
   database → Settings → Scheduled backups → View all backups**. For an external
   resource use that provider's recovery inventory.
2. Record the actual resource/branch ID, recovery-point or backup ID, UTC timestamp,
   coverage/retention, encryption/access controls, availability and proposed
   RPO/RTO. A documented retention default is not an observed usable backup.
   A Development checkpoint does not prove Production recovery.
3. Obtain **separate explicit approval** for restoring that point into a new,
   isolated resource with protected business data. Never restore over an existing
   resource or auto-start the app, jobs, providers or notifications.
4. Acceptance must link source resource/point to destination resource and verify
   bounded row counts/hashes, schema/constraints/key ownership, functions/triggers,
   relevant sequences and financial/history/ledger consistency without exposing
   records or advancing sequences. Record and explain every discrepancy; do not
   normalize arbitrary differences or substitute synthetic data.
5. Record restore timings, failures, authorized verifier, cleanup/retention and
   the explicit acceptance decision. If the UI cannot supply backup identity,
   scope or restore lineage, request those facts from the resource owner/provider.

No real recovery inventory or restore acceptance was obtained in this task.

### C. Historical SQLSTATE 28000 cause

1. Identify the exact incident UTC window, process (API/worker), serving revision
   **at that time**, and resource/configuration mapping. A later successful build
   or currently working Development connection cannot explain a past rejection.
2. Obtain the matching privileged PostgreSQL/proxy authentication FATAL event
   from the resource owner/provider, including its primary reason and correlation
   ID. Retain sensitive detail privately; report only redacted evidence/category.
   SQL query monitoring alone cannot show a failure occurring before SQL/session
   establishment, and code/severity/length alone cannot supply the lost message.
3. Correlate role/login eligibility, expiration, database CONNECT authorization,
   endpoint/branch and applicable proxy/access/authentication rules with that
   event using authorized metadata. Do not reset credentials, alter grants/access
   rules, trigger jobs or make payment/message calls to test a theory.
4. If authenticated-owner surfaces do not expose the authentication event, obtain
   the platform/provider's event-specific reason. Otherwise record **UNSPECIFIED**
   and keep HOLD, not “bad password,” “worker-only URL,” or “recovered” by guess.

The existing sanitizer can recognize fixed password/role/access-rule categories
from an available Error.message without logging that message. Five added mocked
tests confirm non-enumerable messages can be classified safely and historical
enumerable-only 28000 evidence stays UNSPECIFIED. These tests neither recover a
missing historical message nor prove that updated diagnostics are deployed.
No production logging/configuration change was made.

### D. Redacted collection record and acceptance boundaries

Prepare one evidence record per process/revision, resource/recovery point, and
incident. Populate unavailable fields with **UNAVAILABLE — HOLD**, not an
inferred value. A blank template is not evidence:

| Record | Required non-secret fields | What must not be substituted |
|---|---|---|
| Serving binding | Collection UTC time; verifier role; actually serving revision/build and immutable artifact reference; API/worker process identity; effective configuration snapshot reference; resource and branch/primary IDs; privately compared routing fingerprint; authoritative UI/provider attestation reference | Latest successful build, workspace settings, matching database name, replica visibility, secret presence, or source-only shared-pool wiring |
| Recovery inventory | Bound source resource/branch; observed backup/recovery-point ID and UTC point; scope and retention; availability/access attestation; proposed RPO/RTO; inventory evidence reference | Documentation defaults, Development checkpoint, synthetic dump, or “backups enabled” |
| Restore acceptance | Separate approval reference and scope; source point → isolated destination resource lineage; no automatic app/job/provider startup; bounded pre/post schema/data/financial-history consistency results; every discrepancy; timings; reviewer decision; cleanup/retention | Successful restore command alone, two semantically equivalent CHECKs, silently normalized catalog text, or an unreviewed production overwrite |
| Historical authentication | Incident UTC window and clock uncertainty; process and serving-at-incident revision; resource/configuration association; PostgreSQL/proxy FATAL correlation reference; privileged primary reason; redacted category and verifier decision | SQLSTATE 28000 alone, enumerable error keys, query monitoring, present-day successful authentication, or a speculative password/role explanation |

The official documentation was rechecked in this workflow-correction pass.
It describes query monitoring, application logs and Scheduled backups, but the
consulted pages do **not** document revision/worker-specific resource linkage,
backup-ID/restore-lineage attestation or historical database/proxy authentication
FATAL retrieval. This is a documentation limit, not proof that no owner/provider
surface exists. If owner-visible records are insufficient, request these exact
associations from the authorized platform/resource owner; do not run speculative
connections or change settings to fill the blanks.

Collecting recovery metadata does not approve a restore. Mapping the current
revision does not explain an older incident. An exception for `eda97466…` must
identify the full unresolved hash, search limits, independently reviewed
catalog/preservation risk and exact Development-only scope; record its separate
review/approval reference. No exception is recorded here, and an exception would
not establish original bytes or authorize ledger edits, DDL or LIVE activation.

## 7. Decision

The late-key explanation and these two CHECKs' semantic equivalence are now
supported by fresh isolated evidence. Raw SQL/text discrepancies remain retained.
Missing original `eda97466…` source, authoritative runtime resource binding,
exact-resource recovery acceptance and historical authorization cause remain
unevidenced. Provider/merchant/settlement and genuine runtime acceptance gates
from the main package also remain open. **HOLD** continues; every later connection,
restore, migration, transaction, worker or LIVE release needs its own applicable
evidence and separate approval.

## 8. Export workflow correction and regression — HOLD retained

Completed **2026-10-23 06:50:35.999–06:50:44.230 UTC**. This changes offline
export tooling only, not schema declarations, historical SQL, constraints,
pinned migrations, database ledgers, runtime services or configuration.

### Corrected boundary, unchanged vendor evidence

The existing object DAG already supported the required unique-index → FK edge.
The two callers previously captured standalone Drizzle output independently.
They now share `schema-export/source.mjs`: capture vendor stdout in a
credential-free subprocess, inspect the schema-only model, require the existing
dependency-aware permutation, check that no table/key/index follows an FK, and
reject concurrent schema-source changes before returning workflow output.
Neither caller can select vendor stdout as its `.sql` payload.

`export:schema:audit` now also retains exact vendor bytes in `.raw.sql`, explicitly
marked non-executable in metadata. The representative-target exporter retains
its existing `.raw.sql` evidence. Both preserve all 1,249 statement bytes and
duplicates; the audit file adds only its fixed two-line warning header.
Both ordered payload hashes remain
`74732d873d8891c0e7dd3bd1b330d7ddaac0010cb2935fcb33c131dcf6522873`;
raw bytes still hash to
`a9f092605b523d61ae1981daa4a39b22a62f79929f8bff6f767003546ff3f8c0`.
The statement-multiset and source fingerprints remain those recorded in main
package §8. Existing ownership/provenance guards remain intact; raw evidence
and metadata sidecars now also reject symlink destinations.

This is a fix to the repository's export workflow, **not** to the upstream
Drizzle emitter or managed Publish generator. Direct vendor output remains
incorrectly ordered; retained raw failures are not retroactively marked passed.
No generated output is an approved application-target upgrade.

### Regression results and reproduction

From the workspace root:

```sh
NODE_BIN="$(env -i PATH="$PATH" node -p process.execPath)"
env -i PATH="$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8 "$NODE_BIN" --test \
  scripts/src/schema-export/*.test.mjs \
  scripts/src/flutterwave-rehearsal/pg-check-tree.test.mjs \
  scripts/src/flutterwave-live-review.test.mjs \
  scripts/src/flutterwave-live-isolated-rehearsal.test.mjs
env -i PATH="$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8 "$NODE_BIN" \
  --import ./scripts/node_modules/tsx/dist/loader.mjs \
  scripts/src/schema-export-ordering.native.test.mjs
pnpm --filter @workspace/scripts run typecheck
pnpm exec tsc -p lib/db/tsconfig.json --noEmit
```

* **46 offline tests passed**, including three new workflow tests for the original
  five-column late-index shape, exact CHECK/statement preservation, failure on
  absent support/unsupported DDL, and sidecar symlink refusal. Existing parser,
  ownership, ordering, reviewer and isolation tests passed. Expected negative
  bundle tests print forbidden-import errors while passing.
* **One native regression test passed, with 16 named checks**, using Node
  **24.22.1** and PostgreSQL **16.10**, fresh UTF8 initialization, no TCP listener,
  explicit role/socket/database and proven child PID/data/system identity.
  Fresh vendor bytes exactly match the original retained raw hash. Raw execution
  again gives **42830** and rolls back to an empty catalog. Both actual corrected
  entry-point outputs install **187 tables / 693 validated FKs**, all indexes
  valid/ready, and bind the original staff NFC FK to the same original unique
  index. Positions remain raw **1103 after 556**, corrected **315 before 1098**.
* The entire original CREATE TABLE statement for each of the two transport CHECKs
  is identical before/after ordering. §3's exact text/tree discrepancies and
  semantic-equivalence evidence remain unchanged; no restore or semantic-matrix
  rerun is claimed in this pass.
* Scripts and DB TypeScript checks passed. These project checks do not typecheck
  `.mjs`; JavaScript is covered by syntax checks and the executed regressions.
  No API/frontend runtime code changed; previous API/DOM test results are not
  counted as fresh.

Retained local evidence:
`generated-artifacts/flutterwave-readiness-followup/fw-export-order-GGsRRU/`.
`report.json` SHA-256:
`dabe6e241db2e5dc5d9422ed03f8f3e8f37fcfd3ccb49119fd2eb1f0a4932331`.
It includes command SQL/stdout/stderr, both workflow outputs/metadata, exact raw
bytes, original failure and catalog assertions. System identifier:
`7699752113642730787`; private root `/tmp/fw-export-order-GGsRRU`.
Cluster stop and deletion were confirmed. No application database was contacted;
no pinned migration or ledger was executed/read.

Retained harness failures are not hidden: the first `--test` + loader invocation
was refused by the strict environment gate before initialization. Direct
invocation preserves that gate. `fw-export-order-k1gtEv` then failed before
PostgreSQL initialization because its comparator counted the audit warning
comments as part of the first SQL statement; it records two checks, no database
commands, and temporary-directory deletion. The final comparator requires the
**exact known header plus byte-identical payload**, not SQL normalization.
An initial DB typecheck command combined composite mode with
`--incremental false` and was refused with TS6379; the supported `--noEmit`
invocation above passed without any compiler configuration change.

Original `eda974665826aa4d5affc07f24f658122ac81502a7190313f0edcd99d24206ba`
source remains **UNRESOLVED**; no new search or independently reviewed exception
is claimed. The current associated SQL still hashes to `02d011d9…` as recorded
in §4; none of its bytes changed. Serving-resource mapping, exact-resource
recovery acceptance, historical 28000 cause, and all merchant/provider/runtime
acceptance blockers remain open. No application connections/migrations, ledger
access/edit, secret/config changes, provider calls/transactions, worker
resumption, notifications, service restarts, Production changes, publishing or
LIVE activation occurred. **HOLD** remains mandatory.
