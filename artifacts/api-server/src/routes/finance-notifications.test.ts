import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: any[] }>,
  canRead: true,
  pendingOutbox: false,
  notification: {
    id: 41, schoolId: 4, eventType: "PAYMENT_VERIFIED", isRead: false,
    createdAt: "2026-09-04T12:00:00.000Z", readAt: null, receiptNumber: "RCP-4-00000031",
    invoiceNumber: "INV-31", studentName: "Linked Student", paymentReference: "PAY-31",
    amountMinor: 2500, refundId: null, eventAmountMinor: 2500, currency: "NGN", method: "PAYSTACK",
  } as Record<string, any>,
}));
const dbMock = vi.hoisted(() => {
  const rows = () => state.canRead ? [{ ...state.notification }] : [];
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("FROM fee_payment_notification_outbox")) return {
      rows: state.pendingOutbox ? [{
        id: 9, payment_id: 31, school_id: 4, event_type: "PAYMENT_VERIFIED",
        event_reference_id: 0, metadata: {},
      }] : [],
      rowCount: state.pendingOutbox ? 1 : 0,
    };
    if (sql.includes("FROM fee_payment_notifications n")) return { rows: rows(), rowCount: rows().length };
    throw new Error(`Unexpected notification pool query: ${sql}`);
  });
  const clientQuery = vi.fn(async (sql: string, values: any[] = []) => {
    state.calls.push({ sql, values });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql.startsWith("UPDATE fee_payment_notifications")) {
      if (!state.canRead) return { rows: [] };
      state.notification.isRead = true;
      state.notification.readAt = "2026-09-04T12:05:00.000Z";
      return { rows: [{ id: 41, schoolId: 4, recipientRole: "PARENT" }] };
    }
    if (sql.includes("FROM fee_payment_notifications n")) return { rows: rows(), rowCount: rows().length };
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    throw new Error(`Unexpected notification client query: ${sql}`);
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
        user: { id: 7, clerkUserId: "finance-notification-user", email: "recipient@example.test", firstName: "Test", lastName: "Recipient" },
        roles: [{ id: 1, role, schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import financeNotificationsRouter from "./finance-notifications";
const app = express();
app.use(financeNotificationsRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
));
beforeEach(() => {
  state.calls.length = 0;
  state.canRead = true;
  state.pendingOutbox = false;
  state.notification = {
    id: 41, schoolId: 4, eventType: "PAYMENT_VERIFIED", isRead: false,
    createdAt: "2026-09-04T12:00:00.000Z", readAt: null, receiptNumber: "RCP-4-00000031",
    invoiceNumber: "INV-31", studentName: "Linked Student", paymentReference: "PAY-31",
    amountMinor: 2500, refundId: null, eventAmountMinor: 2500, currency: "NGN", method: "PAYSTACK",
  };
  dbMock.query.mockClear();
  dbMock.clientQuery.mockClear();
});

describe("recipient-only verified-payment notification reads", () => {
  it("returns minimal linked receipt context and filters against current parent linkage", async () => {
    const response = await fetch(`${baseUrl}/me/finance/payment-notifications?schoolId=4`);
    expect(response.status).toBe(200);
    const result = await response.json() as Array<Record<string, any>>;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 41, schoolId: 4, receiptNumber: "RCP-4-00000031",
      invoiceNumber: "INV-31", studentName: "Linked Student", isRead: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/transferBank|proofUrl|accountNumber|evidence/i);
    const query = state.calls.find(({ sql }) => sql.includes("FROM fee_payment_notifications n"))!;
    expect(query.values).toEqual([7, 4, 4, "PARENT"]);
    expect(query.sql).toContain("n.recipient_user_id=$1");
    expect(query.sql).toContain("pa.status='ACTIVE'");
    expect(query.sql).toContain("rel.status='ACTIVE'");
    expect(query.sql).toContain("linked_payment.school_id=n.school_id");
    expect(query.sql).toContain("fee_receipts r");
  });

  it("returns the same-school approved refund identity and amount for refund notifications", async () => {
    state.notification = {
      ...state.notification,
      eventType: "REFUND_APPROVED",
      refundId: 72,
      eventAmountMinor: 900,
    };
    const response = await fetch(`${baseUrl}/me/finance/payment-notifications?schoolId=4`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{
      eventType: "REFUND_APPROVED", refundId: 72, eventAmountMinor: 900,
    }]);
    const query = state.calls.find(({ sql }) => sql.includes("FROM fee_payment_notifications n"))!;
    expect(query.sql).toContain("fr.id=n.event_reference_id");
    expect(query.sql).toContain("fr.payment_id=p.id");
    expect(query.sql).toContain("fr.school_id=n.school_id AND fr.status='APPROVED'");
  });

  it("continues notification reads when an outbox retry cannot connect", async () => {
    state.pendingOutbox = true;
    dbMock.connect.mockRejectedValueOnce(new Error("temporary connection failure"));
    const response = await fetch(`${baseUrl}/me/finance/payment-notifications?schoolId=4`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ id: 41, isRead: false }]);
    expect(state.calls.some(({ sql }) => sql.includes("FROM fee_payment_notifications n"))).toBe(true);
  });

  it("does not query for a school the user is not currently assigned or linked to", async () => {
    const wrongSchool = await fetch(`${baseUrl}/me/finance/payment-notifications?schoolId=9`);
    expect(wrongSchool.status).toBe(404);
    const unsupportedRole = await fetch(`${baseUrl}/me/finance/payment-notifications`, {
      headers: { "x-test-role": "TEACHER", "x-test-school": "4" },
    });
    expect(unsupportedRole.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("marks only the current recipient's notification read and audits the action", async () => {
    const response = await fetch(`${baseUrl}/me/finance/payment-notifications/41/read`, { method: "PATCH" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 41, isRead: true, readAt: "2026-09-04T12:05:00.000Z" });
    expect(state.calls.some(({ sql, values }) =>
      sql.startsWith("UPDATE fee_payment_notifications") && values[0] === 7 && sql.includes("n.recipient_user_id=$1"),
    )).toBe(true);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(true);
  });

  it("returns not found when the notification is no longer linked to this recipient", async () => {
    state.canRead = false;
    const response = await fetch(`${baseUrl}/me/finance/payment-notifications/41/read`, { method: "PATCH" });
    expect(response.status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(false);
  });
});