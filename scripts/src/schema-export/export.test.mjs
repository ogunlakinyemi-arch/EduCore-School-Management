import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { orderExport } from "./graph.mjs";
import { inlineKeys, postgresIdentifier, splitSql } from "./sql.mjs";
import { migrationEvidence } from "./provenance.mjs";
import { auditOutputPath } from "../export-dependency-aware-schema.mjs";

function fixture() {
  const fk = { name: "child_parent_fk", child: "public.child", childColumns: ["parent_id", "school_id"], parent: "public.parent", parentColumns: ["id", "school_id"] };
  return {
    raw: 'CREATE TABLE "parent" ("id" integer PRIMARY KEY, "school_id" integer);\nCREATE TABLE "child" ("id" integer PRIMARY KEY, "parent_id" integer, "school_id" integer);\nALTER TABLE "child" ADD CONSTRAINT "child_parent_fk" FOREIGN KEY ("parent_id","school_id") REFERENCES "parent"("id","school_id") ON DELETE RESTRICT;\nCREATE UNIQUE INDEX "parent_pair" ON "parent" USING btree ("id","school_id");',
    model: { tables: [
      { id: "public.parent", name: "parent", schema: "public", types: [], checks: [], foreignKeys: [], indexes: [{ name: "parent_pair", unique: true, partial: false }], keys: [
        { name: "parent_pkey", kind: "primary", columns: ["id"] },
        { name: "parent_pair", kind: "unique_index", columns: ["id", "school_id"] },
      ] },
      { id: "public.child", name: "child", schema: "public", types: [], checks: [], foreignKeys: [fk], indexes: [], keys: [{ name: "child_pkey", kind: "primary", columns: ["id"] }] },
    ] },
  };
}

test("unique index precedes FK, with exact names/semantics and identical DDL multiset", () => {
  const { raw, model } = fixture(), plan = orderExport(raw, model);
  assert.ok(plan.statements.findIndex(s => s.startsWith("CREATE UNIQUE")) < plan.statements.findIndex(s => s.startsWith("ALTER")));
  assert.deepEqual([...plan.statements].sort(), splitSql(raw).sort());
  assert.equal(plan.foreignKeys[0].support.name, "parent_pair");
  assert.ok(plan.statements.some(s => s.includes("ON DELETE RESTRICT")));
});
test("deterministic even if raw SQL and model table arrays are shuffled", () => {
  const { raw, model } = fixture(), first = orderExport(raw, model);
  const reversed = orderExport(splitSql(raw).reverse().join("\n"), { tables: [...model.tables].reverse() });
  assert.deepEqual(first.statements, reversed.statements);
  assert.deepEqual(first.nodes, reversed.nodes);
});
test("reuse an inline primary key, without synthesizing an index", () => {
  const f = fixture(); f.model.tables[1].foreignKeys[0].childColumns = ["parent_id"];
  f.model.tables[1].foreignKeys[0].parentColumns = ["id"];
  f.raw = f.raw.replace('("parent_id","school_id") REFERENCES "parent"("id","school_id")', '("parent_id") REFERENCES "parent"("id")');
  assert.equal(orderExport(f.raw, f.model).foreignKeys[0].support.kind, "primary");
});
test("reuse inline UNIQUE constraint and preserve its ownership/name", () => {
  const f = fixture(); const parent = f.model.tables[0];
  parent.keys[1].kind = "unique_constraint"; parent.indexes = [];
  f.raw = f.raw.replace('"school_id" integer);', '"school_id" integer, CONSTRAINT "parent_pair" UNIQUE("id","school_id"));')
    .replace(/CREATE UNIQUE INDEX[\s\S]+$/, "");
  const plan = orderExport(f.raw, f.model);
  assert.equal(plan.foreignKeys[0].support.kind, "unique_constraint");
  assert.equal(plan.statements.length, 3);
});
for (const invalid of ["missing", "partial", "expression", "ordinary"]) {
  test("refuse " + invalid + " FK support instead of inventing a constraint", () => {
    const f = fixture(), parent = f.model.tables[0];
    if (invalid === "missing" || invalid === "ordinary") parent.keys.pop();
    else parent.keys[1][invalid] = true;
    assert.throws(() => orderExport(f.raw, f.model), /No qualifying/);
  });
}
test("reject duplicate exported indexes and conflicting inline index names", () => {
  const f = fixture();
  assert.throws(() => orderExport(f.raw + '\nCREATE UNIQUE INDEX "parent_pair" ON "parent" ("id","school_id");', f.model), /Duplicate exported object/);
  f.model.tables[0].keys[0].name = "parent_pair";
  assert.throws(() => orderExport(f.raw, f.model), /conflicts with existing inline key|identifier collision/);
});
test("reject SQL/model FK and unique-index mismatches", () => {
  const f = fixture();
  assert.throws(() => orderExport(f.raw.replace('REFERENCES "parent"("id","school_id")', 'REFERENCES "parent"("school_id","id")'), f.model), /foreign-key mismatch/);
  assert.throws(() => orderExport(f.raw.replace("CREATE UNIQUE INDEX", "CREATE INDEX"), f.model), /uniqueness/);
  assert.throws(() => orderExport(f.raw.replace(/;$/, ' WHERE "id" > 0;'), f.model), /predicate/);
  assert.throws(() => orderExport(f.raw.replace('btree ("id","school_id")', 'btree ("school_id")'), f.model), /Supporting index column/);
});
test("missing inline key or table fails clearly", () => {
  const f = fixture();
  assert.throws(() => orderExport(f.raw.replace("integer PRIMARY KEY", "integer"), f.model), /Model key absent/);
  assert.throws(() => orderExport(f.raw.replace(/CREATE TABLE "parent"[^;]+;/, ""), f.model), /Missing table statement/);
});
test("self and reciprocal cycles use unchanged post-table FK creation", () => {
  const f = fixture(); const parent = f.model.tables[0];
  parent.foreignKeys = [{ name: "parent_self", child: parent.id, childColumns: ["id"], parent: parent.id, parentColumns: ["id"] }];
  f.raw += '\nALTER TABLE "parent" ADD CONSTRAINT "parent_self" FOREIGN KEY("id") REFERENCES "parent"("id");';
  let plan = orderExport(f.raw, f.model);
  assert.equal(plan.cycles.length, 1); assert.deepEqual(plan.cycles[0].tables, ["public.parent"]);
  parent.foreignKeys.push({ name: "parent_child", child: parent.id, childColumns: ["id"], parent: "public.child", parentColumns: ["id"] });
  f.raw += '\nALTER TABLE "parent" ADD CONSTRAINT "parent_child" FOREIGN KEY("id") REFERENCES "child"("id");';
  plan = orderExport(f.raw, f.model);
  assert.deepEqual(plan.cycles[0].tables, ["public.child", "public.parent"]);
  assert.equal(plan.cycles[0].foreignKeys.length, 3);
  assert.ok(plan.statements.filter(s => s.startsWith("ALTER")).every(s => !/DEFERRABLE|NOT VALID/.test(s)));
});
test("lexer preserves strings, quoted identifiers, comments and dollar-body semicolons", () => {
  assert.equal(splitSql("-- ;\nSELECT 'x;''y'; /* nested /* ; */ comment */ DO $body$ BEGIN PERFORM ';'; END $body$;").length, 2);
  assert.equal(splitSql('CREATE TABLE "a;b" ("x,y" text DEFAULT \';\');').length, 1);
  assert.deepEqual(inlineKeys('CREATE TABLE "x" (")" integer, "a,b" integer, CONSTRAINT "u" UNIQUE(")","a,b"));')[0].columns, [")", "a,b"]);
  assert.throws(() => splitSql("SELECT 'unterminated;"), /Unterminated/);
  assert.deepEqual(inlineKeys('CREATE TABLE "x" ("id" int PRIMARY KEY, "audience" text[] DEFAULT ARRAY[\'a\',\'b\',\'c\'], CONSTRAINT "u" UNIQUE("id","audience"));').map(k => k.name), ["x_pkey", "u"]);
});
test("enum/schema prerequisites precede table, no extra statements invented", () => {
  const model = { tables: [{ id: "custom.items", name: "items", schema: "custom", types: ["custom.status"], keys: [], indexes: [], foreignKeys: [] }] };
  const raw = 'CREATE TABLE "custom"."items" ("status" "custom"."status");CREATE TYPE "custom"."status" AS ENUM(\'on\',\'off\');CREATE SCHEMA "custom";';
  const plan = orderExport(raw, model);
  assert.ok(plan.statements[0].startsWith("CREATE SCHEMA"));
  assert.ok(plan.statements[1].startsWith("CREATE TYPE"));
});
test("fail closed on DML, functions, triggers and unsupported extension directives", () => {
  const f = fixture();
  for (const directive of ["INSERT INTO parent VALUES (1,1);", "DROP TABLE parent;", "CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;", "CREATE TRIGGER t BEFORE INSERT ON parent EXECUTE FUNCTION f();", "CREATE EXTENSION pgcrypto;"]) {
    assert.throws(() => orderExport(f.raw + directive, f.model), /Unsupported export statement/);
  }
});
test("audit path cannot point to migrations, configuration or symlink targets", () => {
  assert.throws(() => auditOutputPath("lib/db/drizzle/0060.sql"), /audit/);
  assert.throws(() => auditOutputPath("/tmp/test.json"), /audit/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-export-path-"));
  try {
    const sql = path.join(dir, "out.sql");
    fs.symlinkSync("/does/not/exist", sql + ".graph.json");
    assert.throws(() => auditOutputPath(sql), /symlinks/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("provenance inventories DO declarations but does not guess dynamic DDL or function bodies", () => {
  const f = fixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-export-history-"));
  try {
    fs.writeFileSync(path.join(dir, "0000_keys.sql"), 'CREATE TABLE parent(id int PRIMARY KEY, school_id int);CREATE TABLE child(id int PRIMARY KEY,parent_id int,school_id int);CREATE UNIQUE INDEX parent_pair ON parent(id,school_id);');
    fs.writeFileSync(path.join(dir, "0001_fk.sql"), 'DO $$ BEGIN ALTER TABLE child ADD CONSTRAINT child_parent_fk FOREIGN KEY(parent_id,school_id) REFERENCES parent(id,school_id); END $$;');
    fs.writeFileSync(path.join(dir, "0002_not_provenance.sql"), 'CREATE FUNCTION ignored() RETURNS void LANGUAGE plpgsql AS $$ BEGIN ALTER TABLE child ADD CONSTRAINT invented_fk FOREIGN KEY(parent_id,school_id) REFERENCES parent(id,school_id); END $$;DO $$ BEGIN EXECUTE format(\'ALTER TABLE %I ADD CONSTRAINT guessed_fk FOREIGN KEY(parent_id,school_id) REFERENCES parent(id,school_id)\',\'child\'); END $$;');
    const evidence = migrationEvidence(dir, orderExport(f.raw, f.model).foreignKeys);
    assert.equal(evidence.foreignKeys[0].supportingKey.declarations[0].migration, "0000_keys.sql");
    assert.equal(evidence.foreignKeys[0].foreignKey.declarations[0].migration, "0001_fk.sql");
    assert.equal(evidence.foreignKeys[0].foreignKey.exactName, true);
    assert.equal(evidence.foreignKeys[0].foreignKey.declarations.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("PostgreSQL 63-byte physical names are recorded without renaming SQL; collisions fail", () => {
  assert.equal(postgresIdentifier("x".repeat(70)), "x".repeat(63));
  assert.equal(postgresIdentifier("x".repeat(62) + "é"), "x".repeat(62));
  const f = fixture(), child = f.model.tables[1], prefix = "x".repeat(63);
  child.foreignKeys[0].name = prefix + "first";
  f.raw = f.raw.replace("child_parent_fk", prefix + "first");
  const plan = orderExport(f.raw, f.model);
  assert.equal(plan.foreignKeys[0].physicalName, prefix);
  assert.ok(plan.statements.some(s => s.includes(prefix + "first")));
  child.foreignKeys.push({ ...child.foreignKeys[0], name: prefix + "second" });
  assert.throws(() => orderExport(f.raw, f.model), /identifier collision/);
});
