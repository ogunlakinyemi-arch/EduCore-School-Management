import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { STUDENT_SUBSCRIPTION_GROSS_MINOR } from "../lib/student-subscription-billing";
import { queueCommunicationNotification, type CommunicationQueryClient } from "./communication-service";
import { subscriptionPolicy, type SubscriptionStudent } from "./subscription-enforcement-policy";
import { familyChildSchoolScope } from "../lib/family-child-school-scope";

export type EnforcementSource = "AUTOMATIC_TERM_ENFORCEMENT" | "OWNER_MANUAL_LOCK" | "SUBSCRIPTION_PAYMENT_RESTORATION";
export type EnforcementActor = { id: number; clerkUserId: string; email: string };
export type EnforcementSnapshot = Awaited<ReturnType<typeof readSchoolSubscription>>;

export async function readSchoolSubscription(db: CommunicationQueryClient, schoolId: number) {
  const calendar = await db.query<{
    schoolName: string; termId: number; termName: string; startDate: string; endDate: string; today: string;
  }>(
    `SELECT sc.name AS "schoolName",t.id AS "termId",t.name AS "termName",
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
       COALESCE((SELECT round(s.amount*100)::integer FROM subscriptions s
         WHERE s.school_id=st.school_id AND s.student_id=st.id AND s.term=$2
           AND s.expires_at::date=$4::date+1 ORDER BY s.id DESC LIMIT 1),$5::integer) AS "amountMinor"
      FROM students st WHERE st.school_id=$1 AND LOWER(st.status)='active' ORDER BY st.id`,
    [schoolId, term.termName, term.termId, term.endDate, STUDENT_SUBSCRIPTION_GROSS_MINOR],
  );
  const policy = subscriptionPolicy(term, students.rows, term.today);
  const ids = policy.restrictedStudentIds;
  const counts = await db.query<{ cardsLocked: number; teacherCardsLocked: number; devicesLocked: number; teachersAffected: number; parentsAffected: number }>(
    `SELECT
       (SELECT count(*)::integer FROM nfc_cards c WHERE c.school_id=$1 AND c.student_id=ANY($2::integer[]) AND LOWER(c.status)='active') AS "cardsLocked",
       CASE WHEN $3 THEN (SELECT count(*)::integer FROM employee_nfc_card_bindings b JOIN nfc_cards c ON c.id=b.nfc_card_id AND c.school_id=b.school_id
          WHERE b.school_id=$1 AND b.status='ACTIVE' AND LOWER(c.status)='active') ELSE 0 END AS "teacherCardsLocked",
       CASE WHEN $3 THEN (SELECT count(*)::integer FROM platform_devices d WHERE d.school_id=$1 AND UPPER(d.status)='ACTIVE') ELSE 0 END AS "devicesLocked",
       CASE WHEN $3 THEN (SELECT count(DISTINCT r.user_id)::integer FROM school_memberships r WHERE r.school_id=$1 AND r.status='ACTIVE' AND r.role='TEACHER') ELSE 0 END AS "teachersAffected",
       (SELECT count(DISTINCT p.user_id)::integer FROM parents p JOIN parent_student_relationships rel ON rel.parent_id=p.id
          JOIN students st ON st.id=rel.student_id
        WHERE st.school_id=$1 AND p.status='ACTIVE' AND rel.status='ACTIVE' AND st.id=ANY($2::integer[]) AND ${familyChildSchoolScope()}) AS "parentsAffected"`,
    [schoolId, ids, policy.schoolLocked],
  );
  const amountDueMinor = students.rows.filter(s => !s.waived).reduce((n, s) => n + Number(s.amountMinor), 0);
  const amountPaidMinor = students.rows.filter(s => s.paid).reduce((n, s) => n + Number(s.amountMinor), 0);
  return {
    schoolId, ...term, ...policy, ...counts.rows[0],
    amountDueMinor, amountPaidMinor, outstandingMinor: amountDueMinor - amountPaidMinor,
  };
}

export async function assertSubscriptionAccess(schoolId: number, studentId?: number | null, db: CommunicationQueryClient = pool) {
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
      if (known.rows.length === 1 && (studentId == null
        ? known.rows[0].schoolLocked : known.rows[0].restrictedStudentIds.includes(studentId))) {
        throw new AuthError(403, "Subscription is required to continue using this feature. Please contact your School Administrator.", "SUBSCRIPTION_REQUIRED");
      }
    } catch (fallbackError) {
      if (fallbackError instanceof AuthError) throw fallbackError;
      logger.error({ schoolId }, "Previously confirmed subscription state also unavailable");
    }
    return;
  }
  if (snapshot && (studentId == null ? snapshot.schoolLocked : snapshot.restrictedStudentIds.includes(studentId))) {
    throw new AuthError(403, "Subscription is required to continue using this feature. Please contact your School Administrator.", "SUBSCRIPTION_REQUIRED");
  }
}

/** One serialized mechanism for automatic evaluation, confirmed Owner actions, and verified restoration. */
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
      const affected = [...new Set([...restored, ...newlyLocked])];
      const recipients = await client.query<{ userId: number; studentId: number | null }>(
        `SELECT DISTINCT p.user_id AS "userId",st.id AS "studentId" FROM parents p
          JOIN parent_student_relationships rel ON rel.parent_id=p.id AND rel.status='ACTIVE'
          JOIN students st ON st.id=rel.student_id
          JOIN app_users u ON u.id=p.user_id AND u.status='ACTIVE'
         WHERE st.school_id=$1 AND p.status='ACTIVE' AND st.id=ANY($2::integer[]) AND ${familyChildSchoolScope()}
         UNION SELECT st.user_id,st.id FROM students st JOIN app_users u ON u.id=st.user_id AND u.status='ACTIVE'
           WHERE st.school_id=$1 AND st.id=ANY($2::integer[])
         UNION SELECT r.user_id,NULL::integer FROM school_memberships r JOIN app_users u ON u.id=r.user_id AND u.status='ACTIVE'
           WHERE r.school_id=$1 AND r.role='TEACHER' AND r.status='ACTIVE' AND $3::boolean`,
        [schoolId, affected, Boolean(before?.schoolLocked) !== snapshot.schoolLocked],
      );
      for (const recipient of recipients.rows) {
        const restricted = recipient.studentId == null ? snapshot.schoolLocked
          : snapshot.restrictedStudentIds.includes(recipient.studentId);
        await queueCommunicationNotification(client, {
          recipientUserId: recipient.userId, schoolId, subjectStudentId: recipient.studentId,
          category: "ACCOUNT",
          eventKey: `subscription-enforcement:${schoolId}:${snapshot.termId}:${version}:${recipient.userId}:${recipient.studentId ?? "teacher"}`,
          subject: restricted ? "Subscription required" : "Subscription access restored",
          body: restricted
            ? "Some EduCore services are currently restricted because the termly subscription has not been completed. Please contact your School Administrator."
            : "Your termly subscription access is now available. Other account, card, or device restrictions remain unchanged.",
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