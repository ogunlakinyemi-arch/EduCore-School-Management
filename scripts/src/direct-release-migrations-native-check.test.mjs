import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {assertNoDuplicatedChecks,migrationPaths} from "./direct-release-migrations-native-check.mjs";

test("accepts valid bare and explicit-predicate CHECK SQL",()=>{
  assertNoDuplicatedChecks([
    "CREATE TABLE t(flag boolean NOT NULL CHECK (flag));",
    "CREATE TABLE t(flag boolean NOT NULL CHECK (flag IS TRUE));",
  ]);
});
for(const name of [
  "student_direct_live_reviews_no_split_confirmed_check",
  "student_direct_live_release_requests_no_split_confirmed_check",
]){
  test(`rejects the reported generated duplicate for ${name}`,()=>{
    assert.throws(()=>assertNoDuplicatedChecks([
      `CREATE TABLE t(flag boolean NOT NULL, CONSTRAINT ${name} CHECK (CHECK (flag)));`,
    ]),/Duplicated CHECK wrapper/);
  });
}
test("rejects case/whitespace variations anywhere in a generated statement list",()=>{
  assert.throws(()=>assertNoDuplicatedChecks([
    "CREATE TABLE a(id int);","CREATE TABLE b(flag bool chEck (\n cHeCk \t(flag)));",
  ]),/Duplicated CHECK wrapper/);
});
test("requires nonempty generated SQL rather than silently passing missing input",()=>{
  for(const value of [undefined,[],[null]])assert.throws(()=>assertNoDuplicatedChecks(value));
});
test("all four source migrations contain no duplicated CHECK wrappers",()=>{
  assertNoDuplicatedChecks(migrationPaths.map(path=>readFileSync(new URL(`../../${path}`,import.meta.url),"utf8")));
});
test("both authoritative NOT NULL consent definitions use Publish-portable predicates",()=>{
  for(const path of migrationPaths.slice(1,3)){
    const sql=readFileSync(new URL(`../../${path}`,import.meta.url),"utf8");
    assert.match(sql,/no_split_confirmed boolean NOT NULL CHECK\(no_split_confirmed IS TRUE\)/);
  }
});
