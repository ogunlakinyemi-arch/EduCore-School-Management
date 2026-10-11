import { AuthError } from "../middlewares/auth";
import type { StudentSubscriptionSqlClient } from "./student-subscription-billing";

/** Resolve IDs within the tenant; legacy text is accepted only if unambiguous. */
export async function resolveRegistrationClass(
  db: StudentSubscriptionSqlClient, schoolId: number,
  input: { classId?: number; className?: string; section?: string },
) {
  const rows = (await db.query(
    `SELECT id,name,section FROM school_classes WHERE school_id=$1
       AND (($2::int IS NOT NULL AND id=$2)
         OR ($2::int IS NULL AND name=$3 AND section=$4)) FOR SHARE`,
    [schoolId, input.classId ?? null, input.className ?? null, input.section ?? null],
  )).rows;
  if (rows.length !== 1) throw new AuthError(400, "Select an existing class belonging to this school. Create a class first if none exists.");
  return rows[0];
}

/** School lock plus student row lock serialize changes; retain old enrollment history. */
export async function saveRegistrationAssignment(
  db: StudentSubscriptionSqlClient, schoolId: number, studentId: number,
  selected: { id: number; name: string; section: string },
) {
  const sessions = (await db.query(
    `SELECT id FROM academic_sessions WHERE school_id=$1 AND is_current=true
       AND UPPER(status)='ACTIVE' AND start_date<=CURRENT_DATE AND end_date>=CURRENT_DATE FOR SHARE`,
    [schoolId],
  )).rows;
  if (sessions.length !== 1) throw new AuthError(409, "Configure one active current academic session before assigning students.");
  const sessionId = sessions[0].id;
  const previous = (await db.query(
    `SELECT id,school_class_id,academic_session_id,section FROM student_class_assignments
       WHERE student_id=$1 AND school_id=$2 AND is_current=true FOR UPDATE`,
    [studentId, schoolId],
  )).rows;
  if (previous.length > 1) throw new AuthError(409, "Current class assignments require review before this student can be changed.");
  if (previous[0]?.school_class_id === selected.id &&
      previous[0]?.academic_session_id === sessionId && previous[0]?.section === selected.section) return;
  await db.query(
    `UPDATE student_class_assignments SET is_current=false,status='INACTIVE',
       end_date=COALESCE(end_date,CURRENT_DATE),updated_at=NOW()
       WHERE student_id=$1 AND school_id=$2 AND is_current=true`, [studentId, schoolId],
  );
  await db.query(
    `INSERT INTO student_class_assignments
       (school_id,student_id,academic_session_id,school_class_id,section,status,is_current,start_date)
       VALUES($1,$2,$3,$4,$5,'ACTIVE',true,CURRENT_DATE)`,
    [schoolId, studentId, sessionId, selected.id, selected.section],
  );
}

export async function registrationParent(db: StudentSubscriptionSqlClient, schoolId: number, parentId?: number) {
  if (parentId == null) return null;
  const parent = (await db.query(
    "SELECT id,name,phone,default_relationship_type FROM parents WHERE id=$1 AND school_id=$2 AND UPPER(status)='ACTIVE' FOR SHARE",
    [parentId, schoolId],
  )).rows[0];
  if (!parent) throw new AuthError(400, "Select an active parent belonging to this school.");
  return parent;
}
