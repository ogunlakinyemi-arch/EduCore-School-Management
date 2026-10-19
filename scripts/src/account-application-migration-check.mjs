// Read-only Development schema capture; all rehearsal writes go to /tmp.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve(import.meta.dirname, "../..");
const temp = mkdtempSync(join(tmpdir(), "educore-application-check-"));
const socket = join(temp, "socket");
mkdirSync(socket);
const run = (command, args, options = {}) => {
  const r = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...options });
  if (r.status !== 0) throw new Error(`${command} failed: ${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
try {
  if (!process.env.DATABASE_URL) throw new Error("Development connection is required for read-only schema capture");
  const schema = run("pg_dump", ["--dbname", process.env.DATABASE_URL, "--schema-only", "--no-owner", "--no-privileges",
    "--exclude-table=public.account_applications"]);
  writeFileSync(join(temp, "schema.sql"), schema);
  run("initdb", ["-D", join(temp, "data"), "-A", "trust", "--no-locale", "-U", "postgres"]);
  run("pg_ctl", ["-D", join(temp, "data"), "-l", join(temp, "server.log"), "-o", `-k ${socket} -p 55482 -c listen_addresses=''`, "-w", "start"]);
  const psql = ["-h", socket, "-p", "55482", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
  run("psql", [...psql, "-f", join(temp, "schema.sql")]);
  run("psql", psql, { input: readFileSync(join(root,"lib/db/drizzle/0169_account_applications.sql"), "utf8") });
  // Reapply is intentionally rejected: an unexpected existing table must not be silently adopted.
  const duplicate = spawnSync("psql", psql, {
    encoding:"utf8", input: readFileSync(join(root,"lib/db/drizzle/0169_account_applications.sql"), "utf8"),
  });
  if (duplicate.status === 0) throw new Error("Duplicate migration unexpectedly succeeded");
  const result = run("pnpm", ["--filter","@workspace/api-server","exec","vitest","run",
    "src/routes/account-applications.postgres.test.ts","--reporter=dot"], {
    env: { ...process.env, APPLICATION_TEST_SOCKET: socket, APPLICATION_TEST_PORT: "55482" },
  });
  process.stdout.write(result);
  process.stdout.write("Migration replay on complete Development schema and duplicate-apply rejection passed.\n");
} finally {
  spawnSync("pg_ctl", ["-D", join(temp,"data"), "-m","immediate","-w","stop"], {stdio:"ignore"});
  rmSync(temp, {recursive:true,force:true});
}
