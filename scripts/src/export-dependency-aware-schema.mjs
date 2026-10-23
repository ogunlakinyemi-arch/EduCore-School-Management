import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { verifyRequiredTenantKeys } from "./schema-export/required-tenant-keys.mjs";
import { captureOrderedExport } from "./schema-export/source.mjs";
import { migrationEvidence } from "./schema-export/provenance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const AUDIT_HEADER = "-- DISPOSABLE / AUDIT ONLY — NOT FOR PRODUCTION EXECUTION\n-- Export-only dependency ordering; no DDL statements added or removed.\n";
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
  rejectSymlinks(resolved + ".raw.sql");
  rejectSymlinks(resolved + ".json");
  return resolved;
}

export async function exportAudit(output) {
  const sqlPath = auditOutputPath(output);
  const { model, plan, rawEvidenceSql, orderedSql, sourceHashes } = await captureOrderedExport(root);
  const requiredTenantKeys = verifyRequiredTenantKeys(model);
  const provenance = migrationEvidence(path.join(root, "lib/db/drizzle"), plan.foreignKeys);
  const manifest = {
    label: "DISPOSABLE / AUDIT ONLY — NOT FOR PRODUCTION EXECUTION",
    ...plan, provenance, sqlPath: undefined,
    requiredTenantKeys,
    schemaSourceHashes: sourceHashes,
    rawEvidencePath: sqlPath + ".raw.sql",
    rawEvidenceExecutable: false,
    rawSha256: createHash("sha256").update(rawEvidenceSql).digest("hex"),
    orderedSha256: createHash("sha256").update(orderedSql).digest("hex"),
    expected: { tables: model.tables.length, checks: model.tables.reduce((n, t) => n + t.checks.length, 0), foreignKeys: plan.foreignKeys.length },
  };
  // No connection, execution, migration, push, ledger or publish capability exists.
  fs.mkdirSync(path.dirname(sqlPath), { recursive: true });
  fs.writeFileSync(sqlPath, AUDIT_HEADER + orderedSql);
  fs.writeFileSync(sqlPath + ".raw.sql", rawEvidenceSql);
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
