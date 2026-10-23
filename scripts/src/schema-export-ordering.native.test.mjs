// Explicit disposable-only regression. Not in the default offline test glob.
// Run with unwrapped Node, clean environment and --import scripts/node_modules/tsx/dist/loader.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_HEADER, exportAudit } from "./export-dependency-aware-schema.mjs";
import { exportLiveRehearsalTarget } from "./live-readiness-target-schema.mjs";
import { NativeRehearsal, hash } from "./flutterwave-rehearsal/native.mjs";
import { splitSql } from "./schema-export/sql.mjs";
import { loadReview, reviewDrafts } from "./flutterwave-live-review.mjs";

if (process.argv.length !== 2 ||
    Object.keys(process.env).some(k => !["PATH", "HOME", "LANG", "LC_ALL"].includes(k)))
  throw new Error("Clean environment required; no application configuration accepted");
const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);

test("actual export workflows: original raw 42830, ordered native success, unchanged SQL and pins", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fw-export-order-"));
  fs.chmodSync(directory, 0o700);
  const evidence = path.join(root, "generated-artifacts/flutterwave-readiness-followup", path.basename(directory));
  fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const report = { startedAt: new Date().toISOString(), commands: [], checks: [],
    hold: true, applicationDatabaseConnected: false, ledgerAccessed: false,
    providerCalled: false, servicesRestarted: false };
  const r = new NativeRehearsal(directory, evidence, report);
  try {
    const pins = loadReview(root);
    assert.equal(reviewDrafts(pins.manifest, pins.sources).offlineReviewPassed, true);
    const audit = path.join(directory, "audit.sql"), target = path.join(directory, "target.sql");
    await exportAudit(audit);
    report.export = await exportLiveRehearsalTarget(target);
    const raw = fs.readFileSync(target + ".raw.sql", "utf8");
    const ordered = fs.readFileSync(target, "utf8");
    const auditSql = fs.readFileSync(audit, "utf8");
    const rawStatements = splitSql(raw), orderedStatements = splitSql(ordered);
    r.check(hash(raw) === "a9f092605b523d61ae1981daa4a39b22a62f79929f8bff6f767003546ff3f8c0",
      "fresh vendor bytes reproduce retained original raw export");
    r.check(auditSql === AUDIT_HEADER + ordered, "both real entry points emit byte-identical ordered SQL apart from exact audit header");
    r.equal([...rawStatements].sort(), [...orderedStatements].sort(), "complete duplicate-aware SQL multiset unchanged");
    r.check(fs.readFileSync(audit + ".raw.sql", "utf8") === raw, "audit preserves exact raw evidence sidecar");
    for (const file of [audit, audit + ".raw.sql", audit + ".graph.json", target, target + ".json"])
      fs.copyFileSync(file, path.join(evidence, path.basename(file)));
    const fkPosition = items => items.findIndex(s => s.includes('ADD CONSTRAINT "staff_nfc_allocations_subscription_owner_term_fk"'));
    const keyPosition = items => items.findIndex(s => s.startsWith('CREATE UNIQUE INDEX "staff_nfc_subscriptions_id_employee_school_term_uq"'));
    report.positions = { rawKey: keyPosition(rawStatements) + 1, rawFk: fkPosition(rawStatements) + 1,
      correctedKey: keyPosition(orderedStatements) + 1, correctedFk: fkPosition(orderedStatements) + 1 };
    r.check(keyPosition(rawStatements) > fkPosition(rawStatements) &&
      keyPosition(orderedStatements) < fkPosition(orderedStatements), "same required unique index now precedes dependent FK");
    for (const name of ["transport_history_event_reason_check", "transport_routes_weekdays_check"]) {
      r.equal(orderedStatements.filter(s => s.includes('"' + name + '"')),
        rawStatements.filter(s => s.includes('"' + name + '"')), "exact CHECK statement retained: " + name);
    }
    await r.start({ encoding: "UTF8" });
    for (const db of ["rehearsal_raw", "rehearsal_corrected", "rehearsal_audit"]) r.create(db);
    const before = r.catalog("rehearsal_raw");
    r.sql("rehearsal_raw", "BEGIN;\n" + raw + "\nCOMMIT;", "original-raw-42830", "42830");
    r.equal(r.catalog("rehearsal_raw"), before, "original raw failure rolls back to empty catalog");
    for (const [db, sql] of [["rehearsal_corrected", ordered], ["rehearsal_audit", auditSql]]) {
      r.sql(db, "BEGIN;\n" + sql + "\nCOMMIT;", "corrected-workflow-" + db);
      const catalog = r.catalog(db);
      r.check(catalog.tables.length === 187 &&
        catalog.constraints.filter(c => c.kind === "f").length === 693 &&
        catalog.constraints.every(c => c.validated) && catalog.indexes.every(i => i.valid && i.ready),
        db + " installs complete validated model");
      r.check(catalog.constraints.some(c => c.name === "staff_nfc_allocations_subscription_owner_term_fk" &&
        c.supportingIndex === "staff_nfc_subscriptions_id_employee_school_term_uq" && c.validated),
        db + " binds same original supporting index");
    }
    const final = loadReview(root);
    r.equal(final, pins, "eight pinned draft bytes and manifest unchanged");
    report.status = "ORDERING_REGRESSION_PASS_HOLD";
  } catch (error) {
    report.status = "FAIL_HOLD";
    report.failure = String(error.stack ?? error);
    throw error;
  } finally {
    await r.close();
    report.finishedAt = new Date().toISOString();
    const text = JSON.stringify(report, null, 2) + "\n";
    fs.writeFileSync(path.join(evidence, "report.json"), text);
    console.log(JSON.stringify({ evidence, status: report.status, checks: report.checks.length, sha256: hash(text) }));
  }
});
