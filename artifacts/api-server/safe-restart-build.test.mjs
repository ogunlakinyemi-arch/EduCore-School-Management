import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildAll } from "./build.mjs";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

let output;
afterAll(async () => { if (output) await rm(output, { recursive: true, force: true }); });
describe("compiled Safe Restart import boundary", () => {
  it("builds to a disposable directory and keeps routes, SDKs, workers and logger out of the launcher", async () => {
    output = await mkdtemp(path.join(tmpdir(), "educore-safe-restart-build-"));
    const result = await buildAll(output);
    const [name, launcher] = Object.entries(result.metafile.outputs).find(([name]) =>
      path.resolve(name) === path.join(output, "index.mjs"));
    const inputs = Object.keys(launcher.inputs);
    expect(inputs.some(file => file.endsWith("safe-restart-server.ts"))).toBe(true);
    expect(inputs.some(file => file.endsWith("safe-restart-io.ts"))).toBe(true);
    expect(inputs.some(file => /\/(routes|services)\//.test(file))).toBe(false);
    expect(inputs.some(file => /node_modules|\/lib\/logger.ts|\/db\/src\/index.ts/.test(file))).toBe(false);
    expect(launcher.imports.filter(item => item.kind !== "dynamic-import").every(item =>
      item.path.startsWith("node:"))).toBe(true);
    for (const file of ["normal-server", "terminal-test-server", "logger"]) {
      expect(launcher.imports).toContainEqual(expect.objectContaining({
        path: `./${file}.mjs`, kind: "dynamic-import", external: true,
      }));
      expect((await readFile(path.join(output, `${file}.mjs`), "utf8")).length).toBeGreaterThan(0);
    }
    expect(await readFile(path.resolve(name), "utf8")).toContain("--development-safe-restart");
    // Exercise the real compiled launcher and real built-in guard installer in
    // a disposable child. Fake EVERY original I/O boundary first: even a broken
    // guard cannot contact a network or start a child/worker in this fixture.
    const guardFile = path.join(output, "guard-fixture.mjs");
    await build({
      entryPoints: [fileURLToPath(new URL("./src/lib/safe-restart-io.ts", import.meta.url))],
      outfile: guardFile, bundle: true, platform: "node", format: "esm",
    });
    const script = `
      import assert from "node:assert/strict";
      import {createRequire,syncBuiltinESMExports} from "node:module";
      const {safeRestartIoBoundaries}=await import(${JSON.stringify(pathToFileURL(guardFile).href)});
      const boundaries=safeRestartIoBoundaries();
      let originalCalls=0, timerCalls=0, listens=0, handler;
      for(const b of boundaries){
        const descriptor=Object.getOwnPropertyDescriptor(b.target,b.key);
        assert.equal(typeof descriptor?.value,"function",b.name);
        assert.equal(descriptor.writable,true,b.name);
        Object.defineProperty(b.target,b.key,{
          ...descriptor,value:function(){originalCalls++;throw Error("FAKE ORIGINAL TRANSPORT");}});
      }
      globalThis.setTimeout=function(){timerCalls++;throw Error("UNEXPECTED APPLICATION TIMEOUT");};
      const require=createRequire(import.meta.url);
      require("node:http").createServer=function(h){
        handler=h;return {on(){},once(){},listen(_port,ready){listens++;ready();}};
      };
      syncBuiltinESMExports();
      process.argv=["node","fixture","--development-safe-restart"];
      await import(${JSON.stringify(pathToFileURL(path.resolve(name)).href)});
      assert.equal(process.exitCode,undefined);
      assert.equal(listens,1);
      function status(){
        let result;const res={statusCode:0,setHeader(){},end(body){result=JSON.parse(body);}};
        handler({method:"GET",url:"/api/safe-restart/status"},res);
        assert.equal(res.statusCode,200);return result;
      }
      assert.equal(status().io.rejectedAttempts,0);
      assert.equal(originalCalls,0);assert.equal(timerCalls,0);
      for(const b of boundaries){
        if(b.asynchronous)await assert.rejects(b.target[b.key](),{code:"DEVELOPMENT_SAFE_RESTART_IO_BLOCKED"});
        else assert.throws(()=>b.target[b.key](),{code:"DEVELOPMENT_SAFE_RESTART_IO_BLOCKED"});
      }
      assert.equal(originalCalls,0);
      assert.equal(status().io.rejectedAttempts,boundaries.length);
      process.stdout.write(JSON.stringify({boundaries:boundaries.length,originalCalls,timerCalls,listens}));
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { NODE_ENV: "development", PORT: "8080" }, encoding: "utf8", timeout: 15000,
    });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    const checked = JSON.parse(child.stdout);
    expect(checked.boundaries).toBeGreaterThan(50);
    expect(checked).toMatchObject({ originalCalls: 0, timerCalls: 0, listens: 1 });
    process.stdout.write(`Safe Restart compiled fixture: ${checked.boundaries} I/O boundaries rejected; zero original transports/timeouts; fake listener only.\\n`);
  }, 90000);
});
