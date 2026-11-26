// Disposable-only CLI. No host/URL/database arguments or application fallback.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadContract, requireCleanEnvironment, structuralOrder, hashes } from "./contract.mjs";

requireCleanEnvironment(process.env);
assert.equal(process.argv.length, 3, "Use exactly --static or --rehearse; connection arguments are forbidden");
const mode = process.argv[2];
assert.ok(["--static", "--rehearse", "--isolated-child"].includes(mode), "Unsupported mode");
if (mode === "--static") {
  const c = loadContract();
  console.log(JSON.stringify({ staticPassed: true, structuralOrder, hashes, targetTables: c.tables.size,
    currentTriggers: c.current.triggers.length, sqlExecuted: false }));
} else if (mode === "--rehearse") {
  // Fail before importing the SQL runner, initdb, pg_ctl or opening any database.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8", NODE_ENV: "test" };
  try {
    execFileSync("unshare", ["--net", "--fork", process.execPath, "-e", "process.exit(0)"],
      { env, stdio: "pipe", timeout: 10000 });
  } catch {
    console.error("BLOCKED: network isolation unavailable. No cluster was created and no SQL executed.");
    process.exitCode = 2;
  }
  if (!process.exitCode) {
    const child = spawnSync("unshare", ["--net", "--fork", process.execPath, fileURLToPath(import.meta.url), "--isolated-child"], {
      env, input: JSON.stringify({ parentNamespace: readlinkSync("/proc/self/ns/net") }),
      encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024,
    });
    if (child.stdout) process.stdout.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);
    assert.ifError(child.error);
    assert.equal(child.status, 0, "Real PostgreSQL rehearsal failed; do not approve installation");
  }
} else {
  const parent = JSON.parse(readFileSync(0, "utf8"));
  const { runPrivateRehearsal } = await import("./runner.mjs");
  await runPrivateRehearsal(parent.parentNamespace);
}
