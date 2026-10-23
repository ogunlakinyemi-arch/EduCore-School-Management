# Telegram storage readiness correction

## What is confirmed, and what is not

Read-only Production-replica catalog inspection on 2026-10-23 found all three
Telegram tables and all required columns. The three existing channel CHECKs
still allow only `IN_APP`, `SMS`, `EMAIL`, `PUSH`; each rejects `TELEGRAM`.
No Production migration was applied. This is storage evidence, not a verification
of the deployed process's in-memory provider health or physical delivery.

The exact failing storage requirements are:

- `channel_check:communication_deliveries`
- `channel_check:communication_preferences`
- `channel_check:communication_templates`

Before preparation, Development's catalog passed the storage inspector using
the old CHECK names, but Publish returned **no diff**. This confirmed the
same-name-expression discovery problem; publishing code alone was not a storage
migration. The approved Development preparation below now makes the required
Production schema changes visible.

Source already contained the three Telegram tables and the original migration
`0172_telegram_notifications.sql`. That migration broadens three channel CHECKs
without changing their names. This project has previously observed same-name
CHECK-expression changes omitted from Publish's schema diff. Merely finding the
Telegram tables therefore does not establish that Telegram inserts are allowed.

## Required storage

- `parent_telegram_links`: parent/bot identity, encrypted chat/hash,
  consent/revocation timestamps and update timestamp.
- `telegram_link_challenges`: parent/school/bot identity, token hash, pending
  encrypted chat/hash and creation/expiry/claim/confirmation/revocation timestamps.
- `telegram_poll_state`: singleton identity, bot identity and last update ID.
- A validated Telegram-capable channel CHECK on **each** of
  `communication_deliveries`, `communication_preferences`,
  `communication_templates`.

The corrected catalog-only readiness inspector checks the tables, required
columns, and each relation's validated channel CHECK independently. It accepts
already-correct legacy names as well as the new names, but a new broadened CHECK
cannot hide an old restrictive CHECK still enforced on the same table. It returns fixed schema
object labels for missing requirements; it reads no business rows, credentials
or chat identifiers. The worker retains `SCHEMA_NOT_READY` when storage fails and
does not contact the provider from that failed gate. Owner diagnostics now report
fresh catalog failures separately from cached provider health. A successful
catalog read never enables delivery or mutates the worker's readiness cache.

## Prepared correction

`0173_telegram_storage_readiness.sql` is a controlled, atomic migration draft.
It creates missing Telegram tables/indexes without inserting links or poll state.
It installs distinctly named `*_telegram_channel_check` constraints, validates
them, then removes the superseded `*_channel_check` constraints. The authoritative
Drizzle schema uses the same replacement names.

All five historical channel values remain valid, including stored SMS history;
**this does not enable SMS delivery**. No business data is updated/deleted,
reclassified, reset or backfilled. Validation failure aborts the transaction
rather than repairing rows silently. The draft is repeatable for the expected
schema; incompatible partial tables or conflicting pre-existing definitions
require separate review, not automatic repair.

No migration ledger was rewritten: the existing journal predates many later
numbered migrations, so adding a latest-only entry would not establish database
history. No startup/build migration hook was introduced.

## Verification

Real PostgreSQL tests use a newly initialized temporary cluster and private Unix
socket, synthetic fixture records and mocked Telegram transport. They exercise:

- missing-table installation and legacy CHECK expansion;
- preservation of existing link/challenge/poll/notification/preference rows;
- repeat application without row changes;
- correct legacy-name compatibility, missing-column and missing-CHECK failures;
- real Telegram channel inserts and rejection of unsupported channel values;
- existing linking/consent/isolation, retries, unknown outcomes and launch guards.

No application Development or Production database is used by these tests.

## Remaining controlled application step

**The running dashboard is not repaired by source edits alone.** An authorized
operator still needs to apply the reviewed schema correction through the
project's approved migration process and load the corrected readiness code.
For Replit-managed Production, the supported path is the reviewed Publish schema
diff, not direct Production SQL or a startup migration script.

**Development preparation approved and completed on 2026-10-23.** The application
pool and the independent Development SQL service agreed on the local database
identity, distinct from the Production replica. A guarded transaction applied
only the three approved constraint replacements from the `0173` correction;
it did not create/recreate tables or indexes or change migration history.

The transaction locked the six affected communication/Telegram tables, compared
row counts and full-row fingerprints before/after, and required equality before
commit. All six were unchanged. Development's storage inspector reports no
missing requirements, and all three replacement CHECKs are validated.

The fresh supported Publish preview contains exactly these six changes:

1. Remove `communication_templates_channel_check`.
2. Remove `communication_preferences_channel_check`.
3. Remove `communication_deliveries_channel_check`.
4. Install `communication_templates_telegram_channel_check`.
5. Install `communication_preferences_telegram_channel_check`.
6. Install `communication_deliveries_telegram_channel_check`.

Each new CHECK accepts `IN_APP`, `SMS`, `EMAIL`, `PUSH`, `TELEGRAM`. The preview
reports no structural data loss, tables/columns/schema removals, truncation or
unrelated statements. It does flag potential backward incompatibility while
the constraints are replaced. A transient storage-readiness failure during the
coordinated schema/code rollout remains fail-closed.

**Remaining action:** the Owner must publish the corrected application with
this reviewed schema diff through Publish. No direct Production DDL is
authorized or needed. Review the actual final preview again if anything has
changed; stop if unrelated schema/data
changes appear. Do not select overwrite/reset, and do not assume a numbered SQL
file is automatically executed by Publish.

The deployed old readiness code expects the old CHECK names, so schema and code
must be released together under separate approval. Do not apply a names-only
change while expecting old code to recognize it.

Telegram opt-in, secrets, notification live-from cutoff, hosting, payment settings
and SMS policy were not changed. The cutoff stays held; a storage-ready result
does not authorize sending, release TEST history, or prove provider/device receipt.
No publication or Production migration has been performed by the agent.
Production storage remains unverified as corrected until Publish applies the
intended schema and a fresh Production catalog inspection reports no missing
requirements. Worker/provider health is separate from storage readiness.
