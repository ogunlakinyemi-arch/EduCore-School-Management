# Flutterwave LIVE readiness: Development approval package

Evidence date: **2026-10-23**. **NOT approved for application-database migration or LIVE activation.**

**Current decision: HOLD.** The follow-up in §9 explains the raw-export failure
and establishes semantic equivalence of the two CHECK expressions without
rewriting their SQL or erasing the exact-text discrepancy. External provenance,
resource binding, recovery and authorization-cause requirements remain open.

**Update:** The user separately authorized the disposable-only SQL rehearsal.
It is completed in §8, with recorded failures and limitations. This authorization
does not extend to any application database, ledger, service or external resource.

This package supersedes earlier conclusions that both historical migration hash
sources were unknown. It does not supersede retained history or authorize changes.

## 1. Completed safe work and verification

* Added `scripts/src/flutterwave-live-review.mjs`, a read-only, offline reviewer.
  It has no environment/credential access, database/HTTP imports, subprocesses or
  write path. It accepts no apply/approval/database options.
* Added `flutterwave-live-development-review.manifest.json` alongside this document.
  All four up and four down files are pinned by their full SHA-256. No draft SQL,
  historical migration, journal, ledger, worker setting or LIVE gate changed.
* The reviewer verifies exact hashes, stage/table dependencies, supporting-key
  ordering before composite FKs, namespace boundaries, retained-evidence rollback
  guards, and core fixed-amount/deduplication declarations. It inventories named
  objects and declaration counts. This is static review, not PostgreSQL parsing
  or successful DDL execution.
* New mocked HTTP tests cover configuration/authentication before persistence,
  invalid sizes, TEST-verifier rejection at the fixture boundary, ignored
  request-supplied release flags, uncertain receipt COMMIT/redelivery,
  unreleased finalization and reconciliation failure. Existing fictional-adapter
  tests cover the actual configured authentication/environment contract.
* New mocked lifecycle tests bind reconciliation to the authenticated receipt
  and exact original-byte digest, verify failed reconciliation COMMIT is not
  acknowledged/retried, and retain disabled transport/workflow gates.
* Owner HTTP fixture tests and DOM tests cover permission denial, read-only
  preview, Owner-to-Owner state clearing, and late responses from a previous
  Owner. This is **not** genuine Clerk sign-in or signed-in browser acceptance.

Prior offline-pass verification: **136 API tests (including 32 historical/current split-policy
tests), 12 Owner DOM tests and 8 offline-review tests passed; API and frontend
typechecks passed.** No application runtime code changed, so no
services were restarted. No native SQL migration/rehearsal was executed in that
earlier offline pass. The separately authorized native pass is recorded in §8.

Run the safe offline checks:

```sh
node scripts/src/flutterwave-live-review.mjs
node --test scripts/src/flutterwave-live-review.test.mjs
```

The output always retains false values for migration approval, application-target
compatibility, published binding, backup restoration and LIVE authorization.

## 2. Migration-ledger provenance

The prior investigation observed 24 Development ledger rows. Its existing values were not
rewritten. Both previously flagged full hashes remain recorded once.
The disposable-only rehearsal did not connect to or re-probe that ledger.

### Exact historical source recovered

Ledger hash:
`f198518b395d52dc374249d73780eb28acf1c4f404c1cdb70ec27663049671c9`

The actual SQL bytes at Git commit
`41e0595bc6dd64570f94b70952946c788a940bed`, path
`lib/db/drizzle/0001_phase3_meta.sql`, hash to that exact value. This was freshly
verified, not inferred from a timestamp. Current SQL hashes to
`0a329af11216e5f86f7569dad85008a115c497d4e827a2e2adfc5316f62b9244`.

The retained `phase11c-migration-hash-forensics.md` explains the historical
six-index reorder. The current pass establishes source identity, **not** which
bytes were executed, execution success, operator identity or target identity.
Do not replace the current SQL or replay the older SQL.

### Original SQL still unavailable

Ledger hash:
`eda974665826aa4d5affc07f24f658122ac81502a7190313f0edcd99d24206ba`

No exact source was found. The prior offline searches traversed available refs/reflogs,
checked 207 distinct historical SQL blobs with zero unreadable SQL objects, and
checked the history of the associated `0004_platform_operations.sql` path.
Current SQL hashes to
`02d011d931579f8177b2a71794a39bea78f23214da41c3606a3375ab1e3505ca`.
Timestamp association is not source identity.

Earlier retained forensic evidence also reports a broader 1,716-blob and
local-evidence search; that historical search was not silently claimed as a new
run. No ledger repair, fabricated SQL, timestamp reconstruction or historical
migration replay is proposed.

**Required external evidence:** recover the exact original SQL/artifact from the
original executor, a retained repository/archive or migration job evidence, and
verify its full SHA-256. If irrecoverable, an explicit, separately reviewed
Development-only provenance exception and catalog/preservation assessment is
needed before any apply approval. An exception documents uncertainty; it does
not make the original SQL known or authorize rewriting the ledger.

## 3. Database binding and worker diagnosis

The prior investigation's Development connection routing fingerprint was
`e309d02798c9fa41ee61a22c`. A fresh standalone connection using the existing
runtime-managed configuration matched the reviewed API startup fingerprint and
successfully completed a read-only probe. The same imported singleton pool
serves the API and communication worker. Prior independent platform and driver
server/database fingerprints also matched; this is not a permanent provider
resource-ID attestation.

The probe observed no LIVE relations. Previous catalog inspection found none
of the 14 tables, 60 critical columns, expected functions/constraints/triggers,
or proposed table/index/function name collisions. Those absent objects cannot
provide installed finalization/ledger guarantees.

Development workers remain paused using the existing supported control. No tick,
queue dispatch, message send or configuration change was used to test recovery.
The pool/guard tests exercise class-28 non-retry, transient pre-SQL reconnect,
non-replayed queries, failure-guard release and later-tick recovery with mocks.
This does not prove real-job/provider idempotency or successful worker dispatch.

A bounded last-day **deployment** log sample returned 100 entries and contained
98 occurrences of `28000`. These are not deduplicated incidents or an exhaustive
period count. The returned messages expose no classifiable password/role cause.
`28000` establishes authorization rejection, not its specific credential, role,
endpoint, access-rule or provisioning cause.

**Conclusion:** current Development database authentication succeeds. No current
Development authentication defect or independent worker credential is proven.
Do not change credentials, add authorization retries, unpause queues or infer
Production recovery from this. The affected deployment's underlying rejection
requires its configuration/resource owner, outside this work's change authority.

### Exact external/platform binding step

Current deployment metadata confirms a published successful build but exposes
no database-resource binding fields. A platform Production replica observation
is not proof of the application's actual writable primary, provider resource,
deployed source revision or worker connection.

An authorized platform operator must:

1. Obtain the serving revision's authoritative database resource/environment
   mapping, including whether `DATABASE_URL` has a runtime override and whether
   the deployed worker uses the same pool. Do not share secret values.
2. Compare routing privately using the same fingerprint algorithm:
   SHA-256 of JSON `[lowercase host, numeric port, database]`, first 24 hex
   characters. A routing digest alone is not a provider resource ID.
3. Record the non-secret database-resource ID, mapping attestation and revision
   evidence. If the UI does not expose this mapping, request authoritative
   deployment-to-database mapping from Replit's platform/support team rather
   than using the database name, a replica address or a familiar provider label.
4. Use Database → intended environment → Settings to inspect connection/recovery
   details privately. Never paste connection strings, passwords or screenshots
   containing them into chat. Do not regenerate credentials.

Documentation consulted: [Connection details](https://docs.replit.com/features/data-and-storage/connection-details)
and [Data recovery](https://docs.replit.com/features/data-and-storage/data-recovery).
Neither documentation nor secret existence proves this project's runtime binding.

## 4. Exact draft scope and inventory

Order is inbox → finalization → workflow → readiness. Each up/down is
transaction-bounded. The complete eight digests are in the manifest.

| Stage | Tables | Explicit indexes | Functions | Triggers | CHECK declarations | FK declarations |
|---|---:|---:|---:|---:|---:|---:|
| inbox | 1 | 0 | 0 | 0 | 8 | 0 |
| finalization | 5 | 0 | 3 | 5 | 38 | 7 |
| workflow | 7 | 1 | 2 | 8 | 19 | 7 |
| readiness | 1 | 8 | 0 | 1 | 14 | 5 |

These source counts exclude implicit constraint-owned indexes. The earlier
representative-target report observed 40 total LIVE indexes; that is retained
historical execution evidence, not a current application-target observation.
The separate fresh disposable observation in §8 also found 40.
The CLI emits all named table/index/function/trigger/constraint inventories.

Required guarantees for a future native rehearsal and installed-catalog review:

* Correct LIVE-only namespaces; no shared historical table DDL/backfill.
* Fixed NGN 5,000 gross, NGN 1,900 school and NGN 3,100 merchant gross.
  Eligible NGN 100 is internal Partner accrued liability only.
* Exactly one school checkout `flat_subaccount`, no ratio and no Partner
  checkout recipient. These are application-contract assertions as well as
  source SQL checks; existing split-policy/authority tests remain necessary.
* Receipt byte-fingerprint deduplication; semantic-event and intent/kind
  uniqueness; independent verified identity and authenticated-source linkage.
* Correct tenant/authority tuple binding and key ownership before dependent FKs.
* Immutable identity/evidence/official receipts/audit history; monotonic holds;
  no approval/export operation treated as transfer or Paid evidence.
* Uncertain COMMIT never implies rollback, provider success or acknowledgement.
  Recovery uses the same immutable receipt/reference, not a new transaction.

## 5. Backup, recovery, locking and preservation — prerequisites, not completed facts

**Backup/restore coverage is UNVERIFIED.** No real backup, restore or clone of
business data was created. No recovery-point inventory for the exact resource
was exposed. Do not substitute assumed retention or an enabled backup setting.

Before application-target approval, require a resource-bound recovery-point ID
and timestamp, retention/coverage confirmation, secure storage/access review,
and an authorized isolated restore acceptance record. For managed resources,
inspect Scheduled backups in the intended database's Settings. If resource
identity or usable recovery points cannot be attested, stop.

The disposable-only approval was carried out with a credential-free fresh
cluster, an offline source-model schema and synthetic SCV2/SCV3/history sentinels,
not an inherited application URL or copied records. See §8 for the precise
baseline, commands and limitations. This is not an application backup/restore.
Earlier native fixture tests listed in `flutterwave-live-migration-review.md`
were not silently counted as freshly rerun.

For a separately approved target apply:

* Reconfirm routing, resource, ledger and catalog immediately beforehand.
* Agree a maintenance/write-control window; preserve existing worker pause.
  Coordinate concurrent Admin edits rather than silently overriding them.
* Capture bounded pre/post canonical schema, key/index ownership and ledger
  fingerprints. Preserve financial-record counts/hashes by bounded primary-key
  ranges without returning record values. Account explicitly for approved
  concurrent/scheduler changes; do not silently exclude fields.
* Proposed initial per-stage session-local limits: `lock_timeout = '2s'`,
  `statement_timeout = '60s'`. These are **unapproved starting limits**, to be
  accepted or adjusted from isolated rehearsal timings—not guarantees of safe
  execution. An abort requires inspection, not automatic retry or limit removal.
* Each existing file owns BEGIN/COMMIT. Do not concatenate files inside another
  transaction or naively split function bodies on semicolons. Keep a dedicated
  client/session for any approved execution and verification.
* New/validated FK, CHECK, uniqueness, generated expression, default, function,
  trigger and index definitions must match the pinned SQL—not just object names.
  Read table sizes and lock waits before an approved window; this pass does not
  certify a future lock window from absent current LIVE tables.

Rollback order is readiness → workflow → finalization → inbox. Every down draft
refuses retained evidence; no CASCADE/history deletion is permitted. If any
stage committed and evidence exists, stop for recovery review, not destructive
down/reapply. Post-failure schema/ledger verification is mandatory.

## 6. Evidence limits and unresolved requirements

| Requirement | Current status / exact remaining input |
|---|---|
| Historical SQL provenance | `eda97466…` still unresolved after the §9 fresh 207-blob/31-unreachable-tree search; no ledger change or exception granted. |
| Published API/worker resource binding | Unverified; authoritative serving-revision/resource mapping required from platform operator. |
| Worker authorization cause | Development probe succeeds; deployment `28000` subcause unknown. Configuration-owner evidence needed; no queue resumption justified. |
| Development target schema | LIVE namespace absent; no migration approved or applied. |
| Backup/restore | Exact-resource recoverability and authorized restore acceptance unverified. §9 documents equivalent synthetic CHECK semantics, not business-data recovery acceptance. |
| Native rehearsal | §8: 96 checks and 13 tooling/reviewer tests. §9: 26 new named native checks explain late-key raw failure and equivalent CHECK semantics; exact-text mismatch retained. No application-target approval follows. |
| Merchant fee bearer / LIVE account identity | Real, reviewed, redacted dashboard/account ownership and merchant/school/subaccount association evidence required. Mocks cannot supply it. |
| Independent recipient verification | Reviewed actual reader contract plus transaction-bound school payout evidence required. No endpoint invented or provider contacted. |
| Webhook/durable financial acceptance | Mocked ordering/failure contracts pass; real versioned authentication, HTTPS delivery, durable finalization, adversarial replay/concurrency and recovery still require approved acceptance. |
| Owner acceptance | Fixture-authenticated HTTP and DOM pass; genuine signed-in browser acceptance not established. |
| Settlement/costs | Bank reconciliation, actual fee/settlement evidence and any controlled transaction need their own explicit approval. |
| Production migration | Not proposed for execution. Managed-resource Publish diff must itself be reviewed, including functions/triggers; never assume drafts are reproduced. External-resource handling first requires authoritative binding. |
| LIVE activation | All existing gates remain disabled; distinct release approval still required. |

## 7. Next explicit approval

For application-target approval, first provide the missing
provenance/binding/recovery evidence or explicitly review the documented
Development-only provenance exception.

The **isolated, credential-free native rehearsal of the eight pinned SQL files**
has now been separately approved and performed (§8). Its approval excluded
application databases, Production, real personal/financial data, notifications,
provider calls and LIVE activation. The external prerequisites remain unresolved.

Only after that rehearsal and the unresolved prerequisites are accepted should
a separate approval name the exact **Development** target and four up hashes
for application DDL. No broad “go ahead” is treated as Production, transaction,
queue-resumption, key-toggle or LIVE release authorization.

## 8. Approved disposable-only native rehearsal — completed

### Scope, reproduction and retained evidence

Executed **2026-10-23 00:34:21.862–00:35:15.884 UTC**, PostgreSQL/psql/initdb/
pg_dump/pg_restore **16.10**, Node **24.13.0**. The final native run passed
**96 assertions**; the offline assessment is
**`SQL_CHECKS_PASS_WITH_RESTORE_CATALOG_DIFFERENCES`**, not unrestricted recovery
acceptance. Separately, **13 reviewer/tooling tests passed** (8 existing reviewer
tests and 5 new isolation tests). The earlier API/DOM suites were not rerun or
counted as new evidence.

From the workspace root, the exact reproducible entry points are:

```sh
# Discover the actual executable without inherited configuration. The Nix wrapper
# adds PWD/SHLVL; the unwrapped executable preserves the strict environment gate.
NODE_BIN="$(env -i PATH="$PATH" node -p process.execPath)"
env -i PATH="$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8 "$NODE_BIN" \
  scripts/src/flutterwave-live-isolated-rehearsal.mjs
env -i PATH="$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8 "$NODE_BIN" --test \
  scripts/src/flutterwave-live-isolated-rehearsal.test.mjs \
  scripts/src/flutterwave-live-review.test.mjs
# Offline assessment only; substitute the evidence directory printed by the run.
env -i PATH="$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8 "$NODE_BIN" \
  scripts/src/flutterwave-rehearsal/assess.mjs \
  generated-artifacts/flutterwave-live-rehearsal/edupulse-fw-pinned-cqd4Ug
```

The actual native invocation used
`/nix/store/9cyx2v23dip6p9q98384k9v06c96qskb-nodejs-24.13.0/bin/node`
as that unwrapped executable. The runner accepts **no target/URL/apply/approval
arguments**, rejects inherited configuration outside PATH/HOME/LANG/LC_ALL,
creates a new owner-only temporary directory, and uses a fresh `initdb` with
explicit role `isolated_rehearsal`. Empty private client configuration/home and
explicit `psql -X` socket/database/role arguments prevent ambient client fallback.

Target proof checked the fresh child postmaster PID, data directory, start time,
system identifier and socket directory; `inet_server_addr()` was NULL and
`listen_addresses` empty. The socket/data root was
`/tmp/edupulse-fw-pinned-cqd4Ug`; system identifier was
`7699655156661281526`. This is **not** an application resource identity.
Every disposable cluster from this work was stopped and deleted.

Evidence root:
`generated-artifacts/flutterwave-live-rehearsal/edupulse-fw-pinned-cqd4Ug/`.
It contains 116 numbered command records with arguments, stdin hashes and
retained stdin/stdout/stderr, native `postgres.log`, sampled `locks.log`, full
object inventories, schema-export inputs/metadata, policy bundle/input metadata,
and the synthetic-only dump. Generated evidence is excluded from Git/deployment
by `.gitignore` and `.replitignore`; it is local retained evidence, not a managed
backup or a promise that a fresh checkout contains the dump.

* `report.json` SHA-256:
  `cac42821e6af47cabdf5d7a1ac0b664b15b8efe2cd4a5587abf3bc4698a5f096`.
  Its literal `PASS` reports its 96 assertions; exact catalog restore is separately
  recorded **false**, not silently promoted to a passing assertion.
* `assessment.json` SHA-256:
  `388e6c09ddd2d45f293683f4f028bf02fec2d006830075178c76e47d6672a347`.
  This offline comparison records the two unnormalized differences below.
* Tool versions and executed tooling source hashes are in `report.json`.

### Exact pins, dependencies and baseline

Independent original-byte SHA-256 checks passed before initialization,
immediately before each draft execution, and again at completion. The manifest
and all eight draft files remained unchanged:

| Stage | Up SHA-256 | Down SHA-256 |
|---|---|---|
| webhook-inbox | `ab644e6a38bdd1d9d4ef63f52cd971a05153e777b65d730567dac1ed231f874d` | `fd3475aa057a05f8c6dd7bace8e8ae8a47e64366240839be2631ab94cf9f3d39` |
| finalization | `62f70bc39f92852fd8219b0da063fc2299f3530fd8a4356fe197049f40eb4b1a` | `0914fc1b11c8fbce2f8cadfd11e7da23788b34537919c14c7f28f3a3b5843cc5` |
| workflow | `a7e83947d2338d762a1830814d68f2be470e19866c46be84a8bccfad08d3c67a` | `047805b8591ded4276595721c2d7a3f71f267d77e0a43d37b07523a263f3f4b7` |
| readiness | `88e4bfa3eae084e6072b33d77125f9dc17bc74d5445fea1b28458522d9991a8c` | `98b933998cc2e12e531267e72a8f70023ae7f8b2d1744cc7ef4ad101a006495f` |

Execution respected inbox → finalization → workflow → readiness, including
supporting uniqueness before dependent composite FKs. Downs ran in reverse.
Each original file retained its own BEGIN/COMMIT; the runner added only
session-local timeout/application-name setup, not an outer transaction or
semicolon splitting.

The populated baseline came from the existing offline
`scripts/src/live-readiness-target-schema.mjs`, with its exporter and guards
unchanged. Fresh source-model output contained **187 tables, 693 FKs and 1,249
statements**, not the older report's 184/690/1,241. This is a fresh representative
source model, **not** evidence that an existing application target matches it.
Current key-ownership checks passed; retained historical `unique_index` versus
current `unique_constraint` metadata was not rewritten or treated as provenance.

* Source fingerprint:
  `a4f433f63c7e495330ccf119982ac4f9c9b938394ed10cef4fd7a159fd721961`.
* Unchanged raw export:
  `a9f092605b523d61ae1981daa4a39b22a62f79929f8bff6f767003546ff3f8c0`.
* Dependency-ordered output:
  `74732d873d8891c0e7dd3bd1b330d7ddaac0010cb2935fcb33c131dcf6522873`.
* Duplicate-aware statement multiset:
  `be99ab8b63e168c8333260b842ae814427a538ac51d5576ff67578b2eecd26a2`.

**Raw-export failure remains separate:** executing the unchanged raw export in
its own disposable database/transaction failed with **42830**, no qualifying
unique key for referenced `staff_nfc_subscriptions`. Post-failure inventory matched
the original empty catalog. No key was fabricated or guard weakened. Successful
use of the dependency-ordered baseline does not make the raw export executable
or prove an upgrade from an application's existing schema.

### Native outcomes, inventory, locking and preservation

The installed LIVE inventory contained **14 tables, 122 columns, 40 indexes,
5 functions, 14 non-internal triggers and 7 sequences**. Its **129 constraints**
comprised 79 CHECK, 14 primary-key, 17 unique and 19 foreign-key constraints;
all were validated and all indexes valid/ready. Full names, definitions,
defaults/generated expressions, trigger state, supporting-index associations
and constraint/index ownership are retained in the inventories.

| Scenario | Observed result |
|---|---|
| Empty forward / reverse / reapply | All eight original files executed successfully in order; reverse returned to the original empty catalog; reapply reproduced the exact tracked LIVE definitions. |
| Wrong up / down dependency order | 42P01 / 2BP01 respectively; no partial catalog change. |
| Duplicate up execution | Each one-shot draft refused with 42P07; tracked LIVE inventory unchanged. These migrations are **not** advertised as repeatable/idempotent DDL. |
| Deliberate relation contention | Readiness refused with 55P03 after 2,010.03 ms under unchanged 2s lock/60s statement limits. After the bounded holder explicitly rolled back and exited, catalog and holder disappearance were inspected before executing the same pinned stage. |
| Populated earlier-draft upgrade | Existing inbox evidence and two fictional earlier-design intents survived workflow/readiness; added authority fields remained NULL and state PENDING, not silently activated. |
| Fixed-money/environment/identity guards | Wrong gross/school/merchant amounts, TEST environment, nonexact/ineligible Partner liability and SCV2-as-SCV3 intent rejected with 23514; cross-school authority rejected with 23503. |
| Supported receipt redelivery | ON CONFLICT retained one immutable receipt ID and increased delivery count to two; semantic and intent/kind duplicates rejected with 23505. This is local persistence evidence, not a lost provider-response or concurrent runtime acceptance test. |
| History / hold retention | Deletion of sampled evidence, receipt and operator history refused with P0001; intent/payable holds could not be released; held payable made the fictional export batch REVIEW_REQUIRED, never Paid. |
| Every down with retained evidence | All four refused with P0001; complete tracked catalog and every public-table row fingerprint remained unchanged. No evidence deletion, CASCADE or destructive recovery attempted. |
| Incompatible populated readiness | Retained expired synthetic authority caused 23514 atomically; original data/catalog unchanged. No repair, expiry change or exemption was applied. |

Ordinary stage wall times in milliseconds, including psql process/session cost:

| Stage | Empty up | Populated up | Empty down |
|---|---:|---:|---:|
| inbox | 42.07 | 24.84 | 14.95 |
| finalization | 84.01 | 83.40 | 25.56 |
| workflow | 80.28 | 74.86 | 21.52 |
| readiness, after contention cleared | 60.66 | 71.88 | 19.47 |

Lock sampling every 50ms retained **853 samples**, maximum 943 granted and one
waiting lock across the sampled rehearsal sessions. Fast locks can be missed;
native statement-duration/lock-wait logs are retained separately. These tiny
synthetic data volumes do **not** establish a safe application maintenance window,
production timing or production lock footprint.

The source-model baseline plus a clearly fictional historical-policy sentinel
covered **188 non-LIVE tables**. Tracked shared definitions and every field of
every shared-table row fingerprint stayed unchanged. Fictional canonical
user/school/student/subscription rows included an SCV2 reference; the explicit
history sentinel retained gross 500000, school 190000, Partner 10000 minor units,
non-deferred SCV2 policy and its original receipt marker. This does not attest to
the preservation or representativeness of actual historical financial records.

### SCV3 allocation and synthetic restore — precise limits

Actual current allocation/authority helper source ran in an isolated bundle:
**NGN 5,000 gross**, exactly one school **`flat_subaccount` of NGN 1,900**,
no ratio, no Partner checkout recipient, and **NGN 100 internal eligible Partner
liability**. Noneligible liability was zero. The SQL generated fee arithmetic was
also exercised with fictional fees. Passing a Partner ID to the SCV3 checkout
helper still produced only the school recipient; SCV2 retained its old
non-deferred two-recipient contract. Extra ratio/Partner/amount authority inputs
were refused.

Only the imported `AuthError` exception class was substituted, to avoid pulling
application authentication/database bootstrap into policy-only execution.
Allocation/verification source was not substituted. Bundle guards reject DB and
network-client imports, with positive and negative tooling tests. This is **not**
application authorization, merchant verification, eligibility onboarding,
provider dashboard configuration, payment execution or actual split evidence.

Synthetic pg_dump/pg_restore succeeded into another fresh database, preserving
all public-table row fingerprints and every tracked LIVE definition. Dump
SHA-256: `61b7c96c0e5effc23060c25c1581952f168bce2dafdf3be4e0d9b90d0c7c1551`.
**Exact full catalog text did not match:** only the definitions of
`transport_history_event_reason_check` and `transport_routes_weekdays_check`
differed, with nested AND parenthesization rendered flatter after restore.
`assessment.json` retains both complete before/after definitions. No broad
normalization or semantic-equivalence waiver was applied. This remains an
exact-text restore limitation, separate from unchanged LIVE definitions and
matching row fingerprints; it is not real application backup acceptance.

### Retained failed attempts and unchanged release boundary

Earlier attempts are retained, not silently discarded:

* Initial wrapped-Node launch rejected unexpected PWD/SHLVL before creating a
  cluster or executing SQL. The strict gate was preserved; the actual executable
  was used instead.
* `edupulse-fw-pinned-9Ukz9g`: catalog deparsing itself waited on the deliberate
  fixture lock before the migration contention check.
* `edupulse-fw-pinned-8EOX60`: expected migration 55P03 was observed, but killing
  psql left its sleeping backend holding the lock during post-inspection.
  The fixture now completes its bounded explicit rollback; migration limits
  and SQL guards were not relaxed.
* `edupulse-fw-pinned-df09B8`: duplicate readiness correctly refused with 42P07,
  while the new harness had incorrectly expected 42710. Only the expected
  SQLSTATE was corrected; the draft was unchanged.

Those three native attempts have separate `report.json`/logs under the same
generated-evidence parent, each recording cluster stop/deletion. The final pass
did not change any application DB, migration ledger, credentials, services,
worker pause, notifications, providers, Production, publishing or LIVE gates.

**Unresolved and unwaived:** original
`eda974665826aa4d5affc07f24f658122ac81502a7190313f0edcd99d24206ba`
SQL provenance; authoritative serving API/worker resource binding; real
resource-bound recovery acceptance; actual merchant/fee-bearer/recipient and
settlement evidence; genuine signed-in acceptance and controlled runtime
financial/replay/concurrency acceptance. Raw-export and restore-text limitations
above are additional recorded evidence, not substitutions for those inputs.
No application migration or LIVE activation is authorized by this rehearsal.

## 9. Readiness-only follow-up — HOLD retained

See [follow-up evidence and owner verification checklist](flutterwave-development-followup-evidence.md)
for complete scope, reproduction, evidence hashes and operator steps.

* **Raw-export cause reproduced:** unchanged raw statement 556 declares
  `staff_nfc_allocations_subscription_owner_term_fk` before its existing
  five-column unique index at statement 1103. PostgreSQL correctly returns 42830.
  The same original FK binds that same original index when it precedes the FK
  (ordered positions 315 → 1098). Complete raw/ordered statement multisets are
  identical; no key, constraint, SQL source or ownership guard was rewritten.
* **CHECK meaning established:** PostgreSQL 16.10 typed trees retain identical
  operators, function/type/collation/column references and constants, differing
  in source positions and associative AND grouping. All 87 distinct input cases
  produced expected TRUE/FALSE/UNKNOWN and enforcement results in both forms:
  174 insertion trials, plus separate NOT NULL checks and all 27 three-valued AND
  triples. The exact SQL/native-tree text discrepancy remains retained. This
  establishes semantic equivalence of these two builtin expressions, **not**
  exact catalog-text equality, a general normalization exemption or real restore
  approval.
* **Provenance remains unknown:** a new raw-byte scan covered 207 distinct
  SQL-path blobs from local refs/reflogs and 31 unreachable trees. Zero unreadable
  candidates and no `eda97466…` match. No remote fetch, reconstruction, ledger
  access or provenance waiver occurred.
* **Platform evidence remains insufficient:** fresh read-only deployment
  metadata/build listings expose status/build IDs, not authoritative API/worker
  database bindings, exact-resource recovery points or server authentication
  rejection reasons. Official documentation identifies owner UI inspection
  paths; the linked checklist specifies what must be attested and what requires
  a separate approval. No application database or published application endpoint
  was contacted to fill those gaps.
* **Fresh verification:** 26 named isolated checks, 5 parser/matrix unit tests
  and 30 mocked database-resilience tests passed. The latter include
  non-enumerable error-message handling and refusing to guess a 28000 subcause
  from code/severity alone. They are not evidence of external authentication.

No application migration, ledger edit, secret change, provider call, worker
resumption, notification, service restart, Production change, publishing or
LIVE activation was performed. **HOLD remains in force** pending evidence and
distinct explicit approvals; neither semantic equivalence nor an operator
checklist supplies those approvals.
