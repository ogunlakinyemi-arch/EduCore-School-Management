import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export class SafetyError extends Error {
  constructor(code) { super(code); this.name = "SafetyError"; this.code = code; }
}
export const requireSafe = (condition, code) => { if (!condition) throw new SafetyError(code); };
export const hash = value => createHash("sha256").update(value).digest("hex");
export const quoteId = value => `"${String(value).replaceAll('"', '""')}"`;
export const quoteLiteral = value => `'${String(value).replaceAll("'", "''")}'`;

// This query must also be executed INDEPENDENTLY through Replit's Development
// read-only SQL tool when preparing the confirmation file. No credentials.
export const identitySql = `SELECT current_database() AS database,
  (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,
  (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
  current_setting('data_directory') AS data_directory,
  to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS server_started,
  inet_server_addr()::text AS server_address,
  current_setting('port') AS port, current_user AS role,
  current_setting('server_version_num') AS server_version_num,
  pg_is_in_recovery() AS in_recovery,
  (SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname=current_database()) AS encoding,
  (SELECT datcollate FROM pg_database WHERE datname=current_database()) AS collate,
  (SELECT datctype FROM pg_database WHERE datname=current_database()) AS ctype,
  (SELECT datlocprovider::text FROM pg_database WHERE datname=current_database()) AS locale_provider`;

const identityFields = ["database", "database_oid", "system_identifier", "data_directory",
  "server_started", "server_address", "port", "role", "server_version_num", "in_recovery",
  "encoding", "collate", "ctype", "locale_provider"];

export function identityDigest(identity) {
  return hash(JSON.stringify(identityFields.map(key => [key, identity[key]])));
}

export function validateConfirmation(document, now = Date.now()) {
  requireSafe(document?.environment === "development" &&
    document.verifiedBy === "replit-development-read-only", "INDEPENDENT_DEVELOPMENT_PROOF_REQUIRED");
  const verified = Date.parse(document.verifiedAt);
  requireSafe(Number.isFinite(verified) && verified <= now && now - verified <= 30 * 60_000,
    "PROOF_EXPIRED_OR_INVALID");
  const c = document.connection, i = document.identity;
  requireSafe(c && Object.keys(c).sort().join(",") === "database,host,port,user",
    "EXPLICIT_CREDENTIAL_FREE_CONNECTION_REQUIRED");
  requireSafe(typeof c.host === "string" && path.isAbsolute(c.host) &&
    !c.host.includes("\0") && Number.isInteger(c.port) && c.port >= 1024 && c.port <= 65535 &&
    typeof c.database === "string" && typeof c.user === "string" &&
    /^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(c.database) &&
    /^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(c.user), "LOCAL_SOCKET_CONNECTION_REQUIRED");
  requireSafe(i && identityFields.every(key => Object.hasOwn(i, key)) &&
    identityFields.every(key => !["object", "undefined"].includes(typeof i[key]) || i[key] === null),
  "COMPLETE_IDENTITY_REQUIRED");
  requireSafe(i.server_address === null && i.in_recovery === false &&
    i.database === c.database && i.role === c.user && String(i.port) === String(c.port) &&
    /^\d+$/.test(i.system_identifier) && /^\d+$/.test(i.database_oid) &&
    typeof i.data_directory === "string" && path.isAbsolute(i.data_directory) &&
    Number(i.server_version_num) >= 160000 && Number(i.server_version_num) < 170000 &&
    i.encoding === "UTF8" && i.locale_provider === "c", "UNSUPPORTED_OR_AMBIGUOUS_SOURCE");
  requireSafe(![c.database, c.host, i.data_directory].some(value =>
    /(?:production|(?:^|[\/_-])prod(?:$|[\/_-]))/i.test(value)), "PRODUCTION_TARGET_REFUSED");
  requireSafe(!["postgres", "template0", "template1"].includes(c.database),
    "APPLICATION_DATABASE_REQUIRED");
  return document;
}

export function assertIdentity(expected, actual) {
  requireSafe(identityDigest(expected) === identityDigest(actual), "SOURCE_IDENTITY_MISMATCH");
}

export function refuseDeploymentEnvironment(env = process.env) {
  requireSafe(!Object.hasOwn(env, "REPLIT_DEPLOYMENT") &&
    !Object.hasOwn(env, "REPLIT_DEPLOYMENT_ID") &&
    env.NODE_ENV !== "production" && env.REPLIT_ENVIRONMENT !== "production",
  "PRODUCTION_EXECUTION_REFUSED");
}

export async function rejectSymlinks(filename) {
  const resolved = path.resolve(filename);
  for (let current = resolved;; current = path.dirname(current)) {
    try { requireSafe(!(await fs.lstat(current)).isSymbolicLink(), "SYMLINK_PATH_REFUSED"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (current === path.dirname(current)) break;
  }
  return resolved;
}

export async function readConfirmation(filename) {
  const resolved = await rejectSymlinks(filename);
  const stat = await fs.lstat(resolved);
  requireSafe(stat.isFile() && stat.uid === process.getuid?.() &&
    (stat.mode & 0o077) === 0 && stat.size < 32_768, "PRIVATE_CONFIRMATION_FILE_REQUIRED");
  let document;
  try { document = JSON.parse(await fs.readFile(resolved, "utf8")); }
  catch { throw new SafetyError("INVALID_CONFIRMATION_JSON"); }
  return validateConfirmation(document);
}

export async function assertSocket(connection) {
  await rejectSymlinks(connection.host);
  const socket = await fs.lstat(path.join(connection.host, `.s.PGSQL.${connection.port}`));
  requireSafe(socket.isSocket() && !socket.isSymbolicLink() &&
    socket.uid === process.getuid?.(), "SOURCE_SOCKET_NOT_OWNED");
}

export async function prepareBackupRoot(root, create = false) {
  requireSafe(typeof root === "string" && path.isAbsolute(root), "ABSOLUTE_BACKUP_ROOT_REQUIRED");
  const resolved = await rejectSymlinks(root);
  const inTree = resolved === workspaceRoot || resolved.startsWith(workspaceRoot + path.sep);
  const temporary = resolved === "/tmp" || resolved.startsWith("/tmp/") ||
    resolved === "/var/tmp" || resolved.startsWith("/var/tmp/");
  requireSafe(!inTree && !temporary, "BACKUP_MUST_BE_OUTSIDE_WORKSPACE_AND_TEMP");
  if (create) {
    // Parent must already exist. Never chmod or recursively alter another path.
    try { await fs.mkdir(resolved, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  try {
    const stat = await fs.lstat(resolved);
    requireSafe(stat.isDirectory() && stat.uid === process.getuid?.() &&
      (stat.mode & 0o077) === 0, "BACKUP_ROOT_MUST_BE_PRIVATE");
  } catch (error) { if (error.code !== "ENOENT" || create) throw error; }
  return resolved;
}

export function parseArguments(args) {
  const result = { mode: "dry-run" };
  const values = new Map([["--target-confirmation", "proofPath"], ["--confirm", "confirmation"],
    ["--backup-root", "backupRoot"]]);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    requireSafe(!seen.has(arg), "DUPLICATE_ARGUMENT");
    seen.add(arg);
    if (values.has(arg)) {
      requireSafe(args[i + 1] && !args[i + 1].startsWith("--"), "ARGUMENT_VALUE_REQUIRED");
      result[values.get(arg)] = args[++i];
    } else if (arg === "--run" || arg === "--dry-run" || arg === "--print-confirmation") {
      requireSafe(!result.explicitMode, "ONE_MODE_ONLY");
      result.mode = arg.slice(2); result.explicitMode = true;
    } else if (arg === "--confirm-source-quiesced") result.quiesced = true;
    else if (arg === "--help") result.mode = "help";
    else throw new SafetyError("UNKNOWN_ARGUMENT");
  }
  return result;
}
