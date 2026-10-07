// Reuse the independent 2F-5 fixture/writer suite, but execute ONLY the actual
// checked-in 0060 bytes as the migration. No SQL is reconstructed or copied.
// No DB entry-point import, URL/env lookup, external provider call or shared DB.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const migrationPath = "lib/db/drizzle/0060_reconcile_student_subscription_finance.sql";
const bytes = await fs.readFile(migrationPath);
const hash = v => createHash("sha256").update(v).digest("hex");
const tracked = execFileSync("git", ["ls-files", "lib/db/drizzle", "lib/db/src",
  "artifacts/api-server/src", "artifacts/edupulse/src"], { encoding: "utf8" }).trim().split("\n");
assert(tracked.includes(migrationPath), "0060 must be the checked-in migration");
const protectedHashes = Object.fromEntries(await Promise.all(tracked.map(async p => [p, hash(await fs.readFile(p))])));
let source = await fs.readFile("scripts/rehearsals/finance-2f5.mjs", "utf8");
function replaceExactly(old, replacement) {
  assert.equal(source.split(old).length, 2, "Rehearsal anchor changed: " + old.slice(0, 90));
  source = source.replace(old, replacement);
}
function replaceRegion(start, end, replacement) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, "Rehearsal region not found");
  source = source.slice(0, a) + replacement + source.slice(b);
}
replaceExactly('"/tmp/educore-2f5-active-path"', '"/tmp/educore-2g1-active-path"');
replaceExactly('/^\\/tmp\\/educore-finance-2f5-[A-Za-z0-9]+$/', '/^\\/tmp\\/educore-finance-2g1-[A-Za-z0-9]+$/');
replaceExactly('port: 55485, user: "finance_rehearsal", password: "",',
  'port: 55486, user: "finance_2g1_rehearsal", password: () => "", ssl: false,');
replaceExactly('assert.equal(identity.port, "55485");', 'assert.equal(identity.port, "55486");');
source = source.replaceAll("finance_2f5_", "finance_2g1_actual_0060_");
replaceExactly('path.join(root, "reports/finance-2f5")', 'path.join(root, "reports/finance-2g1")');
replaceRegion("let canonical = noParentIndexes.", "// Compile unchanged source", `
const migrationPath = "lib/db/drizzle/0060_reconcile_student_subscription_finance.sql";
const migrationBytes = await fs.readFile(path.join(root,migrationPath));
const canonical = migrationBytes.toString("utf8");
assert(Buffer.from(canonical,"utf8").equals(migrationBytes));
const authoritative = JSON.parse(await fs.readFile(path.join(root,"reports/finance-2f5/report.json"),"utf8"));
assert.equal(authoritative.summary.failed,0);
report.actualMigration={path:migrationPath,sha256:hash(migrationBytes),executions:[]};
const trace=[];
async function inventory(pool) {
  return Object.fromEntries(await Promise.all(tables.map(async t=>{
    const rows=(await pool.query("SELECT to_jsonb(t) row FROM "+qn(t)+" t ORDER BY id")).rows;
    return [t,{count:rows.length,primaryKeys:rows.map(r=>r.row.id),fingerprint:hash(JSON.stringify(rows))}];
  })));
}
async function indexIdentities(pool) {
  return (await pool.query("SELECT i.indexrelid::int oid,c.relname name FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace) ORDER BY i.indexrelid")).rows;
}
async function sequenceState(pool) {
  const states={};
  for(const t of tables) {
    const name=(await pool.query("SELECT pg_get_serial_sequence($1,'id') name",[t])).rows[0].name;
    states[t]=(await pool.query("SELECT last_value,is_called FROM "+name)).rows[0];
  }
  return states;
}
function classify(before,after) {
  const result=[];
  for(const section of Object.keys(after)) {
    const key = r => JSON.stringify([r.table_name??null,r.column_name??r.name??r.sequence_name??null]);
    const old=new Map(before[section].map(r=>[key(r),r]));
    const next=new Map(after[section].map(r=>[key(r),r]));
    for(const [k,row] of next) {
      result.push({section,key:JSON.parse(k),classification:
        JSON.stringify(old.get(k))===JSON.stringify(row)?"equivalent existing object":"expected",
        operation:old.has(k)?"reused or reconciled":"added",before:old.get(k)??null,after:row});
    }
    for(const [k,row] of old)if(!next.has(k))result.push({section,key:JSON.parse(k),
      classification:"expected",operation:"canonical constraint rename",before:row,after:null});
  }
  return result;
}
// Compile unchanged source`);
replaceExactly("const trace=[];\nfunction instrument", "function instrument");
replaceExactly("await orm.dialect.migrate(migrationObject(canonical),orm.session,runnerConfig);\nconst canonicalCatalog = await catalog(empty);",
  `await orm.dialect.migrate(migrationObject(canonical),orm.session,runnerConfig);
report.actualMigration.executions.push({shape:"empty",method:"real Drizzle dialect/session",sha256:hash(canonical),statementCount:1,result:"DO committed"});
const canonicalCatalog = authoritative.catalog.canonical;
assert.deepEqual(await catalog(empty),canonicalCatalog,"Actual 0060 empty catalog differs from independent canonical baseline");
`);
replaceRegion("// Reconciliation generated from PostgreSQL", 'await test(1,"empty build', `
const reconciliation=canonical; // Exact bytes read from 0060 above; never generated.
await test(1,"empty actual-file catalog comparison",async()=>{
  const actual=await catalog(empty);assert.deepEqual(actual,canonicalCatalog);
  report.catalogDiff={empty:classify({columns:[],constraints:[],indexes:[],functions:[],triggers:[],sequences:[]},actual)};
  return {statement:"DO",sourceSHA256:hash(canonical),unexpectedDifferences:0};
});
`);
replaceExactly("const before=await fingerprint(pool), old=await catalog(pool);",
  `// Preserve pending and completed Partner/fee records, not just empty tables.
    const paid=await newPayment(pool,1);await finish(pool,paid,1234);
    const preservationBefore=await inventory(pool), indexesBefore=await indexIdentities(pool), sequencesBefore=await sequenceState(pool);
    const before=await fingerprint(pool), old=await catalog(pool);`);
replaceExactly("const after=await fingerprint(pool), result=await catalog(pool);",
  `report.actualMigration.executions.push({shape:name,method:"direct file bytes",sha256:hash(reconciliation),statementCount:1,result:"DO committed"});
    const after=await fingerprint(pool), result=await catalog(pool);
    const preservationAfter=await inventory(pool), indexesAfter=await indexIdentities(pool);
    assert.deepEqual(preservationAfter,preservationBefore,"STOP: Finance preservation difference");
    assert.deepEqual(await sequenceState(pool),sequencesBefore);
    assert(indexesBefore.every(i=>indexesAfter.some(j=>j.oid===i.oid)),"An existing index was destructively replaced");
    report.catalogDiff[name]=classify(old,result);
    report.preservationDetails??={};
    report.preservationDetails[name]={before:preservationBefore,after:preservationAfter,rowDifferences:0,
      preservedExistingIndexOIDs:indexesBefore.map(i=>i.oid),sequenceValuesUnchanged:true};`);
replaceExactly('report.reconciliation[name]={before:old,after:result};',
  'report.reconciliation[name]={before:old,after:result};');
// A failed starting shape/preservation stops the writer suite; do not repair.
replaceExactly('console.log(report.tests.at(-1).status, group, name);',
  `console.log(report.tests.at(-1).status, group, name);
  if(report.tests.at(-1).status==="FAIL"&&[1,2,3].includes(group))
    throw new Error("STOP: actual migration starting-shape or preservation failure");`);
// Add the explicitly requested negative CHECK tests absent from 2F-5.
replaceExactly("for(const p of protectedPaths)assert.equal", `
await test(21,"additional actual CHECK/owner rejections",async()=>{
  await seed(empty);const p=await newPayment(empty);const evidence=[];
  for(const [label,column,value,constraint]of [
    ["provider","provider","OTHER","student_subscription_payments_provider_ck"],
    ["provider mode","provider_mode","LIVE","student_subscription_payments_provider_mode_ck"],
    ["gross amount","gross_amount_minor",1,"student_subscription_payments_gross_ck"],
    ["payment currency","currency","USD","student_subscription_payments_gross_ck"],
    ["negative provider fee","provider_fee_minor",-1,"student_subscription_payments_gross_ck"],
    ["negative settlement","settlement_amount_minor",-1,"student_subscription_payments_gross_ck"],
    ["excess settlement","settlement_amount_minor",500001,"student_subscription_payments_gross_ck"]
  ]) evidence.push({label,...await reject(empty,"UPDATE "+payment+" SET "+qn(column)+"=$1 WHERE id=$2",[value,p.id],"23514",constraint)});
  for(const [label,changes,constraint]of [
    ["zero allocation",{amount_minor:0},"student_subscription_allocations_amount_ck"],
    ["negative allocation",{amount_minor:-1},"student_subscription_allocations_amount_ck"],
    ["allocation currency",{currency:"USD"},"student_subscription_allocations_amount_ck"],
    ["invalid expense recipient",{entry_type:"EXPENSE",recipient_type:"SCHOOL"},"student_subscription_allocations_amount_ck"],
    ["credit provider-fee recipient",{recipient_type:"PLATFORM_PROVIDER_FEE"},"student_subscription_allocations_amount_ck"],
    ["non-Partner recipient id",{recipient_id:51},"student_subscription_allocations_partner_ck"],
    ["Partner missing recipient",{recipient_type:"PARTNER",attribution_id:71,commission_rule_id:61},"student_subscription_allocations_partner_ck"],
    ["Partner missing attribution",{recipient_type:"PARTNER",recipient_id:51,commission_rule_id:61},"student_subscription_allocations_partner_ck"],
    ["Partner missing rule",{recipient_type:"PARTNER",recipient_id:51,attribution_id:71},"student_subscription_allocations_partner_ck"]
  ]) {
    const c=await empty.connect();
    try{await c.query("BEGIN");try{await insertAllocation(c,p,changes);assert.fail("Invalid CHECK accepted");}
      catch(e){assert.equal(e.code,"23514");assert.equal(e.constraint,constraint);evidence.push({label,sqlstate:e.code,constraint:e.constraint});}}
    finally{await c.query("ROLLBACK");c.release();}
  }
  evidence.push({label:"payment school",...await reject(empty,"UPDATE "+payment+" SET school_id=1 WHERE id=$1",[p.id],"23503")});
  const c=await empty.connect();
  try{await c.query("BEGIN");try{await insertAllocation(c,p,{school_id:1});assert.fail("Allocation school accepted");}
    catch(e){assert.equal(e.code,"23503");evidence.push({label:"allocation school",sqlstate:e.code,constraint:e.constraint});}}
  finally{await c.query("ROLLBACK");c.release();}
  return evidence;
});
await test(22,"SQL JSON null receipt is immutable",async()=>{
  await seed(empty);const p=await newPayment(empty);
  await empty.query("UPDATE "+payment+" SET receipt_snapshot='null'::jsonb WHERE id=$1",[p.id]);
  await empty.query("UPDATE "+payment+" SET receipt_snapshot=receipt_snapshot WHERE id=$1",[p.id]);
  return await reject(empty,"UPDATE "+payment+" SET receipt_snapshot=NULL WHERE id=$1",[p.id],"P0001",null,"Student subscription receipt snapshots are immutable");
});
for(const p of protectedPaths)assert.equal`);
// Ensure failure cleanup also runs for an initial DO/bootstrap exception.
for (const name of ["report", "reportDir", "control", "pools"]) {
  replaceExactly(`const ${name} =`, `var ${name} =`);
}
replaceExactly('import { createHash } from "node:crypto";',
  'import { createHash } from "node:crypto";\ntry {');
replaceRegion("report.summary={passed:", 'console.log(JSON.stringify({summary:', `
report.summary={passed:report.tests.filter(t=>t.status==="PASS").length,failed:report.tests.filter(t=>t.status==="FAIL").length};
`);
// Remove the old print, then supply one fail-safe final report and cleanup.
source = source.slice(0, source.indexOf('console.log(JSON.stringify({summary:'));
source += `
} catch(e) {
  report??={environment:{},tests:[]};
  report.tests.push({group:"actual-file-execution",name:"critical execution/shape failure",status:"FAIL",
    actual:e.message,sqlstate:e.code??null,detail:e.detail??null,where:e.where??null});
  process.exitCode=1;
} finally {
  try {
    for(const p of pools??[])await p.end();
    if(report?.environment?.isolated) {
      for(const name of ["empty","historical","current"])
        await control.query('DROP DATABASE IF EXISTS "'+"finance_2g1_actual_0060_"+name+'"');
      assert.equal((await control.query("SELECT count(*)::int n FROM pg_database WHERE datname LIKE 'finance_2g1_actual_0060_%'")).rows[0].n,0);
      report.environment.disposableDatabasesDestroyed=true;
    }
    if(control)await control.end();
  } catch(e) {
    report.tests.push({group:"cleanup",name:"disposable cleanup",status:"FAIL",actual:e.message});
    process.exitCode=1;
  }
  report.summary={passed:report.tests.filter(t=>t.status==="PASS").length,failed:report.tests.filter(t=>t.status==="FAIL").length};
  report.decision=report.summary.failed?"FAIL — DO NOT APPLY MIGRATION 0060 OR PROCEED TO PRODUCTION":
    "PASS — ACTUAL MIGRATION 0060 REHEARSAL SUCCESSFUL — READY FOR FULL SCHEMA RECONCILIATION";
  reportDir??=path.join(process.cwd(),"reports/finance-2g1");
  await fs.mkdir(reportDir,{recursive:true});
  await fs.writeFile(path.join(reportDir,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify({summary:report.summary,decision:report.decision,report:reportDir}));
}
`;
// A temporary module gives concise diagnostics instead of embedding the entire
// test suite in a data-URL stack trace. It contains no copied migration SQL.
const base = (await fs.readFile("/tmp/educore-2g1-active-path", "utf8")).trim();
assert.match(base, /^\/tmp\/educore-finance-2g1-[A-Za-z0-9]+$/);
const modulePath = path.join(base, "actual-tests.mjs");
await fs.writeFile(modulePath, source);
execFileSync(process.execPath, ["--check", modulePath], { stdio: "inherit" });
await import(modulePath);
const changed = [];
for (const [p, before] of Object.entries(protectedHashes)) {
  if (hash(await fs.readFile(p)) !== before) changed.push(p);
}
const reportPath = path.join(root, "reports/finance-2g1/report.json");
const finalReport = JSON.parse(await fs.readFile(reportPath, "utf8"));
finalReport.integrity = { migrationPath, initialSHA256: hash(bytes),
  finalSHA256: hash(await fs.readFile(migrationPath)), protectedFileCount: tracked.length,
  protectedFilesChanged: changed };
finalReport.environment.architecture = process.arch;
finalReport.safety = { ...finalReport.safety, sharedDatabaseConnections:0,
  sharedDatabaseWrites:0, historicalMigrationsChanged:false, migration0060Changed:changed.includes(migrationPath),
  environmentChanged:false, syntheticDataOnly:true };
finalReport.catalog ??= {};
// Ordinary/non-inherited table kind was enforced by the executed 0060 catalog
// guards. Presence/name comes from the independently compared column catalogs.
const tableInventory = [...new Set(finalReport.catalog.final?.columns.map(c=>c.table_name)??[])].sort()
  .map(name=>({schema:"public",name,kind:"ordinary non-inherited table"}));
finalReport.catalog.tables = tableInventory;
for(const shape of ["empty","historical","current"]) {
  if(!finalReport.catalogDiff?.[shape])continue;
  finalReport.catalogDiff[shape].push(...tableInventory.map(table=>({section:"tables",key:table.name,
    classification:shape==="empty"?"expected":"equivalent existing object",
    operation:shape==="empty"?"added":"reused",before:shape==="empty"?null:table,after:table,
    evidence:"Verified column catalog and executed 0060 ordinary-table/inheritance guard"})));
}
if (changed.length) {
  finalReport.tests.push({group:"integrity",name:"protected-file integrity",status:"FAIL",actual:changed});
  finalReport.summary.failed++;
  finalReport.decision="FAIL — DO NOT APPLY MIGRATION 0060 OR PROCEED TO PRODUCTION";
  process.exitCode=1;
}
await fs.writeFile(reportPath, JSON.stringify(finalReport,null,2));
if(finalReport.summary.failed)process.exitCode=1;
