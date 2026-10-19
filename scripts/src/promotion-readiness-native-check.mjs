// Execute the actual preview query only against a freshly created local cluster.
// No application connection string, environment credential or migration is used.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const scratch = mkdtempSync("/tmp/educore-promotion-preview.");
const data = `${scratch}/data`;
let started = false;
const run = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const psql = args => run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-h", scratch, "-p", "55482", "-U", "postgres", "-d", "postgres", ...args]);
try {
  run("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "--no-locale", "--encoding=UTF8", "--no-sync"]);
  run("pg_ctl", ["-D", data, "-l", `${scratch}/server.log`, "-o", `-k ${scratch} -h '' -p 55482`, "-w", "-t", "45", "start"]);
  started = true;
  psql(["-f", fileURLToPath(new URL("./promotion-readiness-fixture.sql", import.meta.url))]);
  const source = readFileSync(new URL("../../artifacts/api-server/src/services/promotion-readiness.ts", import.meta.url), "utf8");
  const sql = source.match(/`(WITH placements AS[\s\S]*?)`/)?.[1];
  assert.ok(sql, "Could not locate actual preview evidence SQL; update this check before relying on it");
  const query = values => {
    const bound = sql.replace(/\$(\d+)/g, (_, number) => {
      const value = values[Number(number) - 1];
      assert.ok(value === null || Number.isSafeInteger(value));
      return value === null ? "NULL::integer" : String(value);
    });
    return JSON.parse(psql(["-At", "-c", `SELECT row_to_json(q) FROM (${bound}) q`]).trim());
  };
  assert.deepEqual(query([1, 10, 102]), {
    cohortCount: 3, placementConflictCount: 1, studentsWithPublishedResults: 2, publishedResultCount: 2,
  });
  assert.deepEqual(query([1, 10, null]), {
    cohortCount: 3, placementConflictCount: 1, studentsWithPublishedResults: 0, publishedResultCount: 0,
  });
  assert.equal(query([1, 999, 102]).cohortCount, 0);
  assert.equal(query([2, 10, 102]).cohortCount, 1);
  console.log("Native promotion-preview SQL checks passed: published Third only, tenant/session/placement scope, conflicts, missing term and empty cohort.");
} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  rmSync(scratch, { recursive: true, force: true });
}
