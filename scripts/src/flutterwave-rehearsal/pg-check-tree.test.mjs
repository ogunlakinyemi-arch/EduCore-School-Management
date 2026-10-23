import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticalTree, extractCheck, parsePgTree } from "./pg-check-tree.mjs";
import { historyCases, weekdayCases } from "./check-semantics.mjs";
const leaf=(value="3",column="1")=>`{OPEXPR :opno 523 :opfuncid 149 :args ({VAR :varattno ${column} :vartype 25 :location 7} {CONST :consttype 23 :constvalue 4 [${value} 0 0 0] :location 14}) :location 11}`;
const and=(...args)=>`{BOOLEXPR :boolop and :args (${args.join(" ")}) :location 1}`;
const normalized=s=>analyticalTree(parsePgTree(s));
test("typed tree comparison flattens only associative AND and source locations",()=>{
  assert.deepEqual(normalized(and(and(leaf(),leaf("80")),leaf("1000"))),normalized(and(leaf(),leaf("80"),leaf("1000"))));
});
test("different boundary, column, operator or Boolean operation stays different",()=>{
  const original=and(leaf(),leaf("80"));
  for(const other of [and(leaf("4"),leaf("80")),and(leaf("3","2"),leaf("80")),
    original.replace(":opno 523",":opno 521"),original.replace(":boolop and",":boolop or")])
    assert.notDeepEqual(normalized(original),normalized(other));
});
test("parser retains raw fields and rejects malformed or duplicate fields",()=>{
  assert.ok(parsePgTree(leaf()).fields[":location"]);
  assert.throws(()=>parsePgTree("{VAR :x 1 :x 2}"));
  assert.throws(()=>parsePgTree("{VAR :x (1}"));
});
test("extracts exact nested original CHECK without changing quoting or bounds",()=>{
  const check="CHECK ((length(btrim(x)) BETWEEN 3 AND 80) AND (x <> 'it''s(ok)'))";
  assert.equal(extractCheck(`CREATE TABLE t(x text, CONSTRAINT "ck" ${check}, y int);`,"ck"),check);
  assert.throws(()=>extractCheck('CREATE TABLE t(x text);',"missing"));
});
test("behavior matrices distinguish NULL, UTF8 length, boundaries and array shape",()=>{
  assert.equal(historyCases().length,72);
  assert.ok(historyCases().some(c=>c.input.event_type==="éé"&&c.expected===false));
  assert.ok(historyCases().some(c=>c.expected===null));
  assert.equal(weekdayCases().find(c=>c.name==="duplicates").expected,true);
  assert.equal(weekdayCases().find(c=>c.name==="only-null").expected,false);
});
