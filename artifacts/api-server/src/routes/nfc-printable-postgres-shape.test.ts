import { describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { printableCardSnapshotSql } from "../lib/nfc-printable-snapshot";

// Only run against a deliberately supplied disposable/read-only development
// database. The test issues EXPLAIN inside a read-only transaction; it does not
// create fixtures, read card data, or mutate the database.
const url = process.env.NFC_PRINTABLE_READONLY_TEST_DATABASE_URL;
const safeTarget = Boolean(url && url === process.env.DATABASE_URL);

describe.skipIf(!safeTarget)("NFC printable PostgreSQL query shape", () => {
  it("parses and plans the actual joined snapshot SQL on PostgreSQL", async () => {
    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN READ ONLY");
      transactionStarted = true;
      const planned = await client.query(`EXPLAIN (FORMAT JSON) ${printableCardSnapshotSql}`, [1, 1]);
      expect(planned.rows[0]?.["QUERY PLAN"]).toBeTruthy();
    } finally {
      if (transactionStarted) await client.query("ROLLBACK");
      client.release();
    }
  });
});