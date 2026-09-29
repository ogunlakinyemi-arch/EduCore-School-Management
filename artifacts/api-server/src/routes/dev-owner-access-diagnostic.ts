import { getAuth } from "@clerk/express";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

type MembershipRow = {
  internalUserId: number;
  accountStatus: string;
  role: string | null;
  schoolId: number | null;
  membershipStatus: string | null;
};

const router: IRouter = Router();

router.get("/dev/my-owner-access", async (req, res): Promise<void> => {
  // This route is never registered in a production process; keep a second guard
  // so accidental direct mounting cannot make it available there either.
  if (process.env.NODE_ENV !== "development") {
    res.sendStatus(404);
    return;
  }

  res.set("Cache-Control", "no-store");
  const clerkUserId = getAuth(req).userId;
  if (!clerkUserId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    // Deliberately do not call requireAuthentication or authorized-context:
    // both can write when an identity or an accepted invitation is new.
    const result = await pool.query<MembershipRow>(
      `SELECT u.id AS "internalUserId", u.status AS "accountStatus",
              m.role, m.school_id AS "schoolId", m.status AS "membershipStatus"
       FROM app_users u
       LEFT JOIN school_memberships m ON m.user_id = u.id
       WHERE u.clerk_user_id = $1`,
      [clerkUserId],
    );
    const user = result.rows[0];
    const activeMemberships = result.rows
      .filter(row => row.role !== null && row.membershipStatus === "ACTIVE")
      .map(row => ({
        role: row.role,
        schoolId: row.schoolId,
        global: row.schoolId === null,
      }));
    const isPlatformOwner = activeMemberships.some(
      membership => membership.role === "PLATFORM_OWNER" && membership.global,
    );

    res.json({
      clerkUserIdMasked: `${clerkUserId.slice(0, 4)}…${clerkUserId.slice(-4)}`,
      internalUserExists: Boolean(user),
      internalUserId: user?.internalUserId ?? null,
      accountStatus: user?.accountStatus ?? null,
      activeMembershipCount: activeMemberships.length,
      activeMemberships,
      hasPlatformOwner: isPlatformOwner,
      authorizationLookup: !user
        ? { outcome: "user_not_present", note: "Normal authentication would provision this user; not attempted." }
        : user.accountStatus !== "ACTIVE"
          ? { outcome: "inactive_account", expectedStatus: 403 }
          : { outcome: "success", expectedStatus: 200, isPlatformOwner, roles: activeMemberships },
      authorizedContextRequestExecuted: false,
    });
  } catch {
    res.status(503).json({ error: "Read-only authorization lookup failed" });
  }
});

export default router;