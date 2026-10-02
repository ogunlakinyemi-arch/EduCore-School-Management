import { describe, expect, it } from "vitest";
import { generateSchoolRegistrationNumber, registrationNumberChanged } from "./school-registration-number";

describe("permanent platform school registration numbers", () => {
  it("generates a server-owned number without user input", () => {
    const values = Array.from({ length: 100 }, generateSchoolRegistrationNumber);
    expect(new Set(values).size).toBe(100);
    for (const value of values) expect(value).toMatch(/^YEM-SCH-[A-F0-9-]{36}$/);
  });
  it("does not replace a legacy empty number when unrelated fields are edited", () => {
    expect(registrationNumberChanged(undefined, null)).toBe(false);
    expect(registrationNumberChanged(null, null)).toBe(false);
    expect(registrationNumberChanged("", null)).toBe(false);
    expect(registrationNumberChanged("YEM-SCH-NEW", null)).toBe(true);
  });
  it("accepts an unchanged value but rejects replacement or removal", () => {
    expect(registrationNumberChanged("YEM-SCH-ORIGINAL", "YEM-SCH-ORIGINAL")).toBe(false);
    expect(registrationNumberChanged("YEM-SCH-OTHER", "YEM-SCH-ORIGINAL")).toBe(true);
    expect(registrationNumberChanged(null, "YEM-SCH-ORIGINAL")).toBe(true);
  });
});