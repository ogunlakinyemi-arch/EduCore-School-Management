import { describe, expect, it } from "vitest";
import { developmentWorkersPaused } from "./development-worker-policy";
import { readFileSync } from "node:fs";

describe("Development-only verification worker pause", () => {
  it.each([
    [{ NODE_ENV: "development", EDUCORE_DEVELOPMENT_WORKERS_PAUSED: "true" }, true],
    [{ NODE_ENV: "development" }, false],
    [{ NODE_ENV: "development", EDUCORE_DEVELOPMENT_WORKERS_PAUSED: "false" }, false],
    [{ NODE_ENV: "production", EDUCORE_DEVELOPMENT_WORKERS_PAUSED: "true" }, false],
    [{ NODE_ENV: "development", REPLIT_DEPLOYMENT: "1", EDUCORE_DEVELOPMENT_WORKERS_PAUSED: "true" }, false],
  ])("scopes the verification pause correctly for %j", (env, expected) => {
    expect(developmentWorkersPaused(env)).toBe(expected);
  });
  it("puts the existing pause before Telegram, Owner, and unrelated startup workers", () => {
    const source=readFileSync(new URL("../normal-server.ts",import.meta.url),"utf8");
    const pause=source.indexOf("if (developmentWorkersPaused())");
    expect(pause).toBeGreaterThan(0);
    const firstWorker=source.indexOf("startTelegramWorker();");
    expect(source.slice(pause,firstWorker)).toContain("return;");
    for(const call of ["startOwnerNotificationWorker(pool);","void verifyRemovalRuntimeTarget()","void dispatch();"]){
      expect(source.indexOf(call)).toBeGreaterThan(firstWorker);
    }
  });
});
