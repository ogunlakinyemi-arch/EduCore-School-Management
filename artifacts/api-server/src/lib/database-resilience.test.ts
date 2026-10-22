import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyDatabaseError,
  connectWithRetry,
  CONNECT_TIMEOUT_MS,
  ResilientPool,
  setDatabaseDiagnosticReporter,
  databaseTargetDiagnostic,
} from "@workspace/db/connection-resilience";
import { createGuardedBackgroundTask } from "./background-task";

// Fictional values that must never appear in any diagnostic or log.
const SENSITIVE = ["db-host.internal.example", "app_role_user", "s3cret-pass", "student@example.test", "postgres://"];
const pgError = (code: string, message = `role "app_role_user" on db-host.internal.example rejected s3cret-pass`) =>
  Object.assign(new Error(message), { code, severity: "FATAL" });

/** Mocked pg client: no network, scripted connect outcomes. */
type Outcome = "ok" | "hang" | Error;
let script: Outcome[] = [];
let created = 0;
class FakeClient extends EventEmitter {
  _queryable = true;
  _ending = false;
  private pending: ((err?: Error) => void) | null = null;
  constructor() { super(); created += 1; }
  isConnected() { return false; }
  connect(callback: (err?: Error) => void) {
    const outcome = script.shift() ?? "ok";
    if (outcome === "hang") { this.pending = callback; return; }
    setImmediate(() => callback(outcome === "ok" ? undefined : outcome));
  }
  query(_text: unknown, _values: unknown, callback?: (err: Error | null, result?: unknown) => void) {
    const cb = typeof _values === "function" ? _values as typeof callback : callback;
    setImmediate(() => cb?.(null, { rows: [{ ok: 1 }], rowCount: 1 }));
  }
  end(callback?: () => void) {
    this._ending = true; this._queryable = false;
    if (this.pending) { const cb = this.pending; this.pending = null; cb(new Error("Connection terminated")); }
    callback?.();
    return Promise.resolve();
  }
}

const reports: Array<{ event: string; diagnostic: Record<string, unknown> }> = [];
const newPool = (options: Record<string, unknown> = {}) =>
  new ResilientPool({ Client: FakeClient as any, max: 2, ...options });

beforeEach(() => {
  script = []; created = 0; reports.length = 0;
  setDatabaseDiagnosticReporter((event, diagnostic) => reports.push({ event, diagnostic: { ...diagnostic } }));
});
afterEach(() => vi.useRealTimers());

function expectSanitized(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of SENSITIVE) expect(text).not.toContain(secret);
}

describe("database error classification (allowlisted)", () => {
  it.each([
    ["57P01", "CONNECTION_TERMINATED", true],
    ["08006", "CONNECTION_TERMINATED", true],
    ["57P03", "CONNECTION_UNAVAILABLE", true],
    ["28000", "AUTHENTICATION_REJECTED", false],
    ["28P01", "AUTHENTICATION_REJECTED", false],
    ["42501", "PERMISSION_DENIED", false],
    ["23505", "DATABASE_ERROR", false],
    ["ECONNREFUSED", "CONNECTION_UNAVAILABLE", true],
  ])("%s → %s (transient=%s) without raw text", (code, category, transient) => {
    const diagnostic = classifyDatabaseError(pgError(code));
    expect(diagnostic.category).toBe(category);
    expect(diagnostic.transientConnectFailure).toBe(transient);
    expectSanitized(diagnostic);
  });

  it("treats timeouts as non-retryable and unknown errors as non-database", () => {
    expect(classifyDatabaseError(new Error("Connection terminated due to connection timeout")))
      .toMatchObject({ category: "CONNECT_TIMEOUT", transientConnectFailure: false, sqlstate: null });
    const other = classifyDatabaseError(new Error("student@example.test failed at db-host.internal.example"));
    expect(other).toMatchObject({ category: "NON_DATABASE_ERROR", sqlstate: null });
    expectSanitized(other);
  });
});

describe("ResilientPool with mocked pg clients", () => {
  it("defaults to a 10-second connection timeout", () => {
    expect(CONNECT_TIMEOUT_MS).toBe(10_000);
    expect(newPool().options.connectionTimeoutMillis).toBe(10_000);
  });

  it("survives a dropped idle connection and opens a fresh one", async () => {
    const pool = newPool();
    const first = await pool.connect();
    first.release();
    // Without the pool error handler this emit would throw (unhandled 'error').
    expect(() => first.emit("error", pgError("57P01", "terminating connection due to administrator command")))
      .not.toThrow();
    expect(reports).toEqual([{ event: "IDLE_CLIENT_ERROR", diagnostic: expect.objectContaining({
      sqlstate: "57P01", category: "CONNECTION_TERMINATED" }) }]);
    const second = await pool.connect();
    expect(second).not.toBe(first);
    expect(created).toBe(2);
    second.release();
    expectSanitized(reports);
  });

  it("does not crash when a checked-out client is terminated between queries", async () => {
    const pool = newPool();
    const client = await pool.connect();
    expect(() => client.emit("error", pgError("57P01"))).not.toThrow();
    expect(reports.map(r => r.event)).toEqual(["CHECKED_OUT_CLIENT_ERROR"]);
    client.release(new Error("terminated"));
    const fresh = await pool.connect();
    expect(fresh).not.toBe(client);
    fresh.release();
  });

  it("retries a transient connection-establishment failure, then recovers", async () => {
    script = [pgError("ECONNRESET"), "ok"];
    const pool = newPool();
    const client = await pool.connect();
    expect(created).toBe(2);
    expect(reports).toEqual([{ event: "CONNECT_RETRY", diagnostic: expect.objectContaining({
      networkCode: "ECONNRESET", category: "CONNECTION_UNAVAILABLE", attempt: 1 }) }]);
    client.release();
  });

  it("bounds retries and surfaces the original error after the last attempt", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const failure = pgError("57P03");
    await expect(connectWithRetry(async () => { attempts += 1; throw failure; }, [5, 10], async ms => { delays.push(ms); }))
      .rejects.toBe(failure);
    expect(attempts).toBe(3);
    expect(delays).toEqual([5, 10]);
  });

  it("never retries SQLSTATE 28000, rejects explicitly, and recovers on a later acquisition", async () => {
    script = [pgError("28000"), "ok"];
    const pool = newPool();
    await expect(pool.connect()).rejects.toMatchObject({ code: "28000" });
    expect(created).toBe(1);
    expect(reports).toEqual([]);
    const later = await pool.connect();
    expect(created).toBe(2);
    later.release();
  });

  it("times out a hanging connect without retrying", async () => {
    script = ["hang", "ok"];
    const pool = newPool({ connectionTimeoutMillis: 30 });
    const error = await pool.connect().then(() => null, (e: unknown) => e);
    expect(classifyDatabaseError(error).category).toBe("CONNECT_TIMEOUT");
    expect(created).toBe(1);
  });

  it("does not replay pool.query when connection establishment fails", async () => {
    script = [pgError("ECONNRESET"), "ok"];
    const pool = newPool();
    await expect(pool.query("UPDATE x SET y=1")).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(created).toBe(1);
    await expect(pool.query("SELECT 1")).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe("guarded background task diagnostics", () => {
  it("logs SQLSTATE and an allowlisted category only, never the raw driver error", async () => {
    const logger = { error: vi.fn() };
    const run = vi.fn().mockRejectedValueOnce(pgError("28000")).mockResolvedValueOnce(undefined);
    const tick = createGuardedBackgroundTask("Communication delivery worker", run, logger);
    await expect(tick()).resolves.toBe("failed");
    expect(logger.error).toHaveBeenCalledWith({
      task: "Communication delivery worker", sqlstate: "28000", networkCode: null,
      category: "AUTHENTICATION_REJECTED", reason: "The database rejected the connection's authorization",
      authorizationReason: "UNSPECIFIED",
    }, "Communication delivery worker failed");
    expectSanitized(logger.error.mock.calls);
    // No in-tick retry; the next scheduled tick is the recovery path.
    expect(run).toHaveBeenCalledTimes(1);
    await expect(tick()).resolves.toBe("succeeded");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("skips overlapping ticks and releases the guard after failure", async () => {
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const tick = createGuardedBackgroundTask("worker", run, { error: vi.fn() });
    const first = tick();
    await expect(tick()).resolves.toBe("skipped");
    finish();
    await expect(first).resolves.toBe("succeeded");
    run.mockRejectedValueOnce(new Error("boom student@example.test"));
    await expect(tick()).resolves.toBe("failed");
    run.mockResolvedValueOnce(undefined);
    await expect(tick()).resolves.toBe("succeeded");
  });
});

describe("sanitized target and authorization diagnostics",()=>{
  it("fingerprints routing consistently without returning credentials or routing names",()=>{
    const config={host:SENSITIVE[0],database:"fictional_application",user:SENSITIVE[1],password:SENSITIVE[2],port:5432};
    const first=databaseTargetDiagnostic(config);
    expect(first.targetFingerprint).toMatch(/^[a-f0-9]{24}$/);
    expect(first.connectedTargetVerified).toBe(false);
    expect(databaseTargetDiagnostic({...config,password:"different_password"})).toEqual(first);
    expect(databaseTargetDiagnostic({...config,database:"other_database"}).targetFingerprint).not.toBe(first.targetFingerprint);
    expectSanitized(first);
    expect(JSON.stringify(first)).not.toContain("fictional_application");
  });
  it.each([
    ["password authentication failed for user app_role_user","PASSWORD_REJECTED"],
    ['role "app_role_user" does not exist',"ROLE_UNAVAILABLE"],
    ['no pg_hba.conf entry for host db-host.internal.example',"ACCESS_RULE_REJECTED"],
    ["unknown backend rejection s3cret-pass","UNSPECIFIED"],
  ])("classifies authorization without copying raw reason: %s",(message,expected)=>{
    const d=classifyDatabaseError(pgError("28000",message));
    expect(d.authorizationReason).toBe(expected);
    expect(d.transientConnectFailure).toBe(false);expectSanitized(d);
  });
  it("never replays a completed job after a later job's auth failure",async()=>{
    const completed=new Set<string>();
    const write=vi.fn(async()=>{completed.add("fictional-job");});
    let fail=true;
    const run=async()=>{
      if(!completed.has("fictional-job"))await write();
      if(fail)throw pgError("28000");
    };
    const tick=createGuardedBackgroundTask("Communication delivery worker",run,{error:vi.fn()});
    expect(await tick()).toBe("failed");fail=false;
    expect(await tick()).toBe("succeeded");expect(write).toHaveBeenCalledOnce();
  });
});
