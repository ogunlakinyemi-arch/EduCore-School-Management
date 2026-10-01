import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { parseReportFilters } from "./core";
import { serializeReportExport, serializeSchoolBrandedPdfExport } from "./exports";

describe("reporting foundation", () => {
  it("parses bounded, calendar-valid report filters", () => {
    expect(parseReportFilters({
      schoolId: "7",
      from: "2025-01-01",
      to: "2025-01-31",
      sessionId: "2",
      section: " Blue ",
      limit: "25",
      offset: "10",
    })).toEqual({
      schoolId: 7,
      from: "2025-01-01",
      to: "2025-01-31",
      sessionId: 2,
      termId: undefined,
      classId: undefined,
      section: "Blue",
      subjectId: undefined,
      studentId: undefined,
      status: undefined,
      method: undefined,
      limit: 25,
      offset: 10,
    });
  });

  it("rejects invalid and unsupported filter values", () => {
    expect(() => parseReportFilters({ from: "2025-02-30" })).toThrow("valid calendar date");
    expect(() => parseReportFilters({ from: "2025-03-02", to: "2025-03-01" })).toThrow("from must not be later");
    expect(() => parseReportFilters({ limit: "201" })).toThrow("must not exceed 200");
    expect(() => parseReportFilters({ role: "OWNER" })).toThrow("Unsupported report filter");
    expect(() => parseReportFilters({ classId: ["1", "2"] })).toThrow("single value");
  });

  it("exports only declared result columns and neutralizes spreadsheet formulas", () => {
    const result = {
      title: "Student report",
      columns: [{ key: "name", label: "Name" }],
      rows: [{ name: "=SUM(1,1)", secret: "not for export" }],
      total: 1,
      summary: { secret: "not for export" },
    };
    const csv = serializeReportExport("csv", result);
    expect(csv.body.toString("utf8")).toContain("'=SUM(1,1)");
    expect(csv.body.toString("utf8")).not.toContain("not for export");

    const xlsx = serializeReportExport("xlsx", result);
    expect(xlsx.body.subarray(0, 2).toString("hex")).toBe("504b");
    expect(xlsx.body.toString("utf8")).not.toContain("not for export");
    expect(xlsx.filename).toBe("Student-report.xlsx");

    const pdf = serializeReportExport("pdf", result);
    expect(pdf.body.toString("ascii")).toContain("%PDF-1.4");
    expect(pdf.body.toString("ascii")).not.toContain("not for export");
  });

  it("embeds validated school identity and a private logo in report PDFs", async () => {
    const result = {
      title: "Annual student report",
      columns: [{ key: "name", label: "Name" }],
      rows: [{ name: "Ade O." }],
      total: 1,
    };
    const logoBytes = await sharp({
      create: { width: 4, height: 3, channels: 4, background: "#2675b8" },
    }).png().toBuffer();
    const exported = await serializeSchoolBrandedPdfExport(result, {
      name: "Test Academy",
      address: "12 Main Street",
      city: "Lagos",
      state: "Lagos",
      phone: "+234 800 000 0000",
      email: "school@example.test",
      logoBytes,
    });
    const pdf = exported.body;
    expect(pdf.toString("ascii")).toContain("/Subtype /Image");
    expect(pdf.toString("ascii")).toContain("/SchoolLogo Do Q");
    expect(pdf.toString("ascii")).toContain("Test Academy");
    expect(pdf.toString("ascii")).toContain("Annual student report");
    const startXref = Number(/startxref\n(\d+)/.exec(pdf.toString("latin1"))?.[1]);
    expect(pdf.subarray(startXref, startXref + 4).toString("ascii")).toBe("xref");
    expect(exported.contentType).toBe("application/pdf");
  });
});