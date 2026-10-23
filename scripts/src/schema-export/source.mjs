// The only standalone Drizzle capture boundary used by our export workflows.
// Vendor stdout is evidence, never the executable workflow output.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { inspectModel } from "./model.mjs";
import { orderExport } from "./graph.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
export function schemaSourceHashes(root) {
  const directory = path.join(root, "lib/db/src/schema");
  return Object.fromEntries(fs.readdirSync(directory, { recursive: true })
    .filter(f => f.endsWith(".ts")).sort()
    .map(f => [f, hash(fs.readFileSync(path.join(directory, f)))]));
}

export function prepareExport(rawEvidenceSql, model) {
  const plan = orderExport(rawEvidenceSql, model);
  // Independently enforce the emitter's phase contract, not just its DAG edges.
  // Inline keys and CHECKs stay in their original CREATE TABLE statements.
  let seenForeignKey = false;
  for (const node of plan.nodes) {
    if (node.kind === "fk") seenForeignKey = true;
    if (seenForeignKey && node.kind !== "fk") {
      throw new Error("Export ordering refused: table/key/index after a foreign key");
    }
  }
  return { rawEvidenceSql, orderedSql: plan.statements.join("\n\n") + "\n", plan };
}

export async function captureOrderedExport(root) {
  const sourceHashes = schemaSourceHashes(root);
  const result = spawnSync(process.execPath, [
    path.join(root, "lib/db/node_modules/drizzle-kit/bin.cjs"), "export",
    "--dialect", "postgresql", "--schema", "./src/schema/index.ts",
  ], {
    cwd: path.join(root, "lib/db"), encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "", LANG: "C.UTF-8" },
  });
  if (result.status !== 0 || result.error) {
    throw new Error("Offline standalone export failed; status=" + result.status + "; " +
      (result.error?.message || result.stderr?.slice(0, 1000)));
  }
  const model = await inspectModel(root);
  const prepared = prepareExport(result.stdout, model);
  if (JSON.stringify(sourceHashes) !== JSON.stringify(schemaSourceHashes(root))) {
    throw new Error("Schema source changed while exporting; refuse a mixed snapshot");
  }
  return { ...prepared, model, sourceHashes };
}
