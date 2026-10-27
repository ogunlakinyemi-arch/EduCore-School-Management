// Disposable SQL evidence only. No app connection or credentials are accepted.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.argv.length, 2);
assert.equal(process.env.NODE_ENV, "test");
assert.deepEqual(Object.keys(process.env).filter(k =>
  /^(?:PG|DATABASE|FLUTTERWAVE|EDUCORE_|REPLIT_)|SECRET|TOKEN|PASSWORD|API_KEY/.test(k)), []);
const root = fileURLToPath(new URL("../../", import.meta.url));
const api = join(root, "artifacts/api-server");
const require = createRequire(join(api, "package.json"));
const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const scratch = mkdtempSync("/tmp/educore-staff-access-");
const data = join(scratch, "data"), socket = join(scratch, "socket"), home = join(scratch, "home");
mkdirSync(socket, {mode: 0o700}); mkdirSync(home, {mode: 0o700});
const port = "56440", role = "staff_access_qa";
const env = {PATH: process.env.PATH, HOME: home, LANG: "C.UTF-8", NODE_ENV: "test",
  EDUCORE_STAFF_ACCESS_ROOT: scratch, EDUCORE_STAFF_ACCESS_PORT: port};
const run = (cmd, args) => execFileSync(cmd, args, {env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
let started = false;
try {
  run("initdb", ["-D", data, "-A", "trust", "-U", role, "--no-locale", "--encoding=UTF8", "--no-sync"]);
  run("pg_ctl", ["-D", data, "-l", join(scratch, "server.log"), "-o", `-k ${socket} -h '' -p ${port}`, "-w", "-t", "30", "start"]);
  started = true;
  const pid = readFileSync(join(data, "postmaster.pid"), "utf8").trim().split("\n");
  assert.equal(realpathSync(pid[1]), realpathSync(data)); assert.equal(pid[3], port); assert.equal(pid[4], socket);
  const argv = readFileSync(`/proc/${pid[0]}/cmdline`, "utf8").split("\0");
  assert.equal(argv[argv.indexOf("-D") + 1], data); assert.equal(argv[argv.indexOf("-h") + 1], "");
  assert.equal(argv[argv.indexOf("-k") + 1], socket);
  assert.equal(readFileSync(`/proc/${pid[0]}/comm`, "utf8").trim(), "postgres");
  assert.equal(statSync(join(socket, `.s.PGSQL.${port}`)).isSocket(), true);
  assert.equal(statSync(data).uid, process.getuid());
  console.log("Verified private disposable staff-access PostgreSQL process; TCP disabled; no app configuration inherited.");
  execFileSync(process.execPath, [vitest, "run", "--config", "vitest.staff-access.config.ts"],
    {cwd: api, env, stdio: "inherit", timeout: 90000});
} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  rmSync(scratch, {recursive: true, force: true});
}
