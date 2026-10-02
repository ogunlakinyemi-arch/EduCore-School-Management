// All lifecycle simulations are confined to owned Development fixtures and
// rolled back; this does not substitute for the real UI assignment checks.
import { pool } from "../../lib/db/src/index";
import { readFile } from "node:fs/promises";
import { printableCardSnapshotSql, resolvePrintableIdentity } from "../../artifacts/api-server/src/lib/nfc-printable-snapshot";
async function main() {
const f = JSON.parse(await readFile("/tmp/nfc-print-fixture.json", "utf8"));
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const identity = (await client.query("SELECT current_database() AS db,pg_postmaster_start_time()::text AS started")).rows[0];
  if (identity.db !== f.identity.db || identity.started !== f.identity.started) throw Error("Development target changed");
  if (!(await client.query("SELECT 1 FROM schools WHERE id=$1 AND code=$2", [f.schoolId, f.tag])).rowCount) throw Error("Fixture ownership lost");
  const snapshot = async (id: number) => (await client.query(printableCardSnapshotSql, [id, f.schoolId])).rows[0];
  const before = resolvePrintableIdentity(await snapshot(f.cards[0].id));
  await client.query("UPDATE nfc_cards SET status='revoked' WHERE id=$1 AND school_id=$2", [f.cards[0].id, f.schoolId]);
  let denied = false;
  try { resolvePrintableIdentity(await snapshot(f.cards[0].id)); } catch (error: any) { denied = error.statusCode === 409; }
  if (!denied) throw Error("Revoked card remained printable");
  await client.query("UPDATE nfc_cards SET status='active',student_id=$1 WHERE id=$2 AND school_id=$3", [f.studentIds[1], f.cards[0].id, f.schoolId]);
  const reassigned = resolvePrintableIdentity(await snapshot(f.cards[0].id));
  if (before.personName === reassigned.personName || before.permanentNumber === reassigned.permanentNumber || !reassigned.personName.endsWith("Reassigned")) throw Error("Reassigned card leaked former person's identity");
  const wrong = await client.query(printableCardSnapshotSql, [f.cards[0].id, 1]);
  if (wrong.rows.length) throw Error("Cross-school card data exposed");
  console.log({ revokedDenied: true, reassignedShowsCurrentIdentityOnly: true, crossSchoolQueryReturnsNoData: true, allLifecycleMutationsRolledBack: true });
} finally {
  await client.query("ROLLBACK");
  client.release();
  await pool.end();
}
}
void main();