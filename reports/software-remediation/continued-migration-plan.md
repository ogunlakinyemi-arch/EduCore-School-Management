# Yetenia EduCore — current review-only migration plan

Date: 2026-10-13. **Review only. Not approved for execution or publishing.**

## Authority and preservation

The owner reconfirmed that all Production schools, students, parents and other records are test data. This is owner-provided context, not an independently verified database census. It authorizes planning around test data only: no deletions, resets, destructive repairs, Production migrations/schema pushes, publication, real payments or notifications.

No database was started or connected to by this remediation. The explicitly acknowledged disposable-parent-test configuration was absent, no local PostgreSQL process was found, and the optional database integration test skipped. These observations do not prove that no remote database exists; they establish that an already-approved disposable target was not clearly configured. Do not guess a target or reuse the application connection.

Physical NFC/GPS/device integration, vendor setup and device-dependent work are outside this plan.

## Current source evidence

The fresh offline export is `reports/software-remediation/generated/continued-schema-review.sql`; its accompanying `.graph.json` records source-file hashes, statement-set integrity evidence, dependencies and historical migration provenance. Both generated files are excluded from Git/deployment packaging.

- 179 tables; 422 CHECK constraints; 684 foreign keys; 1,227 statements.
- The dependency-aware exporter completed without application database credentials or SQL execution.
- Required source uniqueness remains unchanged:
  - `subscriptions_id_school_student_uq`: unique index on subscriptions `(id, school_id, student_id)`.
  - `school_partner_attributions_id_partner_uq`: unique index on school_partner_attributions `(id, partner_profile_id)`.
  - `parents_id_school_unique`: unique index on parents `(id, school_id)`.
  - `academic_terms_nfc_session_key`: unique constraint on academic_terms `(id, school_id, academic_session_id)`.
- Parent supporting keys precede dependent foreign keys in the audit ordering. Existing ownership is preserved; no index-to-constraint conversions or manufactured supporting keys were added.

This is a full-schema source export, **not an incremental upgrade of existing Production tables**. Static dependency checks do not establish PostgreSQL executability, compatibility with existing rows, backup recoverability or correctness of a fresh Publish preview.

## Tooling safety changes

The review Drizzle configuration no longer reads or requires DATABASE_URL and contains no database credentials. It supports ESM loading. Command policy allows only explicit offline `generate`, `export` and `check`; implicit, unknown and connected commands—including `pull` and `introspect`—are denied, as are mutation/studio commands and Production/deployment contexts.

Automated coverage includes importing the actual configuration with a DATABASE_URL getter that throws on any access. Package push/force-push commands and automatic post-merge pushing remain disabled.

When calling a package script through `pnpm --filter`, its working directory is the package directory. Pass a workspace-absolute audit output path. Missing or disallowed output arguments are rejected before export; no failed invocation executed SQL.

## Review stages — none authorizes execution

1. **Freeze the source snapshot.** Review source hashes, original-versus-reordered statement-set evidence, key eligibility, index ownership, logical/physical identifier collisions and historical provenance. Any changed source requires a new export.
2. **Establish an existing approved isolated target.** The owner must supply explicit disposable-target approval, permitted fixture scope and credential handling through the managed secrets flow. Do not start a new database, connect to the application target, or infer permission from a name or NODE_ENV.
3. **Only if separately authorized and clearly configured, validate there.** Compare raw and reordered export outcomes separately; inspect real PostgreSQL catalogs, FK supporting keys, CHECK domains, index/constraint ownership and representative synthetic cross-school authorization cases. Label each result by the exact input it tested. No Production access is included.
4. **Prepare an incremental plan only from approved baseline evidence.** An empty-database full export cannot prove an upgrade. Baseline catalog evidence and recovery/backup evidence require separate approval; neither was obtained here. Preserve financial and membership history. Treat retained legacy CHECKs as possible additional restrictions; do not silently drop them.
5. **Stop at review.** The user-reported Support guidance is to wait for the Publish planner fix, not bypass it with manual Production indexes or approval of a failing preview. A fresh incremental preview must independently show supporting keys before dependent FKs and required replacements of changed same-name CHECKs. No fresh preview was requested/generated here.

## Validation status and blockers

The schema/export, command-policy and filesystem-guard suites collectively passed **34 tests**. These are static/offline checks, not PostgreSQL validation.

**Blocked:** executable SQL validation; incremental target comparison; fresh Publish preview; verified backup/recovery; Development API target verification and an explicitly safe restart. No owner approval for these actions is implied by this document.
