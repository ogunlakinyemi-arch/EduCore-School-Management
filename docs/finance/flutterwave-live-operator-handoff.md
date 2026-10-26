# EduCore LIVE schema: Android owner handoff

## What to do on your phone

1. Open or download this document. Send it to one trusted, authorized database
   operator with access to the reviewed project files. Do not send passwords,
   full connection strings or screenshots containing credentials.
2. Ask that operator to execute the existing reviewed files on a computer using
   the procedure below. You do not need to write SQL or paste migrations on your
   phone. Record the operator's identity and planned execution window privately.
3. If no trusted operator is available, use Replit's **? Get Help** or
   **https://replit.com/support** and copy the Support message at the end.
   Keep installation paused while waiting; do not introduce an app endpoint,
   rotate credentials, change settings or publish to bypass the access blocker.

This is a handoff, not an executable installer. It initiates human coordination,
not a database operation. No supported Agent writable Production route is
available in this session. Owner editing controls do not grant Agent that route.

## Approval and package

The owner has reported confirmation of the live deployment's Production resource,
a writable primary diagnostic (`neondb`, recovery false, read-only off, public
schema), scheduled backups/PITR, and explicit approval for these six reviewed
files. Preserve that approval and recovery evidence with the execution record.
Do not ask the owner to repeat it merely because the Agent cannot access the
primary.

The package is the six unchanged `.up.sql` files below, their checksum manifest,
and the existing detailed runbook. Retrieve them through approved project access.
Do not reconstruct SQL from this document or use the disposable rehearsal script
as a Production installer.

Runbook: `docs/finance/flutterwave-live-six-migrations-installation.md`

Manifest: `docs/finance/flutterwave-live-forward.sha256`

The inbox's older Development-only header must remain visible. Record that the
owner's target-specific Production authorization covers this exact hash; the
operator must resolve any remaining review-scope objection before DDL. Do not
silently remove warnings or treat a file header as execution authorization.

## One operator workflow

1. Obtain authorized private Production access using the selected database's
   **Settings** connection details. Replit supports external PostgreSQL clients.
   Do not use the workspace Development connection, Agent replica, copied
   credentials in this document, or public/shared command logs.
2. From the reviewed project's root, verify the downloaded source files:

   ```sh
   sha256sum -c docs/finance/flutterwave-live-forward.sha256
   ```

   Require six `OK` results and a successful exit. This command reads local
   files only; it does not connect to a database. Any mismatch is a stop condition.
   Review the full file headers and existing BEGIN/COMMIT boundaries.
3. In the actual operator connection, follow the runbook's primary/resource,
   permissions and existing-object checks. Reconcile any partially installed
   stage before continuing. Use a coordinated execution window and preservation
   baseline; do not change payment flags.
4. Use desktop `psql` with `-X`, `ON_ERROR_STOP=1`, and file input (`--file`).
   Configure the verified private Production connection explicitly. Follow the
   runbook's target guard and session controls: public search path, 5-second lock
   timeout and 60-second statement timeout, in the same connection as each file.
   Resolve the runbook's database-name placeholder from the approved resource.
   Keep these controls separate from the unchanged SQL file bytes.
5. Execute only one complete forward file per invocation, in the order below.
   Do not concatenate the six stages, edit their DDL, add an outer transaction
   wrapper, run rollback companions, or enable any release. With stop-on-error,
   a failing file must end the invocation; closing its connection rolls back an
   uncommitted transaction. Earlier successful files remain committed.
6. After each successful invocation, require exit status zero, a successful
   COMMIT and the per-stage checks below before starting the next. On a network
   error, commit status is uncertain: inspect actual state before any retry.

## Ordered files and per-stage checkpoints

All paths below start with `lib/db/dev-reconciliation/`.

| Stage | Exact file | New tables | Cumulative LIVE tables |
| --- | --- | ---: | ---: |
| 1 | `flutterwave-live-webhook-inbox.up.sql` | 1 | 1 |
| 2 | `flutterwave-live-finalization.up.sql` | 5 | 6 |
| 3 | `flutterwave-live-workflow.up.sql` | 7 | 13 |
| 4 | `flutterwave-live-readiness.up.sql` | 1 | 14 |
| 5 | `flutterwave-live-runtime.up.sql` | 4 | 18 |
| 6 | `flutterwave-live-school-onboarding.up.sql` | 3 | 21 |

Counts assume the reviewed initially absent LIVE schema. Counts alone are not
verification: compare the exact table names, indexes, constraints, functions,
triggers and stage-specific ALTERs against each source file. Check enabled
triggers and validated constraints. Keep newly created LIVE tables empty,
including runtime and school-onboarding release tables. Verify the canonical
business-data preservation baseline at each checkpoint.

After stage 6, additionally require the expected 21-table set and all three
school-onboarding history/audit triggers enabled. Record each stage's hash,
operator, UTC time, commit result and verification result.

**Stop immediately** on hash mismatch, ambiguous approval/target, insufficient
permissions, existing/partial objects, timeout, SQL error, disconnect, unexpected
data changes, enabled release records or a verification discrepancy. Do not
continue, rerun blindly, force drops or run rollback. Preserve evidence and ask
for review. Never publish, enable LIVE, create subaccounts or change secrets.

## Copyable Replit Support request

> I own the EduCore project and use Android. I have authorized the six exact
> reviewed Flutterwave LIVE schema migrations. I have confirmed that the live
> deployment and Production database are the same resource, that the owner SQL
> session is writable on the primary, and that backups and seven-day PITR are
> enabled. Agent has no writable Production route in this session.
>
> Please identify a supported owner-authorized way to execute the existing
> project SQL files, with hash verification, bounded lock/statement timeouts,
> stop-on-error, preserved transaction/session semantics and verification between
> stages. Does Replit provide such a mobile-accessible execution mechanism, or
> is a trusted operator using an external PostgreSQL client required?
>
> No execution is authorized through this support request itself. Please do not
> publish, rotate credentials, alter settings, enable LIVE payments or request
> passwords/full connection strings. I can provide project/deployment identifiers
> through the official support form.

References:

- https://docs.replit.com/features/data-and-storage/work-with-your-data
- https://docs.replit.com/features/data-and-storage/connection-details
- https://docs.replit.com/legal-and-security-info/support-policy
