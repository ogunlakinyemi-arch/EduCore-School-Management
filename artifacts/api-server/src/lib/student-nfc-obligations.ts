import type { Request } from "express";
import { pool } from "@workspace/db";
import { AuthError, assertSchoolAccess, assertSchoolOperationalAccess, getUserContext, isPlatformOwner } from "../middlewares/auth";
import { NFC_CATEGORY_PATTERN } from "./student-nfc-policy";
import { classFeeBillingStudents } from "./class-fee-billing-scope";
export { NFC_CATEGORY_PATTERN,isSystemNfcCategory } from "./student-nfc-policy";

type Sql = { query: (sql: string, values?: any[]) => Promise<any> };

/** These predicates are shared by reporting and payment authorization. */
export function studentNfcReadScope(req: Request, values: unknown[], alias = "st", includeTeacher=true, teacherSession?:string) {
  const ctx = getUserContext(req);
  if (isPlatformOwner(ctx)) return "TRUE";
  const schools = ctx.roles.filter(r => r.status === "ACTIVE" &&
    ["SCHOOL_ADMIN","ACCOUNTANT"].includes(r.role) && r.schoolId != null).map(r => r.schoolId);
  values.push(schools);
  const admin = `$${values.length}::integer[]`;
  return `${alias}.school_id=ANY(${admin})`;
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
    ["SCHOOL_ADMIN","ACCOUNTANT"].includes(r.role));
  if (!permitted) throw new AuthError(403,"This role cannot pay student subscriptions");
  assertSchoolAccess(req,schoolId,["SCHOOL_ADMIN","ACCOUNTANT"]);
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
