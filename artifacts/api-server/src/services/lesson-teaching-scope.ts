import { timetableSubjectScopeSql, timetableTeacherScopeSql } from "../lib/timetable-selection-sql";

/** Rebind the existing authoritative staffing predicate; never create a second assignment rule. */
export function lessonTeachingScope(expressions: readonly string[], teacher = true) {
  if (expressions.length !== 7) throw Error("Seven academic scope expressions required");
  const sql = `${timetableSubjectScopeSql(teacher)}${teacher ? ` AND ${timetableTeacherScopeSql}` : ""}`;
  return sql.replace(/\$(\d+)/g, (_, n) => `(${expressions[Number(n) - 1]})`);
}
