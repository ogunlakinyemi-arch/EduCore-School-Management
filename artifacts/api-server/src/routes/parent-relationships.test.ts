import { afterAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

// Never use the application's DATABASE_URL, even for rollback-only tests:
// sequence increments survive rollback. This optional integration test requires
// an explicitly acknowledged existing disposable loopback database.
const testUrl = process.env.EDUCORE_PARENT_RELATIONSHIP_TEST_DATABASE_URL;
let pool: any;
if (testUrl) {
  const url = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !/^\/educore_disposable_[a-z0-9_]+$/.test(url.pathname) ||
      process.env.EDUCORE_PARENT_TEST_ISOLATED !== "confirmed-disposable") {
    throw Error("Parent relationship tests require an explicitly confirmed disposable loopback database");
  }
  const require = createRequire(new URL("../../../../lib/db/package.json", import.meta.url));
  const { Pool } = require("pg");
  pool = new Pool({ connectionString: testUrl, connectionTimeoutMillis: 3000 });
}

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!testUrl)("parent-student relationship database rules", () => {
  it("supports many-to-many links and rejects duplicate relationships", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const students = await client.query(
        `SELECT id, school_id FROM students ORDER BY id LIMIT 2`,
      );
      expect(students.rows).toHaveLength(2);
      expect(students.rows[0].school_id).toBe(students.rows[1].school_id);

      const parentA = await client.query(
        `INSERT INTO parents (school_id, name, email, phone)
         VALUES ($1, 'Security Test Parent A', 'phase2-a@example.test', '08000000001')
         RETURNING id`,
        [students.rows[0].school_id],
      );
      const parentB = await client.query(
        `INSERT INTO parents (school_id, name, email, phone)
         VALUES ($1, 'Security Test Parent B', 'phase2-b@example.test', '08000000002')
         RETURNING id`,
        [students.rows[0].school_id],
      );

      await client.query(
        `INSERT INTO parent_student_relationships (parent_id, student_id)
         VALUES ($1, $2), ($1, $3), ($4, $2)`,
        [
          parentA.rows[0].id,
          students.rows[0].id,
          students.rows[1].id,
          parentB.rows[0].id,
        ],
      );

      const links = await client.query(
        `SELECT parent_id, student_id FROM parent_student_relationships
         WHERE parent_id IN ($1, $2)`,
        [parentA.rows[0].id, parentB.rows[0].id],
      );
      expect(links.rows).toHaveLength(3);

      await expect(
        client.query(
          `INSERT INTO parent_student_relationships (parent_id, student_id)
           VALUES ($1, $2)`,
          [parentA.rows[0].id, students.rows[0].id],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});