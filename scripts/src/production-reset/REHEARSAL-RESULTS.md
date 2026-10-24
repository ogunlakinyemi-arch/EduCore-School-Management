# Isolated verification result — 2026-10-24

**PASS — fictional local fixtures only. Production cleanup is NOT safe/ready.**

Executed the documented relationship rehearsal and the opt-in
`executor-isolated.mjs` harness in a fresh PostgreSQL **16.10** cluster.
TCP was disabled; connections used an owned private Unix socket. The pre-existing
NFC hardware-test database was not used or changed. The disposable cluster was
stopped and removed by the procedure.

## Actual database checks passed

- Generated preflight SQL ran successfully against the fictional schema.
- Audit, finance, inactive membership, credential, assignment-history and durable
  binding FKs refused tenant-root deletion with the expected constraint names.
- Fictional nullable device unassignment and inactive-label demonstrations rolled
  back; preserved rows, Owner, schema, ledger, FKs and sequence state were unchanged.
- **Actual executor:** real local DELETE followed by injected row-count failure
  rolled back and restored the complete fixture.
- **Actual executor:** real student AND school DELETEs followed by an injected
  post-check evidence mismatch rolled back and restored the complete fixture.
- **Actual executor:** another local session caused refusal and rollback.
- **Actual executor:** preserved audit, payment, membership and device history
  blocked execution before constructing a connection.
- **Actual executor:** adding protected history invalidated a previously ready
  preview; rechecking under locks refused deletion and rolled back.

The injections exercise real PostgreSQL transactions and DELETE/ROLLBACK behavior,
not Production outages or a successful real reset. The harness sends **zero
COMMIT statements** and never deletes/detaches its protected fictional history to
make a gate pass. Synthetic authorization/backup claims exist only in test memory;
they are not Production binding/restore evidence.

Production connections: **0**. Production mutations: **0**.
No shared settings, secrets, migrations, workflows or published app were changed.

## Tested source identity

- Generated relationship fixture SQL SHA-256:
  `87bd410b17c129b93bf878859fbb696bbe11e3d01d11fbf7095c7e9232c44eec`
- Production cleanup executor source SHA-256:
  `481030d3e42231f1297f231229385a9c3766f9119299153b094c756e8cf29c70`

## Remaining blockers

The preserve-in-place policy still requires referenced tenant/person/class/term
ancestors. There is no approved, implemented and verified Production archive or
detachment path that preserves all historical relationships while removing those
ancestors. No Production state was queried or inferred by this test.

Accept retaining the required test-tenant records, or separately approve and test
a lineage-preserving operational archive outcome. An inactive label alone is not
proven to enforce archival across app access, workers, payments or callbacks.
Fresh Production resource, recovery/restore and maintenance evidence would also
remain necessary before any separately authorized operation.

## Separate existing-account access-revocation receipt

The scoped access implementation was tested in another freshly created private
PostgreSQL **16.10** cluster with TCP disabled, using only its owned Unix socket.
The cluster was stopped and removed by the guarded shell afterward; the existing
NFC hardware-test database was not used.

**PASS — 12 actual PostgreSQL checks:**

1. Exact membership/roster/Partner/staff/invitation capture; Owner exempt.
2. Rolling back the control append restores access and all protected rows.
3. A competing association-table lock refuses without a partial archive.
4. An unreviewed audit INSERT trigger refuses without archiving.
5. Existing test school, Partner owner/staff and former-associated accounts denied.
6. Platform Owner and unrelated school/Partner accounts allowed.
7. Same-email new identity, invitation and Partner-link re-entry denied.
8. A later membership cannot reopen an archived school.
9. Existing audit, financial, membership, device/card and provenance rows unchanged.
10. Owner restoration is append-only and restores the prior access boundary.
11. A mixed legitimate/test identity refuses the whole batch.
12. A non-Owner cannot apply or restore a batch.

This separate harness committed **only fictional control events** to prove
durable block/restore behavior. It did not run the Production operator CLI.
The earlier deletion-executor receipt and its zero-COMMIT statement still refer
only to that earlier rollback-only harness.

- Access-control module SHA-256:
  `d7ee8534d8e6e4b70d75f8b19e6949df47ad54b3466cc2f7bdcc209297c82ade`
- Focused offline reset/access tests: **53 passed**.
- Focused backend authentication, re-entry and invitation regressions: **131 passed**.
- API TypeScript check: **passed**.
- Production connections/mutations: **0 / 0**.
- External Clerk mutations: **0**. Shared settings/secrets and publishing: **unchanged**.

The operating boundary and remaining whole-system archival limitations are in
`ACCESS-ARCHIVE.md`. This is local implementation evidence, not permission or
readiness evidence for a real account revocation.

## Same-email Partner reapplication refinement

The earlier access receipt above describes the original email-denial policy.
The explicit fresh-account exception is documented in `PARTNER-REAPPLICATION.md`;
ordinary old-account and generic same-email re-entry denials remain enforced.

- **11 actual local PostgreSQL/HTTP tests passed:** new same-email application,
  blank privileges/pending approval, old-session/refreshed-token denial, new
  Partner profile/role only, active duplicate rejection, idempotent pending-request
  recovery, later fresh sessions, separate Owner restoration, independent
  new-profile archival/restoration, verified Partner-only input and repeated fresh
  reapplication after a subsequent archive without consuming the new session.
- Archived user, application, profile, memberships, invitations, finance and
  device/card/history ownership remained unchanged in the preservation checks.
- The real migration preserved populated fixture rows and refused duplicate
  application atomically. It was not applied to any shared database.
- **3 new React component tests passed**, plus **20 existing application UI tests**.
- **112 authentication/invitation regressions** and **53 offline reset tests** passed.
- API build and API/web TypeScript checks passed.
- OpenAPI clients and validators were regenerated before verification.
- Provider calls were mocked; no new or changed Clerk identities or real sends.
- Production connections/mutations, shared settings/secrets and publishing: **none**.

Tested reapplication service SHA-256:
`583a62d9412ee549389cc4567a931f7aef93b12efbf8e2e98da54933e8cf0827`.
The 12 original access-archive PostgreSQL checks also passed again with the
updated account-aware archive planner.
Live authenticated browser/Clerk verification was not performed.
