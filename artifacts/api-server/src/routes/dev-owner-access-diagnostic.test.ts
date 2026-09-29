import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@clerk/express", () => ({ getAuth: mocks.getAuth }));
vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));

import router from "./dev-owner-access-diagnostic";

const app = express();
app.use("/api", router);

describe("read-only development Owner access diagnostic", () => {
  const originalEnvironment = process.env.NODE_ENV;
  let server: ReturnType<typeof app.listen>;
  let url: string;

  beforeAll(async () => {
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Diagnostic test server failed");
    url = `http://127.0.0.1:${address.port}/api/dev/my-owner-access`;
  });

  afterAll(async () => {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  beforeEach(() => {
    process.env.NODE_ENV = "development";
    mocks.getAuth.mockReset();
    mocks.query.mockReset();
    mocks.getAuth.mockReturnValue({ userId: "user_current_1234" });
  });

  it("requires a Clerk session without querying or provisioning a user", async () => {
    mocks.getAuth.mockReturnValue({ userId: null });
    const response = await fetch(url);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("reports only the authenticated user's active global Owner membership", async () => {
    mocks.query.mockResolvedValue({ rows: [
      { internalUserId: 181, accountStatus: "ACTIVE", role: "PLATFORM_OWNER", schoolId: null, membershipStatus: "ACTIVE" },
      { internalUserId: 181, accountStatus: "ACTIVE", role: "TEACHER", schoolId: 9, membershipStatus: "INACTIVE" },
    ] });
    const response = await fetch(url);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      clerkUserIdMasked: "user…1234",
      internalUserExists: true,
      internalUserId: 181,
      accountStatus: "ACTIVE",
      activeMembershipCount: 1,
      activeMemberships: [{ role: "PLATFORM_OWNER", schoolId: null, global: true }],
      hasPlatformOwner: true,
      authorizationLookup: { outcome: "success", expectedStatus: 200, isPlatformOwner: true },
      authorizedContextRequestExecuted: false,
    });
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^\s*SELECT\b/i),
      ["user_current_1234"],
    );
  });

  it("distinguishes an active role-less user from an unknown identity", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [
      { internalUserId: 309, accountStatus: "ACTIVE", role: null, schoolId: null, membershipStatus: null },
    ] }).mockResolvedValueOnce({ rows: [] });
    const roleless = await (await fetch(url)).json();
    expect(roleless).toMatchObject({
      internalUserId: 309,
      activeMembershipCount: 0,
      hasPlatformOwner: false,
      authorizationLookup: { outcome: "success", expectedStatus: 200, roles: [] },
    });
    const missing = await (await fetch(url)).json();
    expect(missing).toMatchObject({
      internalUserExists: false,
      internalUserId: null,
      authorizationLookup: { outcome: "user_not_present" },
    });
    expect(mocks.query.mock.calls.every(([sql]) => /^\s*SELECT\b/i.test(sql))).toBe(true);
  });

  it("rejects the route outside development before authentication or database access", async () => {
    process.env.NODE_ENV = "production";
    const response = await fetch(url);
    expect(response.status).toBe(404);
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});