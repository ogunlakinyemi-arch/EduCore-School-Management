import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareExport } from "./source.mjs";
import { splitSql } from "./sql.mjs";
import { auditOutputPath } from "../export-dependency-aware-schema.mjs";

// Same five-column dependency as the original 42830, not a missing-model-key fixture.
function originalDependency() {
  const columns = ["id", "employee_id", "school_id", "academic_session_id", "academic_term_id"];
  const parent = "staff_nfc_subscriptions", child = "staff_nfc_allocations";
  const name = "staff_nfc_subscriptions_id_employee_school_term_uq";
  const fk = { name: "staff_nfc_allocations_subscription_owner_term_fk",
    child: "public." + child, parent: "public." + parent,
    childColumns: columns, parentColumns: columns };
  const table = name => ({ id: "public." + name, name, schema: "public",
    keys: [], indexes: [], checks: [], types: [], foreignKeys: [] });
  const p = table(parent), c = table(child);
  p.keys = [{ name, kind: "unique_index", columns }];
  p.indexes = [{ name, unique: true, partial: false }];
  c.foreignKeys = [fk];
  const cols = columns.map(c => `"${c}"`).join(",");
  const raw = [
    `CREATE TABLE "${parent}" (${columns.map(c => `"${c}" integer`).join(",")}, CONSTRAINT "retained_check" CHECK ("id" BETWEEN 1 AND 7));`,
    `CREATE TABLE "${child}" (${columns.map(c => `"${c}" integer`).join(",")});`,
    `ALTER TABLE "${child}" ADD CONSTRAINT "${fk.name}" FOREIGN KEY (${cols}) REFERENCES "${parent}" (${cols});`,
    `CREATE UNIQUE INDEX "${name}" ON "${parent}" USING btree (${cols});`,
  ].join("\n");
  return { raw, model: { tables: [p, c] } };
}

test("workflow repairs original five-column late-index shape by permutation only", () => {
  const { raw, model } = originalDependency();
  const before = splitSql(raw), result = prepareExport(raw, model);
  assert.ok(before[2].startsWith("ALTER TABLE"));
  assert.ok(before[3].startsWith("CREATE UNIQUE INDEX"));
  const after = splitSql(result.orderedSql);
  assert.ok(after[2].startsWith("CREATE UNIQUE INDEX"));
  assert.equal(after[3], before[2]);
  assert.equal(result.rawEvidenceSql, raw);
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.equal(after.find(s => s.startsWith('CREATE TABLE "staff_nfc_subscriptions"')), before[0]);
  assert.match(after[0], /CHECK \("id" BETWEEN 1 AND 7\)/);
  assert.equal(prepareExport(result.orderedSql, model).orderedSql, result.orderedSql);
});

test("workflow refuses an absent qualifying index and unknown DDL instead of repairing definitions", () => {
  const { raw, model } = originalDependency();
  assert.throws(() => prepareExport(raw.slice(0, raw.lastIndexOf("CREATE UNIQUE INDEX")), model), /Missing\/mismatched model index/);
  assert.throws(() => prepareExport(raw + "\nDROP TABLE other;", model), /Unsupported export statement/);
});

test("both evidence sidecars reject symlinks before any export output is written", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "schema-sidecar-"));
  try {
    for (const suffix of [".raw.sql", ".json", ".graph.json"]) {
      const output = path.join(directory, "audit.sql");
      fs.symlinkSync(path.join(directory, "private-target"), output + suffix);
      assert.throws(() => auditOutputPath(output), /symlinks/);
      assert.equal(fs.existsSync(output), false);
      fs.unlinkSync(output + suffix);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
