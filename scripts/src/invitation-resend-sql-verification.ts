/**
 * Read-only regression check for the real invitation UPDATE statements.
 * Run from scripts: pnpm exec tsx src/invitation-resend-sql-verification.ts
 * EXPLAIN (without ANALYZE) parses/binds the SQL but never executes an UPDATE.
 */
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

async function main() {
  const identity = await pool.query("SELECT current_database() AS name, inet_server_addr() AS address");
  if (identity.rows[0]?.name !== "heliumdb" || identity.rows[0]?.address !== null) {
    throw new Error("This check requires the independently verified local Development database");
  }
  const source = await readFile(
    new URL("../../artifacts/api-server/src/routes/school-invitations.ts", import.meta.url),
    "utf8",
  );
  const updates = [...source.matchAll(/`(UPDATE audit_logs[\s\S]*?)`/g)]
    .map(match => match[1])
    .filter(sql => sql.includes("jsonb_build_object") &&
      /'providerInvitationId'|'replacementInvitationId'|'supersededByClaimId'/.test(sql));
  if (updates.length !== 3) throw new Error("Expected all three invitation lifecycle JSON updates");
  const claim = "00000000-0000-4000-8000-000000000000";
  for (const sql of updates) {
    const parameters = sql.includes("'supersededByClaimId'")
      ? [claim, claim, 0, 0]
      : sql.includes("'providerInvitationId'")
        ? ["inv_sql_regression_check", 0]
        : ["inv_sql_regression_check", 0, claim];
    await pool.query(`EXPLAIN ${sql}`, parameters);
  }
  console.log("PASS: all 3 invitation lifecycle updates bind correctly in PostgreSQL; no data written.");
}

main().catch(error => {
  console.error({ code: error.code ?? "CHECK_FAILED", message: error.message });
  process.exitCode = 1;
}).finally(() => pool.end());
