import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: any[] }>,
  canRead: true,
  isRead: false,
  notification: {
    id: 8, schoolId: 4, eventType: "INVOICE_GENERATED", isRead: false,
    createdAt: "2026-09-04T12:00:00.000Z", readAt: null,
    invoiceNumber: "INV-31", studentName: "Linked Student", amountMinor: 2500,
    outstandingMinor: 2500, currency: "NGN", status: "UNPAID",
  } as Record<string, any>,
}));
const dbMock = vi.hoisted(() => {
  const rows = () => state.canRead ? [{
    ...state.notification, isRead: state.isRead,
    readAt: state.isRead ? "2026-09-04T12:05:00.000Z" : null,
  }] : [];
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("FROM fee_invoice_notification_outbox")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM fee_invoice_notifications n")) return { rows: rows(), rowCount: rows().length };
    throw new Error(`Unexpected invoice notification pool query: ${sql}`);
  });
  const clientQuery = vi.fn(async (sql: string, values: any[] = []) => {
    state.calls.push({ sql, values });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.startsWith("UPDATE fee_invoice_notifications")) {
      if (!state.canRead) return { rows: [] };
      state.isRead = true;
      return { rows: [{ id: 8, schoolId: 4, recipientRole: "PARENT" }] };
    }
    if (sql.includes("FROM fee_invoice_notifications n")) return { rows: rows(), rowCount: rows().length };
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    throw new Error(`Unexpected invoice notification client query: ${sql}`);
  });
  return {
    query,
    clientQuery,
    connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
  };
});

vi.mock("@workspace/db", () => ({ pool: { query: dbMock.query, connect: dbMock.connect } }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = req.header("x-test-role") ?? "PARENT";
      const schoolId = Number(req.header("x-test-school") ?? 4);
      (req as any).edupulseUser = {
        user: { id: 7, clerkUserId: "invoice-notification-user", email: "recipient@example.test", firstName: "Test", lastName: "Recipient" },
        roles: [{ id: 1, role, schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import invoiceNotificationsRouter from "./invoice-notifications";
const app = express();
app.use(invoiceNotificationsRouter);
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
  state.canRead = true;
  state.isRead = false;
  state.notification = {
    id: 8, schoolId: 4, eventType: "INVOICE_GENERATED", isRead: false,
    createdAt: "2026-09-04T12:00:00.000Z", readAt: null,
    invoiceNumber: "INV-31", studentName: "Linked Student", amountMinor: 2500,
    outstandingMinor: 2500, currency: "NGN", status: "UNPAID",
  };
  dbMock.query.mockClear();
  dbMock.clientQuery.mockClear();
});

describe("recipient-scoped invoice-generated notification API", () => {
  it("returns only minimal invoice context and revalidates active parent linkage", async () => {
    const response = await fetch(`${baseUrl}/me/finance/invoice-notifications?schoolId=4`);
    expect(response.status).toBe(200);
    const result = await response.json() as Array<Record<string, any>>;
    expect(result).toMatchObject([{
      id: 8, schoolId: 4, eventType: "INVOICE_GENERATED", invoiceNumber: "INV-31",
      studentName: "Linked Student", amountMinor: 2500, outstandingMinor: 2500,
    }]);
    expect(JSON.stringify(result)).not.toMatch(/paymentReference|receiptNumber|paymentId|method/i);
    const read = state.calls.find(({ sql }) => sql.includes("FROM fee_invoice_notifications n"))!;
    expect(read.values).toEqual([7, 4, 4, "PARENT"]);
    expect(read.sql).toContain("n.recipient_user_id=$1");
    expect(read.sql).toContain("rel.status='ACTIVE'");
    expect(read.sql).toContain("pa.school_id=n.school_id AND pa.status='ACTIVE'");
    expect(read.sql).toContain("linked_invoice.school_id=n.school_id AND linked_invoice.student_id=st.id");
  });

  it("rejects cross-school and unsupported-role requests before database access", async () => {
    expect((await fetch(`${baseUrl}/me/finance/invoice-notifications?schoolId=9`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/me/finance/invoice-notifications`, {
      headers: { "x-test-role": "TEACHER", "x-test-school": "4" },
    })).status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("marks only the currently linked recipient's invoice notice as read", async () => {
    const response = await fetch(`${baseUrl}/me/finance/invoice-notifications/8/read`, { method: "PATCH" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: 8, eventType: "INVOICE_GENERATED", isRead: true, readAt: "2026-09-04T12:05:00.000Z",
    });
    expect(state.calls.some(({ sql, values }) =>
      sql.startsWith("UPDATE fee_invoice_notifications") && values[0] === 7 && sql.includes("n.recipient_user_id=$1"),
    )).toBe(true);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(true);
  });

  it("hides notices once the recipient relationship is no longer active", async () => {
    state.canRead = false;
    const response = await fetch(`${baseUrl}/me/finance/invoice-notifications/8/read`, { method: "PATCH" });
    expect(response.status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(false);
  });
});