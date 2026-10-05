import { pool } from "@workspace/db";
// Publication freezes subject-level grades and averages alongside the existing immutable
// report-line snapshots. Never regrade family reports against a subsequently changed policy.
export async function publishedConsolidation(card:any) {
  if(card.status!=="PUBLISHED") return {};
  const r=await pool.query(`SELECT metadata FROM audit_logs WHERE school_id=$1 AND record_id=$2
    AND module='ExamRecord' AND action='Published consolidated Exam/Record report'
    ORDER BY id DESC LIMIT 1`,[card.schoolId,card.id]);
  const value=r.rows[0]?.metadata;
  if(!value||!Array.isArray(value.consolidatedSubjects)) return {};
  return {consolidatedSubjects:value.consolidatedSubjects,total:value.total,average:value.average,attendance:value.attendance??null};
}
