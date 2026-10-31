import { Router } from "express";
import { pool } from "@workspace/db";
import { assertRoles, getUserContext, requireAuthentication, AuthError } from "../middlewares/auth";
import { assertTestArchiveAccess } from "../services/test-account-archive-access";

/** Explicit DTO: never serialize financial evidence, rules, reviews or payment amounts. */
export function ownEntitlementView(rows: Record<string, any>[]) {
  const items = rows.map(row => ({
    id: Number(row.id), studentId: Number(row.studentId), termId: Number(row.termId),
    amountMinor: Number(row.amountMinor), currency: String(row.currency),
    status: String(row.status), earnedAt: new Date(row.earnedAt).toISOString(),
  }));
  return { items, earnedMinor: items.reduce((sum, item) => sum + item.amountMinor, 0), currency: "NGN" };
}
const router = Router();
router.get("/partner/commission-entitlements", requireAuthentication(), async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    assertRoles(req, ["PARTNER"]);
    const context = getUserContext(req);
    if (context.user.status !== "ACTIVE" || !context.roles.some(r => r.role === "PARTNER" && r.status === "ACTIVE"))
      throw new AuthError(404, "Resource not found");
    // No caller-selected partner/school/student IDs, and no delegated staff reads.
    if (Object.keys(req.query).length) throw new AuthError(400, "This view accepts no scope parameters");
    const profile = (await pool.query(`SELECT id FROM partner_profiles
      WHERE user_id=$1 AND status='ACTIVE' ORDER BY id LIMIT 1`, [context.user.id])).rows[0];
    if (!profile) throw new AuthError(404, "Resource not found");
    await assertTestArchiveAccess({ partnerId: Number(profile.id) });
    const result = await pool.query(`SELECT id,student_id AS "studentId",academic_term_id AS "termId",
      amount_minor AS "amountMinor",currency,status,earned_at AS "earnedAt"
      FROM bro_term_commission_entitlements WHERE partner_profile_id=$1 ORDER BY earned_at DESC,id DESC`,
      [profile.id]);
    res.locals.ownBroEntitlements = true;
    res.json(ownEntitlementView(result.rows));
  } catch (error) {
    const status = error instanceof AuthError ? error.statusCode : 503;
    res.status(status).json({ error: error instanceof AuthError ? error.message : "Commission entitlements could not be confirmed" });
  }
});
export default router;
