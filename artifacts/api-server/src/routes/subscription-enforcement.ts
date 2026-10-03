import { Router } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { AuthError, assertSchoolOperationalAccess, getUserContext, isPlatformOwner, requireAuthentication } from "../middlewares/auth";
import { readSchoolSubscription, reconcileSchoolSubscription } from "../services/subscription-enforcement";
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
      const snapshot = await readSchoolSubscription(pool, school.id);
      // Internal student IDs are never included in aggregate overview responses.
      if (snapshot) {
        const { restrictedStudentIds: _ids, today: _today, ...summary } = snapshot;
        result.push(summary);
      } else result.push({ schoolId: school.id, schoolName: school.name, state: "UNAVAILABLE", status: "UNAVAILABLE" });
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
      result.push({
        schoolId: profile.schoolId, studentId: profile.studentId,
        schoolName: snapshot?.schoolName ?? "", termName: snapshot?.termName ?? null,
        startDate: snapshot?.startDate ?? null, enforcementDate: snapshot?.enforcementDate ?? null,
        state: snapshot?.state ?? "UNAVAILABLE",
        restricted: snapshot ? profile.studentId == null ? snapshot.schoolLocked
          : snapshot.restrictedStudentIds.includes(profile.studentId) : false,
      });
    }
    // No financial totals or other children's identities are exposed.
    res.json(result);
  } catch (error) { next(error); }
});

const confirmedSelection = z.object({
  confirmed: z.literal(true),
  schools: z.array(z.object({ schoolId: positive, termId: positive })).min(1).max(50),
}).strict();
router.post("/subscription-enforcement/lock", async (req, res, next) => {
  try {
    const context = getUserContext(req);
    if (!isPlatformOwner(context)) throw new AuthError(403, "Platform Owner permission required");
    const body = confirmedSelection.parse(req.body);
    if (new Set(body.schools.map(school => school.schoolId)).size !== body.schools.length) {
      throw new AuthError(400, "Select each school only once");
    }
    // Validate EVERY selected school and term before mutating ANY school.
    for (const selected of body.schools) {
      const snapshot = await readSchoolSubscription(pool, selected.schoolId);
      if (!snapshot || snapshot.termId !== selected.termId) {
        throw new AuthError(409, "A selected school or term is unavailable. Refresh your selection.");
      }
    }
    const result = [];
    for (const selected of body.schools) {
      try {
        result.push(await reconcileSchoolSubscription(selected.schoolId, "OWNER_MANUAL_LOCK", context.user, selected.termId));
      } catch {
        req.log?.error({ schoolId: selected.schoolId }, "Owner subscription enforcement rolled back for this school");
        result.push({ schoolId: selected.schoolId, changed: false, state: "FAILED", summary: null });
      }
    }
    res.json(result);
  } catch (error) { next(error); }
});
export default router;