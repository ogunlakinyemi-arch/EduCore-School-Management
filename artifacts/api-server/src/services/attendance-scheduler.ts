import { pool } from "@workspace/db";
import { assessAttendanceDay, type AttendanceReviewNotice } from "./attendance-assessment";

/** Existing worker-pause guard owns execution. No timers or provider transports here. */
export async function assessDevelopmentSchools(notify: AttendanceReviewNotice) {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) return;
  // Saving a schedule is the explicit school-level opt-in to background reviews.
  const schools = await pool.query(`SELECT DISTINCT school_id FROM audit_logs
    WHERE action='Updated school attendance schedule' AND module='Attendance' AND school_id IS NOT NULL`);
  for (const school of schools.rows) {
    let cursor = 0;
    do {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await assessAttendanceDay(client,Number(school.school_id),new Date(),cursor,notify);
        await client.query("COMMIT");
        cursor = result.nextAfterStudentId ?? 0;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } while (cursor);
  }
}
