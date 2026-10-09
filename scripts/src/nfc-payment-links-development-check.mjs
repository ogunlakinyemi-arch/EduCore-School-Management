import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { pool } from "../../lib/db/src/index.ts";
import { nfcLinkTokenHash, publicLinkSql, simulateNfcLink } from "../../artifacts/api-server/src/services/nfc-payment-links.ts";
const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT ||
    process.env.NFC_LINK_CHECK_CONFIRM !== "verify-development-links" || !process.env.NFC_LINK_EXPECTED_DB_START) {
  throw Error("Explicit independently confirmed Development target required");
}
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const f = (await db.query("SELECT current_database() name,inet_server_addr() host,pg_postmaster_start_time() started")).rows[0];
  assert.equal(f.name, "heliumdb"); assert.equal(f.host, null);
  assert.equal(new Date(f.started).toISOString(), process.env.NFC_LINK_EXPECTED_DB_START);
  await db.query("BEGIN");
  // Existing owned synthetic record; all new link data is rolled back.
  const scope = (await db.query(`SELECT b.* FROM student_subscription_terms b
    JOIN subscriptions s ON s.id=b.subscription_id JOIN schools sc ON sc.id=b.school_id
    WHERE b.school_id=1496 AND b.student_id=773 AND sc.name LIKE 'Academic Calendar QA %'
      AND LOWER(s.status)='pending' AND LOWER(s.verification_status)<>'verified'
    ORDER BY b.academic_term_id DESC LIMIT 1`)).rows[0];
  assert.ok(scope, "Existing owned synthetic pending subscription required");
  const original = (await db.query("SELECT row_to_json(s) AS data FROM subscriptions s WHERE id=$1", [scope.subscription_id])).rows[0].data;
  const paymentsBefore = (await db.query("SELECT count(*) FROM student_subscription_payments WHERE subscription_id=$1", [scope.subscription_id])).rows[0].count;
  const tokens = [];
  for (let i = 0; i < 5; i++) {
    const token = randomBytes(32).toString("base64url"); tokens.push(token);
    await db.query(`INSERT INTO nfc_payment_links(school_id,student_id,subscription_id,academic_session_id,academic_term_id,
      created_by,reference,token_hash,mode,status,expected_allocations,expires_at)
      VALUES($1,$2,$3,$4,$5,966,$6,$7,'DEVELOPMENT_SIMULATION',$8,$9::jsonb,$10)`,
      [scope.school_id,scope.student_id,scope.subscription_id,scope.academic_session_id,scope.academic_term_id,
        `QA_${randomBytes(12).toString("hex")}`,nfcLinkTokenHash(token),i===3?"CANCELLED":"PENDING",
        JSON.stringify([{recipientType:"SCHOOL",amountMinor:200000},{recipientType:"PLATFORM",amountMinor:300000}]),
        new Date(Date.now()+(i===4?-10000:3600000))]);
  }
  assert.equal((await db.query(publicLinkSql,[nfcLinkTokenHash(tokens[0])])).rows[0].status,"PENDING");
  assert.equal((await simulateNfcLink(db,tokens[0],"SUCCESS")).status,"SIMULATED_SUCCESS");
  assert.equal((await simulateNfcLink(db,tokens[0],"SUCCESS")).status,"SIMULATED_SUCCESS");
  assert.equal((await simulateNfcLink(db,tokens[0],"FAILED")).status,"SIMULATED_SUCCESS");
  assert.equal((await simulateNfcLink(db,tokens[1],"FAILED")).status,"SIMULATED_FAILED");
  assert.equal((await simulateNfcLink(db,tokens[1],"SUCCESS")).status,"SIMULATED_FAILED");
  await assert.rejects(simulateNfcLink(db,tokens[3],"SUCCESS"));
  await assert.rejects(simulateNfcLink(db,tokens[4],"SUCCESS"));
  await assert.rejects(simulateNfcLink(db,randomBytes(32).toString("base64url"),"SUCCESS"));
  const originalAfter = (await db.query("SELECT row_to_json(s) AS data FROM subscriptions s WHERE id=$1",[scope.subscription_id])).rows[0].data;
  assert.deepEqual(originalAfter,original);
  assert.equal((await db.query("SELECT count(*) FROM student_subscription_payments WHERE subscription_id=$1",[scope.subscription_id])).rows[0].count,paymentsBefore);
  console.log("PASS: real PostgreSQL pending/success/failure/expiry/cancellation/invalid/duplicate/retry isolation; subscription and payment ledger unchanged");
} finally {
  await db.query("ROLLBACK"); await db.end(); await pool.end();
}
