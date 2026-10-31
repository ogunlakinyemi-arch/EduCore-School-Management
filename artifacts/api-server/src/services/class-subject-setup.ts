import { z } from "zod";
import { AuthError } from "../middlewares/auth";

export const classSubjectSetupBody = z.object({
  schoolId: z.number().int().positive(), classId: z.number().int().positive(),
  sessionId: z.number().int().positive(), termId: z.number().int().positive().nullable().optional(),
  expectedAssignmentIds: z.array(z.number().int().positive()).max(500),
  subjects: z.array(z.object({
    subjectId: z.number().int().positive(), teacherId: z.number().int().positive().nullable().optional(),
  }).strict()).max(500),
}).strict();
type Sql = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };

/** Caller owns transaction. Retire links, never delete academic evidence or rewrite timetables. */
export async function saveClassSubjectSetup(c: Sql, input: z.infer<typeof classSubjectSetupBody>) {
  const b = classSubjectSetupBody.parse(input);
  if (new Set(b.subjects.map(s => s.subjectId)).size !== b.subjects.length)
    throw new AuthError(400, "Choose each catalogue subject only once");
  if (new Set(b.expectedAssignmentIds).size !== b.expectedAssignmentIds.length)
    throw new AuthError(400, "Duplicate assignment identifiers");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`class-subject-setup:${b.schoolId}:${b.sessionId}:${b.classId}`]);
  const scope = (await c.query(`SELECT c.id,COALESCE(c.section,'') AS section,
    ac.start_date::text AS "sessionStart",ac.end_date::text AS "sessionEnd",
    t.start_date::text AS "termStart",t.end_date::text AS "termEnd",
    (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date::text AS today FROM school_classes c
    JOIN academic_sessions ac ON ac.id=$3 AND ac.school_id=c.school_id AND ac.status='ACTIVE'
    LEFT JOIN academic_terms t ON t.id=$4 AND t.school_id=c.school_id AND t.academic_session_id=ac.id
    WHERE c.school_id=$1 AND c.id=$2
      AND ($4::int IS NULL OR (t.id IS NOT NULL AND t.status='ACTIVE')) FOR SHARE OF c,ac`,
    [b.schoolId,b.classId,b.sessionId,b.termId ?? null])).rows[0];
  if (!scope) throw new AuthError(404, "Active class and academic period not found in this school");
  const values = [b.schoolId,b.classId,b.sessionId,b.termId ?? null,scope.section];
  const existing = (await c.query(`SELECT id,subject_id,employee_id FROM class_subjects
    WHERE school_id=$1 AND school_class_id=$2 AND academic_session_id=$3
      AND academic_term_id IS NOT DISTINCT FROM $4 AND (COALESCE(section,'')='' OR section=$5)
      AND status='ACTIVE' ORDER BY id FOR UPDATE`, values)).rows;
  if (JSON.stringify(existing.map(r => Number(r.id)).sort((a,b) => a-b)) !==
      JSON.stringify([...b.expectedAssignmentIds].sort((a,b) => a-b)))
    throw new AuthError(409, "Class subject links changed. Reload them before saving");
  if (new Set(existing.map(r => Number(r.subject_id))).size !== existing.length)
    throw new AuthError(409, "Duplicate active class links need review before this setup can be saved");
  for (const item of b.subjects) {
    const subject = await c.query(`SELECT id FROM subjects
      WHERE school_id=$1 AND id=$2 AND UPPER(status)='ACTIVE' FOR SHARE`, [b.schoolId,item.subjectId]);
    if (!subject.rows[0]) throw new AuthError(404, "An active catalogue subject was not found in this school");
    if (item.teacherId != null) {
      const teacher = await c.query(`SELECT e.id,
          EXISTS(SELECT 1 FROM teacher_class_assignments ta WHERE ta.school_id=e.school_id
            AND ta.employee_id=e.id AND ta.academic_session_id=ac.id AND ta.school_class_id=$4
            AND (ta.section='' OR ta.section=$6) AND ta.status='ACTIVE'
            AND (ta.assignment_type<>'SUBJECT_TEACHER' OR ta.subject_id=$5)
            AND ta.start_date<=COALESCE(ac.end_date,CURRENT_DATE)
            AND (ta.end_date IS NULL OR ta.end_date>=ac.start_date)) AS eligible
        FROM employees e
        JOIN academic_sessions ac ON ac.id=$3 AND ac.school_id=e.school_id
        WHERE e.school_id=$1 AND e.id=$2 AND UPPER(e.employee_type)='TEACHER'
          AND UPPER(e.employment_status)='ACTIVE'
          FOR SHARE OF e,ac`,
        [b.schoolId,item.teacherId,b.sessionId,b.classId,item.subjectId,scope.section]);
      if (!teacher.rows[0]) throw new AuthError(409, "Choose an active teacher from this school");
      if (!teacher.rows[0].eligible) {
        // This is an explicit Admin teacher choice, not an automatic side effect
        // of linking an unstaffed subject. Never backdate or replace old grants.
        const start = [scope.today,scope.sessionStart,scope.termStart].filter(Boolean).sort().at(-1)!;
        const end = [scope.termEnd,scope.sessionEnd].filter(Boolean).sort()[0];
        if (end && start > end) throw new AuthError(409,
          "This academic period has ended. Review dated staffing in Teacher Assignments before choosing its responsible teacher");
        const old = await c.query(`SELECT id FROM teacher_class_assignments WHERE school_id=$1
          AND employee_id=$2 AND academic_session_id=$3 AND school_class_id=$4 AND subject_id=$5
          AND section=$6 AND assignment_type='SUBJECT_TEACHER' AND status='ACTIVE' FOR UPDATE`,
          [b.schoolId,item.teacherId,b.sessionId,b.classId,item.subjectId,scope.section]);
        if (old.rows[0]) throw new AuthError(409,
          "An existing dated teacher assignment needs review in Teacher Assignments; it was not replaced");
        await c.query(`INSERT INTO teacher_class_assignments(school_id,employee_id,academic_session_id,
          school_class_id,subject_id,section,assignment_type,status,start_date,end_date)
          VALUES($1,$2,$3,$4,$5,$6,'SUBJECT_TEACHER','ACTIVE',$7,$8)`,
          [b.schoolId,item.teacherId,b.sessionId,b.classId,item.subjectId,scope.section,start,end ?? null]);
      }
    }
  }
  // Preserve legitimate staffing-only relationships. Explicitly removing one
  // records an inactive enrollment restriction instead of changing its staffing.
  const implicit = (await c.query(`SELECT DISTINCT ta.subject_id FROM teacher_class_assignments ta
    JOIN academic_sessions ac ON ac.id=ta.academic_session_id AND ac.school_id=ta.school_id
    WHERE ta.school_id=$1 AND ta.school_class_id=$2 AND ta.academic_session_id=$3
      AND ta.assignment_type='SUBJECT_TEACHER' AND ta.status='ACTIVE' AND ta.subject_id IS NOT NULL
      AND (ta.section='' OR ta.section=$4)
      AND ta.start_date<=COALESCE(ac.end_date,CURRENT_DATE)
      AND (ta.end_date IS NULL OR ta.end_date>=ac.start_date)
      AND NOT EXISTS(SELECT 1 FROM class_subjects cs WHERE cs.school_id=ta.school_id
        AND cs.school_class_id=ta.school_class_id AND cs.academic_session_id=ta.academic_session_id
        AND cs.subject_id=ta.subject_id)`, [b.schoolId,b.classId,b.sessionId,scope.section])).rows;
  const selected = new Set(b.subjects.map(s => s.subjectId));
  const removed = existing.filter(r => !selected.has(Number(r.subject_id)));
  if (removed.length) await c.query(`UPDATE class_subjects SET status='INACTIVE',updated_at=NOW()
    WHERE school_id=$1 AND id=ANY($2::int[])`, [b.schoolId,removed.map(r => r.id)]);
  for (const item of b.subjects) {
    const prior = existing.find(r => Number(r.subject_id) === item.subjectId);
    if (prior) {
      if ((prior.employee_id == null ? null : Number(prior.employee_id)) !== (item.teacherId ?? null)) {
        await c.query(`UPDATE class_subjects SET status='INACTIVE',updated_at=NOW() WHERE id=$1 AND school_id=$2`,
          [prior.id,b.schoolId]);
        await c.query(`INSERT INTO class_subjects(school_id,school_class_id,academic_session_id,
          academic_term_id,section,subject_id,employee_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE')`,
          [...values,item.subjectId,item.teacherId ?? null]);
      }
    } else await c.query(`INSERT INTO class_subjects(school_id,school_class_id,academic_session_id,
      academic_term_id,section,subject_id,employee_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE')`,
      [...values,item.subjectId,item.teacherId ?? null]);
  }
  for (const row of implicit) if (!selected.has(Number(row.subject_id)))
    await c.query(`INSERT INTO class_subjects(school_id,school_class_id,academic_session_id,
      academic_term_id,section,subject_id,status) VALUES($1,$2,$3,$4,$5,$6,'INACTIVE')`,
      [...values,row.subject_id]);
  return { saved: true, linkedSubjectCount: b.subjects.length };
}
