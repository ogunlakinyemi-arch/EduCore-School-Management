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
  it("adds validated tenant keys before restoring the deferred composite FKs without DML", async () => {
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
    const restorationSql = await readFile(
      new URL("../../../../lib/db/drizzle/0007_restore_tenant_foreign_keys.sql", import.meta.url),
      "utf8",
    );
    const alignmentSql = await readFile(
      new URL("../../../../lib/db/drizzle/0008_align_tenant_fk_dependencies.sql", import.meta.url),
      "utf8",
    );
    expect(repairSql).toContain("mismatch_count");
    expect(repairSql).toContain("VALIDATE CONSTRAINT \"student_class_assignments_class_school_fk\"");
    expect(repairSql).not.toMatch(/\b(DELETE|UPDATE)\s+\"?student_class_assignments/i);
    expect(tenantKeySql.match(/UNIQUE\("id","school_id"\)/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(preparationSql).not.toMatch(/\b(DELETE|UPDATE|TRUNCATE)\b/i);
    expect(restorationSql).not.toMatch(/\b(DELETE|UPDATE|TRUNCATE|DROP TABLE)\b/i);
    expect(
      restorationSql.match(/\bADD CONSTRAINT "[^"]+_school_fk"/g)?.length,
    ).toBe(4);
    expect(restorationSql.match(/\bVALIDATE CONSTRAINT\b/g)?.length).toBe(4);
    expect(alignmentSql).not.toMatch(/\b(DELETE|UPDATE|TRUNCATE|DROP TABLE|DROP INDEX)\b/i);
    expect(alignmentSql.match(/\bADD CONSTRAINT "[^"]+_school_fk"/g)?.length).toBe(4);
    expect(alignmentSql.match(/\bVALIDATE CONSTRAINT\b/g)?.length).toBe(4);

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

    const restoredFks = await pool.query(
      `SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname = ANY($1::text[])
       ORDER BY conname`,
      [[
        "student_class_assignments_student_school_fk",
        "student_class_assignments_class_school_fk",
        "class_subjects_class_school_fk",
        "teacher_class_assignments_class_school_fk",
      ]],
    );
    expect(restoredFks.rowCount).toBe(4);
    expect(restoredFks.rows.every((row) => row.convalidated)).toBe(true);
    expect(restoredFks.rows.find((row) =>
      row.conname === "student_class_assignments_student_school_fk"
    )?.definition).toContain(
      "FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id)",
    );
    expect(restoredFks.rows.filter((row) =>
      row.conname !== "student_class_assignments_student_school_fk"
    ).every((row) =>
      row.definition.includes(
        "FOREIGN KEY (school_class_id, school_id) REFERENCES school_classes(id, school_id)",
      )
    )).toBe(true);

    const fkIndexDependencies = await pool.query(
      `SELECT DISTINCT fk.conname, referenced_index.relname AS referenced_index_name
       FROM pg_constraint fk
       JOIN pg_depend dependency
         ON dependency.classid = 'pg_constraint'::regclass
        AND dependency.objid = fk.oid
        AND dependency.refclassid = 'pg_class'::regclass
        AND dependency.deptype = 'n'
       JOIN pg_class referenced_index
         ON referenced_index.oid = dependency.refobjid
        AND referenced_index.relkind = 'i'
       WHERE fk.conname = ANY($1::text[])
       ORDER BY fk.conname`,
      [[
        "student_class_assignments_student_school_fk",
        "student_class_assignments_class_school_fk",
        "class_subjects_class_school_fk",
        "teacher_class_assignments_class_school_fk",
      ]],
    );
    expect(fkIndexDependencies.rows).toEqual([
      {
        conname: "class_subjects_class_school_fk",
        referenced_index_name: "school_classes_id_school_unique",
      },
      {
        conname: "student_class_assignments_class_school_fk",
        referenced_index_name: "school_classes_id_school_unique",
      },
      {
        conname: "student_class_assignments_student_school_fk",
        referenced_index_name: "students_id_school_unique",
      },
      {
        conname: "teacher_class_assignments_class_school_fk",
        referenced_index_name: "school_classes_id_school_unique",
      },
    ]);
  });
});