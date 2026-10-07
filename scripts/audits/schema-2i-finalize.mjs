// Final evidence/report only. Does not generate or alter any migration.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
const out="reports/schema-2i",read=async p=>JSON.parse(await fs.readFile(p,"utf8"));
if(process.argv.includes("--record-cleanup")){
 const report=await read(out+"/report.json"),validation=await read(out+"/validation.json");
 const base=path.dirname(validation.isolation.data_directory);
 assert.match(base,/^\/tmp\/educore-schema-2i-[A-Za-z0-9]+$/);
 let absent=false;try{await fs.stat(base);}catch(error){assert.equal(error.code,"ENOENT");absent=true;}assert(absent);
 const cleanup={privateClusterOnly:true,clusterStopped:true,clusterDirectoryRemoved:true,privateSocketRemoved:true,sharedServicesTouched:false,
  evidence:"Tracked private postgres background task stopped; pg_ctl confirmed not running before removal; exact private cluster path and socket no longer exist."};
 report.safety.disposableClusterStopped=true;report.safety.disposableClusterRemoved=true;
 validation.cleanup=cleanup;
 await fs.writeFile(out+"/cleanup.json",JSON.stringify(cleanup,null,2));
 await fs.writeFile(out+"/report.json",JSON.stringify(report,null,2));
 await fs.writeFile(out+"/validation.json",JSON.stringify(validation,null,2));
 const html=await fs.readFile(out+"/report.html","utf8");
 await fs.writeFile(out+"/report.html",html.replace(/<p id="cleanup">.*?<\/p>/s,
  '<p id="cleanup">All private rehearsal databases were destroyed. The private PostgreSQL process is stopped, and the exact cluster directory and Unix socket are removed. Shared workflows/databases were not touched. Details: cleanup.json.</p>'));
 console.log(cleanup);process.exit(0);
}
const m=await read(out+"/manifest.json"),v=await read(out+"/validation.json");
const e=await read("reports/schema-2h/canonical-catalog.json"),b=await read("reports/schema-2h/production-catalog.json");
const hash=x=>createHash("sha256").update(x).digest("hex");
for(const f of m.migrations)assert.equal(hash(await fs.readFile("lib/db/drizzle/"+f.name)),v.migrationHashes[f.name]);
const old=b.constraints.find(c=>c.table_name==="fee_payments"&&c.name==="fee_payments_method_check");
const replacement=e.constraints.find(c=>c.table_name==="fee_payments"&&c.name==="fee_payments_method_with_cash_check");
assert(old&&replacement);
const base=(await fs.readFile("/tmp/educore-2i-active-path","utf8")).trim();
assert.match(base,/^\/tmp\/educore-schema-2i-[A-Za-z0-9]+$/);
const {Client}=createRequire(path.resolve("lib/db/package.json"))("pg");
const client=new Client({host:base+"/socket",port:55488,user:"schema_2i_audit",database:"postgres",password:()=>"",ssl:false});
let proof;
try{
 await client.connect();
 const identity=(await client.query("SELECT current_setting('data_directory') d,current_setting('listen_addresses') l")).rows[0];
 assert.equal(identity.d,base+"/data");assert.equal(identity.l,"");
 await client.query("BEGIN READ ONLY");
 proof=(await client.query(`SELECT (${old.check_expression}) AS legacy_allows_cash,(${replacement.check_expression}) AS canonical_allows_cash FROM (VALUES ('CASH'::text)) AS fixture(method)`)).rows[0];
 await client.query("ROLLBACK");
 assert.equal(proof.legacy_allows_cash,false);assert.equal(proof.canonical_allows_cash,true);
}finally{await client.end();}
const blockers=[{id:"legacy-fee-method-check",table:"fee_payments",object:old.name,
 classification:"PRESENT BUT DIFFERENT — REQUIRES CONTROLLED RECONCILIATION",
 reason:"Retaining the noncanonical legacy CHECK rejects CASH accepted by the canonical schema. It is NOT a harmless metadata difference.",
 legacyDefinition:old.definition,canonicalReplacement:replacement.definition,proof,
 sourceEvidence:"0013_phase7_finance.sql creates the legacy CHECK. 0055_academic_calendar_fee_lines_cash.sql lines 15–18 explicitly retires it and creates the CASH-capable CHECK.",
 action:"STOP. A separately reviewed, explicitly proven-safe constraint-retirement/replacement plan is required. No retirement migration or constraint DROP was added.",
 migration0060Defect:false}];
const status="BLOCKED — DO NOT PROCEED";
const checks=[...new Map(v.tests.map(t=>[t.name,t])).values()];
v.status=status;v.blockers=blockers;v.tests=checks;
v.failures=[{test:"F full semantic equivalence",reason:blockers[0].reason,proof}];
v.catalogCoverageOnlyPassed=true;v.semanticEquivalencePassed=false;
m.releaseStatus=status;m.blockers=blockers;
await fs.writeFile(out+"/validation.json",JSON.stringify(v,null,2));
await fs.writeFile(out+"/manifest.json",JSON.stringify(m,null,2));
await fs.writeFile(out+"/semantic-blocker.json",JSON.stringify(blockers,null,2));
const comparison=await read(out+"/replica-catalog-comparison.json");
const canonicalCounts=Object.fromEntries(Object.entries(e).map(([k,a])=>[k,a.length]));
const canonicalKinds=Object.fromEntries(["p","u","c","f"].map(k=>[k,e.constraints.filter(c=>c.kind===k).length]));
const actualKinds={p:173,u:176,c:430,f:659};
// Counts are a consequence of semantic matching and retained extra constraints:
// five redundant (id,school_id) UNIQUEs; one restrictive legacy method CHECK.
const required=m.preflights.filter(p=>p.kind==="required missing column");
const journal=m.journal,oldMissing=journal.missingRegistrations.filter(n=>Number(n.slice(0,4))<=60);
const helpers=[
 ["scripts/audits/schema-2i-build.mjs","Offline compiler of canonical contracts, chunked guarded forward DDL, manifests and preflight specifications."],
 ["scripts/audits/schema-2i-check-normalize.mjs","Isolated exact canonical CHECK-DDL reparse evidence; no guessed SQL text normalization."],
 ["scripts/audits/schema-2i-rehearse.mjs","Private-socket canonical/replica/populated preservation, SQL rerun, temporary-runner and mismatch/gate rehearsals."],
 ["scripts/audits/schema-2i-preflight-parse.mjs","Plans the read-only specifications against empty typed disposable relations; NOT a Production data preflight."],
 ["scripts/audits/schema-2i-finalize.mjs","Read-only synthetic counterexample, truthful blocked status and final report; no migration modifications."]
];
const safety={productionConnections:0,productionWrites:0,developmentWrites:0,sharedDatabaseWrites:0,publishDeploy:"NO",dbPush:"NO",
 journalChanges:"NO",sharedMigrationHistoryStamped:"NO",secretsExposed:"NO",secretsOrEnvironmentChanged:"NO",applicationBehaviorChanged:"NO",
 historyFilesUnchanged:61,finance0060Unchanged:true,applicationFilesUnchanged:true,
 scopeNote:"New draft migrations, audit helpers and evidence only; a durable schema-verification lesson was added to project memory. No application/configuration files changed.",
 disposableClusterStopped:false,disposableClusterRemoved:false};
const report={stage:"2I",status,blockers,canonicalCounts,canonicalConstraintKinds:canonicalKinds,
 canonicalCoverage:Object.fromEntries(Object.entries(canonicalCounts).map(([k,n])=>[k,{expected:n,coveredByTargetSignature:n}])),
 rawReplicaReconciliationCounts:comparison.counts,rawReplicaConstraintKinds:actualKinds,
 canonicalCoverageIsNotSemanticEquivalence:true,semanticEquivalencePassed:false,
 migrations:m.migrations,helpers,order:m.order,journal,requiredMissingColumnGates:required,
 productionPreflightQueries:m.preflights.length,productionPreflightStatus:"NOT RUN",
 tests:checks,finance:{testsReused:35,priorPassed:35,priorFailed:0,orderingCompatible:true,migration0060Unchanged:true,notFullSchoolFeeCashCoverage:true},
 idempotency:{directSQL:"PASS",temporaryCustomRunner:"PASS",actualDrizzleJournalRunner:"NOT RUN — journal adoption deliberately forbidden"},
 warnings:["Drafts are NOT released. Do not execute this manifest against any shared database.",
 "Catalog object coverage passed; full semantic equivalence failed on the retained old payment-method CHECK.",
 "Migration numbering is not execution order. 0060 must follow its forward prerequisites.",
 "Eight missing NOT NULL columns need empty targets or separately approved prior mappings; this package refuses invented backfills.",
 "All 1,890 proposed Production data/sequence queries remain NOT RUN; EXPLAIN validated syntax/planning only.",
 "Two PostgreSQL Boolean CHECK deparse grouping differences are supported by exact-DDL reparse evidence.",
 "Synthetic fixtures did not copy Production rows. The populated fixture explicitly prepared the required school default.",
 "Actual Drizzle journal replay was not performed; runner idempotency used session-temporary genuine execution records.",
 "Resolved development issues: CHECK reparse grouping; missing bank-transfer fixture details; a test's absent purpose lookup; a negative function fixture initially used a different argument signature. No historical migration was changed."],
 failures:v.failures,safety};
const esc=x=>String(x??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const table=(heads,rows)=>`<div class="table"><table><thead><tr>${heads.map(x=>`<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const tiers=[...new Set(m.migrations.map(x=>x.purpose))].map(p=>{const files=m.migrations.filter(x=>x.purpose===p);return [p,files[0].name.slice(0,4)+"–"+files.at(-1).name.slice(0,4),files.length,files.map(x=>x.phase).filter((x,i,a)=>a.indexOf(x)===i).join(", ")];});
const coverage=Object.entries(canonicalCounts).map(([k,n])=>[k,n,n,comparison.counts[k],k==="constraints"?"Extra legacy CHECK makes behavioral equivalence FAIL.":k==="indexes"?"Equivalent differently named/owned indexes reused; no cosmetic rebuild.":"Target-signature coverage; not a whole-schema semantic proof."]);
const prereqs=x=>x.prerequisites.length?x.prerequisites.join("; "):"None within this package; Stage 2H catalog identity/preflight required.";
let html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stage 2I — Blocked reconciliation draft</title>
<style>body{font:15px/1.55 system-ui,sans-serif;background:#f5f6f8;color:#202734;margin:0}main{max-width:1200px;margin:auto;padding:32px 24px}h1{font-size:28px}h2{margin-top:32px}h3{margin-top:24px}.status{border-left:5px solid #b32727;background:#fff0f0;padding:20px}.table{overflow:auto;background:white;border:1px solid #dce0e7;border-radius:6px;margin:16px 0}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #e2e6ec}th{background:#edf0f5}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;border:1px solid #ddd;padding:16px;font:12px/1.5 monospace}.note{background:#fff6df;padding:16px}code{overflow-wrap:anywhere}li{margin:6px 0}small{color:#4a5361}</style><main>
<h1>Stage 2I — Source-only reconciliation build</h1><div class="status"><strong>${status}</strong><p>105 guarded draft migrations were built and exercised on isolated PostgreSQL. The final semantic review found a retained legacy CHECK that blocks canonical CASH payments. The package is not approved for shared execution.</p></div>
<h2>Critical blocker</h2><p><code>fee_payments.fee_payments_method_check</code> rejects CASH; canonical <code>fee_payments_method_with_cash_check</code> permits it. Both constraints survive the additive reconciliation, so their intersection still rejects CASH. Historical migration 0055 explicitly retires the obsolete CHECK. That retirement was not copied or added here.</p>
${table(["Synthetic input","Legacy CHECK","Canonical CHECK"],[["method = CASH",proof.legacy_allows_cash,proof.canonical_allows_cash]])}
<p><strong>Stop condition:</strong> the expected objects exist, but the resulting schema is not semantically canonical. A separately reviewed guarded retirement/replacement plan is required. No defect in 0060 was found. No old constraint or historical migration was altered.</p>
<h2>A. Files created</h2><p>New SQL: <code>lib/db/drizzle/0061_…</code> through <code>0165_…</code> (${m.migrations.length} files). Each contains one top-level atomic DO statement, three temporary helper definitions, and at most 90 guarded object contracts. These are drafts, not journal-registered migrations.</p>
${table(["Helper filename","Purpose"],helpers)}
<p>Existing <code>scripts/audits/schema-2h-catalog.sql</code> was reused unchanged. Evidence files are listed in the bundled manifest. The memory note records why coverage cannot prove semantic equivalence; it is not an application change.</p>
${table(["Migration filename","Purpose / phase","Prerequisites (structural tier)","Statements / contracts","Guarded DDL","Controlled replacement / alteration","Production preflight gate"],m.migrations.map(x=>[x.name,x.purpose+" / "+x.phase,prereqs(x),"1 DO / "+x.objects+" contracts","YES",x.controlledReplacement?"YES":("NO destructive replacement; "+(x.controlledAlterations??"none")),x.requiresPreflight?"YES — NOT RUN":"No per-file data scan; package/schema/journal/blocker gates still apply"]))}
<h2>B. Dependency order</h2><p><strong>Sequences → table shells → columns → sequence ownership → parent keys → indexes → unchanged 0060 → CHECKs/FKs → remaining functions → triggers.</strong></p>
<p>Domain phases within a structural tier can run in parallel when lock/release budgets permit; they are not falsely presented as a total dependency chain. Every file in a later tier depends on the preceding tier. The exact deterministic rehearsal order is in manifest.json. Numerical or lexical ordering is unsafe: 0060 occurs after its forward prerequisites, not before 0061.</p>
${table(["Tier","Number range","Files","Domain phases"],tiers)}
<details><summary>Exact rehearsal order (106 files, including unchanged 0060)</summary><pre>${esc(m.order.join("\n"))}</pre></details>
<h2>C. Canonical coverage — NOT full semantic equivalence</h2>${table(["Object class","Canonical","Covered target signatures","Raw reconciled fixture count","Interpretation"],coverage)}
${table(["Constraint type","Canonical target coverage","Raw reconciled fixture"],[["PK",173,173],["UNIQUE",171,176],["CHECK",429,430],["FK",659,659]])}
<p>Raw counts differ because equivalent aliases/index ownership are preserved and redundant legacy UNIQUEs remain. Eight index-name mappings are recorded in replica-catalog-comparison.json; 674 target index signatures are served by 671 physical indexes. Five additional UNIQUEs and one additional CHECK yield 1,438 raw constraints. The extra CHECK is a blocker, not an accepted metadata difference. Twenty-three physical column-order differences, an equivalent empty-array default, stronger validated device/class FK protection and harmless index/name aliases were preserved.</p>
<h2>D. Unresolved items and preflight gates</h2><ol><li>Resolve the obsolete fee payment-method CHECK through a separately reviewed safe plan. Do not claim full canonical equivalence until a behavioral counterexample test passes.</li><li>Verify the intended Production primary identity, current catalog, role/privilege scope and current schema/data state in a separately authorized stage. The Stage 2H catalog is a planning baseline, not evidence of current data.</li><li>Eight required missing columns on existing tables need empty-table evidence or a separately approved prior mapping. Missing mappings block these drafts; defaults are not used to invent existing values.</li><li>Run applicable exact aggregate PK/UNIQUE/CHECK/FK/index queries after their prerequisite columns exist and before enabling/validating constraints. Orphan and cross-tenant rows block deployment.</li><li>Review sequence positions on the verified primary; replica-unavailable positions are NOT ASSESSABLE. No nextval/setval/reset is authorized.</li><li>Reconcile the release runner/journal separately, including seven old unregistered files plus 105 new drafts. No bulk stamping or assumed prior execution.</li></ol>
${table(["Required missing column","Expected aggregate","Status / rule"],required.map(x=>[x.table+"."+x.columns.join(", "),"count(*) = 0","NOT RUN; otherwise separately approved prior mapping required"]))}
<p>Two differences are explicitly reconciled in the drafts: only <code>fee_invoices.student_id</code> and <code>fee_payments.student_id</code> relax NOT NULL to the canonical nullable form. The device/class ownership FK is already more strongly validated and remains unchanged. No transfer, historical Finance ownership rewrite or finalizer change was introduced.</p>
<p>1,890 read-only preflight specifications include exact tables, columns, violation queries, expected zero, NULL policy and gates. <strong>Every Production result remains NOT RUN.</strong> PostgreSQL EXPLAIN validated syntax/planning only. Same-name unknown/different runtime objects fail closed; no currently detected ambiguity is hidden.</p>
<h3>Journal report</h3><p>54 registrations for the original 61 files. Still-unregistered historical files:</p><pre>${esc(oldMissing.join("\n"))}</pre>
<p>Including the 105 new drafts there are 166 SQL files and 112 unregistered files. All 61 historical hashes and the unchanged journal match the baseline. Executed shared-ledger hashes were not inspected: zero Production connections. The separate journal report lists all files and registrations.</p>
<p>${esc(journal.procedure)}</p>
<h2>E. Disposable validation</h2><p>${esc(v.isolation.version)}. Fresh private cluster under /tmp; Unix socket only, TCP listener disabled, private audit role and explicit local configuration. No application database client, connection URL or environment credentials were used. No Production data was copied.</p>
${table(["Test","Outcome","Scope"],[["A — clean canonical replay","PASS","All 61 files; exact expected counts."],["B — additive draft execution","PASS structurally","Exact manifest order from 91-table replica-shaped catalog, plus a populated synthetic partial-legacy fixture."],["C — preservation","PASS","Original table/index/sequence OIDs and constraint/FK index bindings; synthetic school/subscription/invoice/payment values and sequence values."],["D — Finance 0060","PASS, evidence reused","Unchanged hash; prior 35/35 actual-migration evidence reused; ordering prerequisites verified. Not proof of the separate school-fee CASH domain."],["E — runner replay","PASS (temporary custom runner)","Session-only genuine execution receipts and immutable hashes; second run skipped 106 files. Actual Drizzle journal adoption NOT RUN."],["E — direct SQL rerun","PASS","106 files reexecuted without OID rebuilds. Already canonical schema also preserved."],["F — catalog target coverage","PASS","No missing expected target signature or unwanted target difference in the catalog matching pass."],["F — whole-schema semantic equivalence","FAIL / BLOCKED","Additional legacy payment-method CHECK rejects CASH accepted by canonical."],["Negative guards","PASS","Different columns, indexes, exact-signature function bodies, constraints and trigger timing/events rejected; required-column gate rejected invented backfill."],["Preflight specification syntax/planning","PASS","1,890 EXPLAIN plans against empty typed isolated relations; no Production/data preflight claim."]])}
<details><summary>Individual successful verification groups</summary>${table(["Name","Status"],checks.map(t=>[t.name,t.status]))}</details>
<h3>Failures and warnings</h3><p><strong>Unresolved failure:</strong> full semantic equivalence, demonstrated by the CASH counterexample. Structural rehearsals and object preservation remain valid over unchanged draft hashes; they cannot override this failure.</p><ul>${report.warnings.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>
<h2>F. Safety statement</h2>${table(["Item","Confirmed"],Object.entries(safety).filter(([k])=>!k.startsWith("disposable")).map(([k,x])=>[k,x]))}
<p id="cleanup">Disposable rehearsal databases were destroyed after each run. Final cluster shutdown/removal is recorded in cleanup.json and the evidence bundle.</p>
<h2>G. Final status</h2><div class="status"><strong>${status}</strong><p>No Production application is authorized. Source drafts are retained for review; do not execute them on Production, Development or any shared database.</p></div></main></html>`;
await fs.writeFile(out+"/report.html",html);
await fs.writeFile(out+"/report.json",JSON.stringify(report,null,2));
await fs.writeFile(out+"/report.md",`# Stage 2I\n\n**${status}**\n\n${blockers[0].reason}\n\n- 105 guarded draft migrations, 0061–0165. Full file/dependency inventory: report.html and manifest.json.\n- Clean 61-file replay and structural reconciliation/preservation/idempotency passed.\n- Full semantic equivalence FAILED: legacy CHECK rejects CASH while canonical allows it.\n- 0060 unchanged; prior 35/35 Finance evidence reused. No defect in 0060.\n- 1,890 Production preflight specifications: NOT RUN.\n- Journal unchanged: 54 registrations, seven old and 105 new unregistered files.\n- Production connections/writes, Development writes and shared writes: 0. No publish, db push, environment/secrets or application changes.\n- No constraint-retirement migration was silently added. A separately reviewed safe plan is required.\n`);
console.log({status,blockers:blockers.length,draftMigrations:m.migrations.length,successfulVerificationGroups:checks.length,preflights:m.preflights.length});
