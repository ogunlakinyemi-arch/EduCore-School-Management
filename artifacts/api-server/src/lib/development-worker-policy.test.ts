import { describe, expect, it } from "vitest";
import { developmentWorkersPaused } from "./development-worker-policy";

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
});
