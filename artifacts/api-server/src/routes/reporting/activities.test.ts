import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@workspace/db", () => ({ pool: { query } }));

import { activitiesReports } from "./activities";
import type { ReportContext, ReportFilters } from "./core";

const filters = (overrides: Partial<ReportFilters> = {}): ReportFilters => ({
  limit: 25,
  offset: 0,
  ...overrides,
});

const context = (overrides: Partial<ReportContext> = {}): ReportContext => ({
  req: {} as ReportContext["req"],
  userId: 40,
  role: "ADMIN",
  schoolId: 10,
  ...overrides,
});

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [{ total: 2 }] });
});

describe("library activity reports", () => {
  it("keeps school-wide catalogue reporting away from parents and students", () => {
    expect(activitiesReports.library?.roles).toEqual(["OWNER", "ADMIN"]);
    expect(activitiesReports["library-loans"]?.roles).toEqual([
      "OWNER", "ADMIN", "PARENT", "STUDENT",
    ]);
  });

  it("limits parent loan rows to active children in the parent’s school", async () => {
    query.mockResolvedValueOnce({
      rows: [{
        loanId: 4,
        bookTitle: "Science",
        status: "RETURNED",
        returnedOverdue: true,
        daysOverdueAtReturn: 3,
        renewalCount: 1,
      }],
    }).mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ loans: 1, returned: 1, renewals: 1 }] });

    const report = await activitiesReports["library-loans"]!.run(
      context({ role: "PARENT", parentId: 7, userId: 70 }),
      filters({ studentId: 501, from: "2026-02-01", to: "2026-02-28", limit: 10, offset: 20 }),
    );

    expect(report.total).toBe(1);
    expect(report.rows[0]).toMatchObject({
      status: "RETURNED",
      returnedOverdue: true,
      daysOverdueAtReturn: 3,
      renewalCount: 1,
    });
    expect(JSON.stringify(report)).not.toContain("fine");
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("l.school_id=$1");
    expect(sql).toContain("psr.parent_id=$2");
    expect(sql).toContain("psr.status='ACTIVE'");
    expect(sql).toContain("UPPER(s.status)='ACTIVE'");
    expect(sql).toContain("UPPER(p.status)='ACTIVE'");
    expect(sql).toContain("l.borrower_student_id=$3");
    expect(sql).toContain("l.issued_at >= $4::date");
    expect(sql).toContain("l.issued_at < $5::date + INTERVAL '1 day'");
    expect(values).toEqual([10, 7, 501, "2026-02-01", "2026-02-28", 10, 20]);
    expect(query.mock.calls[1]?.[1]).toEqual([10, 7, 501, "2026-02-01", "2026-02-28"]);
  });

  it("restricts a student to their own active loan identity and computes overdue only for open loans", async () => {
    query.mockResolvedValueOnce({
      rows: [{ loanId: 9, status: "OPEN", overdue: true, daysOverdue: 2 }],
    }).mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ loans: 1, open: 1, overdue: 1 }] });

    const report = await activitiesReports["library-loans"]!.run(
      context({ role: "STUDENT", studentId: 501, userId: 90 }),
      filters({ status: "OVERDUE" }),
    );

    expect(report.rows[0]).toMatchObject({ status: "OPEN", overdue: true, daysOverdue: 2 });
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("l.borrower_type='STUDENT'");
    expect(sql).toContain("l.borrower_student_id=$2");
    expect(sql).toContain("l.borrower_user_id=$3");
    expect(sql).toContain("s.school_id=$1");
    expect(sql).toContain("UPPER(s.status)='ACTIVE'");
    expect(sql).toContain("l.status='OPEN' AND l.due_on<CURRENT_DATE");
    expect(values).toEqual([10, 501, 90, 25, 0]);
  });
});

describe("operations and audit report boundaries", () => {
  it("queries assets and operational records only within an admin’s school", async () => {
    query.mockResolvedValueOnce({ rows: [{ entityType: "ASSET", id: 3, status: "AVAILABLE" }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const report = await activitiesReports.operations!.run(
      context({ role: "ADMIN", schoolId: 10 }),
      filters({ status: "AVAILABLE", limit: 5, offset: 10 }),
    );

    expect(report.rows).toHaveLength(1);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE a.school_id=$1");
    expect(sql).toContain("WHERE m.school_id=$1");
    expect(sql).toContain("WHERE t.school_id=$1");
    expect(sql).toContain("WHERE f.school_id=$1");
    expect(sql).toContain("status=$2");
    expect(values).toEqual([10, "AVAILABLE", 5, 10]);
    expect(query.mock.calls[1]?.[0]).toContain("school_id=$1");
    expect(query.mock.calls[1]?.[1]).toEqual([10, "AVAILABLE"]);
  });

  it("returns an owner aggregate, not school-level operational detail", async () => {
    query.mockResolvedValueOnce({
      rows: [{ schoolId: 10, entityType: "ASSET", status: "AVAILABLE", count: 5 }],
    }).mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const report = await activitiesReports.operations!.run(
      context({ role: "OWNER", schoolId: null }),
      filters({ limit: 5, offset: 5 }),
    );

    expect(report.title).toContain("summary");
    expect(report.rows[0]).toEqual({
      schoolId: 10,
      entityType: "ASSET",
      status: "AVAILABLE",
      count: 5,
    });
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("($1::integer IS NULL OR school_id=$1)");
    expect(sql).toContain("GROUP BY school_id, entity_type, status");
    expect(sql).not.toContain("assigned_to_user_id");
    expect(values).toEqual([null, 5, 5]);
  });

  it("scopes asset and maintenance history to the admin tenant and excludes actor details", async () => {
    query.mockResolvedValueOnce({
      rows: [{ historyType: "MAINTENANCE", recordId: 14, fromStatus: "OPEN", toStatus: "COMPLETED" }],
    }).mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const report = await activitiesReports["operations-history"]!.run(
      context({ role: "ADMIN", schoolId: 10 }),
      filters({ from: "2026-01-01", to: "2026-01-31", offset: 4 }),
    );

    expect(report.total).toBe(1);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM school_asset_history h WHERE h.school_id=$1");
    expect(sql).toContain("FROM maintenance_request_status_history h WHERE h.school_id=$1");
    expect(sql).toContain("FROM operational_task_status_history h WHERE h.school_id=$1");
    expect(sql).toContain("event_at >= $2::date");
    expect(sql).toContain("event_at < $3::date + INTERVAL '1 day'");
    expect(sql).not.toContain("actor_user_id");
    expect(values).toEqual([10, "2026-01-01", "2026-01-31", 25, 4]);
  });

  it("keeps audit output tenant-scoped and excludes untrusted metadata and identity fields", async () => {
    query.mockResolvedValueOnce({
      rows: [{ eventAt: "2026-02-01", action: "Updated record", module: "Operations" }],
    }).mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const report = await activitiesReports.audit!.run(
      context({ role: "ADMIN", schoolId: 10 }),
      filters({ from: "2026-02-01", status: "DENIED" }),
    );

    expect(report.rows).toHaveLength(1);
    expect(report.columns.map(({ key }) => key)).not.toContain("metadata");
    expect(report.columns.map(({ key }) => key)).not.toContain("clerkUserId");
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("al.school_id=$1");
    expect(sql).toContain("al.result=$2");
    expect(sql).toContain("al.timestamp >= $3::date");
    expect(sql).not.toContain("al.metadata");
    expect(sql).not.toContain("al.clerk_user_id");
    expect(values).toEqual([10, "DENIED", "2026-02-01", 25, 0]);
  });

  it("does not grant operations or audit report definitions to non-admin roles", () => {
    expect(activitiesReports.operations?.roles).toEqual(["OWNER", "ADMIN"]);
    expect(activitiesReports["operations-history"]?.roles).toEqual(["OWNER", "ADMIN"]);
    expect(activitiesReports.audit?.roles).toEqual(["OWNER", "ADMIN"]);
  });
});