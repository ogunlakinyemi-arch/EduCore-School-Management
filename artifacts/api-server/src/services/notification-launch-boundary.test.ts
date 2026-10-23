import { afterEach, describe, expect, it, vi } from "vitest";
import { notificationLaunchBoundary, notificationLaunchSql, NOTIFICATION_TEST_DATA_FLOOR } from "./notification-launch-boundary";
import { dispatchCommunicationDeliveries, type CommunicationDispatchPool } from "./communication-service";
import { notificationChannelAvailability } from "./notification-channel-policy";

afterEach(() => vi.unstubAllEnvs());
const liveFrom = "2026-10-24T00:00:00.000Z";
const now = new Date("2026-10-25T00:00:00.000Z");

describe("first-school notification boundary", () => {
  it.each([
    undefined, "", "true", "2026-10-24", "2026-10-24T00:00:00Z",
    "2026-02-30T00:00:00.000Z", "2026-10-22T00:00:00.000Z",
    "2026-10-26T00:00:00.000Z", " 2026-10-24T00:00:00.000Z",
  ])("fails closed for missing/invalid/backdated/future cutoff %s", value => {
    expect(notificationLaunchBoundary({ NODE_ENV: "production", EDUCORE_NOTIFICATION_LIVE_FROM: value }, now))
      .toEqual({ allowed: false, liveFrom: null });
  });

  it("accepts only an explicit non-backdated cutoff at or before now", () => {
    expect(notificationLaunchBoundary({ NODE_ENV: "production", EDUCORE_NOTIFICATION_LIVE_FROM: liveFrom }, now))
      .toEqual({ allowed: true, liveFrom });
    expect(notificationLaunchBoundary({ NODE_ENV: "production", EDUCORE_NOTIFICATION_LIVE_FROM: NOTIFICATION_TEST_DATA_FLOOR },
      new Date(NOTIFICATION_TEST_DATA_FLOOR))).toEqual({ allowed: true, liveFrom: NOTIFICATION_TEST_DATA_FLOOR });
  });

  it("treats deployment-marker runtimes as Production, but preserves Development mocks", () => {
    expect(notificationLaunchBoundary({ NODE_ENV: "development", REPLIT_DEPLOYMENT: "1" }, now).allowed).toBe(false);
    expect(notificationLaunchBoundary({ NODE_ENV: "test" }, now)).toEqual({ allowed: true, liveFrom: null });
  });

  it("keeps In-App available and all external channels held without a launch boundary", () => {
    expect(notificationChannelAvailability({ NODE_ENV: "production" }))
      .toEqual({ IN_APP: true, EMAIL: false, PUSH: false, TELEGRAM: false, SMS: false });
  });

  it("Production Telegram opt-in cannot bypass the unset launch cutoff, even with an injected provider", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EDUCORE_PRODUCTION_TELEGRAM_ENABLED", "true");
    vi.stubEnv("EDUCORE_NOTIFICATION_LIVE_FROM", "");
    expect(notificationChannelAvailability({
      NODE_ENV: "production", EDUCORE_PRODUCTION_TELEGRAM_ENABLED: "true",
    }).TELEGRAM).toBe(false);
    const pool = { query: vi.fn(), connect: vi.fn() } as unknown as CommunicationDispatchPool;
    const send = vi.fn();
    const result = await dispatchCommunicationDeliveries(pool, 10, {
      allowConfiguredProviders: true, channels: ["TELEGRAM"], notificationIds: [42],
      providers: {
        email: { provider: "fixture", channel: "email", send },
        sms: { provider: "fixture", channel: "sms", send },
        telegram: { provider: "fixture", channel: "telegram", send },
      },
    });
    expect(result.claimed).toBe(0);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["production", "deployment-marker"])("performs no claims/writes/provider sends under the %s hold", async mode => {
    vi.stubEnv("NODE_ENV", mode === "production" ? "production" : "test");
    vi.stubEnv("REPLIT_DEPLOYMENT", mode === "deployment-marker" ? "1" : "");
    vi.stubEnv("EDUCORE_NOTIFICATION_LIVE_FROM", "");
    const pool = { query: vi.fn(), connect: vi.fn() } as unknown as CommunicationDispatchPool;
    const send = vi.fn();
    const result = await dispatchCommunicationDeliveries(pool, 10, {
      allowConfiguredProviders: true, notificationIds: [42], channels: ["EMAIL"],
      providers: {
        email: { provider: "fixture", channel: "email", send },
        sms: { provider: "fixture", channel: "sms", send },
      },
    });
    expect(result).toEqual({ claimed: 0, accepted: 0, delivered: 0, simulated: 0, failed: 0, skipped: 0 });
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("binds the cutoff into claims and stale recovery even with a manual notification scope", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EDUCORE_NOTIFICATION_LIVE_FROM", liveFrom);
    const query = vi.fn(async () => ({ rows: [] }));
    const release = vi.fn();
    const pool = { connect: vi.fn(async () => ({ query, release })), query: vi.fn() } as unknown as CommunicationDispatchPool;
    await dispatchCommunicationDeliveries(pool, 10, { now: () => now, channels: ["EMAIL"], notificationIds: [42] });
    const calls = query.mock.calls as unknown as Array<[string, unknown[] | undefined]>;
    const recovery = calls.find(([sql]) => sql.includes("PROVIDER_OUTCOME_UNKNOWN"))!;
    const claim = calls.find(([sql]) => sql.includes("WITH due"))!;
    expect(recovery[0]).toContain(notificationLaunchSql("$4"));
    expect(recovery[1]?.at(-1)).toBe(liveFrom);
    expect(claim[0]).toContain(notificationLaunchSql("$6"));
    expect(claim[1]?.at(-1)).toBe(liveFrom);
    expect(claim[1]?.[4]).toEqual([42]);
    expect(claim[0]).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim[0]).toContain("error_code IS DISTINCT FROM 'PROVIDER_OUTCOME_UNKNOWN'");
    expect(release).toHaveBeenCalledOnce();
  });

  it("requires new delivery, notification, recipient and school, not just a fresh retry", () => {
    const sql = notificationLaunchSql("$6");
    for (const field of ["d.created_at", "launch_n.created_at", "launch_u.created_at", "launch_s.created_at"]) {
      expect(sql).toContain(`${field} >= $6::timestamptz`);
    }
    expect(sql).toContain("launch_n.school_id IS NULL OR launch_s.created_at");
  });

  it("rechecks the same cutoff during pre-send reload and sends nothing when the record is excluded", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EDUCORE_NOTIFICATION_LIVE_FROM", liveFrom);
    const claimQuery = vi.fn(async (sql: string) => ({
      rows: sql.includes("RETURNING d.id") ? [{ id: 42, channel: "EMAIL", attempts: 1 }] : [],
    }));
    const query = vi.fn(async () => ({ rows: [] }));
    const send = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({ query: claimQuery, release: vi.fn() })), query,
    } as unknown as CommunicationDispatchPool;
    const result = await dispatchCommunicationDeliveries(pool, 10, {
      now: () => now, channels: ["EMAIL"],
      providers: {
        email: { provider: "fixture", channel: "email", send },
        sms: { provider: "fixture", channel: "sms", send },
      },
    });
    const calls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    const reload = calls.find(([sql]) => sql.includes('AS "notificationId"'))!;
    expect(reload[0]).toContain(notificationLaunchSql("$2"));
    expect(reload[1]).toEqual([42, liveFrom]);
    expect(send).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });
});
