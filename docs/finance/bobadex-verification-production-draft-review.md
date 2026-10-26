# Bank verification and six Production migration drafts

Review date: 2026-10-26.

**Later safety correction:** the two rollback findings below have now been
repaired and tested on the complete current source-derived schema. See
[the six-migration installation runbook](flutterwave-live-six-migrations-installation.md)
for current results, the two updated down-file hashes and the remaining
operator primary/recovery approval gates. The earlier findings and hashes below
are preserved as historical evidence, not current draft status.

## Decisions

- The existing school-bank verification fix needs **no Production migration**.
- No Production verification, rejection, migration, schema push, secret change,
  publishing, LIVE payment enablement or provider request was performed by this
  Agent work. A later externally initiated Owner verification is recorded below.
- **Do not approve the six-draft Production change package yet.** Forward DDL
  passed a disposable structural rehearsal, but rollback preservation has
  defects and target-specific approval/recovery evidence is not established by
  that rehearsal.
- The six up files and their six down companions were reviewed without changes.

## Actual bank-action diagnosis and preservation

The Production button depended on a capability whose account-resolution path
required payroll-transfer readiness. An activated merchant therefore did not
necessarily make this particular action available. The corrected lookup uses
the dedicated Production bank-resolution credential without granting transfer,
checkout, subaccount or settlement authority. No credentials were read or
changed by the inspection.

The Owner must explicitly initiate the provider request. Authorization remains
Platform Owner only; the route validates the school identifier and request key,
decrypts the saved profile internally, requires pending/action-required status,
and compares independently returned account number and normalized holder name.
Provider failure does not approve anything. Mismatch records ACTION_REQUIRED
with an audit. Matching evidence updates VERIFIED and both audit trails in a
transaction, conditional on the original encrypted bank snapshot still matching.

The bank-only success path no longer rewrites provider_business_id. Existing
provider business and subaccount identifiers are retained. Existing financial
allocation, amounts, attribution, balances and commission policies are unchanged.

The UI explains unavailable configuration instead of relying on a disabled
button's tooltip alone. A separate deliberate documentary review requires a
current profile version, note, evidence digest and explicit match attestation
for verification; rejection requires a reason. It is not automatic approval and
does not pretend documentary evidence was a provider response.

The first read-only Production inspection found Bobadex Group of Schools pending.
A subsequent read, after deployment logs showed an Owner-endpoint POST returning
200, found VERIFIED with verified_at/updated_at 2026-10-26T09:00:38.083Z. Its
latest structured audit is FLUTTERWAVE_BANK_ACCOUNT_RESOLVED, actor role
PLATFORM_OWNER, PENDING_VERIFICATION → VERIFIED. This Agent did not invoke that
Production mutation, initiate the provider request or publish the deployed code.
No repeated or reversing action was taken. The recorded providerMode is
NOT_CONFIGURED; that legacy field describes payroll readiness, not the newly
separated bank-lookup capability.

The inspected Agent connection returned:

| Observation | Value |
| --- | --- |
| Database name | neondb |
| pg_is_in_recovery() | true |
| transaction_read_only | on |
| Existing public flutterwave_live_* tables | 0 |
| Existing settlement profile and audit tables | present |

This is **replica evidence, not a writable-primary confirmation**. The database
name does not establish hosting provider, primary identity or recovery availability.

Verification: 75 focused backend tests passed, including nine native disposable
PostgreSQL route tests, and the API typecheck passed. Coverage includes Owner
authorization, missing independent evidence, matching/mismatching provider
responses, status transitions, unchanged provider identifiers, stale review,
concurrent identical decisions and rollback when audit insertion fails.
The preceding unchanged frontend checks cover the Production availability gate
and documentary-review behavior; mobile/desktop browser evidence used fictional
responses, not an authenticated Production bank operation.

## Inventory and dependency order

All files are in `lib/db/dev-reconciliation/`. All six forward files have
BEGIN/COMMIT boundaries, and each has a corresponding down file. They remain
review drafts, outside the automatic migration journal; a previous review of a
subset is not approval of the complete current six-file package.

| Order | File | Dependency / effect |
| --- | --- | --- |
| 1 | flutterwave-live-webhook-inbox.up.sql | Authenticated delivery fingerprints; not payment proof |
| 2 | flutterwave-live-finalization.up.sql | Inbox; intent, collection, event and deferred liability evidence |
| 3 | flutterwave-live-workflow.up.sql | Inbox and finalization; reviews, activation/receipt/case/export records |
| 4 | flutterwave-live-readiness.up.sql | Stages 1–3; supporting UNIQUE keys precede composite FKs |
| 5 | flutterwave-live-runtime.up.sql | Stages 1–4; runtime tables and disabled-by-default release metadata |
| 6 | flutterwave-live-school-onboarding.up.sql | Existing app_users, schools and settlement_payroll_profiles; can be staged independently of 1–5 once those canonical prerequisites are verified |

Do not use alphabetical order. Proposed reverse order is 6 → 5 → 4 → 3 → 2 → 1,
but the current down package is **not approved for operational rollback**.

The forward DDL contains no application-data backfill, enabled-release seed,
TEST-to-LIVE conversion, payment, disbursement or allocation-policy change.
Financial checks retain the existing NGN 5,000 total, NGN 1,900 school amount,
NGN 3,100 merchant gross and conditional NGN 100 deferred Partner liability.
Creating an empty schema is not financial readiness or permission to activate it.

## Executed isolated rehearsal and blockers

A new local Unix-socket PostgreSQL cluster was initialized with an explicit
temporary data directory and no TCP listener or application connection string.
Its identity was checked before execution and it was removed afterward.
The six unmodified forward scripts created 21 LIVE tables, with zero runtime or
school-onboarding release rows. Empty reverse order and reapply succeeded.
Minimal canonical fixture rows remained unchanged.

This is a **minimal-fixture structural rehearsal**, not a restored Production
clone, current full-schema rehearsal, operator approval or recovery test.

### High: workflow rollback can destroy retained approval evidence

The workflow down script checks intents, authority reviews and reconciliation
cases, but not independent commission batches or workflow audits.

After reversing the empty later stages in the disposable fixture, a valid
commission batch and APPROVE_EXPORT_ONLY audit were inserted without an intent.
The exact workflow down file then succeeded and removed both retained records.
An empty intent table is not proof of no financial approval/export history.
This contradicts the package's preservation requirement.

### High: runtime rollback has a check/drop concurrency gap

The runtime down file checks for evidence in a DO block without first locking
the inspected tables against concurrent writers. Its later DROP TABLE obtains
locks too late to make the earlier emptiness checks authoritative. A new runtime
record could commit between the check and the drop.

This is a static concurrency finding; no concurrent Production write or
Production rollback was attempted.

### Remaining approval prerequisites

- Fix and separately review those rollback guards, with native retained-evidence
  and concurrency tests; retain all historical/provider/financial records.
- The inbox header currently limits application to a separately verified
  Development target. That review scope, and historical subset reviews, do not
  supply authorization for a Production change.
- Rehearse the exact hash-pinned package on an approved Production-shaped,
  isolated copy. Minimal fixture success does not establish target compatibility.
- Review existing objects, keys, grants/ownership, application/schema differences,
  deployment schema proposals, lock/statement timeouts and maintenance window.
  The scripts are one-shot, not safe to rerun blindly.
- Associate the verified writable primary and a currently available restore point
  with that exact change approval. Existing reported confirmations are not
  invalidated by the Agent's inability to inspect the operator's current UI.
- Keep schema application and financial/provider activation as separate approvals.

## Exact Replit-supported operator path — instructions only

The following describes a later approved operator action. Nothing here was
clicked or executed against the Production primary during this review.

1. In the Project Editor, open **Tools → Replit Cloud → Database**.
2. Select **Production Database**, not Development. Open **Settings** to identify
   the selected database and its connection details. Privately match that target
   to the deployed application's actual binding; do not paste a connection URL,
   password or key into chat. A name such as neondb is insufficient.
3. In that same selected Production database, inspect the available recovery
   controls. For scheduled recovery points the documented path is **Settings →
   Advanced → Scheduled backups → View all backups**. Record an existing
   restorable point's timestamp/time zone and database association. Merely
   enabling a schedule does not establish that a completed backup exists.
   Check the actual available PITR range/retention for that database as well.
   Record the intended pre-change time in UTC and verify it is selectable.
   Do **not** select Restore, type `restore`, change retention/schedules or
   perform a restore just to establish readiness.
4. Only when the later manual change is authorized, Replit documents
   **Production Database → My Data → Enable Editing → SQL console** for
   operator editing. This UI capability does not make Agent replica access
   writable or guarantee that a particular session targets the primary.
5. Before any future DDL, run only this diagnostic in that operator console:

   ```sql
   SELECT current_database() AS database_name,
          pg_is_in_recovery() AS in_recovery,
          current_setting('transaction_read_only') AS transaction_read_only;
   ```

   Require the independently identified Production target, `in_recovery=false`
   and `transaction_read_only=off`. These are necessary, not sufficient,
   conditions for the approved session. If the session reports a replica or
   read-only state, stop: do not force read-write mode, replace credentials or
   claim that Enable Editing overrode replication.
6. A later approved SQL change must use the reviewed ordered package and its
   explicit lock/time limits and preservation plan. Do not run schema push,
   apply a generated diff wholesale, or publish to bypass this approval.

Current official recovery documentation describes PITR and scheduled backups,
but availability must be checked on the selected database rather than inferred
from its name or an earlier snapshot. Database recovery and code rollback are
separate operations and must be coordinated in any actual recovery plan.

Sources consulted:

- https://docs.replit.com/features/data-and-storage/work-with-your-data
- https://docs.replit.com/features/data-and-storage/connection-details
- https://docs.replit.com/features/data-and-storage/data-recovery
- https://docs.replit.com/features/data-and-storage/development-and-production

## Reviewed file identities (SHA-256)

```text
webhook-inbox up   ab644e6a38bdd1d9d4ef63f52cd971a05153e777b65d730567dac1ed231f874d
webhook-inbox down fd3475aa057a05f8c6dd7bace8e8ae8a47e64366240839be2631ab94cf9f3d39
finalization up   62f70bc39f92852fd8219b0da063fc2299f3530fd8a4356fe197049f40eb4b1a
finalization down 0914fc1b11c8fbce2f8cadfd11e7da23788b34537919c14c7f28f3a3b5843cc5
workflow up       a7e83947d2338d762a1830814d68f2be470e19866c46be84a8bccfad08d3c67a
workflow down     047805b8591ded4276595721c2d7a3f71f267d77e0a43d37b07523a263f3f4b7
readiness up      88e4bfa3eae084e6072b33d77125f9dc17bc74d5445fea1b28458522d9991a8c
readiness down    98b933998cc2e12e531267e72a8f70023ae7f8b2d1744cc7ef4ad101a006495f
runtime up        27754570bba1743944516b4200c9ca5198754d5d19076917788b46b958d2b77c
runtime down      0ed4148ea96d9078cea880ca55c2d15f05c76211b0ae3641b687bfcd1c9b4a3a
school-onboarding up   6808b70544f2f417b7ce2e39195301ae29fbb6781194fb1d0f62b58b3acc53f3
school-onboarding down 645b090cf28102bf0e4c41c4de2056437432136b578d1759db09358a5e3a2b98
```
