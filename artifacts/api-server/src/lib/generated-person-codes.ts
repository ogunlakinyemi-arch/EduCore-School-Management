import { randomUUID } from "node:crypto";

/** The school prefix remains part of the number even if an employee transfers. */
export function generateEmployeeNumber(schoolId: number) {
  return `EMP-${schoolId}-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

export function generateSchoolCode(name: string) {
  const prefix = name.trim().replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "EDU";
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
}

export function generateSubjectCode(name: string) {
  const prefix = name.trim().split(/\s+/).map(word => word[0] ?? "").join("").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "SUB";
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
}