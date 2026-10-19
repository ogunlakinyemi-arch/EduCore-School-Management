import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportContext } from "./core";
import { parseReportFilters } from "./core";

const query = vi.hoisted(() => vi.fn());
vi.mock("@workspace/db", () => ({ pool: { query } }));
import { directoryReports } from "./directories";

const ctx = { schoolId: 10, role: "ADMIN" } as ReportContext;

beforeEach(() => {
  query.mockReset().mockImplementation(async (sql: string) => ({
    rows: sql.includes("COUNT(*)") ? [{ total: 450 }] : [],
  }));
});

describe("bounded directory projections", () => {
  it.each(["students", "classes", "parents", "staff", "teachers"])("restricts %s to one school and a stable bounded page", async kind => {
    const definition = directoryReports[`directory-${kind}`]!;
    expect(definition.roles).toEqual(["OWNER", "ADMIN"]);
    const result = await definition.run(ctx, parseReportFilters({ limit: "200", offset: "200" }));
    expect(query).toHaveBeenCalledTimes(2);
    const [count, data] = query.mock.calls;
    expect(count![0]).toContain("WHERE school_id=$1");
    expect(data![0]).toContain("WHERE school_id=$1");
    expect(data![0]).toMatch(/ORDER BY .*, id LIMIT \$\d OFFSET \$\d/);
    expect(count![1][0]).toBe(10);
    expect(data![1].slice(-2)).toEqual([200, 200]);
    expect(result.total).toBe(450);
    expect(result.columns.map(c => c.key).join(" ")).not.toMatch(/salary|bank|allocation|medical|user_id|photo/);
    expect(data![0]).not.toContain("SELECT *");
    if (kind === "staff" || kind === "teachers") {
      expect(count![0]).toContain(kind === "staff" ? "employee_type<>$2" : "employee_type=$2");
      expect(count![1][1]).toBe("TEACHER");
    }
  });

  it("requires explicit school selection even for Owner", async () => {
    await expect(directoryReports["directory-parents"]!.run(
      { ...ctx, role: "OWNER", schoolId: null }, parseReportFilters({}),
    )).rejects.toThrow("Select a school");
    expect(query).not.toHaveBeenCalled();
  });
});
