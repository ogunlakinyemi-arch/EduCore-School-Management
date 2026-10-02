import { describe, expect, it } from "vitest";
import {
  preparePromotionBatchInputSchema,
  promotionBatchDetailSchema,
  promotionReviewInputSchema,
} from "./promotion-expansion-service";

describe("promotion expansion input and output contracts", () => {
  it("requires two distinct-shaped positive session identifiers at the API boundary", () => {
    expect(preparePromotionBatchInputSchema.safeParse({
      sourceSessionId: 11,
      targetSessionId: 12,
    }).success).toBe(true);
    expect(preparePromotionBatchInputSchema.safeParse({
      sourceSessionId: "11",
      targetSessionId: 12,
    }).success).toBe(false);
    expect(preparePromotionBatchInputSchema.safeParse({
      sourceSessionId: 0,
      targetSessionId: 12,
    }).success).toBe(false);
  });

  it("requires a reason and a complete target for Promote/Repeat, and forbids targets for other outcomes", () => {
    expect(promotionReviewInputSchema.safeParse({
      status: "Promoted",
      reason: "Reviewed results and attendance",
      targetTermId: 4,
      targetClassId: 7,
      targetSection: "B",
    }).success).toBe(true);
    expect(promotionReviewInputSchema.safeParse({
      status: "Promoted",
      reason: "",
    }).success).toBe(false);
    expect(promotionReviewInputSchema.safeParse({
      status: "Promoted",
      reason: "Missing reviewed placement",
    }).success).toBe(false);
    expect(promotionReviewInputSchema.safeParse({
      status: "Graduated",
      reason: "Completed the final grade",
      targetClassId: 7,
    }).success).toBe(false);
    expect(promotionReviewInputSchema.safeParse({
      status: "Transferred",
      reason: "Leaving the school",
      targetClassId: 7,
    }).success).toBe(false);
  });

  it("validates response placement, real summary, advisory recommendation, and lifecycle status shape", () => {
    const response = {
      id: 1,
      schoolId: 9,
      sourceSessionId: 11,
      targetSessionId: 12,
      status: "Prepared",
      createdAt: "2026-01-01T00:00:00.000Z",
      finalizedAt: null,
      studentCount: 1,
      students: [{
        studentId: 20,
        studentName: "A Student",
        admissionNumber: "ADM-20",
        sourcePlacement: {
          sessionId: 11,
          classId: 5,
          className: "JSS1",
          section: "A",
          termId: null,
        },
        targetPlacement: null,
        status: "Eligible",
        recommendation: "Eligible",
        reason: null,
        academicPerformance: { resultCount: 4, scoredCount: 4, averageScore: 76.25 },
        attendanceSummary: {
          presentCount: 15,
          absentCount: 1,
          lateCount: 2,
          recordedCount: 18,
          attendanceRate: 94.44,
        },
      }],
    };
    expect(promotionBatchDetailSchema.parse(response)).toEqual(response);
    expect(promotionBatchDetailSchema.safeParse({
      ...response,
      students: [{ ...response.students[0], admissionNumber: null }],
    }).success).toBe(false);
  });
});