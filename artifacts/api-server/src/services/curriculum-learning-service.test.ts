import { describe, expect, it } from "vitest";
import {
  assertCurriculumSourceKind,
  assertCurriculumVersionMutable,
  assertLessonNoteSubmittable,
  assertRevision,
  mapCurriculumImportRows,
  transitionLessonNote,
} from "./curriculum-learning-service";

describe("curriculum and lesson-note invariants", () => {
  it("allows only the explicit weekly review workflow transitions", () => {
    expect(transitionLessonNote("DRAFT", "SUBMIT")).toBe("SUBMITTED");
    expect(transitionLessonNote("RETURNED", "RESUBMIT")).toBe("RESUBMITTED");
    expect(transitionLessonNote("RESUBMITTED", "APPROVE")).toBe("APPROVED");
    expect(transitionLessonNote("APPROVED", "ARCHIVE")).toBe("ARCHIVED");
    expect(() => transitionLessonNote("APPROVED", "RETURN")).toThrow("Invalid lesson note transition");
    expect(() => transitionLessonNote("ARCHIVED", "SUBMIT")).toThrow("Invalid lesson note transition");
  });

  it("requires valid submitted note content and detects stale row revisions", () => {
    expect(() => assertLessonNoteSubmittable({ topic: "Fractions", lessonContent: "", assessment: "Quiz" }))
      .toThrow("lessonContent");
    expect(() => assertRevision(2, 3)).toThrow("reload the latest revision");
    expect(() => assertRevision(3, 3)).not.toThrow();
  });

  it("keeps published/archived curriculum immutable and distinguishes provenance", () => {
    expect(() => assertCurriculumVersionMutable("PUBLISHED")).toThrow("clone");
    expect(() => assertCurriculumVersionMutable("ARCHIVED")).toThrow("clone");
    expect(() => assertCurriculumVersionMutable("DRAFT")).not.toThrow();
    expect(() => assertCurriculumSourceKind("OFFICIAL")).not.toThrow();
    expect(() => assertCurriculumSourceKind("AI_ASSISTANCE")).not.toThrow();
    expect(() => assertCurriculumSourceKind("GOVERNMENT_APPROVED_AI")).toThrow("sourceKind");
  });

  it("maps only reviewed columns that exist in extracted data, without inventing PDF data", () => {
    const mapped = mapCurriculumImportRows(
      [{ sourceRow: 2, values: { Grade: "JSS2", Subject: "Mathematics", Topic: "Fractions" } }],
      { classLevel: "Grade", subjectCode: "Subject", title: "Topic" },
      ["Grade", "Subject", "Topic"],
    );
    expect(mapped[0].values).toEqual({ classLevel: "JSS2", subjectCode: "Mathematics", title: "Fractions" });
    expect(() => mapCurriculumImportRows([], { title: "Not a source column" }, ["Topic"]))
      .toThrow("not present");
    expect(() => mapCurriculumImportRows([], { fabricated: "Topic" }, ["Topic"]))
      .toThrow("Unsupported curriculum field");
  });
});