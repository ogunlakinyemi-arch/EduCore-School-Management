import { z } from "zod";
import { AuthError } from "../middlewares/auth";

export type AttendanceDb = { query(sql: string, values?: any[]): Promise<{ rows: any[] }> };
export const ATTENDANCE_SCHEDULE_ACTION = "Updated school attendance schedule";
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Invalid calendar date");
export const attendanceScheduleSchema = z.object({
  timezone: z.string().max(80).refine(v => {
    try { new Intl.DateTimeFormat("en", { timeZone: v }).format(); return true; } catch { return false; }
  }, "Use an IANA timezone"),
  operatingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7)
    .refine(v => new Set(v).size === v.length, "Do not repeat operating days"),
  arrivalStart: time, arrivalEnd: time, lateCutoff: time, absenceAssessment: time,
  weekdaysClosing: time, fridayClosing: time,
  missingTagOutStart: time, missingTagOutEnd: time, fridayMissingTagOut: time,
  classroomDeadline: time,
  duplicateSeconds: z.number().int().min(5).max(600),
  offlineMaxHours: z.number().int().min(1).max(8784),
  closures: z.array(z.object({ date: day, reason: z.string().trim().min(3).max(300) }).strict()).max(366),
  exemptions: z.array(z.object({
    studentId: z.number().int().positive(), from: day, to: day, reason: z.string().trim().min(3).max(300),
  }).strict().refine(v => v.from <= v.to, "Exemption end must follow start")).max(2000),
  rules: z.object({
    entryEnabled: z.boolean(), exitEnabled: z.boolean(), lateness: z.boolean(),
    absenceReview: z.boolean(), classroomAnomalies: z.boolean(), missingTagOut: z.boolean(),
    offlineSync: z.boolean(), notifications: z.boolean(), allowEarlyExit: z.boolean(),
    allowReentry: z.boolean(), provisionalClassPresence: z.boolean(),
  }).strict(),
}).strict().superRefine((s, ctx) => {
  const ordered = s.arrivalStart < s.arrivalEnd && s.arrivalEnd <= s.lateCutoff
    && s.lateCutoff < s.absenceAssessment && s.lateCutoff <= s.classroomDeadline
    && s.absenceAssessment < s.weekdaysClosing && s.absenceAssessment < s.fridayClosing
    && s.weekdaysClosing <= s.missingTagOutStart && s.missingTagOutStart <= s.missingTagOutEnd
    && s.fridayClosing <= s.fridayMissingTagOut;
  if (!ordered) ctx.addIssue({ code: "custom", message: "Arrival, late, classroom, absence, closing and review times must be in school-day order" });
  if (new Set(s.closures.map(c => c.date)).size !== s.closures.length)
    ctx.addIssue({ code: "custom", message: "Do not repeat closure dates" });
});
export type AttendanceSchedule = z.infer<typeof attendanceScheduleSchema>;
export const defaultAttendanceSchedule: AttendanceSchedule = {
  timezone: "Africa/Lagos", operatingDays: [1, 2, 3, 4, 5],
  arrivalStart: "06:45", arrivalEnd: "07:45", lateCutoff: "08:00", absenceAssessment: "10:00",
  weekdaysClosing: "14:00", fridayClosing: "13:00", missingTagOutStart: "14:00",
  missingTagOutEnd: "16:00", fridayMissingTagOut: "14:00", classroomDeadline: "08:15",
  duplicateSeconds: 30, offlineMaxHours: 72, closures: [], exemptions: [],
  rules: { entryEnabled: true, exitEnabled: true, lateness: true, absenceReview: true,
    classroomAnomalies: true, missingTagOut: true, offlineSync: true, notifications: true,
    allowEarlyExit: false, allowReentry: false, provisionalClassPresence: true },
};
export const attendanceRulePrecedence = [
  "Authenticated tenant/device/card and subscription permissions always apply",
  "Approved corrections and manual classroom evidence remain authoritative",
  "Closures, non-operating days and student exemptions suppress automated assessments",
  "Immutable event identity and duplicate suppression precede any state change",
  "School-day state and reader mode determine entry/exit; stale ambiguous scans require review",
  "Schedule thresholds classify lateness and create reviews, never physical-absence proof",
  "Notification intent obeys school rules plus Owner policy and recipient preferences at dispatch",
];
export async function readAttendanceSchedule(db: AttendanceDb, schoolId: number) {
  const rows = await db.query(`SELECT metadata,created_at AS "effectiveAt" FROM audit_logs
    WHERE school_id=$1 AND action=$2 AND module='Attendance' ORDER BY id DESC LIMIT 1`,
  [schoolId, ATTENDANCE_SCHEDULE_ACTION]);
  const saved = rows.rows[0]?.metadata;
  if (!saved) return { schedule: structuredClone(defaultAttendanceSchedule), revision: 0, effectiveAt: null as string|null };
  const parsed = attendanceScheduleSchema.safeParse(saved.schedule);
  if (!parsed.success) throw new AuthError(503, "Saved attendance schedule is invalid; administrator review required");
  return { schedule: parsed.data, revision: Number(saved.revision),
    effectiveAt: rows.rows[0]?.effectiveAt ? new Date(rows.rows[0].effectiveAt).toISOString() : null };
}
export function schoolClock(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const p = Object.fromEntries(parts.map(v => [v.type, v.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, time: `${p.hour}:${p.minute}`,
    weekday: new Date(`${date}T12:00:00Z`).getUTCDay() || 7 };
}
export function attendanceDayOpen(s: AttendanceSchedule, date: string, weekday: number, studentId?: number) {
  return s.operatingDays.includes(weekday) && !s.closures.some(c => c.date === date)
    && !s.exemptions.some(e => e.studentId === studentId && e.from <= date && e.to >= date);
}
export function decideGateTransition(input: {
  mode: "ENTRY" | "EXIT" | "ENTRY_EXIT"; requested: string;
  latest: { eventType: string; occurredAt: string | Date } | null; occurredAt: Date;
  schedule: AttendanceSchedule; hasLaterEvent: boolean;
}) {
  const { schedule: s, latest, occurredAt, mode } = input;
  const clock = schoolClock(occurredAt, s.timezone);
  // Closures/exemptions suppress assessments and provisional class presence,
  // not authenticated factual gate evidence.
  if (input.hasLaterEvent) throw new AuthError(409, "Out-of-order scan requires attendance review; no state was changed");
  if (latest && Math.abs(occurredAt.getTime() - new Date(latest.occurredAt).getTime()) < s.duplicateSeconds * 1000)
    throw new AuthError(409, "Duplicate scan suppressed");
  const eventType = mode === "ENTRY_EXIT"
    ? latest?.eventType === "SCHOOL_ENTRY" ? "SCHOOL_EXIT" : "SCHOOL_ENTRY"
    : mode === "ENTRY" ? "SCHOOL_ENTRY" : "SCHOOL_EXIT";
  if (input.requested !== "SCHOOL_AUTO" && input.requested !== eventType)
    throw new AuthError(409, "Scan direction conflicts with configured reader mode");
  if (latest?.eventType === eventType) throw new AuthError(409, "Student already has this gate state");
  if (eventType === "SCHOOL_ENTRY" && (!s.rules.entryEnabled || (latest && !s.rules.allowReentry)))
    throw new AuthError(409, "Entry or same-day re-entry is disabled by attendance rules");
  if (eventType === "SCHOOL_EXIT" && !s.rules.exitEnabled)
    throw new AuthError(409, "Exit is disabled by attendance rules");
  if (mode === "ENTRY_EXIT" && eventType === "SCHOOL_EXIT" && !s.rules.allowEarlyExit
      && clock.time < (clock.weekday === 5 ? s.fridayClosing : s.weekdaysClosing))
    throw new AuthError(409, "Early exit requires authorized school review; repeated entry was not converted to exit");
  return { eventType, date: clock.date,
    status: eventType === "SCHOOL_ENTRY" && s.rules.lateness
      && attendanceDayOpen(s,clock.date,clock.weekday) && clock.time >= s.lateCutoff ? "LATE" : "PRESENT" };
}
