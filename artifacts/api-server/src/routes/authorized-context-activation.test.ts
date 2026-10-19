import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  roles: [] as Array<{ id: number; role: string; schoolId: number; status: string }>,
  activate: vi.fn(), internal: vi.fn(),
  applicationStatus: undefined as "PENDING" | "REJECTED" | undefined,
}));
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(async () => ({ rows: state.roles })) } }));
vi.mock("../middlewares/auth", async importOriginal => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return { ...actual, requireAuthentication: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    getUserContext: () => ({
      user: { id: 7, clerkUserId: "synthetic-user", email: "recipient@example.test", status: "ACTIVE" },
      roles: state.roles,
      applicationStatus: state.applicationStatus,
    }),
  };
});
vi.mock("./school-invitations", () => ({
  activateAcceptedSchoolInvitation: (...args: unknown[]) => state.activate(...args),
  createSchoolInvitation: vi.fn(), createSchoolWithAdministrator: vi.fn(),
  INVITABLE_SCHOOL_ROLES: ["SCHOOL_ADMIN"],
}));
vi.mock("./internal-employee-invitations", () => ({
  activateAcceptedInternalEmployeeInvitation: (...args: unknown[]) => state.internal(...args),
}));
import auth from "./auth";
let server: Server; let base: string;
beforeAll(async () => {
  const app = express(); app.use("/api", auth);
  server = await new Promise<Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No test listener");
  base = `http://127.0.0.1:${address.port}/api`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
beforeEach(() => {
  state.roles = [];
  state.applicationStatus = undefined;
  state.internal.mockReset().mockResolvedValue(false);
  state.activate.mockReset().mockResolvedValue(false);
});
it.each(["PENDING","REJECTED"] as const)("never activates invitations or exposes roles for a %s application", async status => {
  state.applicationStatus=status;
  state.roles=[{id:1,role:"SCHOOL_ADMIN",schoolId:101,status:"ACTIVE"}];
  const response=await fetch(`${base}/me/authorized-context`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({schoolInvitationActivated:false,isPlatformOwner:false,roles:[]});
  expect(state.activate).not.toHaveBeenCalled();
  expect(state.internal).not.toHaveBeenCalled();
});
it.each(["new application profile", "existing Clerk account"])("reports first-read activation for a %s only after server confirmation", async () => {
  state.activate.mockImplementation(async () => {
    state.roles = [{ id: 1, role: "TEACHER", schoolId: 101, status: "ACTIVE" }];
    return true;
  });
  const response = await fetch(`${base}/me/authorized-context`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ schoolInvitationActivated: true, roles: [{ role: "TEACHER", schoolId: 101 }] });
  expect(state.activate).toHaveBeenCalledWith(7, "synthetic-user");
});
it("never labels pre-existing access as a newly accepted invitation", async () => {
  state.roles = [{ id: 1, role: "TEACHER", schoolId: 101, status: "ACTIVE" }];
  const response = await fetch(`${base}/me/authorized-context`);
  expect(await response.json()).toMatchObject({ schoolInvitationActivated: false });
  expect(state.activate).not.toHaveBeenCalled();
});
it("does not manufacture activation when no verified invitation was activated", async () => {
  const response = await fetch(`${base}/me/authorized-context`);
  expect(await response.json()).toMatchObject({ schoolInvitationActivated: false, roles: [] });
});
