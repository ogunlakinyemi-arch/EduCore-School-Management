import { describe, expect, it } from "vitest";
import { CreateEmployeeBody, GetStudentSelfProfileResponse } from "@workspace/api-zod";

describe("existing managed photo references", () => {
  const student = {
    id: 1, schoolId: 1, admissionNo: "UNIT-1", firstName: "Unit", lastName: "Student",
    gender: "female", className: "Primary 1", section: "A", status: "ACTIVE",
    subscriptionStatus: "active", cardStatus: "unassigned", joinedAt: "2026-10-04T00:00:00.000Z",
  };
  it("accepts the existing student upload reference in the self-profile response", () => {
    expect(GetStudentSelfProfileResponse.safeParse({
      ...student, passportUrl: "/objects/student-photos/1/1/unit-photo",
    }).success).toBe(true);
  });
  it("continues accepting a legacy absolute image URL and a missing photo", () => {
    expect(GetStudentSelfProfileResponse.safeParse({
      ...student, passportUrl: "https://example.com/unit-photo.png",
    }).success).toBe(true);
    expect(GetStudentSelfProfileResponse.safeParse({ ...student, passportUrl: null }).success).toBe(true);
  });
  it("does not require a second copy of an employee's managed photo", () => {
    expect(CreateEmployeeBody.safeParse({
      firstName: "Unit", lastName: "Employee", type: "TEACHER",
      photoUrl: "/objects/employee-photos/1/1/unit-photo",
    }).success).toBe(true);
  });
});