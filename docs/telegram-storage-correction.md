# Telegram storage readiness correction

## What is confirmed, and what is not

No Production database was queried and no Production migration was applied.
Therefore the exact absent objects in the running database are **not established**.
The Owner's `SCHEMA_NOT_READY` message establishes a failed storage gate, not which
individual object failed.

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
already-correct legacy names as well as the new names. It returns fixed schema
object labels for missing requirements; it reads no business rows, credentials
or chat identifiers. The worker retains `SCHEMA_NOT_READY` when storage fails and
does not contact the provider from that failed gate.

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

First approve target-verified Development schema preparation separately; the
project intentionally disables automatic schema writes. Then verify the fresh
Publish preview includes all required missing tables and BOTH installation of
the new CHECKs and removal of obsolete CHECKs. Stop if unrelated schema/data
changes appear. Do not select overwrite/reset, and do not assume a numbered SQL
file is automatically executed by Publish.

The deployed old readiness code expects the old CHECK names, so schema and code
must be released together under separate approval. Do not apply a names-only
change while expecting old code to recognize it.

Telegram opt-in, secrets, notification live-from cutoff, hosting, payment settings
and SMS policy were not changed. The cutoff stays held; a storage-ready result
does not authorize sending, release TEST history, or prove provider/device receipt.
No restart or publication occurred.
