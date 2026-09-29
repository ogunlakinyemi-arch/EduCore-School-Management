import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  context: {
    user: {
      id: 41,
      clerkUserId: "test-user",
      email: "user@example.test",
      firstName: "Test",
      lastName: "User",
      status: "ACTIVE",
    },
    roles: [{ role: "SCHOOL_ADMIN", schoolId: 10, status: "ACTIVE" }],
  } as { user: Record<string, unknown>; roles: Array<{ role: string; schoolId: number | null; status: string }> },
  query: vi.fn(),
  connect: vi.fn(),
  queueNotification: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: state.query, connect: state.connect },
}));

vi.mock("../services/communication-service", () => ({
  queueCommunicationNotification: state.queueNotification,
}));

vi.mock("../middlewares/auth", () => {
  class MockAuthError extends Error {
    constructor(
      public readonly statusCode: number,
      message: string,
      public readonly eventType = "ACCESS_DENIED",
    ) {
      super(message);
    }
  }
  return {
    AuthError: MockAuthError,
    getUserContext: () => state.context,
    requireAuthentication: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    assertSchoolOperationalAccess: (_req: unknown, schoolId: number, roles: string[]) => {
      if (state.context.roles.some(role =>
        role.role === "PLATFORM_OWNER" && role.schoolId === null && role.status === "ACTIVE",
      )) {
        throw new MockAuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
      }
      if (!state.context.roles.some(role =>
        role.status === "ACTIVE" && role.schoolId === schoolId && roles.includes(role.role),
      )) {
        throw new MockAuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
      }
      return state.context;
    },
    handleAuthError: (error: unknown, _req: unknown, res: express.Response, next: express.NextFunction) => {
      const authError = error as { statusCode?: number; message?: string; eventType?: string };
      if (typeof authError.statusCode === "number") {
        res.status(authError.statusCode).json({ error: authError.message, code: authError.eventType });
        return;
      }
      next(error);
    },
  };
});

import libraryRouter from "./library";

const app = express();
app.use(express.json());
app.use("/api", libraryRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Library test server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

beforeEach(() => {
  state.context = {
    user: {
      id: 41,
      clerkUserId: "test-user",
      email: "user@example.test",
      firstName: "Test",
      lastName: "User",
      status: "ACTIVE",
    },
    roles: [{ role: "SCHOOL_ADMIN", schoolId: 10, status: "ACTIVE" }],
  };
  state.query.mockReset().mockResolvedValue({ rows: [] });
  state.connect.mockReset();
  state.queueNotification.mockReset().mockResolvedValue(1);
});

function mockTransaction(
  resolve: (sql: string, values: unknown[]) => { rows: Array<Record<string, any>>; rowCount?: number | null },
) {
  const client = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => resolve(sql, values)),
    release: vi.fn(),
  };
  state.connect.mockResolvedValue(client);
  return client;
}

describe("library API school and borrower boundaries", () => {
  it("scopes catalogue search, availability and pagination to the requested school", async () => {
    state.query.mockResolvedValueOnce({ rows: [{ id: 3, schoolId: 10, title: "Physics" }] });

    const response = await fetch(`${baseUrl}/api/library/books?schoolId=10&q=physics&categoryId=2&availability=AVAILABLE`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ schoolId: 10, items: [{ title: "Physics" }] });
    expect(state.query).toHaveBeenCalledOnce();
    const [sql, values] = state.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("b.school_id=$1");
    expect(sql).toContain("EXISTS (SELECT 1 FROM library_book_copies");
    expect(values).toEqual([10, "%physics%", 2, 50, 0]);
  });

  it("creates a book after excluding schoolId from book-field validation", async () => {
    const client = mockTransaction(sql => {
      if (sql.includes("INSERT INTO library_books")) {
        return { rows: [{ id: 8, schoolId: 10, title: "New title", status: "ACTIVE" }] };
      }
      return { rows: [] };
    });

    const response = await fetch(`${baseUrl}/api/library/books`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 10, title: "New title" }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ schoolId: 10, title: "New title" });
    const insert = client.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO library_books"));
    expect(insert?.[1]).toEqual(["New title", 10, 41]);
  });

  it("updates a book after excluding schoolId from book-field validation", async () => {
    const client = mockTransaction(sql => {
      if (sql.includes("UPDATE library_books SET")) {
        return { rows: [{ id: 8, schoolId: 10, title: "Updated title", status: "ACTIVE" }] };
      }
      return { rows: [] };
    });

    const response = await fetch(`${baseUrl}/api/library/books/8`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 10, title: "Updated title" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 8, title: "Updated title" });
    const update = client.query.mock.calls.find(([sql]) => String(sql).includes("UPDATE library_books SET"));
    expect(update?.[1]).toEqual(["Updated title", 8, 10]);
  });

  it("retries a serialization conflict once after rolling back and releasing the first client", async () => {
    let insertAttempts = 0;
    const makeClient = (failFirstAttempt: boolean) => ({
      query: vi.fn(async (sql: string) => {
        if (sql.includes("INSERT INTO library_books")) {
          insertAttempts += 1;
          if (failFirstAttempt) throw Object.assign(new Error("serialization failure"), { code: "40001" });
          return { rows: [{ id: 8, schoolId: 10, title: "Retry title", status: "ACTIVE" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    });
    const firstClient = makeClient(true);
    const secondClient = makeClient(false);
    state.connect.mockResolvedValueOnce(firstClient).mockResolvedValueOnce(secondClient);

    const response = await fetch(`${baseUrl}/api/library/books`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 10, title: "Retry title" }),
    });

    expect(response.status).toBe(201);
    expect(insertAttempts).toBe(2);
    expect(firstClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(firstClient.release).toHaveBeenCalledOnce();
    expect(secondClient.query).toHaveBeenCalledWith("COMMIT");
    expect(secondClient.release).toHaveBeenCalledOnce();
  });

  it("denies a teacher from creating catalogue records even with a school context", async () => {
    state.context.roles = [{ role: "TEACHER", schoolId: 10, status: "ACTIVE" }];

    const response = await fetch(`${baseUrl}/api/library/books`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 10, title: "Unauthorized title" }),
    });

    expect(response.status).toBe(403);
    expect(state.query).toHaveBeenCalledOnce();
    expect(state.query.mock.calls[0]?.[0]).toContain("FROM library_staff");
  });

  it("does not expose loans to a student from another school", async () => {
    state.context.roles = [{ role: "STUDENT", schoolId: 10, status: "ACTIVE" }];
    state.query.mockResolvedValue({ rows: [] });

    const response = await fetch(`${baseUrl}/api/library/loans?schoolId=20`);

    expect(response.status).toBe(404);
    expect(state.query).toHaveBeenCalledTimes(2);
    expect(state.query.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining("FROM students"),
      expect.stringContaining("FROM parents"),
    ]);
  });

  it("limits a parent's borrowing-history query to active linked children", async () => {
    state.context.user.id = 72;
    state.context.roles = [{ role: "PARENT", schoolId: 10, status: "ACTIVE" }];
    state.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{
        id: 1,
        borrowerStudentId: 501,
        borrowerUserId: 87,
        bookTitle: "Linked child's book",
      }] });

    const response = await fetch(`${baseUrl}/api/library/loans?schoolId=10`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ borrowerStudentId: 501, bookTitle: "Linked child's book" }]);
    expect(state.query).toHaveBeenCalledTimes(3);
    const [sql, values] = state.query.mock.calls[2] as [string, unknown[]];
    expect(sql).toContain("psr.student_id=l.borrower_student_id");
    expect(sql).toContain("l.borrower_user_id=$2");
    expect(sql).toContain("UPPER(psr.status)='ACTIVE'");
    expect(sql).toContain("p.school_id=$1");
    expect(values).toEqual([10, 72, 50]);
  });

  it("does not return a linked child's loans across school boundaries", async () => {
    state.context.user.id = 72;
    state.context.roles = [{ role: "PARENT", schoolId: 10, status: "ACTIVE" }];
    state.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await fetch(`${baseUrl}/api/library/loans?schoolId=20`);

    expect(response.status).toBe(404);
    expect(state.query).toHaveBeenCalledTimes(2);
    expect(state.query.mock.calls[1]?.[1]).toEqual([20, 72]);
  });

  it("denies an accountant access to library overdue information", async () => {
    state.context.roles = [{ role: "ACCOUNTANT", schoolId: 10, status: "ACTIVE" }];

    const response = await fetch(`${baseUrl}/api/library/overdue?schoolId=10`);

    expect(response.status).toBe(403);
    expect(state.query).not.toHaveBeenCalled();
  });

  it("rejects attempts to enable library fines", async () => {
    const response = await fetch(`${baseUrl}/api/library/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 10, finesEnabled: true }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Library fines are disabled until Finance integration is implemented" });
    expect(state.query).not.toHaveBeenCalled();
    expect(state.connect).not.toHaveBeenCalled();
  });

  it("keeps overdue results school-scoped and limited to currently overdue open loans", async () => {
    state.query.mockResolvedValueOnce({ rows: [{ id: 7, schoolId: 10, overdue: true }] });

    const response = await fetch(`${baseUrl}/api/library/overdue?schoolId=10`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: 7, schoolId: 10, overdue: true }]);
    const [sql, values] = state.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("l.school_id=$1 AND l.status='OPEN' AND l.due_on<CURRENT_DATE");
    expect(values).toEqual([10, 50]);
  });

  it("pages past already-notified overdue loans, counts new events only, and links each recipient to an accessible page", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      id: index + 1,
      borrowerUserId: 10_000 + index,
      studentId: null,
      title: `Already notified ${index + 1}`,
      dueOn: "2026-01-01",
      daysOverdue: 10,
    }));
    const childLoan = {
      id: 501,
      borrowerUserId: 87,
      studentId: 501,
      title: "Child's overdue book",
      dueOn: "2026-01-02",
      daysOverdue: 9,
    };
    let page = 0;
    const client = mockTransaction((sql, values) => {
      if (sql.includes("FROM library_loans l JOIN library_books b")) {
        page += 1;
        return { rows: page === 1 ? firstPage : page === 2 ? [childLoan] : [] };
      }
      if (sql.includes("FROM parents p JOIN parent_student_relationships")) {
        return { rows: [{ userId: 72 }] };
      }
      if (sql.includes("SELECT 1 FROM communication_notifications")) {
        const loanId = Number(String(values[2]).split(":")[1]);
        return { rows: loanId <= 500 ? [{ id: 1 }] : [] };
      }
      return { rows: [] };
    });
    state.queueNotification.mockResolvedValue(9001);

    const response = await fetch(`${baseUrl}/api/library/overdue/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 10 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schoolId: 10, notificationsQueued: 2 });
    expect(page).toBe(2);
    const pageQueries = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM library_loans l JOIN library_books b"),
    );
    expect(pageQueries).toHaveLength(2);
    expect(pageQueries[0]?.[0]).toContain("NOT EXISTS");
    expect(pageQueries[0]?.[1]).toEqual([10, null, 0, 500]);
    expect(pageQueries[1]?.[1]).toEqual([10, "2026-01-01", 500, 500]);
    expect(state.queueNotification).toHaveBeenCalledTimes(2);
    const recipients = state.queueNotification.mock.calls.map(([, input]) => input);
    expect(recipients.map((input: { recipientUserId: number; link: string }) => ({
      recipientUserId: input.recipientUserId,
      link: input.link,
    }))).toEqual([
      { recipientUserId: 87, link: "/library/loans" },
      { recipientUserId: 72, link: "/parent/library/501" },
    ]);
  });

  it("rejects a Platform Owner from school library write access", async () => {
    state.context.roles = [{ role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }];

    const response = await fetch(`${baseUrl}/api/library/books`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 10, title: "Owner bypass attempt" }),
    });

    expect(response.status).toBe(404);
    expect(state.query).not.toHaveBeenCalled();
  });

  it("rejects a duplicate physical-copy code reported by the database", async () => {
    const client = mockTransaction(sql => {
      if (sql.includes("SELECT id FROM library_books")) return { rows: [{ id: 3 }] };
      if (sql.includes("INSERT INTO library_book_copies")) {
        throw Object.assign(new Error("duplicate copy code"), { code: "23505" });
      }
      return { rows: [] };
    });

    const response = await fetch(`${baseUrl}/api/library/books/3/copies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 10, copyCode: "COPY-001" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "A conflicting library record already exists" });
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO library_book_copies"))).toBe(true);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects a second issue when the copy is already borrowed", async () => {
    let copyStatus = "AVAILABLE";
    let issueCount = 0;
    const client = mockTransaction(sql => {
      if (sql.includes("SELECT id FROM library_loans") && sql.includes("idempotency_key")) return { rows: [] };
      if (sql.includes("SELECT * FROM library_settings")) {
        return { rows: [{
          student_borrowing_enabled: true,
          max_books_per_student: 3,
          student_loan_days: 14,
        }] };
      }
      if (sql.includes("FROM students s")) return { rows: [{ id: 501 }] };
      if (sql.includes("SELECT count(*)")) return { rows: [{ count: 0 }] };
      if (sql.includes("FROM library_book_copies cp JOIN library_books")) {
        return { rows: [{ id: 9, bookId: 3, status: copyStatus, bookStatus: "ACTIVE" }] };
      }
      if (sql.includes("INSERT INTO library_loans")) {
        issueCount += 1;
        return { rows: [{ id: 60, copyId: 9, borrowerUserId: 87 }] };
      }
      if (sql.includes("UPDATE library_book_copies SET status='BORROWED'")) {
        copyStatus = "BORROWED";
      }
      return { rows: [] };
    });

    const issue = (idempotencyKey: string) => fetch(`${baseUrl}/api/library/loans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schoolId: 10,
        copyId: 9,
        borrowerType: "STUDENT",
        borrowerUserId: 87,
        borrowerStudentId: 501,
        idempotencyKey,
      }),
    });
    const firstResponse = await issue("issue-first");
    expect(firstResponse.status).toBe(201);
    const secondResponse = await issue("issue-again");

    expect(secondResponse.status).toBe(409);
    expect(await secondResponse.json()).toMatchObject({ error: "Copy is not currently available" });
    expect(issueCount).toBe(1);
    expect(client.query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO library_loans"))).toHaveLength(1);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("renews an active loan once and returns the renewal dates", async () => {
    const client = mockTransaction(sql => {
      if (sql.includes("SELECT copy_id AS")) return { rows: [{ copyId: 9 }] };
      if (sql.includes("SELECT status FROM library_book_copies")) return { rows: [{ status: "BORROWED" }] };
      if (sql.includes("borrower_type AS \"borrowerType\"")) {
        return { rows: [{
          id: 55,
          borrowerUserId: 41,
          borrowerType: "STUDENT",
          borrowerStudentId: 501,
          dueOn: "2026-09-01",
          status: "OPEN",
          renewalCount: 0,
          copyId: 9,
        }] };
      }
      if (sql.includes("FROM students s")) return { rows: [{ id: 501 }] };
      if (sql.includes("FROM library_renewals")) return { rows: [] };
      if (sql.includes("SELECT * FROM library_settings")) {
        return { rows: [{ max_renewals: 2, renewal_requires_not_overdue: false, student_loan_days: 14 }] };
      }
      if (sql.includes("UPDATE library_loans SET due_on")) {
        return { rows: [{ newDueOn: "2026-09-15", renewalCount: 1 }] };
      }
      if (sql.includes("INSERT INTO library_renewals")) {
        return { rows: [{ id: 8, loanId: 55, previousDueOn: "2026-09-01", newDueOn: "2026-09-15" }] };
      }
      return { rows: [] };
    });

    const response = await fetch(`${baseUrl}/api/library/loans/55/renew`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 10, idempotencyKey: "renew-55-once" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ loanId: 55, previousDueOn: "2026-09-01", newDueOn: "2026-09-15" });
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE library_loans SET due_on"))).toBe(true);
    const lockQueries = client.query.mock.calls.map(([sql]) => String(sql))
      .filter(sql => sql.includes("FOR UPDATE"));
    expect(lockQueries[0]).toContain("library_book_copies");
    expect(lockQueries[1]).toContain("library_loans");
    expect(client.query).toHaveBeenCalledWith("COMMIT");
  });

  it("returns a loan and records the overdue state", async () => {
    const client = mockTransaction(sql => {
      if (sql.includes("SELECT copy_id AS")) return { rows: [{ copyId: 9 }] };
      if (sql.includes("SELECT status FROM library_book_copies")) return { rows: [{ status: "BORROWED" }] };
      if (sql.includes("borrower_type AS \"borrowerType\"")) {
        return { rows: [{
          id: 55,
          copyId: 9,
          borrowerUserId: 41,
          borrowerType: "STUDENT",
          borrowerStudentId: 501,
          status: "OPEN",
        }] };
      }
      if (sql.includes("FROM students s")) return { rows: [{ id: 501 }] };
      if (sql.includes("SELECT id,school_id AS") && sql.includes("returned_overdue AS")) {
        return { rows: [{
          id: 55,
          schoolId: 10,
          copyId: 9,
          status: "RETURNED",
          returnedOverdue: true,
          daysOverdueAtReturn: 4,
        }] };
      }
      return { rows: [] };
    });

    const response = await fetch(`${baseUrl}/api/library/loans/55/return`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 10 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "RETURNED",
      returnedOverdue: true,
      daysOverdueAtReturn: 4,
    });
    expect(client.query.mock.calls.some(([sql]) =>
      String(sql).includes("returned_overdue=(due_on<CURRENT_DATE)"),
    )).toBe(true);
    const lockQueries = client.query.mock.calls.map(([sql]) => String(sql))
      .filter(sql => sql.includes("FOR UPDATE"));
    expect(lockQueries[0]).toContain("library_book_copies");
    expect(lockQueries[1]).toContain("library_loans");
    expect(client.query).toHaveBeenCalledWith("COMMIT");
  });

  it("locks a copy before locking its active loan when changing copy status", async () => {
    const client = mockTransaction(sql => {
      if (sql.includes("SELECT id,status,book_id AS")) return { rows: [{ id: 9, status: "AVAILABLE", bookId: 3 }] };
      if (sql.includes("SELECT id FROM library_loans")) return { rows: [] };
      return { rows: [] };
    });

    const response = await fetch(`${baseUrl}/api/library/copies/9/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 10, status: "DAMAGED", reason: "Inspection" }),
    });

    expect(response.status).toBe(200);
    const lockQueries = client.query.mock.calls.map(([sql]) => String(sql))
      .filter(sql => sql.includes("FOR UPDATE"));
    expect(lockQueries[0]).toContain("library_book_copies");
    expect(lockQueries[1]).toContain("library_loans");
  });

  it("rejects an owner's return after the student's active entitlement is revoked", async () => {
    const client = mockTransaction(sql => {
      if (sql.includes("SELECT copy_id AS")) return { rows: [{ copyId: 9 }] };
      if (sql.includes("SELECT status FROM library_book_copies")) return { rows: [{ status: "BORROWED" }] };
      if (sql.includes("borrower_type AS \"borrowerType\"")) {
        return { rows: [{
          id: 55,
          copyId: 9,
          borrowerUserId: 41,
          borrowerType: "STUDENT",
          borrowerStudentId: 501,
          status: "OPEN",
        }] };
      }
      if (sql.includes("FROM students s")) return { rows: [] };
      return { rows: [] };
    });

    const response = await fetch(`${baseUrl}/api/library/loans/55/return`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 10 }),
    });

    expect(response.status).toBe(404);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE library_loans"))).toBe(false);
    const lockQueries = client.query.mock.calls.map(([sql]) => String(sql))
      .filter(sql => sql.includes("FOR UPDATE"));
    expect(lockQueries[0]).toContain("library_book_copies");
    expect(lockQueries[1]).toContain("library_loans");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("rejects an owner's renewal after the student's active entitlement is revoked", async () => {
    const client = mockTransaction(sql => {
      if (sql.includes("SELECT copy_id AS")) return { rows: [{ copyId: 9 }] };
      if (sql.includes("SELECT status FROM library_book_copies")) return { rows: [{ status: "BORROWED" }] };
      if (sql.includes("borrower_type AS \"borrowerType\"")) {
        return { rows: [{
          id: 55,
          borrowerUserId: 41,
          borrowerType: "STUDENT",
          borrowerStudentId: 501,
          dueOn: "2026-09-01",
          status: "OPEN",
          renewalCount: 0,
          copyId: 9,
        }] };
      }
      if (sql.includes("FROM students s")) return { rows: [] };
      return { rows: [] };
    });

    const response = await fetch(`${baseUrl}/api/library/loans/55/renew`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 10, idempotencyKey: "revoked-borrower-renewal" }),
    });

    expect(response.status).toBe(404);
    expect(client.query.mock.calls.some(([sql]) =>
      String(sql).includes("UPDATE library_loans SET due_on"),
    )).toBe(false);
    const lockQueries = client.query.mock.calls.map(([sql]) => String(sql))
      .filter(sql => sql.includes("FOR UPDATE"));
    expect(lockQueries[0]).toContain("library_book_copies");
    expect(lockQueries[1]).toContain("library_loans");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });
});