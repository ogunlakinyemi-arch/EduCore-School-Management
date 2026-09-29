import type { Request } from "express";
import { pool } from "@workspace/db";
import {
  AuthError,
  getUserContext,
  type Role as AuthRole,
} from "../../middlewares/auth";

export type ReportRole =
  | "OWNER"
  | "ADMIN"
  | "TEACHER"
  | "ACCOUNTANT"
  | "PARENT"
  | "STUDENT"
  | "PARTNER";

export type ReportFilters = {
  schoolId?: number;
  from?: string;
  to?: string;
  sessionId?: number;
  termId?: number;
  classId?: number;
  section?: string;
  subjectId?: number;
  studentId?: number;
  status?: string;
  method?: string;
  limit: number;
  offset: number;
};

export type ReportContext = {
  req: Request;
  userId: number;
  role: ReportRole;
  schoolId: number | null;
  studentId?: number;
  parentId?: number;
  partnerId?: number;
};

export type ReportResult = {
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  total: number;
  summary?: Record<string, unknown>;
};

export type ReportDefinition = {
  roles: ReportRole[];
  filters?: string[];
  run: (context: ReportContext, filters: ReportFilters) => Promise<ReportResult>;
};

const FILTER_KEYS = new Set([
  "schoolId", "from", "to", "sessionId", "termId", "classId", "section",
  "subjectId", "studentId", "status", "method", "limit", "offset",
]);

function scalar(value: unknown, label: string): unknown {
  if (Array.isArray(value) || (value !== null && typeof value === "object")) {
    throw new AuthError(400, `${label} must be a single value`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const raw = scalar(value, label);
  if (
    typeof raw !== "string" &&
    typeof raw !== "number"
  ) {
    throw new AuthError(400, `${label} must be a positive integer`);
  }
  const text = String(raw);
  if (!/^[1-9]\d*$/.test(text)) {
    throw new AuthError(400, `${label} must be a positive integer`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new AuthError(400, `${label} must be a positive integer`);
  }
  return parsed;
}

function optionalId(query: Record<string, unknown>, key: string): number | undefined {
  return query[key] === undefined || query[key] === "" ? undefined : positiveInteger(query[key], key);
}

function dateValue(value: unknown, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  const raw = scalar(value, label);
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new AuthError(400, `${label} must be a calendar date in YYYY-MM-DD format`);
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new AuthError(400, `${label} must be a valid calendar date`);
  }
  return raw;
}

function optionalText(query: Record<string, unknown>, key: string, maxLength: number) {
  const value = scalar(query[key], key);
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new AuthError(400, `${key} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

/** Parse and validate the shared report query-string filters. */
export function parseReportFilters(query: Request["query"] | Record<string, unknown>): ReportFilters {
  const values = query as Record<string, unknown>;
  const unsupported = Object.keys(values).find((key) => !FILTER_KEYS.has(key));
  if (unsupported) throw new AuthError(400, `Unsupported report filter: ${unsupported}`);

  const from = dateValue(values.from, "from");
  const to = dateValue(values.to, "to");
  if (from && to && from > to) throw new AuthError(400, "from must not be later than to");

  const limit = values.limit === undefined ? 50 : positiveInteger(values.limit, "limit");
  if (limit > 200) throw new AuthError(400, "limit must not exceed 200");
  const offset = values.offset === undefined ? 0 : (() => {
    const raw = scalar(values.offset, "offset");
    if (typeof raw !== "string" && typeof raw !== "number") {
      throw new AuthError(400, "offset must be a non-negative integer");
    }
    const text = String(raw);
    if (!/^(0|[1-9]\d*)$/.test(text) || !Number.isSafeInteger(Number(text))) {
      throw new AuthError(400, "offset must be a non-negative integer");
    }
    return Number(text);
  })();
  if (offset > 1_000_000) throw new AuthError(400, "offset must not exceed 1000000");

  return {
    schoolId: optionalId(values, "schoolId"),
    from,
    to,
    sessionId: optionalId(values, "sessionId"),
    termId: optionalId(values, "termId"),
    classId: optionalId(values, "classId"),
    section: optionalText(values, "section", 80),
    subjectId: optionalId(values, "subjectId"),
    studentId: optionalId(values, "studentId"),
    status: optionalText(values, "status", 80),
    method: optionalText(values, "method", 80),
    limit,
    offset,
  };
}

function reportRoleForAuth(role: AuthRole): ReportRole | undefined {
  switch (role) {
    case "PLATFORM_OWNER": return "OWNER";
    case "SCHOOL_ADMIN": return "ADMIN";
    case "TEACHER": return "TEACHER";
    case "ACCOUNTANT": return "ACCOUNTANT";
    case "PARENT": return "PARENT";
    case "STUDENT": return "STUDENT";
    case "PARTNER": return "PARTNER";
    default: return undefined;
  }
}

function assertAllowed(role: ReportRole, allowedRoles: ReportRole[]) {
  if (!allowedRoles.includes(role)) {
    throw new AuthError(403, "You are not authorized to access this report");
  }
}

async function schoolExists(schoolId: number) {
  const result = await pool.query("SELECT id FROM schools WHERE id=$1 LIMIT 1", [schoolId]);
  if (!result.rows.length) throw new AuthError(404, "School not found");
}

async function validateFilterObjects(filters: ReportFilters, schoolId: number | null, partnerId?: number) {
  const objectFilters: Array<[number | undefined, string, string]> = [
    [filters.sessionId, "academic_sessions", "session"],
    [filters.termId, "academic_terms", "term"],
    [filters.classId, "school_classes", "class"],
    [filters.subjectId, "subjects", "subject"],
    [filters.studentId, "students", "student"],
  ];
  const observedSchools = new Set<number>();
  for (const [id, table, label] of objectFilters) {
    if (id === undefined) continue;
    const result = await pool.query(
      `SELECT id, school_id AS "schoolId" FROM ${table} WHERE id=$1 LIMIT 1`,
      [id],
    );
    const row = result.rows[0] as { schoolId?: number } | undefined;
    if (!row) throw new AuthError(404, `${label[0].toUpperCase()}${label.slice(1)} not found`);
    if (schoolId !== null && Number(row.schoolId) !== schoolId) {
      throw new AuthError(404, `${label[0].toUpperCase()}${label.slice(1)} not found in this school`, "CROSS_TENANT_ACCESS_ATTEMPT");
    }
    if (partnerId !== undefined) {
      const attribution = await pool.query(
        `SELECT 1 FROM school_partner_attributions
          WHERE school_id=$1 AND partner_profile_id=$2 AND is_current=true
            AND status='ACTIVE'
          LIMIT 1`,
        [Number(row.schoolId), partnerId],
      );
      if (!attribution.rows.length) {
        throw new AuthError(404, `${label[0].toUpperCase()}${label.slice(1)} not found`, "CROSS_TENANT_ACCESS_ATTEMPT");
      }
    }
    observedSchools.add(Number(row.schoolId));
  }
  if (schoolId === null && observedSchools.size > 1) {
    throw new AuthError(400, "Report filters must reference records from the same school");
  }
  if (filters.termId !== undefined && filters.sessionId !== undefined) {
    const term = await pool.query(
      "SELECT 1 FROM academic_terms WHERE id=$1 AND academic_session_id=$2 LIMIT 1",
      [filters.termId, filters.sessionId],
    );
    if (!term.rows.length) throw new AuthError(404, "Term not found in the selected session");
  }
  if (filters.section) {
    const section = await pool.query(
      `SELECT 1 FROM school_classes c
       WHERE c.section=$1
         AND ($2::integer IS NULL OR c.school_id=$2)
         AND ($3::integer IS NULL OR c.id=$3)
         AND ($4::integer IS NULL OR EXISTS (
           SELECT 1 FROM school_partner_attributions a
            WHERE a.school_id=c.school_id AND a.partner_profile_id=$4
              AND a.is_current=true AND a.status='ACTIVE'
         ))
       LIMIT 1`,
      [filters.section, schoolId, filters.classId ?? null, partnerId ?? null],
    );
    if (!section.rows.length) throw new AuthError(404, "Section not found in this school");
  }
}

async function partnerProfile(userId: number) {
  const result = await pool.query(
    `SELECT p.id, p.status
       FROM partner_profiles p
      WHERE p.user_id=$1 OR EXISTS (
        SELECT 1 FROM partner_profile_users pu
         WHERE pu.partner_profile_id=p.id AND pu.user_id=$1 AND pu.status='ACTIVE'
      )
      ORDER BY (p.user_id=$1) DESC, p.id
      LIMIT 1`,
    [userId],
  );
  const row = result.rows[0] as { id: number; status: string } | undefined;
  if (!row || String(row.status).toUpperCase() !== "ACTIVE") {
    throw new AuthError(403, "Active partner profile required");
  }
  return Number(row.id);
}

/**
 * Resolve the active authorized report role and tenant scope. A school selection
 * is only honored for owners or where backed by an exact active membership/profile.
 */
export async function resolveReportContext(
  req: Request,
  allowedRoles: ReportRole[],
  filters: ReportFilters,
): Promise<ReportContext> {
  if (!allowedRoles.length) throw new AuthError(403, "This report has no authorized roles");
  const user = getUserContext(req);
  const active = user.roles.filter((assignment) => assignment.status === "ACTIVE");
  const isOwner = active.some(
    (assignment) => assignment.role === "PLATFORM_OWNER" && assignment.schoolId === null,
  );
  const ownerMayRead = isOwner && allowedRoles.includes("OWNER");

  if (ownerMayRead) {
    if (filters.schoolId !== undefined) await schoolExists(filters.schoolId);
    await validateFilterObjects(filters, filters.schoolId ?? null);
    return {
      req,
      userId: user.user.id,
      role: "OWNER",
      schoolId: filters.schoolId ?? null,
    };
  }

  if (
    allowedRoles.includes("PARTNER") &&
    active.some((assignment) => assignment.role === "PARTNER")
  ) {
    const partnerId = await partnerProfile(user.user.id);
    const schoolId = filters.schoolId ?? null;
    if (schoolId !== null) {
      const attribution = await pool.query(
        `SELECT 1 FROM school_partner_attributions
          WHERE school_id=$1 AND partner_profile_id=$2 AND is_current=true
            AND status='ACTIVE'
          LIMIT 1`,
        [schoolId, partnerId],
      );
      if (!attribution.rows.length) {
        throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
      }
    }
    assertAllowed("PARTNER", allowedRoles);
    await validateFilterObjects(filters, schoolId, partnerId);
    return { req, userId: user.user.id, role: "PARTNER", schoolId, partnerId };
  }

  const eligibleMemberships = active.flatMap((assignment) => {
    const role = reportRoleForAuth(assignment.role);
    if (!role || role === "OWNER" || !allowedRoles.includes(role) || assignment.schoolId === null) return [];
    if (filters.schoolId !== undefined && assignment.schoolId !== filters.schoolId) return [];
    return [{ schoolId: Number(assignment.schoolId), role }];
  });
  const schoolIds = [...new Set(eligibleMemberships.map((assignment) => assignment.schoolId))];
  if (filters.schoolId !== undefined && !schoolIds.includes(filters.schoolId)) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
  if (!schoolIds.length) throw new AuthError(403, "You are not authorized to access this report");
  if (schoolIds.length > 1 && filters.schoolId === undefined) {
    throw new AuthError(400, "schoolId is required when the account has multiple authorized school scopes");
  }
  const schoolId = filters.schoolId ?? schoolIds[0]!;
  const assignedRoles = eligibleMemberships
    .filter((assignment) => assignment.schoolId === schoolId)
    .map((assignment) => assignment.role);
  const role = allowedRoles.find(
    (candidate) => candidate !== "OWNER" && assignedRoles.includes(candidate),
  );
  if (!role) throw new AuthError(403, "You are not authorized to access this report");
  const context: ReportContext = { req, userId: user.user.id, role, schoolId };

  if (role === "PARENT") {
    const profile = await pool.query(
      `SELECT id FROM parents
        WHERE user_id=$1 AND school_id=$2 AND UPPER(status)='ACTIVE'
        LIMIT 1`,
      [user.user.id, schoolId],
    );
    if (!profile.rows[0]) throw new AuthError(403, "Parent profile is not available for this school");
    context.parentId = Number(profile.rows[0].id);
    if (filters.studentId !== undefined) {
      const child = await pool.query(
        `SELECT 1 FROM parent_student_relationships psr
          JOIN students st ON st.id=psr.student_id AND st.school_id=$3
            AND UPPER(st.status)='ACTIVE'
          WHERE psr.parent_id=$1 AND psr.student_id=$2
            AND UPPER(psr.status)='ACTIVE'
          LIMIT 1`,
        [context.parentId, filters.studentId, schoolId],
      );
      if (!child.rows.length) throw new AuthError(404, "Student not found", "CROSS_TENANT_ACCESS_ATTEMPT");
    }
  } else if (role === "STUDENT") {
    const profile = await pool.query(
      `SELECT id FROM students
        WHERE user_id=$1 AND school_id=$2 AND UPPER(status)='ACTIVE'
        LIMIT 1`,
      [user.user.id, schoolId],
    );
    if (!profile.rows[0]) throw new AuthError(403, "Student profile is not available for this school");
    context.studentId = Number(profile.rows[0].id);
    if (filters.studentId !== undefined && filters.studentId !== context.studentId) {
      throw new AuthError(404, "Student not found", "CROSS_TENANT_ACCESS_ATTEMPT");
    }
  }

  await validateFilterObjects(filters, schoolId);
  return context;
}