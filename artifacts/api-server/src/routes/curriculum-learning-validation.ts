import type { NextFunction, Request, Response } from "express";
import { AuthError, assertSchoolOperationalAccess, getUserContext, handleAuthError } from "../middlewares/auth";
import { assertCurriculumSourceKind } from "../services/curriculum-learning-service";

export const run =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch((error) => handleAuthError(error, req, res, next));

export const asyncId = (raw: unknown, label: string, status: 400 | 404 = 400): number => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AuthError(status, `${label} must be a positive integer`);
  return parsed;
};
export const revisionValue = (raw: unknown): number => {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new AuthError(400, "expectedRevision must be a non-negative integer");
  return parsed;
};
export const requiredText = (value: unknown, label: string, max = 2000): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AuthError(400, `${label} is required`);
  return value.trim();
};
export const optionalText = (value: unknown, label: string, max = 10000): string | null => {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > max) throw new AuthError(400, `${label} must be text`);
  return value;
};
export const normalizeCurriculumLabel = (value: unknown): string =>
  String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function dateOnly(value: unknown, label: string, allowNull = true): string | null {
  if (value == null || value === "") {
    if (allowNull) return null;
    throw new AuthError(400, `${label} is required`);
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new AuthError(400, `${label} must be a valid YYYY-MM-DD date`);
  }
  return value;
}
export const bodyObject = (body: unknown): Record<string, any> => {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AuthError(400, "A JSON object body is required");
  return body as Record<string, any>;
};
export const requestParam = (req: Request, name: string) => asyncId(req.params[name], name, 404);

function isOwner(req: Request): boolean {
  return getUserContext(req).roles.some((role) => role.role === "PLATFORM_OWNER" && role.schoolId === null && role.status === "ACTIVE");
}
export function requireOwner(req: Request): number {
  if (!isOwner(req)) throw new AuthError(403, "Platform Owner curriculum-library access is required");
  return getUserContext(req).user.id;
}
export function requireSchoolAdmin(req: Request, schoolId: number) {
  assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
}
export function requireTeacherOrAdmin(req: Request, schoolId: number) {
  assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN", "TEACHER"]);
}
export function requireSchoolTeacher(req: Request, schoolId: number) {
  assertSchoolOperationalAccess(req, schoolId, ["TEACHER"]);
}
export const schoolId = (req: Request) => asyncId(req.params.schoolId, "schoolId");

export function arrays(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500 || value.some((entry) => typeof entry !== "string" || entry.length > 2000)) {
    throw new AuthError(400, `${label} must be an array of at most 500 strings`);
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}
export function versionInput(body: Record<string, any>) {
  const allowed = new Set([
    "title", "educationLevel", "classLevels", "subjectCodes", "sourceKind", "sourceOrganization",
    "sourceReference", "sourceVersion", "effectiveDate", "verifiedDate", "description", "derivedFromVersionId",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new AuthError(400, "Request contains unsupported curriculum fields");
  const sourceKind = body.sourceKind;
  try { assertCurriculumSourceKind(sourceKind); } catch (error) { throw new AuthError(400, (error as Error).message); }
  const educationLevel = requiredText(body.educationLevel, "educationLevel", 40);
  if (!["PRIMARY", "JSS", "SSS", "OTHER"].includes(educationLevel)) throw new AuthError(400, "educationLevel is invalid");
  if (sourceKind === "OFFICIAL" && !requiredText(body.sourceReference, "sourceReference", 2000)) {
    throw new AuthError(400, "Official curriculum requires a source reference");
  }
  return {
    title: requiredText(body.title, "title", 250),
    educationLevel,
    classLevels: arrays(body.classLevels, "classLevels"),
    subjectCodes: arrays(body.subjectCodes, "subjectCodes"),
    sourceKind,
    sourceOrganization: requiredText(body.sourceOrganization, "sourceOrganization", 250),
    sourceReference: requiredText(body.sourceReference, "sourceReference", 2000),
    sourceVersion: optionalText(body.sourceVersion, "sourceVersion", 150),
    effectiveDate: dateOnly(body.effectiveDate, "effectiveDate"),
    verifiedDate: dateOnly(body.verifiedDate, "verifiedDate"),
    description: optionalText(body.description, "description", 10000),
    derivedFromVersionId: body.derivedFromVersionId == null ? null : asyncId(body.derivedFromVersionId, "derivedFromVersionId"),
  };
}

const contentFields = new Set([
  "topic", "objectives", "previousKnowledge", "materials", "introduction", "lessonDevelopment", "teacherActivities",
  "studentActivities", "lessonContent", "examples", "classActivities", "assessment", "assignment", "conclusion", "references",
]);
function cleanContent(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuthError(400, "content must be an object");
  const content = value as Record<string, unknown>;
  if (Object.keys(content).some((key) => !contentFields.has(key))) throw new AuthError(400, "content contains unsupported lesson-note fields");
  for (const [key, item] of Object.entries(content)) {
    if (typeof item !== "string" && (!Array.isArray(item) || item.length > 500 || item.some((entry) => typeof entry !== "string"))) {
      throw new AuthError(400, `${key} must be text or a list of at most 500 text values`);
    }
    if (typeof item === "string" && item.length > 20000) throw new AuthError(400, `${key} exceeds 20,000 characters`);
  }
  return content;
}

export function lessonInput(body: Record<string, any>, partial = false) {
  const fields = new Set(["sessionId", "termId", "classId", "subjectId", "section", "week", "date", "curriculumMappingId",
    "curriculumVersionId", "topicId", "subTopicId", "content", "expectedRevision"]);
  if (Object.keys(body).some((key) => !fields.has(key))) throw new AuthError(400, "Request contains unsupported lesson-note fields");
  const output: Record<string, any> = {};
  for (const field of ["sessionId", "termId", "classId", "subjectId", "week", "date"] as const) {
    if (body[field] === undefined && partial) continue;
    if (field === "date") {
      output.date = dateOnly(body.date, "date", false);
    } else {
      output[field] = asyncId(body[field], field);
      if (field === "week" && output.week > 60) throw new AuthError(400, "week must be from 1 to 60");
    }
  }
  if (body.section !== undefined) output.section = body.section === null ? null : requiredText(body.section, "section", 100);
  if (!partial && body.section === undefined) output.section = null;
  for (const field of ["curriculumMappingId", "curriculumVersionId", "topicId", "subTopicId"] as const) {
    if (body[field] !== undefined) output[field] = body[field] === null ? null : asyncId(body[field], field);
  }
  if (body.content !== undefined) output.content = cleanContent(body.content);
  if (body.expectedRevision !== undefined) output.expectedRevision = revisionValue(body.expectedRevision);
  return output;
}