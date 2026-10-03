import type { Request } from "express";
import { pool } from "@workspace/db";
import { AuthError, type UserContext } from "../middlewares/auth";
import { assertSubscriptionAccess } from "./subscription-enforcement";
import { familyChildSchoolScope } from "../lib/family-child-school-scope";

/**
 * Supplement existing authorization, never replace it. Family identity is
 * resolved through an active relation BEFORE returning a restriction result.
 * Login, account, payment, inbox and preference endpoints remain available.
 */
export async function enforceRequestSubscription(req: Request, context: UserContext) {
  try {
    await enforceResolvedSubscription(req, context);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    req.log?.error({ errorName: error instanceof Error ? error.name : "Unknown" }, "Subscription scope could not be resolved; access deferred");
    // An uncertain tenant lookup cannot be used to bypass a manual school lock.
    throw new AuthError(503, "Subscription access is temporarily unavailable. Please try again.", "SUBSCRIPTION_STATUS_UNAVAILABLE");
  }
}

async function enforceResolvedSubscription(req: Request, context: UserContext) {
  const path = req.originalUrl.split("?")[0].replace(/^\/api/, "");
  const roles = context.roles.filter(role => role.status === "ACTIVE");
  if (roles.some(role => role.role === "PLATFORM_OWNER")) return;
  const protectedFamilyPath = /\/(?:attendance|assignments|results|report-cards|curriculum|timetable)(?:\/|$)/.test(path);
  const communicationWrite = req.method === "POST" && /^\/communication\/(?:parent\/threads|threads)/.test(path);
  let familyAccessChecked = false;
  if (protectedFamilyPath || communicationWrite) {
    let studentId = Number(path.match(/\/(?:children|child|student\/attendance)\/(\d+)/)?.[1]
      ?? req.body?.studentId ?? req.query.studentId);
    if (communicationWrite && /\/threads\/\d+/.test(path)) {
      const threadId = Number(path.match(/\/threads\/(\d+)/)?.[1]);
      // Only the owning parent is checked here; staff authorization stays in its existing handler.
      const thread = await pool.query(
        "SELECT student_id FROM communication_message_threads WHERE id=$1 AND parent_user_id=$2", [threadId, context.user.id],
      );
      studentId = Number(thread.rows[0]?.student_id);
    }
    if (roles.some(role => role.role === "PARENT") && Number.isSafeInteger(studentId) && studentId > 0) {
      const relation = await pool.query(
        `SELECT st.school_id FROM parents p JOIN parent_student_relationships rel ON rel.parent_id=p.id AND rel.status='ACTIVE'
          JOIN students st ON st.id=rel.student_id AND LOWER(st.status)='active'
         WHERE p.user_id=$1 AND p.status='ACTIVE' AND st.id=$2 AND ${familyChildSchoolScope()}`, [context.user.id, studentId],
      );
      if (relation.rows[0]) {
        await assertSubscriptionAccess(Number(relation.rows[0].school_id), studentId);
        familyAccessChecked = true;
      }
    }
    if (roles.some(role => role.role === "STUDENT")) {
      // Self-service handlers resolve the student from the signed-in identity.
      // A caller-supplied, ignored studentId must not bypass that restriction.
      const selfService = /^\/(?:academic\/(?:me|students?\/me)|me|student)(?:\/|$)/.test(path);
      const profile = await pool.query(
        "SELECT id,school_id FROM students WHERE user_id=$1 AND LOWER(status)='active'", [context.user.id],
      );
      for (const student of profile.rows) {
        if (selfService || !Number.isSafeInteger(studentId) || studentId === Number(student.id)) {
          await assertSubscriptionAccess(Number(student.school_id), Number(student.id));
        }
      }
    }
  }
  const teacherOperation = communicationWrite || /\/(?:attendance|lesson-notes|curriculum|academic|timetable)(?:\/|$)/.test(path);
  // Keep historical lesson notes readable, but stop new drafts, edits, and submissions.
  const historicalLessonRead = req.method === "GET" && path.includes("/lesson-notes");
  const familyRoute = /\/(?:parent|parents|children|child)(?:\/|$)/.test(path);
  const studentSelf = roles.some(role => role.role === "STUDENT") && /^\/(?:student|academic\/(?:me|students?\/me))(?:\/|$)/.test(path);
  const paymentCalendarRead = req.method === "GET" && /\/academic\/(?:(?:sessions|terms)(?:\/\d+)?|context|calendar)$/.test(path);
  if (teacherOperation && !historicalLessonRead && !familyRoute && !familyAccessChecked && !studentSelf && !paymentCalendarRead) {
    let schoolId = Number(path.match(/^\/schools\/(\d+)/)?.[1] ?? req.query.schoolId ?? req.body?.schoolId);
    const teacherSchools = roles.filter(role => ["TEACHER", "SCHOOL_ADMIN", "ACCOUNTANT"].includes(role.role) && role.schoolId !== null);
    if (communicationWrite && /\/threads\/\d+/.test(path) && teacherSchools.length) {
      const thread = await pool.query("SELECT school_id FROM communication_message_threads WHERE id=$1 AND school_id=ANY($2::integer[])",
        [Number(path.match(/\/threads\/(\d+)/)?.[1]), teacherSchools.map(role => role.schoolId)]);
      if (thread.rows[0]) schoolId = Number(thread.rows[0].school_id);
    }
    for (const role of teacherSchools) {
      if (schoolId === role.schoolId || teacherSchools.length === 1 || !teacherSchools.some(r => r.schoolId === schoolId)) {
        await assertSubscriptionAccess(role.schoolId!);
      }
    }
  }
}