# Existing test-account access revocation

This implements **application access revocation**, not tenant deletion, Clerk
identity deletion or a certification that Production is ready for an archive.
No Production operation was performed while building it.

## Scope and preservation

- Select school IDs and Partner profile IDs explicitly. Never infer that a
  Partner is disposable merely because it referred a test school.
- Capture existing membership, student/parent/employee, linked-child, Partner
  owner/staff and recorded invitation associations, including inactive history.
- Preserve the Platform Owner. Refuse the **whole batch** if any other selected
  identity also has an association outside the approved scope. Resolve that
  identity overlap separately; do not silently lock out a legitimate tenant.
- Append a control event to the existing audit ledger. Do not edit prior audit
  rows, user status, memberships, school/Partner roots, invitations, financial
  records, provider references, devices, credentials, cards or their provenance.
  No migration, global auth setting or provider mutation is needed.
- Authentication reads the ledger on every protected request, without an
  authorization allow-cache. Stored ACTIVE roles and previously issued Clerk
  sessions/JWTs do not bypass the block. Same-email new identities are checked
  before app-user insertion. Recheck current associations to prevent a later
  membership from reopening an archived scope.
- School invitation creation/replacement/activation and Partner referral,
  onboarding and acceptance paths enforce the archived roots as well.
- Invalid/unreadable ledger evidence fails closed. Validate complete
  BLOCK/RESTORE chains; a restore cannot silently change the archived identities.

### Explicit same-email Partner reapplication

The email reservation is not a permanent ban on a new Partner application.
[PARTNER-REAPPLICATION.md](PARTNER-REAPPLICATION.md) documents the separately
verified fresh-session path, new internal account/profile and approval boundary.
It never restores the original account or transfers old session access/history.
Ordinary same-email provisioning and archived account/root checks still deny
re-entry; the exception applies only to a recorded fresh account association.

Clerk may still recognize its own session. We do **not** claim that its cookie,
JWT or sign-in credential was physically revoked. EduCore refuses that account's
protected requests. Previously downloaded information cannot be erased remotely.

## Guarded operator path — future separately authorized use only

`archive-access-cli.mjs` is separate from the destructive cleanup executor.
The default is offline and opens **zero connections**. For example, these IDs
are fictional, **not an approved real allowlist**:

```sh
pnpm --filter @workspace/scripts run production-reset:archive-access -- \
  --school-ids 9 --partner-ids 3 --dry-run
```

Exit code 2 means execution is not ready/was refused; it is expected offline.
There are no all/force/override flags.

Future `--preview` and `--execute` require the private Owner proof described by
the existing cleanup authorization policy: independently identified primary,
fresh resource-bound backup and restore evidence, and a verified external
maintenance freeze. Additionally its `authority` must contain:

- `actorUserId`: the actual active platform-scoped Owner's app-user ID;
- `testSchoolIds` and `testPartnerIds`: the exact sorted allowlists;
- `accessArchivePolicy`:
  `REVOKE_EXISTING_TEST_ACCOUNTS_PRESERVE_OWNER_AND_LEGITIMATE_TENANTS`.

Preview is read-only and rolls back. Save its JSON privately as the review file.
Only a later explicitly approved `--execute --review <private-file> --confirm
<exact-preview-token>` can append a block. Execution rejects changed association
evidence, other database clients, unreviewed audit write triggers/rules, reused
batch IDs and an actor without a live active Owner membership. It rechecks under
bounded transaction locks and appends one audit event, then commits once.
It never falls back to the workspace connection. No credentials belong in the
authorization or review files.

To restore, select the same allowlists and add `--restore-batch <batchId>` in a
**new preview and separately confirmed execution**, with fresh authorization.
Restoration appends the matching RESTORE event; it does not rewrite the BLOCK,
revoke another batch, activate an originally inactive user or recreate any role.
An existing genuine session can access the app again after refresh if all other
eligibility checks still pass. Never automatically retry an uncertain COMMIT or
ROLLBACK; reconcile the durable batch state first.

This operation does not itself stop workers/devices, disable guest payment URLs,
cancel previously accepted external messages or replace existing operational
school/financial safeguards. The required external maintenance freeze remains a
separate operator responsibility. Account revocation is not proof of complete
whole-system read-only archival, device reuse readiness or tenant removability.
Physical removal remains blocked by the preserve-in-place policy.

## Focused verification

```sh
node --test scripts/src/production-reset/*.test.mjs
pnpm --filter @workspace/api-server exec vitest run \
  src/middlewares/auth.test.ts src/routes/test-account-archive-access.test.ts
pnpm --filter @workspace/api-server run typecheck
```

The actual SQL behavior is exercised only by `access-archive-isolated.mjs` in the
fresh private PostgreSQL 16.10 socket-only fixture documented in `REHEARSAL.md`.
It refuses existing/unowned/mismatched paths before connecting. See the separate
access-revocation receipt in `REHEARSAL-RESULTS.md`; it is not Production evidence.
