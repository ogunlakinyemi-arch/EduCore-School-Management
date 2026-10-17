import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { randomInt } from "node:crypto";
import { requireSafe, SafetyError, quoteId, quoteLiteral } from "./safety.mjs";

const { Client } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
export const sessionOptions = "-c default_transaction_read_only=on -c row_security=off " +
  "-c timezone=UTC -c datestyle=ISO,YMD -c intervalstyle=postgres " +
  "-c extra_float_digits=3 -c statement_timeout=300000 -c lock_timeout=5000";

export function databaseClient(connection, readOnly = true) {
  // Every option is explicit. Never fall back to PG*, DATABASE_URL or a service.
  return new Client({ host: connection.host, port: connection.port,
    database: connection.database, user: connection.user, password: () => "",
    ssl: false, connectionTimeoutMillis: 5000,
    application_name: readOnly ? "educore-dev-backup-read-only" : "educore-disposable-restore",
    options: readOnly ? sessionOptions : "-c timezone=UTC -c datestyle=ISO,YMD -c intervalstyle=postgres -c extra_float_digits=3",
  });
}

export function cleanEnvironment(connection, readOnly = false) {
  const result = { PATH: process.env.PATH || "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
    PGSERVICEFILE: "/dev/null", PGPASSFILE: "/dev/null", PGCONNECT_TIMEOUT: "5" };
  if (connection) Object.assign(result, {
    PGHOST: connection.host, PGPORT: String(connection.port), PGUSER: connection.user,
    PGDATABASE: connection.database, PGSSLMODE: "disable",
  });
  if (readOnly) result.PGOPTIONS = sessionOptions;
  return result;
}

export function command(binary, args, { connection, readOnly = false, signal, timeout = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    // Never echo stderr: COPY/constraint errors can contain private row data.
    const child = spawn(binary, args, { env: cleanEnvironment(connection, readOnly),
      stdio: "ignore", signal, timeout, killSignal: "SIGTERM" });
    child.once("error", () => reject(new SafetyError(`TOOL_${binary.toUpperCase()}_UNAVAILABLE_OR_ABORTED`)));
    child.once("exit", (code, exitSignal) => code === 0 ? resolve() :
      reject(new SafetyError(`TOOL_${binary.toUpperCase()}_FAILED_${code ?? exitSignal ?? "UNKNOWN"}`)));
  });
}

export async function verifyToolchain() {
  // Only PostgreSQL 16 is accepted, matching the supported source identity.
  for (const binary of ["pg_dump", "pg_restore", "initdb", "pg_ctl", "postgres"]) {
    const version = await new Promise((resolve, reject) => {
      const child = spawn(binary, ["--version"], { env: cleanEnvironment(), stdio: ["ignore", "pipe", "ignore"] });
      let output = "";
      child.stdout.on("data", part => { if (output.length < 1000) output += part; });
      child.once("error", () => reject(new SafetyError("POSTGRESQL_16_TOOLS_REQUIRED")));
      child.once("exit", code => code === 0 ? resolve(output) :
        reject(new SafetyError("POSTGRESQL_16_TOOLS_REQUIRED")));
    });
    requireSafe(/\(PostgreSQL\) 16\./.test(version), "POSTGRESQL_16_TOOLS_REQUIRED");
  }
}

export async function createDisposable({ collate = "C", ctype = "C", signal } = {}) {
  requireSafe(process.getuid?.() !== 0, "DISPOSABLE_INITDB_CANNOT_RUN_AS_ROOT");
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "educore-dev-verify-"));
  await fs.chmod(base, 0o700);
  const data = path.join(base, "data"), socket = path.join(base, "socket");
  await fs.mkdir(socket, { mode: 0o700 });
  requireSafe(Buffer.byteLength(socket) < 90, "DISPOSABLE_SOCKET_PATH_TOO_LONG");
  const connection = { host: socket, port: randomInt(54000, 55000), user: "restore_admin", database: "postgres" };
  let started = false;
  const stop = async () => {
    // Only this freshly created cluster is ever stopped/removed.
    const stat = await fs.lstat(base);
    requireSafe(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() &&
      await fs.realpath(base) === base && path.basename(base).startsWith("educore-dev-verify-"),
    "DISPOSABLE_CLEANUP_IDENTITY_MISMATCH");
    if (started) {
      await command("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "30", "stop"], { timeout: 40_000 });
      started = false;
    }
    await fs.rm(base, { recursive: true });
  };
  try {
    await command("initdb", ["-D", data, "--username=restore_admin", "--encoding=UTF8",
      "--no-locale", "--auth-local=trust", "--auth-host=reject", "--data-checksums"], { signal });
    // File-based settings avoid shell parsing and pg_ctl -o argument injection.
    await fs.appendFile(path.join(data, "postgresql.conf"),
      `\nlisten_addresses = ''\nunix_socket_directories = ${quoteLiteral(socket)}\n` +
      `unix_socket_permissions = 0700\nport = ${connection.port}\n` +
      "logging_collector = off\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\n",
    { mode: 0o600 });
    // /dev/null is intentional: server errors may include sensitive COPY context.
    await command("pg_ctl", ["-D", data, "-l", "/dev/null", "-w", "-t", "30", "start"],
      { signal, timeout: 40_000 });
    started = true;
    const admin = databaseClient(connection, false);
    try {
      await admin.connect();
      const identity = (await admin.query(`SELECT current_setting('data_directory') AS directory,
        current_setting('listen_addresses') AS listeners,inet_server_addr() AS address,
        current_setting('port') AS port`)).rows[0];
      requireSafe(identity.directory === data && identity.listeners === "" &&
        identity.address === null && identity.port === String(connection.port),
      "DISPOSABLE_SERVER_IDENTITY_MISMATCH");
      // Restore archive SQL as a NON-superuser, with no file/program/network
      // privileges. BYPASSRLS is limited to this throwaway cluster.
      await admin.query("CREATE ROLE restore_check LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS");
      await admin.query(`CREATE DATABASE ${quoteId("verified_restore")} OWNER restore_check TEMPLATE template0
        ENCODING 'UTF8' LC_COLLATE ${quoteLiteral(collate)} LC_CTYPE ${quoteLiteral(ctype)}`);
    } finally { await admin.end(); }
    return { base, data, adminConnection: connection,
      connection: { ...connection, database: "verified_restore", user: "restore_check" }, stop };
  } catch (error) {
    // Startup may have succeeded before an interrupted pg_ctl reported failure.
    if (await fs.stat(path.join(data, "postmaster.pid")).then(() => true, () => false)) started = true;
    try { await stop(); } catch { throw new SafetyError("DISPOSABLE_START_OR_CLEANUP_FAILED"); }
    throw error;
  }
}
