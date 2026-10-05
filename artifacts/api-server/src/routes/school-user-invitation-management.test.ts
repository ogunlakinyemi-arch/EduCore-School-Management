import express from "express";
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_PRODUCTION_ORIGIN } from "./invitation-redirect";

const state = vi.hoisted(() => ({
  context: {
    user: {
      id: 8,
      clerkUserId: "user_admin",
      email: "admin@example.test",
      firstName: "School",
      lastName: "Admin",
      status: "ACTIVE",
    },
    roles: [{ id: 2, role: "SCHOOL_ADMIN", schoolId: 12 as number | null, status: "ACTIVE" }],
  },
  records: new Map<string, any>(),
  attempts: new Map<string, any>(),
  providerInvitations: new Map<string, any>(),
  providerEvents: [] as string[],
  createdOptions: null as any,
  statuses: new Map<string, string>(),
  supersededClaims: new Set<string>(),
  registeredMemberships: new Set<string>(),
  activatedClaims: new Set<string>(),
  commitMode: "none" as "none" | "committed-then-error" | "rolled-back-then-error",
  activationEmail: "",
  activationMarker: null as any,
  activateBeforeReplacement: false,
  linkStudentBeforeReplacement: false,
  clientSqlQueries: [] as string[],
  locks: new Set<string>(),
  query: vi.fn(),
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  getInvitationList: vi.fn(),
  getUser: vi.fn(),
  updateUserMetadata: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: state.query, connect: state.connect },
}));
vi.mock("@clerk/express", () => ({
  clerkClient: {
    invitations: {
      createInvitation: state.createInvitation,
      revokeInvitation: state.revokeInvitation,
      getInvitationList: state.getInvitationList,
    },
    users: { getUser: state.getUser, updateUserMetadata: state.updateUserMetadata },
  },
}));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    getUserContext: () => state.context,
  };
});

import schoolInvitationManagementRouter from "./school-invitation-management";
import { activateAcceptedSchoolInvitation } from "./school-invitations";

const app = express();
app.use(express.json());
app.use(schoolInvitationManagementRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const authError = error as { statusCode?: number; message?: string };
  res.status(authError.statusCode ?? 500).json({ error: authError.message ?? String(error) });
});

let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => error ? reject(error) : resolve()),
));

const roles = ["TEACHER", "ACCOUNTANT", "PARENT", "STUDENT", "STAFF", "DRIVER"] as const;
const claimFor = (suffix: string) => `aaaaaaaa-aaaa-4aaa-8aaa-${suffix.padStart(12, "0")}`;
const emailFor = (prefix: string, index: number) => `${prefix}-${index}@school.test`;

function record(invitationId: string, role: string, email: string, claimId: string, extra: Record<string, unknown> = {}) {
  const roleMarker: Record<string, unknown> = {
    version: 1,
    claimId,
    emailProof: "c".repeat(64),
    schoolId: 12,
    role,
    firstName: "Invitee",
    lastName: role,
    studentId: role === "STUDENT" ? 42 : null,
    employeeNo: role === "TEACHER" || role === "STAFF" || role === "DRIVER" ? "INV-0123456789ABCDEF" : null,
    ...extra,
  };
  return {
    id: invitationId,
    createdAt: "2025-01-01T00:00:00.000Z",
    metadata: {
      invitationId,
      claimId,
      invitedEmail: email,
      role,
      firstName: "Invitee",
      lastName: role,
    },
    publicMetadata: { edupulseSchoolInvitation: roleMarker },
  };
}

function seedThree(role: string) {
  state.records.clear();
  state.attempts.clear();
  state.providerInvitations.clear();
  state.statuses.clear();
  state.supersededClaims.clear();
  state.registeredMemberships.clear();
  state.activatedClaims.clear();
  state.locks.clear();
  state.providerEvents.length = 0;
  for (const [index, key] of ["first", "middle", "last"].entries()) {
    const invitationId = `${key}_${role.toLowerCase()}`;
    const invitation = record(
      invitationId,
      role,
      emailFor(role.toLowerCase(), index),
      claimFor(String(index + 1)),
    );
    state.records.set(invitationId, invitation);
    state.statuses.set(invitationId, "pending");
    state.providerInvitations.set(invitationId, {
      id: invitationId,
      emailAddress: invitation.metadata.invitedEmail,
      status: "pending",
      publicMetadata: invitation.publicMetadata,
    });
  }
}

beforeEach(() => {
  vi.stubEnv("CLERK_SECRET_KEY", "test-clerk-server-key");
  vi.stubEnv("NODE_ENV", "test");
  vi.clearAllMocks();
  state.context.roles = [{ id: 2, role: "SCHOOL_ADMIN", schoolId: 12, status: "ACTIVE" }];
  state.commitMode = "none";
  state.activationEmail = "";
  state.activationMarker = null;
  state.activateBeforeReplacement = false;
  state.linkStudentBeforeReplacement = false;
  state.clientSqlQueries.length = 0;
  state.providerEvents.length = 0;
  seedThree("TEACHER");
  state.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    const schoolId = Number(values[0]);
    if (sql.includes("SELECT") && sql.includes("SCHOOL_INVITATION_REPLACEMENT_ATTEMPT")) {
      if (sql.includes("FROM audit_logs attempt")) {
        return {
          rows: [...state.attempts.values()]
            .filter((attempt) =>
              attempt.metadata.schoolId === schoolId &&
              [
                "PREPARED", "REVOCATION_REJECTED", "REVOCATION_UNKNOWN",
                "DISPATCHING", "DISPATCH_REJECTED", "OUTCOME_UNKNOWN", "MULTIPLE_MATCHES",
              ].includes(attempt.metadata.attemptStatus)
            )
            .map((attempt) => ({ id: attempt.id, metadata: attempt.metadata, createdAt: attempt.createdAt })),
        };
      }
      if (sql.includes("metadata->>'selectedInvitationId'=$2")) {
        const attempt = [...state.attempts.values()].find((item) =>
          item.metadata.schoolId === schoolId && item.metadata.selectedInvitationId === values[1]
        );
        return attempt ? { rows: [{ id: attempt.id, metadata: attempt.metadata }] } : { rows: [] };
      }
      const attempt = state.attempts.get(String(values[1] ?? ""));
      if (attempt && attempt.metadata.schoolId === schoolId) {
        return { rows: [{ id: attempt.id, metadata: attempt.metadata, createdAt: attempt.createdAt }] };
      }
      return { rows: [] };
    }
    if (sql.includes("UPDATE audit_logs") && sql.includes("SCHOOL_INVITATION_REPLACEMENT_ATTEMPT") && sql.includes("metadata->>'attemptId'=$2")) {
      const attempt = state.attempts.get(String(values[1] ?? ""));
      if (!attempt || attempt.metadata.attemptStatus !== "PREPARED") return { rows: [] };
      attempt.metadata = { ...attempt.metadata, attemptStatus: "DISPATCHING" };
      return { rows: [{ id: attempt.id, metadata: attempt.metadata }] };
    }
    if (sql.includes("UPDATE audit_logs") && sql.includes("SCHOOL_INVITATION_REPLACEMENT_ATTEMPT") && sql.includes("metadata->>'attemptId'=$3")) {
      const attempt = state.attempts.get(String(values[2] ?? ""));
      if (!attempt) return { rows: [] };
      const extra = JSON.parse(String(values[0]));
      attempt.metadata = { ...attempt.metadata, ...extra };
      return { rows: [{ id: attempt.id, metadata: attempt.metadata }] };
    }
    if (
      sql.includes("UPDATE audit_logs") &&
      sql.includes("audit_logs") &&
      (sql.includes("RETURNING metadata") || sql.includes("DISPATCHING") || sql.includes("CANCELLED"))
    ) {
      const attempt = state.attempts.get(String(values[2] ?? ""));
      if (!attempt) return { rows: [] };
      const extra = JSON.parse(String(values[0]));
      attempt.metadata = { ...attempt.metadata, ...extra };
      return { rows: [{ id: attempt.id, metadata: attempt.metadata }] };
    }
    if (sql.includes("UPDATE audit_logs") && sql.includes("SCHOOL_INVITATION_SUPERSEDED")) return { rows: [] };
    if (sql.includes("FROM audit_logs") && sql.includes("event_type='USER_INVITED'")) {
      if (schoolId !== 12) return { rows: [] };
      const result = Array.isArray(values[1])
        ? [...state.records.values()].filter((item) => (values[1] as string[]).includes(item.metadata.role))
        : [state.records.get(String(values[1] ?? ""))].filter(Boolean);
      return { rows: result };
    }
    if (sql.includes("metadata->>'supersedesClaimId'")) {
      return {
        rows: values[1]
          ? state.supersededClaims.has(String(values[1])) ? [{ claimId: String(values[1]) }] : []
          : [...state.supersededClaims].map((claimId) => ({ claimId })),
      };
    }
    if (sql.includes("school_memberships")) {
      const registered = [...state.registeredMemberships].map((item) => {
          const [email, role] = item.split(":");
          return { email, role };
      });
      return {
        rows: typeof values[0] === "string"
          ? registered.filter((item) => item.email === values[0] && item.role === values[2])
          : registered,
      };
    }
    if (sql.includes("FROM app_users WHERE lower(email)")) return { rows: [] };
    if (sql.includes("FROM schools WHERE id=$1")) return { rows: [{ id: schoolId }] };
    if (sql.includes("metadata->>'invitationId'=$1")) {
      return { rows: [...state.records.values()].some((item) => item.metadata.invitationId === values[0]) ? [{ id: 1 }] : [] };
    }
    return { rows: [] };
  });
  state.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
    state.clientSqlQueries.push(sql);
    if (sql.includes("pg_try_advisory_lock")) {
      const key = String(values[0]);
      if (state.locks.has(key)) return { rows: [{ locked: false }] };
      state.locks.add(key);
      return { rows: [{ locked: true }] };
    }
    if (sql.includes("pg_advisory_unlock")) {
      return { rows: [{ unlocked: state.locks.delete(String(values[0])) }] };
    }
    if (sql === "COMMIT" && state.commitMode !== "none") {
      const mode = state.commitMode;
      state.commitMode = "none";
      if (mode === "rolled-back-then-error") {
        state.attempts.clear();
        state.supersededClaims.clear();
        for (const item of state.records.values()) {
          delete item.metadata.superseded;
          delete item.metadata.supersededByAttemptId;
        }
      }
      throw new Error("connection lost while resolving COMMIT");
    }
    if (sql.includes("FROM app_users WHERE id=$1 AND clerk_user_id=$2")) {
      return { rows: [{ id: values[0], email: state.activationEmail, status: "ACTIVE" }] };
    }
    if (sql.includes("current_invite.id")) {
      const claimId = String(values[1]);
      const canonical = [...state.records.values()].find((item) => item.metadata.claimId === claimId && !item.metadata.superseded);
      const attempt = [...state.attempts.values()].find((item) =>
        item.metadata.claimId === claimId &&
        ["DISPATCHING", "OUTCOME_UNKNOWN", "MULTIPLE_MATCHES", "COMPLETED"].includes(item.metadata.attemptStatus)
      );
      return canonical || attempt ? { rows: [{ id: 1 }] } : { rows: [] };
    }
    if (sql.includes("role = 'DEVICE_ACTIVATION_OFFICER'")) return { rows: [] };
    if (sql.includes("INSERT INTO school_memberships")) return { rows: [{ id: 101 }] };
    if (sql.includes("'USER_ACTIVATED'") && sql.includes("INSERT INTO audit_logs")) {
      const metadata = JSON.parse(String(values[7]));
      state.activatedClaims.add(metadata.claimId);
      return { rows: [] };
    }
    if (sql.includes("SCHOOL_INVITATION_REPLACEMENT_ATTEMPT") && sql.includes("SELECT")) {
      const attempt = state.attempts.get(String(values[1] ?? ""));
      return attempt ? { rows: [{ id: attempt.id, metadata: attempt.metadata }] } : { rows: [] };
    }
    if (sql.includes("metadata->>'invitationId'=$2")) {
      const existing = state.records.get(String(values[1]));
      return existing && (!values[3] || existing.metadata.claimId === values[3])
        ? { rows: [{ id: existing.id, metadata: existing.metadata }] }
        : { rows: [] };
    }
    if (sql.includes("USER_ACTIVATED") && sql.includes("SELECT 1")) {
      if (state.activateBeforeReplacement) {
        state.activateBeforeReplacement = false;
        state.activatedClaims.add(String(values[1]));
      }
      return { rows: state.activatedClaims.has(String(values[1])) ? [{ id: 1 }] : [] };
    }
    if (sql.includes("UPDATE audit_logs") && sql.includes("SCHOOL_INVITATION_REPLACEMENT_ATTEMPT")) {
      const attemptId = String(values[1] ?? values[0] ?? "");
      const attempt = state.attempts.get(attemptId);
      if (!attempt) return { rows: [] };
      if (sql.includes("$1::jsonb")) {
        attempt.metadata = { ...attempt.metadata, ...JSON.parse(String(values[0])) };
      } else if (sql.includes("DISPATCHING")) {
        attempt.metadata = { ...attempt.metadata, attemptStatus: "DISPATCHING" };
      } else if (sql.includes("CANCELLED")) {
        attempt.metadata = { ...attempt.metadata, attemptStatus: "CANCELLED" };
      }
      return { rows: [{ id: attempt.id, metadata: attempt.metadata }] };
    }
    if (sql.includes("UPDATE audit_logs") && sql.includes("supersededByAttemptId")) {
      const oldRecord = [...state.records.values()].find((item) => item.id === values[2]);
      if (oldRecord) {
        oldRecord.metadata = {
          ...oldRecord.metadata,
          superseded: true,
          supersededByClaimId: values[0],
          supersededByAttemptId: values[1],
        };
        state.supersededClaims.add(oldRecord.metadata.claimId);
      }
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO audit_logs") && sql.includes("SCHOOL_INVITATION_REPLACEMENT_ATTEMPT")) {
      const metadata = JSON.parse(String(values[5]));
      state.attempts.set(metadata.attemptId, {
        id: metadata.attemptId,
        metadata,
        createdAt: new Date().toISOString(),
      });
      return { rows: [] };
    }
    if (sql.includes("UPDATE audit_logs") && sql.includes("providerInvitationId")) {
      const attempt = [...state.attempts.values()].find((item) => item.id === values[1]);
      if (attempt) {
        attempt.metadata = {
          ...attempt.metadata,
          attemptStatus: "COMPLETED",
          providerInvitationId: values[0],
        };
      }
      return { rows: [] };
    }
    if (sql.includes("UPDATE audit_logs") && sql.includes("supersededByInvitationId")) {
      const oldRecord = state.records.get(String(values[3]));
      if (oldRecord) state.supersededClaims.add(oldRecord.metadata.claimId);
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO audit_logs") && values[7] === "USER_INVITED") {
      const metadata = JSON.parse(String(values[8]));
      const inviteId = String(metadata.invitationId);
      const marker = state.createdOptions?.publicMetadata?.edupulseSchoolInvitation;
      state.records.set(inviteId, {
        id: inviteId,
        createdAt: new Date().toISOString(),
        metadata,
        publicMetadata: { edupulseSchoolInvitation: marker },
      });
      state.statuses.set(inviteId, "pending");
      return { rows: [] };
    }
    if (sql.includes("SELECT id,user_id AS") && sql.includes("FROM parents")) {
      return { rows: [{ id: 90, userId: null }] };
    }
    if (sql.includes("SELECT id,user_id AS") && sql.includes("FROM students")) {
      return {
        rows: [{
          id: 42,
          userId: state.linkStudentBeforeReplacement ? 88 : null,
        }],
      };
    }
    if (sql.includes("SELECT id,user_id AS") && sql.includes("FROM employees")) {
      const matched = [...state.records.values()].find((item) => item.metadata.invitedEmail === values[1]);
      const role = matched?.metadata.role ?? state.activationMarker?.role;
      return { rows: [{
        id: 91,
        userId: null,
        type: role,
        // Legacy Accountant invitations have no employeeNo claim; model their
        // already-existing employee profile as active and bind it by stored role.
        status: role === "ACCOUNTANT" ? "ACTIVE" : "PENDING",
        employeeNo: state.activationMarker?.employeeNo,
      }] };
    }
    return { rows: [] };
  });
  state.connect.mockResolvedValue({ query: state.clientQuery, release: state.release });
  state.getInvitationList.mockImplementation(async ({ query, status,offset=0,limit=100 }: { query?: string; status: string;offset?:number;limit?:number }) => {
    if(!query) {
      const records=[...state.records.entries()].filter(([id])=>state.statuses.get(id)===status)
        .map(([id,invitation])=>({id,status,publicMetadata:invitation.publicMetadata}));
      const all=new Map(records.map(i=>[i.id,i]));
      for(const i of state.providerInvitations.values()) all.set(i.id,i);
      const data=[...all.values()].filter(i=>i.status===status);
      return {data:data.slice(offset,offset+limit),totalCount:data.length};
    }
    const providerMatch = [...state.providerInvitations.values()].filter((item) =>
      (item.id === query || item.emailAddress === query) && item.status === status
    );
    if (providerMatch.length) return { data: providerMatch };
    const invitation = state.records.get(query);
    return invitation && state.statuses.get(query) === status
      ? { data: [{ id: query, status, publicMetadata: invitation.publicMetadata }] }
      : { data: [] };
  });
  let replacementCounter = 0;
  state.createInvitation.mockImplementation(async (options: any) => {
    state.providerEvents.push(`create:${options.emailAddress}`);
    if ([...state.providerInvitations.values()].some((item) =>
      item.emailAddress === options.emailAddress && item.status === "pending"
    )) {
      throw { status: 422, errors: [{ code: "form_identifier_exists" }] };
    }
    state.createdOptions = options;
    replacementCounter += 1;
    const invitation = {
      id: `replacement_${replacementCounter}`,
      createdAt: Date.now(),
      status: "pending",
    };
    state.providerInvitations.set(invitation.id, {
      ...invitation,
      emailAddress: options.emailAddress,
      publicMetadata: options.publicMetadata,
    });
    return invitation;
  });
  state.revokeInvitation.mockImplementation(async (id: string) => {
    state.providerEvents.push(`revoke:${id}`);
    if (state.statuses.has(id)) state.statuses.set(id, "revoked");
    if (state.providerInvitations.has(id)) {
      state.providerInvitations.set(id, { ...state.providerInvitations.get(id), status: "revoked" });
    }
    return {};
  });
});

afterEach(() => vi.unstubAllEnvs());

async function request(path: string, method = "GET", body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe.each(roles)("School Admin invitation management for %s", (role) => {
  beforeEach(() => seedThree(role));

  it("resends only the selected middle invitation and preserves role claims and canonical redirect", async () => {
    const selectedId = `middle_${role.toLowerCase()}`;
    const response = await request(`/schools/12/users/invitations/${selectedId}/resend`, "POST", {});
    expect(response.status, await response.clone().text()).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({
      status: "PENDING",
      invitationId: "replacement_1",
      supersededInvitationId: selectedId,
      email: emailFor(role.toLowerCase(), 1),
      role,
      deliveryStatus: "UNVERIFIED",
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      emailAddress: emailFor(role.toLowerCase(), 1),
      ignoreExisting: false,
      redirectUrl: `${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation`,
    }));
    expect(state.createdOptions.publicMetadata.edupulseSchoolInvitation).toMatchObject({
      schoolId: 12,
      role,
      claimId: expect.any(String),
      emailProof: expect.any(String),
      ...(role === "STUDENT" ? { studentId: 42 } : {}),
      ...(role === "TEACHER" || role === "STAFF" || role === "DRIVER" ? { employeeNo: "INV-0123456789ABCDEF" } : {}),
    });
    expect(state.revokeInvitation).toHaveBeenCalledTimes(1);
    expect(state.revokeInvitation).toHaveBeenCalledWith(selectedId);
    expect(state.providerEvents).toEqual([
      `revoke:${selectedId}`,
      `create:${emailFor(role.toLowerCase(), 1)}`,
    ]);
    expect(state.statuses.get(`first_${role.toLowerCase()}`)).toBe("pending");
    expect(state.statuses.get(`last_${role.toLowerCase()}`)).toBe("pending");
    expect(state.supersededClaims).toContain(state.records.get(selectedId).metadata.claimId);
    expect(state.locks.size).toBe(0);
  });

  it("keeps a dispatched replacement claim activatable for the selected role", async () => {
    const selectedId = `middle_${role.toLowerCase()}`;
    const sent = await request(`/schools/12/users/invitations/${selectedId}/resend`, "POST", {});
    expect(sent.status).toBe(201);
    const replacement = state.providerInvitations.get("replacement_1");
    const marker = replacement.publicMetadata.edupulseSchoolInvitation;
    state.activationEmail = replacement.emailAddress;
    state.activationMarker = marker;
    state.getUser.mockResolvedValue({
      primaryEmailAddress: {
        emailAddress: replacement.emailAddress,
        verification: { status: "verified" },
      },
      publicMetadata: replacement.publicMetadata,
      firstName: "Invited",
      lastName: "User",
      phoneNumbers: [],
    });

    await expect(activateAcceptedSchoolInvitation(88, "clerk_invited_user")).resolves.toBe(true);
    expect(state.activatedClaims).toContain(marker.claimId);
  });

  it("does not replace a claim after activation wins the shared invitation-row lock", async () => {
    state.activateBeforeReplacement = true;
    const selectedId = `middle_${role.toLowerCase()}`;
    const response = await request(`/schools/12/users/invitations/${selectedId}/resend`, "POST", {});
    expect(response.status).toBe(409);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.clientSqlQueries.some((sql) =>
      sql.includes("metadata->>'invitationId'=$2") && sql.includes("FOR UPDATE")
    )).toBe(true);
  });

  it("keeps an invitation accepted during provider revocation active and sends no replacement", async () => {
    const selectedId = `middle_${role.toLowerCase()}`;
    state.revokeInvitation.mockImplementationOnce(async (invitationId: string) => {
      state.providerEvents.push(`revoke:${invitationId}`);
      state.statuses.set(invitationId, "accepted");
      state.providerInvitations.set(invitationId, {
        ...state.providerInvitations.get(invitationId),
        status: "accepted",
      });
      throw { status: 409 };
    });

    const response = await request(
      `/schools/12/users/invitations/${selectedId}`,
      "PATCH",
      { email: `new-${role.toLowerCase()}@school.test` },
    );
    expect(response.status).toBe(409);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.records.get(selectedId).metadata.superseded).not.toBe(true);
    expect(state.records.get(selectedId).metadata.invitedEmail).toBe(emailFor(role.toLowerCase(), 1));
    expect(state.supersededClaims).not.toContain(state.records.get(selectedId).metadata.claimId);
    expect([...state.attempts.values()][0].metadata.attemptStatus).toBe("CANCELLED");
    expect(state.clientSqlQueries.some((sql) =>
      sql.includes("UPDATE parents SET email") || sql.includes("UPDATE employees SET email")
    )).toBe(false);
    const original = state.records.get(selectedId);
    const originalProvider = state.providerInvitations.get(selectedId);
    const originalMarker = {
      ...originalProvider.publicMetadata,
      edupulseSchoolInvitation: {
        ...originalProvider.publicMetadata.edupulseSchoolInvitation,
        emailProof: createHmac("sha256", "test-clerk-server-key")
          .update(original.metadata.invitedEmail)
          .digest("hex"),
      },
    };
    state.activationEmail = original.metadata.invitedEmail;
    state.activationMarker = originalMarker.edupulseSchoolInvitation;
    state.getUser.mockResolvedValue({
      primaryEmailAddress: {
        emailAddress: original.metadata.invitedEmail,
        verification: { status: "verified" },
      },
      publicMetadata: originalMarker,
      firstName: "Accepted",
      lastName: role,
      phoneNumbers: [],
    });
    await expect(activateAcceptedSchoolInvitation(88, "clerk_accepted_original")).resolves.toBe(true);
    expect(state.activatedClaims).toContain(original.metadata.claimId);
  });

  it("refuses replacement after the selected Student profile is linked", async () => {
    if (role !== "STUDENT") return;
    state.linkStudentBeforeReplacement = true;
    const response = await request("/schools/12/users/invitations/middle_student/resend", "POST", {});
    expect(response.status).toBe(409);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.clientSqlQueries.some((sql) =>
      sql.includes("FROM students") && sql.includes("FOR UPDATE")
    )).toBe(true);
  });

  it("rejects unauthenticated-by-role, wrong-school, stale IDs and accepted invitations without sending", async () => {
    state.context.roles = [];
    expect((await request("/schools/12/users/invitations")).status).toBe(403);
    state.context.roles = [{ id: 2, role: "SCHOOL_ADMIN", schoolId: 13, status: "ACTIVE" }];
    expect((await request("/schools/12/users/invitations")).status).toBe(403);
    expect((await request(`/schools/13/users/invitations/middle_${role.toLowerCase()}/resend`, "POST", {})).status).toBe(404);
    state.context.roles = [{ id: 2, role: "SCHOOL_ADMIN", schoolId: 12, status: "ACTIVE" }];
    expect((await request(`/schools/12/users/invitations/stale_${role.toLowerCase()}/resend`, "POST", {})).status).toBe(404);
    const selectedId = `middle_${role.toLowerCase()}`;
    state.statuses.set(selectedId, "accepted");
    state.providerInvitations.set(selectedId, {
      ...state.providerInvitations.get(selectedId),
      status: "accepted",
    });
    const accepted = await request(`/schools/12/users/invitations/${selectedId}/resend`, "POST", {});
    expect(accepted.status).toBe(409);
    expect(state.createInvitation).not.toHaveBeenCalled();
  });

  it("rejects Platform Owners even when a School Admin role is also present", async () => {
    state.context.roles = [
      { id: 1, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" },
      { id: 2, role: "SCHOOL_ADMIN", schoolId: 12, status: "ACTIVE" },
    ];
    expect((await request("/schools/12/users/invitations")).status).toBe(403);
    expect((await request(`/schools/12/users/invitations/middle_${role.toLowerCase()}/resend`, "POST", {})).status).toBe(403);
    expect(state.createInvitation).not.toHaveBeenCalled();
  });

  it("prevents duplicate and concurrent replacement of the selected invitation", async () => {
    const selectedId = `middle_${role.toLowerCase()}`;
    let releaseDispatch!: () => void;
    let signalDispatch!: () => void;
    const dispatchStarted = new Promise<void>((resolve) => { signalDispatch = resolve; });
    const dispatchGate = new Promise<void>((resolve) => { releaseDispatch = resolve; });
    state.createInvitation.mockImplementationOnce(async () => {
      signalDispatch();
      await dispatchGate;
      return { id: "concurrent_replacement", createdAt: Date.now(), status: "pending" };
    });
    const first = request(`/schools/12/users/invitations/${selectedId}/resend`, "POST", {});
    await dispatchStarted;
    expect((await request(`/schools/12/users/invitations/${selectedId}/resend`, "POST", {})).status).toBe(409);
    releaseDispatch();
    expect((await first).status).toBe(201);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect((await request(`/schools/12/users/invitations/${selectedId}/resend`, "POST", {})).status).toBe(409);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.locks.size).toBe(0);
  });

  it("recovers a provider success with a lost SDK response and blocks resend until reconciliation", async () => {
    const selectedId = `middle_${role.toLowerCase()}`;
    const originalClaimId = state.records.get(selectedId).metadata.claimId;
    state.createInvitation.mockImplementationOnce(async (options: any) => {
      state.createdOptions = options;
      state.providerInvitations.set("lost_response_invitation", {
        id: "lost_response_invitation",
        status: "pending",
        emailAddress: options.emailAddress,
        publicMetadata: options.publicMetadata,
      });
      throw new Error("response timed out after provider acceptance");
    });

    const failedSend = await request(`/schools/12/users/invitations/${selectedId}/resend`, "POST", {});
    expect(failedSend.status).toBe(503);
    expect((await failedSend.json() as { code?: string }).code).toBe("INVITATION_RECOVERY_REQUIRED");
    expect(state.records.get(selectedId).metadata.superseded).toBe(true);
    expect(state.supersededClaims).toContain(originalClaimId);
    const attempt = [...state.attempts.values()][0];
    expect(attempt.metadata).toMatchObject({
      attemptStatus: "OUTCOME_UNKNOWN",
      selectedInvitationId: selectedId,
      sourceEvent: "USER_INVITED",
      role,
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);

    const retry = await request(`/schools/12/users/invitations/${selectedId}/resend`, "POST", {});
    expect(retry.status).toBe(409);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);

    const reconciled = await request(`/schools/12/users/invitations/${selectedId}/reconcile`, "POST", {});
    expect(reconciled.status).toBe(200);
    expect(await reconciled.json()).toMatchObject({
      status: "RECOVERED",
      invitationId: "lost_response_invitation",
      role,
      recoveryState: "COMPLETED",
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.attempts.get(attempt.id).metadata.attemptStatus).toBe("COMPLETED");
  });

  it("keeps unresolved no-match provider outcomes blocked without a compensating send", async () => {
    const selectedId = `middle_${role.toLowerCase()}`;
    state.createInvitation.mockRejectedValueOnce(new Error("provider connection timed out"));

    const failedSend = await request(`/schools/12/users/invitations/${selectedId}/resend`, "POST", {});
    expect(failedSend.status).toBe(503);
    const firstReconcile = await request(`/schools/12/users/invitations/${selectedId}/reconcile`, "POST", {});
    expect(firstReconcile.status).toBe(202);
    expect(await firstReconcile.json()).toMatchObject({
      status: "RECOVERY_REQUIRED",
      recoveryState: "OUTCOME_UNKNOWN",
      invitationId: null,
    });
    const secondReconcile = await request(`/schools/12/users/invitations/${selectedId}/reconcile`, "POST", {});
    expect(secondReconcile.status).toBe(202);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect((await request(`/schools/12/users/invitations/${selectedId}/resend`, "POST", {})).status).toBe(409);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
  });

  it("safely retries a known Clerk rejection through the same staged attempt", async () => {
    const selectedId = `middle_${role.toLowerCase()}`;
    state.createInvitation.mockImplementationOnce(async (options: any) => {
      state.providerEvents.push(`create:${options.emailAddress}`);
      throw { status: 422, errors: [{ code: "form_identifier_exists" }] };
    });

    const rejected = await request(`/schools/12/users/invitations/${selectedId}/resend`, "POST", {});
    expect(rejected.status).toBe(503);
    const rejection = await rejected.json() as { code?: string; error?: string };
    expect(rejection.code).toBe("INVITATION_PROVIDER_REJECTED");
    expect(rejection.error).toContain("HTTP 422, form_identifier_exists");
    const attempt = [...state.attempts.values()][0];
    expect(attempt.metadata.attemptStatus).toBe("DISPATCH_REJECTED");
    expect(state.records.get(selectedId).metadata.superseded).toBe(true);
    expect(state.providerEvents).toEqual([
      `revoke:${selectedId}`,
      `create:${emailFor(role.toLowerCase(), 1)}`,
    ]);

    const recoveryList = await request("/schools/12/users/invitations");
    expect((await recoveryList.json() as any).invitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        invitationId: selectedId,
        status: "RECOVERY_REQUIRED",
        recoveryState: "DISPATCH_REJECTED",
      }),
    ]));
    const recovered = await request(`/schools/12/users/invitations/${selectedId}/reconcile`, "POST", {});
    expect(recovered.status).toBe(200);
    expect((await recovered.json() as any)).toMatchObject({
      status: "PENDING",
      recoveryStatus: "COMPLETED",
      supersededInvitationId: selectedId,
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(2);
    expect(state.revokeInvitation).toHaveBeenCalledTimes(1);
    expect(state.providerEvents).toEqual([
      `revoke:${selectedId}`,
      `create:${emailFor(role.toLowerCase(), 1)}`,
      `create:${emailFor(role.toLowerCase(), 1)}`,
    ]);
    expect(state.createdOptions.publicMetadata.edupulseSchoolInvitation.replacementAttemptId)
      .toBe(attempt.metadata.attemptId);
  });

  it("allows expired invitations to be reissued but hides accepted and registered records from the list", async () => {
    const expiredId = `middle_${role.toLowerCase()}`;
    const acceptedId = `first_${role.toLowerCase()}`;
    state.statuses.set(expiredId, "expired");
    state.statuses.set(acceptedId, "accepted");
    state.providerInvitations.set(expiredId, {
      ...state.providerInvitations.get(expiredId),
      status: "expired",
    });
    state.providerInvitations.set(acceptedId, {
      ...state.providerInvitations.get(acceptedId),
      status: "accepted",
    });
    const registeredId = `last_${role.toLowerCase()}`;
    state.registeredMemberships.add(`${emailFor(role.toLowerCase(), 2)}:${role}`);
    const list = await request("/schools/12/users/invitations");
    expect(list.status).toBe(200);
    const listed = await list.json() as any;
    expect(listed.schoolId).toBe(12);
    expect(listed.invitations).toEqual(expect.arrayContaining([expect.objectContaining({
      invitationId: expiredId,
      role,
      status: "EXPIRED",
      email: emailFor(role.toLowerCase(), 1),
    })]));
    expect(listed.invitations.some((item: any) => item.invitationId === acceptedId)).toBe(false);
    expect(listed.invitations.some((item: any) => item.invitationId === registeredId)).toBe(false);
    const response = await request(`/schools/12/users/invitations/${expiredId}/resend`, "POST", {});
    expect(response.status).toBe(201);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
  });

  it("updates only the selected invitation email and allows its replacement to be resent", async () => {
    const selectedId = `middle_${role.toLowerCase()}`;
    const replacementEmail = `updated-${role.toLowerCase()}@school.test`;
    const updated = await request(`/schools/12/users/invitations/${selectedId}`, "PATCH", { email: replacementEmail });
    expect(updated.status).toBe(201);
    const updatedResult = await updated.json();
    expect(updatedResult).toMatchObject({ invitationId: "replacement_1", email: replacementEmail, role });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.createInvitation.mock.calls[0][0].emailAddress).toBe(replacementEmail);
    expect(state.statuses.get(`first_${role.toLowerCase()}`)).toBe("pending");
    expect(state.statuses.get(`last_${role.toLowerCase()}`)).toBe("pending");

    const resent = await request("/schools/12/users/invitations/replacement_1/resend", "POST", {});
    expect(resent.status, await resent.clone().text()).toBe(201);
    expect(await resent.json()).toMatchObject({ email: replacementEmail, role });
    expect(state.createInvitation).toHaveBeenCalledTimes(2);
    expect(state.createInvitation.mock.calls[1][0].emailAddress).toBe(replacementEmail);
  });
});

it("forwards unexpected database exceptions instead of leaving the HTTP request hanging", async () => {
  state.query.mockRejectedValueOnce(Object.assign(new Error("could not determine data type of parameter $1"), { code: "42P18" }));
  const response = await fetch(`${baseUrl}/schools/12/users/invitations`, {
    signal: AbortSignal.timeout(1500),
  });
  expect(response.status).toBe(500);
  expect((await response.json() as { error: string }).error).toContain("could not determine data type");
});

describe("durable replacement transaction recovery", () => {
  it("continues after an ambiguous COMMIT only when the prepared attempt is visible", async () => {
    state.commitMode = "committed-then-error";
    const committed = await request("/schools/12/users/invitations/middle_teacher/resend", "POST", {});
    expect(committed.status).toBe(201);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect([...state.attempts.values()][0].metadata.attemptStatus).toBe("COMPLETED");

    seedThree("TEACHER");
    state.createInvitation.mockClear();
    state.commitMode = "rolled-back-then-error";
    const uncommitted = await request("/schools/12/users/invitations/middle_teacher/resend", "POST", {});
    expect(uncommitted.status).toBe(503);
    expect((await uncommitted.json() as { code?: string }).code).toBe("INVITATION_RECOVERY_REQUIRED");
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.attempts.size).toBe(0);
  });
});