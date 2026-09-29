import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  queueCommunicationNotification: vi.fn(),
}));

vi.mock("../services/communication-service", () => ({
  queueCommunicationNotification: mocked.queueCommunicationNotification,
}));

import {
  enqueueFinanceInvoiceCommunications,
  enqueueFinanceInvoiceCommunicationsSafely,
  enqueueFinancePaymentCommunications,
  reconcileFinanceCommunicationIntents,
} from "./finance-communication-service";

describe("financial communication intents", () => {
  beforeEach(() => {
    mocked.queueCommunicationNotification.mockReset();
    mocked.queueCommunicationNotification.mockResolvedValue(100);
  });

  it("queues invoice SMS and email only for existing parent/student in-app recipients", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM fee_invoice_notifications n")) {
        return {
          rows: [
            { recipientUserId: 31, subjectStudentId: 902, invoiceNumber: "INV-2026-001" },
            { recipientUserId: 42, subjectStudentId: 902, invoiceNumber: "INV-2026-001" },
          ],
        };
      }
      return { rows: [] };
    });

    const count = await enqueueFinanceInvoiceCommunications(
      { query: query as any }, 17, 4,
    );

    expect(count).toBe(2);
    expect(mocked.queueCommunicationNotification).toHaveBeenCalledTimes(2);
    expect(mocked.queueCommunicationNotification).toHaveBeenCalledWith(
      { query },
      expect.objectContaining({
        recipientUserId: 31,
        schoolId: 4,
        subjectStudentId: 902,
        category: "FINANCE",
        eventKey: "finance:invoice:17:INVOICE_GENERATED",
        channels: ["SMS", "EMAIL"],
        body: expect.stringContaining("INV-2026-001"),
      }),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("n.recipient_role IN ('PARENT','STUDENT')"),
      [17, 4],
    );
    expect(query.mock.calls[0][0]).toContain('i.student_id AS "subjectStudentId"');
  });

  it("queues external messages only for verified/rejected/refund/reversal states and deduplicates each event identity", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("FROM fee_payment_notifications n")
      ? { rows: [{ recipientUserId: 31, subjectStudentId: 902, invoiceNumber: "INV-17" }] }
      : { rows: [] });

    expect(await enqueueFinancePaymentCommunications(
      { query: query as any }, 17, 4, "MANUAL_TRANSFER_APPROVED",
    )).toBe(1);
    expect(mocked.queueCommunicationNotification).toHaveBeenCalledWith(
      { query },
      expect.objectContaining({
        recipientUserId: 31,
        subjectStudentId: 902,
        category: "FINANCE",
        eventKey: "finance:payment:17:MANUAL_TRANSFER_APPROVED:0",
        channels: ["SMS", "EMAIL"],
      }),
    );

    mocked.queueCommunicationNotification.mockClear();
    await enqueueFinancePaymentCommunications({ query: query as any }, 17, 4, "REFUND_APPROVED", 52);
    expect(mocked.queueCommunicationNotification).toHaveBeenCalledWith(
      { query },
      expect.objectContaining({
        eventKey: "finance:payment:17:REFUND_APPROVED:52",
        subject: "School fee refund approved",
      }),
    );
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [17, 4, "REFUND_APPROVED", 52]);
    expect(query.mock.calls[0][0]).toContain('i.student_id AS "subjectStudentId"');
  });

  it("does not send pending or operational payment events through SMS or email", async () => {
    const query = vi.fn();
    expect(await enqueueFinancePaymentCommunications(
      { query: query as any }, 17, 4, "MANUAL_TRANSFER_SUBMITTED",
    )).toBe(0);
    expect(query).not.toHaveBeenCalled();
    expect(mocked.queueCommunicationNotification).not.toHaveBeenCalled();
  });

  it("rolls back partial invoice communication rows without aborting invoice creation", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes("FROM fee_invoice_notifications n")) {
        return { rows: [{ recipientUserId: 31, subjectStudentId: 902, invoiceNumber: "INV-17" }] };
      }
      return { rows: [] };
    });
    mocked.queueCommunicationNotification.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(enqueueFinanceInvoiceCommunicationsSafely(
      { query: query as any }, 17, 4,
    )).resolves.toBeUndefined();

    expect(calls).toContain("SAVEPOINT finance_communication_invoice");
    expect(calls).toContain("ROLLBACK TO SAVEPOINT finance_communication_invoice");
    expect(calls).toContain("RELEASE SAVEPOINT finance_communication_invoice");
  });

  it("reconciles a failed invoice queue on retry with the same idempotency key, then skips it", async () => {
    let intentExists = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM fee_invoice_notifications n")) {
        return {
          rows: intentExists
            ? []
            : [{
              invoiceId: 17,
              schoolId: 4,
              subjectStudentId: 902,
              recipientUserId: 31,
              invoiceNumber: "INV-17",
            }],
        };
      }
      return { rows: [] };
    });
    mocked.queueCommunicationNotification
      .mockRejectedValueOnce(new Error("temporary communication write failure"))
      .mockImplementationOnce(async () => {
        intentExists = true;
        return 101;
      });

    await expect(reconcileFinanceCommunicationIntents({ query: query as any }, 20))
      .rejects.toThrow("temporary communication write failure");
    const retried = await reconcileFinanceCommunicationIntents({ query: query as any }, 20);
    const repeated = await reconcileFinanceCommunicationIntents({ query: query as any }, 20);

    expect(retried).toEqual({
      invoiceRecipientsScanned: 1,
      invoiceIntentsQueued: 1,
      hasMore: false,
    });
    expect(repeated).toEqual({
      invoiceRecipientsScanned: 0,
      invoiceIntentsQueued: 0,
      hasMore: false,
    });
    expect(mocked.queueCommunicationNotification).toHaveBeenCalledTimes(2);
    expect(mocked.queueCommunicationNotification.mock.calls.map((call) => call[1].eventKey))
      .toEqual([
        "finance:invoice:17:INVOICE_GENERATED",
        "finance:invoice:17:INVOICE_GENERATED",
      ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("communication_notifications c"),
      [20],
    );
    expect(query.mock.calls[0][0]).toContain("n.channel='IN_APP'");
    expect(query.mock.calls[0][0]).toContain("LIMIT $1");
  });

  it("bounds reconciliation batches and rejects invalid batch sizes", async () => {
    const query = vi.fn(async () => ({
      rows: [{
        invoiceId: 17,
        schoolId: 4,
        subjectStudentId: 902,
        recipientUserId: 31,
        invoiceNumber: "INV-17",
      }],
    }));
    await expect(reconcileFinanceCommunicationIntents({ query: query as any }, 251))
      .rejects.toThrow("batch size must be an integer");
    expect(query).not.toHaveBeenCalled();
  });
});