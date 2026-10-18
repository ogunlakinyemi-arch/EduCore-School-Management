import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapApi } from "./api-bootstrap";
import { terminalTestTarget, terminalTestPoolOptions, verifyTerminalTestSocket } from "@workspace/db/terminal-test-target";

const fs = vi.hoisted(() => ({
  directory: { uid: 0, mode: 0o40700, isDirectory: () => true, isSymbolicLink: (): boolean => false },
  socket: { uid: 0, isSocket: (): boolean => true, isSymbolicLink: (): boolean => false },
  realpath: "/tmp/educore-terminal-test-nfc_qa",
  stat: vi.fn(),
}));
vi.mock("node:fs", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs")>(),
  lstatSync: (...args: any[]) => fs.stat(...args),
  realpathSync: () => fs.realpath,
}));

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    EDUCORE_TERMINAL_TEST_MODE: "isolated",
    EDUCORE_DEVELOPMENT_WORKERS_PAUSED: "true",
    EDUCORE_TERMINAL_TEST_CONFIRM: "DISPOSABLE_LOCAL_ONLY",
    EDUCORE_TERMINAL_TEST_TARGET: "nfc_qa",
    EDUCORE_TERMINAL_TEST_DB_HOST: "/tmp/educore-terminal-test-nfc_qa",
    EDUCORE_TERMINAL_TEST_DB_NAME: "educore_terminal_test_nfc_qa",
    EDUCORE_TERMINAL_TEST_DB_USER: "educore_terminal_test",
    EDUCORE_TERMINAL_TEST_DB_PORT: "55439",
    EDUCORE_TERMINAL_TEST_HTTP_PORT: "18081",
  };
}
const loaders = () => ({ normal: vi.fn(async () => {}), terminal: vi.fn(async () => {}), checked: vi.fn(async () => {}) });

beforeEach(() => {
  fs.directory = { uid: process.getuid!(), mode: 0o40700, isDirectory: () => true, isSymbolicLink: () => false };
  fs.socket = { uid: process.getuid!(), isSocket: () => true, isSymbolicLink: () => false };
  fs.realpath = "/tmp/educore-terminal-test-nfc_qa";
  fs.stat.mockReset();
  fs.stat.mockImplementation((path: string) => path.endsWith(".s.PGSQL.55439") ? fs.socket : fs.directory);
});

describe("explicit isolated terminal target, no database or secret access", () => {
  it("accepts the named private local target and explicit ports", () => {
    expect(terminalTestTarget(environment())).toMatchObject({
      name: "nfc_qa", host: "/tmp/educore-terminal-test-nfc_qa",
      database: "educore_terminal_test_nfc_qa", user: "educore_terminal_test",
      port: 55439, httpPort: 18081,
    });
  });
  it("permits the separate hardware-test prefix but never arbitrary app routes", () => {
    expect(terminalTestTarget({ ...environment(), EDUCORE_TERMINAL_TEST_API_BASE_PATH: "/nfc-test/api" }).apiBasePath).toBe("/nfc-test/api");
    expect(() => terminalTestTarget({ ...environment(), EDUCORE_TERMINAL_TEST_API_BASE_PATH: "/" })).toThrow();
    expect(terminalTestTarget(environment()).apiBasePath).toBe("/api");
  });
  it.each([
    ["EDUCORE_TERMINAL_TEST_MODE", undefined], ["EDUCORE_TERMINAL_TEST_MODE", "true"],
    ["NODE_ENV", "production"], ["REPLIT_DEPLOYMENT", "1"], ["REPLIT_DEPLOYMENT", ""],
    ["EDUCORE_DEVELOPMENT_WORKERS_PAUSED", undefined], ["EDUCORE_DEVELOPMENT_WORKERS_PAUSED", "false"],
    ["EDUCORE_TERMINAL_TEST_CONFIRM", undefined], ["EDUCORE_TERMINAL_TEST_TARGET", undefined],
    ["EDUCORE_TERMINAL_TEST_TARGET", "../other"], ["EDUCORE_TERMINAL_TEST_DB_HOST", "127.0.0.1"],
    ["EDUCORE_TERMINAL_TEST_DB_HOST", "production.invalid"],
    ["EDUCORE_TERMINAL_TEST_DB_NAME", "production"], ["EDUCORE_TERMINAL_TEST_DB_USER", "postgres"],
    ["EDUCORE_TERMINAL_TEST_DB_PORT", undefined], ["EDUCORE_TERMINAL_TEST_DB_PORT", "5432?host=other"],
    ["EDUCORE_TERMINAL_TEST_HTTP_PORT", "8080"], ["EDUCORE_TERMINAL_TEST_HTTP_PORT", "55439"],
    ["EDUCORE_TERMINAL_TEST_HTTP_PORT", "80"], ["EDUCORE_TERMINAL_TEST_HTTP_PORT", "99999"],
  ])("refuses unsafe/missing configuration %s=%s", (key, value) => {
    expect(() => terminalTestTarget({ ...environment(), [key]: value })).toThrow();
  });
  it("never reads inherited database URLs, PG credentials or other secret values", () => {
    const env = new Proxy(environment(), { get(target, key: string) {
      if (/DATABASE_URL|^PG|SECRET|TOKEN|PASSWORD|API_KEY/.test(key)) throw new Error("Secret access forbidden");
      return target[key];
    } });
    const options = terminalTestPoolOptions(terminalTestTarget(env));
    expect("connectionString" in options).toBe(false);
    expect(options.password()).toBe("");
    expect(options.ssl).toBe(false);
  });
  it("verifies socket ownership and private canonical path using filesystem metadata only", () => {
    verifyTerminalTestSocket(terminalTestTarget(environment()));
    expect(fs.stat).toHaveBeenCalledTimes(2);
  });
  it.each(["public-directory", "directory-symlink", "wrong-owner", "socket-symlink", "not-socket", "wrong-realpath", "missing-socket"])(
    "rejects filesystem condition %s", condition => {
      if (condition === "public-directory") fs.directory.mode = 0o40755;
      if (condition === "directory-symlink") fs.directory.isSymbolicLink = () => true;
      if (condition === "wrong-owner") fs.socket.uid += 1;
      if (condition === "socket-symlink") fs.socket.isSymbolicLink = () => true;
      if (condition === "not-socket") fs.socket.isSocket = () => false;
      if (condition === "wrong-realpath") fs.realpath = "/tmp/other";
      if (condition === "missing-socket") fs.stat.mockImplementation(() => { throw new Error("missing"); });
      expect(() => verifyTerminalTestSocket(terminalTestTarget(environment()))).toThrow();
    });
});

describe("startup import boundary: no normal app, workers, probes or SQL in test mode", () => {
  it("leaves ordinary startup selection unchanged when test mode is not requested", async () => {
    const load = loaders();
    await bootstrapApi({}, [], load);
    expect(load.normal).toHaveBeenCalledOnce();
    expect(load.terminal).not.toHaveBeenCalled();
  });
  it("loads only the terminal entry after verification", async () => {
    const load = loaders(); const verify = vi.fn();
    await bootstrapApi(environment(), ["--terminal-test"], load, verify);
    expect(verify).toHaveBeenCalledOnce();
    expect(load.terminal).toHaveBeenCalledOnce();
    expect(load.normal).not.toHaveBeenCalled();
    expect(load.checked).not.toHaveBeenCalled();
  });
  it("configuration-check mode loads neither application nor database/worker entry", async () => {
    const load = loaders();
    await bootstrapApi(environment(), ["--terminal-test-check"], load);
    expect(load.checked).toHaveBeenCalledOnce();
    expect(load.normal).not.toHaveBeenCalled();
    expect(load.terminal).not.toHaveBeenCalled();
  });
  it.each([{ args: ["--terminal-test"] }, { args: ["--terminal-test-check"] }, { args: [] }])("never falls back after failed opt-in gate %j", async ({ args }) => {
    const load = loaders();
    await expect(bootstrapApi({ EDUCORE_TERMINAL_TEST_MODE: "typo" }, args, load)).rejects.toThrow();
    expect(load.normal).not.toHaveBeenCalled(); expect(load.terminal).not.toHaveBeenCalled();
  });
  it("explicit test command without configured mode fails before application imports", async () => {
    const load = loaders();
    await expect(bootstrapApi({}, ["--terminal-test"], load)).rejects.toThrow();
    expect(load.normal).not.toHaveBeenCalled(); expect(load.terminal).not.toHaveBeenCalled();
  });
  it("does not load anything when the private local socket is missing", async () => {
    const load = loaders(); fs.stat.mockImplementation(() => { throw new Error("missing"); });
    await expect(bootstrapApi(environment(), [], load)).rejects.toThrow();
    expect(load.normal).not.toHaveBeenCalled(); expect(load.terminal).not.toHaveBeenCalled();
  });
});
