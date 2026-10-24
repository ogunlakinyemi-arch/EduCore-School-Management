import fs from "node:fs/promises";
import { schoolIds } from "./manifest.mjs";
import { createReport, compareEvidence } from "./preflight.mjs";
import { preflightSql } from "./sql.mjs";

const usage = "production-reset:preflight --school-ids 1,2 [--dry-run] [--print-sql] [--evidence-file /private/evidence.json] [--compare-with /private/after.json]";

async function readEvidence(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000
      || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
    throw new Error("PRIVATE_OWNED_REGULAR_EVIDENCE_FILE_REQUIRED");
  }
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function main(args, output = console.log) {
  const flags = new Set(["--dry-run", "--print-sql", "--execute", "--help"]);
  const values = new Set(["--school-ids", "--evidence-file", "--compare-with", "--confirm"]);
  const options = new Map();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if ((!flags.has(key) && !values.has(key)) || options.has(key)) throw new Error("INVALID_OR_DUPLICATE_ARGUMENT");
    if (flags.has(key)) options.set(key, true);
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("ARGUMENT_VALUE_REQUIRED");
      options.set(key, value);
    }
  }
  if (options.has("--help")) { output(usage); return 0; }
  const ids = schoolIds(options.get("--school-ids"));
  if (options.has("--execute")) {
    // Reject BEFORE reading files, credentials or any possible connection.
    output(JSON.stringify({
      dryRun: true, executionAvailable: false, readyForDeletion: false,
      databaseConnectionsOpened: 0, mutationsPerformed: 0,
      blockers: [
        ...(options.has("--confirm") ? [] : ["EXPLICIT_CONFIRMATION_TOKEN_REQUIRED"]),
        "TRUSTED_PRIMARY_BACKUP_HEALTH_APIS_UNAVAILABLE",
        "DESTRUCTIVE_EXECUTION_UNAVAILABLE_REGARDLESS_OF_CONFIRMATION",
      ],
    }, null, 2));
    return 2;
  }
  if (options.has("--confirm")) throw new Error("CONFIRMATION_CANNOT_ENABLE_PREFLIGHT_EXECUTION");
  if (options.has("--print-sql")) {
    if (options.has("--evidence-file") || options.has("--compare-with")) throw new Error("CONFLICTING_MODES");
    output(preflightSql(ids.join(",")));
    return 0;
  }
  if (options.has("--compare-with") && !options.has("--evidence-file")) throw new Error("BEFORE_EVIDENCE_REQUIRED");
  const evidence = options.has("--evidence-file") ? await readEvidence(options.get("--evidence-file")) : null;
  const report = createReport({ ids, evidence });
  if (options.has("--compare-with")) report.postResetObservation = compareEvidence(
    evidence, await readEvidence(options.get("--compare-with")), ids,
  );
  output(JSON.stringify(report, null, 2));
  return 2; // Never signal release readiness to shell automation.
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) {
    // Do not echo paths, arbitrary JSON content, SQL, secrets or driver errors.
    const code = typeof error.message === "string" && /^[A-Z][A-Z_]+$/.test(error.message)
      ? error.message : "PREFLIGHT_INPUT_UNREADABLE_OR_INVALID";
    console.error(JSON.stringify({ error: code, databaseConnectionsOpened: 0, mutationsPerformed: 0 }));
    process.exitCode = 2;
  }
}
