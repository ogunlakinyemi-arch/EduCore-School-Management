import { Router } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { AuthError, getUserContext, assertSchoolAccess, requireAuthentication } from "../middlewares/auth";
const router = Router();
router.use(requireAuthentication());
const category = z.enum(["ATTENDANCE","ACADEMIC","ASSIGNMENT","FINANCE","PAYMENT","ANNOUNCEMENT","ACCOUNT","SYSTEM","SUBSCRIPTION","PARTNER","SECURITY"]);
export const channelDefaultsSchema = z.record(category, z.array(z.enum(["IN_APP","PUSH","SMS","EMAIL"])).max(4));
function access(req: Parameters<typeof getUserContext>[0], id: number, write: boolean) {
  if (!Number.isSafeInteger(id) || id < 1) throw new AuthError(400, "Invalid school");
  const ctx = assertSchoolAccess(req, id, ["SCHOOL_ADMIN"]);
  const owner = ctx.roles.some(r => r.role === "PLATFORM_OWNER");
  if (write && owner) throw new AuthError(403, "Owner access is read-only");
  return !owner;
}
router.get("/communication/schools/:schoolId/defaults", async (req, res) => {
  try {
    const id = Number(req.params.schoolId); const canWrite = access(req, id, false);
    const result = await pool.query(`SELECT communication_defaults AS defaults FROM schools WHERE id=$1`, [id]);
    if (!result.rows[0]) throw new AuthError(404, "School not found");
    res.json({ defaults: result.rows[0].defaults, canWrite });
  } catch (e) { res.status(e instanceof AuthError ? e.statusCode : 500).json({ error: "Could not read school communication defaults" }); }
});
router.put("/communication/schools/:schoolId/defaults", async (req, res) => {
  const c = await pool.connect();
  try {
    const id = Number(req.params.schoolId); access(req, id, true);
    const defaults = channelDefaultsSchema.parse(req.body);
    await c.query("BEGIN");
    await c.query(`UPDATE schools SET communication_defaults=$2::jsonb WHERE id=$1`, [id, JSON.stringify(defaults)]);
    const actor = getUserContext(req);
    await c.query(`INSERT INTO audit_logs(school_id,actor_user_id,"user",role,action,module)
      VALUES($1,$2,$3,'SCHOOL_ADMIN','Updated category notification channel defaults','Communications')`,
      [id, actor.user.id, actor.user.email]);
    await c.query("COMMIT"); res.json({ defaults, canWrite: true });
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    res.status(e instanceof AuthError ? e.statusCode : e instanceof z.ZodError ? 400 : 500).json({ error: "Could not update school communication defaults" });
  } finally { c.release(); }
});
export default router;