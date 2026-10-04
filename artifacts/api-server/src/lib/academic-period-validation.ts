import { AuthError } from "../middlewares/auth";

export function parseCalendarBody(schema: any, raw: any) {
  // Validate original strings before generated Zod date coercion can normalize
  // impossible dates such as February 30 into a different month.
  for(const key of ["startDate","endDate"]) if(raw?.[key]!==undefined) {
    const value=raw[key];
    const day=typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(value) ? value.slice(0,10) : value;
    validatePeriodDates(day,day);
  }
  return schema.parse(raw);
}
function calendarDate(value: any) {
  return value instanceof Date && Number.isFinite(value.valueOf()) ? value.toISOString().slice(0,10) : value;
}
export function validatePeriodDates(start: unknown, end: unknown) {
  for (const value of [start, end]) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new AuthError(400, "Enter valid academic start and end dates");
    }
  }
  if (String(end) < String(start)) throw new AuthError(400, "Academic end date cannot precede start date");
}

/** Serialize calendar changes per school, including simultaneous activation. */
export async function validateAcademicPeriod(client: any, schoolId: number, body: any, current: any = {}, sessionId?: number) {
  if(body.name!==undefined && (typeof body.name!=="string" || !body.name.trim() || body.name.trim().length>120)) {
    throw new AuthError(400,"Academic period name is required and must be at most 120 characters");
  }
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`academic-calendar:${schoolId}`]);
  const start = calendarDate(body.startDate ?? current.start_date);
  const end = calendarDate(body.endDate ?? current.end_date);
  validatePeriodDates(start, end);
  const status = body.status ?? current.status ?? "ACTIVE";
  const isCurrent = body.isCurrent ?? current.is_current ?? false;
  if (isCurrent && status !== "ACTIVE") throw new AuthError(400, "Only an active academic period can be current");
  if (sessionId === undefined) {
    const outside = await client.query(`SELECT 1 FROM academic_terms WHERE school_id=$1 AND academic_session_id=$2
      AND (start_date<$3::date OR end_date>$4::date) LIMIT 1`, [schoolId, current.id ?? 0, start, end]);
    if (outside.rows.length) throw new AuthError(409, "Session dates must contain its existing terms");
    return;
  }
  const session = await client.query("SELECT start_date::text,end_date::text,status,is_current FROM academic_sessions WHERE id=$1 AND school_id=$2", [sessionId, schoolId]);
  if (!session.rows[0]) throw new AuthError(404, "Academic session not found");
  if (start < session.rows[0].start_date || end > session.rows[0].end_date) throw new AuthError(400, "Term dates must fall within the academic session");
  if (isCurrent && (!session.rows[0].is_current || session.rows[0].status !== "ACTIVE")) throw new AuthError(400, "Activate this session before making one of its terms current");
  const overlap = await client.query(`SELECT id FROM academic_terms WHERE school_id=$1 AND academic_session_id=$2
    AND id<>$3 AND start_date<=$5::date AND end_date>=$4::date LIMIT 1`, [schoolId, sessionId, current.id ?? 0, start, end]);
  if (overlap.rows.length && !(body.allowOverlap === true && typeof body.overlapReason === "string" && body.overlapReason.trim().length >= 5)) {
    throw new AuthError(409, "Term dates overlap. Explicitly confirm the overlap and provide a reason.");
  }
}