import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  partnerRole: "PARTNER_FINANCE",
  partnerIsOwner: false,
}));

const dbMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("FROM partner_profiles pp")) {
      return { rows: [{ isOwner: state.partnerIsOwner, partnerRole: state.partnerRole }] };
    }
    if (sql.includes('AS "schoolCount"')) {
      return { rows: [{ schoolCount: 2, studentCount: 17, activeSubscriptions: 3, subscriptionCount: 5 }] };
    }
    if (/\bAS total\b/i.test(sql)) {
      return { rows: [{ total: 2 }] };
    }
    if (sql.includes("FROM schools s") && sql.includes('AS "studentCount"')) {
      return {
        rows: [{
          schoolId: 7,
          schoolCode: "SCH-7",
          schoolName: "Example School",
          city: "Lagos",
          state: "Lagos",
          schoolStatus: "active",
          studentCount: 17,
          activeSubscriptions: 3,
          subscriptionCount: 5,
        }],
      };
    }
    if (sql.includes("FROM school_classes sc")) {
      return { rows: [{ classId: 8, className: "Year 1", section: "A", studentCount: 3, subjects: "Math", teachers: "Teacher A" }] };
    }
    if (sql.includes("Partner-attributed") || sql.includes("FROM school_partner_attributions")) {
      const row = {
          schoolId: 21,
          schoolName: "Referred School",
          schoolStatus: "active",
          studentCount: 17,
          commissionRecords: 4,
          commissionAmount: "450.00",
          payableCommission: "200.00",
          paidCommission: "150.00",
          heldRecords: 1,
          reversedRecords: 0,
          cancelledRecords: 0,
        };
      return {
        rows: [sql.includes("commission_ledger") ? row : {
          schoolId: row.schoolId,
          schoolName: row.schoolName,
          schoolStatus: row.schoolStatus,
          studentCount: row.studentCount,
        }],
      };
    }
    if (sql.includes("FROM students st")) {
      return {
        rows: [{
          studentId: 50,
          admissionNo: "S-50",
          firstName: "Ada",
          lastName: "Example",
          gender: "F",
          className: "Year 1",
          section: "A",
          status: "ACTIVE",
          admissionDate: "2026-01-10",
        }],
      };
    }
    throw new Error(`Unexpected organization report SQL: ${sql}`);
  }),
}));

vi.mock("@workspace/db", () => ({ pool: dbMock }));

import type { ReportContext, ReportFilters } from "./core";
import { organizationReports } from "./organization";

const baseFilters: ReportFilters = { limit: 20, offset: 10 };
const schoolAdmin: ReportContext = {
  req: {} as ReportContext["req"],
  userId: 100,
  role: "ADMIN",
  schoolId: 7,
};

beforeEach(() => {
  state.calls.length = 0;
  state.partnerRole = "PARTNER_FINANCE";
  state.partnerIsOwner = false;
  dbMock.query.mockClear();
});

describe("organization reports", () => {
  it("declares organization report access for school admins and platform owners", () => {
    expect(organizationReports.overview.roles).toEqual(["OWNER", "ADMIN"]);
    expect(organizationReports.students.roles).toEqual(["OWNER", "ADMIN"]);
    expect(organizationReports.parents.roles).toEqual(["OWNER", "ADMIN"]);
    expect(organizationReports.staff.roles).toEqual(["OWNER", "ADMIN"]);
    expect(organizationReports.classes.roles).toEqual(["OWNER", "ADMIN"]);
    expect(organizationReports.partners.roles).toEqual(["OWNER", "PARTNER"]);
  });

  it("returns scoped student directory fields and uses database pagination/count", async () => {
    const result = await organizationReports.students.run(
      schoolAdmin,
      { ...baseFilters, from: "2026-01-01", to: "2026-12-31" },
    );

    expect(result.total).toBe(2);
    expect(result.rows[0]).toMatchObject({ studentId: 50, admissionNo: "S-50", status: "ACTIVE" });
    expect(result.rows[0]).not.toHaveProperty("medicalInfo");
    expect(result.rows[0]).not.toHaveProperty("address");
    expect(state.calls).toHaveLength(2);
    expect(state.calls[0].sql).toContain("st.school_id = $1");
    expect(state.calls[0].values).toEqual([7, "2026-01-01", "2026-12-31"]);
    expect(state.calls[1].sql).toContain("LIMIT $4 OFFSET $5");
    expect(state.calls[1].values).toEqual([7, "2026-01-01", "2026-12-31", 20, 10]);
  });

  it("uses the selected school only for owner read-only overview comparison", async () => {
    const owner: ReportContext = {
      req: {} as ReportContext["req"],
      userId: 1,
      role: "OWNER",
      schoolId: null,
    };
    const result = await organizationReports.overview.run(owner, baseFilters);
    expect(result.title).toContain("Platform overview");
    expect(result.summary).toMatchObject({ schoolCount: 2, studentCount: 17 });
    expect(state.calls[0].sql).toContain("s.id IS NOT NULL");
    expect(state.calls[1].sql).toContain("WHERE s.id IS NOT NULL");

    state.calls.length = 0;
    await organizationReports.overview.run({ ...owner, schoolId: 7 }, baseFilters);
    expect(state.calls[0].values).toEqual([7]);
    expect(state.calls[1].values).toEqual([7, 20, 10]);
  });

  it("keeps classes count bindings aligned while the data query adds a session aggregate binding", async () => {
    await organizationReports.classes.run(schoolAdmin, { ...baseFilters, sessionId: 8 });
    const countQuery = state.calls.find(({ sql }) => sql.includes("SELECT COUNT(*)::int AS total FROM school_classes"));
    const dataQuery = state.calls.find(({ sql }) => sql.includes('AS "classId"'));
    expect(countQuery).toBeDefined();
    expect(dataQuery).toBeDefined();
    expect(countQuery!.sql).toContain("sa.academic_session_id=$2");
    expect(countQuery!.values).toEqual([7, 8]);
    expect(countQuery!.values).toHaveLength(2);
    expect(dataQuery!.sql).toContain("$3::integer IS NULL OR sa.academic_session_id=$3");
    expect(dataQuery!.sql).toContain("LIMIT $4 OFFSET $5");
    expect(dataQuery!.values).toEqual([7, 8, 8, 20, 10]);
  });

  it("applies section filters to students and parents even without a class filter", async () => {
    await organizationReports.students.run(schoolAdmin, { ...baseFilters, section: "A" });
    expect(state.calls[0]!.sql).toContain("a.section = $2");
    expect(state.calls[0]!.values).toEqual([7, "A"]);
    expect(state.calls[1]!.values).toEqual([7, "A", 20, 10]);

    state.calls.length = 0;
    await organizationReports.parents.run(schoolAdmin, { ...baseFilters, section: "A" });
    expect(state.calls[0]!.sql).toContain("a.section = $2");
    expect(state.calls[0]!.values).toEqual([7, "A"]);
    expect(state.calls[1]!.values).toEqual([7, "A", 20, 10]);
  });

  it("restricts partner reporting to the active profile's current school attribution", async () => {
    const partner: ReportContext = {
      req: {} as ReportContext["req"],
      userId: 99,
      role: "PARTNER",
      schoolId: null,
      partnerId: 14,
    };
    const result = await organizationReports.partners.run(partner, baseFilters);
    expect(result.rows).toEqual([expect.objectContaining({
      schoolId: 21,
      studentCount: 17,
      commissionAmount: "450.00",
      payableCommission: "200.00",
      paidCommission: "150.00",
    })]);
    const profileQuery = state.calls.find(({ sql }) => sql.includes("FROM partner_profiles pp"));
    const [countQuery, dataQuery] = state.calls.filter(({ sql }) => sql.includes("FROM school_partner_attributions"));
    expect(profileQuery!.sql).toContain("ppu.status='ACTIVE'");
    expect(profileQuery!.sql).toContain("'PARTNER_ADMIN','PARTNER_FINANCE'");
    expect(profileQuery!.values).toEqual([14, 99]);
    for (const query of [countQuery!, dataQuery!]) {
      expect(query.sql).toContain("spa.partner_profile_id=$1");
      expect(query.sql).toContain("spa.is_current=true");
      expect(query.sql).toContain("spa.status='ACTIVE'");
      expect(query.sql).toContain("pp.status='ACTIVE'");
      expect(query.sql).toContain("partner_profile_users");
      expect(query.sql).toContain("ppu.status='ACTIVE'");
      expect(query.values.slice(0, 2)).toEqual([14, 99]);
    }
    expect(dataQuery!.sql).toContain("cl.partner_profile_id=spa.partner_profile_id");
    expect(JSON.stringify(result)).not.toMatch(/studentName|parentName|teacherName|email|phone/);
    expect(dataQuery!.values).toEqual([14, 99, 20, 10]);
  });

  it("keeps partner results constrained by attribution even in a scoped report context", async () => {
    const partner: ReportContext = {
      req: {} as ReportContext["req"],
      userId: 99,
      role: "PARTNER",
      schoolId: 22,
      partnerId: 14,
    };
    await organizationReports.partners.run(partner, { ...baseFilters, schoolId: 22 });
    const [countQuery, dataQuery] = state.calls.filter(({ sql }) => sql.includes("FROM school_partner_attributions"));
    expect(countQuery!.sql).toContain("spa.partner_profile_id=$1");
    expect(countQuery!.sql).toContain("s.id=$3");
    expect(countQuery!.values).toEqual([14, 99, 22]);
    expect(dataQuery!.values).toEqual([14, 99, 22, 20, 10]);
  });

  it("limits partner staff to referred-school aggregates without commission data", async () => {
    state.partnerRole = "PARTNER_STAFF";
    const partner: ReportContext = {
      req: {} as ReportContext["req"],
      userId: 99,
      role: "PARTNER",
      schoolId: null,
      partnerId: 14,
    };
    const result = await organizationReports.partners.run(partner, baseFilters);
    expect(result.columns.map(({ key }) => key)).toEqual([
      "schoolId", "schoolName", "schoolStatus", "studentCount",
    ]);
    expect(result.rows[0]).not.toHaveProperty("commissionAmount");
    const reportData = state.calls.find(({ sql }) => sql.includes('AS "schoolId"') && sql.includes("FROM school_partner_attributions"));
    expect(reportData!.sql).not.toContain("commission_ledger");
    expect(reportData!.sql).toContain("spa.is_current=true");
    expect(reportData!.sql).toContain("spa.status='ACTIVE'");
    expect(reportData!.sql).toContain("partner_profile_users");
    expect(reportData!.sql).toContain("ppu.status='ACTIVE'");
    expect(reportData!.sql).toContain("ppu.role IN ('PARTNER_OWNER','PARTNER_ADMIN','PARTNER_FINANCE','PARTNER_STAFF')");
  });
});