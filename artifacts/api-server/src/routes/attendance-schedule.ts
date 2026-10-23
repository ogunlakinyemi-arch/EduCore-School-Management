import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { AuthError, assertSchoolAccess, assertSchoolOperationalAccess,
  getUserContext, requireAuthentication } from "../middlewares/auth";
import { ATTENDANCE_SCHEDULE_ACTION, attendanceScheduleSchema,
  attendanceRulePrecedence, readAttendanceSchedule } from "../services/attendance-schedule";
import { assessAttendanceDay, type AttendanceReviewNotice } from "../services/attendance-assessment";

const updateSchema = z.object({
  revision: z.number().int().nonnegative(), schedule: attendanceScheduleSchema,
  reason: z.string().trim().min(3).max(500),
}).strict();
const run = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
function school(req: Request) {
  const id = Number(req.query.schoolId);
  if (!Number.isSafeInteger(id) || id < 1) throw new AuthError(400, "A valid schoolId is required");
  return id;
}
export function createAttendanceScheduleRouter(notify: AttendanceReviewNotice) {
  const router = Router();
  router.use(["/school/attendance/schedule", "/school/attendance/assess"], requireAuthentication());
  router.get("/school/attendance/schedule", run(async (req, res) => {
    const id = school(req);
    const context=assertSchoolAccess(req, id, ["SCHOOL_ADMIN", "STAFF"]);
    const activeReader=context.roles.some(role=>role.status==="ACTIVE" && (
      (role.schoolId===id && ["SCHOOL_ADMIN","STAFF"].includes(role.role)) ||
      (role.schoolId===null && role.role==="PLATFORM_OWNER")
    ));
    if(!activeReader)throw new AuthError(404,"Resource not found","CROSS_TENANT_ACCESS_ATTEMPT");
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...await readAttendanceSchedule(pool, id), precedence: attendanceRulePrecedence });
  }));
  router.put("/school/attendance/schedule", run(async (req, res) => {
    const id = school(req);
    const ctx = assertSchoolOperationalAccess(req, id, ["SCHOOL_ADMIN"]);
    const body = updateSchema.safeParse(req.body);
    if (!body.success) throw new AuthError(400, body.error.issues.map(i => i.message).join("; "));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`attendance-schedule:${id}`]);
      const prior = await readAttendanceSchedule(client, id);
      if (prior.revision !== body.data.revision) throw new AuthError(409, "Schedule changed; reload before saving");
      // Older clients must not silently erase per-day closing times.
      if (prior.schedule.closingByWeekday && !body.data.schedule.closingByWeekday) {
        const retained = attendanceScheduleSchema.safeParse({
          ...body.data.schedule, closingByWeekday: prior.schedule.closingByWeekday,
        });
        if (!retained.success) throw new AuthError(400, "Review times conflict with the saved weekday closing times");
        body.data.schedule = retained.data;
      }
      for (const exemption of body.data.schedule.exemptions) {
        const student = await client.query("SELECT id FROM students WHERE id=$1 AND school_id=$2",
          [exemption.studentId, id]);
        if (!student.rows[0]) throw new AuthError(400, "Exemption student is not in this school");
      }
      const revision = prior.revision + 1;
      await client.query(`INSERT INTO audit_logs
        ("user",role,school_id,actor_user_id,action,module,record_id,metadata)
        VALUES($1,'SCHOOL_ADMIN',$2,$3,$4,'Attendance',$2,$5::jsonb)`,
      [[ctx.user.firstName,ctx.user.lastName].filter(Boolean).join(" ") || "School administrator", id, ctx.user.id, ATTENDANCE_SCHEDULE_ACTION,
        JSON.stringify({ revision, schedule: body.data.schedule, reason: body.data.reason })]);
      // Preserve compatibility for existing consumers of attendance_settings.
      await client.query(`INSERT INTO attendance_settings(school_id,entry_window_start,entry_window_end,
        classroom_window_end,duplicate_suppression_seconds,notify_on_entry,notify_on_exit,notify_on_discrepancy)
        VALUES($1,$2,$3,$4,$5,$6,$6,$6) ON CONFLICT(school_id) DO UPDATE SET
        entry_window_start=$2,entry_window_end=$3,classroom_window_end=$4,
        duplicate_suppression_seconds=$5,notify_on_entry=$6,notify_on_exit=$6,notify_on_discrepancy=$6,updated_at=NOW()`,
      [id, body.data.schedule.arrivalStart, body.data.schedule.lateCutoff,
        body.data.schedule.classroomDeadline, body.data.schedule.duplicateSeconds, body.data.schedule.rules.notifications]);
      await client.query("COMMIT");
      res.json({ schedule: body.data.schedule, revision, precedence: attendanceRulePrecedence });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }));
  router.post("/school/attendance/assess", run(async (req, res) => {
    const id = school(req);
    assertSchoolOperationalAccess(req, id, ["SCHOOL_ADMIN"]);
    const body = z.object({ afterStudentId: z.number().int().nonnegative().default(0) }).strict().safeParse(req.body ?? {});
    if (!body.success) throw new AuthError(400, "Invalid assessment cursor");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await assessAttendanceDay(client, id, new Date(), body.data.afterStudentId, notify);
      const ctx = getUserContext(req);
      await client.query(`INSERT INTO audit_logs("user",role,school_id,actor_user_id,action,module,metadata)
        VALUES('School administrator','SCHOOL_ADMIN',$1,$2,'Assessed school attendance','Attendance',$3::jsonb)`,
      [id, ctx.user.id, JSON.stringify(result)]);
      await client.query("COMMIT");
      res.json(result);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }));
  return router;
}
