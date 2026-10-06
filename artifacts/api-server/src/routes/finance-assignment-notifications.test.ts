import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: any[] }>,
}));
const dbMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const invoice = {
    id: 81, schoolId: 1, studentId: 15, invoiceNumber: "INV-81", studentName: "Student One",
    sessionId: 2, termId: 3, currency: "NGN", subtotalMinor: 3000, discountMinor: 0,
    waiverMinor: 0, totalMinor: 3000, paidMinor: 0, outstandingMinor: 3000, status: "UNPAID",
  };
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    state.calls.push({ sql, values });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.startsWith("SAVEPOINT")
        || sql.startsWith("RELEASE SAVEPOINT") || sql.startsWith("ROLLBACK TO SAVEPOINT")) return result();
    if (sql.includes("SELECT id FROM fee_invoices WHERE school_id=$1")) return result();
    if (sql.includes("FROM fee_structures WHERE id=$1 AND school_id=$2")) {
      return result([{
        id: 7, school_id: 1, academic_session_id: 2, academic_term_id: 3,
        school_class_id: 4, section: "A",
      }]);
    }
    if (sql.includes("FROM students st WHERE st.id=$1")) {
      return result([{
        id: 15, first_name: "Student", last_name: "One", admission_no: "A15",
        class_name: "Year 4", section: "A", eligibleForStructure:true,
      }]);
    }
    if (sql.includes("FROM fee_structure_lines")) {
      return result([{ category_id: 5, category_name_snapshot: "Tuition", description_snapshot: "Term tuition", amount_minor: 3000 }]);
    }
    if (sql.includes("INSERT INTO fee_invoices")) return result([{ id: 81 }]);
    if (sql.includes("INSERT INTO fee_invoice_lines")) return result();
    if (sql.includes("INSERT INTO fee_invoice_notification_outbox")) return result();
    if (sql.includes("INSERT INTO fee_invoice_notifications")) return result();
    if (sql.includes("DELETE FROM fee_invoice_notification_outbox")) return result();
    if (sql.includes("INSERT INTO audit_logs")) return result();
    if (sql.includes("FROM fee_invoices i WHERE i.id=$1 AND i.school_id=$2")) return result([invoice]);
    throw new Error(`Unhandled single assignment test query: ${sql}`);
  });
  return { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) };
});

vi.mock("@workspace/db", () => ({ pool: { connect: dbMock.connect, query: dbMock.query } }));
vi.mock("../lib/student-nfc-obligations",async original=>{
  const actual=await original<typeof import("../lib/student-nfc-obligations")>();
  return {...actual,ensureStudentNfcSubscription:vi.fn(async()=>null)};
});
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as any).edupulseUser = {
        user: { id: 20, clerkUserId: "invoice-assigner", email: "accountant@example.test" },
        roles: [{ id: 1, role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import financeRouter from "./finance";
const app = express();
app.use(express.json());
app.use(financeRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";
beforeAll(async () => new Promise<void>((resolve) => {
  server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
    resolve();
  });
}));
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close(error => error ? reject(error) : resolve()),
));
beforeEach(() => {
  state.calls.length = 0;
  dbMock.query.mockClear();
});

describe("single invoice assignment notification intent", () => {
  it("stores an idempotent invoice-generated intent before transaction commit", async () => {
    const response = await fetch(`${baseUrl}/school/finance/assignments?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ structureId: 7, studentId: 15, issueDate: "2026-09-01", dueDate: "2026-09-30" }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: 81, studentId: 15, status: "UNPAID" });
    const outboxIndex = state.calls.findIndex(({ sql }) => sql.includes("INSERT INTO fee_invoice_notification_outbox"));
    const deliveryIndex = state.calls.findIndex(({ sql }) => sql.includes("INSERT INTO fee_invoice_notifications"));
    const commitIndex = state.calls.findIndex(({ sql }) => sql === "COMMIT");
    expect(outboxIndex).toBeGreaterThan(-1);
    expect(deliveryIndex).toBeGreaterThan(outboxIndex);
    expect(commitIndex).toBeGreaterThan(deliveryIndex);
    expect(state.calls[outboxIndex].values).toEqual([81, 1]);
    expect(state.calls[outboxIndex].sql).toContain("ON CONFLICT (school_id,invoice_id,event_type) DO NOTHING");
  });
});