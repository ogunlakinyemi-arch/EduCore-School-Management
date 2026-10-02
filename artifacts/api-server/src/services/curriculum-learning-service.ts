export type LessonNoteStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "RETURNED"
  | "RESUBMITTED"
  | "APPROVED"
  | "ARCHIVED";

export type LessonNoteAction = "SUBMIT" | "RESUBMIT" | "RETURN" | "APPROVE" | "ARCHIVE";

const transitions: Record<LessonNoteAction, Partial<Record<LessonNoteStatus, LessonNoteStatus>>> = {
  SUBMIT: { DRAFT: "SUBMITTED" },
  RESUBMIT: { RETURNED: "RESUBMITTED" },
  RETURN: { SUBMITTED: "RETURNED", RESUBMITTED: "RETURNED" },
  APPROVE: { SUBMITTED: "APPROVED", RESUBMITTED: "APPROVED" },
  ARCHIVE: { APPROVED: "ARCHIVED" },
};

export function transitionLessonNote(status: LessonNoteStatus, action: LessonNoteAction): LessonNoteStatus {
  const next = transitions[action][status];
  if (!next) throw new Error(`Invalid lesson note transition: ${status} to ${action}`);
  return next;
}

export function assertRevision(expectedRevision: unknown, currentRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== currentRevision) {
    throw new Error("Lesson note has changed; reload the latest revision before continuing");
  }
}

const submitRequiredContent = ["topic", "lessonContent", "assessment"] as const;
export function assertLessonNoteSubmittable(content: Record<string, unknown>): void {
  for (const key of submitRequiredContent) {
    const value = content[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`A non-empty ${key} field is required before submitting`);
    }
  }
}

export const curriculumSourceKinds = ["OFFICIAL", "SCHOOL_SPECIFIC", "EDUCORE_SEQUENCE", "AI_ASSISTANCE"] as const;

export function assertCurriculumSourceKind(value: unknown): asserts value is (typeof curriculumSourceKinds)[number] {
  if (typeof value !== "string" || !curriculumSourceKinds.includes(value as (typeof curriculumSourceKinds)[number])) {
    throw new Error("sourceKind must identify OFFICIAL, SCHOOL_SPECIFIC, EDUCORE_SEQUENCE, or AI_ASSISTANCE provenance");
  }
}

export function assertCurriculumVersionMutable(status: string): void {
  if (status !== "DRAFT") throw new Error("Published and archived curriculum versions are immutable; clone to make changes");
}

export function mapCurriculumImportRows(
  rows: Array<{ sourceRow: number; values: Record<string, string> }>,
  mapping: Record<string, string>,
  headers: string[],
): Array<{ sourceRow: number; values: Record<string, string> }> {
  const allowed = new Set(["classLevel", "subjectCode", "title", "learningObjectives", "learningOutcomes", "suggestedResources"]);
  for (const target of Object.keys(mapping)) {
    if (!allowed.has(target)) throw new Error(`Unsupported curriculum field: ${target}`);
    if (!headers.includes(mapping[target])) throw new Error(`Mapped column for ${target} is not present in the uploaded file`);
  }
  return rows.map((row) => ({
    sourceRow: row.sourceRow,
    values: Object.fromEntries(Object.entries(mapping).map(([key, column]) => [key, row.values[column] ?? ""])),
  }));
}