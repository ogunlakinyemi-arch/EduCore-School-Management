// Development-only, read-only checks: query-scoped CTE data never becomes payroll records.
import { readFile, writeFile } from "node:fs/promises";
import { pool } from "@workspace/db";

if (process.env.REPLIT_DEPLOYMENT || !process.env.REPLIT_DEV_DOMAIN ||
    !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
  throw Error("Development test tenant required");
}

try {
  const identity = (await pool.query("SELECT current_database() AS database,inet_server_addr()::text AS address")).rows[0];
  if (identity.database !== "heliumdb" || identity.address !== null) throw Error("Confirmed local Development target required");
  const source = await readFile(new URL("../../artifacts/api-server/src/routes/settlement-payroll.ts", import.meta.url), "utf8");
  const select = source.match(/const MY_PAYSLIPS_SELECT = `([\s\S]*?)`;/)![1];
  const listTail = source.slice(source.indexOf('router.get(["/me/payroll/payslips",')).match(/\$\{MY_PAYSLIPS_SELECT\}([\s\S]*?)`,/)![1];
  const detailTail = source.slice(source.indexOf('router.get(["/me/payroll/payslips/:payslipId",')).match(/\$\{MY_PAYSLIPS_SELECT\}([\s\S]*?)`,/)![1];
  const tables: Record<string, unknown[]> = {
    payroll_payslips: [],
    payroll_items: [],
    payroll_transfers: [],
    payroll_employee_profiles: [],
    employees: [],
    platform_company_employees: [],
    schools: [{ id: 7, name: "Read-only school" }, { id: 8, name: "Other school" }],
    school_memberships: [{ user_id: 99, school_id: 7, role: "TEACHER", status: "ACTIVE" }],
  };
  // Own, different employee, different tenant, conflicting linked identity,
  // unlinked email match, unverified payment, inactive employment.
  for (let id = 1; id <= 7; id++) {
    const schoolId = id === 3 ? 8 : 7;
    tables.payroll_payslips.push({
      id, scope: "SCHOOL", school_id: schoolId, period_id: 1, payroll_item_id: id, transfer_id: id,
      period_month: "2026-10", employee_name_snapshot: `Read-only employee ${id}`,
      employee_role_snapshot: "TEACHER", base_salary_minor: 100000, allowance_minor: 1000,
      bonus_minor: 2000, deduction_minor: 500, adjustment_minor: -100, net_salary_minor: 102400,
      currency: "NGN", issued_at: "2026-10-01T00:00:00Z",
    });
    tables.payroll_items.push({
      id, scope: "SCHOOL", school_id: schoolId, period_id: 1, employee_profile_id: id,
      adjustment_reason: "Read-only adjustment", account_last4: "1234",
    });
    tables.payroll_transfers.push({
      id, scope: "SCHOOL", school_id: schoolId, status: "PAID", external_transfer_verified: id !== 6,
      provider_reference: `read-only-${id}`, provider_transaction_id: String(id),
    });
    tables.payroll_employee_profiles.push({ id, scope: "SCHOOL", school_id: schoolId, employee_id: id });
    tables.employees.push({
      id, school_id: schoolId, user_id: id === 5 ? null : [2, 4].includes(id) ? 100 : 99,
      email: id === 2 ? "other@example.test" : "own@example.test",
      employment_status: id === 7 ? "INACTIVE" : "ACTIVE",
    });
  }
  const client = await pool.connect();
  const checks: string[] = [];
  function check(ok: boolean, label: string) {
    if (!ok) throw Error(label);
    checks.push(label);
  }
  try {
    await client.query("BEGIN READ ONLY");
    const names = Object.keys(tables);
    const fixture = (offset: number) => "WITH " + names.map((name, i) =>
      `${name} AS (SELECT * FROM jsonb_populate_recordset(NULL::public.${name},$${offset + i}::jsonb))`,
    ).join(",") + " ";
    const fixtureValues = names.map(name => JSON.stringify(tables[name]));
    const list = async (from: string | null = null, to: string | null = null) =>
      (await client.query(fixture(5) + select + listTail, [99, "own@example.test", from, to, ...fixtureValues])).rows;
    const rows = await list();
    check(JSON.stringify(rows.map(r => r.id)) === "[5,1]", "Native SQL returns only own active-school verified payslips");
    check(rows.every(r => r.net_salary_minor === 102400 && r.adjustment_reason === "Read-only adjustment"), "Frozen amounts and adjustment reason are unchanged");
    check(rows.every(r => r.created_at instanceof Date), "Issued timestamp uses the actual payslip schema");
    check((await list("2026-11")).length === 0, "Month filter produces a valid empty result");
    for (const id of [2, 3, 4, 6, 7, 999]) {
      const denied = await client.query(fixture(4) + select + detailTail, [id, 99, "own@example.test", ...fixtureValues]);
      check(denied.rows.length === 0, `Detail masks unauthorized or missing payslip ${id}`);
    }
    const own = await client.query(fixture(4) + select + detailTail, [1, 99, "own@example.test", ...fixtureValues]);
    check(own.rows.length === 1 && own.rows[0].net_salary_minor === 102400, "Own detail reads the correct frozen payslip");
    const realTeacher = (await client.query("SELECT id,email FROM app_users WHERE id=$1", [912])).rows[0];
    check(!!realTeacher, "Existing Teacher identity is available");
    const realRows = await client.query(select + listTail, [realTeacher.id, realTeacher.email, null, null]);
    check(realRows.rows.length === 0, "Existing Teacher with no payslips has an empty authoritative SQL result");

    const baseline = JSON.parse(await readFile("/tmp/payslip-financial-baseline.json", "utf8"));
    let preservedRows = 0;
    for (const [table, original] of Object.entries(baseline.tables) as [string, { hash: string }[]][]) {
      if (!/^[a-z_]+$/.test(table)) throw Error("Invalid preservation table");
      const current = (await client.query(`SELECT md5(to_jsonb(t)::text) AS hash FROM "${table}" t ORDER BY 1`)).rows;
      check(JSON.stringify(current) === JSON.stringify(original), `Preserved ${table}`);
      preservedRows += original.length;
    }
    const report = { readOnly: true, persistedTestRecords: 0, checks, preservationTables: Object.keys(baseline.tables).length, preservedRows };
    await writeFile("/tmp/payslip-read-verification.json", JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
} finally {
  await pool.end();
}
