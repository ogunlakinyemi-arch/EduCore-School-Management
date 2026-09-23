import crypto from "node:crypto";
import { clerkClient } from "@clerk/express";
import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";

const router = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const run = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => handler(req, res).catch(next);

async function ownerExists(
  db: { query: (text: string, values?: unknown[]) => Promise<any> } = pool,
) {
  const result = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM school_memberships
       WHERE school_id IS NULL AND role = 'PLATFORM_OWNER'
     ) AS exists`,
  );
  return Boolean(result.rows[0]?.exists);
}

function sameOrigin(req: Request) {
  const origin = req.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
}

function consumeAttempt(req: Request) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  if (current.count >= MAX_ATTEMPTS) {
    throw new AuthError(403, "Too many setup attempts. Try again later.", "BOOTSTRAP_RATE_LIMITED");
  }
  current.count += 1;
}

function secureMatch(provided: string, expected: string) {
  const actualHash = crypto.createHash("sha256").update(provided).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

function parseName(value: unknown) {
  const fullName = String(value ?? "").trim().replace(/\s+/g, " ");
  if (fullName.length < 2 || fullName.length > 120) {
    throw new AuthError(400, "A valid owner name is required");
  }
  const [firstName, ...rest] = fullName.split(" ");
  return { fullName, firstName, lastName: rest.join(" ") || undefined };
}

async function createOrRecoverBootstrapUser(input: {
  email: string;
  password: string;
  firstName: string;
  lastName?: string;
}) {
  const marker = "platform-owner-bootstrap";
  try {
    return await clerkClient.users.createUser({
      emailAddress: [input.email],
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      privateMetadata: { edupulseProvisioning: marker },
    });
  } catch (createError) {
    const users = await clerkClient.users.getUserList({ emailAddress: [input.email], limit: 10 });
    const orphan = users.data.find(
      (user) => user.privateMetadata?.edupulseProvisioning === marker,
    );
    if (!orphan) throw createError;
    return clerkClient.users.updateUser(orphan.id, {
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      signOutOfOtherSessions: true,
    });
  }
}

router.get("/bootstrap/platform-owner/status", run(async (_req, res) => {
  const exists = await ownerExists();
  res.json({
    available: !exists,
    configured: Boolean(process.env.EDUPULSE_SETUP_KEY),
  });
}));

router.post("/bootstrap/platform-owner", run(async (req, res) => {
  if (!sameOrigin(req)) throw new AuthError(403, "Cross-origin setup requests are not allowed");
  consumeAttempt(req);

  const setupKey = String(req.body?.setupKey ?? "");
  const expectedSetupKey = process.env.EDUPULSE_SETUP_KEY;
  if (!expectedSetupKey || !setupKey || !secureMatch(setupKey, expectedSetupKey)) {
    throw new AuthError(403, "Invalid setup key", "BOOTSTRAP_KEY_REJECTED");
  }

  const { fullName, firstName, lastName } = parseName(req.body?.fullName);
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const phone = String(req.body?.phone ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new AuthError(400, "A valid email address is required");
  }
  if (!/^\+?[0-9][0-9\s()-]{7,24}$/.test(phone)) {
    throw new AuthError(400, "A valid phone number is required");
  }
  if (
    password.length < 12 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new AuthError(
      400,
      "Password must be at least 12 characters and include uppercase, lowercase, number, and symbol",
    );
  }

  const client = await pool.connect();
  let clerkUserId: string | null = null;
  let committed = false;
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('edupulse:first-platform-owner'))");
    if (await ownerExists(client)) {
      throw new AuthError(409, "Platform Owner setup has already been completed", "BOOTSTRAP_ALREADY_COMPLETED");
    }
    const duplicate = await client.query("SELECT id FROM app_users WHERE lower(email)=lower($1)", [email]);
    if (duplicate.rows[0]) {
      throw new AuthError(409, "An account with this email already exists");
    }

    const clerkUser = await createOrRecoverBootstrapUser({
      email,
      password,
      firstName,
      lastName,
    });
    clerkUserId = clerkUser.id;

    const user = await client.query(
      `INSERT INTO app_users(clerk_user_id,email,first_name,last_name,phone,status)
       VALUES($1,$2,$3,$4,$5,'ACTIVE') RETURNING id`,
      [clerkUser.id, email, firstName, lastName ?? null, phone],
    );
    const membership = await client.query(
      `INSERT INTO school_memberships(user_id,school_id,role,status)
       VALUES($1,NULL,'PLATFORM_OWNER','ACTIVE') RETURNING id`,
      [user.rows[0].id],
    );
    await client.query(
      `INSERT INTO audit_logs
        ("user",role,actor_user_id,clerk_user_id,action,module,record_id,severity,event_type,result,metadata)
       VALUES($1,'PLATFORM_OWNER',$2,$3,'Created initial Platform Owner','Security',$4,
              'critical','PLATFORM_OWNER_BOOTSTRAPPED','SUCCESS',jsonb_build_object('email',$5::text))`,
      [fullName, user.rows[0].id, clerkUser.id, membership.rows[0].id, email],
    );
    commitAttempted = true;
    await client.query("COMMIT");
    committed = true;
    attempts.clear();
    res.status(201).json({ created: true, signInPath: "/sign-in" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (commitAttempted && clerkUserId) {
      const persisted = await pool.query(
        `SELECT EXISTS (
           SELECT 1 FROM app_users u
           JOIN school_memberships sm ON sm.user_id=u.id
           WHERE u.clerk_user_id=$1 AND sm.school_id IS NULL AND sm.role='PLATFORM_OWNER'
         ) AS exists`,
        [clerkUserId],
      );
      if (persisted.rows[0]?.exists) {
        committed = true;
        attempts.clear();
        res.status(201).json({ created: true, signInPath: "/sign-in" });
        return;
      }
    }
    if (clerkUserId && !committed) {
      try {
        await clerkClient.users.deleteUser(clerkUserId);
      } catch (cleanupError) {
        console.error("Clerk bootstrap compensation failed", {
          clerkUserId,
          error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error",
        });
        throw new AuthError(
          503,
          "Owner provisioning did not complete. Retry setup with the same email to recover.",
          "BOOTSTRAP_RECOVERY_REQUIRED",
        );
      }
    }
    throw error;
  } finally {
    client.release();
  }
}));

export default router;