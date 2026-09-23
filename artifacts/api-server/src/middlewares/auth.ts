import { clerkClient, getAuth } from "@clerk/express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { pool } from "@workspace/db";

export const ROLES = [
  "PLATFORM_OWNER",
  "SCHOOL_ADMIN",
  "TEACHER",
  "ACCOUNTANT",
  "PARENT",
  "STUDENT",
  "STAFF",
  "PARTNER",
] as const;

export type Role = (typeof ROLES)[number];
export type UserStatus = "ACTIVE" | "INACTIVE";

export type UserContext = {
  user: {
    id: number;
    clerkUserId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    status: UserStatus;
  };
  roles: Array<{
    id: number;
    role: Role;
    schoolId: number | null;
    status: UserStatus;
  }>;
};

export class AuthError extends Error {
  constructor(
    public readonly statusCode: 400 | 401 | 403 | 404 | 409 | 503,
    message: string,
    public readonly eventType = "ACCESS_DENIED",
  ) {
    super(message);
  }
}

function requestContext(req: Request) {
  return (req as Request & { edupulseUser?: UserContext }).edupulseUser;
}

export function getUserContext(req: Request): UserContext {
  const context = requestContext(req);
  if (!context) throw new AuthError(401, "Authentication required");
  return context;
}

export async function provisionCurrentUser(clerkUserId: string) {
  const existing = await pool.query(
    `SELECT id, clerk_user_id AS "clerkUserId", email, first_name AS "firstName",
       last_name AS "lastName", phone, status
     FROM app_users WHERE clerk_user_id = $1`,
    [clerkUserId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) {
    throw new AuthError(403, "An email address is required to access EduPulse");
  }

  const result = await pool.query(
    `INSERT INTO app_users (clerk_user_id, email, first_name, last_name, phone)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       email = EXCLUDED.email,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       phone = EXCLUDED.phone,
       updated_at = NOW()
     RETURNING id, clerk_user_id AS "clerkUserId", email, first_name AS "firstName",
       last_name AS "lastName", phone, status`,
    [
      clerkUserId,
      email,
      clerkUser.firstName ?? null,
      clerkUser.lastName ?? null,
      clerkUser.phoneNumbers[0]?.phoneNumber ?? null,
    ],
  );
  return result.rows[0];
}

export async function loadUserContext(clerkUserId: string): Promise<UserContext> {
  const user = await provisionCurrentUser(clerkUserId);
  assertUserActive(user.status);
  const roles = await pool.query(
    `SELECT id, role, school_id AS "schoolId", status
     FROM school_memberships
     WHERE user_id = $1 AND status = 'ACTIVE'`,
    [user.id],
  );

  return { user, roles: roles.rows };
}

export function assertUserActive(status: string) {
  if (status !== "ACTIVE") {
    throw new AuthError(403, "This EduPulse account is inactive");
  }
}

function respondAuthError(res: Response, error: unknown) {
  if (error instanceof AuthError) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.eventType,
    });
  }
  return res.status(401).json({ error: "Authentication unavailable" });
}

export function requireAuthentication(): RequestHandler {
  return (req, res, next) => {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    loadUserContext(userId)
      .then((context) => {
        (req as Request & { edupulseUser?: UserContext }).edupulseUser = context;
        next();
      })
      .catch((error) => respondAuthError(res, error));
  };
}

export function hasRole(context: UserContext, role: Role, schoolId?: number) {
  return context.roles.some(
    (assignment) =>
      assignment.role === role &&
      (assignment.schoolId === null || assignment.schoolId === schoolId),
  );
}

export function isPlatformOwner(context: UserContext) {
  return hasRole(context, "PLATFORM_OWNER");
}

export function assertRoles(req: Request, roles: Role[]) {
  const context = getUserContext(req);
  if (!roles.some((role) => hasRole(context, role))) {
    throw new AuthError(403, "You are not authorized for this action");
  }
  return context;
}

export function assertSchoolAccess(
  req: Request,
  schoolId: number,
  roles: Role[] = [...ROLES],
) {
  const context = getUserContext(req);
  if (isPlatformOwner(context)) return context;

  const allowed = context.roles.some(
    (assignment) =>
      assignment.schoolId === schoolId &&
      roles.includes(assignment.role),
  );
  if (!allowed) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
  return context;
}

export function assertResourceId(value: unknown, label: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw new AuthError(404, `${label} not found`);
  }
  return id;
}

export function handleAuthError(
  error: unknown,
  req: Request,
  res: Response,
  next?: NextFunction,
) {
  if (error instanceof AuthError) {
    const context = requestContext(req);
    const schoolId =
      typeof req.query.schoolId === "string"
        ? Number(req.query.schoolId)
        : null;
    pool
      .query(
        `INSERT INTO audit_logs
          ("user", role, actor_user_id, clerk_user_id, school_id, action, module,
           severity, event_type, result, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'critical', $8, 'DENIED', $9)`,
        [
          context
            ? [context.user.firstName, context.user.lastName]
                .filter(Boolean)
                .join(" ") || context.user.email
            : "Unauthenticated request",
          context?.roles[0]?.role ?? "UNAUTHENTICATED",
          context?.user.id ?? null,
          context?.user.clerkUserId ?? null,
          Number.isInteger(schoolId) ? schoolId : null,
          error.message,
          "Security",
          error.eventType,
          JSON.stringify({ method: req.method, path: req.path }),
        ],
      )
      .catch(() => undefined);
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.eventType,
    });
  }
  return next?.(error);
}
