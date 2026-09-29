# Phase 11C-A — Historical Migration Evidence Collection

**Yemait EduCore · 29 September 2026 · repository/local-evidence investigation only**  
**Historical evidence status: ROOT CAUSE NOT PROVEN. Ledger reconciliation: BLOCKED.**

## 1. Executive summary

The checked-in journal contains 31 migrations (`0000`–`0030`), but the development ledger had only five rows (for `0000`–`0004`) in the independently identified read-only Phase 11C inspection. The remaining schema objects exist, but neither the catalog nor the available Git commits prove that `0005`–`0030` were executed against development.

A **non-migration schema path is confirmed to be configured**: the project's post-merge command invokes `drizzle-kit push`, not the journaled migrator. It can change schema without inserting migration-ledger rows. **Its actual execution at the relevant time and responsibility for this discrepancy are NOT PROVEN.** No retained historical hook output, migration-runner transcript, DDL audit, database-restore log or matching historical `0004` SQL was found in the inspected local evidence. A merge/rebase explanation likewise has no supporting migration conflict/rename/renumbering evidence.

No database was queried or changed in this Phase 11C-A evidence search. Its development-ledger/catalog facts are attributed to the prior [Phase 11C read-only verification](phase11c-migration-forensics-report.md) and [hash investigation](phase11c-migration-hash-forensics.md).

## 2. Git history findings

All accessible refs (`main`, `replit-agent`, `gitsafe-backup/main`, `refs/replit/agent-ledger`) were considered. No tags or unreachable Git objects were reported by the previous full object search. Commit dates below are UTC **repository dates, not SQL execution dates**. The inspected migration/db/config commit authors are recorded as Replit Agent in Git; an author field establishes source attribution only.

| Commit/date | Affected source and proven change | Can it explain the missing rows? |
| --- | --- | --- |
| `0c05d76` · 2026-09-11 01:39 | Initial DB package/config and `scripts/post-merge.sh`; `.replit` already points at the hook. The hook executes `pnpm --filter db push`. | **Possible mechanism** configured, not an execution record. No earlier ledger-table creation event is established. |
| `02ee8da`, `7709c84` · 2026-09-23 01:21–01:29 | Adds then revises `0000` and schema/journal. | Git text only. |
| `41e0595` · 2026-09-23 02:10 | Adds `0001_phase3_meta.sql`, schema, snapshot and journal. Its SQL SHA-256 exactly matches development ledger ID 2. | Explains an **old hash's source**, not the missing later ledger rows or execution target. |
| `e60482c`, `116f14c` · 2026-09-23 06:40–06:41 | Journal and `0002` changes. | No execution evidence. |
| `2c5f018` · 2026-09-23 11:00:25 | Reorders six existing unique-index statements in `0001`; first reachable addition of `0004_platform_operations.sql` and journal. The `0004` journal `when` is 11:00:00, 25 seconds before this commit. | Git timing does not prove an earlier `0004` blob or execution; recorded ID 5 hash still has no matching source. |
| `d62da4c` · 2026-09-23 11:11 | Updates `.replit` module/configuration settings, not the post-merge hook path. | No hook-execution evidence. |
| `8320e62` · 2026-09-23 11:44 | First reachable `0005_tenant_reference_keys.sql`, six named tenant-unique constraints and matching schema declarations; includes `school_classes_id_school_tenant_key`. | Earliest **repository** source, not the existing object's database creation time. |
| `1c83a8d` · 2026-09-23 11:50; `54b8fc6` · 12:07; `a381ff1` · 14:30 | Introduce `0006`, `0007`, `0008` dependency-preparation/rebinding SQL respectively. | Explains source chronology; cannot prove transient drops/recreates occurred in development. |
| `1ba9f07` · 2026-09-23 19:50 | Adds `0009` attendance schema/migration. | No execution evidence. |
| `fcc64ad` · 2026-09-24 08:36; `a9b4298` · 09:40 | Introduce `0010`–`0011` historical-device work and `0012` academic operations, respectively. | No execution evidence. |
| `6093d97` · 2026-09-28 22:15 through `d78f71b` · 2026-09-29 10:32 | Feature branches add `0013`–`0030` (Finance, communications, library, Operations), schema and journal in ordered groups. | No execution evidence; matching final objects are not a migration transcript. |
| Phase 11B/11C read-only inspections · 2026-09-29 | Five development ledger rows observed; catalog/clean replay and hashes compared. | **Current-state evidence only**; no historical insertion/delete event found. |

The checked-in post-merge hook and DB package scripts were present from the initial commit and no commit changing their migration strategy was found. The application's inspected startup path has no migration call. Git searches found no migration rename, squash or renumbering record. Absence of a Git record cannot exclude manual SQL, an external restore, or unavailable execution logs.

## 3. Merge history — all matching database/migration/configuration paths

`git log --all --full-history --merges` with paths `lib/db/drizzle`, `lib/db/src/schema`, `lib/db/package.json`, `lib/db/drizzle.config.ts`, `scripts/post-merge.sh`, `.replit` returned **27** merges. The following are unique abbreviated Git hashes; `P1/P2` gives **both** parents, and the change is the merge tree relative to P1. The merge tree matches P2 on those paths for **every** row (`git diff <merge>^2 <merge> -- <paths>` was empty across all 27): the listed migration/config change existed on P2 **before** the merge, not introduced by a merge-resolution patch. `—` means this path-filtered merge changed schema or configuration but added no migration SQL. No listed merge changed runner/ledger-insertion implementation or package scripts; journal edits are migration metadata, not runner logic.

| Merge (UTC) | P1 / P2 | Migration or DB/config change inherited from P2 |
| --- | --- | --- |
| `dcb9b8e` (Sep 23 01:21) | `28abb19` / `7709c84` | Add `0000`, snapshot/journal, schema |
| `3d8e6bb` (Sep 23 01:29) | `dcb9b8e` / `02ee8da` | Revise `0000`, schema |
| `a9cd60c` (Sep 23 02:10) | `3d8e6bb` / `41e0595` | Add `0001`, snapshot/journal, schema; `.replit` modules |
| `e5ba175` (Sep 23 06:40) | `a9cd60c` / `e60482c` | Journal/schema only |
| `fef58b2` (Sep 23 06:41) | `e5ba175` / `116f14c` | Add `0002`, snapshot/journal |
| `3ed3e47` (Sep 23 10:07) | `fef58b2` / `f7e40cd` | Add `0003`, journal/schema |
| `d0f665a` (Sep 23 11:00) | `3ed3e47` / `2c5f018` | Reorder `0001`, add `0004`, journal/schema |
| `c9e4a8f` (Sep 23 11:11) | `834e59f` / `d62da4c` | `.replit` modules only |
| `06238fb` (Sep 23 11:44) | `c9e4a8f` / `8320e62` | Add `0005`, journal/schema |
| `dfbac87` (Sep 23 11:50) | `06238fb` / `1c83a8d` | Add `0006`, journal/schema |
| `3411214` (Sep 23 12:07) | `4b42890` / `54b8fc6` | Add `0007`, journal/schema |
| `6683824` (Sep 23 14:30) | `b8d1062` / `a381ff1` | Add `0008`, journal |
| `3214078` (Sep 23 19:50) | `be57908` / `1ba9f07` | Add `0009`, journal/schema |
| `1a603bf` (Sep 24 08:36) | `af1356b` / `fcc64ad` | Add `0010`–`0011`, journal/schema |
| `001b107` (Sep 24 09:40) | `1a603bf` / `a9b4298` | Add `0012`, journal/schema |
| `d6eafce` (Sep 25 00:42) | `e85749f` / `7e81b74` | —; schema only |
| `eea8059` (Sep 25 00:56) | `d6eafce` / `0478a94` | —; schema only |
| `966824c` (Sep 25 01:07) | `eea8059` / `7469cf7` | —; schema only |
| `810e8d1` (Sep 25 01:11) | `966824c` / `de03318` | —; schema only |
| `234e153` (Sep 28 22:15) | `810e8d1` / `6093d97` | Add `0013`–`0015`, journal/schema |
| `9ec891b` (Sep 28 23:32) | `234e153` / `f759d30` | Add `0016`–`0018`, journal/schema; `.replit` config |
| `9f08ec9` (Sep 29 00:07) | `9ec891b` / `73ea06e` | Add `0019`, journal/schema |
| `057e445` (Sep 29 02:33) | `c21020c` / `d9bbcea` | Add `0020`–`0021`, journal/schema |
| `aa7a66f` (Sep 29 03:10) | `057e445` / `c0ad80f` | Add `0022`–`0023`, journal/schema |
| `e910234` (Sep 29 04:39) | `1a9f4e7` / `2250585` | Add `0024`, journal/schema |
| `49995bc` (Sep 29 10:01) | `fcb9055` / `e02bdfa` | Add `0025`–`0026`, journal/schema |
| `43dffc0` (Sep 29 10:32) | `7de84ed` / `d78f71b` | Add `0027`–`0030`, journal/schema |

Git reports 72 merges in all history; **27** touch the selected migration/schema/config paths above. The other 45 do not match these paths and are not evidence of a migration-path merge. A first-parent diff reflects inherited feature-branch work, not proof that a post-merge hook ran or that any database was touched. No merge-time conflict resolution, migration rename, rebase, squash or ledger rewrite was established. Several commits titled “Published your App” exist; titles alone do not establish database SQL or ledger operations, and none was used to query production.

## 4. Historical database, deployment and startup logs

Searches covered repository-tracked/untracked local artifacts, migration/backfill/backup-named files, and available workspace logs for `school_classes_id_school_tenant_key`, `0005`–`0030`, migration/push commands, SQL execution and restore/startup failures. **No retained historical migration-runner, post-merge invocation, DDL audit, database initialization/restore, or deployment execution log tying a command, actor, timestamp and target database to these schema changes was found.** Current `/tmp/logs` contained only recent 29 September development workflow/browser files; there was **no locally retained deployment log** in that directory at this inspection. Phase 11B's disposable replay/adoption logs are experiments, **not** 23–29 September historical executions. An available documentation page describing an external deployment-log API is not itself a log; no production/log service was queried.

The named `0005` constraint occurs in checked-in migration/schema source, tests, and subsequent forensic reports, not in an independent historical execution transcript. In particular, the Phase 11B failure occurred on a **disposable schema-only clone** and cannot establish a historical production/development failure.

## 5. Ledger and runner history

The application repository's migration table is managed by the installed Drizzle ORM PostgreSQL migrator, not by an application-defined migration SQL file. The installed runner (Drizzle Kit 0.31.10 / Drizzle ORM 0.45.2 in Phase 11C) reads `meta/_journal.json`, creates the ledger table if absent, selects the latest row by journal timestamp, then performs SQL chunks **followed by** ledger insert inside one PostgreSQL transaction. It hashes original SQL file text with SHA-256 and does not compare earlier stored hashes before deciding whether to run a later timestamp. A failed statement in that runner transaction does **not**, by this implementation, leave preceding transactional DDL committed without its ledger row. That is **current implementation analysis**, not proof every historical SQL command used this runner/version.

No repository change to the installed runner's ledger schema/insertion logic was found among the relevant feature merges. The first observed development ledger rows have IDs 1–5 with journal-aligned timestamps; **the ledger table's actual database creation time is NOT PROVEN**, nor is a ledger reset/replacement or prior alternate ledger format. No checked-in reset script or recorded deletion was found. The API entry point does not call the migrator at startup. The inspected test entry points use Vitest; a Finance PostgreSQL integration test explicitly refuses a non-disposable target. Tests therefore supply no evidence of migrations applied to persistent development.

## 6. `0005` unique-constraint provenance

`school_classes_id_school_tenant_key` first appears in reachable repository history in commit `8320e62` (23 September 11:44:22 UTC), both in `0005_tenant_reference_keys.sql` as unguarded `ALTER TABLE school_classes ADD CONSTRAINT … UNIQUE(id,school_id)` and in the schema declaration. This commit also added five other named tenant keys. Earlier `0001` and `0004` instead use a **different name**, `school_classes_id_school_unique`, for a composite unique index. The old recorded-hash `0001` blob did **not** introduce the named tenant-key constraint. No inspected bootstrap/manual setup file independently adds it.

Later `0007` drops/recreates the named tenant constraint using an existing unique index; `0008` drops/re-adds it as `UNIQUE(id,school_id)` while rebinding dependent FKs. The logical `(id,school_id)` definition is stable in these checked-in sources; index ownership/dependency lineage may differ. Phase 11B's read-only development catalog found the named key validated and equal in **definition** to `0005`, and its five-ledger schema clone failed when attempting the first `0005` `ADD CONSTRAINT`. **The database event that created the existing key is NOT PROVEN.** These are sources capable of creating/recreating it, not proof that any ran against development. Manual or unavailable SQL remains possible; a merge commit's source changes do not prove a database write.

## 7. Hash investigation

**`0001`:** development ledger ID 2 records SHA-256 `f198518b395d52dc374249d73780eb28acf1c4f404c1cdb70ec27663049671c9`, exactly the file blob in commit `41e0595bc6dd64570f94b70952946c788a940bed`. Commit `2c5f018…` later **reordered**, not added, six composite unique-index statements; current file hash is `0a329af11216e5f86f7569dad85008a115c497d4e827a2e2adfc5316f62b9244`. This proves a textual source change and an exact historical blob matching the ledger hash; it does not independently prove execution of that blob or explain missing later ledger entries.

**`0004`:** development ledger ID 5 records `eda974665826aa4d5affc07f24f658122ac81502a7190313f0edcd99d24206ba`; current file hashes to `02d011d931579f8177b2a71794a39bea78f23214da41c3606a3375ab1e3505ca`. The Phase 11C exhaustive search covered 1,716 Git blobs, accessible refs/reflogs, unreachable-object check, historical files, generated artifacts and available local dumps/backups. Phase 11C-A rechecked the same accessible sources and found no newly matching blob. **No matching historical source found in available repository evidence.** Do not fabricate a reconstruction or infer execution from the journal timestamp.

The exact hash algorithm, complete 31-row comparison and search limits are documented in [the hash forensics](phase11c-migration-hash-forensics.md).

## 8. Alternative schema paths and Replit configuration history

| Path | Evidence | Historical execution? |
| --- | --- | --- |
| Post-merge schema push | `.replit` has `[postMerge] path = "scripts/post-merge.sh"` from the initial commit (PostgreSQL module added in later `.replit` history). The unchanged hook runs frozen install then `pnpm --filter db push`; this filter resolves to `@workspace/db`, whose `push` script is `drizzle-kit push --config ./drizzle.config.ts` using `DATABASE_URL`. | **NOT PROVEN.** Confirmed configured capability that could change schema without ledger inserts; no retained execution/target log. |
| Manual `push-force` | DB package defines `drizzle-kit push --force`; project documentation also describes dev-only schema push. | **NOT PROVEN** to have run. |
| Journaled migration CLI | Installed runner inserts after SQL in one transaction; no API startup call found. Phase 11B clone failed at 0005 after current ledger timestamp selected it. | Historical application of later files **NOT PROVEN**; disposable result only. |
| API/web build/deployment | Current `.replit` deployment post-build only prunes store; API artifact starts compiled Node, web artifact serves static output, neither defines a schema/migration command in inspected config. `.replit` modules/settings changed, hook path did not. | No checked-in deployment-time migrator in inspected configs; unavailable external execution paths cannot be excluded. |
| Bootstrap/manual SQL, seed/test setup, restore | No independently logged historical setup/restore/DDL command found creating the tenant key or resetting the ledger. Tests target disposable databases where applicable. | **NOT PROVEN**; absence of a checked-in script does not rule out an external/manual event. |

The existence of post-merge `push` plus later catalog objects without ledger rows makes a **plausible** mechanism. It is **not** a causal finding: there are no event-specific hook logs, target identifiers, before/after catalog snapshots or ledger audit records linking a particular invocation to the observed drift. The repo's “Published your App” commits and Replit config source are not production-database execution logs.

## 9. Chronological evidence timeline

Historical ledger state is **UNVERIFIED at every repository event** below. Only the final read-only Phase 11B/11C inspection observed the five-row state; do not backdate that observation.

| Date/commit (UTC) | Event | Migration source state | Ledger state at event | Evidence |
| --- | --- | --- | --- | --- |
| Sep 11 · `0c05d76` | Initial DB scripts and post-merge push hook checked in | No journal entries identified at initial baseline | **UNVERIFIED** | Git source/config |
| Sep 23 01:21–02:10 · `7709c84`, `41e0595` | `0000`, `0001` enter history | Old `0001` blob later matches recorded hash | **UNVERIFIED** | Git blobs; later ledger comparison |
| Sep 23 06:40–11:00 · `116f14c`, `2c5f018` | `0002`–`0004` and journal progress; `0001` SQL reordered | Earliest reachable `0004` text is current-hash version | **UNVERIFIED** | Git commit/blob chronology |
| Sep 23 11:44 · `8320e62`, merge `06238fb` | Named tenant keys and `0005` enter source/merge | Existing development key's **creation date UNVERIFIED** | **UNVERIFIED** | Git SQL/schema; later catalog read |
| Sep 23 11:50–19:50 · `1c83a8d`, `54b8fc6`, `a381ff1`, `1ba9f07` | `0006`–`0009` source and dependency history | Transient FK operations not inferable from final catalog | **UNVERIFIED** | Git SQL/journal |
| Sep 24 · `fcc64ad`, `a9b4298` | `0010`–`0012` source introduced | Backfills testable only synthetically from retained evidence | **UNVERIFIED** | Git; Phase 11B rehearsal |
| Sep 28–29 · `6093d97` through `d78f71b` | `0013`–`0030` introduced on feature branches and merged | Final catalog resembles later files | **UNVERIFIED** | Git SQL/journal; later schema comparison |
| Sep 29 · Phase 11B/11C | Read-only ledger/catalog inspection; disposable rehearsal separate | 31 checked-in migrations, final schema objects | **Observed five ledger rows (IDs 1–5)** | Read-only development inspection and retained audit |

No timeline row asserts a merge-triggered database push, failed historical migration, ledger reset, database restore or SQL execution without an actual event log.

## 10. Classification of explanations

| Finding or proposed explanation | Classification | Reason |
| --- | --- | --- |
| 31 journal entries; only five observed development ledger rows | **CONFIRMED** | Repository journal and independently identified read-only development inspection. |
| Old `0001` SQL text matches recorded ledger ID 2 hash; text later reordered | **CONFIRMED** | Exact Git blob hash/diff and ledger value. |
| Existing `0005`-named validated key matches expected definition; `0005` first introduced that name in accessible Git | **CONFIRMED** for current definition and source chronology, **not** for creation event. |
| A non-migration schema-push command is configured | **CONFIRMED** capability; **POSSIBLE** causal explanation. | Hook/package/config checked in; no historical invocation/target record. |
| Manual SQL, restore, or unavailable initialization altered schema or ledger | **POSSIBLE**, **NOT PROVEN** | Technically feasible, no positive local event evidence. |
| A merge-time migration renumber, conflict resolution, rebase or squash caused absent rows | **REJECTED as a claim supported by accessible Git**, not globally impossible. | All 27 relevant merges inherit second-parent tree on inspected paths; no rename/renumber/conflict patch evidence. |
| Current Drizzle runner failed after committing earlier DDL but before ledger insertion | **REJECTED for this installed runner's ordinary transactional path**; historical event **NOT PROVEN**. | SQL and insert share a transaction. Other tools/old versions cannot be excluded from source alone. |
| Development ledger reset/replaced/bypassed historically | **NOT PROVEN** (possible but no event evidence). | No retained reset/replace log or earlier ledger snapshot. |
| The recorded `0004` hash identifies a known historical SQL version | **NOT PROVEN**. | Exact source not in accessible evidence. |

**No candidate mechanism is classified STRONGLY INDICATED as the historical cause.** Configuration and current state are independent facts, but without an execution record they do not discriminate a post-merge push from manual SQL or restore.

## 11. Required root-cause answers

1. **Why are `0005`–`0030` absent?** **NOT PROVEN.** The ledger lacks rows 6–31; no event-specific cause was found.
2. **Direct evidence those migration files executed against development?** **No.** Their objects may exist, but no runner transcript/ledger entries prove execution.
3. **Evidence they were executed through a non-migration path?** **NOT PROVEN.** A non-migration **schema push is configured**; there is no proof it ran for these changes. “Those migration files executed through push” would in any case be inaccurate: push synchronizes schema, it does not execute those journal files.
4. **Evidence of ledger reset, replacement or bypass?** **NOT PROVEN.** No prior ledger state/deletion log; a configured bypass-capable schema path is not proof of a historical bypass.
5. **Failed migration changed schema before ledger insertion?** **NOT PROVEN.** The current runner executes SQL/insert transactionally. The later Phase 11B clone failure at `0005` was not a historical development execution.
6. **What created the existing `0005` constraint?** **NOT PROVEN.** `0005` is its earliest reachable Git source; `0007`/`0008` could recreate it, and a schema push/manual SQL could generate an equivalent object. Current definition is known, creation event is not.
7. **What explains the `0004` hash?** **NOT PROVEN.** Recorded and current SHA-256 values differ; no matching historical SQL found in available evidence.
8. **Can the live development ledger safely be reconciled now?** **No: BLOCKED.** Missing provenance, intermediate dependency history and representative real-data-effect verification remain unresolved. No adoption or reconciliation was performed.

## 12. Remaining unknowns and recommended next step

Seek **authorized historical development-only** post-merge hook execution records, deployment/build logs with target identifiers (without production queries here), database DDL audit/restore records and earlier ledger/schema snapshots from a source that can independently establish *when* the tenant keys appeared and *whether* `drizzle-kit push`, the journaled runner, or another path ran. Obtain the exact old `0004` SQL if it exists outside accessible project evidence. Preserve provenance, timestamps, command and target identity; redact credentials and personal data. If unavailable, keep the cause **NOT PROVEN** and require independent review/risk acceptance plus representative anonymized-development-data validation before designing a separate development-only reconciliation. Do not convert this evidence-collection document into a ledger update.

### Verification and safety record

Non-destructive commands included `git log --all --full-history --merges`, `git diff` against both merge parents, `git show`, `git fsck`, `git log -S`, `rg`, file/hash comparisons and inspection of current runner/config sources. No application or migration file changed; existing Phase 11C results (574 API tests, 21 web tests, typecheck, both configured builds passed) remain applicable because this task changes documentation only. `git diff --check` was run. **Development database unchanged; migration ledger unchanged; migration files unchanged; production untouched and not queried; Publish/deploy not executed.**