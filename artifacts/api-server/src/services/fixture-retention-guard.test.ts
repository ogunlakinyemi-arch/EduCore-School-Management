import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
// Test the offline CLI utility without pulling the scripts project into the API's rootDir.
const guardPath = new URL("../../../../scripts/src/fixture-retention-guard.ts", import.meta.url).pathname;
const { immutableGuards, validateRetentionGuards, retireFixture,
  captureOriginalRows, verifyOriginalRows } = await import(guardPath);

const validGuards = () => immutableGuards.map(([table, trigger, fn, message]: readonly string[]) => ({
  table_name: table, trigger_name: trigger, enabled: "O", trigger_type: 27,
  argument_count: 0, function_name: fn, function_schema: "public", security_definer: false,
  function_source: `\nBEGIN\n RAISE EXCEPTION '${message}';\nEND;\n`,
  definition: `CREATE TRIGGER ${trigger} BEFORE DELETE OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
}));
const label = "EDUCORE-EXPANSION-TEST-ABCDEF0123456789";
const users = Array.from({ length: 7 }, (_, i) => ({
  appUserId: i + 10, clerkUserId: `fixture_${i}`, email: `role${i}-abcdef0123456789@example.com`,
}));
describe("Development fixture guard without immutable-history bypass", () => {
  it("recognizes all three unchanged security/promotion protection functions", () => {
    expect(() => validateRetentionGuards(validGuards())).not.toThrow();
  });
  it.each(["disabled", "missing", "unknown", "body", "schema", "conditional", "security-definer", "statement"])(
    "rejects unsafe guard alteration: %s", kind => {
      const rows = validGuards();
      if (kind === "disabled") rows[1].enabled = "D";
      if (kind === "missing") rows.pop();
      if (kind === "unknown") rows[1].trigger_name = "unexpected";
      if (kind === "body") rows[1].function_source = "BEGIN RETURN OLD; END;";
      if (kind === "schema") rows[1].function_schema = "other_school";
      if (kind === "conditional") rows[1].definition += " WHEN (false)";
      if (kind === "security-definer") rows[1].security_definer = true;
      if (kind === "statement") rows[1].trigger_type = 26;
      expect(() => validateRetentionGuards(rows)).toThrow();
    });
  it("retirement changes only exact-owned mutable state and derived presence", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 10 }] }) };
    await retireFixture(client, 20, label, users);
    const writes = client.query.mock.calls.filter(([sql]) => /^(UPDATE|DELETE)/.test(sql));
    expect(writes).toHaveLength(10);
    expect(writes.every(([sql]) => !/security_events|history|audit_logs/.test(sql))).toBe(true);
    expect(writes.find(([sql]) => sql.startsWith("DELETE"))).toEqual([
      "DELETE FROM public.campus_presence WHERE school_id=$1", [20],
    ]);
  });
  it.each(["school", "user", "baseline", "label"])("refuses unowned %s before any writes", async kind => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 10 }] }) };
    if (kind === "school") client.query.mockResolvedValueOnce({ rows: [] });
    if (kind === "user") client.query.mockResolvedValueOnce({ rows: [{ id: 20 }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(retireFixture(client, 20, kind === "label" ? "REAL-SCHOOL" : label,
      kind === "baseline" ? users.map(u => ({ ...u, email: "real-person@example.com" })) : users)).rejects.toThrow();
    expect(client.query.mock.calls.some(([sql]) => /^(UPDATE|DELETE)/.test(sql))).toBe(false);
  });
  it("contains no trigger-disabling or replication-role bypass in the CLI", () => {
    const source = readFileSync(new URL("../../../../scripts/src/educore-expansion-browser-fixtures.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/DISABLE\s+TRIGGER|session_replication_role\s*=/i);
  });
  it("preservation permits appended audit evidence but rejects missing original rows", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ column_name: "id" }] })
      .mockResolvedValueOnce({ rows: [{ hash: "original", count: 1 }] }) };
    const snapshot = await captureOriginalRows(client, ["audit_logs"]);
    client.query.mockResolvedValueOnce({ rows: [{ column_name: "id" }] })
      .mockResolvedValueOnce({ rows: [{ hash: "original", count: 1 }, { hash: "new", count: 1 }] });
    await expect(verifyOriginalRows(client, snapshot)).resolves.toMatchObject({ originalRows: 1, missing: 0 });
    client.query.mockResolvedValueOnce({ rows: [{ column_name: "id" }] })
      .mockResolvedValueOnce({ rows: [{ hash: "new", count: 2 }] });
    await expect(verifyOriginalRows(client, snapshot)).rejects.toThrow();
  });
});