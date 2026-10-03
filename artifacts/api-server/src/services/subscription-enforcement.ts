import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { STUDENT_SUBSCRIPTION_GROSS_MINOR } from "../lib/student-subscription-billing";
import { queueCommunicationNotification, type CommunicationQueryClient } from "./communication-service";
import { subscriptionPolicy, type SubscriptionStudent } from "./subscription-enforcement-policy";
import { familyChildSchoolScope } from "../lib/family-child-school-scope";
import { assertManualSchoolUnlocked, readManualSchoolState, readSubscriptionScopeCounts } from "./school-subscription-lock";

export type EnforcementSource = "AUTOMATIC_TERM_ENFORCEMENT" | "SUBSCRIPTION_PAYMENT_RESTORATION";
export type EnforcementActor = { id: number; clerkUserId: string; email: string };
export type EnforcementSnapshot = Awaited<ReturnType<typeof readSchoolSubscription>>;

export async function readSchoolSubscription(db: CommunicationQueryClient, schoolId: number) {
  const calendar = await db.query<{
    schoolName: string; sessionId: number; sessionName: string; termId: number; termName: string; startDate: string; endDate: string; today: string;
  }>(
    `SELECT sc.name AS "schoolName",ses.id AS "sessionId",ses.name AS "sessionName",t.id AS "termId",t.name AS "termName",
            t.start_date::text AS "startDate",t.end_date::text AS "endDate",
            (NOW() AT TIME ZONE 'Africa/Lagos')::date::text AS today
       FROM schools sc JOIN academic_terms t ON t.school_id=sc.id
       JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=sc.id
      WHERE sc.id=$1 AND LOWER(sc.status)='active'
        AND t.is_current=true AND UPPER(t.status)='ACTIVE'
        AND ses.is_current=true AND UPPER(ses.status)='ACTIVE'
        AND t.start_date<=(NOW() AT TIME ZONE 'Africa/Lagos')::date
        AND t.end_date>=(NOW() AT TIME ZONE 'Africa/Lagos')::date`, [schoolId],
  );
  // Ambiguous or missing calendars are NOT evidence of nonpayment.
  if (calendar.rows.length !== 1) return null;
  const term = calendar.rows[0];
  const students = await db.query<SubscriptionStudent & { amountMinor: number }>(
    `SELECT st.id AS "studentId",
       EXISTS (
         SELECT 1 FROM subscriptions s WHERE s.school_id=st.school_id AND s.student_id=st.id
          AND s.term=$2 AND LOWER(s.status)='active' AND LOWER(s.verification_status)='verified'
          AND (EXISTS (SELECT 1 FROM student_subscription_payments p
                WHERE p.subscription_id=s.id AND p.school_id=st.school_id AND p.student_id=st.id
                  AND p.academic_term_id=$3 AND p.status='PAID' AND p.reconciliation_status='RECONCILED')
            OR (s.allocation_snapshot->>'termId'=$3::text AND s.expires_at::date=$4::date+1)
            OR (s.allocation_snapshot IS NULL AND s.expires_at::date=$4::date+1))
       ) AS paid,
       EXISTS (
         SELECT 1 FROM subscriptions s WHERE s.school_id=st.school_id AND s.student_id=st.id
           AND s.term=$2 AND LOWER(s.status)='waived' AND LOWER(s.verification_status)='verified'
           AND s.expires_at::date=$4::date+1
       ) AS waived,
       EXISTS (
         SELECT 1 FROM student_subscription_payments p WHERE p.school_id=st.school_id
           AND p.student_id=st.id AND p.academic_term_id=$3 AND p.status IN ('PENDING','RECONCILIATION_REQUIRED')
       ) AS pending,
       EXISTS (
         SELECT 1 FROM subscriptions s WHERE s.school_id=st.school_id AND s.student_id=st.id
           AND s.term=$2 AND s.expires_at::date=$4::date+1
           AND (LOWER(s.verification_status) NOT IN ('verified','pending','unverified','rejected','failed')
             OR LOWER(s.status) NOT IN ('active','pending','waived','cancelled','expired','inactive','failed'))
       ) AS unknown,
       COALESCE((SELECT round(s.amount*100)::integer FROM subscriptions s
         WHERE s.school_id=st.school_id AND s.student_id=st.id AND s.term=$2
           AND s.expires_at::date=$4::date+1 ORDER BY s.id DESC LIMIT 1),$5::integer) AS "amountMinor"
      FROM students st WHERE st.school_id=$1 AND LOWER(st.status)='active' ORDER BY st.id`,
    [schoolId, term.termName, term.termId, term.endDate, STUDENT_SUBSCRIPTION_GROSS_MINOR],
  );
  const policy = subscriptionPolicy(term, students.rows, term.today);
  if (!policy.inGracePeriod && students.rows.some(s => s.unknown)) {
    const known = await db.query<{ ids: number[] }>(
      "SELECT restricted_student_ids AS ids FROM school_subscription_enforcement WHERE school_id=$1 AND academic_term_id=$2",
      [schoolId, term.termId],
    );
    const retained = students.rows.filter(s => s.unknown && !s.paid && !s.waived && known.rows[0]?.ids.includes(s.studentId)).map(s => s.studentId);
    policy.restrictedStudentIds = [...new Set([...policy.restrictedStudentIds, ...retained])].sort((a, b) => a - b);
    policy.studentsAffected = policy.restrictedStudentIds.length;
  }
  const ids = policy.restrictedStudentIds;
  const counts = await readSubscriptionScopeCounts(db, schoolId, ids, false);
  const amountDueMinor = students.rows.filter(s => !s.waived).reduce((n, s) => n + Number(s.amountMinor), 0);
  const amountPaidMinor = students.rows.filter(s => s.paid).reduce((n, s) => n + Number(s.amountMinor), 0);
  return {
    schoolId, ...term, ...policy, ...counts,
    amountDueMinor, amountPaidMinor, outstandingMinor: amountDueMinor - amountPaidMinor,
  };
}

export async function assertSubscriptionAccess(schoolId: number, studentId?: number | null, db: CommunicationQueryClient = pool) {
  // A verified payment or unavailable calendar never bypasses a manual lock.
  await assertManualSchoolUnlocked(db, schoolId);
  // Normal school/teacher/reader operations are NOT auto-locked by students.
  if (studentId == null) return;
  let snapshot: EnforcementSnapshot;
  try { snapshot = await readSchoolSubscription(db, schoolId); }
  catch (error) {
    // Preserve a previously confirmed current-term restriction, without
    // inventing a new restriction from an infrastructure failure.
    logger.error({ schoolId, error }, "Subscription eligibility unavailable; access unchanged");
    try {
      const known = await db.query<{ schoolLocked: boolean; restrictedStudentIds: number[] }>(
        `SELECT e.school_locked AS "schoolLocked",e.restricted_student_ids AS "restrictedStudentIds"
           FROM school_subscription_enforcement e
           JOIN academic_terms t ON t.id=e.academic_term_id AND t.school_id=e.school_id
           JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
          WHERE e.school_id=$1 AND t.is_current=true AND UPPER(t.status)='ACTIVE'
            AND ses.is_current=true AND UPPER(ses.status)='ACTIVE'
            AND (NOW() AT TIME ZONE 'Africa/Lagos')::date BETWEEN t.start_date AND t.end_date`,
        [schoolId],
      );
      if (known.rows.length === 1 && known.rows[0].restrictedStudentIds.includes(studentId)) {
        throw new AuthError(403, "Subscription is required to continue using this feature. Please contact your School Administrator.", "SUBSCRIPTION_REQUIRED");
      }
    } catch (fallbackError) {
      if (fallbackError instanceof AuthError) throw fallbackError;
      logger.error({ schoolId }, "Previously confirmed subscription state also unavailable");
    }
    return;
  }
  if (snapshot && snapshot.restrictedStudentIds.includes(studentId)) {
    throw new AuthError(403, "Subscription is required to continue using this feature. Please contact your School Administrator.", "SUBSCRIPTION_REQUIRED");
  }
}

/** Financial/student status and manual school status stay visibly independent. */
export async function readSchoolEnforcementSummary(db: CommunicationQueryClient, schoolId: number) {
  const school = await db.query<{ schoolName: string; registrationNumber: string }>(
    `SELECT name AS "schoolName",code AS "registrationNumber" FROM schools WHERE id=$1`, [schoolId],
  );
  if (!school.rows[0]) throw new AuthError(404, "School not found");
  const manual = await readManualSchoolState(db, schoolId);
  const snapshot = await readSchoolSubscription(db, schoolId);
  let summary = snapshot
    ? (({ restrictedStudentIds: _ids, today: _today, ...rest }) => rest)(snapshot)
    : { schoolId, state: "UNAVAILABLE", status: "UNAVAILABLE" };
  if (manual.schoolLocked) {
    const students = await db.query<{ id: number }>("SELECT id FROM students WHERE school_id=$1 AND LOWER(status)='active'", [schoolId]);
    summary = { ...summary, ...await readSubscriptionScopeCounts(db, schoolId, students.rows.map(s => s.id), true),
      studentsAffected: students.rows.length } as typeof summary;
  }
  return { ...summary, ...school.rows[0], ...manual };
}

/** Student-only automatic evaluation and verified restoration; manual school control never writes here. */
export async function reconcileSchoolSubscription(
  schoolId: number, source: EnforcementSource, actor?: EnforcementActor, expectedTermId?: number,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7749,$1::integer)", [schoolId]);
    const snapshot = await readSchoolSubscription(client, schoolId);
    if (!snapshot) {
      await client.query("COMMIT");
      return { schoolId, changed: false, state: "UNAVAILABLE", summary: null };
    }
    if (expectedTermId !== undefined && snapshot.termId !== expectedTermId) {
      throw new AuthError(409, "The school's term changed. Refresh and confirm your selection again.");
    }
    const previous = await client.query<{ restrictedStudentIds: number[]; schoolLocked: boolean; version: number }>(
      `SELECT restricted_student_ids AS "restrictedStudentIds",school_locked AS "schoolLocked",version
         FROM school_subscription_enforcement WHERE school_id=$1 AND academic_term_id=$2 FOR UPDATE`,
      [schoolId, snapshot.termId],
    );
    const before = previous.rows[0];
    const oldIds = before?.restrictedStudentIds ?? [];
    const changed = JSON.stringify(oldIds) !== JSON.stringify(snapshot.restrictedStudentIds)
      || Boolean(before?.schoolLocked) !== snapshot.schoolLocked;
    const version = (before?.version ?? 0) + (changed ? 1 : 0);
    await client.query(
      `INSERT INTO school_subscription_enforcement(school_id,academic_term_id,restricted_student_ids,school_locked,version,snapshot)
       VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(school_id,academic_term_id) DO UPDATE
        SET restricted_student_ids=EXCLUDED.restricted_student_ids,school_locked=EXCLUDED.school_locked,
            version=EXCLUDED.version,snapshot=EXCLUDED.snapshot,updated_at=NOW()`,
      [schoolId, snapshot.termId, snapshot.restrictedStudentIds, snapshot.schoolLocked, version, JSON.stringify(snapshot)],
    );
    if (changed) {
      const restored = oldIds.filter(id => !snapshot.restrictedStudentIds.includes(id));
      const newlyLocked = snapshot.restrictedStudentIds.filter(id => !oldIds.includes(id));
      const actionSource = restored.length && !newlyLocked.length && !snapshot.inGracePeriod
        ? "SUBSCRIPTION_PAYMENT_RESTORATION" : source;
      await client.query(
        `INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,severity,event_type,result,metadata)
         VALUES($1,$2,$3,$4,$5,'Term subscription restriction evaluated','Subscriptions',$6,'info','SUBSCRIPTION_ENFORCEMENT','SUCCESS',$7::jsonb)`,
        [actor?.email ?? "Subscription scheduler", actor ? "PLATFORM_OWNER" : "SYSTEM", actor?.id ?? null,
          actor?.clerkUserId ?? null, schoolId, snapshot.termId,
          JSON.stringify({ source: actionSource, termId: snapshot.termId, reason: snapshot.status,
            version, restoredStudentIds: restored, newlyRestrictedStudentIds: newlyLocked, summary: snapshot })],
      );
      for (const studentId of [...new Set([...restored, ...newlyLocked])]) {
        const restricted = snapshot.restrictedStudentIds.includes(studentId);
        await client.query(
          `INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,severity,event_type,result,metadata)
           VALUES($1,$2,$3,$4,$5,'Student subscription access changed','Subscriptions',$6,'info','STUDENT_SUBSCRIPTION_ACCESS_CHANGED','SUCCESS',$7::jsonb)`,
          [actor?.email ?? "Subscription scheduler", actor ? "PLATFORM_OWNER" : "SYSTEM", actor?.id ?? null,
            actor?.clerkUserId ?? null, schoolId, studentId, JSON.stringify({
              studentId, schoolId, termId: snapshot.termId, sessionId: snapshot.sessionId,
              previousState: restricted ? "ACTIVE" : "SUBSCRIPTION_RESTRICTED",
              newState: restricted ? "SUBSCRIPTION_RESTRICTED" : "ACTIVE",
              reason: snapshot.status, source: actionSource,
            })],
        );
      }
      const affected = [...new Set([...restored, ...newlyLocked])];
      const manual = await readManualSchoolState(client, schoolId);
      const recipients = await client.query<{ userId: number; studentId: number | null }>(
        `SELECT DISTINCT p.user_id AS "userId",st.id AS "studentId" FROM parents p
          JOIN parent_student_relationships rel ON rel.parent_id=p.id AND rel.status='ACTIVE'
          JOIN students st ON st.id=rel.student_id AND LOWER(st.status)='active'
          JOIN app_users u ON u.id=p.user_id AND u.status='ACTIVE'
         WHERE st.school_id=$1 AND p.status='ACTIVE' AND st.id=ANY($2::integer[]) AND ${familyChildSchoolScope()}
         UNION SELECT st.user_id,st.id FROM students st JOIN app_users u ON u.id=st.user_id AND u.status='ACTIVE'
            WHERE st.school_id=$1 AND st.id=ANY($2::integer[]) AND LOWER(st.status)='active'
          UNION SELECT r.user_id,NULL::integer FROM school_memberships r JOIN app_users u ON u.id=r.user_id AND u.status='ACTIVE'
            WHERE r.school_id=$1 AND r.role='SCHOOL_ADMIN' AND r.status='ACTIVE'`,
        [schoolId, affected],
      );
      for (const recipient of recipients.rows) {
        const restricted = recipient.studentId != null && snapshot.restrictedStudentIds.includes(recipient.studentId);
        await queueCommunicationNotification(client, {
          recipientUserId: recipient.userId, schoolId, subjectStudentId: recipient.studentId,
          category: "ACCOUNT",
          eventKey: `subscription-enforcement:${schoolId}:${snapshot.termId}:${version}:${recipient.userId}:${recipient.studentId ?? "teacher"}`,
          subject: recipient.studentId == null ? "Student subscription coverage updated"
            : restricted ? "Subscription required" : "Student subscription verified",
          body: recipient.studentId == null
            ? "Current-term student subscription coverage has changed. Review the school's subscription overview. Teacher and reader access is not automatically restricted by individual student nonpayment."
            : restricted
            ? "Some EduCore services are currently restricted because the termly subscription has not been completed. Please contact your School Administrator."
            : manual.schoolLocked
              ? "This student's termly subscription is now verified. The Platform Owner's school lock still applies, together with any other account, card or device restrictions."
              : "This student's termly subscription restriction is removed. Other account, card or device restrictions remain unchanged.",
          link: "/", channels: ["IN_APP", "PUSH", "SMS", "EMAIL"],
        });
      }
    }
    await client.query("COMMIT");
    return { schoolId, changed, state: snapshot.state, summary: snapshot };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function evaluateSubscriptionSchools() {
  const schools = await pool.query<{ id: number }>("SELECT id FROM schools WHERE LOWER(status)='active' ORDER BY id");
  for (const school of schools.rows) {
    try { await reconcileSchoolSubscription(school.id, "AUTOMATIC_TERM_ENFORCEMENT"); }
    catch (error) { logger.error({ schoolId: school.id, error }, "Subscription enforcement failed; transaction rolled back"); }
  }
}