// Offline source/DDL review only. No database, env-file loading, network or release switches.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
const root=new URL("../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");
const paths=[
  "lib/db/drizzle/0176_direct_student_live_preparation.sql",
  "lib/db/drizzle/0177_direct_student_live_release_reviews.sql",
  "lib/api-spec/direct-student-live-release.yaml",
  "artifacts/api-server/src/services/direct-student-live-release.ts",
  "artifacts/api-server/src/services/direct-student-live-payments.ts",
  "artifacts/api-server/src/lib/flutterwave-direct-live-config.ts",
];
const hashes=Object.fromEntries(paths.map(path=>[path,createHash("sha256").update(read(path)).digest("hex")]));
const ddl=read(paths[1]),service=read(paths[3]),payment=read(paths[4]),config=read(paths[5]);
// Bare boolean CHECKs can be double-wrapped by Publish introspection. Keep the
// explicit predicate; NOT NULL + IS TRUE preserves mandatory no-split consent.
for(const path of paths.slice(0,2)){
  assert.match(read(path),/no_split_confirmed boolean NOT NULL CHECK\(no_split_confirmed IS TRUE\)/);
}
assert.equal((ddl.match(/CREATE TABLE /g)??[]).length,3);
assert.equal((ddl.match(/CREATE TRIGGER /g)??[]).length,3);
assert.doesNotMatch(ddl,/(?:^|\n)\s*(?:UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE|DROP TABLE|ALTER TABLE)\b/im);
assert.match(ddl,/STUDENT_DIRECT_3200_V1/);
assert.match(ddl,/NEW_ONLY_PRESERVE_LEGACY/);
assert.match(service,/EXPLICIT_REVIEW_REQUIRED/);
assert.match(service,/STALE_REVIEW_EVIDENCE/);
assert.match(service,/school_memberships/);
assert.match(service,/student_direct_live_review_bindings/);
assert.match(service,/checkoutEnabled:false/);
assert.match(config,/EDUCORE_FLUTTERWAVE_DIRECT_WEBHOOK_URL/);
assert.match(config,/EDUCORE_FLUTTERWAVE_DIRECT_RELEASE/);
assert.match(payment,/SUBSCRIPTION_RULE_BANK_CREDIT_VERIFIED/);
assert.match(payment,/EXISTING_ATTEMPT_RECONCILIATION_REQUIRED/);
assert.match(payment,/timingSafeEqual/);
const transport=read("artifacts/api-server/src/lib/flutterwave-live-transport.ts");
const checkout=transport.slice(transport.indexOf("async directStudentCheckout"),transport.indexOf("async directStudentCollection"));
assert.match(checkout,/amount:3200,currency:"NGN"/);
assert.doesNotMatch(checkout,/subaccounts:|split:|payment_plan:|transaction_charge:|settlement:/);
const routes=read("artifacts/api-server/src/routes/direct-student-live-release.ts");
assert.match(routes,/router\.post\(`\$\{base\}\/reviews\/:id\/decisions`/);
assert.doesNotMatch(routes,/router\.get[^\n]+decideDirectReleaseReview/);
console.log(JSON.stringify({kind:"OFFLINE_PREPARATION_REVIEW",sourceRoot:fileURLToPath(root),checks:"PASS",
  hashes,applicationDatabaseAccess:false,providerCalls:false,migrationsApplied:false,
  operationalReleaseApproved:false,targetSchemaVerified:false,merchantRoutingVerified:false,
  remainingAuthorization:"Verify target, install reviewed additive DDL with explicit permission, verify actual merchant/dashboard evidence and separately authorize runtime release."},null,2));
