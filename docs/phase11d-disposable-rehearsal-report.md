# Phase 11D — Disposable Migration-Reconciliation Rehearsal

**29 September 2026 · Yemait EduCore**  
**Final status: REHEARSAL INCONCLUSIVE — MORE EVIDENCE REQUIRED.** The fail-closed preflight correctly refused to treat a schema-only clone and synthetic data as proof for all 26 candidate ledger entries. No adoption transaction was run on the current-schema clone. The [controlled plan](phase11d-controlled-reconciliation-plan.md) describes the missing gates and future-only sequence.

## 1. Read-only baseline capture

Shell read-only SQL and a separate platform **development** query independently identified `heliumdb`, user `postgres`, 91 public tables and five migration rows. Ordered `id|hash|created_at` newline-joined ledger digest: MD5 `bb9579f8bcffb9c54d92b432aa215ff1`. The read-only schema-only dump contains 91 tables, 1,127 columns, 338 indexes, 613 constraints, three functions, six non-internal triggers and zero public views; it includes types/defaults, indexes/predicates, unique/composite and ordinary FKs, validation flags, functions and triggers. Current development has zero fee receipts, zero missing referenced device-school binding pairs and one `NOT VALID` constraint. No development application data was dumped.

| Development ledger ID | Journal migration | Recorded SQL hash | `created_at` (journal milliseconds) |
| --- | --- | --- | ---: |
| 1 | `0000` | `fc460c22d41c952c0578c17cbba1cfe8dc838a0896c322fa03eae41066072ddd` | 1790124624275 |
| 2 | `0001` | `f198518b395d52dc374249d73780eb28acf1c4f404c1cdb70ec27663049671c9` | 1790129202026 |
| 3 | `0002` | `8a3a486f871f991ab59ac982ae6be92934a8f6d4b861c8222be43eea5878c736` | 1790145697311 |
| 4 | `0003` | `9223f5d27a334bd967dfe37dcff518b3800eff1a68523f81defc8ca52ae7c575` | 1790157200000 |
| 5 | `0004` | `eda974665826aa4d5affc07f24f658122ac81502a7190313f0edcd99d24206ba` | 1790161200000 |

Private **temporary** external files: `/tmp/phase11d.S7ZGXn92/development-schema.dump` (schema-only SHA-256 `931d3f0ba2f525d3c84416db49cfc80b967436c9599fa5c56c6752edf50865e0`) and `development-ledger.csv` (five rows SHA-256 `19f5defdebdeaad2a5bdae352fe1b70f5eb3ab524f7b582320bf6c46db4f17b9`). These are not a durable operational backup; a future approved action must capture again. The two hashes on IDs 2/5 differ from current checked-in migration files; the old `0001` blob is known and the matching `0004` SQL is not.

## 2. Disposable construction and known failure

Initialized local PostgreSQL 16.10 with private data/socket directories under `/tmp/phase11d.S7ZGXn92/`, Unix socket only, port `15449`, role `runner`; server identity was checked with `current_database()`, `current_user`, `current_setting('port')` and `inet_server_addr() IS NULL`. Ambient `DATABASE_URL` was excluded from all local SQL/runner commands, which explicitly used the fixed local socket. Restored the **fresh schema-only** archive into `phase11d_baseline`, imported all five ledger rows verbatim and set its ledger sequence to 5; this gave 91 public tables and the same five-row digest. Cloned it into `phase11d_failing` and `phase11d_current`. A separate empty `phase11d_clean` replayed all 31 checked-in migrations (91 tables, 623 constraints, 31 ledger rows). The adapted two-school fixture used only synthetic `.invalid` identities and unpaid invoices; it contains no real development rows, provider payment, webhook, delivery or outbox work. The fixture's existing database/role/socket/port guards were adjusted **in a temporary copy** for the Phase 11D local target; the checked-in fixture was not changed.

Normal `drizzle-kit migrate` against **`phase11d_failing` only** exited nonzero. The installed Drizzle CLI displayed `undefined` instead of the nested PostgreSQL message; running the same installed Drizzle ORM migrator against the same isolated clone exposed its cause: **`relation "school_classes_id_school_tenant_key" already exists`** while attempting `ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_id_school_tenant_key" ...` at migration `0005`. The existing clone constraint's catalog definition is `UNIQUE (id, school_id)`, validated, exactly as `0005` expects: **SCHEMA-EQUIVALENT**, not historically proved executed. The failing transaction left its ledger at five rows and the normalized schema dump unchanged (the dump utility generates different random `\restrict` tokens on successive invocations; those tokens were excluded before comparison). Nothing was dropped to make `0005` pass.

## 3. Classification and actual reconciliation result

The plan contains **one explicit row for every migration `0005`–`0030`**, its expected final state and unresolved condition. Summary: **22 `SCHEMA MATCHES`**, **three `SCHEMA PARTIALLY MATCHES`** (`0007`–`0009`), **one `CANNOT DETERMINE`** (`0006`), **zero `SCHEMA DOES NOT MATCH`** classes. These are catalog observations, not 22 approvals. Current observable data checks find no missing device-school pairs but cannot prove historical `0010`/`0011` backfill execution; zero receipts cannot prove `0014`'s populated receipt backfill. No candidate has an approved data/dependency/provenance decision; **all 26 remain HOLD**.

Fresh offline comparison of sorted public constraint and index definitions between the clean replay and current-schema clone yielded **14 clean-only legacy single-column academic FKs** versus **four clone-only validated tenant keys and their four indexes**. Counts: clean **334 indexes/623 constraints**; clone **338 indexes/613 constraints**. The four extra tenant keys are on attendance discrepancies, attendance events, NFC cards and student class assignments. These deltas, the `0006`–`0008` transient-dependency uncertainty and unverified real data effects are not erased by apparent final-schema matches.

| Migration | Current-clone result | Adoption |
| --- | --- | --- |
| `0005` | SCHEMA MATCHES — six validated named tenant keys; first key blocks replay | HOLD |
| `0006` | CANNOT DETERMINE — transient dependency drops leave no final proof | HOLD |
| `0007` | SCHEMA PARTIALLY MATCHES — composite FKs exist; binding provenance unresolved | HOLD |
| `0008` | SCHEMA PARTIALLY MATCHES — final references exist; intermediate dependency alignment unresolved | HOLD |
| `0009` | SCHEMA PARTIALLY MATCHES — attendance objects present; additional tenant keys | HOLD |
| `0010` | SCHEMA MATCHES — binding objects/triggers and current pairs; historical backfill unproven | HOLD |
| `0011` | SCHEMA MATCHES — device references and current pairs; historical backfill unproven | HOLD |
| `0012` | SCHEMA MATCHES — academic objects; real data effects unreviewed | HOLD |
| `0013` | SCHEMA MATCHES — Finance core and trigger; real data effects unreviewed | HOLD |
| `0014` | SCHEMA MATCHES — receipt integrity objects; zero receipts makes backfill proof vacuous | HOLD |
| `0015` | SCHEMA MATCHES — bank-transfer settings; existing values unreviewed | HOLD |
| `0016` | SCHEMA MATCHES — refunds; real financial data unreviewed | HOLD |
| `0017` | SCHEMA MATCHES — provider payment objects; existing provider state unreviewed | HOLD |
| `0018` | SCHEMA MATCHES — payment notifications; historical events unreviewed | HOLD |
| `0019` | SCHEMA MATCHES — Finance ledger-gap checks; real-row compliance unreviewed | HOLD |
| `0020` | SCHEMA MATCHES — notification-event identity; historical transitions unreviewed | HOLD |
| `0021` | SCHEMA MATCHES — outbox/retry objects; existing outbox history unreviewed | HOLD |
| `0022` | SCHEMA MATCHES — payment-bound events; real references unreviewed | HOLD |
| `0023` | SCHEMA MATCHES — invoice notice/outbox objects; real deliveries unreviewed | HOLD |
| `0024` | SCHEMA MATCHES — company employees; `IF NOT EXISTS` is not execution proof | HOLD |
| `0025` | SCHEMA MATCHES — Communication objects; delivery history unreviewed | HOLD |
| `0026` | SCHEMA MATCHES — entitlement references/keys; consent data unreviewed | HOLD |
| `0027` | SCHEMA MATCHES — Library objects/keys; real lending data unreviewed | HOLD |
| `0028` | SCHEMA MATCHES — Operations objects/keys; real maintenance data unreviewed | HOLD |
| `0029` | SCHEMA MATCHES — history function/triggers; historical rows unreviewed | HOLD |
| `0030` | SCHEMA MATCHES — loan/copy integrity; real pairs/validation unreviewed | HOLD |

The disposable preflight used a hardcoded local-identity and exact five-ledger fingerprint gate plus representative catalog/data gates; the **positive baseline passed those representative checks**. The **full equivalence/adoption gate did not pass**. Consequently:

- **Reconciliation transaction on current-schema clone:** **NOT RUN**. No IDs 6–31 were inserted on that clone; original five stayed unchanged. This is the intended safe refusal, not a successful adoption.
- **First post-adoption migration run on that clone:** **NOT RUN — blocked before adoption**.
- **Second post-adoption migration run on that clone:** **NOT RUN — blocked before adoption**.
- **Separate clean reference only:** after its genuine clean migration replay had produced 31 rows, first and second later runner calls were both successful no-ops; complete ledger and normalized schema were identical before/after. **This proves only ordinary runner idempotency on a clean 31-row reference; it does not prove idempotency of a reconciled current-schema clone.**

The proposed marker is a future separately retained, tamper-evident adoption audit with operator, reviewer, timestamp, reason, ID/tag/current SQL hash/journal time, original hash where applicable, data/catalog proof, target identity and audit reference, explicitly labeled **“VERIFIED RECONCILIATION OF CURRENT STATE; HISTORICAL EXECUTION NOT VERIFIED.”** Drizzle's three-column ledger alone cannot carry that distinction. ID 2's known old hash and ID 5's unknown-source old hash were preserved, not overwritten or invented. No audit table, marker row or persistent ledger row was created.

## 4. Five negative tests

Each test used an independently cloned **disposable synthetic** database with five original ledger rows. A read-only preflight refused before any ledger adoption:

| Case | Negative mutation on isolated clone | Observed rejection | Ledger |
| --- | --- | --- | ---: |
| A: required column absent | Dropped `fee_school_settings.bank_name` | `required_column_gate` | 5 |
| B: constraint differs | Replaced `school_classes_id_school_tenant_key` with `UNIQUE(id)` | `tenant_key_definition_gate` | 5 |
| C: required backfill absent | Removed one synthetic historical device-school binding and **re-enabled all table triggers before preflight** | `historical_pair_backfill_gate` | 5 |
| D: missing trigger | Dropped `device_school_bindings_append_only` | `function_trigger_gate` | 5 |
| E: partial schema | Dropped `communication_notifications` | `partial_schema_gate` | 5 |

For C, the first check with the table's triggers disabled rejected at the **trigger** gate; after re-enabling them, it rejected at the intended **backfill** gate. Each destructive mutation was isolated to a sacrificial local clone. The passing representative preflight and these five failures are **not** a complete validated per-migration checker; the higher-level adoption decision still refused.

## 5. Tenant, backup/restore and application checks

On the **restored** two-school disposable fixture, six cross-school updates each produced FK SQLSTATE **`23503`** and the containing transaction was rolled back: NFC card/student, device/class, Operations asset/category, Finance invoice/student, Library copy/book and Communication notification/student. This verifies those database boundaries with seeded data, not all user/role paths; Partner access is an application authorization matter, covered in the API test suite on the clean reference but not exercised with an authenticated Partner session on the current clone. No tenant constraints were weakened on the current-schema clone.

A full custom-format backup of the **five-ledger synthetic current clone**, SHA-256 `e2ff5cbf83fc02bf4948474d2057224e4d07e9de00d2b038f4dfd22f17b8075d`, was restored into separate `phase11d_restore`. Both sides had two schools, two students, two unpaid invoices, two audit rows, five ledger rows and identical ledger MD5 `bb9579f8bcffb9c54d92b432aa215ff1`. Normalized schema dumps matched byte-for-byte; the restored catalog/data preflight passed. This is **pre-adoption synthetic** backup/restore, not rollback after reconciliation, recovery of real development records, separate file storage or a production restore. A new API process was not started against this restored copy in Phase 11D; Phase 11B previously documented that independent health exercise, which is not claimed as a new Phase 11D result.

| Requested application check | Exact Phase 11D result |
| --- | --- |
| API against **current-schema** synthetic clone | **572/574 passed; 2 failed**. The forward-migration safety test expects clean-replay referenced indexes, whereas the actual clone binds different indexes; the parent-relationship test expects its first two students to share a school, but this two-school fixture has one student in each. No application files were edited. |
| API against **separate clean-replayed** local database | **574/574 passed**, 68/68 test files, after seeding the synthetic fixture plus one same-school student to meet the parent test's prerequisite. This is not a pass on the unreconciled current clone. |
| Web tests | **21/21 passed**, six test files |
| Workspace typecheck | **PASS** |
| API build | **PASS** |
| Web build | **PASS** with existing bundle-size warning; supplied `PORT=19494 BASE_PATH=/ NODE_ENV=production` for its build config |

The two failures on the current clone are valuable evidence about schema/fixture differences, not grounds to change production code or to mark the reconciliation passed. The passing total on the correctly seeded clean reference was **595/595** API + web tests, but current-schema application verification remains incomplete.

## 6. Before/after schema diff and status

- Baseline failing clone before/after the `0005` runner error: **no schema change** after normalizing dump-only random restrict tokens; ledger still five.
- Current-schema synthetic clone versus restored preflight backup: **identical normalized schema**, same five-row ledger fingerprint and selected row counts; representative preflight passed after restore.
- Clean reference before/after **two** no-op runner calls: **identical normalized schema and all 31 ledger rows**.
- Current-schema clone versus clean replay: **14 clean-only FK definitions and eight clone-only constraint/index definitions** as above. They are **pre-existing baseline differences**, not reconciliation-induced changes.
- Current-schema clone **post-adoption** schema diff: **NOT AVAILABLE**; adoption intentionally did not occur. The negative copies intentionally differ and are not the positive target.

**Final selection: REHEARSAL INCONCLUSIVE — MORE EVIDENCE REQUIRED.** The local database and failure reproduction are real, and negative/security/restore checks are useful, but the requested all-26 data/dependency proof and post-reconciliation idempotency were not obtained. Marking this “passed” because the clean reference runs twice would be false. See the linked plan for the exact future approval/precondition/stop sequence. This phase does **not** prove historical execution, readiness for persistent development reconciliation, production safety or deployment readiness.

## 7. Explicit safety accounting

| Action | Outcome |
| --- | --- |
| Disposable databases created | **YES** — local, Unix-socket-only Phase 11D cluster |
| Baseline `0005` failure reproduced | **YES**, exact nested PostgreSQL relation-already-exists cause |
| `0005`–`0030` classified | **YES** — 26 rows in the plan, all adoption decisions HOLD |
| Representative guarded reconciliation preflight tested | **YES**; full ledger adoption procedure **NO**, blocked |
| First/second post-reconciliation runner | **NOT RUN / NOT RUN**; two no-ops only on separate clean reference |
| Current-clone reconciliation idempotency | **NOT ESTABLISHED** |
| Five negative cases | **5/5 rejected**, five-row ledger preserved |
| Tenant isolation | **6/6** cross-school FK attempts rejected; authenticated Partner/current-clone role journey not run |
| Synthetic pre-adoption backup/restore | **PASS**; no post-adoption restore |
| API tests | **572/574** on current clone; **574/574** on separate clean fixture |
| Web tests | **21/21** |
| Typecheck | **PASS** |
| Backend/frontend builds | **PASS / PASS** (frontend bundle warning) |
| Schema diff | **No unexpected mutation** in baseline/restore/clean-no-op comparisons; pre-existing 14/8 catalog delta remains; no post-adoption diff |
| Persistent development database changed | **NO** |
| Persistent development migration ledger changed | **NO** |
| Production queried / changed | **NO / NO** |
| Publish or deployment executed | **NO** |

The disposable server and test databases are temporary and not part of the product. The only checked-in project changes for this phase are this report and its companion plan; no historical migration SQL or application functionality changed.