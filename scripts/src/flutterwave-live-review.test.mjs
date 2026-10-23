import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadReview, reviewDrafts } from "./flutterwave-live-review.mjs";

describe("offline LIVE review is not migration or release authority", () => {
  it("verifies all eight full hashes, source inventory and disabled approval gates", () => {
    const { manifest, sources } = loadReview();
    const r = reviewDrafts(manifest, sources);
    assert.deepEqual(r.issues, []);
    assert.equal(r.inventory.flatMap(s => s.tables).length, 14);
    assert.equal(r.inventory.reduce((n, s) => n + s.foreignKeyDeclarations, 0), 19);
    for (const key of ["migrationApproved", "applicationTargetCompatibilityVerified",
      "publishedRuntimeBindingVerified", "backupRestoreVerified", "liveActivationAuthorized"])
      assert.equal(r[key], false);
  });
  it("rejects a reordered plan", () => {
    const { manifest, sources } = loadReview();
    manifest.stages.reverse();
    assert.ok(reviewDrafts(manifest, sources).issues.includes("INVALID_STAGE_ORDER"));
  });
  it("rejects even a comment-only draft change without reapproval of its exact bytes", () => {
    const { manifest, sources } = loadReview();
    sources.finalization.up += "\n-- changed\n";
    assert.ok(reviewDrafts(manifest, sources).issues.includes("HASH_MISMATCH:finalization:up"));
  });
  it("rejects unsafe rollback and source-level cross-namespace mutations", () => {
    const { manifest, sources } = loadReview();
    sources.readiness.down += "\nDROP TABLE flutterwave_live_operator_reviews CASCADE;";
    sources.readiness.up += "\nUPDATE student_subscription_payments SET status='PAID';";
    const r = reviewDrafts(manifest, sources);
    assert.ok(r.issues.includes("UNSAFE_ROLLBACK:readiness"));
    assert.ok(r.issues.includes("NON_ISOLATED_MUTATION:student_subscription_payments"));
    assert.equal(r.offlineReviewPassed, false);
  });
  it("requires supporting uniqueness before dependent composite foreign keys", () => {
    const { manifest, sources } = loadReview();
    sources.readiness.up = sources.readiness.up.replace("ADD CONSTRAINT live_review_tenant_uq", "ADD CONSTRAINT missing_review_key");
    assert.ok(reviewDrafts(manifest, sources).issues.includes(
      "SUPPORTING_KEY_ORDER_INVALID:ADD CONSTRAINT live_intent_review_scope_fk"));
  });
  it("refuses destructive up operations even in a review manifest", () => {
    const { manifest, sources } = loadReview();
    sources.readiness.up += "\nDROP TABLE student_subscription_payments;";
    assert.ok(reviewDrafts(manifest, sources).issues.includes("DESTRUCTIVE_UP_OPERATION:readiness"));
  });
  it("has no database/provider/environment or application imports and no write path", () => {
    const source = readFileSync(new URL("./flutterwave-live-review.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(source, /process\.env|fetch\(|writeFile|appendFile|child_process|@workspace\/db|from ["']pg/);
  });
  it("rejects apply, approval and target arguments in a credential-free subprocess", () => {
    const script = fileURLToPath(new URL("./flutterwave-live-review.mjs", import.meta.url));
    for (const flag of ["--apply", "--approve", "--production", "--database"]) {
      const r = spawnSync(process.execPath, [script, flag], { env: {}, encoding: "utf8" });
      assert.equal(r.status, 2);
      assert.match(r.stderr, /accepts no execution, approval or database options/);
    }
  });
});
