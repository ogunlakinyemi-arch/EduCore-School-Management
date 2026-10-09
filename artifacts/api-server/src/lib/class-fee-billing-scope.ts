type Sql = { query(sql: string, values?: any[]): Promise<{ rows: any[] }> };

/** One eligibility definition for ordinary fee publication and automatic NFC billing. */
export async function classFeeBillingStudents(
  db: Sql, schoolId: number, sessionId: number, termId: number, classId: number, section: string | null,
) {
  return (await db.query(`SELECT DISTINCT ON (st.id) st.id,st.first_name,st.last_name,st.admission_no,
      sc.name AS class_name,COALESCE(a.section,st.section,'') AS section
    FROM students st LEFT JOIN student_class_assignments a ON a.student_id=st.id AND a.school_id=st.school_id
      AND a.academic_session_id=$2 AND (a.academic_term_id=$3 OR a.academic_term_id IS NULL)
    JOIN school_classes sc ON sc.id=$4 AND sc.school_id=st.school_id
    JOIN academic_terms term ON term.id=$3 AND term.school_id=st.school_id AND term.academic_session_id=$2
    JOIN academic_sessions ses ON ses.id=term.academic_session_id AND ses.school_id=term.school_id
    WHERE st.school_id=$1 AND LOWER(st.status)='active' AND UPPER(st.admission_status)='ADMITTED'
      AND ((a.school_class_id=$4 AND (a.status='ACTIVE' OR (NOT (term.is_current AND ses.is_current) AND a.status='INACTIVE')))
        OR (term.is_current AND ses.is_current AND a.id IS NULL AND st.class_name=sc.name
          AND (sc.section='' OR sc.section=COALESCE(st.section,''))))
      AND ($5::text IS NULL OR COALESCE(a.section,st.section,'')=$5)
    ORDER BY st.id,a.id DESC`, [schoolId, sessionId, termId, classId, section])).rows;
}
