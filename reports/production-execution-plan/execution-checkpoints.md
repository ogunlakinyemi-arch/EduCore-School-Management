# Mandatory read-only checkpoints

This file contains validation requirements only, not executable DDL, a Production runner, recovery SQL or rollout approval. All checks are READ-ONLY. Eight checkpoints: A, B1, B2, F, B3, B4, B5, FINAL.

## A — Before any Production schema change
- Operator conclusively identifies intended published runtime authoritative primary and database resource; known binding is UNVERIFIED. Do not repeat hidden runtime discovery. Stop if evidence unavailable.
- Confirm actual backup/PITR availability, protected resource, recoverable timestamps/retention, recovery ownership and demonstrated recovery evidence. Do not infer from defaults or generic platform claims; no restore/create/drop action here.
- Read current schema fingerprint, row-count/stable-value baselines for affected existing tables, sequence positions/ownership and journal/ledger identity. Compare cached planning baseline; unexplained change means stop/replan. Confirm all Production writes performed by planning/preflight = 0.
- Compare each of the 105 current hashes to migration-manifest.json; verify unchanged 0060 and 0149. Historical compiler hash discrepancy for three files is explained by validated correction, not permission to rebuild.
- Confirm the supported schema application route preserves these barriers. Managed Replit uses supported Publish schema synchronization, never a custom direct Production runner/startup hook; external databases require separately approved documented process. If order/guards cannot be preserved, STOP.
- Read-only reconcile actual execution ledger and file registrations. 105 forward files and 0060 are unregistered in saved journal evidence; six other historical registrations also lack mapping. Journal adoption/execution changes require separate approval; never infer applied migrations from filenames, bulk-stamp or replay old data migrations.
- Confirm approved maintenance/write-quiescence strategy and recovery owner before progression; do not enable it through this read-only planning activity.

## B1 — After structural prerequisites
- Verify sequence definitions without resetting them; verify typed table shells, exact columns/defaults/nullable contracts and OWNED BY links. Compare expected inventory plus documented baseline allowlist; no unexpected object.
- Existing-row counts/stable values unchanged except approved five new empty/default-deny fields; verify their exact values. Other nullable new fields stay NULL; unrelated populated required-column guards remain strict.
- Run 965 newly executable original checks from the map. Capture actual counts, NULL skips and violations; no passing assumption merely from object creation. Verify positions on the authoritative primary.
- Before B2, run duplicate/primary-null/unique-index data checks and verify exact eligible supports. Failure STOP; no deduplication/backfill.

## B2 — After uniqueness and indexes
- Verify all required primary/unique keys and eligible FK parent supports: correct ordered columns, uniqueness, validation, immediate/nonpartial/nonexpression eligibility as required; preserve existing PK/index ownership/bindings.
- Verify indexes valid/ready, expected methods/predicates/include columns/opclasses and no conflicting names. Compare affected row counts/digests and authoritative sequences; no unexpected changes.
- Read-only confirm the F0060 external prerequisite has either been legitimately applied completely or still needs separate authorization. Do not proceed to B3 until F passes.

## F — External unchanged-0060 prerequisite after B2, before B3
- Validate unchanged hash and legitimate ledger evidence plus complete equivalent Finance objects, not merely table existence. If missing, STOP for separately authorized supported handling; never execute it as part of this plan.
- Check required parent keys, original-school/student/session/term/subscription/Partner attribution ownership and Finance immutability/receipt protections using established contract evidence. No historical data reparenting or rewritten payment/receipt/commission history.
- Once prerequisite provision has been separately authorized/performed, read-only verify objects, preserved pre-existing Finance rows, keys, sequences/functions/triggers and execute 41 newly executable checks before dependent enforcement. This is future checkpoint work, not new Finance reconciliation now.

## B3 — After CHECK and FK enforcement
- Before each relevant constraint, run original newly executable data gate; zero violations required. Verify MATCH/actions/deferrability, exact child/parent ordered columns, qualified support keys, validation flags and retained bindings.
- Special 0149: exact approved obsolete fee_payments_method_check may be retired only by its existing guarded source after canonical CASH-allowing replacement is validated. Read-only verify no unknown method CHECK and no legacy CASH rejection remains afterward. No manual DROP or other CHECK retirement.
- Recheck row counts/stable data/Finance ownership; defaults do not synthesize delivery/receipt/NFC history. Any unexpected change STOP.

## B4 — After all functions, before any new trigger activation
- Verify every canonical body, signature, language, volatility/parallel/security/search-path settings and all table/column/function prerequisites, including admission_create_school_defaults → admission_default_portal_key.
- Verify runtime call dependencies even where PostgreSQL defers PL/pgSQL resolution; do not invoke mutation-capable functions in read-only validation. Keep writers quiesced; definitions may perform writes when later invoked.
- Confirm historical Finance/receipt and campus/device ownership protections remain exact. No inferred behavior solely from function counts.

## B5 — After triggers
- Verify target table, function signature/arguments, timing/events/level/WHEN expression, enabled state, deferrability and historical immutability behavior from trusted evidence. Do not insert/delete synthetic test rows in Production to test triggers.
- Verify expected object set, unaffected row counts/stable values, indexes/constraints and sequences. No unexpected data/history alteration.

## FINAL — All planned dependencies present
- Rerun the complete unchanged 1,890 specification suite with correct conditional applicability and verified authoritative primary access. Failed=0; prerequisite-blocked=0. Report warnings/NULL skips/not-applicable honestly; resolve authoritative sequence/cache certification before release.
- Verify semantic canonical coverage and counts from migration-manifest.json; known retained equivalent constraints/index aliases can explain prior raw counts (1437 constraints, 671 indexes), but any unreviewed difference stops.
- Verify complete Finance parent/ownership/immutability/receipt protections without reparenting, approved CASH retirement, exact five defaults, all owned sequences/positions, legitimate journal/ledger order and current file hashes. No journal stamping here.
- Verify application connectivity and approved nonmutating routes against the confirmed primary/resource. Do not use payments, sends or write journeys as read-only smoke tests.
- Confirm no unexpected data loss/value/row-count changes relative to A; record all permitted schema-only/default/nullability differences. Keep maintenance state until separately authorized release/resumption.

## Global STOP conditions
- Intended Production authoritative primary not conclusively established
- Confirmed backup/PITR recovery evidence unavailable
- Current file/hash differs from corrected validated manifest
- Unexpected schema object beyond reviewed baseline/retained-equivalence allowlist
- Expected prerequisite missing or semantically different
- Unexpected affected row-count/stable-data digest change
- Uniqueness, primary-null, CHECK or foreign-key data gate fails
- Sequence ownership/metadata/authoritative position differs unexpectedly
- Any migration error, including guarded preflight or lock timeout
- Any newly executable preflight fails
- Any destructive table/column/data/reset operation discovered
- Any unapproved data transformation
- Supported schema-application route cannot preserve reviewed dependency order/guards
- Journal/history reconciliation cannot prove legitimate execution without replay/bulk-stamping

A committed prior file is not undone by a later file failure. No automatic safe rollback exists; never invent inverse SQL or continue after an error.
