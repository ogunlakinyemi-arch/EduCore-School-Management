import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { schoolIds } from "./manifest.mjs";
import { CleanupError, requireSafe, PRIMARY_IDENTITY_SQL } from "./cleanup-policy.mjs";
import { runControlledCleanup } from "./cleanup-executor.mjs";

const usage = `production-reset:cleanup --school-ids 1,2 [--dry-run]
  --authorization /private/owner-authorization.json [--evidence-file /private/preview.json]
  [--preview | --execute --confirm PRODUCTION-CLEANUP:<reviewed-digest>]
Default: offline dry-run, no connection. --identity-sql only prints a SELECT.
Execution never uses workspace DATABASE_URL. No all/force/override flags exist.`;

export async function privateJson(file) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    requireSafe(stat.isFile() && stat.size <= 2_000_000 && (stat.mode & 0o077) === 0
      && stat.uid === process.getuid?.(), "PRIVATE_OWNER_EVIDENCE_FILE_REQUIRED");
    const value = JSON.parse(await handle.readFile("utf8"));
    const noCredentials = object => {
      if (!object || typeof object !== "object") return;
      for (const [key, nested] of Object.entries(object)) {
        requireSafe(!/password|secret|connectionstring|databaseurl/i.test(key), "CREDENTIALS_NOT_ALLOWED_IN_EVIDENCE");
        noCredentials(nested);
      }
    };
    noCredentials(value);
    return value;
  } finally { await handle.close(); }
}

export function connectionConfig(target, env) {
  const value = env.PRODUCTION_RESET_DATABASE_URL;
  requireSafe(typeof value === "string" && value.length > 0, "DEDICATED_PRODUCTION_CONNECTION_REQUIRED");
  let url;
  try { url = new URL(value); } catch { throw new CleanupError("INVALID_DEDICATED_CONNECTION"); }
  requireSafe(["postgres:", "postgresql:"].includes(url.protocol)
    && url.hostname === target.host && Number(url.port || 5432) === target.port
    && decodeURIComponent(url.pathname.slice(1)) === target.database
    && decodeURIComponent(url.username) === target.role
    && !!url.password && !url.hash
    && [...url.searchParams].every(([key, entry]) => key === "sslmode" && entry === "verify-full"),
  "DEDICATED_CONNECTION_DOES_NOT_MATCH_AUTHORIZED_PRIMARY");
  // Build explicit fields: URL parameters cannot override host, TLS or options,
  // and pg must not fall back to PGHOST/PGDATABASE/etc.
  return {
    host: target.host, port: target.port, database: target.database, user: target.role,
    password: decodeURIComponent(url.password), ssl: { rejectUnauthorized: true },
    application_name: "educore-production-test-cleanup",
    connectionTimeoutMillis: 5_000, query_timeout: 35_000,
    options: "-c statement_timeout=30000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=30000",
  };
}

export async function cleanupMain(args, output = console.log, dependencies = {}) {
  if (args[0] === "--") args = args.slice(1);
  const flags = new Set(["--dry-run", "--preview", "--execute", "--help", "--identity-sql"]);
  const values = new Set(["--school-ids", "--authorization", "--evidence-file", "--confirm"]);
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    requireSafe((flags.has(key) || values.has(key)) && !options.has(key), "INVALID_OR_DUPLICATE_ARGUMENT");
    if (flags.has(key)) options.set(key, true);
    else {
      const value = args[++i];
      requireSafe(value && !value.startsWith("--"), "ARGUMENT_VALUE_REQUIRED");
      options.set(key, value);
    }
  }
  if (options.has("--help")) { output(usage); return 0; }
  if (options.has("--identity-sql")) {
    requireSafe(options.size === 1, "CONFLICTING_MODES");
    output(PRIMARY_IDENTITY_SQL); return 0;
  }
  requireSafe(["--dry-run", "--preview", "--execute"].filter(key => options.has(key)).length <= 1,
    "CONFLICTING_MODES");
  const mode = options.has("--execute") ? "execute" : options.has("--preview") ? "preview" : "dry-run";
  const ids = schoolIds(options.get("--school-ids"));
  requireSafe(!options.has("--confirm") || mode === "execute", "CONFIRMATION_ONLY_FOR_EXECUTION");
  if (!options.has("--authorization")) {
    output(JSON.stringify({
      dryRun: true, ready: false, databaseConnectionsOpened: 0, mutationsPerformed: 0,
      blockers: ["FRESH_OWNER_RESOURCE_BACKUP_RESTORE_AND_MAINTENANCE_AUTHORIZATION_REQUIRED"],
    }, null, 2));
    return 2;
  }
  const proof = await privateJson(options.get("--authorization"));
  const raw = options.has("--evidence-file") ? await privateJson(options.get("--evidence-file")) : null;
  const result = await runControlledCleanup({
    proof, ids, mode, confirmation: options.get("--confirm"),
    reviewedEvidence: raw?.evidence ?? raw,
    clientFactory: dependencies.clientFactory ?? (target => {
      // Imported only after every offline gate has passed. Never import app DB.
      const config = connectionConfig(target, process.env);
      const require = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
      const { Client } = require("pg");
      return new Client(config);
    }),
  });
  output(JSON.stringify(result, null, 2));
  return result.transactionCommitted === true ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await cleanupMain(process.argv.slice(2)); }
  catch (error) {
    console.error(JSON.stringify({
      error: error instanceof CleanupError ? error.code : "OFFLINE_INPUT_OR_AUTHORIZATION_FAILED",
      outcome: "NO_EXECUTION_STARTED", automaticRetry: false,
    }));
    process.exitCode = 2;
  }
}
