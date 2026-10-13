import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseBaseline, parseMigrationProof, parseFixtureManifest,
  requireSchoolId, requireOwnedIdentity, requireSnapshot } from "./expansion-fixture-types";

const identity = { db: "offline_fixture", started: "fixture_start", school_ids_hash: "fixture_hash", schools: 9 };
const baseline = { identity, records: { schools: { count: 9, digest: "fixture_digest" } } };
const proof = { identity, migrations: ["fixture_migration"], preservedTables: 1,
  portals: { portals: 9, open: 0 }, ledgerBefore: { count: 1, digest: "fixture_digest" } };
const fixture = () => ({
  label: "offline-fixture", nonce: "synthetic", createdAt: "fixture_time", state: "PREPARING",
  developmentIdentity: identity, baselineSha256: "synthetic", migrationProofSha256: "synthetic",
  clerkManagementStatus: "managed", fixtureIdentities: [{ role: "parent1", firstName: "Fixture",
    lastName: "Parent", email: "fixture@example.com", clerkUserId: null, appUserId: null }],
  ids: { schoolId: null, classAId: null, classBId: null, sourceSessionId: null, targetSessionId: null,
    sourceTermId: null, targetTermId: null, student1Id: null, student2Id: null, parent1Id: null,
    parent2Id: null, employeeId: null, partnerProfileId: null, parent1StudentLinkId: null, parent2StudentLinkId: null },
  cleanupPlanDigest: null, cleanupPlanCounts: null,
});
test("validates offline baseline and proof without database or provider access", () => {
  assert.deepEqual(parseBaseline(baseline), baseline);
  assert.deepEqual(parseMigrationProof(proof), proof);
  assert.equal(parseBaseline({ ...baseline, identity: { ...identity, schools: "9" } }).identity.schools, "9");
});
test("rejects malformed baseline/proof rows and counts", () => {
  for (const value of [null, [], {}, { ...baseline, records: { schools: { count: -1, digest: "x" } } },
    { ...baseline, identity: { ...identity, schools: "NaN" } }])
    assert.throws(() => parseBaseline(value));
  for (const value of [null, {}, { ...proof, migrations: [1] }, { ...proof, portals: { portals: 9, open: -1 } },
    { ...proof, ledgerBefore: { count: "1", digest: "x" } }])
    assert.throws(() => parseMigrationProof(value));
});
test("accepts a preparing manifest but refuses incomplete operational ownership", () => {
  const manifest = parseFixtureManifest(fixture());
  assert.throws(() => requireSchoolId(manifest));
  assert.throws(() => requireOwnedIdentity(manifest.fixtureIdentities[0]));
  assert.throws(() => requireSnapshot(manifest));
  manifest.ids.schoolId = 1;
  manifest.fixtureIdentities[0].appUserId = 2;
  manifest.fixtureIdentities[0].clerkUserId = "synthetic_clerk";
  assert.equal(requireSchoolId(manifest), 1);
  assert.equal(requireOwnedIdentity(manifest.fixtureIdentities[0]).appUserId, 2);
});
test("rejects malformed ownership IDs, identities and preservation snapshots", () => {
  for (const value of [null, {}, { ...fixture(), ids: { schoolId: 1 } },
    { ...fixture(), ids: { ...fixture().ids, schoolId: -1 } },
    { ...fixture(), fixtureIdentities: [{ ...fixture().fixtureIdentities[0], appUserId: "2" }] },
    { ...fixture(), preservationSnapshot: { schools: { columns: ["id"], hashes: { digest: -1 }, count: 1 } } },
    { ...fixture(), cleanupPlanCounts: { scopedTables: "1", retentionLocks: 3, temporaryTriggerChanges: 0 } }])
    assert.throws(() => parseFixtureManifest(value));
});
