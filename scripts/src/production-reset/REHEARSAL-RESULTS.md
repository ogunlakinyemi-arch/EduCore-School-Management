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
