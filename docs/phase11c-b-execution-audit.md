# Phase 11C-B — Post-Merge Execution & Database Audit Evidence

**Yemait EduCore · 29 September 2026 · evidence collection only**
**Historical Execution Status: EXECUTION NOT PROVEN. Ledger Reconciliation: BLOCKED.**

## 1. Executive summary

The configured post-merge path leads to `drizzle-kit push`, which can synchronize the TypeScript schema without running journaled SQL or recording migration-ledger entries. The installed implementation supports that **architectural possibility**. Neither accessible Git history, project-local logs, checked-in schema metadata nor the retained database dumps provides an execution record linking a post-merge push (or any other operation) to the later development objects and five-row ledger. **No retained execution record found.**

The current-state evidence remains as documented in [Phase 11C](phase11c-migration-forensics-report.md): the repository journal contains `0000`–`0030`; development's independently identified read-only ledger inspection found IDs 1–5 only. Objects expected of later migrations exist, but this does not establish how or when they arrived. This Phase 11C-B investigation did not query any database. **The bypass mechanism is technically plausible but historical execution is not proven.**

## 2. Drizzle push configuration history and target limits

| Date/commit (UTC) | File(s) / change | What it establishes |
| --- | --- | --- |
| 2026-09-11 01:39:27 · `0c05d76b9e518521a819bcdca13cfdf07cc61818` | Initial `.replit` contains `[postMerge] path = "scripts/post-merge.sh"`; initial `scripts/post-merge.sh`, `lib/db/package.json`, `lib/db/drizzle.config.ts` supply the schema-push path. | First reachable configuration in this repository, **not a hook execution**. |
| 2026-09-22 07:24:12 · `ce48ccd9d7943c6b2247a259a4b16455b0aa55a4` | `.replit` gains a PostgreSQL module setting. | Configuration change, not evidence of database creation, push, or target. |
| 2026-09-23 02:10:52 · `41e0595bc6dd64570f94b70952946c788a940bed` | `.replit` module setting changes along with migration source. | Post-merge hook path remains; no invocation shown. |
| 2026-09-23 11:11:38 · `d62da4c8874355b86302845091421f8167af286f` | `.replit` module/configuration update. | No change to hook path or proof it ran. |
| 2026-09-28 23:32:40 · `f759d300257af04994887a633067b5e973810380` | `.replit` configuration update alongside Finance work. | No push-strategy or hook-path change established. |

The checked-in command chain is **`.replit` → `scripts/post-merge.sh` → `pnpm --filter db push` → `@workspace/db`'s `drizzle-kit push --config ./drizzle.config.ts`**. The script also runs a frozen install before push. `lib/db/drizzle.config.ts` requires `DATABASE_URL`, passes it as the Drizzle connection URL, and points at the TypeScript schema. There is a separate `push-force` package script; the post-merge script calls ordinary `push`, not `push-force`. The hook/command path was not removed or replaced in accessible Git history.

**Target/environment:** The code does not hardcode a development hostname or database. It acts on whichever database a process's `DATABASE_URL` reaches. It **could** execute against development in a development post-merge context, but configuration alone does not establish which environment invoked it, whether it invoked at all, or which database its historical URL reached. A Replit documentation search did not supply an execution record or an authoritative guarantee for this project-specific `[postMerge]` hook. Shell environment labels are not reliable database-target proof in this workspace; the earlier Phase 11C database inspection independently identified development before making read-only claims. This task neither read URL values nor connected to a database.

## 3. Execution-evidence search

Read-only searches covered accessible repository/Git history, scripts and CI/deployment/Replit configuration, generated artifacts, attached project documentation, available workspace and `/tmp` logs, and safely identifiable shell-history locations. Searches included `drizzle-kit push`, `drizzle-kit`, `postMerge`, schema synchronization, migration commands, `school_classes_id_school_tenant_key`, and later migration identifiers. The only shell-history locations inspected contained no usable historical command records; no credential or command-history content was displayed.

**No retained execution record found.** Specifically, no historical hook invocation/output, `drizzle-kit push` transcript, journaled migration-runner transcript against development, command with verified development target, or actor/time/result combination was found. `/tmp/logs` at inspection held recent 29 September development workflow/browser logs, not historical post-merge/deployment output; no deployment log was retained there. Local `p11*` migration logs record **Phase 11B disposable** clean replays, duplicate-`0005` errors on schema clones, or adoption rehearsals—not the historical development operation. Git commits and “Published your App” titles describe repository activity, not a PostgreSQL execution event. See the [Phase 11C-A merge inventory](phase11c-a-historical-evidence.md#3-merge-history--all-matching-databasemigrationconfiguration-paths): 27 relevant merges inherited the second parent's changes on inspected paths; none supplied a merge-resolution database log.

This absence is bounded by available local evidence; external service/task logs, earlier ephemeral shells and unavailable provider audit retention cannot be ruled out.

## 4. Database audit evidence

No retained PostgreSQL statement/DDL/audit log, independently dated object-creation record, historical restore/clone log, ledger deletion record, or Replit database-operation record was found in the inspected project-local material. Current source files and Phase 11B/11C reports name the constraint and objects, but they are **not** database audit trails. The current catalog and dumps establish final object definitions; PostgreSQL catalog objects do not carry a reliable historical migration-file identity or the transient sequence of drops/recreates.

The five local custom-format `pg_dump` archives listed below have 29 September file modification times and were made for Phase 11/11B investigations. `pg_restore -l` and schema-only extraction were used **offline**, not to restore or query a database. Archive modification times date the **evidence files**, not creation of their database objects. A full dump may include ledger table rows at the time of that investigation, but it still cannot identify the historical command that created the other schema objects.

## 5. Historical schema snapshots and local dumps

There is **no located pre-`0005` live database dump paired with a contemporaneous ledger**, and no earlier live snapshot showing the 0005 key or a later object before the five-row ledger state. The only checked-in Drizzle metadata snapshots end at `0002`. They describe **intended source schema**, not a read of development:

| Artifact | Source date / local file time | Later-object and ledger visibility | Historical inference |
| --- | --- | --- | --- |
| `lib/db/drizzle/meta/0000_snapshot.json` | Journal timestamp 2026-09-23 00:50:24 UTC; Git lineage `7709c84` / merge `dcb9b8e` | Early source schema only; no 0005 key or later representative objects; no live ledger rows. | Cannot establish database state on that date. |
| `lib/db/drizzle/meta/0001_snapshot.json` | Journal timestamp 2026-09-23 02:06:42 UTC; `41e0595` / `a9cd60c` | Early academic source schema and differently named composite unique indexes; no 0005 tenant key or 0010+ feature objects; no ledger rows. | Cannot establish whether the source was executed. |
| `lib/db/drizzle/meta/0002_snapshot.json` | Journal timestamp 2026-09-23 06:41:37 UTC; `116f14c` / `fef58b2` | Early source schema, not 0005/0010/0015/0020/0025/0030 final objects; no ledger rows. | Cannot date the later development schema. |
| `lib/db/drizzle/meta/_journal.json` | Through `0030`, last source update 29 September | Ordered migration tags/timestamps, not a database snapshot or ledger. | Source inventory only. |
| `/tmp/p11-dev-schema.dump`, `/tmp/p11b-live-schema.dump` | 2026-09-29 11:10:22 and 11:27:52 UTC local mtimes | **Schema-only** development-derived archives: final tables, indexes, constraints, functions/triggers and `drizzle.__drizzle_migrations` table **definition**, but **no table data/ledger rows**. The 0005 named constraint and later-family tables are present in the final-state schema. | Confirm current-ish object presence, not origin, date or contemporaneous ledger state. |
| `/tmp/p11-disposable-backup.dump` | 2026-09-29 11:10:57 UTC local mtime | Full **disposable** rehearsal archive with later objects and ledger table data. | Not an earlier live-development backup or historical execution trace. |
| `/tmp/p11b-pre-adoption-full.dump` | 2026-09-29 11:29:41 UTC local mtime | Full disposable clone: later schema with the **original five copied ledger rows**. | A constructed clone of the observed mismatch, not proof the original schema was made by any particular mechanism. |
| `/tmp/p11b-post-adoption-full.dump` | 2026-09-29 11:37:08 UTC local mtime | Full disposable post-rehearsal clone: later schema plus adopted rows 6–31, explicitly **verified adoption, not originally executed**. | Cannot backdate adoption or establish development execution. |

The dumps are temporary evidence files, not durable recovery backups. The schema-only archives cannot answer whether the ledger had five rows at the moment the objects first appeared; the full clone archives are synthetic. No additional project-local `schema.sql`, earlier full database export, or PostgreSQL backup metadata proving a historical restore was found. No archive was restored.

## 6. Representative object provenance

The checked-in SQL and TypeScript schema describe compatible later **final states**; the 29 September schema-only dumps and prior Phase 11B object comparison corroborate the presence of representative later families in development. None is a dated audit record for its creation. Detailed per-migration effects are in [the Phase 11C schema analysis](phase11c-schema-vs-migration-analysis.md#per-migration-expected-vs-observed-final-effects).

| Source migration | Representative expected change | What the evidence establishes; what it cannot |
| --- | --- | --- |
| `0005` | Six `(id,school_id)` named tenant UNIQUE constraints; `school_classes_id_school_tenant_key` first appears in reachable Git at `8320e62` (23 Sep 11:44:22 UTC). | Validated key with expected definition exists in development; checked-in TS schema also declares it. Earlier `0001`/`0004` use a different index name. `0007`/`0008` can recreate/rebind this named key. **Creator/date/method NOT PROVEN.** |
| `0006` | Transiently drops four composite tenant FKs before later rebinding. | No lasting unique object attributable to `0006`; a final schema snapshot cannot reveal whether the drop ran. |
| `0010` | Device-school binding table/index, historical-pair backfill, append-only function/triggers and attendance FK rebinding. | Table and protections appear in later development final-state evidence; checked-in TS schema defines related objects. Neither a final table nor a disposable-fixture backfill proves historical development SQL/data transformation. |
| `0015` | Bank-transfer fields and validation CHECK on school fee settings. | Final columns/constraint correspond to checked-in SQL/schema. No pre/post object snapshot dates their database addition. |
| `0020` | Payment notification `event_reference_id`, changed checks and delivery uniqueness. | Final event fields/rules correspond to checked-in SQL/schema; changed/transient constraint history is not recoverable from the final catalog. |
| `0025` | Communication notifications, deliveries, preferences, templates, campaigns, recipients and push devices. | Final-family objects and TS declarations exist. An identical table could be produced by push, SQL, migration runner or restore. |
| `0030` | Composite library loan-copy FK and `(id,school_id)` library-copy uniqueness. | Final protection corresponds to checked-in SQL/schema; no earlier development snapshot captures the before-state or operation. |

Source introduction dates from the [Phase 11C-A Git timeline](phase11c-a-historical-evidence.md#9-chronological-evidence-timeline) are **not** PostgreSQL creation timestamps. No source establishes that `0005`–`0030` ran as journaled migrations.

## 7. Migration runner versus Drizzle schema push

| Behavior | Installed journaled PostgreSQL runner (`drizzle-orm` 0.45.2) | Installed `drizzle-kit push` (0.31.10) |
| --- | --- | --- |
| Source | Reads `meta/_journal.json` and each tagged migration SQL file; hashes original file bytes with SHA-256. | Reads the configured **TypeScript schema**, introspects the target catalog and computes/apply a schema diff; does **not** execute the tagged SQL files. |
| Ledger | Checks last `drizzle.__drizzle_migrations.created_at`; executes later SQL chunks and inserts each corresponding hash/timestamp **after SQL in the same transaction**. | Inspected bundled push path neither reads the journal nor invokes the ORM migrator or inserts journal migration rows. It therefore does not advance the journal ledger. |
| `0005` key | Would run unguarded `ADD CONSTRAINT school_classes_id_school_tenant_key`; on the Phase 11B clone with five copied rows it hit an already-existing object and rolled back. | If its target schema lacked the declared key, a generated schema diff could add an **equivalent** named UNIQUE constraint; this does not mean it ran `0005` or used its hash. |
| Later objects | Could create the SQL's objects and data effects in migration order if run successfully. | Could create/synchronize many objects declared in the TS schema **without** the migration-file backfills or intermediate DDL sequence. Not every file's transient/data effect can be inferred from final schema. |

Evidence: installed `drizzle-orm` `migrator.js` (file reading/hashing) and `pg-core/dialect.js` (transactional SQL and ledger insert), installed bundled `drizzle-kit` `bin.cjs` push implementation, plus the checked-in config/schema. This is source-code analysis; **neither command was run** in this task. In particular, a push could plausibly explain final objects with five ledger rows, including the `0005`-named key, but cannot by itself prove historical data backfills from `0010`/`0011`/`0014`, or the exact drop/rebind sequence of `0006`–`0008`.

## 8. Restore/clone investigation

No checked-in historical restore/clone command, earlier backup provenance showing the current schema plus a contemporaneously shorter ledger, cross-environment copy record or database audit event was found. Phase 11B's backup/restore and cloned-database artifacts were explicitly **disposable rehearsals performed after the mismatch was observed**; they cannot explain how the persistent development database originally reached its state. The configured deployment/build files do not supply a restore step. An unrecorded external restore or manual SQL remains possible; neither is supported by a retained event record. No restore, clone, or backup write occurred in Phase 11C-B.

## 9. Competing explanations

These classifications concern the **historical cause**, not whether a command exists or an object currently exists:

| Hypothesis | Classification | Supporting facts and limits |
| --- | --- | --- |
| **A. Post-merge `drizzle-kit push`** | **POSSIBLE** | Confirmed configured command and ledger-bypassing capability. **No invocation, target, output, before/after snapshot or audit record** links it to the mismatch; not strongly indicated as historical cause. |
| **B. Restore/clone from another database state** | **POSSIBLE** | Could copy schema and a short ledger together, but no historical source backup, restore/clone command, date or target was found. Phase 11B clones are later experiments. |
| **C. Failed migration committed DDL but not ledger entry** | **REJECTED for the inspected ordinary Drizzle runner path; NOT ENOUGH EVIDENCE for any historical alternate path.** | Installed runner executes SQL and insert in one PostgreSQL transaction. Phase 11B's `0005` failure on a clone cannot explain creation of the object beforehand. Historical external tooling/version is unverified. |
| **D. Manual SQL outside the runner** | **POSSIBLE** | Would not automatically add journal rows. No independently attributable manual SQL command or DDL audit entry found. |
| **E. Historical migration rewrite/rebase** | **CONFIRMED for changed `0001` *text*, not as cause of 26 missing rows; otherwise NOT ENOUGH EVIDENCE.** | Exact older `0001` blob matches ledger ID 2; `0004` recorded hash differs but source is missing. Relevant merges inherit second-parent migration files; no migration renumber, rename, conflict rewrite or squash explaining missing rows found. |
| **F. Other bootstrap/synchronization mechanism** | **NOT ENOUGH EVIDENCE** | No checked-in API startup migrator or separate SQL bootstrap path identified; unavailable external/manual paths cannot be excluded. |

No hypothesis is **CONFIRMED** or **STRONGLY INDICATED** as the cause of the development ledger discrepancy. The narrower claim “the `0001` file's text changed after an older matching blob existed” **is** confirmed, but does not identify the cause of missing entries.

## 10. Updated evidence timeline

The **ledger state at each historic Git commit is UNVERIFIED**. A timestamp on a source file, journal entry, merge, or later-created archive must not be recast as a database execution timestamp.

| Date (UTC) | Event | Evidence | Schema effect at the time | Ledger effect at the time | Confidence |
| --- | --- | --- | --- | --- | --- |
| 11 Sep · `0c05d76` | Post-merge hook and `push` command in initial repo | Git config/scripts | **UNVERIFIED**; capability introduced in source | **UNVERIFIED** | **CONFIRMED** source, not execution |
| 22 Sep · `ce48ccd` | `.replit` adds PostgreSQL module setting | Git diff | **UNVERIFIED** | **UNVERIFIED** | **CONFIRMED** config only |
| 23 Sep 01:21–11:00 · `7709c84` through `2c5f018` | `0000`–`0004` source/journal introduced; `0001` reordered | Git SQL and merges | **UNVERIFIED** | **UNVERIFIED**; five rows observed only later | **CONFIRMED** source chronology |
| 23 Sep 11:44 · `8320e62`, merge `06238fb` | `0005` named keys first enter reachable Git | SQL/schema commit | Creation of development key **UNVERIFIED** | **UNVERIFIED** | **CONFIRMED** Git source, not DB event |
| 23–24 Sep · relevant feature merges | `0006`–`0012` source/journal introduced | Git history; Phase 11C-A inventory | **UNVERIFIED**; later final state exists | **UNVERIFIED** | **CONFIRMED** source chronology |
| 28–29 Sep · `6093d97` through `d78f71b` | `0013`–`0030` introduced/merged | Git history | **UNVERIFIED**; later final state exists | **UNVERIFIED** | **CONFIRMED** source chronology |
| 29 Sep 11:10–11:37 · `/tmp/p11*` files | Schema-only development-derived dumps, disposable full clones/rehearsal | File mtimes; offline archive TOCs | Final-family objects in dumps; clone state is constructed | Schema dumps contain **no rows**; disposable clones include copied/adopted rows | **CONFIRMED** investigation artifacts only |
| 29 Sep · Phase 11B/11C reads | Development ledger/catalog independently inspected | Retained read-only report/hash comparisons | Final schema broadly matches later families | **Five rows (IDs 1–5) observed**; IDs 6–31 absent | **CONFIRMED** read-only observation, not mechanism |

There is **no verified date** when push ran, a historical restore occurred, `0005` was created in development, or the ledger became short.

## 11. Remaining unknowns and impact on reconciliation

- Whether/when/where a post-merge command ran, and which database its runtime `DATABASE_URL` targeted.
- An independently attributable PostgreSQL DDL/audit or earlier **paired schema-and-ledger snapshot** showing when the 0005 key and later objects appeared.
- Whether the ledger was ever reset, replaced, bypassed, or manually edited; no earlier live ledger image was found.
- The old SQL whose SHA-256 equals development ledger ID 5 (`0004`), and whether historical backfills/transient constraints were applied to real development data.
- Any historical restore/clone/manual SQL record or externally retained build/post-merge execution output.

**Ledger Reconciliation: BLOCKED.** Final-object equivalence and a configured bypass-capable command are insufficient to adopt rows 6–31. No development adoption, repair or production release is authorized by this report.

## 12. Recommended next evidence step and safety record

Obtain an authorized, **development-targeted** history of post-merge task invocations (command, time, result and verified database identity), database DDL/audit/restore events if retained, and the earliest available paired schema/ledger backup. Ask for any archived historical `0004` SQL independently of the current file. Compare evidence chronologically with the existing immutable [Phase 11C inventory](phase11c-migration-inventory.md) and [Phase 11C-A merge history](phase11c-a-historical-evidence.md); do not infer execution from Git source dates. If these records cannot be obtained, preserve **EXECUTION NOT PROVEN / BLOCKED** and seek a separately approved risk/equivalence review on a disposable anonymized development-data copy before proposing any live procedure.

Checks were limited to read-only Git/config/source inspection, local archive metadata/schema-only inspection (`pg_restore -l` / `--schema-only`), safe log/path searches and document consistency. The previously passed Phase 11C API/web tests, typecheck and builds were not rerun: this phase changes documentation only. **Development database unchanged; migration ledger unchanged; migration files unchanged; production not queried and unchanged; Publish not executed; no schema push executed; no migration executed.**