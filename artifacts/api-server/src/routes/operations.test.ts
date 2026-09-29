import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "SCHOOL_ADMIN",
  schoolId: 1,
  queries: [] as Array<{ sql: string; values: unknown[]; transactional: boolean }>,
  assetRow: {
    id: 41,
    schoolId: 1,
    categoryId: null,
    assetCode: "A-41",
    name: "Projector",
    description: null,
    quantity: 2,
    unit: "item",
    location: "Block A",
    condition: "GOOD",
    assignedToUserId: null,
    acquiredOn: null,
    status: "AVAILABLE",
    notes: null,
  } as Record<string, unknown> | null,
  assetExists: true,
  assetHistoryRows: [] as Array<Record<string, unknown>>,
  maintenanceRow: {
    id: 53,
    schoolId: 1,
    categoryId: null,
    assetId: null,
    assignedToUserId: null,
    status: "OPEN",
    completedAt: null,
  } as Record<string, unknown> | null,
  taskRow: {
    id: 61,
    schoolId: 1,
    assignedToUserId: null,
    status: "OPEN",
    completedAt: null,
  } as Record<string, unknown> | null,
  settingStaffReport: true,
  assigneeAllowed: true,
  assigneeRole: "STAFF",
}));

const poolMock = vi.hoisted(() => {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values, transactional: false });
    if (sql.includes("SELECT 1 FROM school_assets")) {
      return { rows: state.assetExists ? [{ "?column?": 1 }] : [] };
    }
    if (sql.includes("FROM school_asset_history")) return { rows: state.assetHistoryRows };
    return { rows: [] };
  });
  const connect = vi.fn(async () => ({
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values, transactional: true });
      if (sql.includes("SELECT 1") && sql.includes("school_memberships")) {
        const eligibleRole = ["SCHOOL_ADMIN", "TEACHER", "STAFF"].includes(state.assigneeRole);
        return { rows: state.assigneeAllowed && eligibleRole ? [{ "?column?": 1 }] : [] };
      }
      if (sql.includes("FROM school_operations_settings")) {
        return {
          rows: [{
            staffCanReportMaintenance: state.settingStaffReport,
            defaultPriority: "HIGH",
          }],
        };
      }
      if (sql.includes("FROM school_assets") && sql.includes("FOR UPDATE")) {
        return { rows: state.assetRow ? [{ ...state.assetRow }] : [] };
      }
      if (sql.includes("SELECT 1 FROM school_assets")) {
        return { rows: state.assetExists ? [{ "?column?": 1 }] : [] };
      }
      if (sql.includes("INSERT INTO school_assets")) {
        return { rows: [{ ...state.assetRow, schoolId: values[0], name: values[3], quantity: values[5] }] };
      }
      if (sql.includes("UPDATE school_assets")) {
        const updated = { ...state.assetRow };
        const setClause = sql.match(/SET ([\s\S]+?)\s+WHERE/)?.[1] ?? "";
        for (const [index, match] of [...setClause.matchAll(/([a-z_]+) = \$(\d+)/g)].entries()) {
          const [, column, parameter] = match;
          const field = {
            category_id: "categoryId", asset_code: "assetCode", name: "name", description: "description",
            quantity: "quantity", unit: "unit", location: "location", condition: "condition",
            assigned_to_user_id: "assignedToUserId", acquired_on: "acquiredOn", status: "status", notes: "notes",
          }[column] as string;
          updated[field] = values[Number(parameter) - 1];
        }
        state.assetRow = updated;
        return { rows: [updated] };
      }
      if (sql.includes("INSERT INTO maintenance_requests")) {
        return {
          rows: [{
            id: 53,
            schoolId: values[0],
            title: values[3],
            assignedToUserId: values[7],
            priority: values[8],
            status: values[9],
            completedAt: null,
          }],
        };
      }
      if (sql.includes("FROM maintenance_requests") && sql.includes("FOR UPDATE")) {
        return { rows: state.maintenanceRow ? [{ ...state.maintenanceRow }] : [] };
      }
      if (sql.includes("UPDATE maintenance_requests")) {
        const statusParameter = sql.match(/status = \$(\d+)/)?.[1];
        const updated = {
          ...state.maintenanceRow,
          ...(statusParameter ? { status: values[Number(statusParameter) - 1] } : {}),
        };
        state.maintenanceRow = updated;
        return { rows: [updated] };
      }
      if (sql.includes("FROM operational_tasks") && sql.includes("FOR UPDATE")) {
        return { rows: state.taskRow ? [{ ...state.taskRow }] : [] };
      }
      if (sql.includes("UPDATE operational_tasks")) {
        const statusParameter = sql.match(/status = \$(\d+)/)?.[1];
        const updated = {
          ...state.taskRow,
          ...(statusParameter ? { status: values[Number(statusParameter) - 1] } : {}),
        };
        state.taskRow = updated;
        return { rows: [updated] };
      }
      if (sql.includes("INSERT INTO operational_tasks")) {
        return {
          rows: [{
            id: 61,
            schoolId: values[0],
            assignedToUserId: values[4],
            priority: values[6],
            status: values[7],
            completedAt: null,
          }],
        };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  }));
  return { query, connect };
});

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      const role = state.role as any;
      const schoolId = role === "PLATFORM_OWNER" ? null : state.schoolId;
      (req as any).edupulseUser = {
        user: {
          id: 12,
          clerkUserId: `clerk-${role}`,
          email: `${role.toLowerCase()}@example.test`,
          firstName: "Test",
          lastName: "User",
          phone: null,
          status: "ACTIVE",
        },
        roles: [{ id: 1, role, schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import operationsRouter from "./operations";

const app = express();
app.use(express.json());
app.use(operationsRouter);

let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
));

beforeEach(() => {
  state.role = "SCHOOL_ADMIN";
  state.schoolId = 1;
  state.assetRow = {
    id: 41,
    schoolId: 1,
    categoryId: null,
    assetCode: "A-41",
    name: "Projector",
    description: null,
    quantity: 2,
    unit: "item",
    location: "Block A",
    condition: "GOOD",
    assignedToUserId: null,
    acquiredOn: null,
    status: "AVAILABLE",
    notes: null,
  };
  state.assetExists = true;
  state.assetHistoryRows = [];
  state.maintenanceRow = {
    id: 53,
    schoolId: 1,
    categoryId: null,
    assetId: null,
    assignedToUserId: null,
    status: "OPEN",
    completedAt: null,
  };
  state.taskRow = {
    id: 61,
    schoolId: 1,
    assignedToUserId: null,
    status: "OPEN",
    completedAt: null,
  };
  state.settingStaffReport = true;
  state.assigneeAllowed = true;
  state.assigneeRole = "STAFF";
  state.queries.length = 0;
  poolMock.query.mockClear();
  poolMock.connect.mockClear();
});

async function call(path: string, method = "GET", body?: Record<string, unknown>) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("school operations authorization and audit", () => {
  it.each(["PLATFORM_OWNER", "PARTNER", "TEACHER", "ACCOUNTANT", "PARENT", "STUDENT"])(
    "denies %s operational writes without querying operational tables",
    async (role) => {
      state.role = role;
      const response = await call("/operations/assets?schoolId=1", "POST", { name: "Projector" });
      expect(response.status).toBe(404);
      expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO school_assets"))).toBe(false);
    },
  );

  it("rejects a school administrator trying to address another school", async () => {
    const response = await call("/operations/assets?schoolId=2");
    expect(response.status).toBe(404);
    expect(state.queries.some(({ sql }) => sql.includes("FROM school_assets"))).toBe(false);
  });

  it("scopes collection reads to the explicitly authorized school", async () => {
    const response = await call("/operations/assets?schoolId=1");
    expect(response.status).toBe(200);
    const list = state.queries.find(({ sql }) => sql.includes("FROM school_assets") && !sql.includes("FOR UPDATE"));
    expect(list?.values[0]).toBe(1);
    expect(list?.sql).toContain("WHERE school_id = $1");
  });

  it("lets Staff list only assigned tasks but not assets or task creation", async () => {
    state.role = "STAFF";
    const assetList = await call("/operations/assets?schoolId=1");
    const taskCreate = await call("/operations/tasks?schoolId=1", "POST", { title: "Move chairs" });
    const taskList = await call("/operations/tasks?schoolId=1");
    expect(assetList.status).toBe(404);
    expect(taskCreate.status).toBe(404);
    expect(taskList.status).toBe(200);
    expect(state.queries.some(({ sql }) => sql.includes("FROM school_assets"))).toBe(false);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO operational_tasks"))).toBe(false);
    const list = state.queries.find(({ sql }) => sql.includes("FROM operational_tasks") && !sql.includes("FOR UPDATE"));
    expect(list?.sql).toContain("assigned_to_user_id = $3");
    expect(list?.values).toEqual([1, false, 12]);
  });

  it("does not let Staff update maintenance workflow after reporting an issue", async () => {
    state.role = "STAFF";
    const response = await call("/operations/maintenance-requests/53?schoolId=1", "PATCH", {
      status: "COMPLETED",
    });
    expect(response.status).toBe(404);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE maintenance_requests"))).toBe(false);
  });

  it("does not expose cross-school asset identifiers through an update", async () => {
    state.assetRow = null;
    const response = await call("/operations/assets/91?schoolId=1", "PATCH", { status: "LOST" });
    expect(response.status).toBe(404);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE school_assets"))).toBe(false);
    expect(state.queries.find(({ sql }) => sql.includes("FOR UPDATE"))?.values).toEqual([91, 1]);
  });

  it("creates inventory records transactionally, persists quantity and audits the operation", async () => {
    const response = await call("/operations/assets?schoolId=1", "POST", {
      name: "Projector",
      assetCode: "P-04",
      quantity: 4,
      location: "Block B",
    });
    expect(response.status).toBe(201);
    const insert = state.queries.find(({ sql }) => sql.includes("INSERT INTO school_assets"));
    expect(insert?.transactional).toBe(true);
    expect(insert?.values).toContain(4);
    const history = state.queries.find(({ sql }) => sql.includes("INSERT INTO school_asset_history"));
    expect(history?.transactional).toBe(true);
    expect(history?.sql).toContain("'CREATED'");
    expect(history?.values).toContain(4);
    const audit = state.queries.find(({ sql }) => sql.includes("INSERT INTO audit_logs"));
    expect(audit?.transactional).toBe(true);
    expect(audit?.values).toContain("SCHOOL_ASSET_CREATED");
    expect(state.queries.some(({ sql }) => sql === "COMMIT")).toBe(true);
  });

  it("rejects an unrelated or non-staff school member as an asset assignee", async () => {
    state.assigneeRole = "STUDENT";
    const response = await call("/operations/assets?schoolId=1", "POST", {
      name: "Printer",
      assignedToUserId: 88,
    });
    expect(response.status).toBe(404);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO school_assets"))).toBe(false);
    expect(state.queries.find(({ sql }) => sql.includes("JOIN school_memberships"))?.sql)
      .toContain("m.role IN ('SCHOOL_ADMIN', 'TEACHER', 'STAFF')");
  });

  it("allows staff only to report maintenance requests for their own school", async () => {
    state.role = "STAFF";
    const response = await call("/operations/maintenance-requests?schoolId=1", "POST", {
      title: "Leaking tap",
      description: "The sink tap is leaking.",
    });
    expect(response.status).toBe(201);
    const insert = state.queries.find(({ sql }) => sql.includes("INSERT INTO maintenance_requests"));
    expect(insert?.values.slice(0, 1)).toEqual([1]);
    expect(insert?.values[6]).toBe(12);
    expect(insert?.values[8]).toBe("HIGH");
  });

  it("honors the school's disabled staff maintenance-reporting setting", async () => {
    state.role = "STAFF";
    state.settingStaffReport = false;
    const response = await call("/operations/maintenance-requests?schoolId=1", "POST", {
      title: "Door latch",
      description: "The classroom door will not latch.",
    });
    expect(response.status).toBe(403);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO maintenance_requests"))).toBe(false);
  });

  it("records before/after state and assignment changes in the existing audit log", async () => {
    state.assetRow = { ...state.assetRow, assignedToUserId: 88 };
    const response = await call("/operations/assets/41?schoolId=1", "PATCH", {
      status: "LOST",
      assignedToUserId: null,
    });
    expect(response.status).toBe(200);
    const update = state.queries.find(({ sql }) => sql.includes("UPDATE school_assets"));
    expect(update?.values.slice(-2)).toEqual([41, 1]);
    expect(update?.sql).toContain("school_id = $");
    const audit = state.queries.find(({ sql }) => sql.includes("INSERT INTO audit_logs"));
    expect(audit?.values).toContain("SCHOOL_ASSET_UPDATED");
    expect(audit?.transactional).toBe(true);
    const historyEvents = state.queries.filter(({ sql }) => sql.includes("INSERT INTO school_asset_history"));
    expect(historyEvents.map(({ sql }) => sql.match(/'([A-Z_]+)'/)?.[1])).toEqual([
      "ASSIGNMENT_CHANGED",
      "STATUS_CHANGED",
    ]);
  });

  it("keeps asset history tenant-scoped and returns the asset event timeline", async () => {
    state.assetExists = false;
    const response = await call("/operations/assets/41/history?schoolId=1");
    expect(response.status).toBe(404);
    expect(state.queries.find(({ sql }) => sql.includes("SELECT 1 FROM school_assets"))?.values)
      .toEqual([41, 1]);
    expect(state.queries.some(({ sql }) => sql.includes("FROM school_asset_history"))).toBe(false);

    state.queries.length = 0;
    state.assetExists = true;
    state.assetHistoryRows = [{
      id: 2, schoolId: 1, assetId: 41, eventType: "QUANTITY_CHANGED",
      quantityBefore: 2, quantityAfter: 7,
    }];
    const history = await call("/operations/assets/41/history?schoolId=1");
    expect(history.status).toBe(200);
    expect(await history.json()).toEqual(state.assetHistoryRows);
    const historyQuery = state.queries.find(({ sql }) => sql.includes("FROM school_asset_history"));
    expect(historyQuery?.values).toEqual([1, 41]);
    expect(historyQuery?.sql).toContain("ORDER BY event_at, id");
  });

  it("records stock quantity changes in append-only asset history", async () => {
    const response = await call("/operations/assets/41?schoolId=1", "PATCH", { quantity: 7 });
    expect(response.status).toBe(200);
    const stockHistory = state.queries.find(({ sql }) =>
      sql.includes("INSERT INTO school_asset_history") && sql.includes("'QUANTITY_CHANGED'"),
    );
    expect(stockHistory?.values).toEqual([1, 41, 2, 7, 12]);
    expect(stockHistory?.transactional).toBe(true);
  });

  it("rejects illegal maintenance transitions and ASSIGNED without a responsible staff member", async () => {
    const invalid = await call("/operations/maintenance-requests/53?schoolId=1", "PATCH", {
      status: "COMPLETED",
    });
    expect(invalid.status).toBe(409);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE maintenance_requests"))).toBe(false);

    state.maintenanceRow = { ...state.maintenanceRow, assignedToUserId: null, status: "OPEN" };
    const unassigned = await call("/operations/maintenance-requests/53?schoolId=1", "PATCH", {
      status: "ASSIGNED",
    });
    expect(unassigned.status).toBe(400);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE maintenance_requests"))).toBe(false);
  });

  it("creates assigned work in ASSIGNED status and writes initial status history transactionally", async () => {
    const taskResponse = await call("/operations/tasks?schoolId=1", "POST", {
      title: "Set up the hall",
      assignedToUserId: 88,
    });
    expect(taskResponse.status).toBe(201);
    const taskInsert = state.queries.find(({ sql }) => sql.includes("INSERT INTO operational_tasks"));
    expect(taskInsert?.values[7]).toBe("ASSIGNED");
    const taskHistory = state.queries.find(({ sql }) => sql.includes("INSERT INTO operational_task_status_history"));
    expect(taskHistory?.values).toEqual([1, 61, null, "ASSIGNED", 12]);
    expect(taskHistory?.transactional).toBe(true);

    const maintenanceResponse = await call("/operations/maintenance-requests?schoolId=1", "POST", {
      title: "Repair projector",
      description: "The projector is not powering on.",
      assignedToUserId: 88,
    });
    expect(maintenanceResponse.status).toBe(201);
    const maintenanceInsert = state.queries.find(({ sql }) => sql.includes("INSERT INTO maintenance_requests"));
    expect(maintenanceInsert?.values[9]).toBe("ASSIGNED");
    const maintenanceHistory = state.queries.find(({ sql }) =>
      sql.includes("INSERT INTO maintenance_request_status_history"),
    );
    expect(maintenanceHistory?.values).toEqual([1, 53, null, "ASSIGNED", 12]);
    expect(maintenanceHistory?.transactional).toBe(true);
  });

  it("retains completion timestamp and records each maintenance status transition", async () => {
    state.maintenanceRow = {
      ...state.maintenanceRow,
      assignedToUserId: 88,
      status: "IN_PROGRESS",
      completedAt: null,
    };
    const complete = await call("/operations/maintenance-requests/53?schoolId=1", "PATCH", {
      status: "COMPLETED",
    });
    expect(complete.status).toBe(200);
    const completionUpdate = state.queries.find(({ sql }) => sql.includes("UPDATE maintenance_requests"));
    expect(completionUpdate?.sql).toContain("ELSE completed_at END");
    const completionHistory = state.queries.find(({ sql }) =>
      sql.includes("INSERT INTO maintenance_request_status_history"),
    );
    expect(completionHistory?.values).toEqual([1, 53, "IN_PROGRESS", "COMPLETED", 12]);

    state.maintenanceRow = { ...state.maintenanceRow, status: "COMPLETED", completedAt: "first-completion" };
    const reopen = await call("/operations/maintenance-requests/53?schoolId=1", "PATCH", {
      status: "IN_PROGRESS",
    });
    expect(reopen.status).toBe(200);
    const reopenHistory = state.queries.filter(({ sql }) =>
      sql.includes("INSERT INTO maintenance_request_status_history"),
    ).at(-1);
    expect(reopenHistory?.values).toEqual([1, 53, "COMPLETED", "IN_PROGRESS", 12]);
    expect(state.queries.find(({ sql }) => sql.includes("UPDATE maintenance_requests"))?.sql)
      .toContain("ELSE completed_at END");
  });

  it("allows assigned staff only the narrow task workflow transition", async () => {
    state.role = "STAFF";
    state.taskRow = { ...state.taskRow, assignedToUserId: 12, status: "ASSIGNED" };
    const response = await call("/operations/tasks/61?schoolId=1", "PATCH", { status: "IN_PROGRESS" });
    expect(response.status).toBe(200);
    const history = state.queries.find(({ sql }) => sql.includes("INSERT INTO operational_task_status_history"));
    expect(history?.values).toEqual([1, 61, "ASSIGNED", "IN_PROGRESS", 12]);
    expect(history?.transactional).toBe(true);
  });

  it("lets Staff read and advance only maintenance requests assigned to them", async () => {
    state.role = "STAFF";
    state.maintenanceRow = { ...state.maintenanceRow, assignedToUserId: 12, status: "ASSIGNED" };
    const list = await call("/operations/maintenance-requests?schoolId=1");
    expect(list.status).toBe(200);
    const readQuery = state.queries.find(({ sql }) => sql.includes("FROM maintenance_requests") && !sql.includes("FOR UPDATE"));
    expect(readQuery?.sql).toContain("assigned_to_user_id = $3");
    expect(readQuery?.values).toEqual([1, false, 12, null]);

    const transition = await call("/operations/maintenance-requests/53?schoolId=1", "PATCH", {
      status: "IN_PROGRESS",
    });
    expect(transition.status).toBe(200);
    expect(state.queries.find(({ sql }) => sql.includes("INSERT INTO maintenance_request_status_history"))?.values)
      .toEqual([1, 53, "ASSIGNED", "IN_PROGRESS", 12]);
  });

  it("denies staff task access outside their assignment and denies administrative field edits", async () => {
    state.role = "STAFF";
    state.taskRow = { ...state.taskRow, assignedToUserId: 77, status: "ASSIGNED" };
    const unrelated = await call("/operations/tasks/61?schoolId=1", "PATCH", { status: "IN_PROGRESS" });
    expect(unrelated.status).toBe(404);
    state.taskRow = { ...state.taskRow, assignedToUserId: 12, status: "ASSIGNED" };
    const edit = await call("/operations/tasks/61?schoolId=1", "PATCH", { notes: "not a staff edit" });
    expect(edit.status).toBe(403);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE operational_tasks"))).toBe(false);
  });

  it("uses school-filtered aggregates for operational reports", async () => {
    const response = await call("/operations/reports?schoolId=1");
    expect(response.status).toBe(200);
    const report = state.queries.find(({ sql }) => sql.includes("FROM operational_tasks"));
    expect(report?.values).toEqual([1]);
  });
});