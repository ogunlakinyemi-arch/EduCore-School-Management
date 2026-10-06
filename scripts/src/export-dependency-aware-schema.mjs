import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { inspectModel } from "./schema-export/model.mjs";
import { orderExport } from "./schema-export/graph.mjs";
import { migrationEvidence } from "./schema-export/provenance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
function schemaHashes(directory) {
  return Object.fromEntries(fs.readdirSync(directory, { recursive: true }).filter(f => f.endsWith(".ts")).sort().map(f => [
    f, createHash("sha256").update(fs.readFileSync(path.join(directory, f))).digest("hex"),
  ]));
}
function rejectSymlinks(resolved) {
  for (let current = resolved;; current = path.dirname(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Audit output must not traverse symlinks");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (current === path.dirname(current)) break;
  }
}
export function auditOutputPath(output, workspaceRoot = root) {
  const resolved = path.resolve(output);
  if (!resolved.endsWith(".sql") || !(resolved.startsWith("/tmp/") || resolved.startsWith(path.join(workspaceRoot, "reports") + path.sep))) {
    throw new Error("SQL output must be an audit .sql file below /tmp or this workspace's reports directory, never a migration directory");
  }
  rejectSymlinks(resolved);
  rejectSymlinks(resolved + ".graph.json");
  return resolved;
}

export async function exportAudit(output) {
  const sqlPath = auditOutputPath(output);
  const schemaDirectory = path.join(root, "lib/db/src/schema");
  const beforeHashes = schemaHashes(schemaDirectory);
  const processResult = spawnSync(process.execPath, [
    path.join(root, "lib/db/node_modules/drizzle-kit/bin.cjs"), "export",
    "--dialect", "postgresql", "--schema", "./src/schema/index.ts",
  ], {
    cwd: path.join(root, "lib/db"), encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    // No database credentials or configuration are inherited or loaded.
    env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "", LANG: "C.UTF-8" },
  });
  if (processResult.status !== 0 || processResult.error) {
    throw new Error("Read-only standalone Drizzle export failed; status=" + processResult.status + "; " + (processResult.error?.message || processResult.stderr.slice(0, 1000)));
  }
  const model = await inspectModel(root), plan = orderExport(processResult.stdout, model);
  if (JSON.stringify(beforeHashes) !== JSON.stringify(schemaHashes(schemaDirectory))) {
    throw new Error("Schema source changed while exporting; refuse a mixed snapshot");
  }
  const provenance = migrationEvidence(path.join(root, "lib/db/drizzle"), plan.foreignKeys);
  const manifest = {
    label: "DISPOSABLE / AUDIT ONLY — NOT FOR PRODUCTION EXECUTION",
    ...plan, provenance, sqlPath: undefined,
    schemaSourceHashes: beforeHashes,
    expected: { tables: model.tables.length, checks: model.tables.reduce((n, t) => n + t.checks.length, 0), foreignKeys: plan.foreignKeys.length },
  };
  // No connection, execution, migration, push, ledger or publish capability exists.
  const header = "-- DISPOSABLE / AUDIT ONLY — NOT FOR PRODUCTION EXECUTION\n-- Export-only dependency ordering; no DDL statements added or removed.\n";
  fs.mkdirSync(path.dirname(sqlPath), { recursive: true });
  fs.writeFileSync(sqlPath, header + plan.statements.join("\n\n") + "\n");
  const { statements, ...graph } = manifest;
  fs.writeFileSync(sqlPath + ".graph.json", JSON.stringify(graph, null, 2) + "\n");
  return { sqlPath, graphPath: sqlPath + ".graph.json", statements: plan.statementCount, ...manifest.expected };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--out") {
    console.error("Usage: pnpm --filter @workspace/scripts run export:schema:audit --out /tmp/audit-schema.sql\nExport only. No database URL, execution, migration or push options.");
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await exportAudit(args[1]))); }
    catch (e) { console.error("Dependency-aware export refused: " + e.message); process.exitCode = 1; }
  }
}
