# Production test-tenant reset: preflight only

**This preflight command has no destructive execution path.** It opens no database connections,
imports no application pool, reads no environment credentials, invokes no provider
or auth API, and never publishes. It does not run at application startup/build.

The project exposes a Production read-replica SQL tool, not a trusted writable-
primary binding/backup verification API. Existing backup tooling is explicitly
Development-only. Consequently this implementation stops at the requested safe
fallback: offline dry-run/preflight. Neither an operator JSON file, a claimed
`verified:true`, nor a confirmation token can unlock deletion. `--execute` is
recognized only to reject it, before even reading evidence.

A separate controlled operator executor is documented in [CLEANUP.md](CLEANUP.md).
It does not unlock this command's `--execute`. Its Owner-attestation mechanism is
distinct from API certification and requires fresh primary, backup/restore,
maintenance and retention evidence plus a reviewed preview and exact token.
Implementing it does not authorize a Production connection or execution.
Preserve-in-place retention is resolved in [RETENTION.md](RETENTION.md), with
per-constraint blockers included in both reports. [REHEARSAL.md](REHEARSAL.md)
provides exact future isolated commands; only offline tests are authorized now.

## Commands

From the workspace root, replace the illustrative school IDs with an explicitly
approved test-school allowlist; there is no `all`, automatic test detection,
environment-based target inference, URL flag, force option or retained-data override.

```sh
# Offline plan only, zero connections. Exit 2 means BLOCKED, not release-ready.
pnpm --filter @workspace/scripts run production-reset:preflight --school-ids 9

# An explicit package-manager separator is also supported:
pnpm --filter @workspace/scripts run production-reset:preflight -- --school-ids 1,2 --dry-run

# Print a single read-only SELECT for later independent operator review.
# This prints SQL; it DOES NOT execute it.
pnpm --filter @workspace/scripts run production-reset:preflight --school-ids 9 --print-sql

# Analyze the JSON value returned by that SELECT, not a CSV wrapper.
# Evidence is sensitive: private 0600 file, owned by the operator, outside Git.
pnpm --filter @workspace/scripts run production-reset:preflight \
  --school-ids 9 --evidence-file /private/preflight.json

# Offline before/after observations only; does not certify a reset or sign-in.
pnpm --filter @workspace/scripts run production-reset:preflight \
  --school-ids 9 --evidence-file /private/before.json --compare-with /private/after.json

# Credential-free unit/CLI tests, no PostgreSQL or external services:
pnpm --filter @workspace/scripts run test:production-reset
```

Blocked dry-run reports return exit 2 intentionally so CI/shell automation cannot
mistake them for permission to proceed. Help and SQL printing return 0. Malformed,
stale (>15 minutes), wrong-environment or wrong-scope evidence is rejected.
One leading package-manager `--` is accepted; duplicate options, repeated
separators and separators inside the option list are still rejected.
Before/after comparisons must also fit that freshness window; a longer maintenance
operation needs a separately reviewed evidence policy, not a bypass.

## Manifest and preservation boundary

`manifest.mjs` is the reviewed conservative candidate allowlist. The only proposed
row scope is `school_id IN (<explicit IDs>)`, or `schools.id IN (<explicit IDs>)`.
Catalogue evidence must confirm scope support. Missing/unsupported tables block
planning. Unlisted tables and every out-of-scope row are retained by default.
This is NOT a complete purge: retaining identities, history and finance will often
prevent deletion of their test schools, students, employees, classes or terms.

In particular, retain:

- All `app_users` and `school_memberships`, not just a hardcoded Owner ID. This
  preserves legitimate platform administrators, family/other-tenant access and
  auth bindings. At least one active platform-scoped Owner is required in evidence.
- All financial/audit/provider/subscription records, immutable academic evidence,
  attendance/security/care events and histories. Retain in place by default; this
  tool does not copy, redact, archive externally, anonymize or delete them.
- All devices, credentials, cards, binding/assignment history and NFC finance.
  No "confirmed test assignment" override is implemented; that needs a separate
  reviewed scope and credential-revocation design.
- All curriculum/imports/logos/files/reusable assets and communication settings,
  templates, queues, delivery receipts, push endpoints and Telegram state.
- Global settings/rules, company records, external auth identities, invitations,
  object bytes, all secrets/environment and provider configuration, including
  Flutterwave/payment/webhook and email/SMS settings.
- Schema, indexes, constraints, functions, views, triggers, migration ledger and
  sequences. No truncate/cascade, identity restart, trigger/constraint disabling,
  schema change or migration is generated.

The graph includes actual FK delete actions. Retained children block proposed
parent deletion **even for cascading FKs**; no silent cascade into retained data.
Candidate edges are ordered children-first; cycles, cross-schema edges and
unvalidated/orphaned references block review. Unknown tables remain retained.
Indirect rows without a reviewed school scope are never guessed into the manifest.

## Preflight evidence

The printed SQL measures all public-table counts/fingerprints, candidate counts
for the selected schools, retained-child FK references and existing FK orphans.
It returns schema/migration fingerprints, Owner presence and session identity,
without returning row contents, auth IDs, credential values or file bytes.
It can be expensive on a future large dataset: review it and use a bounded,
operator-approved read-only transaction/statement timeout. Missing privileges,
missing ledger or any SQL error is a blocker, never an empty/healthy result.

The query deliberately returns primary/backup/health `verified:false`: SELECTs
cannot certify resource binding, available restore points, a restore drill,
connection-pool reliability or primary write capability. Running a read-only
transaction on a primary also reports read-only; that is not evidence of a broken
primary and cannot certify writable access. A replica is always refused.

The report's `expectedConfirmation` binds the school scope, manifest version and
entire evidence digest. It is an intent-review token, **not a secret or execution
capability**. Never add production credentials, raw auth identifiers or provider
secrets to the evidence. The report does not echo arbitrary file fields.

## Missing operator prerequisites — no workaround in this command

1. Independently identify the published app's actual writable database resource,
   not just the replica name, a proxy address or the workspace environment.
2. Obtain trusted, fresh resource-bound backup/PITR evidence plus a successful
   isolated restore drill. Include separate protected object-file backups and
   external auth/provider configuration recovery. Document recovery window and
   rollback decision. Repository Development backups do not establish this.
3. Verify primary connection health, permissions and pool stability; resolve
   existing acquisition timeouts. No dummy write is authorized by this command.
4. Approve a maintenance freeze covering onboarding, all workers, communication
   queues, device ingestion, browser callbacks and provider webhooks. This tool
   does not stop processes or change settings.
5. Resolve retained-reference blockers **without deleting or rewriting history**.
   An archive/inactive-tenant strategy or a separately approved fresh environment
   may be required. An empty-school reset is not promised under retention defaults.
6. Separately authorize and review an executor only after trusted API/binding,
   backup, health, authorization and freeze mechanisms exist. It would need
   fresh same-session checks, rollback-on-failure, transaction-bounded row-count
   assertions, protected-state verification and the exact confirmation token.
   Adding an environment flag or accepting operator booleans is not sufficient.

## Post-reset verification contract

No reset or post-reset verification is performed by this implementation.
The optional offline comparison checks exact candidate count reductions, unchanged
out-of-scope row fingerprints, unchanged retained-table/schema/migration evidence,
same observed identity, Owner presence and zero FK orphans/changed FK inventories.
It always returns `verifiedProductionReset:false`.

Actual acceptance would additionally require trusted same-primary binding, freeze/
backup proof, complete logical/JSON/external-reference checks, preserved sequence
positions (replica readings are not authoritative), real Owner/admin sign-in,
provider/auth configuration and object-byte preservation, and prevention of stale
test communications/device events/callbacks reaching newly onboarded schools.
Snapshot comparisons are not proof of these external behaviors.

A reset would not activate LIVE payments or satisfy their separate release gates.
