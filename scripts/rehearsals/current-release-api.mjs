// Full current Express app, real SQL against the caller's disposable database.
// Only the Clerk identity provider and DB connection factory are test seams.
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { cleanEnvironment } from "../src/dev-backup/processes.mjs";

export async function runCurrentReleaseApi(client, cluster) {
  const root = process.cwd(), api = path.join(root, "artifacts/api-server");
  const cache = path.join(api, "node_modules/.cache/release-compatibility");
  await fs.mkdir(cache, { recursive: true, mode: 0o700 });
  const put = (name, content) => fs.writeFile(path.join(cache, name), content, { mode: 0o600 });
  if (process.env.DATABASE_URL || process.env.CLERK_SECRET_KEY) throw new Error("Credential-free test environment required");
  await client.query(`INSERT INTO school_memberships(user_id,school_id,role,status)
    VALUES(1,1,'SCHOOL_ADMIN','ACTIVE')`);
  await put("db-adapter.ts", `
    import pg from ${JSON.stringify(createRequire(path.join(root, "lib/db/package.json")).resolve("pg"))};
    import { drizzle } from "drizzle-orm/node-postgres";
    import * as schema from ${JSON.stringify(path.join(root, "lib/db/src/schema/index.ts"))};
    let target: any;
    export function configureDatabase(client: any) { target=client; }
    function query(...args: any[]) { if(!target) throw new Error("No isolated client configured"); return target.query(...args); }
    export const pool={query,connect:async()=>({query,release(){}}),end:async()=>{}};
    export const db=drizzle(pool as any,{schema});
    export * from ${JSON.stringify(path.join(root, "lib/db/src/schema/index.ts"))};
    export const DatabaseClient=pg.Client, DatabasePool=pg.Pool;
  `);
  await put("clerk-fixture.ts", `
    export function getAuth(req: any) {return {userId:req.headers["x-release-user"]==="qa_release_local"?"qa_release_local":null};}
    export function clerkMiddleware(){return (_req:any,_res:any,next:any)=>next();}
    export const clerkClient=new Proxy({}, {get(){throw new Error("Real identity-provider operations are forbidden");}});
  `);
  await put("entry.ts", `
    export { default as app } from ${JSON.stringify(path.join(api, "src/app.ts"))};
    export { configureDatabase } from ${JSON.stringify(path.join(cache, "db-adapter.ts"))};
  `);
  let build = await fs.readFile(path.join(api, "build.mjs"), "utf8");
  const substitutions = [
    ["const artifactDir = path.dirname(fileURLToPath(import.meta.url));", `const artifactDir = ${JSON.stringify(api)};`],
    ['path.resolve(artifactDir, "dist")', JSON.stringify(path.join(cache, "bundle"))],
    [`entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/terminal-test-entry.ts"),
    ],`, `entryPoints: [${JSON.stringify(path.join(cache, "entry.ts"))}],`],
    ["bundle: true,", `bundle: true, alias: {
      "@workspace/db":${JSON.stringify(path.join(cache, "db-adapter.ts"))},
      "@clerk/express":${JSON.stringify(path.join(cache, "clerk-fixture.ts"))}
    },`],
  ];
  for (const [from, to] of substitutions) {
    if (build.split(from).length !== 2) throw new Error("Standard bundler changed; refusing substitution");
    build = build.replace(from, to);
  }
  await put("build-isolated.mjs", build);
  const built = spawnSync(process.execPath, [path.join(cache, "build-isolated.mjs")],
    { env: { ...cleanEnvironment(), NODE_ENV: "test" }, encoding: "utf8", timeout: 120000 });
  await put("build.log", (built.stdout || "") + (built.stderr || ""));
  if (built.status !== 0) throw new Error("ISOLATED_API_BUILD_FAILED: see private cache build.log");

  const connect = net.Socket.prototype.connect, originalFetch = globalThis.fetch;
  const originalHttp = { request: http.request, get: http.get, httpsRequest: https.request, httpsGet: https.get };
  let port = null, server, sqlErrors = [];
  const socket = `${cluster.connection.host}/.s.PGSQL.${cluster.connection.port}`;
  net.Socket.prototype.connect = function (...args) {
    let opts = args[0]; if (Array.isArray(opts)) opts = opts[0];
    const socketPath = typeof opts === "string" ? opts : opts?.path;
    const localHttp = opts && Number(opts.port) === port && ["127.0.0.1", "localhost"].includes(opts.host);
    if (socketPath !== socket && !localHttp) throw new Error("External network blocked in release API test");
    return connect.apply(this, args);
  };
  http.request = http.get = https.request = https.get = () => { throw new Error("External HTTP blocked"); };
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" || Number(parsed.port) !== port) throw new Error("External fetch blocked");
    return originalFetch(url, options);
  };
  const tests = [];
  try {
    const { app, configureDatabase } = await import(pathToFileURL(path.join(cache, "bundle/entry.mjs")).href);
    configureDatabase({
      query: (...args) => Promise.resolve(client.query(...args)).catch(error => {
        sqlErrors.push({ code: error.code, message: error.message }); throw error;
      }),
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    port = server.address().port;
    const cases = [
      ["School dashboard", "/api/dashboard/school?schoolId=1", 200, true],
      ["School profile", "/api/schools/1", 200, true],
      ["Student roster", "/api/students?schoolId=1", 200, true],
      ["Academic sessions", "/api/academic-sessions?schoolId=1", 200, true],
      ["Academic results", "/api/academic/results?schoolId=1", 200, true],
      ["Finance settings", "/api/school/finance/settings?schoolId=1", 200, true],
      ["Finance invoices", "/api/school/finance/invoices?schoolId=1", 200, true],
      ["Reject cross-school academics", "/api/academic-sessions?schoolId=2", 404, true],
      ["Reject unauthenticated academics", "/api/academic-sessions?schoolId=1", 401, false],
    ];
    for (const [name, route, expected, authenticated] of cases) {
      const errorsBefore = sqlErrors.length;
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        headers: authenticated ? { "x-release-user": "qa_release_local" } : {},
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json();
      tests.push({ name, route, expectedStatus: expected, actualStatus: response.status,
        status: response.status === expected ? "PASS" : "FAIL",
        ...(response.status === expected ? {} : { error: body.error || "Unexpected response" }),
        sqlErrors: sqlErrors.slice(errorsBefore) });
      console.log(tests.at(-1).status, "API", name, response.status);
    }
    return { tests, build: "PASS", authentication: "Fixture identity only; real DB-backed membership and authorization",
      externalNetwork: "blocked", sqlErrors, scope: "Current full Express app; no workers, no real SSO/provider calls" };
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    net.Socket.prototype.connect = connect;
    globalThis.fetch = originalFetch;
    http.request = originalHttp.request; http.get = originalHttp.get;
    https.request = originalHttp.httpsRequest; https.get = originalHttp.httpsGet;
  }
}
