import { beforeEach, expect, it, vi } from "vitest";
import { resolveSchoolNfcFeeLines, schoolNfcPublicationAssignments, SCHOOL_NFC_FEE_NAME } from "./school-nfc-fee";
import { isReservedPlatformNfcCategory } from "./student-nfc-policy";
let stored: { id: number; status: string } | undefined;
const query = vi.fn(async (sql: string) => {
  if (sql.includes("SELECT id,status")) return { rows: stored ? [stored] : [] };
  if (sql.includes("INSERT INTO fee_categories")) return { rows: [{ id: 50, status: "ACTIVE" }] };
  return { rows: [] };
});
beforeEach(() => { stored = undefined; query.mockClear(); });
it("identifies the built-in charge as school-owned, not the separate reserved platform subscription", () => {
  expect(isReservedPlatformNfcCategory(SCHOOL_NFC_FEE_NAME)).toBe(false);
  expect(isReservedPlatformNfcCategory("NFC Card Subscription")).toBe(true);
});
it("creates the built-in school category only during explicit draft save, with no default charge", async () => {
  expect(await resolveSchoolNfcFeeLines({ query }, 7, 3, [{ builtInCategory: "SCHOOL_NFC", amountMinor: 725000 }]))
    .toEqual([{ categoryId: 50, amountMinor: 725000, description: SCHOOL_NFC_FEE_NAME }]);
  const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO fee_categories"));
  expect(insert).toBeDefined();
  expect(JSON.stringify(query.mock.calls)).not.toMatch(/fee_invoices|student_subscriptions|flutterwave|320000|200000/i);
});
it("reuses only the selected school's active canonical category without altering history", async () => {
  stored = { id: 41, status: "ACTIVE" };
  expect(await resolveSchoolNfcFeeLines({ query }, 7, 3, [{ builtInCategory: "SCHOOL_NFC", amountMinor: 10000 }]))
    .toEqual([{ categoryId: 41, amountMinor: 10000, description: SCHOOL_NFC_FEE_NAME }]);
  expect(query.mock.calls.some(([sql]) => /INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("school_id=$1"), [7, SCHOOL_NFC_FEE_NAME]);
});
it.each([undefined, null, 0, -1, 0.5, 2147483648])("rejects missing or invalid school amount %s before any category writes", async amountMinor => {
  await expect(resolveSchoolNfcFeeLines({ query }, 7, 3, [{ builtInCategory: "SCHOOL_NFC", amountMinor } as any])).rejects.toMatchObject({ statusCode: 400 });
  expect(query).not.toHaveBeenCalled();
});
it("rejects ambiguous category identity, duplicate built-ins and an inactive retained category", async () => {
  await expect(resolveSchoolNfcFeeLines({ query }, 7, 3, [{ categoryId: 1, builtInCategory: "SCHOOL_NFC", amountMinor: 100 }])).rejects.toMatchObject({ statusCode: 400 });
  await expect(resolveSchoolNfcFeeLines({ query }, 7, 3, [{ amountMinor: 100 }])).rejects.toMatchObject({ statusCode: 400 });
  await expect(resolveSchoolNfcFeeLines({ query }, 7, 3, Array(2).fill({ builtInCategory: "SCHOOL_NFC", amountMinor: 100 }))).rejects.toMatchObject({ statusCode: 400 });
  stored = { id: 41, status: "INACTIVE" };
  await expect(resolveSchoolNfcFeeLines({ query }, 7, 3, [{ builtInCategory: "SCHOOL_NFC", amountMinor: 100 }])).rejects.toMatchObject({ statusCode: 409 });
  expect(query.mock.calls.some(([sql]) => /INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
});
it("never automatically issues invoices on publication or publication retry for a school NFC schedule", async () => {
  const issue = vi.fn();
  const lines = [{ categoryName: SCHOOL_NFC_FEE_NAME, amountMinor: 725000 }];
  await schoolNfcPublicationAssignments(lines, issue);
  await schoolNfcPublicationAssignments(lines, issue);
  expect(issue).not.toHaveBeenCalled();
  expect(lines[0].amountMinor).toBe(725000);
});
it.each([0, -1, NaN])("blocks publication with invalid NFC amount %s", async amountMinor => {
  const issue = vi.fn();
  await expect(schoolNfcPublicationAssignments([{ categoryName: SCHOOL_NFC_FEE_NAME, amountMinor }], issue))
    .rejects.toMatchObject({ statusCode: 400 });
  expect(issue).not.toHaveBeenCalled();
});
it("does not redesign the established publication policy for unrelated ordinary fees", async () => {
  const issue = vi.fn(async () => ({ assignedCount: 2 }));
  expect(await schoolNfcPublicationAssignments([{ categoryName: "Tuition", amountMinor: 10000 }], issue)).toEqual({ assignedCount: 2 });
});
