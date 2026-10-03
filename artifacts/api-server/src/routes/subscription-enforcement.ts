import { Router } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { AuthError, assertSchoolOperationalAccess, getUserContext, isPlatformOwner, requireAuthentication } from "../middlewares/auth";
import { readSchoolSubscription, readSchoolEnforcementSummary } from "../services/subscription-enforcement";
import { readManualSchoolState, changeManualSchoolLock } from "../services/school-subscription-lock";
import { familyChildSchoolScope } from "../lib/family-child-school-scope";

const router = Router();
router.use("/subscription-enforcement", requireAuthentication());
const positive = z.coerce.number().int().positive();

router.get("/subscription-enforcement", async (req, res, next) => {
  try {
    const context = getUserContext(req);
    const schoolId = req.query.schoolId === undefined ? undefined : positive.parse(req.query.schoolId);
    if (!isPlatformOwner(context)) {
      if (schoolId === undefined) throw new AuthError(400, "Select a school");
      assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
    }
    const schools = await pool.query<{ id: number; name: string }>(
      "SELECT id,name FROM schools WHERE ($1::integer IS NULL OR id=$1) AND LOWER(status)='active' ORDER BY id", [schoolId ?? null],
    );
    const result = [];
    for (const school of schools.rows) {
      result.push(await readSchoolEnforcementSummary(pool, school.id));
    }
    res.json(result);
  } catch (error) { next(error); }
});

router.get("/subscription-enforcement/me", async (req, res, next) => {
  try {
    const context = getUserContext(req);
    const profiles = await pool.query<{ schoolId: number; studentId: number | null }>(
      `SELECT DISTINCT st.school_id AS "schoolId",st.id AS "studentId" FROM students st
        WHERE st.user_id=$1 AND LOWER(st.status)='active'
       UNION SELECT st.school_id,st.id FROM parents p
         JOIN parent_student_relationships rel ON rel.parent_id=p.id AND rel.status='ACTIVE'
         JOIN students st ON st.id=rel.student_id AND LOWER(st.status)='active'
        WHERE p.user_id=$1 AND p.status='ACTIVE' AND ${familyChildSchoolScope()}
       UNION SELECT r.school_id,NULL::integer FROM school_memberships r
        WHERE r.user_id=$1 AND r.role='TEACHER' AND r.status='ACTIVE' AND r.school_id IS NOT NULL`, [context.user.id],
    );
    const result = [];
    const summaries = new Map<number, Awaited<ReturnType<typeof readSchoolSubscription>>>();
    for (const profile of profiles.rows) {
      if (!summaries.has(profile.schoolId)) summaries.set(profile.schoolId, await readSchoolSubscription(pool, profile.schoolId));
      const snapshot = summaries.get(profile.schoolId);
      const manual = await readManualSchoolState(pool, profile.schoolId);
      const automatic = !!snapshot && profile.studentId != null && snapshot.restrictedStudentIds.includes(profile.studentId);
      result.push({
        schoolId: profile.schoolId, studentId: profile.studentId,
        schoolName: snapshot?.schoolName ?? "", termName: snapshot?.termName ?? null,
        startDate: snapshot?.startDate ?? null, enforcementDate: snapshot?.enforcementDate ?? null,
        state: manual.schoolLocked ? "SCHOOL_SUBSCRIPTION_LOCKED" : snapshot?.state ?? "UNAVAILABLE",
        restricted: manual.schoolLocked || automatic,
        restrictionReason: manual.schoolLocked ? "SCHOOL_SUBSCRIPTION_LOCKED" : automatic ? "SUBSCRIPTION_RESTRICTED" : null,
      });
    }
    // No financial totals or other children's identities are exposed.
    res.json(result);
  } catch (error) { next(error); }
});

const confirmedSelection = z.object({
  confirmed: z.literal(true),
  reason: z.string().trim().max(500).optional(),
  schools: z.array(z.object({ schoolId: positive, expectedVersion: z.number().int().nonnegative() }).strict()).min(1).max(50),
}).strict();
for (const action of ["lock", "unlock"] as const) router.post(`/subscription-enforcement/${action}`, async (req, res, next) => {
  try {
    const context = getUserContext(req);
    if (!isPlatformOwner(context)) throw new AuthError(403, "Platform Owner permission required");
    const body = confirmedSelection.parse(req.body);
    if (new Set(body.schools.map(school => school.schoolId)).size !== body.schools.length) {
      throw new AuthError(400, "Select each school only once");
    }
    // Payment/grace/calendar do not control explicit school lock or unlock.
    // Validate EVERY selection before mutating ANY school.
    for (const selected of body.schools) {
      const school = await pool.query("SELECT id FROM schools WHERE id=$1 AND LOWER(status)='active'", [selected.schoolId]);
      const manual = await readManualSchoolState(pool, selected.schoolId);
      if (!school.rows[0] || manual.manualVersion !== selected.expectedVersion) {
        throw new AuthError(409, "A selected school or lock state changed. Refresh your selection.");
      }
    }
    const result = [];
    for (const selected of body.schools) {
      try {
        result.push(await changeManualSchoolLock(selected.schoolId, action === "lock", context.user,
          selected.expectedVersion, body.reason, String(req.id ?? "").slice(0, 200) || undefined));
      } catch (error) {
        req.log?.error({ schoolId: selected.schoolId, action }, "Owner school control rolled back for this school");
        result.push({ schoolId: selected.schoolId, changed: false, state: "FAILED",
          error: error instanceof AuthError ? error.message : "The outcome could not be confirmed. Refresh school status before retrying." });
      }
    }
    res.json(result);
  } catch (error) { next(error); }
});

router.get("/subscription-enforcement/audit", async (req, res, next) => {
  try {
    const schoolId = positive.parse(req.query.schoolId);
    if (!isPlatformOwner(getUserContext(req))) assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
    const result = await pool.query(
      `SELECT id,school_id AS "schoolId",event_type AS action,timestamp::text,
        actor_user_id AS "actorUserId",metadata->>'previousState' AS "previousState",
        metadata->>'newState' AS "newState",metadata->>'reason' AS reason,
        metadata->>'requestId' AS "requestId",(metadata->>'studentId')::integer AS "studentId"
       FROM audit_logs WHERE school_id=$1
         AND event_type IN ('SCHOOL_LOCKED','SCHOOL_UNLOCKED','STUDENT_SUBSCRIPTION_ACCESS_CHANGED','SUBSCRIPTION_ENFORCEMENT')
       ORDER BY timestamp DESC,id DESC LIMIT 50`, [schoolId],
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});
export default router;