import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  live: true, identity: { id: 7, name: "Greenfield Fixture Academy" }, row: undefined as any,
  proofs: new Map<string, string>(), seq: 0, resolve: vi.fn(), directory: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ pool: {} }));
vi.mock("./owner-receiving-account-lookup", () => ({ requireOwnerLookupLive: () => {
  if (!f.live) throw Object.assign(new Error("LIVE unavailable: Development cannot verify"), { status: 409 });
} }));
vi.mock("../lib/payment-account-provider-validation", () => ({ requireVerifiedPaymentAccountProvider: f.directory }));
vi.mock("../lib/flutterwave-payroll-v3", () => ({ FlutterwavePayrollV3Client: class { resolveNigerianAccount = f.resolve; } }));
vi.mock("../lib/payroll-bank-encryption", () => ({
  encryptPayrollBankValue: (value: string, aad: string) => {
    const ciphertext = `opaque-${++f.seq}`; f.proofs.set(`${aad}:${ciphertext}`, value);
    return { ciphertext, keyVersion: "fixture" };
  },
  decryptPayrollBankValue: (ciphertext: string, version: string, aad: string) => {
    const value = f.proofs.get(`${aad}:${ciphertext}`);
    if (version !== "fixture" || !value) throw Error("Unauthenticated evidence");
    return value;
  },
}));
import { acceptSchoolFeeBankProof, lookupSchoolFeeBank, schoolBeneficiaryMatches,
  schoolFeeBankVerified, schoolBankFingerprint } from "./school-fee-bank-verification";
const selection = { bankName: "Fictional Alpha Bank", bankCode: "90001", accountNumber: "0123456789" };
const db = { query: vi.fn(async (sql: string) => {
  if (sql.startsWith("SELECT id,name")) return { rows: [f.identity] };
  if (sql.includes("FROM fee_school_settings")) return { rows: f.row ? [f.row] : [] };
  if (sql.includes("FROM audit_logs")) return { rows: [] as any[] };
  throw Error("Unexpected SQL");
}) };
async function proof() {
  const lookup = await lookupSchoolFeeBank(db, 10, 7, selection);
  return { ...selection, accountName: lookup.accountName, lookupToken: lookup.lookupToken };
}
beforeEach(() => {
  vi.useRealTimers(); vi.clearAllMocks(); f.proofs.clear(); f.live = true; f.row = undefined;
  f.identity = { id: 7, name: "Greenfield Fixture Academy" };
  f.directory.mockResolvedValue(undefined);
  f.resolve.mockResolvedValue({ resolvedAccountNumber: selection.accountNumber, resolvedAccountName: "GREENFIELD FIXTURE ACADEMY" });
});
describe("official school bank beneficiary evidence", () => {
  it.each([
    ["Greenfield Fixture Academy", "greenfield   fixture academy", true],
    ["Greenfield-Fixture Academy", "GREENFIELD FIXTURE ACADEMY", true],
    ["Greenfield 2 Academy", "GREENFIELD 2 ACADEMY", true],
    ["Greenfield Fixture Academy", "Greenfield Academy", false],
    ["Greenfield Fixture Academy", "Fixture Greenfield Academy", false],
    ["Greenfield Fixture Academy", "Greenfield Fixture Academy LTD", false],
    ["St Mary Academy", "Saint Mary Academy", false],
    ["School & Academy", "School and Academy", false],
    ["School", "SCHOOL", false],
  ])("conservatively matches %s / %s", (official, resolved, expected) => {
    expect(schoolBeneficiaryMatches(official, resolved)).toBe(expected);
  });
  it("mints opaque, actor/school-bound proof without writing bank details or returning full numbers", async () => {
    const lookup = await lookupSchoolFeeBank(db, 10, 7, selection);
    expect(lookup.accountLast4).toBe("6789"); expect(JSON.stringify(lookup)).not.toContain(selection.accountNumber);
    expect(db.query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
    expect(f.resolve).toHaveBeenCalledWith(selection, { requireOwnerLive: true });
    const input = { ...selection, accountName: lookup.accountName, lookupToken: lookup.lookupToken };
    expect(acceptSchoolFeeBankProof(10, f.identity, undefined, input).schoolId).toBe(7);
  });
  it.each(["actor", "school", "identity", "bank", "number", "accountName", "revision", "tamper", "expiry", "future"])("rejects changed %s", async field => {
    vi.useFakeTimers(); const input = await proof();
    let actor = 10; let identity = { ...f.identity }; let row: any;
    if (field === "actor") actor = 11;
    if (field === "school") identity.id = 8;
    if (field === "identity") identity.name = "Other Fixture Academy";
    if (field === "bank") input.bankCode = "90002";
    if (field === "number") input.accountNumber = "9999999999";
    if (field === "accountName") input.accountName = "Someone Else";
    if (field === "revision") row = { bankName: "Changed" };
    if (field === "tamper") input.lookupToken = '{"ciphertext":"invented","keyVersion":"fixture"}';
    if (field === "expiry") vi.advanceTimersByTime(300001);
    if (field === "future") vi.setSystemTime(Date.now() - 1);
    expect(() => acceptSchoolFeeBankProof(actor, identity, row, input)).toThrow();
  });
  it("rejects Development/Sandbox before provider or directory access, and on save", async () => {
    const input = await proof(); f.resolve.mockClear(); f.directory.mockClear(); f.live = false;
    await expect(lookupSchoolFeeBank(db, 10, 7, selection)).rejects.toThrow("Development");
    expect(() => acceptSchoolFeeBankProof(10, f.identity, undefined, input)).toThrow("Development");
    expect(f.resolve).not.toHaveBeenCalled(); expect(f.directory).not.toHaveBeenCalled();
  });
  it.each(["name", "number", "provider", "directory"])("fails closed on %s mismatch/failure", async kind => {
    if (kind === "name") f.resolve.mockResolvedValue({ resolvedAccountNumber: selection.accountNumber, resolvedAccountName: "Other Academy" });
    if (kind === "number") f.resolve.mockResolvedValue({ resolvedAccountNumber: "1111111111", resolvedAccountName: f.identity.name });
    if (kind === "provider") f.resolve.mockRejectedValue(Error("Unavailable"));
    if (kind === "directory") f.directory.mockRejectedValue(Error("Unsupported bank"));
    await expect(lookupSchoolFeeBank(db, 10, 7, selection)).rejects.toThrow();
    expect(f.proofs.size).toBe(0);
  });
  it("never trusts a legacy enabled row without matching verification audit evidence", async () => {
    const row = { bankTransferEnabled: true, bankName: selection.bankName, accountName: f.identity.name, accountNumber: selection.accountNumber };
    expect(await schoolFeeBankVerified(db, 7, row, f.identity)).toBe(false);
    expect(db.query.mock.calls.at(-1)?.[0]).toContain("finance settings: verified school bank");
    expect(schoolBankFingerprint(row)).not.toContain(selection.accountNumber);
  });
});
