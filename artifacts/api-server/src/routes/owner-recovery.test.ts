import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";

const { clerkUsers } = vi.hoisted(() => ({
  clerkUsers: {
    createUser: vi.fn(),
    getUserList: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    getUser: vi.fn(),
  },
}));

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(() => ({ userId: null })),
  clerkClient: { users: clerkUsers },
}));

import { createOrRecoverBootstrapUser } from "./bootstrap";
import { createPlatformDeviceRecord } from "./platform";

function ownerRequest(userId: number) {
  return {
    edupulseUser: {
      user: {
        id: userId,
        clerkUserId: `recovery-${userId}`,
        email: `recovery-${userId}@example.test`,
        firstName: "Recovery",
        lastName: "Test",
        phone: null,
        status: "ACTIVE",
      },
      roles: [{ id: userId, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }],
    },
  } as any;
}

describe("owner identity recovery", () => {
  it("reclaims only a Clerk identity tagged by an earlier owner bootstrap attempt", async () => {
    const createFailure = new Error("email already exists");
    clerkUsers.createUser.mockRejectedValueOnce(createFailure);
    clerkUsers.getUserList.mockResolvedValueOnce({
      data: [{
        id: "user_orphan",
        privateMetadata: { edupulseProvisioning: "platform-owner-bootstrap" },
      }],
    });
    clerkUsers.updateUser.mockResolvedValueOnce({ id: "user_orphan" });

    const user = await createOrRecoverBootstrapUser({
      email: "recover@example.test",
      password: "StrongPassword1!",
      firstName: "Recover",
      lastName: "Owner",
    });

    expect(user.id).toBe("user_orphan");
    expect(clerkUsers.updateUser).toHaveBeenCalledWith(
      "user_orphan",
      expect.objectContaining({
        password: "StrongPassword1!",
        signOutOfOtherSessions: true,
      }),
    );
  });

  it("does not take over an untagged Clerk account with the same email", async () => {
    const createFailure = new Error("email already exists");
    clerkUsers.createUser.mockRejectedValueOnce(createFailure);
    clerkUsers.getUserList.mockResolvedValueOnce({
      data: [{ id: "user_unrelated", privateMetadata: {} }],
    });

    await expect(createOrRecoverBootstrapUser({
      email: "existing@example.test",
      password: "StrongPassword1!",
      firstName: "Existing",
    })).rejects.toBe(createFailure);
    expect(clerkUsers.updateUser).not.toHaveBeenCalledWith(
      "user_unrelated",
      expect.anything(),
    );
  });
});

describe("platform operation transactions", () => {
  it("rolls back a device when its required audit record cannot be inserted", async () => {
    const serialNumber = `ROLLBACK-${Date.now()}`;
    await expect(createPlatformDeviceRecord(
      ownerRequest(2_000_000_000),
      { serialNumber, name: "Rollback Test", deviceType: "NFC", schoolId: null },
    )).rejects.toMatchObject({ code: "23503" });

    const device = await pool.query(
      "SELECT id FROM platform_devices WHERE serial_number=$1",
      [serialNumber],
    );
    expect(device.rowCount).toBe(0);
  });
});

describe("forward migration safety", () => {
  it("guards historical mismatches and recreates the exact validated composite FK without DML", async () => {
    const sql = await readFile(
      new URL("../../../../lib/db/drizzle/0004_platform_operations.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("mismatch_count");
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS \"student_class_assignments_class_school_fk\"");
    expect(sql).toContain("VALIDATE CONSTRAINT \"student_class_assignments_class_school_fk\"");
    expect(sql).not.toMatch(/\b(DELETE|UPDATE)\s+\"?student_class_assignments/i);

    const constraint = await pool.query(
      `SELECT convalidated, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint WHERE conname='student_class_assignments_class_school_fk'`,
    );
    expect(constraint.rows[0]?.convalidated).toBe(true);
    expect(constraint.rows[0]?.definition).toContain(
      "FOREIGN KEY (school_class_id, school_id) REFERENCES school_classes(id, school_id)",
    );
  });
});