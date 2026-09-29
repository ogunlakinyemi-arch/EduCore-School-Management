import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  context: {
    user: {
      id: 41,
      clerkUserId: "test-user",
      email: "user@example.test",
      firstName: "Test",
      lastName: "User",
      status: "ACTIVE",
    },
    roles: [{ role: "SCHOOL_ADMIN", schoolId: 10, status: "ACTIVE" }],
  } as {
    user: Record<string, unknown>;
    roles: Array<{ role: string; schoolId: number | null; status: string }>;
  },
  query: vi.fn(),
  run: vi.fn(),
  classSchoolId: 10,
  partnerSchoolId: 10,
}));

vi.mock("@workspace/db", () => ({
  pool: { query: state.query },
}));

vi.mock("./reporting/organization", () => ({
  organizationReports: {
    overview: {
      roles: ["OWNER", "ADMIN"],
      filters: ["schoolId", "limit", "offset"],
      run: state.run,
    },
    partners: {
      roles: ["OWNER", "PARTNER"],
      filters: ["schoolId", "limit", "offset"],
      run: state.run,
    },
  },
}));

vi.mock("../middlewares/auth", async () => {
  const actual = await vi.importActual<typeof import("../middlewares/auth")>("../middlewares/auth");
  return {
    ...actual,
    getUserContext: (req: express.Request) =>
      (req as express.Request & { edupulseUser?: typeof state.context }).edupulseUser,
    requireAuthentication: () => (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (!state.authenticated) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      (req as express.Request & { edupulseUser?: typeof state.context }).edupulseUser = state.context;
      next();
    },
    handleAuthError: (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const authError = error as { statusCode?: number; message?: string; eventType?: string };
      if (typeof authError.statusCode === "number") {
        res.status(authError.statusCode).json({
          error: authError.message,
          code: authError.eventType,
        });
        return;
      }
      next(error);
    },
  };
});

import reportingRouter from "./reporting";

const app = express();
app.use("/api", reportingRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

const reportResult = {
  title: "School overview",
  columns: [
    { key: "students", label: "Students" },
    { key: "private-internal", label: "Internal field" },
  ],
  rows: [{ students: 12, "private-internal": "must not leave server" }],
  total: 1,
};

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Reporting test server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

function setRole(
  role: string,
  schoolId: number | null = 10,
  extras: Array<{ role: string; schoolId: number | null; status: string }> = [],
) {
  state.context = {
    user: {
      id: 41,
      clerkUserId: "test-user",
      email: "user@example.test",
      firstName: "Test",
      lastName: "User",
      status: "ACTIVE",
    },
    roles: [{ role, schoolId, status: "ACTIVE" }, ...extras],
  };
}

beforeEach(() => {
  state.authenticated = true;
  setRole("SCHOOL_ADMIN", 10);
  state.classSchoolId = 10;
  state.partnerSchoolId = 10;
  state.run.mockReset().mockImplementation(async () => reportResult);
  state.query.mockReset().mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    if (sql.includes("SELECT id FROM schools")) return { rows: [{ id: values[0] }] };
    if (sql.includes("FROM school_classes WHERE id=$1")) {
      return { rows: [{ id: values[0], schoolId: state.classSchoolId }] };
    }
    if (sql.includes("FROM partner_profiles p")) return { rows: [{ id: 77, status: "ACTIVE" }] };
    if (sql.includes("FROM school_partner_attributions")) {
      return { rows: Number(values[0]) === state.partnerSchoolId ? [{ ok: 1 }] : [] };
    }
    if (sql.includes("FROM parents")) return { rows: [{ id: 88 }] };
    if (sql.includes("FROM parent_student_relationships")) return { rows: [] };
    if (sql.includes("FROM students") && sql.includes("user_id=$1")) {
      return { rows: [{ id: 501 }] };
    }
    return { rows: [] };
  });
});

describe("report route authorization and exports", () => {
  it("returns 401 when authentication is missing", async () => {
    state.authenticated = false;
    const response = await fetch(`${baseUrl}/api/reports/overview`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Authentication required" });
    expect(state.run).not.toHaveBeenCalled();
  });

  it("allows an owner to select a school for read-only report access", async () => {
    setRole("PLATFORM_OWNER", null);
    const response = await fetch(`${baseUrl}/api/reports/overview?schoolId=10`);
    expect(response.status).toBe(200);
    expect(state.run).toHaveBeenCalledWith(
      expect.objectContaining({ role: "OWNER", schoolId: 10 }),
      expect.objectContaining({ schoolId: 10 }),
    );
    expect(state.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO") &&
      !String(sql).includes("audit_logs"))).toBe(false);
  });

  it("does not let a school A member read or export school B reports", async () => {
    setRole("SCHOOL_ADMIN", 10);
    const screen = await fetch(`${baseUrl}/api/reports/overview?schoolId=20`);
    expect(screen.status).toBe(404);
    expect(state.run).not.toHaveBeenCalled();

    for (const format of ["csv", "xlsx", "pdf"]) {
      const response = await fetch(
        `${baseUrl}/api/reports/overview/export?schoolId=20&format=${format}`,
      );
      expect(response.status).toBe(404);
    }
    expect(state.run).not.toHaveBeenCalled();
  });

  it("rejects a parent-selected student who is not their child", async () => {
    setRole("PARENT", 10);
    const response = await fetch(`${baseUrl}/api/reports/attendance?studentId=502`);
    expect(response.status).toBe(404);
    expect(state.run).not.toHaveBeenCalled();
    expect(state.query.mock.calls.some(([sql]) =>
      String(sql).includes("parent_student_relationships"),
    )).toBe(true);
  });

  it("rejects a student-selected identity other than their own", async () => {
    setRole("STUDENT", 10);
    const response = await fetch(`${baseUrl}/api/reports/attendance?studentId=502`);
    expect(response.status).toBe(404);
    expect(state.run).not.toHaveBeenCalled();
  });

  it("rejects a partner selecting a school without an active attribution", async () => {
    setRole("PARTNER", 10);
    state.partnerSchoolId = 10;
    const response = await fetch(`${baseUrl}/api/reports/partners?schoolId=20`);
    expect(response.status).toBe(404);
    expect(state.query.mock.calls.some(([sql, values]) =>
      String(sql).includes("school_partner_attributions") &&
      Number((values as unknown[])[0]) === 20,
    )).toBe(true);
  });

  it("rejects a teacher's class filter when the class belongs to another school", async () => {
    setRole("TEACHER", 10);
    state.classSchoolId = 20;
    const response = await fetch(`${baseUrl}/api/reports/attendance?classId=55`);
    expect(response.status).toBe(404);
    expect(state.query.mock.calls.some(([sql]) => String(sql).includes("FROM school_classes"))).toBe(true);
    expect(state.query.mock.calls.some(([sql]) => String(sql).includes("teacher_class_assignments"))).toBe(false);
  });

  it("keeps teacher report queries scoped to assigned classes", async () => {
    setRole("TEACHER", 10);
    const response = await fetch(`${baseUrl}/api/reports/attendance?classId=55`);
    expect(response.status).toBe(200);
    const reportQueries = state.query.mock.calls
      .map(([sql]) => String(sql))
      .filter(sql => sql.includes("attendance_events"));
    expect(reportQueries.length).toBeGreaterThan(0);
    expect(reportQueries.every(sql => sql.includes("teacher_class_assignments"))).toBe(true);
  });

  it("restricts accountants to finance reports", async () => {
    setRole("ACCOUNTANT", 10);
    const otherReport = await fetch(`${baseUrl}/api/reports/overview`);
    expect(otherReport.status).toBe(403);
    expect(state.run).not.toHaveBeenCalled();

    const finance = await fetch(`${baseUrl}/api/reports/finance`);
    expect(finance.status).toBe(200);
    const financeBody = await finance.json() as { title: string };
    expect(financeBody.title).toBe("Fee invoice summary");
  });

  it.each(["csv", "xlsx", "pdf"] as const)(
    "exports only the screen's visible columns as %s",
    async format => {
      const screenResponse = await fetch(`${baseUrl}/api/reports/overview`);
      expect(screenResponse.status).toBe(200);
      const screen = await screenResponse.json() as {
        columns: Array<{ key: string }>;
        rows: Array<Record<string, unknown>>;
      };
      expect(screen.columns.map((column: { key: string }) => column.key)).toEqual(["students"]);
      expect(screen.rows).toEqual([{ students: 12 }]);

      const response = await fetch(
        `${baseUrl}/api/reports/overview/export?format=${format}`,
      );
      expect(response.status).toBe(200);
      const body = Buffer.from(await response.arrayBuffer());
      let exportedText = body.toString("utf8");
      if (format === "xlsx") {
        const zlib = await import("node:zlib");
        const entries: string[] = [];
        let offset = 0;
        while (offset + 30 < body.length && body.readUInt32LE(offset) === 0x04034b50) {
          const compressedSize = body.readUInt32LE(offset + 18);
          const filenameLength = body.readUInt16LE(offset + 26);
          const extraLength = body.readUInt16LE(offset + 28);
          const dataStart = offset + 30 + filenameLength + extraLength;
          entries.push(zlib.inflateRawSync(body.subarray(dataStart, dataStart + compressedSize)).toString("utf8"));
          offset = dataStart + compressedSize;
        }
        exportedText = entries.join("\n");
      }
      expect(exportedText).toContain("Students");
      expect(exportedText).toContain("12");
      expect(exportedText).not.toContain("Internal field");
      expect(exportedText).not.toContain("must not leave server");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(state.run).toHaveBeenCalledTimes(2);
    },
  );
});