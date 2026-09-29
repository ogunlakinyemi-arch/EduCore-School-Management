# PHASE 11C — MIGRATION FORENSICS & RELEASE PLAN

**Yemait EduCore · 29 September 2026 · forensics and planning only**  
**Final status: FORENSICS COMPLETE — RECONCILIATION BLOCKED.** This means the available project evidence was investigated and documented; it does **not** mean the historical cause is proven or that a live ledger update is approved. No persistent database schema, ledger, migration file, application behavior, or production environment was changed.

## Executive summary

The repository journals **31** SQL migrations (`0000`–`0030`). The independently identified development database contains **five** migration ledger rows (IDs 1–5, corresponding to `0000`–`0004). Three recorded hashes match current files; IDs **2 (`0001`) and 5 (`0004`) do not**. The exact old `0001` SQL exists in Git: six unique-index statements were subsequently reordered. No source matching the old `0004` hash was found in accessible Git objects, local files or backups. **Historical source not found in available project evidence.**

The development catalog contains the named objects expected of many later migrations. That proves their **present final state**, not whether or how those migration files ran. **None** of the 26 missing-ledger migrations (`0005`–`0030`) is confirmed or strongly indicated *executed* by independent evidence; **all 26 are NOT VERIFIED** as historical executions. Nor is any confirmed not applied. The mechanism that caused the incomplete ledger remains **unproven**. A disposable Phase 11B ledger-adoption and backup/restore rehearsal passed, but it does not authorize modifying the development ledger.

**Decision: development reconciliation is NOT READY. Production release is NOT APPROVED.**

## Evidence register and database identity

| Evidence | Finding and limit |
| --- | --- |
| Development connection | A shell read-only query via `DATABASE_URL` and an independent platform `executeSql(environment: "development")` query both returned database `heliumdb`, role `postgres`, 91 public tables and five ledger rows. The shell's `REPLIT_ENVIRONMENT=production` label does **not** by itself identify its database target. No production query was used for this comparison. |
| Fresh development aggregate catalog | 338 public indexes, 613 constraints, three public functions, six non-internal triggers, zero public `information_schema` views, and one unvalidated constraint named `platform_devices_class_school_fk`. Ledger aggregate MD5 over ordered ID/hash/timestamp values: `1f7264f0cab648f2aff567ffc0ee3642`. Detailed object-to-object comparison below is from Phase 11B, not a fresh full diff. |
| Repository | `lib/db/drizzle/meta/_journal.json` lists 31 migrations. SQL inventory: [phase11c-migration-inventory.md](phase11c-migration-inventory.md). Ledger and all 31 hashes: [phase11c-migration-hash-forensics.md](phase11c-migration-hash-forensics.md). |
| Exact schema comparison | [phase11c-schema-vs-migration-analysis.md](phase11c-schema-vs-migration-analysis.md) separates current aggregate verification, Phase 11B's detailed comparison, final effects, and execution confidence. |
| Historical events | Git can prove when SQL text was checked in, not that it was applied to a particular database. No runner/push execution log establishing the later development changes was found in accessible evidence. The historical SQL for `0004` may exist outside the available project evidence. |

## Migration ledger findings

The ledger's five `created_at` values match the first five journal `when` values and are ordered correctly. For IDs 1, 3 and 4, the stored hash equals SHA-256 of current migration SQL text. ID 2 records `f198518b…71c9` versus current `0a329af1…9244`; ID 5 records `eda97466…06ba` versus current `02d011d9…05ca`. IDs 6–31 are absent. The full, exact 64-character values, timestamps, filenames and absence status for every migration are in the hash-forensics table. The main agent's fresh read-only SQL returned the same five values as the retained Phase 11B ledger extraction.

Installed Drizzle Kit 0.31.10/Drizzle ORM 0.45.2 reads the journal and SHA-256-hashes each SQL file's **original text** (including statement delimiters). The PostgreSQL migration runner selects the latest ledger timestamp, executes a migration's SQL chunks, then inserts its ledger hash/timestamp in a transaction. It decides whether to run by timestamp; it does **not** compare the stored hashes of already-recorded files to current files. A failed migration transaction does not record that failed migration. This explains how the runner **behaves**, not what happened historically in development.

### Historical hash forensics

- **`0001`: source found.** Git commit `41e0595bc6dd64570f94b70952946c788a940bed` contains the exact old SQL whose SHA-256 equals the development row. Commit `2c5f018b63c330e0c89bc5083a9480c744b4822b` reordered six existing `(id,school_id)` unique-index statements; it did not add or remove their definitions overall. The text was changed after the old version existed. The matching ledger hash is consistent with, but cannot independently prove, execution of that exact blob against development.
- **`0004`: source not found.** The recorded hash matches no accessible version of `0004` or SQL blob among the inspected Git refs/objects, reflogs, project files, local backup-named files and PostgreSQL dumps. Git's first reachable `0004` commit is 25 seconds after its journal timestamp; a journal timestamp is not an execution log. **Historical source not found in available project evidence.** Do not fabricate an older SQL version or overwrite this recorded hash.

## Schema findings and execution classifications

Phase 11B's detailed clean-replay comparison found 91 tables and 1,127 columns on both sides, with matching column definitions (some physical orders differ), three matching function definitions and six matching user-trigger definitions. Development had 338 indexes and 613 constraints; clean replay had 334 and 623. The entire reported delta was **14 clean-only legacy single-column academic FKs** and **four development-only validated `(id,school_id)` UNIQUE constraints with their backing indexes** (`attendance_discrepancies`, `attendance_events`, `nfc_cards`, `student_class_assignments`). Composite tenant FKs exist on both. The device/class FK is `NOT VALID` on both; its development row with a class was checked for an orphan in Phase 11B, but historical rows on another target remain unknown. Current aggregate counts have been reconfirmed, not every prior definition.

The [per-migration matrix](phase11c-schema-vs-migration-analysis.md#per-migration-expected-vs-observed-final-effects) reports expected/observed final effects and uncertainty for `0000`–`0030`. As historical-execution classifications for **`0005`–`0030`**: **CONFIRMED APPLIED: 0; STRONGLY INDICATED APPLIED: 0; NOT VERIFIED: 26; CONFIRMED NOT APPLIED: 0**. The first five have ledger entries, but two are textually different from current SQL. An object matching its final definition is insufficient proof that an absent-ledger migration executed.

Important positive/negative data evidence: Phase 11B found no missing development historical device-school binding pairs and no parent-name/phone match candidate lacking a link. Development had **zero fee receipts**, so its receipt backfill check is vacuous. Disposable pre-migration fixtures demonstrated the `0010`/`0011` device and `0014` receipt backfills under test data only. The transient FK/index drop-and-rebind sequence of `0006`–`0008` cannot be reconstructed from a final catalog.

## Root-cause investigation

The repository's `.replit` points to `scripts/post-merge.sh`, whose checked-in command is `pnpm --filter db push`; that filter resolves to `@workspace/db`, where `push` is `drizzle-kit push --config ./drizzle.config.ts`. The config consumes `DATABASE_URL`. This **is a configured schema-application path distinct from the journaled migration runner** and is capable of updating a schema without recording journal migrations. Its presence makes schema/ledger drift technically plausible, but **does not prove that it ran for these changes or identify the actor/time/path that produced them**. Git history shows the script's current content was introduced in the initial commit; this is source history, not an execution log.

The API entry point and DB package entry point contain no detected startup migration call. The package offers explicit `push`/`push-force` scripts, not an application-startup `migrate` step. Both application test scripts invoke Vitest; the inspected Finance PostgreSQL integration test explicitly refuses a database other than its local disposable test target. This test setup is not evidence that journaled migrations ran against the persistent development database. The installed journaled runner's transactional insert-after-SQL behavior makes a silently committed partial migration within its transaction an unsupported explanation on current evidence; it does not rule out external SQL, a schema push, restoration, or activity outside accessible logs. **Exact historical root cause: NOT PROVEN.** No speculative cause has been selected as fact.

## Exact `0005` failure analysis

`lib/db/drizzle/0005_tenant_reference_keys.sql` begins:

```sql
ALTER TABLE "school_classes"
  ADD CONSTRAINT "school_classes_id_school_tenant_key" UNIQUE("id","school_id");
```

It is an unguarded `ALTER TABLE … ADD CONSTRAINT`. The development `public.school_classes` already has a **validated UNIQUE constraint** named `school_classes_id_school_tenant_key` with `UNIQUE (id, school_id)`, backed by a unique index. The schema-only clone retained this object and the five-row ledger; the normal runner then selected `0005`, hit the duplicate object name, and failed before adding a ledger row. A clean empty-database replay succeeded.

Git commit `8320e62d15060d54adb93bdaf1ee4eff88520355` first introduced this checked-in migration and its six constraint statements (23 September 2026). That is the file's first repository appearance, **not the object's database creation time**. All six expected tenant-key definitions were present and validated in Phase 11B's development comparison, but whether the original migration, schema push or another process created them is **NOT VERIFIED**. The matching constraint does **not** by itself make it safe to label `0005` historically applied or blindly replay it.

## Phase 11B evidence review

**PROVEN IN SYNTHETIC ENVIRONMENT:** a local schema-only clone with the original five ledger rows and two-school synthetic data; guarded adoption of rows 6–31 explicitly marked *verified adoption, not originally executed*; preservation of the original rows/hashes and fixture counts; two no-op runner calls; separate historical device/receipt backfill fixtures; six rejected cross-school relationships; full-data backup, restore, and restored API health check.

**NOT PROVEN IN LIVE DEVELOPMENT:** which SQL actually produced each later object; whether each historical data transformation ran on its original data; whether the unknown `0004` SQL had side effects; whether a live ledger adoption is safe; whether a live development backup/restore or production release would succeed. The Phase 11B adoption script is **hardcoded for local disposable databases**, must not be repurposed against development/production, and was not run in Phase 11C.

## Proposed controlled development reconciliation — **PLAN ONLY, DO NOT EXECUTE**

**Current authorization state: STOP. Exact migrations authorized for adoption now: none.** Entries `0005`–`0030` (ledger IDs 6–31) are *candidate* entries only after all gates below pass. In particular, investigate `0005` and transient `0006`–`0008`, and the data effects in `0010`/`0011`/`0014`, before considering any candidate adoption. Retain original IDs 1–5 and hashes; never rewrite historical SQL to satisfy the runner.

1. **Approvals/identity:** Assign an accountable operator and independent reviewer; confirm maintenance window and write freeze. Independently identify the exact persistent development target and its connection, not just the environment label. Establish whether its schema/ledger changed since the fingerprints above. Fail closed on identity mismatch.
2. **Recoverable backup:** With approved, development-only tooling, take an encrypted full database snapshot including data/schema/ledger, plus any separately stored file bytes and a config inventory without secret values. Store checksums, location, access, retention and restore owner outside temporary `/tmp` evidence. Restore a copy to a **disposable** target and prove application reads, invariants and recovery steps. A database dump is not a complete application backup.
3. **Immutable pre-state:** Capture the live schema-only catalog (columns, indexes/predicates, constraint definitions and validation flags, FK dependencies, functions, triggers, views, extensions), full ledger rows in order, migration journal, current SQL SHA-256s, Git revision, relevant row counts and data-invariant results. Preserve originals and hashes in an audit record; compare to a clean replay plus documented deltas. Stop on any new drift.
4. **Resolve evidence gaps:** Seek the exact old `0004` SQL or obtain formal risk acceptance for the unknown source after an independent effects review. Determine why the development ledger is short using trustworthy execution/merge/DB audit logs if recoverable; absence of such logs stays “unknown.” Verify the six `0005` keys; individually review the 14 missing legacy FKs and four extra keys for intended dependency/tenant protection; assess `0006`–`0008` FK/index dependency graph, `NOT VALID` device/class FK, and all historical data transformations on a representative **approved/anonymized development-data copy**. Do not mistake test fixtures or zero receipts for real backfill proof. Resolve any discrepancy through a separately reviewed forward plan, not silent ledger edits.
5. **Review adoption candidates:** Produce an explicit signed table for **each** of `0005`–`0030`: checked-in hash, final catalog effect, data effect, independent evidence/limitations, decision (`adopt` / `repair first` / `do not adopt`), reviewer and rationale. Until every row is approved, the candidate set remains empty. Keep hash mismatches for existing rows 2/5 unchanged; record their old/current digests and known/unknown provenance in an adjacent, immutable audit—not as replacement ledger hashes. Adoption means *verified equivalent final state*, never “this SQL ran.”
6. **Rehearse then schedule:** Exercise the approved procedure and negative/abort cases on a fresh disposable restore with development-representative data. If—and only if—every gate passes, propose a separate user-approved development change using a guarded, atomic procedure restricted to the verified development identity and pre-state digests. Do not reuse the local Phase 11B script. Separate any necessary forward data/DDL repair from the ledger adoption; review their ordering and rollback. No live procedure is provided or executed by Phase 11C.
7. **Post-change verification, if later approved:** Compare the ledger to the signed adoption table; ensure original five rows are byte-for-byte unchanged, exact approved new rows only, no unexplained schema/data changes, valid tenant protections and stable counts. Invoke the runner **twice** and prove both are no-ops; rerun API/web tests, typecheck, builds, security/role checks, and API health. Snapshot after change and retain before/after audit with operator/approval/times/commands/digests.
8. **Stop/rollback:** Stop immediately on target mismatch, unexpected catalog/ledger hash, missing data effect, unapproved object, constraint-validation failure, changed data counts, runner DDL attempt, test failure, backup/restore failure or loss of reviewer approval. Do **not** simply delete adopted ledger rows: that can make the runner replay non-idempotent SQL. For a failed committed change, keep writes stopped, independently diagnose, and restore the **whole verified development backup** (including affected files/config as applicable) only under a separately approved recovery decision; record the incident. No production restore or data overwrite is implied.

## Production release gates — all require independent approval

The checks below are a **future release plan**, not claims of production verification. First establish whether the deployed app uses Replit-managed or external PostgreSQL, which actual database it targets, and how schema updates are handled there; do not infer hosting from `DATABASE_URL` format or the database name. For a managed production database, the Publish flow may present a development/production schema diff and rename confirmations; inspect that diff and test a deployment preview **before** any Publish. For an external database, use its separately documented and approved migration path. **No production query, schema change, deployment, or Publish occurred here.**

| Area | Required evidence before release |
| --- | --- |
| **Database/recovery** | Development history reconciled with approved evidence; separately identify production target and current schema; compare required columns, indexes/predicates, validated constraints, FK dependencies, functions, triggers, views and composite tenant protections; runner tested twice in an appropriate rehearsal; completed database **and file** backup; proven restore, RPO/RTO, retention, monitoring and rollback; independently review the prospective Publish/schema diff. |
| **Authentication** | Production Clerk configuration and redirect/CORS domains verified; first Platform Owner login/recovery and session behavior, School Admin invitation (including duplicate/inconsistent state), role membership and revocation tested with approved non-live accounts. |
| **Security** | Tenant and role isolation, object-level authorization, cross-school FK checks, audit history, CORS, distributed rate limits, bounded uploads and report exports independently verified. |
| **Finance** | Correct environment/provider configuration, webhook signature and idempotency, checkout reconciliation, refunds/reversals, receipts and money invariants; controlled provider sandbox evidence first, no real financial activity in this phase. |
| **Communication** | SMS/email provider configuration and consent/preferences, retry/dead-letter and delivery records, safe reconciliation after uncertain sends; push only after PWA/installability and permissions are proved. |
| **PWA** | Installability, valid service worker/scope, push registration and permissions, responsive/mobile layout and relevant offline/error behavior. |
| **Reporting** | Per-role/report authorization, tenant scoping, export/download caps, large-report limits and Unicode/PDF character handling. |
| **Library & Operations** | Borrower ownership, library staff boundaries, asset/facility/maintenance isolation and tenant-safe history. |
| **Platform Owner** | Platform-level oversight and owner recovery; explicitly **no inherited School Admin permission** for ordinary school operations, even on a dual-role account. |
| **School Admin** | Full authorized management of only their schools, invitation and membership lifecycle. |
| **Teacher** | Only assigned academic and attendance capabilities, never cross-school records. |
| **Accountant** | School-scoped Finance permissions without unrelated administration. |
| **Parent** | Only explicitly linked children's information. |
| **Student** | Only their authorized self-information. |
| **Partner** | Only permitted school-referral and commission information. |

Additional known release gaps carried from Phase 11B: live backup/restore not demonstrated, production Clerk/providers not verified, distributed upload/export protection incomplete, PWA/push incomplete, and PDF Unicode limitations. A passing local build and synthetic database exercise do not close these.

## Testing and safe commands

| Phase 11C check | Result |
| --- | --- |
| Read-only shell SQL and separate platform development SQL | PASS; same development identity/table/ledger counts, current catalog aggregate recorded above |
| Journal/source SQL parsing and SHA-256 cross-check | PASS; 31 journal entries, file hashes and historical `0001` blob matched |
| API unit/contract tests | PASS: **574/574**, 68 test files |
| Web tests | PASS: **21/21**, six test files |
| Workspace TypeScript check | PASS |
| API production build | PASS |
| Web production build | PASS with required manual `PORT=19494 BASE_PATH=/ NODE_ENV=production`; initial bare build refused to load config because `PORT` was missing, not a code failure; existing chunk-size warning remains |
| `git diff --check` | PASS |
| Migration application / ledger adoption during Phase 11C | **NOT RUN**; prohibited against persistent development. Phase 11B disposable replay is cited as prior evidence only. |

Read-only commands included `psql "$DATABASE_URL"` with `SELECT` only; `executeSql({environment:"development", ...})` with parameterized `SELECT`; `git log`, `git show`, `git fsck`, `rg` and SQL-source SHA-256; `pnpm --filter @workspace/api-server test`, `pnpm --filter @workspace/edupulse test`, `pnpm run typecheck`, and the two package builds. No migration/DDL/DML command was directed at development or production.

**Files examined:** the attached Phase 11C brief; `docs/phase11b-migration-reconciliation.md`; all 31 `lib/db/drizzle/*.sql` files and `meta/_journal.json`; `lib/db/drizzle.config.ts`, `lib/db/package.json`, relevant Drizzle ORM migration source; `scripts/post-merge.sh`, `.replit`, `replit.md`; accessible Git refs/objects and available local dump/evidence files. The linked companion reports contain the complete per-file inventory and ledger/hash tables.

## Final status

**FORENSICS COMPLETE — RECONCILIATION BLOCKED.** Historical `0004` SQL, the event that left the ledger incomplete, and execution of entries `0005`–`0030` have not been proved. The appropriate immediate next step is a separately approved evidence-gathering/review round, **not** a ledger update or Publish. Development schema and ledger **were not modified**; production **was not modified or queried**; **Publish was not executed**.