#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseArguments, readConfirmation, identityDigest, prepareBackupRoot,
  refuseDeploymentEnvironment, requireSafe, SafetyError } from "./safety.mjs";
import { verifyDevelopmentBackup } from "./verification.mjs";

const help = `Development backup + disposable restore verification (PostgreSQL 16).
No Production connections. No live DDL/DML, migrations, Publish or app imports.

Modes:
  --dry-run                 Default. Filesystem checks only; NO DB connections.
  --print-confirmation      Print token for an independently prepared proof.
  --run                     Explicitly perform read-only source backup + clone test.

Required:
  --target-confirmation /absolute/private/confirmation.json
  --backup-root /absolute/private/directory-outside-workspace-and-tmp
  --confirm DEVELOPMENT:<identity-sha256>       (--run only)
  --confirm-source-quiesced                    (--run only; does NOT pause writers)

See scripts/src/dev-backup/README.md. No connection URLs/password arguments exist.
`;

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.mode === "help") { console.log(help); return 0; }
  refuseDeploymentEnvironment();
  requireSafe(options.proofPath, "TARGET_CONFIRMATION_FILE_REQUIRED");
  const proof = await readConfirmation(options.proofPath);
  const token = `DEVELOPMENT:${identityDigest(proof.identity)}`;
  if (options.mode === "print-confirmation") {
    console.log(token); return 0;
  }
  await prepareBackupRoot(options.backupRoot, false);
  if (options.mode === "dry-run") {
    console.log(JSON.stringify({ status: "DRY_RUN_ONLY", connectionsOpened: 0, filesCreated: 0,
      independentProofStructurallyValid: true, serverIdentityVerified: false,
      backupCreated: false, restoreVerified: false,
      requiredNextConfirmation: token }));
    return 0;
  }
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const previousMask = process.umask(0o077);
  try {
    const result = await verifyDevelopmentBackup({ proof, confirmation: options.confirmation,
      backupRoot: options.backupRoot, quiesced: options.quiesced, signal: abort.signal });
    console.log(JSON.stringify(result));
    return result.status === "PASS" ? 0 : 1;
  } finally {
    process.umask(previousMask);
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    // Never log raw pg errors, child stderr, rows, connection objects or stacks.
    console.error(JSON.stringify({ status: "FAIL", code: error instanceof SafetyError ? error.code : "PREFLIGHT_FAILED" }));
    process.exitCode = 1;
  });
}
