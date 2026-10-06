import type { Request } from "express";
import { pool } from "@workspace/db";
import { AuthError, assertSchoolAccess, assertSchoolOperationalAccess, getUserContext, isPlatformOwner } from "../middlewares/auth";
import { familyChildSchoolScope } from "./family-child-school-scope";
import { NFC_CATEGORY_PATTERN } from "./student-nfc-policy";
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
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`student-nfc:${schoolId}:${studentId}:${sessionId}:${termId}`]);
  const existing = await db.query(`SELECT subscription_id AS "subscriptionId",legacy_invoice_id AS "legacyInvoiceId"
    FROM student_subscription_terms WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3 AND academic_term_id=$4`,
    [schoolId,studentId,sessionId,termId]);
  if (existing.rows[0]) return existing.rows[0];
  const eligible = await db.query(`SELECT t.name,t.end_date::text AS "endDate"
    FROM students st JOIN academic_terms t ON t.school_id=st.school_id
    JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
    WHERE st.id=$2 AND st.school_id=$1 AND lower(st.status)='active'
      AND t.id=$4 AND ses.id=$3 AND upper(t.status) IN ('ACTIVE','PLANNED') AND upper(ses.status) IN ('ACTIVE','PLANNED')
      AND t.end_date>=(now() AT TIME ZONE 'Africa/Lagos')::date`,
    [schoolId,studentId,sessionId,termId]);
  if (!eligible.rows[0]) return null;
  const term = eligible.rows[0];
  // Reuse the authoritative old ledger, including explicit verified waivers.
  const old = await db.query(`SELECT s.id,s.status,s.verification_status FROM subscriptions s WHERE s.school_id=$1 AND s.student_id=$2
    AND s.term=$3 AND (s.expires_at::date=$4::date+1
      OR s.allocation_snapshot->>'termId'=$5::integer::text
      OR EXISTS(SELECT 1 FROM student_subscription_payments p WHERE p.subscription_id=s.id
        AND p.school_id=s.school_id AND p.academic_session_id=$6 AND p.academic_term_id=$5))
    ORDER BY CASE WHEN lower(s.status)='waived' AND lower(s.verification_status)='verified' THEN 0
      WHEN lower(s.status)='active' AND lower(s.verification_status)='verified' THEN 1 ELSE 2 END,s.id`,
    [schoolId,studentId,term.name,term.endDate,termId,sessionId]);
  if (old.rows.length>1) throw new AuthError(409,"Multiple historical NFC subscriptions require Owner reconciliation; no new charge was created");
  const legacy = await db.query(`SELECT i.id FROM fee_invoices i JOIN fee_invoice_lines l
    ON l.invoice_id=i.id AND l.school_id=i.school_id
    WHERE i.school_id=$1 AND i.student_id=$2 AND i.academic_session_id=$3 AND i.academic_term_id=$4
      AND i.status<>'CANCELLED' AND l.amount_minor>0 AND (l.category_name_snapshot ~* $5 OR l.description_snapshot ~* $5)
    ORDER BY i.id LIMIT 1`,
    [schoolId,studentId,sessionId,termId,NFC_CATEGORY_PATTERN]);
  const authoritativeOld = old.rows[0] && String(old.rows[0].verification_status).toLowerCase()==="verified"
    && ["active","waived"].includes(String(old.rows[0].status).toLowerCase());
  let subscriptionId: number|null = !authoritativeOld && legacy.rows[0] ? null : old.rows[0]?.id ?? null;
  const legacyInvoiceId: number|null = subscriptionId==null ? legacy.rows[0]?.id ?? null : null;
  if (subscriptionId==null && legacyInvoiceId==null) {
    const inserted = await db.query(`INSERT INTO subscriptions(school_id,student_id,term,amount,school_share,edupulse_share,provider,expires_at)
      VALUES($1,$2,$3,5000,2000,3000,'FLUTTERWAVE',($4::date+1)::timestamptz) RETURNING id`,
      [schoolId,studentId,term.name,term.endDate]);
    subscriptionId = inserted.rows[0].id;
  }
  await db.query(`INSERT INTO student_subscription_terms(school_id,student_id,academic_session_id,academic_term_id,subscription_id,legacy_invoice_id)
    VALUES($1,$2,$3,$4,$5,$6)`,[schoolId,studentId,sessionId,termId,subscriptionId,legacyInvoiceId]);
  return {subscriptionId,legacyInvoiceId};
}

export async function ensureClassNfcSubscriptions(db: Sql, schoolId: number, sessionId: number, termId: number, classId: number, section: string|null) {
  const students = await db.query(`SELECT st.id FROM students st JOIN school_classes sc
    ON sc.school_id=st.school_id AND sc.name=st.class_name
    WHERE st.school_id=$1 AND sc.id=$2 AND lower(st.status)='active' AND ($3::text IS NULL OR st.section=$3)
    ORDER BY st.id`,[schoolId,classId,section]);
  for (const st of students.rows) await ensureStudentNfcSubscription(db,schoolId,st.id,sessionId,termId);
}
