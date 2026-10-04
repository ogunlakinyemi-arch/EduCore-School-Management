import { describe, expect, it } from "vitest";
import { generateEmployeeNumber, generateSchoolCode, generateSubjectCode } from "./generated-person-codes";

describe("automatic permanent identifier generation", () => {
  it("generates employee identifiers without user input and records their original school namespace", () => {
    expect(generateEmployeeNumber(12)).toMatch(/^EMP-12-[A-F0-9]{12}$/);
  });
  it("does not reuse employee numbers across repeated creation or another school", () => {
    const values = Array.from({ length: 100 }, (_, i) => generateEmployeeNumber(i % 2 + 1));
    expect(new Set(values).size).toBe(values.length);
  });
  it("keeps school codes within the existing ten-character contract", () => {
    expect(generateSchoolCode("Alpha Academy")).toMatch(/^ALP-[A-F0-9]{6}$/);
    expect(generateSchoolCode(" A ")).toMatch(/^A-[A-F0-9]{6}$/);
    expect(generateSchoolCode("!!!")).toMatch(/^EDU-[A-F0-9]{6}$/);
  });
  it("generates different codes for similar school names", () => {
    const values = Array.from({ length: 100 }, () => generateSchoolCode("Alpha Academy"));
    expect(new Set(values).size).toBe(values.length);
  });
  it("derives subject initials from the name without creating curriculum content", () => {
    expect(generateSubjectCode("English Language")).toMatch(/^EL-[A-F0-9]{6}$/);
    expect(generateSubjectCode("Mathematics")).toMatch(/^M-[A-F0-9]{6}$/);
  });
});