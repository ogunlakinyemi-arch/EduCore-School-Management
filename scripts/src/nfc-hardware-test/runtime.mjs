import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { root, buildTerminalOnly } from "./build.mjs";

const execute = promisify(execFile);
const port = Number(process.env.PORT);
if (process.env.REPLIT_DEPLOYMENT !== undefined || port !== 8099) {
  throw new Error("Hardware test requires its dedicated Development workflow on port 8099");
}
const work = await fs.mkdtemp("/tmp/educore-nfc-hardware-");
await fs.chmod(work, 0o700);
const target = `nfc_hw_${Date.now()}_${randomBytes(2).toString("hex")}`;
const host = `/tmp/educore-terminal-test-${target}`;
const database = `educore_terminal_test_${target}`;
const data = path.join(work, "pgdata");
const dbPort = 55439;
// Do not spread process.env: neither real credentials nor database URLs are read.
const cleanEnv = { PATH: process.env.PATH ?? "", HOME: work, LANG: "C.UTF-8" };
const children = [];
const handles = [];
let stopping = false;
const ensureRunning = () => { if (stopping) throw new Error("Hardware test startup cancelled"); };
async function run(command, args, input) {
  ensureRunning();
  const child = spawn(command, args, { cwd: root, env: cleanEnv, stdio: ["pipe", "pipe", "pipe"] });
  children.push(child);
  let stdout = "", stderr = "";
  child.stdout.on("data", b => { stdout += b; });
  child.stderr.on("data", b => { stderr += b; });
  child.stdin.end(input);
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed: ${stderr.slice(-1500)}`)));
  });
  ensureRunning();
  return stdout;
}
async function start(command, args, file, env = cleanEnv) {
  ensureRunning();
  const log = await fs.open(path.join(work, file), "w", 0o600);
  handles.push(log);
  const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", log.fd, log.fd] });
  children.push(child);
  child.on("error", () => {});
  return child;
}
const psqlArgs = (db, user) => ["-X", "-v", "ON_ERROR_STOP=1", "-h", host, "-p", String(dbPort), "-U", user, "-d", db];
const sql = (query, db = database, user = "educore_terminal_test") =>
  run("psql", [...psqlArgs(db, user), "-At"], query);
async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) continue;
    child.kill("SIGTERM");
    await new Promise(resolve => {
      child.once("exit", resolve);
      setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3000).unref();
    });
  }
  for (const handle of handles) await handle.close().catch(() => {});
  console.log("Synthetic NFC test processes stopped; no normal preview process was signalled.");
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });

try {
  // Explicit binaries, private cluster and no TCP listener; no existing server is contacted.
  await execute("initdb", ["--version"], { env: cleanEnv });
  await execute("postgres", ["--version"], { env: cleanEnv });
  await execute("psql", ["--version"], { env: cleanEnv });
  await fs.mkdir(host, { mode: 0o700 });
  await run("initdb", ["-D", data, "-U", "educore_terminal_bootstrap", "--auth-local=trust", "--auth-host=reject", "--no-locale"]);
  const postgres = await start("postgres", ["-D", data, "-k", host, "-p", String(dbPort),
    "-c", "listen_addresses=", "-c", "unix_socket_permissions=0700"], "postgres.log");
  for (let i = 0; ; i++) {
    ensureRunning();
    if (postgres.exitCode !== null || i >= 100) throw new Error("Private PostgreSQL did not start");
    try { await fs.lstat(`${host}/.s.PGSQL.${dbPort}`); break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const identity = JSON.parse((await sql(`SELECT json_build_object('data',current_setting('data_directory'),'tcp',current_setting('listen_addresses'),'socket',inet_server_addr() IS NULL);`, "postgres", "educore_terminal_bootstrap")).trim());
  if (identity.data !== data || identity.tcp !== "" || identity.socket !== true) throw new Error("Disposable cluster identity mismatch");
  await sql(`CREATE ROLE educore_terminal_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE ${database} OWNER educore_terminal_test;`, "postgres", "educore_terminal_bootstrap");
  const schema = path.join(work, "schema.sql");
  await run(process.execPath, [path.join(root, "scripts/node_modules/tsx/dist/cli.mjs"),
    path.join(root, "scripts/src/export-dependency-aware-schema.mjs"), "--out", schema]);
  await run("psql", [...psqlArgs(database, "educore_terminal_test"), "-f", schema]);
  const migration = await fs.readFile(path.join(root, "lib/db/drizzle/0009_phase5_attendance.sql"), "utf8");
  const index = migration.split("\n").find(line => line.startsWith('CREATE UNIQUE INDEX "attendance_discrepancies_event_kind_unique"'));
  if (!index || !index.endsWith(";")) throw new Error("Required retained migration index missing");
  await sql(index);
  const credentials = [1, 2].map(deviceId => ({
    device_id: deviceId, school_id: 1,
    direction: deviceId === 1 ? "ENTRY" : "EXIT",
    credential: `${deviceId === 1 ? "synthetic_hw_entry" : "synthetic_hw_exit"}.${randomBytes(32).toString("hex")}`,
  }));
  let fixtures = await fs.readFile(path.join(root, "scripts/src/nfc-hardware-test/fixtures.sql"), "utf8");
  for (const item of credentials) {
    const hash = createHash("sha256").update(item.credential.split(".")[1]).digest("hex");
    fixtures = fixtures.replace(`{{${item.direction}_HASH}}`, hash);
  }
  await sql(fixtures);
  const role = JSON.parse((await sql("SELECT json_build_object('database',current_database(),'role',current_user,'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'socket',inet_server_addr() IS NULL);")).trim());
  if (role.database !== database || role.role !== "educore_terminal_test" || role.superuser !== false || role.socket !== true) throw new Error("Disposable role/database check failed");
  const bundle = await buildTerminalOnly(target, run);
  const credentialFile = path.join(work, "terminal-setup.json");
  await fs.writeFile(credentialFile, JSON.stringify({
    synthetic_only: true, endpoint_path: "/nfc-test/api/v1/terminal/events",
    terminal_name: "MAIN GATE", firmware: "1.0.0", test_card_uid: "A1B2C3D4",
    authorization: "Use the selected complete credential as Authorization: Bearer <credential>",
    terminals: credentials,
  }, null, 2), { mode: 0o600, flag: "wx" });
  const appEnv = { ...cleanEnv, NODE_ENV: "development", LOG_LEVEL: "info",
    NODE_OPTIONS: `--require=${path.join(root, "scripts/src/nfc-hardware-test/network-guard.cjs")}`,
    EDUCORE_TERMINAL_TEST_MODE: "isolated", EDUCORE_DEVELOPMENT_WORKERS_PAUSED: "true",
    EDUCORE_TERMINAL_TEST_CONFIRM: "DISPOSABLE_LOCAL_ONLY", EDUCORE_TERMINAL_TEST_TARGET: target,
    EDUCORE_TERMINAL_TEST_DB_HOST: host, EDUCORE_TERMINAL_TEST_DB_NAME: database,
    EDUCORE_TERMINAL_TEST_DB_USER: "educore_terminal_test", EDUCORE_TERMINAL_TEST_DB_PORT: String(dbPort),
    EDUCORE_TERMINAL_TEST_HTTP_PORT: String(port), EDUCORE_TERMINAL_TEST_API_BASE_PATH: "/nfc-test/api",
  };
  const app = await start(process.execPath, [bundle], "app.log", appEnv);
  const state = { mode: "synthetic-hardware-test-only", target, database, role: "educore_terminal_test",
    socket: host, data, work, httpPort: port, apiBasePath: "/nfc-test/api", credentialFile,
    appPid: app.pid, postgresPid: postgres.pid, workers: "disabled",
    sharedCredentialsInherited: false, clusterIdentityVerified: true, roleIdentityVerified: true };
  await fs.writeFile(path.join(work, "status.json"), JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(state)); // Paths and synthetic IDs only; never credential values.
  await new Promise((_, reject) => {
    app.once("exit", code => reject(new Error(`Synthetic terminal app exited (${code})`)));
    postgres.once("exit", code => reject(new Error(`Disposable PostgreSQL exited (${code})`)));
  });
} catch (error) {
  if (!stopping) { console.error(error.message); process.exitCode = 1; }
} finally {
  await shutdown();
}
