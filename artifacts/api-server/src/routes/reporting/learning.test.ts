import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<{ sql: string; values: unknown[] }>);
const poolMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.includes("COUNT(*)")) return { rows: [{ total: 3 }] };
    return { rows: [{ status: "PRESENT" }] };
  }),
}));

vi.mock("@workspace/db", () => ({ pool: poolMock }));

import { learningReports } from "./learning";
import type { ReportContext, ReportFilters } from "./core";

const filters = (overrides: Partial<ReportFilters> = {}): ReportFilters => ({
  limit: 25,
  offset: 0,
  ...overrides,
});

function context(
  role: ReportContext["role"],
  overrides: Partial<ReportContext> = {},
): ReportContext {
  return {
    req: {} as ReportContext["req"],
    userId: 700,
    role,
    schoolId: 14,
    ...overrides,
  };
}

beforeEach(() => {
  calls.length = 0;
  poolMock.query.mockClear();
});

describe("learning reports", () => {
  it("filters attendance by school, day, term, and status with a separate count and safe pagination", async () => {
    const result = await learningReports.attendance.run(
      context("ADMIN"),
      filters({
        from: "2025-03-04",
        to: "2025-03-04",
        termId: 8,
        status: "late",
        limit: 10,
        offset: 20,
      }),
    );

    expect(result.total).toBe(3);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("e.school_id=$1");
    expect(calls[0]?.sql).toContain("e.event_date>=$2::date");
    expect(calls[0]?.sql).toContain("e.event_date<$3::date + INTERVAL '1 day'");
    expect(calls[0]?.sql).toContain("COALESCE(e.academic_term_id,sca.academic_term_id)=$4");
    expect(calls[0]?.sql).toContain("e.attendance_status=$5");
    expect(calls[0]?.values).toEqual([14, "2025-03-04", "2025-03-04", 8, "LATE"]);
    expect(calls[1]?.values).toEqual([14, "2025-03-04", "2025-03-04", 8, "LATE", 10, 20]);
    expect(calls[1]?.sql).toContain("LIMIT $6 OFFSET $7");
  });

  it("pins student attendance to the authenticated student despite a changed student filter", async () => {
    await learningReports.attendance.run(
      context("STUDENT", { studentId: 41 }),
      filters({ studentId: 99 }),
    );

    const query = calls[0]!;
    expect(query.sql).toContain("e.student_id=$2");
    expect(query.sql).toContain("e.student_id=$3");
    expect(query.values).toEqual([14, 99, 41]);
    expect(query.sql).toContain("e.school_id=$1");
  });

  it("constrains parent attendance rows through an active parent-child link and active same-school parent", async () => {
    await learningReports["attendance-history"].run(
      context("PARENT", { parentId: 21 }),
      filters({ studentId: 99 }),
    );

    const query = calls[0]!;
    expect(query.sql).toContain("parent_student_relationships psr");
    expect(query.sql).toContain("UPPER(psr.status)='ACTIVE'");
    expect(query.sql).toContain("UPPER(p.status)='ACTIVE'");
    expect(query.sql).toContain("p.school_id=e.school_id");
    expect(query.sql).toContain("psr.parent_id=$3");
    expect(query.values).toEqual([14, 99, 21]);
  });

  it("limits teacher attendance to an active assigned class/section and binds the teacher identity correctly", async () => {
    await learningReports.attendance.run(
      context("TEACHER"),
      filters({ classId: 5, from: "2025-03-04" }),
    );

    const query = calls[0]!;
    expect(query.sql).toContain("teacher_class_assignments ta");
    expect(query.sql).toContain("ta.status='ACTIVE'");
    expect(query.sql).toContain("ta.school_class_id=COALESCE(e.school_class_id,sca.school_class_id)");
    expect(query.sql).toContain("te.user_id=$4");
    expect(query.values).toEqual([14, "2025-03-04", 5, 700]);
  });

  it("resolves a null-class gate event from the student's historical class assignment", async () => {
    await learningReports.attendance.run(
      context("TEACHER"),
      filters({ classId: 5, sessionId: 4, termId: 8, from: "2025-03-04" }),
    );

    const query = calls[0]!;
    expect(query.sql).toContain("LEFT JOIN LATERAL");
    expect(query.sql).toContain("sca.student_id=e.student_id");
    expect(query.sql).toContain("sca.school_id=e.school_id");
    expect(query.sql).toContain("sca.start_date<=e.event_date");
    expect(query.sql).toContain("sca.end_date>=e.event_date");
    expect(query.sql).toContain("sca.created_at<=e.occurred_at");
    expect(query.sql).toContain("(e.academic_session_id IS NULL OR sca.academic_session_id=e.academic_session_id)");
    expect(query.sql).toContain("(e.academic_term_id IS NULL OR sca.academic_term_id=e.academic_term_id)");
    expect(query.sql).toContain("ta.school_class_id=COALESCE(e.school_class_id,sca.school_class_id)");
    expect(query.sql).toContain("ta.section=COALESCE(e.section_snapshot,sca.section,'')");
    expect(query.sql).toContain("ta.status='ACTIVE'");
    expect(query.values).toEqual([14, "2025-03-04", 4, 8, 5, 700]);
  });

  it("restricts family academic rows to own/linked children and published results only", async () => {
    await learningReports["academic-results"].run(
      context("PARENT", { parentId: 21 }),
      filters({ studentId: 31, sessionId: 4, termId: 6 }),
    );

    const query = calls[0]!;
    expect(query.sql).toContain("r.status='PUBLISHED'");
    expect(query.sql).toContain("parent_student_relationships psr");
    expect(query.sql).toContain("r.student_id=$4");
    expect(query.sql).toContain("psr.parent_id=$5");
    expect(query.sql).toContain("a.school_id=r.school_id");
    expect(query.values).toEqual([14, 4, 6, 31, 21]);
    expect(query.sql).not.toMatch(/created_by|published_by/i);
  });

  it("uses active teacher assignment joins for academic subject/class data", async () => {
    await learningReports.academics.run(
      context("TEACHER"),
      filters({ sessionId: 4, termId: 6, subjectId: 9 }),
    );

    const query = calls[0]!;
    expect(query.sql).toContain("teacher_class_assignments ta");
    expect(query.sql).toContain("ta.status='ACTIVE'");
    expect(query.sql).toContain("class_subjects cs");
    expect(query.sql).toContain("cs.status='ACTIVE'");
    expect(query.sql).toContain("te.user_id=$5");
    expect(query.values).toEqual([14, 4, 6, 9, 700]);
  });

  it("uses immutable school bindings for historical activity even without assignment-history rows", async () => {
    await learningReports.nfc.run(context("ADMIN"), filters());

    const query = calls[1]!;
    const historyQuery = query.sql.slice(query.sql.indexOf("FROM attendance_events e"));
    expect(historyQuery).toContain("device_school_bindings binding");
    expect(historyQuery).toContain("binding.school_id=e.school_id");
    expect(historyQuery).toContain("dah.new_school_id=e.school_id");
    expect(historyQuery).toContain("dah.created_at<=e.occurred_at");
    expect(historyQuery).not.toMatch(/AND EXISTS\s*\(\s*SELECT 1 FROM device_assignment_history/);
    expect(historyQuery).not.toContain("platform_devices");
    expect(historyQuery).not.toContain("dev.name");
    expect(query.sql).toContain("event_binding.location");

    const cardRows = query.sql.slice(
      query.sql.indexOf("SELECT 'CARD'"),
      query.sql.indexOf("UNION ALL"),
    );
    expect(cardRows).not.toContain("platform_devices");
    expect(cardRows).not.toContain("dev.name");
    expect(cardRows).toContain("NULL::text AS device");
  });

  it("restricts family report-card summaries to linked children and published cards", async () => {
    await learningReports["report-card-summary"].run(
      context("PARENT", { parentId: 21 }),
      filters({ studentId: 31, sessionId: 4 }),
    );

    const query = calls[1]!;
    expect(query.sql).toContain("rc.status='PUBLISHED'");
    expect(query.sql).toContain("parent_student_relationships psr");
    expect(query.sql).toContain("psr.parent_id=$4");
    expect(query.sql).toContain("academic_report_card_lines");
    expect(query.sql).not.toMatch(/teacher_remark|school_remark|published_by/i);
    expect(query.values).toEqual([14, 4, 31, 21, 25, 0]);
  });

  it("restricts timetable rows to the teacher's active class or subject assignment", async () => {
    await learningReports.timetable.run(
      context("TEACHER"),
      filters({ sessionId: 4, classId: 5, section: "B", subjectId: 9 }),
    );

    const query = calls[1]!;
    expect(query.sql).toContain("academic_timetable_entries tt");
    expect(query.sql).toContain("tt.school_id=$1");
    expect(query.sql).toContain("ta.status='ACTIVE'");
    expect(query.sql).toContain("cs.status='ACTIVE'");
    expect(query.sql).toContain("te.user_id=$6");
    expect(query.values).toEqual([14, 4, 5, "B", 9, 700, 25, 0]);
  });

  it("provides event-count summaries without deriving attendance statuses", async () => {
    await learningReports["attendance-weekly"].run(context("ADMIN"), filters());

    const query = calls[1]!;
    expect(query.sql).toContain("date_trunc('week',e.event_date)::date");
    expect(query.sql).toContain("e.event_type AS \"eventType\"");
    expect(query.sql).toContain("e.attendance_status AS status");
    expect(query.sql).toContain("COUNT(*)::int AS \"eventCount\"");
    expect(query.sql).toContain("GROUP BY date_trunc('week',e.event_date)::date,e.event_type,e.attendance_status");
  });

  it("exposes stored grades as a distribution instead of recalculating them", async () => {
    await learningReports["grade-distribution"].run(context("ADMIN"), filters());

    const query = calls[1]!;
    expect(query.sql).toContain("r.grade");
    expect(query.sql).toContain("COUNT(*)::int AS \"resultCount\"");
    expect(query.sql).toContain("GROUP BY r.grade,sub.name");
    expect(query.sql).not.toMatch(/min_score|max_score|grade_point/i);
  });

  it("scopes NFC rows to the authorized school and never selects card identifiers or device credentials", async () => {
    await learningReports.nfc.run(
      context("ADMIN"),
      filters({ schoolId: 99, status: "active" }),
    );

    const query = calls[1]!;
    expect(query.sql).toContain("card.school_id=$1");
    expect(query.sql).not.toContain("dev.school_id=card.school_id");
    expect(query.sql).toContain("LIMIT $6 OFFSET $7");
    expect(query.values).toEqual([14, null, null, "ACTIVE", null, 25, 0]);
    expect(query.sql).not.toMatch(/card\.uid|serial_number|secret_hash|credential_identifier/i);
  });

  it("supports platform-wide owner reporting while retaining an explicit optional tenant predicate", async () => {
    await learningReports.nfc.run(context("OWNER", { schoolId: null }), filters());

    expect(calls[1]?.sql).toContain("($1::int IS NULL OR card.school_id=$1)");
    expect(calls[1]?.values).toEqual([null, null, null, null, null, 25, 0]);
  });
});