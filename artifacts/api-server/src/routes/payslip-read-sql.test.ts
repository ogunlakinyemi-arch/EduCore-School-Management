import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./settlement-payroll.ts", import.meta.url), "utf8");
const select = source.match(/const MY_PAYSLIPS_SELECT = `([\s\S]*?)`;/)![1];

describe("own payslip SQL regression guards", () => {
  it("reads the adjustment reason from the existing finalized payroll item", () => {
    expect(select).toContain("i.adjustment_reason");
    expect(select).not.toContain("s.adjustment_reason");
  });

  it("maps the payslip issuance timestamp to the existing response field", () => {
    expect(select).toContain("s.issued_at AS created_at");
    expect(select).not.toContain("s.created_at");
  });
});