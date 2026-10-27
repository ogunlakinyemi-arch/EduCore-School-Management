import type { Request } from "express";
import { pool } from "@workspace/db";
import { AuthError, assertSchoolAccess, assertSchoolOperationalAccess, getUserContext, isPlatformOwner } from "../middlewares/auth";
import { familyChildSchoolScope } from "./family-child-school-scope";
import { NFC_CATEGORY_PATTERN } from "./student-nfc-policy";
import { classFeeBillingStudents } from "./class-fee-billing-scope";
export { NFC_CATEGORY_PATTERN,isSystemNfcCategory } from "./student-nfc-policy";

type Sql = { query: (sql: string, values?: any[]) => Promise<any> };

/** These predicates are shared by reporting and payment authorization. */
export function studentNfcReadScope(req: Request, values: unknown[], alias = "st", includeTeacher=true, teacherSession?:string) {
  const ctx = getUserContext(req);
  if (isPlatformOwner(ctx)) return "TRUE";
  values.push(ctx.user.id);
  const user = `$${values.length}`;
  const schools = ctx.roles.filter(r => r.status === "ACTIVE" &&
    ["SCHOOL_ADMIN","ACCOUNTANT"].includes(r.role) && r.schoolId != null).map(r => r.schoolId);
  values.push(schools);
  const admin = `$${values.length}::integer[]`;
  return `(${alias}.school_id=ANY(${admin})
    OR (${alias}.user_id=${user} AND EXISTS(SELECT 1 FROM school_memberships sm
      WHERE sm.user_id=${user} AND sm.school_id=${alias}.school_id AND sm.role='STUDENT' AND sm.status='ACTIVE'))
    OR EXISTS(SELECT 1 FROM parents p JOIN parent_student_relationships rel ON rel.parent_id=p.id
      WHERE p.user_id=${user} AND p.status='ACTIVE' AND rel.status='ACTIVE'
        AND rel.student_id=${alias}.id AND ${familyChildSchoolScope("p",alias)}
        AND EXISTS(SELECT 1 FROM school_memberships sm WHERE sm.user_id=${user}
          AND sm.school_id=${alias}.school_id AND sm.role='PARENT' AND sm.status='ACTIVE'))
    OR (${includeTeacher?"TRUE":"FALSE"} AND EXISTS(SELECT 1 FROM employees e JOIN teacher_class_assignments ta
      ON ta.employee_id=e.id AND ta.school_id=e.school_id AND ta.status='ACTIVE'
      JOIN school_classes sc ON sc.id=ta.school_class_id AND sc.school_id=ta.school_id
      WHERE e.user_id=${user} AND upper(e.employment_status)='ACTIVE' AND ta.school_id=${alias}.school_id
        AND sc.name=${alias}.class_name AND (ta.section IS NULL OR ta.section=${alias}.section)
        ${teacherSession?`AND ta.academic_session_id=${teacherSession}`:""}
        AND ta.start_date<=CURRENT_DATE AND (ta.end_date IS NULL OR ta.end_date>=CURRENT_DATE)
        AND EXISTS(SELECT 1 FROM school_memberships sm WHERE sm.user_id=${user}
          AND sm.school_id=${alias}.school_id AND sm.role='TEACHER' AND sm.status='ACTIVE'))))`;
}

export async function assertStudentNfcPaymentAccess(req: Request, subscriptionId: number, db: Sql = pool, knownSchoolId?:number) {
  const ctx = getUserContext(req);
  // Platform ownership is read-only for this school operation.
  if (isPlatformOwner(ctx)) throw new AuthError(403,"Platform Owner cannot pay school subscriptions");
  if(knownSchoolId!=null && ctx.roles.some(r=>r.status==="ACTIVE" && r.schoolId===knownSchoolId
      && ["SCHOOL_ADMIN","ACCOUNTANT"].includes(r.role))) {
    assertSchoolOperationalAccess(req,knownSchoolId,["SCHOOL_ADMIN","ACCOUNTANT"]);
    return ctx;
  }
  const values: unknown[] = [subscriptionId];
  const scope = studentNfcReadScope(req,values,"st",false);
  const found = await db.query(`SELECT st.id,st.school_id AS "schoolId"
    FROM subscriptions sub JOIN students st ON st.id=sub.student_id AND st.school_id=sub.school_id
    WHERE sub.id=$1 AND ${scope}`,values);
  if (!found.rows[0]) throw new AuthError(404,"Student subscription not found");
  const schoolId = Number(found.rows[0].schoolId);
  const permitted = ctx.roles.some(r => r.status==="ACTIVE" && r.schoolId===schoolId &&
    ["SCHOOL_ADMIN","ACCOUNTANT","PARENT","STUDENT"].includes(r.role));
  if (!permitted) throw new AuthError(403,"This role cannot pay student subscriptions");
  assertSchoolAccess(req,schoolId,["SCHOOL_ADMIN","ACCOUNTANT","PARENT","STUDENT"]);
  return ctx;
}

/**
 * Called in the caller's transaction. One academic-period binding serializes
 * all sections, fee schedules and retries. A legacy school-fee charge is NOT
 * reclassified as a verified platform payment.
 */
export async function ensureStudentNfcSubscription(db: Sql, schoolId: number, studentId: number, sessionId: number, termId: number) {
  // Existing bindings are historical evidence, not permission to issue another
  // legacy NGN 5,000 split. New issuance requires the separately reviewed
  // platform-only rule/engine and reconciliation approval; neither is active.
  const existing = await db.query(`SELECT subscription_id AS "subscriptionId",legacy_invoice_id AS "legacyInvoiceId"
    FROM student_subscription_terms WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3 AND academic_term_id=$4`,
    [schoolId,studentId,sessionId,termId]);
  return existing.rows[0] ?? null;
}

export async function ensureClassNfcSubscriptions(db: Sql, schoolId: number, sessionId: number, termId: number, classId: number, section: string|null) {
  const students = await classFeeBillingStudents(db,schoolId,sessionId,termId,classId,section);
  for (const st of students) await ensureStudentNfcSubscription(db,schoolId,st.id,sessionId,termId);
}
