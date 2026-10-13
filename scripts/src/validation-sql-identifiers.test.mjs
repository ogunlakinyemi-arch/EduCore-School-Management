import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { safeIdentifier } from "./validation-sql-identifiers.mjs";

test("quotes only bounded SQL identifier tokens, including reserved words", () => {
  for (const identifier of ["public", "audit_logs", "id", "select", "_column2", "educore_replay_123"]) {
    assert.equal(safeIdentifier(identifier), `"${identifier}"`);
  }
});
test("rejects identifier injection, expressions, control characters and non-strings", () => {
  for (const value of ['x"; DROP TABLE students;--', "public.students", "*", "id DESC",
    "id,secret", "x--", "x/*", "x\n", "x\r", "x\0", "", "1column", "é", null, 3, {},
    { toString: () => "id" }]) {
    assert.throws(() => safeIdentifier(value), /Unsafe database identifier/);
  }
});
test("utility catalog queries are constant SQL with bound schema/table values", async () => {
  const source=await readFile(new URL("./educore-extension-validation.mjs",import.meta.url),"utf8");
  assert.match(source, /"SELECT schemaname AS schema,tablename AS name FROM pg_tables WHERE schemaname IN \('public','drizzle'\) ORDER BY schemaname,tablename"/);
  assert.match(source, /"SELECT column_name FROM information_schema.columns WHERE table_schema=\$1 AND table_name=\$2 ORDER BY ordinal_position", \[table.schema, table.name\]/);
});
test("every dynamic identifier path uses the tested quoting boundary; read-only transactions remain", async () => {
  const source=await readFile(new URL("./educore-extension-validation.mjs",import.meta.url),"utf8");
  assert.match(source, /columns.map\(safeIdentifier\).join\(","\)/);
  assert.match(source, /FROM \(SELECT \$\{projected\} FROM \$\{safeIdentifier\(table.schema\)\}\.\$\{safeIdentifier\(table.name\)\}\)/);
  assert.match(source, /original.columns.map\(safeIdentifier\).join\(","\)/);
  assert.match(source, /CREATE DATABASE \$\{safeIdentifier\(database\)\}/);
  assert.match(source, /client.query\("BEGIN READ ONLY"\)/);
});
