import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateConfirmation, identityDigest, assertIdentity, parseArguments,
  refuseDeploymentEnvironment, prepareBackupRoot, readConfirmation, workspaceRoot } from "./safety.mjs";
import { compareEvidence, normalizeSchemaDump } from "./evidence.mjs";
import { cleanEnvironment, databaseClient } from "./processes.mjs";

const proof = () => ({
  environment: "development", verifiedBy: "replit-development-read-only",
  verifiedAt: new Date().toISOString(),
  connection: { host: "/tmp/example-private-socket", port: 5432, database: "development_fixture", user: "fixture" },
  identity: { database: "development_fixture", database_oid: "1234", system_identifier: "7654321",
    data_directory: "/tmp/example-data", server_started: "2026-10-17T00:00:00.000000Z",
    server_address: null, port: "5432", role: "fixture", server_version_num: "160010",
    in_recovery: false, encoding: "UTF8", collate: "C", ctype: "C", locale_provider: "c" },
});

test("requires recent, independently labelled Development proof, not an environment label alone", () => {
  assert.equal(validateConfirmation(proof()).environment, "development");
  for (const change of [{ environment: "production" }, { verifiedBy: "self-probe" },
    { verifiedAt: "invalid" }, { verifiedAt: new Date(Date.now() - 31 * 60_000).toISOString() },
    { verifiedAt: new Date(Date.now() + 60_000).toISOString() }]) {
    assert.throws(() => validateConfirmation({ ...proof(), ...change }));
  }
});
test("refuses remote/credential-based, named Production and ambiguous targets", () => {
  for (const host of ["localhost", "127.0.0.1", "https://example.invalid", "/tmp/production"]) {
    const p = proof(); p.connection.host = host;
    assert.throws(() => validateConfirmation(p));
  }
  const credential = proof(); credential.connection.password = "never-log-this";
  assert.throws(() => validateConfirmation(credential));
  for (const change of [{ database_oid: undefined }, { system_identifier: "" }, { in_recovery: true },
    { server_address: "127.0.0.1" }, { role: "different" }, { locale_provider: "i" },
    { server_version_num: "170001" }]) {
    const p = proof(); Object.assign(p.identity, change);
    assert.throws(() => validateConfirmation(p));
  }
});
test("identity matching includes cluster, database, restart, directory and role", () => {
  const p = proof();
  assertIdentity(p.identity, { ...p.identity });
  for (const field of Object.keys(p.identity)) {
    assert.throws(() => assertIdentity(p.identity, { ...p.identity, [field]: "changed" }));
  }
  assert.equal(identityDigest(p.identity).length, 64);
});
test("Production execution is refused even with a valid proof", () => {
  for (const env of [{ REPLIT_DEPLOYMENT: "" }, { REPLIT_DEPLOYMENT_ID: "x" },
    { NODE_ENV: "production" }, { REPLIT_ENVIRONMENT: "production" }]) {
    assert.throws(() => refuseDeploymentEnvironment(env), /PRODUCTION_EXECUTION_REFUSED/);
  }
});
test("CLI defaults to no-connect dry run and rejects target overrides/unknown flags", () => {
  assert.equal(parseArguments([]).mode, "dry-run");
  for (const args of [["--source-url", "never-log-this"], ["--restore-target", "anything"],
    ["--run", "--dry-run"], ["--run", "--run"], ["--confirm"], ["--force"]]) {
    assert.throws(() => parseArguments(args));
  }
});
test("source clients and child processes cannot inherit ambient credentials or writable defaults", () => {
  const env = cleanEnvironment(proof().connection, true);
  assert.equal(env.PGPASSFILE, "/dev/null");
  assert.equal(env.PGSERVICEFILE, "/dev/null");
  assert.match(env.PGOPTIONS, /default_transaction_read_only=on/);
  assert.equal(Object.hasOwn(env, "DATABASE_URL"), false);
  assert.equal(Object.hasOwn(env, "PGPASSWORD"), false);
  const client = databaseClient(proof().connection, true);
  assert.match(client.connectionParameters.options, /default_transaction_read_only=on/);
  assert.equal(client.connectionParameters.ssl, false);
  assert.equal(typeof client.connectionParameters.password, "function");
});
test("backups cannot be written to the project, temp storage or a symlink", async () => {
  await assert.rejects(prepareBackupRoot(path.join(workspaceRoot, "secret-backup")));
  await assert.rejects(prepareBackupRoot("/tmp/secret-backup"));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "backup-path-unit-"));
  try {
    await fs.symlink(os.homedir(), path.join(temp, "link"));
    await assert.rejects(prepareBackupRoot(path.join(temp, "link")), /SYMLINK_PATH_REFUSED/);
  } finally { await fs.rm(temp, { recursive: true }); }
});
test("confirmation files must be private and never follow symlinks", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "backup-proof-unit-"));
  const filename = path.join(temp, "proof.json");
  try {
    await fs.writeFile(filename, JSON.stringify(proof()), { mode: 0o600 });
    assert.equal((await readConfirmation(filename)).environment, "development");
    await fs.symlink(filename, path.join(temp, "alias"));
    await assert.rejects(readConfirmation(path.join(temp, "alias")), /SYMLINK_PATH_REFUSED/);
    await fs.chmod(filename, 0o644);
    await assert.rejects(readConfirmation(filename), /PRIVATE_CONFIRMATION_FILE_REQUIRED/);
  } finally { await fs.rm(temp, { recursive: true }); }
});
test("row counts, content fingerprints, sequences, blobs and FK bindings must all match", () => {
  const expected = { catalog: { constraints: { count: 1, sha256: "fk-index-a" } },
    data: [{ schema: "public", name: "fixture", rows: "2", sha256: "rows-a" }],
    sequences: { count: 1, sha256: "sequence-a" }, largeObjects: { rows: "1", sha256: "blob-a" },
    largeObjectMetadata: { count: 1, sha256: "oid-a" } };
  compareEvidence(expected, structuredClone(expected));
  for (const key of ["catalog", "data", "sequences", "largeObjects", "largeObjectMetadata"]) {
    const changed = structuredClone(expected);
    changed[key] = key === "catalog" ? { constraints: { count: 1, sha256: "fk-index-b" } } : {};
    assert.throws(() => compareEvidence(expected, changed), /MISMATCH/);
  }
});
test("schema normalization excludes only random delimiters and source-version metadata", () => {
  const a = "-- Dumped from database version 16.9\n\\restrict abc123\nCREATE TABLE x(id int);\n\\unrestrict abc123\n";
  const b = a.replace("16.9", "16.10").replaceAll("abc123", "xyz789");
  assert.equal(normalizeSchemaDump(a), normalizeSchemaDump(b));
  assert.notEqual(normalizeSchemaDump(a), normalizeSchemaDump(b.replace("id int", "id text")));
});
test("actual CLI dry run and wrong-token refusal create no files or DB connections", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "backup-cli-unit-"));
  const filename = path.join(temp, "proof.json");
  const backupRoot = path.join(os.homedir(), `.educore-never-created-${path.basename(temp)}`);
  try {
    await fs.writeFile(filename, JSON.stringify(proof()), { mode: 0o600 });
    const invoke = mode => spawnSync(process.execPath, [
      path.join(workspaceRoot, "scripts/src/dev-backup/cli.mjs"), mode,
      "--target-confirmation", filename, "--backup-root", backupRoot,
      ...(mode === "--run" ? ["--confirm", "WRONG_TOKEN", "--confirm-source-quiesced"] : []),
    ], { env: { ...cleanEnvironment(), NODE_ENV: "test" }, encoding: "utf8" });
    const dry = invoke("--dry-run");
    assert.equal(dry.status, 0, dry.stderr);
    const summary = JSON.parse(dry.stdout);
    assert.equal(summary.status, "DRY_RUN_ONLY");
    assert.equal(summary.connectionsOpened, 0);
    assert.equal(summary.restoreVerified, false);
    const denied = invoke("--run");
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /EXPLICIT_TARGET_CONFIRMATION_REQUIRED/);
    // The source socket in this fixture does not exist: connecting would fail,
    // so the explicit code also proves refusal happened before source access.
    await assert.rejects(fs.stat(backupRoot), { code: "ENOENT" });
  } finally { await fs.rm(temp, { recursive: true }); }
});
