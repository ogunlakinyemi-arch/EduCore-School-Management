import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";

/** Evidence only. Grade bands and a legacy heuristic are not an approved
 * promotion/completeness policy. This function never creates or moves records. */
export async function promotionReadiness(schoolId: number, sourceSessionId: number) {
  const session = await pool.query(
    "SELECT id FROM academic_sessions WHERE id=$1 AND school_id=$2",
    [sourceSessionId, schoolId],
  );
  if (!session.rows[0]) throw new AuthError(404, "Academic session not found in this school");
  const terms = await pool.query(
    `SELECT id FROM academic_terms
      WHERE school_id=$1 AND academic_session_id=$2 AND name='Third'`,
    [schoolId, sourceSessionId],
  );
  const thirdTermId = terms.rows.length === 1 ? Number(terms.rows[0].id) : null;
  // The term can be missing; still report the cohort without counting another
  // term's results. NULL cannot match academic_term_id.
  const result = await pool.query(
    `WITH placements AS (
       SELECT a.id,a.student_id,a.school_class_id,a.section,a.academic_term_id
         FROM student_class_assignments a
         JOIN students st ON st.id=a.student_id AND st.school_id=a.school_id
        WHERE a.school_id=$1 AND a.academic_session_id=$2
          AND a.status='ACTIVE' AND a.is_current=true AND lower(st.status)='active'
     ), evidence AS (
       SELECT p.student_id,COUNT(DISTINCT p.id)::int AS placement_count,
              COUNT(DISTINCT r.id)::int AS result_count
         FROM placements p LEFT JOIN academic_results r
           ON r.student_id=p.student_id AND r.student_class_assignment_id=p.id
          AND r.school_id=$1 AND r.academic_session_id=$2 AND r.academic_term_id=$3
          AND (p.academic_term_id IS NULL OR p.academic_term_id=$3)
          AND r.school_class_id=p.school_class_id AND r.section_snapshot=p.section
          AND r.status='PUBLISHED' AND r.published_at IS NOT NULL
          AND r.max_score>0 AND r.score>=0 AND r.score<=r.max_score
        GROUP BY p.student_id
     )
     SELECT COUNT(*)::int AS "cohortCount",
            COUNT(*) FILTER(WHERE placement_count>1)::int AS "placementConflictCount",
            COUNT(*) FILTER(WHERE result_count>0)::int AS "studentsWithPublishedResults",
            COALESCE(SUM(result_count),0)::int AS "publishedResultCount"
       FROM evidence`,
    [schoolId, sourceSessionId, thirdTermId],
  );
  const row = result.rows[0];
  const cohortCount = Number(row.cohortCount);
  const placementConflictCount = Number(row.placementConflictCount);
  const studentsWithPublishedResults = Number(row.studentsWithPublishedResults);
  const missingPublishedResults = cohortCount - studentsWithPublishedResults;
  const blockers = ["An explicit school-approved promotion pass rule and required-subject/completeness policy are not available. No eligibility decision can be made."];
  if (thirdTermId === null) blockers.push("Exactly one Third term is required in the selected source session.");
  if (!cohortCount) blockers.push("No active current student placements were found in the source session.");
  if (placementConflictCount) blockers.push(`${placementConflictCount} student(s) have conflicting current placements.`);
  if (missingPublishedResults) blockers.push(`${missingPublishedResults} student(s) have no valid published third-term evidence for their current placement.`);
  return {
    schoolId, sourceSessionId, thirdTermId, cohortCount, placementConflictCount,
    studentsWithPublishedResults, missingPublishedResults,
    publishedResultCount: Number(row.publishedResultCount),
    executionEnabled: false as const,
    policyStatus: "REQUIRES_APPROVED_POLICY" as const,
    blockers,
    warnings: [
      "Result counts do not establish complete subject coverage or a pass. Draft and earlier-term results are excluded.",
      "This read-only preview creates no batch, changes no placement, and is not a confirmation or authorization token for the existing batch workflow.",
      "The existing 50% score / 75% attendance heuristic is not treated as an approved school promotion policy.",
    ],
  };
}
