import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { identitySql, assertIdentity, validateConfirmation, identityDigest, requireSafe,
  assertSocket, prepareBackupRoot, refuseDeploymentEnvironment, SafetyError, hash } from "./safety.mjs";
import { databaseClient, command, createDisposable, verifyToolchain } from "./processes.mjs";
import { assertSupportedSource, captureEvidence, compareEvidence, sequenceEvidence,
  normalizeSchemaDump } from "./evidence.mjs";

async function fileHash(filename) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest("hex");
}
async function privateJson(filename, value) {
  await fs.writeFile(filename, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
}
async function beginSnapshot(client) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL search_path=pg_catalog");
  const snapshot = (await client.query("SELECT pg_export_snapshot() AS snapshot")).rows[0].snapshot;
  requireSafe(/^[0-9A-Fa-f-]+$/.test(snapshot), "INVALID_EXPORTED_SNAPSHOT");
  return snapshot;
}
async function schemaDump(connection, filename, snapshot, signal) {
  await command("pg_dump", ["--schema-only", "--no-owner", "--no-acl", "--no-password",
    ...(snapshot ? [`--snapshot=${snapshot}`] : []), `--file=${filename}`],
  { connection, readOnly: true, signal });
  await fs.chmod(filename, 0o600);
  return hash(normalizeSchemaDump(await fs.readFile(filename, "utf8")));
}

export async function verifyDevelopmentBackup({ proof, confirmation, backupRoot, quiesced, signal }) {
  refuseDeploymentEnvironment();
  validateConfirmation(proof);
  requireSafe(confirmation === `DEVELOPMENT:${identityDigest(proof.identity)}`, "EXPLICIT_TARGET_CONFIRMATION_REQUIRED");
  requireSafe(quiesced === true, "SOURCE_WRITE_FREEZE_CONFIRMATION_REQUIRED");
  await assertSocket(proof.connection);
  const root = await prepareBackupRoot(backupRoot, true);
  await verifyToolchain();
  const source = databaseClient(proof.connection, true);
  let runDirectory, disposable, failure, result, stage = "SOURCE_CONNECT", transaction = false;
  let restored, postCheck;
  try {
    await source.connect();
    const identity = (await source.query(identitySql)).rows[0];
    assertIdentity(proof.identity, identity);
    requireSafe((await source.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only === "on",
      "SOURCE_NOT_READ_ONLY");
    await assertSupportedSource(source);
    const size = BigInt((await source.query("SELECT pg_database_size(current_database())::text AS bytes")).rows[0].bytes);
    const backupSpace = await fs.statfs(root, { bigint: true });
    const tempSpace = await fs.statfs("/tmp", { bigint: true });
    requireSafe(backupSpace.bavail * backupSpace.bsize > size * 2n &&
      tempSpace.bavail * tempSpace.bsize > size * 3n, "INSUFFICIENT_BACKUP_OR_RESTORE_SPACE");
    runDirectory = await fs.mkdtemp(path.join(root, "development-"));
    await fs.chmod(runDirectory, 0o700);
    stage = "SOURCE_SNAPSHOT";
    const snapshot = await beginSnapshot(source); transaction = true;
    const before = await captureEvidence(source);
    await privateJson(path.join(runDirectory, "before.json"), before);
    const schemaHash = await schemaDump(proof.connection, path.join(runDirectory, "source-schema.sql"), snapshot, signal);
    const archive = path.join(runDirectory, "development.dump");
    stage = "DUMP";
    // A complete custom-format DATABASE archive: data, large objects, sequence
    // state, every application schema, functions, triggers and dependencies.
    // No table filters, application imports, migration commands or role dumps.
    await command("pg_dump", ["--format=custom", "--no-password", `--snapshot=${snapshot}`, `--file=${archive}`],
      { connection: proof.connection, readOnly: true, signal });
    await fs.chmod(archive, 0o600);
    requireSafe(JSON.stringify(before.sequences) === JSON.stringify(await sequenceEvidence(source)),
      "SOURCE_SEQUENCES_CHANGED_DURING_DUMP");
    await source.query("ROLLBACK"); transaction = false;
    const archiveSha256 = await fileHash(archive);
    await privateJson(path.join(runDirectory, "archive.json"), { format: "pg_dump-custom",
      sha256: archiveSha256, identitySha256: identityDigest(identity), sourceSchemaSha256: schemaHash,
      ownershipAndAcl: "Retained in archive; deliberately not applied to disposable restore",
      excludedClusterGlobals: ["role definitions/passwords/memberships", "tablespace definitions"],
    });
    stage = "DISPOSABLE_CREATE";
    disposable = await createDisposable({ collate: identity.collate, ctype: identity.ctype, signal });
    const verifyAdmin = databaseClient(disposable.adminConnection, true);
    try {
      await verifyAdmin.connect();
      const cloneIdentity = (await verifyAdmin.query(identitySql)).rows[0];
      requireSafe(cloneIdentity.system_identifier !== identity.system_identifier &&
        cloneIdentity.data_directory === disposable.data &&
        disposable.connection.host !== proof.connection.host, "RESTORE_TARGET_NOT_ISOLATED");
    } finally { await verifyAdmin.end(); }
    stage = "RESTORE";
    requireSafe(await fileHash(archive) === archiveSha256, "ARCHIVE_CHECKSUM_MISMATCH");
    await command("pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner", "--no-acl",
      "--no-tablespaces", "--no-password", "--dbname=verified_restore", archive],
    { connection: disposable.connection, signal });
    stage = "RESTORED_EVIDENCE";
    // Admin is needed to read pg_largeobject, never to run archive SQL.
    restored = databaseClient({ ...disposable.connection, user: "restore_admin" }, true);
    await restored.connect();
    await beginSnapshot(restored);
    const after = await captureEvidence(restored);
    await privateJson(path.join(runDirectory, "restored.json"), after);
    const restoredSchemaHash = await schemaDump(
      { ...disposable.connection, user: "restore_admin" },
      path.join(runDirectory, "restored-schema.sql"), undefined, signal);
    compareEvidence(before, after);
    requireSafe(schemaHash === restoredSchemaHash, "COMPLETE_SCHEMA_DUMP_MISMATCH");
    await restored.query("ROLLBACK");
    await restored.end(); restored = undefined;
    stage = "SOURCE_STABILITY";
    // Independent fresh snapshot detects concurrent application/DDL changes.
    // This utility never pauses workers, locks tables against writers or fixes data.
    postCheck = databaseClient(proof.connection, true);
    await postCheck.connect();
    assertIdentity(identity, (await postCheck.query(identitySql)).rows[0]);
    const postSnapshot = await beginSnapshot(postCheck);
    const current = await captureEvidence(postCheck);
    compareEvidence(before, current);
    const currentSchemaHash = await schemaDump(proof.connection,
      path.join(runDirectory, "source-after-schema.sql"), postSnapshot, signal);
    requireSafe(currentSchemaHash === schemaHash, "SOURCE_SCHEMA_CHANGED_DURING_VERIFICATION");
    await postCheck.query("ROLLBACK");
    await postCheck.end(); postCheck = undefined;
    requireSafe(await fileHash(archive) === archiveSha256, "ARCHIVE_CHECKSUM_MISMATCH");
    result = { status: "PASS", stage: "COMPLETE", backupDirectory: runDirectory,
      tablesVerified: before.data.length, sequencesVerified: before.sequences.count,
      sourceReadOnly: true, productionConnections: 0, restoreVerified: true,
      ownershipAndAclRestorationVerified: false, globalRolesIncluded: false };
  } catch (error) {
    failure = { status: "FAIL", stage, code: error instanceof SafetyError ? error.code :
      (/^[A-Z0-9_]{2,64}$/.test(error?.code || "") ? error.code : "OPERATION_FAILED"),
    backupRetained: Boolean(runDirectory), restoreVerified: false };
  } finally {
    for (const client of [restored, postCheck]) {
      if (client) await client.end().catch(() => {});
    }
    if (transaction) await source.query("ROLLBACK").catch(() => {});
    await source.end().catch(() => {});
    if (disposable) {
      try { await disposable.stop(); }
      catch { failure = { status: "FAIL", stage: "CLEANUP", code: "DISPOSABLE_CLEANUP_FAILED",
        backupRetained: Boolean(runDirectory), restoreVerified: false,
        disposableDirectory: disposable.base }; }
    }
  }
  const summary = failure || { ...result, disposableRemoved: true };
  if (runDirectory) await privateJson(path.join(runDirectory, "result.json"), summary);
  return summary;
}
