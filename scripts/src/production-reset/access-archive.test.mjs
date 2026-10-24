import test from "node:test";
import assert from "node:assert/strict";
import { activeAccessArchives, assertArchiveAccess } from "./access-archive.mjs";
import { archiveAccessMain } from "./archive-access-cli.mjs";

const event = { version: 1, batchId: "a".repeat(64), operation: "BLOCK",
  schoolIds: [9], partnerIds: [3], userIds: [2], emails: ["test@fictional.invalid"] };
const db = events => ({ query: async () => ({ rows: events.map(metadata => ({ metadata })) }) });

test("archive ledger rejects a restore without its original block", async () => {
  await assert.rejects(activeAccessArchives(db([{ ...event, operation: "RESTORE" }])), /INVALID_ARCHIVE_LEDGER_CHAIN/);
});
test("archive ledger rejects a restore with changed identities or scope", async () => {
  await assert.rejects(activeAccessArchives(db([event, { ...event, operation: "RESTORE", userIds: [] }])),
    /INVALID_ARCHIVE_LEDGER_CHAIN/);
});
test("archive ledger rejects malformed, unsorted and duplicate scopes", async () => {
  for (const value of [{ schoolIds: [] ,partnerIds: [] }, { userIds: [2,2] }, { schoolIds: [9,3] },
    { batchId: "bad" }, { emails: ["NOT-NORMALIZED@fictional.invalid"] }]) {
    await assert.rejects(activeAccessArchives(db([{ ...event, ...value }])));
  }
});
test("archive ledger retains other active batches when one is restored", async () => {
  const other = { ...event, batchId: "b".repeat(64), userIds: [7] };
  assert.deepEqual(await activeAccessArchives(db([event, other, { ...event, operation: "RESTORE" }])), [other]);
});
test("root invitation/referral checks have no Owner override", async () => {
  await assert.rejects(assertArchiveAccess(db([event]), { userId: 1, schoolId: 9 }), /ARCHIVED_TEST_ACCESS_BLOCKED/);
  await assert.rejects(assertArchiveAccess(db([event]), { userId: 1, partnerId: 3 }), /ARCHIVED_TEST_ACCESS_BLOCKED/);
});
test("offline archive CLI opens no client and makes no mutation", async () => {
  let constructed = 0, result;
  const status = await archiveAccessMain(["--school-ids","9","--partner-ids","3"],
    value => { result = JSON.parse(value); }, { clientFactory: () => { constructed++; throw Error("must not connect"); } });
  assert.equal(status, 2); assert.equal(constructed, 0);
  assert.equal(result.databaseConnectionsOpened, 0); assert.equal(result.mutationsPerformed, 0);
});
test("archive CLI refuses unsafe/ambiguous flags and empty scope before client construction", async () => {
  let constructed = 0;
  for (const args of [[], ["--all"], ["--school-ids","9","--force"], ["--school-ids","9","--preview","--execute"],
    ["--school-ids","9","--school-ids","77"], ["--partner-ids","0"], ["--school-ids","9","--execute"]]) {
    await assert.rejects(archiveAccessMain(args, () => {}, { clientFactory: () => { constructed++; throw Error("must not connect"); } }));
  }
  assert.equal(constructed, 0);
});
