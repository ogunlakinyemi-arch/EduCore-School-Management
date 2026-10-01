/**
 * Keep already-configured generated calendar entries inside the current
 * authoritative term/session dates. Term and session boundary entries
 * themselves are projected live by the academic-calendar query.
 */
export type AcademicCalendarProjectionExecutor = {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
};

export type ConfiguredTermCalendarRefresh = {
  schoolId: number;
  sessionId: number;
  termId: number;
  actorUserId: number;
};

/**
 * Revalidate generated entries after a term is created or its dates/status are
 * changed. Entries outside the updated term (or session for result dates) are
 * deactivated rather than silently moved. Explicitly inactive entries are
 * preserved. Returns the number of entries deactivated.
 */
export async function refreshConfiguredTermCalendarEvents(
  executor: AcademicCalendarProjectionExecutor,
  input: ConfiguredTermCalendarRefresh,
): Promise<number> {
  const result = await executor.query(
    `UPDATE school_calendar_events ce
        SET status='INACTIVE',updated_by_user_id=$4,updated_at=NOW()
       FROM academic_terms t
       JOIN academic_sessions ac
         ON ac.id=t.academic_session_id AND ac.school_id=t.school_id
      WHERE ce.school_id=$1
        AND ce.academic_session_id=$2
        AND ce.academic_term_id=$3
        AND ce.source='GENERATED'
        AND ce.status='ACTIVE'
        AND (
          UPPER(t.status)='INACTIVE'
          OR UPPER(ac.status)='INACTIVE'
          OR ce.start_date < CASE
               WHEN ce.category='RESULT_PUBLICATION' THEN ac.start_date
               ELSE t.start_date
             END
          OR COALESCE(ce.end_date,ce.start_date) > CASE
               WHEN ce.category='RESULT_PUBLICATION' THEN ac.end_date
               ELSE t.end_date
             END
        )
      RETURNING ce.id`,
    [input.schoolId, input.sessionId, input.termId, input.actorUserId],
  );
  return result.rows.length;
}