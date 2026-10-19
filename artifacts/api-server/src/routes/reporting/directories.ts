import { pool } from "@workspace/db";
import { AuthError } from "../../middlewares/auth";
import type { ReportDefinition, ReportResult } from "./core";

// Fixed projections deliberately exclude payroll, identity-provider identifiers,
// financial allocations, medical notes and relationship authorization details.
const definitions = {
  students: {
    from: "students",
    fields: { admission_no: "Admission number", first_name: "First name", middle_name: "Middle name", last_name: "Last name", class_name: "Class", section: "Section", status: "Status" },
    order: "last_name, first_name, id",
  },
  classes: {
    from: "school_classes",
    fields: { name: "Class", section: "Section", class_teacher: "Class teacher", capacity: "Capacity" },
    order: "name, section, id",
  },
  parents: {
    from: "parents",
    fields: { name: "Name", email: "Email", phone: "Phone", status: "Status" },
    order: "name, id",
  },
  staff: {
    from: "employees",
    fields: { employee_no: "Employee number", first_name: "First name", middle_name: "Middle name", last_name: "Last name", email: "Email", phone: "Phone", employee_type: "Type", employment_status: "Employment status", department: "Department" },
    order: "last_name, first_name, id",
    type: "STAFF",
  },
  teachers: {
    from: "employees",
    fields: { employee_no: "Employee number", first_name: "First name", middle_name: "Middle name", last_name: "Last name", email: "Email", phone: "Phone", employee_type: "Type", employment_status: "Employment status", department: "Department" },
    order: "last_name, first_name, id",
    type: "TEACHER",
  },
} as const;

export const directoryReports: Record<string, ReportDefinition> = Object.fromEntries(
  Object.entries(definitions).map(([kind, definition]) => [`directory-${kind}`, {
    roles: ["OWNER", "ADMIN"],
    filters: [],
    async run(ctx, filters): Promise<ReportResult> {
      // Even the Owner must deliberately select one school for these PII files.
      if (ctx.schoolId === null) throw new AuthError(400, "Select a school before exporting a directory");
      const values: unknown[] = [ctx.schoolId];
      const predicate = "type" in definition
        ? (values.push("TEACHER"), `school_id=$1 AND employee_type${definition.type === "STAFF" ? "<>" : "="}$2`)
        : "school_id=$1";
      const count = await pool.query(`SELECT COUNT(*)::int AS total FROM ${definition.from} WHERE ${predicate}`, values);
      const fields = Object.entries(definition.fields);
      const rows = await pool.query(
        `SELECT ${fields.map(([key]) => key).join(", ")} FROM ${definition.from}
         WHERE ${predicate} ORDER BY ${definition.order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, filters.limit, filters.offset],
      );
      return {
        title: `${kind} directory`,
        columns: fields.map(([key, label]) => ({ key, label })),
        rows: rows.rows,
        total: Number(count.rows[0]?.total ?? 0),
      };
    },
  }]),
);
