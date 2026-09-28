import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  payment: {} as Record<string, any>,
  invoice: {} as Record<string, any>,
  receipt: null as null | { school_id: number; payment_id: number; invoice_id: number; receipt_number: string; snapshot: unknown },
  transferSubmitted: false,
  duplicateTransfer: false,
  duplicateEvidence: false,
  bankSettings: null as null | Record<string, any>,
  calls: [] as Array<{ sql: string; values: any[] }>,
  role: "SCHOOL_ADMIN",
  schoolId: 1,
  userId: 20,
  audit: [] as any[][],
}));

const makePaymentView = () => ({
  id: state.payment.id,
  schoolId: state.payment.school_id,
  invoiceId: state.payment.invoice_id,
  reference: state.payment.reference,
  amountMinor: state.payment.amount_minor,
  currency: state.payment.currency,
  method: state.payment.method,
  status: state.payment.status,
});

const makeInvoiceView = () => ({
  id: state.invoice.id,
  schoolId: state.invoice.school_id,
  studentId: state.invoice.student_id,
  invoiceNumber: state.invoice.invoice_number,
  studentName: state.invoice.student_name_snapshot,
  sessionId: state.invoice.academic_session_id,
  termId: state.invoice.academic_term_id,
  currency: state.invoice.currency,
  subtotalMinor: state.invoice.subtotal_minor,
  discountMinor: state.invoice.discount_minor,
  waiverMinor: state.invoice.waiver_minor,
  totalMinor: state.invoice.total_minor,
  paidMinor: state.invoice.paid_minor,
  outstandingMinor: state.invoice.outstanding_minor,
  status: state.invoice.status,
});

const poolMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const lockTails = new Map<string, Promise<void>>();
  const acquire = async (key: string, releases: Array<() => void>) => {
    const previous = lockTails.get(key) ?? Promise.resolve();
    let unlock: () => void = () => {};
    const current = new Promise<void>((resolve) => { unlock = resolve; });
    lockTails.set(key, previous.then(() => current));
    await previous;
    releases.push(unlock);
  };
  const makeClient = () => {
    const releases: Array<() => void> = [];
    const releaseLocks = () => {
      while (releases.length) releases.pop()?.();
    };
    return {
      query: vi.fn(async (sql: string, values: any[] = []) => {
      state.calls.push({ sql, values });
      if (sql === "BEGIN") return result();
      if (sql === "COMMIT" || sql === "ROLLBACK") {
        releaseLocks();
        return result();
      }
      if (sql.includes("FOR UPDATE") && !sql.includes("SELECT id FROM fee_payments")) {
        const key = sql.includes("FROM fee_payments")
          ? `payment:${values[0]}:${values[1]}`
          : sql.includes("FROM fee_invoices")
            ? `invoice:${values[0]}:${values[1]}`
            : `row:${values[0]}`;
        await acquire(key, releases);
      }
      if (sql.includes("SELECT status,rejection_reason FROM fee_payments")) {
        return result([{ status: state.payment.status, rejection_reason: state.payment.rejection_reason }]);
      }
      if (sql.includes("SELECT id FROM fee_payments") && sql.includes("LOWER(BTRIM(transfer_reference))")) {
        return result(state.duplicateTransfer ? [{ id: 72 }] : []);
      }
      if (sql.includes("SELECT id FROM fee_payments") && sql.includes("LOWER(BTRIM(verification_evidence_ref))")) {
        return result(state.duplicateEvidence ? [{ id: 73 }] : []);
      }
      if (sql.includes("SELECT i.* FROM fee_invoices i JOIN parents p")) {
        return result(state.invoice.id === Number(values[0]) && state.invoice.school_id === 1 ? [{ ...state.invoice }] : []);
      }
      if (sql.includes("FROM fee_school_settings WHERE school_id=$1")) {
        return result(state.bankSettings ? [{ ...state.bankSettings }] : []);
      }
      if (sql.includes("SELECT id FROM parents WHERE user_id=$1 AND school_id=$2")) return result([{ id: 21 }]);
      if (sql.includes("FROM fee_payments WHERE school_id=$1 AND idempotency_key=$2")) {
        if (!state.transferSubmitted || state.payment.idempotency_key !== values[1]) return result();
        return result([{
          ...makePaymentView(),
          parentId: state.payment.parent_id,
          transferReference: state.payment.transfer_reference,
          bank: state.payment.transfer_bank,
          transferDate: state.payment.transfer_date,
          proofUrl: state.payment.proof_url,
          submittedBy: state.payment.submitted_by,
        }]);
      }
      if (sql.includes("INSERT INTO fee_payments")) {
        if (state.transferSubmitted
            && String(state.payment.transfer_bank).trim().toLowerCase() === String(values[7]).trim().toLowerCase()
            && String(state.payment.transfer_reference).trim().toLowerCase() === String(values[8]).trim().toLowerCase()) {
          throw new Error("duplicate key violates fee_payments_school_bank_transfer_ref_unique");
        }
        state.payment = {
          id: 72,
          school_id: values[0],
          invoice_id: values[1],
          student_id: values[2],
          parent_id: values[3],
          reference: values[4],
          idempotency_key: values[5],
          amount_minor: values[6],
          currency: "NGN",
          method: "BANK_TRANSFER",
          provider: "MANUAL_BANK_TRANSFER",
          status: "PENDING",
          transfer_bank: values[7],
          transfer_reference: values[8],
          transfer_date: values[9],
          proof_url: values[10],
          submitted_by: values[11],
        };
        state.transferSubmitted = true;
        return result([makePaymentView()]);
      }
      if (sql.includes("FROM fee_payments") && sql.includes("FOR UPDATE")) {
        return result(state.payment.id === Number(values[0]) && state.payment.school_id === Number(values[1])
          ? [{ ...state.payment }]
          : []);
      }
      if (sql.includes("FROM fee_invoices") && sql.includes("FOR UPDATE")) {
        return result(state.invoice.id === Number(values[0]) && state.invoice.school_id === Number(values[1])
          ? [{ ...state.invoice }]
          : []);
      }
      if (sql.includes("UPDATE fee_payments SET status='VERIFIED'")) {
        state.payment.status = "VERIFIED";
        state.payment.verified_by = values[0];
        state.payment.verified_at = "2026-09-01T12:00:00.000Z";
        state.payment.verification_evidence_ref = values[1];
        state.payment.reviewer_notes = values[2];
        state.payment.verification_metadata = values[3];
        return result([{ ...state.payment }]);
      }
      if (sql.includes("UPDATE fee_payments SET status='REJECTED'")) {
        state.payment.status = "REJECTED";
        state.payment.rejection_reason = values[0];
        return result([makePaymentView()]);
      }
      if (sql.includes("UPDATE fee_invoices SET paid_minor")) {
        state.invoice.paid_minor = values[0];
        state.invoice.outstanding_minor = values[1];
        state.invoice.status = values[2];
        return result();
      }
      if (sql.includes("INSERT INTO fee_receipts")) {
        if (!state.receipt) {
          state.receipt = {
            school_id: values[0],
            payment_id: values[1],
            invoice_id: values[2],
            receipt_number: values[3],
            snapshot: values[4],
          };
        }
        return result();
      }
      if (sql.includes("SELECT receipt_number FROM fee_receipts")) {
        return result(state.receipt?.payment_id === Number(values[0]) && state.receipt.school_id === Number(values[1])
          && state.receipt.invoice_id === Number(values[2])
          ? [{ receipt_number: state.receipt.receipt_number }]
          : []);
      }
      if (sql.includes("INSERT INTO fee_payment_notifications")) return result();
      if (sql.includes("INSERT INTO fee_school_settings (school_id) VALUES")) return result();
      if (sql.includes("INSERT INTO fee_school_settings")) {
        state.bankSettings = {
          schoolId: values[0],
          partialPaymentsEnabled: values[1],
          bankTransferEnabled: values[2],
          paystackEnabled: values[3],
          flutterwaveEnabled: values[4],
          bankName: values[5],
          accountName: values[6],
          accountNumber: values[7],
        };
        return result([{ ...state.bankSettings }]);
      }
      if (sql.includes("SELECT name,logo FROM schools")) return result([{ name: "Test School", logo: null }]);
      if (sql.includes("SELECT name FROM parents")) return result([{ name: "Test Parent" }]);
      if (sql.includes("INSERT INTO audit_logs")) {
        state.audit.push(values);
        return result();
      }
      if (sql.includes("SELECT ") && sql.includes("FROM fee_payments WHERE id=$1 AND school_id=$2")) {
        return result([makePaymentView()]);
      }
      throw new Error(`Unhandled finance DB mock query: ${sql}`);
      }),
      release: vi.fn(),
    };
  };
  const connect = vi.fn(async () => makeClient());
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("FROM fee_invoices i") && sql.includes("parent_student_relationships")) {
      return result([makeInvoiceView()]);
    }
    if (sql.includes("FROM fee_school_settings WHERE school_id=$1")) {
      return result(state.bankSettings ? [{ ...state.bankSettings }] : []);
    }
    throw new Error(`Unhandled finance pool mock query: ${sql}`);
  });
  return { connect, query, resetLocks: () => lockTails.clear() };
});

vi.mock("@workspace/db", () => ({ pool: { connect: poolMock.connect, query: poolMock.query } }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = String(req.header("x-test-role") ?? state.role) as any;
      const schoolId = role === "PLATFORM_OWNER" ? null : Number(req.header("x-test-school") ?? state.schoolId);
      const assignmentsHeader = req.header("x-test-assignments");
      const roles = assignmentsHeader
        ? assignmentsHeader.split(",").map((assignment, index) => {
          const [assignmentRole, assignmentSchoolId] = assignment.split(":");
          return {
            id: index + 1,
            role: assignmentRole,
            schoolId: assignmentSchoolId === "null" ? null : Number(assignmentSchoolId),
            status: "ACTIVE",
          };
        })
        : [{ id: 1, role, schoolId, status: "ACTIVE" }];
      (req as any).edupulseUser = {
        user: {
          id: state.userId,
          clerkUserId: "test-user",
          email: "test@example.test",
          firstName: "Test",
          lastName: "Reviewer",
          phone: null,
          status: "ACTIVE",
        },
        roles,
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
  state.payment = {
    id: 71,
    school_id: 1,
    invoice_id: 41,
    student_id: 31,
    parent_id: 21,
    reference: "EDC-PAY-TEST-71",
    amount_minor: 30000,
    currency: "NGN",
    method: "BANK_TRANSFER",
    transfer_bank: "Test Bank",
    transfer_reference: "TRF-2026-0091",
    transfer_date: "2026-09-01",
    provider: "MANUAL_BANK_TRANSFER",
    status: "PENDING",
    verified_by: null,
    verified_at: null,
    verification_evidence_ref: null,
    reviewer_notes: null,
    verification_metadata: null,
    rejection_reason: null,
  };
  state.invoice = {
    id: 41,
    school_id: 1,
    student_id: 31,
    invoice_number: "INV-41",
    student_name_snapshot: "Test Student",
    academic_session_id: 3,
    academic_term_id: 4,
    currency: "NGN",
    subtotal_minor: 50000,
    discount_minor: 0,
    waiver_minor: 0,
    total_minor: 50000,
    paid_minor: 0,
    outstanding_minor: 50000,
    status: "UNPAID",
  };
  state.receipt = null;
  state.transferSubmitted = false;
  state.duplicateTransfer = false;
  state.duplicateEvidence = false;
  state.bankSettings = {
    schoolId: 1,
    partialPaymentsEnabled: false,
    bankTransferEnabled: true,
    paystackEnabled: false,
    flutterwaveEnabled: false,
    bankName: "Test Bank",
    accountName: "Test School",
    accountNumber: "1234567890",
  };
  state.calls.length = 0;
  state.audit.length = 0;
  state.role = "SCHOOL_ADMIN";
  state.schoolId = 1;
  state.userId = 20;
  poolMock.connect.mockClear();
  poolMock.query.mockClear();
  poolMock.resetLocks();
});

const verificationBody = {
  evidenceReference: "bank-statement-line-73",
  reviewerNotes: "Matched credit to invoice and bank statement",
};

async function verify(body: unknown = verificationBody, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/school/finance/payments/71/verify?schoolId=1`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const transferBody = {
  amountMinor: 50000,
  bank: "Test Bank",
  transferReference: "TRF-2026-0091",
  transferDate: "2026-09-01",
  proofUrl: "https://example.test/proof/91",
};

async function submitTransfer(body: unknown = transferBody, userId = 20, idempotencyKey = "parent-transfer-2026-91") {
  state.userId = userId;
  return fetch(`${baseUrl}/parent/fees/invoices/41/bank-transfer`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey, "x-test-role": "PARENT" },
    body: JSON.stringify(body),
  });
}

describe("manual bank-transfer review integration", () => {
  it("requires verification evidence and reviewer notes instead of accepting payment ID alone", async () => {
    const response = await verify({});
    expect(response.status).toBe(400);
    expect(state.payment.status).toBe("PENDING");
    expect(state.receipt).toBeNull();
  });

  it("persists verification metadata, audit evidence, invoice balances, and a matching receipt", async () => {
    const response = await verify(verificationBody, { "x-test-role": "ACCOUNTANT" });
    const body = await response.json() as Record<string, any>;
    expect(response.status).toBe(200);
    expect(body.receiptNumber).toBe("RCP-1-00000071");
    expect(state.payment.verification_evidence_ref).toBe(verificationBody.evidenceReference);
    expect(state.payment.reviewer_notes).toBe(verificationBody.reviewerNotes);
    expect(state.payment.verification_metadata).toMatchObject({
      reviewerUserId: 20,
      evidenceReference: verificationBody.evidenceReference,
      reviewerNotes: verificationBody.reviewerNotes,
    });
    expect(state.invoice).toMatchObject({ paid_minor: 30000, outstanding_minor: 20000, status: "PARTIALLY_PAID" });
    expect(state.receipt).toMatchObject({
      payment_id: 71, invoice_id: 41, school_id: 1, receipt_number: body.receiptNumber,
      snapshot: { invoiceId: 41, schoolId: 1 },
    });
    const notificationIndex = state.calls.findIndex(({ sql }) => sql.includes("INSERT INTO fee_payment_notifications"));
    const receiptCheckIndex = state.calls.findIndex(({ sql }) => sql.includes("SELECT receipt_number FROM fee_receipts"));
    const commitIndex = state.calls.findIndex(({ sql }) => sql === "COMMIT");
    expect(notificationIndex).toBeGreaterThan(receiptCheckIndex);
    expect(notificationIndex).toBeLessThan(commitIndex);
    expect(state.audit.some((entry) => JSON.stringify(entry[7]).includes(verificationBody.evidenceReference))).toBe(true);
  });

  it("returns the persisted receipt on an exact double-verify replay without applying funds twice", async () => {
    const first = await verify();
    const firstBody = await first.json() as Record<string, any>;
    const second = await verify();
    const secondBody = await second.json() as Record<string, any>;
    expect(second.status).toBe(200);
    expect(secondBody.receiptNumber).toBe(firstBody.receiptNumber);
    expect(state.invoice.paid_minor).toBe(30000);
    expect(state.audit.filter((entry) => String(entry[5]).includes("verified manual bank transfer"))).toHaveLength(1);
  });

  it("serializes simultaneous verification retries so invoice credit and receipt are created once", async () => {
    const [first, second] = await Promise.all([verify(), verify()]);
    const [firstBody, secondBody] = await Promise.all([
      first.json() as Promise<Record<string, any>>,
      second.json() as Promise<Record<string, any>>,
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody.receiptNumber).toBe(secondBody.receiptNumber);
    expect(state.invoice.paid_minor).toBe(30000);
    expect(state.receipt?.payment_id).toBe(71);
    expect(state.audit.filter((entry) => String(entry[5]).includes("verified manual bank transfer"))).toHaveLength(1);
  });

  it("rejects a bank reference already associated with another payment at verification time", async () => {
    state.duplicateTransfer = true;
    const response = await verify();
    expect(response.status).toBe(409);
    expect(state.payment.status).toBe("PENDING");
    expect(state.invoice.paid_minor).toBe(0);
    expect(state.receipt).toBeNull();
  });

  it("rejects verification evidence already used by another verified transfer", async () => {
    state.duplicateEvidence = true;
    const response = await verify();
    expect(response.status).toBe(409);
    expect(state.payment.status).toBe("PENDING");
    expect(state.invoice.paid_minor).toBe(0);
    expect(state.receipt).toBeNull();
  });

  it("rejects a replay with different verification evidence", async () => {
    await verify();
    const response = await verify({ ...verificationBody, evidenceReference: "different-proof-reference" });
    expect(response.status).toBe(409);
    expect(state.invoice.paid_minor).toBe(30000);
    expect(state.receipt?.receipt_number).toBe("RCP-1-00000071");
  });

  it("fails explicitly rather than returning a successful verified response without its receipt", async () => {
    await verify();
    state.receipt = null;
    const response = await verify();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Verified payment receipt integrity failure" });
  });

  it("requires and stores a nonempty rejection reason", async () => {
    const blank = await fetch(`${baseUrl}/school/finance/payments/71/reject?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "   " }),
    });
    expect(blank.status).toBe(400);
    expect(state.payment.status).toBe("PENDING");
    const rejected = await fetch(`${baseUrl}/school/finance/payments/71/reject?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Transfer reference could not be matched" }),
    });
    expect(rejected.status).toBe(200);
    expect(state.payment).toMatchObject({ status: "REJECTED", rejection_reason: "Transfer reference could not be matched" });
  });

  it("binds transfer idempotency replays to actor and compares date and proof", async () => {
    const first = await submitTransfer();
    expect(first.status).toBe(201);
    const exactReplay = await submitTransfer();
    expect(exactReplay.status).toBe(201);
    expect(state.payment.idempotency_key).toBe("BANK_TRANSFER:20:parent-transfer-2026-91");
    const changedDate = await submitTransfer({ ...transferBody, transferDate: "2026-09-02" });
    expect(changedDate.status).toBe(409);
    const changedProof = await submitTransfer({ ...transferBody, proofUrl: "https://example.test/proof/92" });
    expect(changedProof.status).toBe(409);
    expect(state.payment.transfer_date).toBe("2026-09-01");
    expect(state.payment.proof_url).toBe(transferBody.proofUrl);
  });

  it("prevents the same school/bank/reference transfer from being submitted with a different idempotency key", async () => {
    const first = await submitTransfer(transferBody, 20, "parent-transfer-first");
    expect(first.status).toBe(201);
    const duplicate = await submitTransfer(transferBody, 20, "parent-transfer-second");
    expect(duplicate.status).toBe(409);
    expect(state.payment.idempotency_key).toBe("BANK_TRANSFER:20:parent-transfer-first");
    expect(state.transferSubmitted).toBe(true);
  });

  it("rejects bank/reference fields that become empty after trimming", async () => {
    const response = await submitTransfer({ ...transferBody, bank: "  " });
    expect(response.status).toBe(400);
    expect(state.transferSubmitted).toBe(false);
  });

  it("enforces school tenancy and excludes parent/partner roles from reviewer operations", async () => {
    const wrongSchool = await fetch(`${baseUrl}/school/finance/payments/71/verify?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-role": "ACCOUNTANT", "x-test-school": "2" },
      body: JSON.stringify(verificationBody),
    });
    expect(wrongSchool.status).toBe(404);
    const parentVerify = await fetch(`${baseUrl}/school/finance/payments/71/verify?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-role": "PARENT" },
      body: JSON.stringify(verificationBody),
    });
    expect(parentVerify.status).toBe(404);
    const partnerInvoices = await fetch(`${baseUrl}/parent/fees/invoices`, {
      headers: { "x-test-role": "PARTNER" },
    });
    expect(partnerInvoices.status).toBe(403);
    expect(state.payment.status).toBe("PENDING");
    expect(state.receipt).toBeNull();
  });

  it("binds school-admin mutations to the requested school and keeps platform-owner oversight read-only", async () => {
    const updateSettings = (assignments: string, body: unknown = {
      bankTransferEnabled: true,
      paystackEnabled: true,
      flutterwaveEnabled: true,
      bankName: "Configured Bank",
      accountName: "Example School",
      accountNumber: "0123456789",
    }) => fetch(`${baseUrl}/school/finance/settings?schoolId=1`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-assignments": assignments },
      body: JSON.stringify(body),
    });

    const mixedRole = await updateSettings("ACCOUNTANT:1,SCHOOL_ADMIN:2");
    expect(mixedRole.status).toBe(404);
    expect(state.calls.some(({ sql }) => sql === "BEGIN" || sql.includes("INSERT INTO fee_school_settings"))).toBe(false);

    const ownerOnly = await updateSettings("PLATFORM_OWNER:null");
    expect(ownerOnly.status).toBe(404);

    const sameSchoolAdmin = await updateSettings("SCHOOL_ADMIN:1,ACCOUNTANT:2");
    expect(sameSchoolAdmin.status).toBe(200);
    expect(await sameSchoolAdmin.json()).toMatchObject({
      schoolId: 1, bankTransferEnabled: true, paystackEnabled: true, flutterwaveEnabled: true,
      bankName: "Configured Bank",
      accountName: "Example School", accountNumber: "0123456789",
    });
    expect(state.audit.at(-1)?.[7]).toMatchObject({ accountNumberLast4: "6789" });
    expect(JSON.stringify(state.audit.at(-1)?.[7])).not.toContain("0123456789");
  });

  it("allows accountants to read configured details but not change them", async () => {
    const read = await fetch(`${baseUrl}/school/finance/settings?schoolId=1`, {
      headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "1" },
    });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ accountNumber: "1234567890", bankTransferEnabled: true });

    const beforeUpserts = state.calls.filter(({ sql }) => sql.includes("INSERT INTO fee_school_settings")).length;
    const update = await fetch(`${baseUrl}/school/finance/settings?schoolId=1`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-role": "ACCOUNTANT", "x-test-school": "1" },
      body: JSON.stringify({ bankTransferEnabled: false }),
    });
    expect(update.status).toBe(404);
    expect(state.calls.filter(({ sql }) => sql.includes("INSERT INTO fee_school_settings"))).toHaveLength(beforeUpserts);
  });

  it("defaults school bank details to disabled and rejects invalid Nigerian account numbers", async () => {
    state.bankSettings = null;
    const defaultSettings = await fetch(`${baseUrl}/school/finance/settings?schoolId=1`, {
      headers: { "x-test-role": "SCHOOL_ADMIN", "x-test-school": "1" },
    });
    expect(defaultSettings.status).toBe(200);
    expect(await defaultSettings.json()).toMatchObject({
      bankTransferEnabled: false, bankName: null, accountName: null, accountNumber: null,
    });

    const invalid = await fetch(`${baseUrl}/school/finance/settings?schoolId=1`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-role": "SCHOOL_ADMIN", "x-test-school": "1" },
      body: JSON.stringify({
        bankTransferEnabled: true, bankName: "Test Bank", accountName: "Test School", accountNumber: "1234",
      }),
    });
    expect(invalid.status).toBe(400);
    expect(state.bankSettings).toBeNull();
  });

  it("refuses manual transfer creation when school bank settings are unavailable", async () => {
    state.bankSettings = null;
    const response = await submitTransfer();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Manual bank transfers are not enabled or configured for this school" });
    expect(state.transferSubmitted).toBe(false);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO fee_payments"))).toBe(false);
  });

  it("allows a parent to read only linked invoices while the finance test DB remains in-memory", async () => {
    const response = await fetch(`${baseUrl}/parent/fees/invoices`, {
      headers: { "x-test-role": "PARENT" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(1);
    expect(state.calls.some(({ sql }) => sql.includes("parent_student_relationships"))).toBe(true);
  });
});