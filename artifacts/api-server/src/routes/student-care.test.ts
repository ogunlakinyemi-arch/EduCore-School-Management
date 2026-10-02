import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  grantedPermissions: new Map<number, string[]>(),
  linkedChildren: new Set<number>([11]),
  studentMappings: new Map<number, number>([[50, 11]]),
  teacherAssigned: false,
  profile: {
    id: 91, schoolId: 1, studentId: 11, bloodGroup: "O+", genotype: "AA",
    allergies: ["pollen"], conditions: ["asthma"], supportNeeds: [], medications: [],
    emergencyMedicalNotes: "confidential emergency detail", providerContacts: [],
    emergencyContacts: [], version: 1, updatedAt: "2025-01-01T00:00:00.000Z", archivedAt: null,
  } as Record<string, unknown>,
  medicalVisits: [] as Array<Record<string, any>>,
  nextMedicalVisitId: 501,
  welfareRecords: [] as Array<Record<string, any>>,
  nextWelfareRecordId: 601,
  behaviour: [] as Array<Record<string, any>>,
  idempotency: new Map<string, { requestHash: string; snapshot: Record<string, unknown> }>(),
  history: new Map<string, Record<string, unknown>>(),
  nextBehaviourId: 300,
}));

const parentEventMock = vi.hoisted(() => ({
  emit: vi.fn(async (..._args: any[]) => []),
}));

const poolMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    const normalized = sql.toLowerCase();
    if (normalized.includes("insert into audit_logs")) return result();
    if (normalized.includes("from students st") && normalized.includes("where st.id=$1 and st.school_id=$2")) {
      return result(Number(values[0]) === 11 && Number(values[1]) === 1 ? [{ "?column?": 1 }] : []);
    }
    if (normalized.includes("from students st") && normalized.includes("join school_memberships sm") && normalized.includes("st.user_id=$1")) {
      const studentId = state.studentMappings.get(Number(values[0]));
      return result(studentId && (values[1] as number[]).includes(1)
        ? [{ studentId, schoolId: 1 }]
        : []);
    }
    if (normalized.includes("from student_care_grants g")) {
      const granted = state.grantedPermissions.get(Number(values[0])) ?? [];
      return result(granted.includes(String(values[2])) ? [{ "?column?": 1 }] : []);
    }
    if (normalized.includes("from student_medical_profiles")) {
      return result(Number(values[0]) === 1 && Number(values[1]) === 11 ? [state.profile] : []);
    }
    if (normalized.includes("from student_medical_visits")) {
      const row = state.medicalVisits.find((visit) =>
        Number(visit.id) === Number(values[0]) && Number(visit.schoolId) === Number(values[1]) &&
        Number(visit.studentId) === Number(values[2]));
      return result(row ? [row] : []);
    }
    if (normalized.includes("from employees e") && normalized.includes("teacher_class_assignments")) {
      return result(state.teacherAssigned ? [{ "?column?": 1 }] : []);
    }
    if (normalized.includes("from parents p") && normalized.includes("parent_student_relationships")) {
      return result(state.linkedChildren.has(Number(values[1]))
        ? [{ studentId: Number(values[1]), schoolId: 1 }]
        : []);
    }
    if (normalized.includes("from student_welfare_records") && normalized.includes("parent_visible=true")) {
      return result([{
        id: 10, category: "FAMILY_SUPPORT", concern: "Parent-visible support summary",
        status: "IN_PROGRESS", updatedAt: new Date("2025-01-02T00:00:00.000Z"),
        internalNotes: "confidential welfare note",
      }]);
    }
    if (normalized.includes("from student_welfare_records") && normalized.includes("where id=$1")) {
      const row = state.welfareRecords.find((record) =>
        Number(record.id) === Number(values[0]) && Number(record.schoolId) === Number(values[1]) &&
        Number(record.studentId) === Number(values[2]));
      if (row) return result([row]);
      if (Number(values[0]) === 14) return result([{ category: "SAFEGUARDING" }]);
      return result([]);
    }
    if (normalized.includes("from student_welfare_records")) return result([{ category: "SAFEGUARDING" }]);
    if (normalized.includes("from student_behaviour_records") && normalized.includes("parent_visible=true")) {
      expect(normalized).toContain("archived_at is null");
      return result([{
        id: 20, category: "RECOGNITION", description: "Positive participation",
        status: "RESOLVED", occurredAt: new Date("2025-01-03T00:00:00.000Z"),
        internalNotes: "confidential behaviour note",
      }]);
    }
    if (normalized.includes("from student_behaviour_records")) {
      if (Number(values[0]) !== 1 || Number(values[1]) !== 11 || values[2] !== false) return result([]);
      return result(Number(values[0]) === 1 && Number(values[1]) === 11
        ? [{
            id: 30, schoolId: 1, studentId: 11, occurredAt: new Date("2025-01-04T00:00:00.000Z"),
            schoolClassId: null, subjectId: null, category: "INCIDENT", severity: "LOW",
            description: "Staff-visible behaviour report", location: null, reporterUserId: 12,
            action: null, parentNotificationStatus: "NOT_REQUESTED", followUpAt: null,
            followUpNotes: null, status: "REVIEW", resolution: null,
            internalNotes: "staff-only notes", parentVisible: false, version: 1,
            createdAt: new Date("2025-01-04T00:00:00.000Z"),
            updatedAt: new Date("2025-01-04T00:00:00.000Z"), archivedAt: null,
          }]
        : []);
    }
    if (normalized.includes("from student_behaviour_configurations")) {
      return result([{
        categories: ["POSITIVE", "CONCERN", "INCIDENT", "RULE_VIOLATION", "RECOGNITION"],
        actions: ["Verbal warning", "Written warning"],
      }]);
    }
    throw new Error(`Unhandled student-care pool query: ${sql}`);
  });

  const clientQuery = vi.fn(async (sql: string, values: any[] = []) => {
    const normalized = sql.toLowerCase();
    if (["begin", "commit", "rollback"].includes(normalized)) return result();
    if (normalized.includes("pg_advisory_xact_lock")) return result();
    if (normalized.includes("select") && normalized.includes("from student_medical_profiles")) {
      return result([structuredClone(state.profile)]);
    }
    if (normalized.includes("select") && normalized.includes("from student_medical_visits")) {
      const row = state.medicalVisits.find((visit) =>
        Number(visit.id) === Number(values[0]) && Number(visit.schoolId) === Number(values[1]) &&
        Number(visit.studentId) === Number(values[2]));
      return result(row ? [structuredClone(row)] : []);
    }
    if (normalized.startsWith("insert into student_medical_visits")) {
      const row = {
        id: state.nextMedicalVisitId++, schoolId: Number(values[0]), studentId: Number(values[1]),
        occurredAt: values[2], reason: values[3], symptoms: values[4] ?? null,
        observations: values[5] ?? null, actionTaken: values[6] ?? null,
        treatment: values[7] ?? null, referral: values[8] ?? null,
        followUpAt: values[9] ?? null, followUpNotes: values[10] ?? null,
        notes: values[11] ?? null, recordedByUserId: Number(values[12]), version: 1,
        createdAt: new Date("2025-01-04T00:00:00.000Z"),
        updatedAt: new Date("2025-01-04T00:00:00.000Z"), archivedAt: null,
      };
      state.medicalVisits.push(row);
      return result([structuredClone(row)]);
    }
    if (normalized.startsWith("update student_medical_visits set")) {
      const row = state.medicalVisits.find((visit) =>
        Number(visit.id) === Number(values[0]) && Number(visit.schoolId) === Number(values[1]) &&
        Number(visit.studentId) === Number(values[2]));
      if (!row || Number(row.version) !== Number(values[values.length - 1])) return result();
      const columns: Record<string, string> = {
        occurred_at: "occurredAt", reason: "reason", symptoms: "symptoms", observations: "observations",
        action_taken: "actionTaken", treatment: "treatment", referral: "referral",
        follow_up_at: "followUpAt", follow_up_notes: "followUpNotes", notes: "notes",
      };
      const assignments = normalized.split(" set ")[1]?.split(" where ")[0] ?? "";
      for (const match of assignments.matchAll(/([a-z_]+)=\$(\d+)/g)) {
        const property = columns[match[1]];
        if (property) row[property] = values[Number(match[2]) - 1] ?? null;
      }
      row.version = Number(row.version) + 1;
      row.updatedAt = new Date("2025-01-05T00:00:00.000Z");
      return result([structuredClone(row)]);
    }
    if (normalized.includes("select") && normalized.includes("from student_welfare_records")) {
      const row = state.welfareRecords.find((record) =>
        Number(record.id) === Number(values[0]) && Number(record.schoolId) === Number(values[1]) &&
        Number(record.studentId) === Number(values[2]));
      return result(row ? [structuredClone(row)] : []);
    }
    if (normalized.startsWith("insert into student_welfare_records")) {
      const row = {
        id: state.nextWelfareRecordId++, schoolId: Number(values[0]), studentId: Number(values[1]),
        category: values[2], concern: values[3], assignedStaffUserId: values[4] ?? null,
        followUpAt: values[5] ?? null, followUpStatus: values[6], status: values[7],
        resolution: values[8] ?? null, internalNotes: values[9] ?? null,
        parentVisible: values[10], createdByUserId: Number(values[11]), version: 1,
        createdAt: new Date("2025-01-04T00:00:00.000Z"),
        updatedAt: new Date("2025-01-04T00:00:00.000Z"), archivedAt: null,
      };
      state.welfareRecords.push(row);
      return result([structuredClone(row)]);
    }
    if (normalized.startsWith("update student_welfare_records set")) {
      const row = state.welfareRecords.find((record) =>
        Number(record.id) === Number(values[0]) && Number(record.schoolId) === Number(values[1]) &&
        Number(record.studentId) === Number(values[2]));
      if (!row || Number(row.version) !== Number(values[values.length - 1])) return result();
      const columns: Record<string, string> = {
        category: "category", concern: "concern", assigned_staff_user_id: "assignedStaffUserId",
        follow_up_at: "followUpAt", follow_up_status: "followUpStatus", status: "status",
        resolution: "resolution", internal_notes: "internalNotes", parent_visible: "parentVisible",
      };
      const assignments = normalized.split(" set ")[1]?.split(" where ")[0] ?? "";
      for (const match of assignments.matchAll(/([a-z_]+)=\$(\d+)/g)) {
        const property = columns[match[1]];
        if (property) row[property] = values[Number(match[2]) - 1] ?? null;
      }
      row.version = Number(row.version) + 1;
      row.updatedAt = new Date("2025-01-05T00:00:00.000Z");
      return result([structuredClone(row)]);
    }
    if (normalized.includes("update student_medical_profiles set archived_at=now()")) {
      if (Number(values[2]) !== Number(state.profile.version) || state.profile.archivedAt) return result();
      state.profile = {
        ...state.profile,
        archivedAt: new Date("2025-01-05T00:00:00.000Z"),
        updatedAt: new Date("2025-01-05T00:00:00.000Z"),
        version: Number(state.profile.version) + 1,
      };
      return result([structuredClone(state.profile)]);
    }
    if (normalized.includes("update student_medical_profiles set blood_group=")) {
      if (Number(values[12]) !== Number(state.profile.version)) return result();
      const json = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;
      state.profile = {
        ...state.profile,
        bloodGroup: values[2],
        genotype: values[3],
        allergies: json(values[4]),
        conditions: json(values[5]),
        supportNeeds: json(values[6]),
        medications: json(values[7]),
        emergencyMedicalNotes: values[8],
        providerContacts: json(values[9]),
        emergencyContacts: json(values[10]),
        archivedAt: null,
        updatedAt: new Date("2025-01-06T00:00:00.000Z"),
        version: Number(state.profile.version) + 1,
      };
      return result([structuredClone(state.profile)]);
    }
    if (normalized.includes("from student_care_idempotency i")) {
      const key = `${values[0]}:${values[1]}:${values[2]}:${values[3]}:${values[4]}`;
      const prior = state.idempotency.get(key);
      return result(prior ? [{ requestHash: prior.requestHash, snapshot: prior.snapshot }] : []);
    }
    if (normalized.includes("insert into student_behaviour_records")) {
      const row = {
        id: state.nextBehaviourId++, schoolId: Number(values[0]), studentId: Number(values[1]),
        occurredAt: values[2] ?? new Date("2025-01-04T00:00:00.000Z"),
        schoolClassId: values[3] ?? null, subjectId: values[4] ?? null,
        category: values[5], severity: values[6], description: values[7], location: values[8] ?? null,
        reporterUserId: Number(values[9]), action: values[10] ?? null,
        parentNotificationStatus: "NOT_REQUESTED", followUpAt: values[11] ?? null,
        followUpNotes: values[12] ?? null, status: "REVIEW",
        resolution: values[13] ?? null, internalNotes: values[14] ?? null,
        parentVisible: values[15] ?? false, version: 1,
        createdAt: new Date("2025-01-04T00:00:00.000Z"),
        updatedAt: new Date("2025-01-04T00:00:00.000Z"), archivedAt: null,
      };
      state.behaviour.push(row);
      return result([row]);
    }
    if (normalized.includes("insert into student_care_record_history")) {
      const historyKey = `${values[2]}:${values[3]}:${values[4]}`;
      const snapshot = typeof values[6] === "string" ? JSON.parse(values[6]) : values[6];
      state.history.set(historyKey, snapshot);
      return result();
    }
    if (normalized.includes("insert into student_care_idempotency")) {
      const actorId = Number(values[7]);
      const key = `${values[0]}:${values[1]}:${values[3]}:${values[2]}:${actorId}`;
      const revisionKey = `${values[3]}:${values[5]}:${values[6]}`;
      state.idempotency.set(key, {
        requestHash: String(values[4]),
        snapshot: state.history.get(revisionKey)!,
      });
      return result();
    }
    if (normalized.includes("insert into audit_logs")) return result();
    throw new Error(`Unhandled student-care transaction query: ${sql}`);
  });

  const client = {
    query: clientQuery,
    release: vi.fn(),
  };
  return { query, connect: vi.fn(async () => client), clientQuery, client };
});

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../services/communication-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/communication-service")>();
  return { ...actual, emitDomainParentEvent: parentEventMock.emit };
});
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const roleSpecs = String(req.header("x-test-role") ?? "SCHOOL_ADMIN:1").split(",");
      const roles = roleSpecs.map((spec, index) => {
        const [role, school] = spec.split(":");
        return {
          id: index + 1,
          role,
          schoolId: role === "PLATFORM_OWNER" ? null : Number(school ?? 1),
          status: "ACTIVE",
        };
      });
      const id = Number(req.header("x-test-user-id") ?? 10);
      (req as any).edupulseUser = {
        user: {
          id, clerkUserId: `care-test-${id}`, email: `user-${id}@example.test`,
          firstName: "Care", lastName: "Tester", phone: null, status: "ACTIVE",
        },
        roles,
      };
      next();
    },
  };
});

import studentCareRouter from "./student-care";
import {
  behaviourLifecycle,
  nextBehaviourStatus,
  parentBehaviourNotification,
  projectStudentMedicalInfo,
  resolveParentNotificationStatus,
  stableRequestHash,
} from "../services/student-care-service";
import { AuthError } from "../middlewares/auth";

const app = express();
app.use(express.json());
app.use(studentCareRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof AuthError) return res.status(error.statusCode).json({ error: error.message, code: error.eventType });
  return res.status(500).json({ error: String(error) });
});

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
  server.close((error) => error ? reject(error) : resolve()),
));
beforeEach(() => {
  state.grantedPermissions.clear();
  state.linkedChildren = new Set([11]);
  state.studentMappings = new Map([[50, 11]]);
  state.profile = {
    id: 91, schoolId: 1, studentId: 11, bloodGroup: "O+", genotype: "AA",
    allergies: ["pollen"], conditions: ["asthma"], supportNeeds: [], medications: [],
    emergencyMedicalNotes: "confidential emergency detail", providerContacts: [],
    emergencyContacts: [], version: 1, updatedAt: "2025-01-01T00:00:00.000Z", archivedAt: null,
  };
  state.medicalVisits = [];
  state.nextMedicalVisitId = 501;
  state.welfareRecords = [];
  state.nextWelfareRecordId = 601;
  state.teacherAssigned = false;
  state.behaviour = [];
  state.idempotency.clear();
  state.history.clear();
  state.nextBehaviourId = 300;
  poolMock.query.mockClear();
  poolMock.clientQuery.mockClear();
  parentEventMock.emit.mockClear();
});

async function call(
  path: string,
  role: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    id?: number;
    idempotencyKey?: string;
    ifMatchVersion?: number;
  } = {},
) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-test-role": role,
      "x-test-user-id": String(options.id ?? 10),
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      ...(options.ifMatchVersion ? { "If-Match-Version": String(options.ifMatchVersion) } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

describe("student medical, welfare, and behaviour boundaries", () => {
  it("does not allow ordinary teachers to read medical profiles without an explicit grant", async () => {
    const response = await call("/schools/1/students/11/medical-profile", "TEACHER:1", { id: 21 });
    expect(response.status).toBe(403);
    expect(poolMock.query.mock.calls.some(([sql]) => String(sql).includes("student_medical_profiles"))).toBe(false);
  });

  it("allows an explicitly granted school staff member while isolating cross-school records", async () => {
    state.grantedPermissions.set(21, ["MEDICAL_READ"]);
    const allowed = await call("/schools/1/students/11/medical-profile", "STAFF:1", { id: 21 });
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as Record<string, unknown>).genotype).toBe("AA");
    const crossSchool = await call("/schools/2/students/11/medical-profile", "STAFF:1", { id: 21 });
    expect(crossSchool.status).toBe(404);
  });

  it("returns archived medical profiles and restores them with the archived version while retaining revisions", async () => {
    const path = "/schools/1/students/11/medical-profile";
    const archived = await call(path, "SCHOOL_ADMIN:1", {
      method: "DELETE",
      ifMatchVersion: 1,
    });
    expect(archived.status).toBe(200);
    expect((await archived.json() as Record<string, unknown>)).toMatchObject({ version: 2 });
    const archivedRead = await call(path, "SCHOOL_ADMIN:1");
    expect(archivedRead.status).toBe(200);
    expect(await archivedRead.json()).toMatchObject({ version: 2, archivedAt: expect.any(String) });

    const restored = await call(path, "SCHOOL_ADMIN:1", {
      method: "PUT",
      idempotencyKey: "profile-restore-001",
      body: {
        expectedVersion: 2,
        bloodGroup: "O+",
        genotype: "AA",
        allergies: ["pollen"],
        conditions: ["asthma"],
        supportNeeds: [],
        medications: [],
        emergencyMedicalNotes: "confidential emergency detail",
        providerContacts: [],
        emergencyContacts: [],
      },
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ version: 3, archivedAt: null, genotype: "AA" });
    expect(state.history.has("MEDICAL_PROFILE:91:2")).toBe(true);
    expect(state.history.has("MEDICAL_PROFILE:91:3")).toBe(true);
  });

  it("uses school-local behaviour grants and rejects a cross-school behaviour lookup", async () => {
    state.grantedPermissions.set(21, ["BEHAVIOUR_READ"]);
    const delegate = poolMock.query.getMockImplementation()!;
    poolMock.query.mockImplementation(async (sql: string, values: any[] = []) => {
      const normalized = sql.toLowerCase();
      if (normalized.includes("from student_behaviour_records b") &&
          Number(values[0]) === 1 && Number(values[1]) === 11 && values[2] === false) {
        return {
          rows: [{
            id: 30, schoolId: 1, studentId: 11, occurredAt: new Date("2025-01-04T00:00:00.000Z"),
            schoolClassId: null, subjectId: null, category: "INCIDENT", severity: "LOW",
            description: "Staff-visible behaviour report", location: null, reporterUserId: 12,
            action: null, parentNotificationStatus: "NOT_REQUESTED", followUpAt: null,
            followUpNotes: null, status: "REVIEW", resolution: null,
            internalNotes: "staff-only notes", parentVisible: false, version: 1,
            createdAt: new Date("2025-01-04T00:00:00.000Z"),
            updatedAt: new Date("2025-01-04T00:00:00.000Z"), archivedAt: null,
          }],
          rowCount: 1,
        };
      }
      return delegate(sql, values);
    });
    const allowed = await call("/schools/1/students/11/behaviour", "STAFF:1", { id: 21 });
    expect(allowed.status).toBe(200);
    const select = poolMock.query.mock.calls.find(([sql]) =>
      String(sql).toLowerCase().includes("from student_behaviour_records b"),
    );
    expect(select).toBeDefined();
    const [sql, parameters] = select as [string, unknown[]];
    expect(sql.toLowerCase()).toContain("b.school_id=$1");
    expect(sql.toLowerCase()).toContain("b.student_id=$2");
    expect(parameters).toEqual([1, 11, false, 21]);
    expect((await allowed.json() as Array<Record<string, unknown>>)).toHaveLength(1);
    const crossSchool = await call("/schools/2/students/11/behaviour", "SCHOOL_ADMIN:2");
    expect(crossSchool.status).toBe(404);
  });

  it("denies owner plus school-admin dual-role access to sensitive records", async () => {
    state.grantedPermissions.set(10, ["MEDICAL_READ", "MEDICAL_WRITE"]);
    const response = await call(
      "/schools/1/students/11/medical-profile",
      "PLATFORM_OWNER,SCHOOL_ADMIN:1",
    );
    expect(response.status).toBe(403);
  });

  it("limits parents to actively linked children and allowlisted parent-visible summaries", async () => {
    const blocked = await call("/parent/children/12/care-summary", "PARENT:1", { id: 44 });
    expect(blocked.status).toBe(404);
    const visible = await call("/parent/children/11/care-summary", "PARENT:1", { id: 44 });
    expect(visible.status).toBe(200);
    const body = await visible.json() as Record<string, any>;
    expect(body.welfare[0]).toEqual({
      id: 10,
      category: "FAMILY_SUPPORT",
      concern: "Parent-visible support summary",
      status: "IN_PROGRESS",
      updatedAt: "2025-01-02T00:00:00.000Z",
    });
    expect(body.behaviour[0]).toEqual({
      id: 20,
      category: "RECOGNITION",
      description: "Positive participation",
      status: "RESOLVED",
      occurredAt: "2025-01-03T00:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toMatch(/internalNotes|safeguarding|diagnos|confidential/i);
    const queries = poolMock.query.mock.calls.map(([sql]) => String(sql).toLowerCase()).join("\n");
    expect(queries).toContain("category <> 'safeguarding'");
    expect(queries).toContain("parent_visible=true");
  });

  it("allows only a verified active student's own mapped self-summary", async () => {
    const own = await call("/student/care-summary", "STUDENT:1", { id: 50 });
    expect(own.status).toBe(200);
    const body = await own.json() as Record<string, any>;
    expect(body.studentId).toBe(11);
    expect(JSON.stringify(body)).not.toMatch(/internalNotes|safeguarding|diagnos|medical/i);
    expect(poolMock.query.mock.calls.map(([sql]) => String(sql).toLowerCase()).join("\n"))
      .not.toContain("student_behaviour_configurations");

    const unlinked = await call("/student/care-summary", "STUDENT:1", { id: 51 });
    expect(unlinked.status).toBe(404);
    const nonStudent = await call("/student/care-summary", "TEACHER:1", { id: 50 });
    expect(nonStudent.status).toBe(403);
  });

  it("emits a generic in-app parent event inside the medical-visit create transaction", async () => {
    const path = "/schools/1/students/11/medical-visits";
    const body = {
      occurredAt: "2025-01-04T10:00:00.000Z",
      reason: "Private diagnosis detail",
      symptoms: "Confidential symptoms",
      notes: "Staff-only clinical notes",
    };
    const response = await call(path, "SCHOOL_ADMIN:1", {
      method: "POST",
      idempotencyKey: "medical-visit-parent-event-001",
      body,
    });
    const replay = await call(path, "SCHOOL_ADMIN:1", {
      method: "POST",
      idempotencyKey: "medical-visit-parent-event-001",
      body,
    });

    expect(response.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(await response.json());
    expect(parentEventMock.emit).toHaveBeenCalledTimes(1);
    const [client, event] = parentEventMock.emit.mock.calls[0] as unknown as [
      typeof poolMock.client,
      Record<string, unknown>,
    ];
    expect(client).toBe(poolMock.client);
    expect(event).toMatchObject({
      schoolId: 1,
      studentId: 11,
      eventType: "STUDENT_MEDICAL_VISIT_RECORDED",
      eventId: "501:1",
      category: "SYSTEM",
      privacy: "GENERIC",
      channels: ["IN_APP"],
    });
    expect(JSON.stringify(event)).not.toMatch(/diagnosis|symptom|staff-only|reason|treatment|notes/i);
  });

  it("does not notify for staff-note-only medical edits but does notify for clinical changes", async () => {
    state.medicalVisits = [{
      id: 502, schoolId: 1, studentId: 11, occurredAt: "2025-01-04T10:00:00.000Z",
      reason: "Original private reason", symptoms: null, observations: null,
      actionTaken: null, treatment: null, referral: null, followUpAt: null,
      followUpNotes: null, notes: "Initial private note", recordedByUserId: 10,
      version: 1, createdAt: new Date("2025-01-04T00:00:00.000Z"),
      updatedAt: new Date("2025-01-04T00:00:00.000Z"), archivedAt: null,
    }];
    const path = "/schools/1/students/11/medical-visits/502";
    const noteEdit = await call(path, "SCHOOL_ADMIN:1", {
      method: "PATCH",
      body: {
        expectedVersion: 1,
        occurredAt: "2025-01-04T10:00:00.000Z",
        reason: "Original private reason",
        notes: "Updated private note",
      },
    });
    expect(noteEdit.status).toBe(200);
    expect(parentEventMock.emit).not.toHaveBeenCalled();

    const clinicalEdit = await call(path, "SCHOOL_ADMIN:1", {
      method: "PATCH",
      body: {
        expectedVersion: 2,
        occurredAt: "2025-01-04T10:00:00.000Z",
        reason: "Updated private reason",
        notes: "Still private",
      },
    });
    expect(clinicalEdit.status).toBe(200);
    expect(parentEventMock.emit).toHaveBeenCalledTimes(1);
    const event = parentEventMock.emit.mock.calls[0]?.[1] as unknown as Record<string, unknown>;
    expect(event).toMatchObject({
      eventType: "STUDENT_MEDICAL_VISIT_UPDATED",
      eventId: "502:3",
      category: "SYSTEM",
      privacy: "GENERIC",
      channels: ["IN_APP"],
    });
    expect(JSON.stringify(event)).not.toMatch(/updated private reason|still private/i);
  });

  it("only emits welfare parent events for explicitly shared, non-safeguarding summaries", async () => {
    const privateRecord = await call("/schools/1/students/11/welfare", "SCHOOL_ADMIN:1", {
      method: "POST",
      idempotencyKey: "welfare-private-parent-event-001",
      body: {
        category: "FAMILY_SUPPORT",
        concern: "Private family concern",
        internalNotes: "Confidential case notes",
        parentVisible: false,
      },
    });
    expect(privateRecord.status).toBe(201);
    expect(parentEventMock.emit).not.toHaveBeenCalled();

    const sharedRecord = await call("/schools/1/students/11/welfare", "SCHOOL_ADMIN:1", {
      method: "POST",
      idempotencyKey: "welfare-shared-parent-event-001",
      body: {
        category: "FAMILY_SUPPORT",
        concern: "Private concern text must not be forwarded",
        resolution: "Private resolution",
        internalNotes: "Staff-only notes",
        parentVisible: true,
      },
    });
    expect(sharedRecord.status).toBe(201);
    expect(parentEventMock.emit).toHaveBeenCalledTimes(1);
    const [client, event] = parentEventMock.emit.mock.calls[0] as unknown as [
      typeof poolMock.client,
      Record<string, unknown>,
    ];
    expect(client).toBe(poolMock.client);
    expect(event).toMatchObject({
      schoolId: 1,
      studentId: 11,
      eventType: "STUDENT_WELFARE_SUMMARY_CREATED",
      eventId: "602:1",
      category: "SYSTEM",
      privacy: "GENERIC",
      channels: ["IN_APP"],
    });
    expect(JSON.stringify(event)).not.toMatch(/concern text|resolution|staff-only|safeguarding/i);

    const safeguardingRecord = await call("/schools/1/students/11/welfare", "SCHOOL_ADMIN:1", {
      method: "POST",
      idempotencyKey: "welfare-safeguarding-parent-event-001",
      body: {
        category: "SAFEGUARDING",
        concern: "Restricted safeguarding details",
        internalNotes: "Restricted staff notes",
        parentVisible: true,
      },
    });
    expect(safeguardingRecord.status).toBe(400);
    expect(parentEventMock.emit).toHaveBeenCalledTimes(1);
  });

  it("does not notify on private welfare edits, but notifies when a shared summary changes", async () => {
    state.welfareRecords = [{
      id: 610, schoolId: 1, studentId: 11, category: "FAMILY_SUPPORT",
      concern: "Shared summary", assignedStaffUserId: null, followUpAt: null,
      followUpStatus: "NOT_REQUIRED", status: "OPEN", resolution: null,
      internalNotes: "Initial private note", parentVisible: true, createdByUserId: 10,
      version: 1, createdAt: new Date("2025-01-04T00:00:00.000Z"),
      updatedAt: new Date("2025-01-04T00:00:00.000Z"), archivedAt: null,
    }];
    const path = "/schools/1/students/11/welfare/610";

    const privateEdit = await call(path, "SCHOOL_ADMIN:1", {
      method: "PATCH",
      body: {
        expectedVersion: 1,
        category: "FAMILY_SUPPORT",
        concern: "Shared summary",
        internalNotes: "Changed private note",
      },
    });
    expect(privateEdit.status).toBe(200);
    expect(parentEventMock.emit).not.toHaveBeenCalled();

    const sharedEdit = await call(path, "SCHOOL_ADMIN:1", {
      method: "PATCH",
      body: {
        expectedVersion: 2,
        category: "FAMILY_SUPPORT",
        concern: "Updated shared summary",
        internalNotes: "Still private",
      },
    });
    expect(sharedEdit.status).toBe(200);
    expect(parentEventMock.emit).toHaveBeenCalledTimes(1);
    const event = parentEventMock.emit.mock.calls[0]?.[1] as unknown as Record<string, unknown>;
    expect(event).toMatchObject({
      eventType: "STUDENT_WELFARE_SUMMARY_UPDATED",
      eventId: "610:3",
      privacy: "GENERIC",
      category: "SYSTEM",
      channels: ["IN_APP"],
    });
    expect(JSON.stringify(event)).not.toMatch(/updated shared summary|still private|internal/i);
  });

  it("does not let a read-only safeguarding grant update a confidential record", async () => {
    state.grantedPermissions.set(21, ["SAFEGUARDING_READ"]);
    const response = await call("/schools/1/students/11/welfare/14", "STAFF:1", {
      method: "PATCH",
      id: 21,
      body: {
        category: "SAFEGUARDING",
        concern: "Update attempt",
        expectedVersion: 1,
        internalNotes: "attempted write",
      },
    });
    expect(response.status).toBe(403);
  });

  it("denies an assigned-teacher role outside an actual class/subject assignment", async () => {
    const response = await call("/schools/1/students/11/behaviour", "TEACHER:1", { id: 21 });
    expect(response.status).toBe(403);
  });

  it("uses request keys to replay a behaviour create exactly once", async () => {
    const payload = {
      category: "INCIDENT",
      severity: "MODERATE",
      description: "A retry-safe report",
    };
    const path = "/schools/1/students/11/behaviour";
    const first = await call(path, "SCHOOL_ADMIN:1", {
      method: "POST", body: payload, idempotencyKey: "incident-retry-0001",
    });
    const second = await call(path, "SCHOOL_ADMIN:1", {
      method: "POST", body: payload, idempotencyKey: "incident-retry-0001",
    });
    const conflictingReplay = await call(path, "SCHOOL_ADMIN:1", {
      method: "POST",
      body: { ...payload, description: "Different content under the same key" },
      idempotencyKey: "incident-retry-0001",
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await first.json()).toEqual(await second.json());
    expect(conflictingReplay.status).toBe(409);
    expect(state.behaviour).toHaveLength(1);
  });
});

describe("student-care contracts and workflow helpers", () => {
  it("requires every behaviour workflow stage in order", () => {
    for (let index = 0; index < behaviourLifecycle.length - 1; index += 1) {
      expect(nextBehaviourStatus(behaviourLifecycle[index], behaviourLifecycle[index + 1])).toBe(true);
      if (index + 2 < behaviourLifecycle.length) {
        expect(nextBehaviourStatus(behaviourLifecycle[index], behaviourLifecycle[index + 2])).toBe(false);
      }
    }
    expect(nextBehaviourStatus("REVIEW", "RESOLVED")).toBe(false);
    expect(nextBehaviourStatus("RESOLVED", "REVIEW")).toBe(false);
  });

  it("produces parent notification text without student or internal record content", () => {
    expect(parentBehaviourNotification.body).toBe(
      "A new school behaviour update is available in EduCore. Sign in to view the parent-visible update.",
    );
    expect(parentBehaviourNotification.body).not.toMatch(/student name|diagnosis|internal|safeguarding/i);
  });

  it("reports notification queue state truthfully without claiming an external send", () => {
    expect(resolveParentNotificationStatus(0, 0, 0)).toBe("NOT_CONFIGURED");
    expect(resolveParentNotificationStatus(1, 1, 0)).toBe("QUEUED");
    expect(resolveParentNotificationStatus(2, 1, 1)).toBe("PARTIAL");
    expect(resolveParentNotificationStatus(1, 0, 1)).toBe("FAILED");
    expect(["SENT", "DELIVERED"]).not.toContain(resolveParentNotificationStatus(1, 1, 0));
  });

  it("masks legacy medical_info unless a non-owner admin or explicit medical reader is authorized", () => {
    const row = { id: 11, firstName: "Student", medicalInfo: "legacy sensitive details" };
    expect(projectStudentMedicalInfo(row, {
      activeSchoolAdmin: false, hasMedicalReadGrant: false, platformOwner: false,
    })).not.toHaveProperty("medicalInfo");
    expect(projectStudentMedicalInfo(row, {
      activeSchoolAdmin: true, hasMedicalReadGrant: false, platformOwner: false,
    })).toHaveProperty("medicalInfo");
    expect(projectStudentMedicalInfo(row, {
      activeSchoolAdmin: true, hasMedicalReadGrant: true, platformOwner: true,
    })).not.toHaveProperty("medicalInfo");
  });

  it("hashes stable parsed request bodies for idempotent retry protection", () => {
    expect(stableRequestHash({ description: "same", category: "INCIDENT" }))
      .toBe(stableRequestHash({ description: "same", category: "INCIDENT" }));
    expect(stableRequestHash({ description: "different", category: "INCIDENT" }))
      .not.toBe(stableRequestHash({ description: "same", category: "INCIDENT" }));
  });
});