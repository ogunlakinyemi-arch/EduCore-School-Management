import { describe, expect, it, vi } from "vitest";
import { refreshConfiguredTermCalendarEvents } from "./academicCalendarProjection";

describe("refreshConfiguredTermCalendarEvents", () => {
  it("deactivates only generated active entries that fall outside updated term/session bounds", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({
      rows: [{ id: 4 }, { id: 5 }],
    }));
    const refreshed = await refreshConfiguredTermCalendarEvents({ query }, {
      schoolId: 1,
      sessionId: 8,
      termId: 11,
      actorUserId: 42,
    });

    expect(refreshed).toBe(2);
    expect(query).toHaveBeenCalledOnce();
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("ce.source='GENERATED'");
    expect(sql).toContain("ce.status='ACTIVE'");
    expect(sql).toContain("ce.category='RESULT_PUBLICATION'");
    expect(values).toEqual([1, 8, 11, 42]);
  });

  it("returns zero when no configured entries require deactivation", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }));
    await expect(refreshConfiguredTermCalendarEvents({ query }, {
      schoolId: 1,
      sessionId: 8,
      termId: 11,
      actorUserId: 42,
    })).resolves.toBe(0);
  });
});