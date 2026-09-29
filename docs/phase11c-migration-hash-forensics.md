# PHASE 11C — MIGRATION HASH FORENSICS

**Scope:** Read-only investigation of the development migration ledger, all 31 checked-in migration hashes, historical SQL evidence for ledger IDs 2 and 5, and the installed migration runner source. This hash analysis used the retained read-only Phase 11B extraction at `/tmp/p11b-live-ledger.txt`; a separate Phase 11C read-only development query independently confirmed the same five rows and ordered ledger digest (see the final report). No database writes, application changes, or production access were performed.

## Findings

- The repository journal contains **31 ordered migration entries**, indexed 0–30 and tagged `0000`–`0030`. Development's retained ledger extraction contains five rows, IDs 1–5, ordered by their recorded `created_at` values and corresponding to `0000`–`0004`.
- The five ledger timestamps exactly match their journal `when` values. Hashes match for IDs 1, 3, and 4; hashes differ for ID 2 (`0001`) and ID 5 (`0004`). Rows 6–31 do not exist in the development ledger snapshot.
- The recorded ID 2 hash is the SHA-256 of the exact older `0001_phase3_meta.sql` Git blob at commit `41e0595bc6dd64570f94b70952946c788a940bed`. That historical checked-in version was found; its SQL is not reconstructed.
- The recorded ID 5 hash does not match the current `0004_platform_operations.sql` or any `0004` SQL source found in the searched project evidence. **Historical source not found in available project evidence.**
- The source of the unrecorded later development schema/ledger divergence remains unproven. This report does not infer migration execution from current catalog objects.

## Hash algorithm and runner source

The installed packages are `drizzle-kit` **0.31.10** and `drizzle-orm` **0.45.2**. The runner implementation used by the Drizzle CLI is in:

- `node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/migrator.js`
- `node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/pg-core/dialect.js`

`readMigrationFiles` parses `meta/_journal.json`, reads each tagged `.sql` file as text, splits the SQL at `--> statement-breakpoint` to make executable statement chunks, and sets the migration hash to `crypto.createHash("sha256").update(query).digest("hex")` where `query` is the complete original file text. Accordingly, these hashes are SHA-256 over the exact checked-in SQL text (UTF-8), including the original statement-breakpoint delimiters and line endings as read. No SQL normalization, trimming, or semantic hashing is performed. The algorithm was independently reproduced against all 31 journal entries; generated hashes for current `0000`, `0002`, and `0003` also equal the development ledger values.

The PostgreSQL dialect source creates the migration table if absent, selects the latest ledger row by `created_at DESC`, and, inside `session.transaction`, iterates migrations in journal order. For each entry with `folderMillis` later than the latest recorded timestamp (or when no row exists), it executes each SQL chunk and inserts that migration's hash and journal timestamp **after** its SQL. The hash is stored but is not compared with prior rows when deciding which migrations to execute. Thus, a transaction failure prevents its ledger insert from committing; the source does not independently establish why this development ledger has only five rows. No application startup migration call was found in the inspected API entry point or database package entry point; the repository package exposes explicit Drizzle CLI commands.

## Development ledger and complete hash comparison

`Ledger hash` is the value recorded in development where a row exists. `— (absent)` means there is no development ledger row for that migration; the current SQL hash remains calculated from the checked-in file. Journal indexes are zero-based; ledger IDs are one-based and align with the journal order in this table. UTC is the exact conversion of the journal millisecond timestamp.

| Order / ledger ID | Migration file | Journal `when` (ms) | UTC timestamp | Development ledger hash | Current SQL SHA-256 | Comparison |
| ---: | --- | ---: | --- | --- | --- | --- |
| 1 | `0000_brainy_moon_knight.sql` | 1790124624275 | 2026-09-23 00:50:24.275 UTC | `fc460c22d41c952c0578c17cbba1cfe8dc838a0896c322fa03eae41066072ddd` | `fc460c22d41c952c0578c17cbba1cfe8dc838a0896c322fa03eae41066072ddd` | MATCH |
| 2 | `0001_phase3_meta.sql` | 1790129202026 | 2026-09-23 02:06:42.026 UTC | `f198518b395d52dc374249d73780eb28acf1c4f404c1cdb70ec27663049671c9` | `0a329af11216e5f86f7569dad85008a115c497d4e827a2e2adfc5316f62b9244` | DIFFERENT; historical SQL found in Git |
| 3 | `0002_overjoyed_sue_storm.sql` | 1790145697311 | 2026-09-23 06:41:37.311 UTC | `8a3a486f871f991ab59ac982ae6be92934a8f6d4b861c8222be43eea5878c736` | `8a3a486f871f991ab59ac982ae6be92934a8f6d4b861c8222be43eea5878c736` | MATCH |
| 4 | `0003_phase4_integrity.sql` | 1790157200000 | 2026-09-23 09:53:20.000 UTC | `9223f5d27a334bd967dfe37dcff518b3800eff1a68523f81defc8ca52ae7c575` | `9223f5d27a334bd967dfe37dcff518b3800eff1a68523f81defc8ca52ae7c575` | MATCH |
| 5 | `0004_platform_operations.sql` | 1790161200000 | 2026-09-23 11:00:00.000 UTC | `eda974665826aa4d5affc07f24f658122ac81502a7190313f0edcd99d24206ba` | `02d011d931579f8177b2a71794a39bea78f23214da41c3606a3375ab1e3505ca` | DIFFERENT; historical source not found |
| 6 | `0005_tenant_reference_keys.sql` | 1790164000000 | 2026-09-23 11:46:40.000 UTC | — (absent) | `2c39b162401de93ce6cfe26fe5a558966080124575876e4097e9bf5044b1c519` | NO LEDGER ROW |
| 7 | `0006_prepare_tenant_keys_publish.sql` | 1790164600000 | 2026-09-23 11:56:40.000 UTC | — (absent) | `01239ad0d094f235d29a8a91d6e48a31fc5978f065d9e0fee0a466540f2f81ef` | NO LEDGER ROW |
| 8 | `0007_restore_tenant_foreign_keys.sql` | 1790165200000 | 2026-09-23 12:06:40.000 UTC | — (absent) | `be779627cfc9593c61f5f2e9f53813999905e134a10f9b4a54885ef70301ade7` | NO LEDGER ROW |
| 9 | `0008_align_tenant_fk_dependencies.sql` | 1790166000000 | 2026-09-23 12:20:00.000 UTC | — (absent) | `83132c038eb08c2a45ca0a9805750217237e879469b62ca967a160b55a88694a` | NO LEDGER ROW |
| 10 | `0009_phase5_attendance.sql` | 1790192000000 | 2026-09-23 19:33:20.000 UTC | — (absent) | `d306734f09b1f51a56c4ae88113d2c2b3de89e3eff8f6bb20bbedaac6715fc1e` | NO LEDGER ROW |
| 11 | `0010_historical_device_school_bindings.sql` | 1790193000000 | 2026-09-23 19:50:00.000 UTC | — (absent) | `b694b7b224ca23979c9f156288c95908303044a264f13b5d687b4b279f0a05fe` | NO LEDGER ROW |
| 12 | `0011_historical_device_references.sql` | 1790194000000 | 2026-09-23 20:06:40.000 UTC | — (absent) | `8b961ad5af8609c8247942174f178cb8af2a3ab9b9b31c9b881a7bb4282118c9` | NO LEDGER ROW |
| 13 | `0012_phase6_academic_operations.sql` | 1790195000000 | 2026-09-23 20:23:20.000 UTC | — (absent) | `2e9c588ca170fbd3a24c8b03bb5466cc603bc4fae140659d15bb8824587f7c46` | NO LEDGER ROW |
| 14 | `0013_phase7_finance.sql` | 1790632156536 | 2026-09-28 21:49:16.536 UTC | — (absent) | `d686ff04220a346caf6a611e0fe0652a87eaa8db3fbb91595cdc7dbc09105074` | NO LEDGER ROW |
| 15 | `0014_finance_payment_integrity.sql` | 1790632157536 | 2026-09-28 21:49:17.536 UTC | — (absent) | `a22416cbd66528978d57e9842a9836d17a263c6bccca0f4db4b7806f765a3360` | NO LEDGER ROW |
| 16 | `0015_school_bank_transfer_settings.sql` | 1790632158536 | 2026-09-28 21:49:18.536 UTC | — (absent) | `261a4df3195bd36ecaf7597427ff883ebec7198374b7fa299a5f2a6050402182` | NO LEDGER ROW |
| 17 | `0016_finance_refunds.sql` | 1790632159536 | 2026-09-28 21:49:19.536 UTC | — (absent) | `e4312cda8c57e7fc489562cf64c5f7005e0ce09d2e1efa7e561aa674a67c4b8f` | NO LEDGER ROW |
| 18 | `0017_fee_provider_payments.sql` | 1790632160536 | 2026-09-28 21:49:20.536 UTC | — (absent) | `ca8a921ecc355f9fd748649dadbfe775dbd898195564c76138b3035ad53f6f0a` | NO LEDGER ROW |
| 19 | `0018_fee_payment_notifications.sql` | 1790632161536 | 2026-09-28 21:49:21.536 UTC | — (absent) | `e9bffbf45dbd225d96935cc8b52185d181e8efe74d11c33fd44f46bbfbc8be70` | NO LEDGER ROW |
| 20 | `0019_phase7_finance_ledger_gaps.sql` | 1790632162536 | 2026-09-28 21:49:22.536 UTC | — (absent) | `84886bbea635b7d96acdfc5ae6f62542b3e7355d3106ad93af2738c05bb147d5` | NO LEDGER ROW |
| 21 | `0020_finance_payment_notification_events.sql` | 1790632163536 | 2026-09-28 21:49:23.536 UTC | — (absent) | `c1f8c7067ac3544e4d2c34e504519e351992aefe339b94d8da64d0c6a76a11da` | NO LEDGER ROW |
| 22 | `0021_fee_payment_notification_outbox.sql` | 1790632164536 | 2026-09-28 21:49:24.536 UTC | — (absent) | `73cb3dd56096c6296e78bcd503eade9635bebfc20e8403d42bfb126b4cfae782` | NO LEDGER ROW |
| 23 | `0022_payment_bound_notification_events.sql` | 1790632165536 | 2026-09-28 21:49:25.536 UTC | — (absent) | `3d5c3805a2f79e7caf569f312bbfcf8fef3a91528d06f5fc70c0db36de0e9929` | NO LEDGER ROW |
| 24 | `0023_invoice_generated_notifications.sql` | 1790632166536 | 2026-09-28 21:49:26.536 UTC | — (absent) | `80ca309338cdf5d0c3432d2f97373588b9b5898ffdb4adfc1926400bc946fc68` | NO LEDGER ROW |
| 25 | `0024_platform_company_employees.sql` | 1790632167536 | 2026-09-28 21:49:27.536 UTC | — (absent) | `f109415673a0674545ed975b50e7fc8337d3a9939ae99eecb81c4b262e986112` | NO LEDGER ROW |
| 26 | `0025_communication.sql` | 1790632168536 | 2026-09-28 21:49:28.536 UTC | — (absent) | `e36a4208543a4c2b3e4739cac1449d5b15f1bb8ac53a4d569cc26a50eb815f3a` | NO LEDGER ROW |
| 27 | `0026_communication_entitlements.sql` | 1790632169536 | 2026-09-28 21:49:29.536 UTC | — (absent) | `3a849acf174da8dc8e6f9b6203b6bbeec6a56dc0cdc12367fb7aeed6dd103ab2` | NO LEDGER ROW |
| 28 | `0027_library.sql` | 1790632170536 | 2026-09-28 21:49:30.536 UTC | — (absent) | `a8a0f53180682650cbec0858eaaa7c964194527975dc87ed6df60261623a455a` | NO LEDGER ROW |
| 29 | `0028_school_operations.sql` | 1790632171536 | 2026-09-28 21:49:31.536 UTC | — (absent) | `e705cc814866afd041f7e92264b3eb6c35dd931359d455cb485b3c1560916190` | NO LEDGER ROW |
| 30 | `0029_operations_history.sql` | 1790632172536 | 2026-09-28 21:49:32.536 UTC | — (absent) | `3a0a63d2807a67ea514502083cb7f26f6c8d7a2fc0c2da6739e6b375a587ac87` | NO LEDGER ROW |
| 31 | `0030_library_loan_copy_integrity.sql` | 1790632173536 | 2026-09-28 21:49:33.536 UTC | — (absent) | `eea163be06c078cfbf057e0ccc3669397e14562d42329bb93056c5e1a04da9d2` | NO LEDGER ROW |

## Historical SQL investigation

### Ledger ID 2 — migration `0001_phase3_meta.sql`

**Exact source found:** Git commit `41e0595bc6dd64570f94b70952946c788a940bed` (`2026-09-23 02:10:52 +0000`, “Update edupulse routes and clean up memory documentation”), path `lib/db/drizzle/0001_phase3_meta.sql`, Git blob `cc90d6e`. SHA-256 of that blob's SQL text is exactly `f198518b395d52dc374249d73780eb28acf1c4f404c1cdb70ec27663049671c9`, the recorded development hash.

The same historical blob is reachable at commit `a9cd60c28ab2f814ed6e197654b3d6cdf4a1d0a0` as well (a merge commit with that parent version); both commits resolve to Git blob `cc90d6e87902f447d221db04cc758d4ed5f1bf84` and the same SQL hash. The subsequent commit `2c5f018b63c330e0c89bc5083a9480c744b4822b` (`2026-09-23 11:00:25 +0000`, “Refactor authentication logic and update application routes and components”) changed this SQL. The diff is **six unique composite indexes moved earlier in the file**, from after the FK/index section to immediately after the student columns and before the foreign-key declarations:

- `academic_sessions_id_school_unique`
- `academic_terms_id_school_unique`
- `employees_id_school_unique`
- `school_classes_id_school_unique`
- `students_id_school_unique`
- `subjects_id_school_unique`

The six definitions are not added or removed overall; their ordering changes. The exact older SQL's SHA-256 matches the ledger value; current SQL is `0a329af11216e5f86f7569dad85008a115c497d4e827a2e2adfc5316f62b9244`. This proves the text existed as a checked-in historical version and is consistent with the recorded hash. It does **not** prove which SQL was executed against development, the reason for the later reorder, or who executed it.

### Ledger ID 5 — migration `0004_platform_operations.sql`

Recorded hash: `eda974665826aa4d5affc07f24f658122ac81502a7190313f0edcd99d24206ba`. Current checked-in SQL hash: `02d011d931579f8177b2a71794a39bea78f23214da41c3606a3375ab1e3505ca`.

Searches covered current and historical SQL paths, all reachable commit history and reflog-visible revisions, every Git object blob (1,716 blobs in the available object database), refs, unreachable objects, local migration/backup-named files, local SQL/archive files outside `node_modules`, `/tmp` Phase 11 migration evidence, and project files likely to contain migration references. The `0004` path first appears in reachable history as a new file at commit `2c5f018b63c330e0c89bc5083a9480c744b4822b` (`2026-09-23 11:00:25 +0000`), 25 seconds after the row's recorded timestamp; this timing alone does not establish when, where, or which SQL was executed. No earlier `0004` SQL blob, alternate `0004` file, or blob with the recorded SHA-256 was found. There are no tags; refs examined include `refs/heads/main`, `refs/heads/replit-agent`, `refs/remotes/gitsafe-backup/main`, and `refs/replit/agent-ledger`; `git fsck --full --unreachable` reported no unreachable objects.

Five PostgreSQL custom-format dump files were also inspected read-only: `/tmp/p11-dev-schema.dump`, `/tmp/p11-disposable-backup.dump`, `/tmp/p11b-live-schema.dump`, `/tmp/p11b-pre-adoption-full.dump`, and `/tmp/p11b-post-adoption-full.dump`. The pre/post-adoption and disposable full dumps contain the ledger hash as table data; the development snapshots expose the migration table schema. PostgreSQL dumps are catalog/data exports, not stored migration files: no source SQL version matching the recorded `0004` hash was present in the dump outputs. A filesystem search over non-Git, non-`node_modules` project files for the exact recorded hash also found no matching file. These backup records corroborate the ledger value but do not supply historical migration SQL.

**Historical source not found in available project evidence.** The mismatching hash is recorded and preserved here as evidence only. No SQL was reconstructed or brute-forced to match it.

## Evidence boundary

The five-row values above come from the retained Phase 11B read-only development ledger extraction (`/tmp/p11b-live-ledger.txt`); the Phase 11B disposable-adoption audit independently records five original rows and mismatch IDs 2 and 5, and its preflight preserved the originals. The clean replay's 31-row ledger (`/tmp/p11b-clean-ledger.txt`) agrees with the current-file hashes and journal timestamps for all entries. These temporary files are local audit evidence, not a durable database record.

The hash-source investigation itself did not query a live database; the companion Phase 11C report records the separate read-only development verification. No development schema or ledger was modified; no production query or modification occurred; Publish was not executed. Hash calculations and Git/local-file searches were read-only. The search cannot rule out historical sources outside accessible project evidence.