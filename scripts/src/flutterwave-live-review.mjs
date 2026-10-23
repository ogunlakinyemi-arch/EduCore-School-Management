import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Offline only: no database/HTTP driver, environment access, writes or child
// process. This cannot approve, apply, restore or enable anything.
const root = fileURLToPath(new URL("../../", import.meta.url));
export const draftOrder = ["webhook-inbox", "finalization", "workflow", "readiness"];
const sha256 = text => createHash("sha256").update(text).digest("hex");
const names = (sql, regex) => [...sql.matchAll(regex)].map(m => m[1]);

export function reviewDrafts(manifest, sources) {
  const issues = [];
  if (manifest.version !== 1 || manifest.scope !== "OFFLINE_DEVELOPMENT_REVIEW_ONLY")
    issues.push("INVALID_MANIFEST_SCOPE");
  if (JSON.stringify(manifest.stages?.map(s => s.name)) !== JSON.stringify(draftOrder))
    issues.push("INVALID_STAGE_ORDER");
  const created = new Set();
  const inventory = [];
  for (const name of draftOrder) {
    const stage = manifest.stages?.find(s => s.name === name);
    const source = sources[name];
    if (!stage || !source) { issues.push(`MISSING_STAGE:${name}`); continue; }
    for (const direction of ["up", "down"]) {
      const sql = source[direction];
      if (typeof sql !== "string" || sha256(sql) !== stage[`${direction}Sha256`])
        issues.push(`HASH_MISMATCH:${name}:${direction}`);
      if (!/^\s*BEGIN;/m.test(sql ?? "") || !/COMMIT;\s*$/.test(sql ?? ""))
        issues.push(`TRANSACTION_BOUNDARY_MISSING:${name}:${direction}`);
    }
    const sql = source.up.replace(/--[^\n]*/g, "");
    if (/\b(?:DROP|TRUNCATE)\s+(?:TABLE|INDEX|FUNCTION)\b/i.test(sql))
      issues.push(`DESTRUCTIVE_UP_OPERATION:${name}`);
    for (const m of sql.matchAll(/CREATE TABLE\s+(\w+)|REFERENCES\s+(\w+)/g)) {
      if (m[1]) {
        if (!m[1].startsWith("flutterwave_live_")) issues.push(`NON_ISOLATED_TABLE:${m[1]}`);
        created.add(m[1]);
      } else if (!created.has(m[2])) issues.push(`DEPENDENCY_BEFORE_PARENT:${m[2]}`);
    }
    for (const m of sql.matchAll(/\b(?:ALTER TABLE|UPDATE(?!\s+(?:OR|ON)\b)|INSERT INTO|DELETE FROM)\s+(\w+)/g)) {
      if (!m[1].startsWith("flutterwave_live_")) issues.push(`NON_ISOLATED_MUTATION:${m[1]}`);
    }
    if (!/RAISE EXCEPTION/.test(source.down) || /\bDROP[^;]*\bCASCADE\b/i.test(source.down))
      issues.push(`UNSAFE_ROLLBACK:${name}`);
    inventory.push({
      stage: name, upSha256: sha256(source.up), downSha256: sha256(source.down),
      tables: names(sql, /CREATE TABLE\s+(\w+)/g),
      indexes: names(sql, /CREATE (?:UNIQUE )?INDEX\s+(\w+)/g),
      functions: names(sql, /CREATE FUNCTION\s+(\w+)/g),
      triggers: names(sql, /CREATE TRIGGER\s+(\w+)/g),
      namedConstraints: names(sql, /(?:ADD )?CONSTRAINT\s+(\w+)/g),
      foreignKeyDeclarations: [...sql.matchAll(/\bREFERENCES\s+/g)].length,
      checkDeclarations: [...sql.matchAll(/\bCHECK\s*\(/g)].length,
    });
  }
  const all = draftOrder.map(n => sources[n]?.up ?? "").join("\n");
  for (const [parent, child] of [
    ["ADD CONSTRAINT live_review_tenant_uq", "ADD CONSTRAINT live_intent_review_scope_fk"],
    ["ADD CONSTRAINT live_intent_verified_identity_uq", "ADD CONSTRAINT live_collection_verified_identity_fk"],
    ["ADD CONSTRAINT live_intent_verified_transaction_uq", "ADD CONSTRAINT live_event_verified_identity_fk"],
    ["CREATE TABLE flutterwave_live_webhook_receipts", "ADD CONSTRAINT live_event_authenticated_source_fk"],
  ]) {
    if (all.indexOf(parent) < 0 || all.indexOf(child) < 0 || all.indexOf(parent) >= all.indexOf(child))
      issues.push(`SUPPORTING_KEY_ORDER_INVALID:${child}`);
  }
  const requiredMarkers = [
    "live_intent_review_scope_fk", "live_collection_verified_identity_fk",
    "live_event_verified_identity_fk", "live_event_authenticated_source_fk",
    "live_intent_history_guard", "live_collection_history_guard",
    "live_official_receipt_history", "live_operator_history",
  ];
  for (const marker of requiredMarkers) if (!all.includes(marker)) issues.push(`MISSING_GUARD:${marker}`);
  for (const [label, pattern] of [
    ["PAYLOAD_DEDUP", /UNIQUE\s*\(provider,\s*environment,\s*payload_sha256\)/],
    ["SEMANTIC_DEDUP", /UNIQUE\s*\(environment,\s*semantic_key\)/],
    ["INTENT_EVENT_DEDUP", /UNIQUE\s*\(intent_id,\s*kind\)/],
    ["GROSS", /gross_minor\s*=\s*500000/],
    ["SCHOOL", /school_minor\s*=\s*190000/],
    ["PARTNER_LIABILITY", /amount_minor\s*=\s*10000/],
  ]) if (!pattern.test(all)) issues.push(`MISSING_INVARIANT:${label}`);
  if (created.size !== 14) issues.push("EXPECTED_14_TABLES");
  return {
    offlineReviewPassed: issues.length === 0, issues, inventory,
    inventoryMethod: "Static declaration scan bound to exact full SQL hashes; not a SQL execution/parser proof",
    migrationApproved: false, applicationTargetCompatibilityVerified: false,
    publishedRuntimeBindingVerified: false, backupRestoreVerified: false,
    liveActivationAuthorized: false,
  };
}

export function loadReview(base = root) {
  const manifest = JSON.parse(readFileSync(resolve(base, "docs/flutterwave-live-development-review.manifest.json"), "utf8"));
  const sources = Object.fromEntries(draftOrder.map(name => [name, Object.fromEntries(
    ["up", "down"].map(direction => [direction, readFileSync(resolve(base,
      `lib/db/dev-reconciliation/flutterwave-live-${name}.${direction}.sql`), "utf8")]),
  )]));
  return { manifest, sources };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).length) {
    console.error("This offline reviewer accepts no execution, approval or database options.");
    process.exitCode = 2;
  } else {
    const { manifest, sources } = loadReview();
    const report = reviewDrafts(manifest, sources);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.offlineReviewPassed ? 0 : 1;
  }
}
