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
  it("prepares tenant keys without rewriting data or adding dependent FKs prematurely", async () => {
    const repairSql = await readFile(
      new URL("../../../../lib/db/drizzle/0004_platform_operations.sql", import.meta.url),
      "utf8",
    );
    const tenantKeySql = await readFile(
      new URL("../../../../lib/db/drizzle/0005_tenant_reference_keys.sql", import.meta.url),
      "utf8",
    );
    const preparationSql = await readFile(
      new URL("../../../../lib/db/drizzle/0006_prepare_tenant_keys_publish.sql", import.meta.url),
      "utf8",
    );
    expect(repairSql).toContain("mismatch_count");
    expect(repairSql).toContain("VALIDATE CONSTRAINT \"student_class_assignments_class_school_fk\"");
    expect(repairSql).not.toMatch(/\b(DELETE|UPDATE)\s+\"?student_class_assignments/i);
    expect(tenantKeySql.match(/UNIQUE\("id","school_id"\)/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(preparationSql).not.toMatch(/\b(DELETE|UPDATE|TRUNCATE)\b/i);

    const tenantKeys = await pool.query(
      `SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname LIKE '%_id_school_tenant_key'
       ORDER BY conname`,
    );
    expect(tenantKeys.rowCount).toBe(6);
    expect(tenantKeys.rows.every((row) =>
      row.convalidated && row.definition === "UNIQUE (id, school_id)",
    )).toBe(true);

    const deferredFks = await pool.query(
      `SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])`,
      [[
        "student_class_assignments_student_school_fk",
        "student_class_assignments_class_school_fk",
        "class_subjects_class_school_fk",
        "teacher_class_assignments_class_school_fk",
      ]],
    );
    expect(deferredFks.rowCount).toBe(0);
  });
});