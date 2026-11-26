# Manual GitHub-only PostgreSQL rehearsal

Workflow: `.github/workflows/current-finance-postgres-rehearsal.yml`.
It has **only `workflow_dispatch`**, runs on GitHub-hosted `ubuntu-24.04`,
and gives its automatic token **`contents: read` only**. It does not publish,
merge, open PRs, run application startup migrations or invoke Drizzle push.
Actions use stable majors (`checkout@v4`, `setup-node@v4`, `pnpm/action-setup@v4`);
PostgreSQL is the maintained official `postgres:16` image. Exact server version
and container identity are printed by each real run.

## Dispatch and approval

After GitHub recognizes this workflow, open **Actions → Isolated current-finance
PostgreSQL rehearsal → Run workflow**, explicitly choose the rehearsal branch,
and select **Run workflow**. Inspect the run's offline-check and scenario output.

GitHub normally requires a `workflow_dispatch` workflow to exist on the default
branch before registering it. A new branch alone may therefore be undispatchable.
An API/UI refusal is a blocker, **not successful rehearsal evidence**. Do not
merge, temporarily modify `main`, add automatic triggers, or use another workflow
as a workaround. A separate approval is required before a PR or default-branch
change. Creating/pushing this branch does not itself run the workflow.

## Authoritative prerequisite provenance

The inline CI adapter imports the existing current-finance **contract, preflight,
and read-only catalog verifier**, not the legacy native runner or its synthetic
baseline. It does not change those files or weaken their local target guard.
The old private-cluster CLI remains unchanged; this is a separate, guarded
GitHub-service execution route.

For every newly-created disposable database, in order:

1. Complete unchanged `0000_brainy_moon_knight.sql`: real users, schools,
   students, audit logs and related original tables/keys.
2. Complete unchanged `0001_phase3_meta.sql`: sessions/terms, saved-calendar
   columns and real tenant composite unique keys, including `admission_status`.
3. Complete unchanged `0002_overjoyed_sue_storm.sql`: Partner profiles,
   attributions, commission ledger and its real dependencies.
4. The **unchanged table/index prefix** of `0031_staff_nfc_billing.sql`, from
   `CREATE TABLE staff_nfc_billing_rules` up to (excluding) its first INSERT.
   This is required by 0175. Its ACTIVE-rule seed and unrelated NFC financial
   tables are deliberately excluded; no prerequisite definition is invented.
5. Complete unchanged `0175_owner_subscription_rule_management.sql`,
   `0176_direct_student_live_preparation.sql`,
   `0177_direct_student_live_release_reviews.sql`,
   `0178_independent_bro_term_commissions.sql`, and
   `0179_restore_direct_and_bro_guards.sql`.
6. Complete unchanged `lib/db/dev-reconciliation/bro-field-operations.sql`.
7. Complete unchanged `0183_owner_free_academic_terms.sql`.

All paths above are relative to `lib/db/drizzle/` except the explicit
dev-reconciliation path. Each executed source/exact extracted prefix has its
SHA-256 printed. Missing source files, changed extraction boundaries, missing
dependencies or protection mismatches abort the job rather than use a stub.
This is an authoritative-source fixture, not a full current Production clone.

The 11 direct prerequisites are schools, academic_terms, app_users, students,
student_direct_live_attempts, student_direct_live_reviews,
bro_term_commission_entitlements, partner_profiles,
school_partner_attributions, subscription_rule_proposals and bro_field_leads.
Their transitive prerequisites are supplied by the sources above.

The exact `guard_student_direct_history()` body comes from 0176 and is retained
by the equivalent 0179 source. Its trimmed/LF-normalized MD5 must be
`06020fe5a25c579f9157746f4ba847b0`, matching `student.verify.sql`.
No replacement guard is fabricated. Source 0180 is not a dependency of this
path; the archived split workflow and its CHECK are not installed.

## Isolation and test behavior

- Fresh GitHub service; no published TCP ports, repository secrets, credentials
  or application connection strings. The initialization role is the fictional
  fixture owner, with trust authentication on the private Unix socket.
- All Docker networks are disconnected and verified empty **before any
  rehearsal SQL**. Host port bindings must be empty. Database access is possible
  only through the runner-local socket mounted from that service.
- The Node adapter and its offline-check subprocesses run in a new OS network
  namespace, with a credential-free environment and empty home. Socket/TLS/fetch
  guards additionally reject any connection except the one fixed Unix socket.
  No fallback exists if namespace creation or socket/identity checks fail.
- Before DDL, verify PostgreSQL major 16, role/session role, data directory,
  port, current database and Unix transport against the fixed service contract.
  The socket mount is checked against Docker metadata, and PostgreSQL's cluster
  identifier must match a read made by `docker exec` inside that exact disconnected
  container. Initially only postgres/template0/template1 databases may exist.
- Nine scenarios each create/drop a **new database**, with a distinct recorded
  database OID; the guarded name `finance_rehearsal` is intentionally reused.
  No existing database is adopted or cleaned up.
- Fixtures contain fictional saved academic/identity, student history, BRO field
  history and free-term records. Subscription proposals stay DRAFT, no release
  bindings are inserted, attempts stay RESERVED, and no paid provider transaction
  or BRO financial entitlement is created.

Each scenario verifies pre-existing table structure/data, sequence identities,
definitions and last-value/called state, original function OIDs/definitions,
and trigger definitions/enablement. Rejected BRO inserts supply an explicit ID
so they do not consume a pre-existing nontransactional sequence. It checks the existing
student and free-term verification packets before/after installation.

### Real PostgreSQL scenarios

1. Full unchanged 0181 → read-only intermediate structure/protection/data check
   → unchanged 0182 → read-only full catalog and all three verification packets.
2. Inject failure before 0181 COMMIT: all new objects roll back.
3. Commit 0181, inject failure before 0182 COMMIT: phase-two changes roll back,
   with committed phase one and retained evidence unchanged.
4. Complete-install rerun preflight refusal; both raw-source reruns fail and
   roll back without catalog/data changes.
5. Partial 0181 installation is detected and refused by fresh-install preflight.
6. A deliberate conflicting object is detected; its fixture transaction rolls
   back and the clean-baseline preflight passes again.
7. Data/protection preservation, including real rejected mutations of student,
   BRO field/audit and free-term history, plus financial BRO scope rejection.
   The financial BRO append-only function/trigger are compared by identity and
   definition; this case does **not** fabricate a paid entitlement to exercise it.
8. Reversed 0182-before-0181 installation fails and rolls back.
9. Missing prerequisite and disabled existing protection are detected.

Failures are not converted to skips. The final PASS JSON exists only after all
nine cases pass. Offline checks include the existing 7 rehearsal tests, 8 tooling
policy tests, 24 schema/source tests, pinned packet/source validation and database
model TypeScript check. Installation dependencies use a frozen lockfile and
disabled lifecycle scripts; no application is started.

The injected failure inputs are in-memory copies; source SQL is never edited.
`current.functions.sql` and `current.triggers.sql` are never executed alongside
the complete 0181/0182 path. Every source/protection/model remains untouched.

## Evidence and limits

Use the actual Actions run URL/commit, version/provenance output and per-scenario
results as evidence. A static check, uploaded branch or accepted dispatch is not
a passed PostgreSQL rehearsal. Before a real job completes, all real scenarios
remain **unexecuted**. A failed harness comparator is not permission to change
financial source definitions; report it and stop.

This does not install anything on Replit, repair migration ledgers, validate
Production data or approve payment/subscription release. It performs no provider
requests and uses no application credentials. The existing operator procedure in
`docs/current-finance-installation-runbook.md` and its approval boundaries remain
applicable.
