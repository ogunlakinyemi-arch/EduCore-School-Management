import express from "express";
import type { Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pool: null as any }));
vi.mock("@workspace/db", () => ({ pool: {
  query: (...args: any[]) => state.pool.query(...args),
  connect: () => state.pool.connect(),
} }));
vi.mock("../middlewares/auth", async original => ({
  ...await original<typeof import("../middlewares/auth")>(),
  requireAuthentication: () => (req: any, _res: any, next: any) => {
    const owner = req.header("x-role") !== "ADMIN";
    req.edupulseUser = { user: { id: 99, clerkUserId: "fixture", email: "owner@example.invalid",
      firstName: "Fixture", lastName: "Reviewer", status: "ACTIVE" },
      roles: [{ id: 1, role: owner ? "PLATFORM_OWNER" : "SCHOOL_ADMIN",
        schoolId: owner ? null : 7, status: "ACTIVE" }] };
    next();
  },
}));
import router from "./settlement-payroll";
import { encryptPayrollBankValue } from "../lib/payroll-bank-encryption";
import { FlutterwavePayrollV3Client } from "../lib/flutterwave-payroll-v3";
const root = mkdtempSync(join(tmpdir(), "bank-review-fixture-")), data = join(root, "data");
const clean = { PATH: process.env.PATH, HOME: root, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
let server: Server, base: string;
const target = "/platform/finance/payment-settlement/schools/7";
const evidence = "a".repeat(64);
async function call(path: string, input?: unknown, key = "fixture-review-key", role = "OWNER") {
  return fetch(base + path, { method: input ? "POST" : "GET", headers: {
    "content-type": "application/json", "Idempotency-Key": key, "x-role": role,
  }, ...(input ? { body: JSON.stringify(input) } : {}) });
}
async function review(decision = "VERIFY") {
  const p = await (await call(target)).json() as { reviewSnapshot: string };
  return { decision, expectedSnapshot: p.reviewSnapshot, evidenceSha256: evidence,
    independentAccountMatchConfirmed: true, note: "Independent fixture evidence reviewed for this submitted account." };
}
async function status() {
  return (await state.pool.query("SELECT verification_status,verified_at,verified_by FROM settlement_payroll_profiles WHERE id=1")).rows[0];
}
beforeAll(async () => {
  execFileSync("initdb", ["-D", data, "-U", "fixture_owner", "-A", "trust", "--no-locale", "--encoding=UTF8"], { env: clean, stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", data, "-l", join(root, "server.log"), "-o",
    `-c listen_addresses='' -c unix_socket_directories='${root}' -p 55434`, "-w", "start"], { env: clean, stdio: "ignore" });
  state.pool = new pg.Pool({ host: root, port: 55434, user: "fixture_owner", database: "postgres", max: 4 });
  expect((await state.pool.query("SELECT current_setting('data_directory') AS dir,inet_server_addr() AS addr")).rows[0])
    .toEqual({ dir: data, addr: null });
  await state.pool.query(`CREATE TABLE schools(id integer PRIMARY KEY,name text);
    INSERT INTO schools VALUES(7,'Fictional Evidence School');
    CREATE TABLE settlement_payroll_profiles(id serial PRIMARY KEY,scope text,school_id integer REFERENCES schools(id),
      business_name text,business_registration_number text,settlement_contact_email text,settlement_contact_phone text,
      bank_name_encrypted text,bank_code_encrypted text,account_name_encrypted text,account_number_encrypted text,
      encryption_key_version text,account_last4 text,currency text DEFAULT 'NGN',provider text DEFAULT 'FLUTTERWAVE',
      provider_business_id text,provider_subaccount_id text,verification_status text DEFAULT 'PENDING_VERIFICATION',
      verified_at timestamptz,verified_by integer,updated_by integer,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
      CHECK((verification_status='VERIFIED' AND verified_at IS NOT NULL AND verified_by IS NOT NULL)
        OR(verification_status<>'VERIFIED' AND verified_at IS NULL AND verified_by IS NULL)));
    CREATE TABLE settlement_payroll_audit_events(id serial PRIMARY KEY,scope text,school_id integer,
      actor_user_id integer,actor_role text,record_type text,record_id integer,action text,amount_minor integer,currency text,
      provider_reference text,previous_status text,new_status text,metadata jsonb,occurred_at timestamptz DEFAULT now());
    CREATE TABLE audit_logs("user" text,role text,actor_user_id integer,clerk_user_id text,school_id integer,
      action text,module text,severity text,event_type text,result text,metadata jsonb);`);
  const app = express(); app.use(express.json()); app.use(router);
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));
  await new Promise<void>(r => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
}, 30000);
beforeEach(async () => {
  vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEY", "11".repeat(32));
  vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEY_VERSION", "fixture-v1");
  vi.stubEnv("PAYROLL_BANK_ENCRYPTION_ACTIVE_VERSION", "fixture-v1");
  vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEYS", "");
  vi.spyOn(FlutterwavePayrollV3Client.prototype, "resolveNigerianAccount").mockImplementation(async () => { throw Error("Provider calls forbidden"); });
  await state.pool.query("TRUNCATE settlement_payroll_audit_events,audit_logs,settlement_payroll_profiles RESTART IDENTITY");
  const enc = (value: string, field: string) => encryptPayrollBankValue(value, `settlement:school:7:${field}`).ciphertext;
  await state.pool.query(`INSERT INTO settlement_payroll_profiles(scope,school_id,business_name,bank_name_encrypted,
    bank_code_encrypted,account_name_encrypted,account_number_encrypted,encryption_key_version,account_last4)
    VALUES('SCHOOL',7,'Fictional School Business',$1,$2,$3,$4,'fixture-v1','0002')`,
    [enc("Fictional Bank", "bankName"), enc("099", "bankCode"), enc("Fixture Holder", "accountName"), enc("0000000002", "accountNumber")]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => {
  server?.closeAllConnections(); if (server) await new Promise<void>(r => server.close(() => r()));
  await state.pool?.end();
  try { execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { env: clean, stdio: "ignore" }); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
it("requires Owner authorization and independent evidence before any decision", async () => {
  const input = await review();
  expect((await call(target + "/review", input, "fixture-admin-key", "ADMIN")).status).toBe(403);
  expect((await call(target + "/review", { ...input, evidenceSha256: undefined })).status).toBe(400);
  expect((await call(target + "/review", { ...input, independentAccountMatchConfirmed: false })).status).toBe(400);
  expect((await status()).verification_status).toBe("PENDING_VERIFICATION");
  expect((await state.pool.query("SELECT count(*)::int AS n FROM settlement_payroll_audit_events")).rows[0].n).toBe(0);
});
it("atomically records deliberate verification and both audit trails, never calls a provider", async () => {
  const response = await call(target + "/review", await review());
  expect(response.status, await response.text()).toBe(200);
  expect(await status()).toMatchObject({ verification_status: "VERIFIED", verified_by: 99 });
  const audit = (await state.pool.query("SELECT action,metadata FROM settlement_payroll_audit_events")).rows[0];
  expect(audit).toMatchObject({ action: "OWNER_SETTLEMENT_BANK_VERIFIED", metadata: { evidenceSha256: evidence, providerRequestMade: false, subaccountCreated: false } });
  expect((await state.pool.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n).toBe(1);
  expect(FlutterwavePayrollV3Client.prototype.resolveNigerianAccount).not.toHaveBeenCalled();
});
it("rejects with a reason, retains the profile and replays the same decision without duplicate audit", async () => {
  const input = { ...await review("REJECT"), evidenceSha256: undefined, independentAccountMatchConfirmed: undefined };
  expect((await call(target + "/review", input)).status).toBe(200);
  expect((await call(target + "/review", input)).status).toBe(200);
  expect(await status()).toEqual({ verification_status: "ACTION_REQUIRED", verified_at: null, verified_by: null });
  expect((await state.pool.query("SELECT action FROM settlement_payroll_audit_events")).rows).toEqual([{ action: "OWNER_SETTLEMENT_BANK_REJECTED" }]);
  expect((await call(target + "/review", { ...input, note: "Different reason cannot reuse the same review key." })).status).toBe(409);
});
it("refuses a stale review after the saved bank data changes", async () => {
  const input = await review();
  await state.pool.query("UPDATE settlement_payroll_profiles SET bank_code_encrypted='different-fixture-ciphertext'");
  expect((await call(target + "/review", input)).status).toBe(409);
  expect((await status()).verification_status).toBe("PENDING_VERIFICATION");
});
it("serializes concurrent identical decisions into one audited change", async () => {
  const input = await review();
  const results = await Promise.all([call(target + "/review", input), call(target + "/review", input)]);
  expect(results.map(r => r.status)).toEqual([200, 200]);
  expect((await state.pool.query("SELECT count(*)::int AS n FROM settlement_payroll_audit_events")).rows[0].n).toBe(1);
});
it("rolls back the status and structured audit if the general audit insert fails", async () => {
  const input = await review();
  await state.pool.query("ALTER TABLE audit_logs ADD CONSTRAINT fixture_audit_failure CHECK(false) NOT VALID");
  try {
    const response = await call(target + "/review", input);
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("fixture_audit_failure");
    expect((await status()).verification_status).toBe("PENDING_VERIFICATION");
    expect((await state.pool.query("SELECT count(*)::int AS n FROM settlement_payroll_audit_events")).rows[0].n).toBe(0);
  } finally { await state.pool.query("ALTER TABLE audit_logs DROP CONSTRAINT fixture_audit_failure"); }
});
it("does not expose the Owner review snapshot on school-facing reads", async () => {
  const response = await call("/schools/7/finance/payment-settlement", undefined, "fixture-school-read", "ADMIN");
  expect(response.status).toBe(200); expect((await response.json() as { reviewSnapshot?: string }).reviewSnapshot).toBeUndefined();
});
it("provider verification requires Owner authorization and preserves the existing provider identity", async () => {
  vi.mocked(FlutterwavePayrollV3Client.prototype.resolveNigerianAccount).mockResolvedValue({
    resolvedAccountNumber: "0000000002", resolvedAccountName: "Fixture Holder",
  });
  await state.pool.query("UPDATE settlement_payroll_profiles SET provider_business_id='preserve-fixture-merchant',provider_subaccount_id='preserve-fixture-recipient'");
  expect((await call(target, {}, "fixture-admin-provider-key", "ADMIN")).status).toBe(403);
  expect(FlutterwavePayrollV3Client.prototype.resolveNigerianAccount).not.toHaveBeenCalled();
  const response = await call(target, {});
  expect(response.status, await response.text()).toBe(200);
  expect(await status()).toMatchObject({ verification_status: "VERIFIED", verified_by: 99 });
  expect((await state.pool.query("SELECT provider_business_id,provider_subaccount_id FROM settlement_payroll_profiles WHERE id=1")).rows[0])
    .toEqual({ provider_business_id: "preserve-fixture-merchant", provider_subaccount_id: "preserve-fixture-recipient" });
  expect((await state.pool.query("SELECT action FROM settlement_payroll_audit_events")).rows)
    .toEqual([{ action: "FLUTTERWAVE_BANK_ACCOUNT_RESOLVED" }]);
});
it("provider mismatch records ACTION_REQUIRED rather than automatically approving", async () => {
  vi.mocked(FlutterwavePayrollV3Client.prototype.resolveNigerianAccount).mockResolvedValue({
    resolvedAccountNumber: "0000000002", resolvedAccountName: "Different Fixture Holder",
  });
  expect((await call(target, {})).status).toBe(409);
  expect(await status()).toEqual({ verification_status: "ACTION_REQUIRED", verified_at: null, verified_by: null });
  expect((await state.pool.query("SELECT action FROM settlement_payroll_audit_events")).rows)
    .toEqual([{ action: "SETTLEMENT_ACCOUNT_RESOLUTION_MISMATCH" }]);
});
