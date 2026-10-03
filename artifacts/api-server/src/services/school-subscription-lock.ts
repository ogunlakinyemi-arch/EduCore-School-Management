import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { familyChildSchoolScope } from "../lib/family-child-school-scope";
import { queueCommunicationNotification, type CommunicationQueryClient } from "./communication-service";

export type SchoolLockActor = { id: number; clerkUserId: string; email: string };
export type ManualSchoolState = {
  schoolLocked: boolean; schoolEnforcementStatus: "ACTIVE" | "LOCKED"; manualVersion: number;
  lockedAt: string | null; lockedByUserId: number | null; lockedByName: string | null;
  lastUnlockedAt: string | null; lastUnlockedByUserId: number | null; lastUnlockedByName: string | null;
  reason: string | null;
};

/** Absence is ACTIVE; an infrastructure error is NOT evidence of an unlock. */
export async function readManualSchoolState(db: CommunicationQueryClient, schoolId: number): Promise<ManualSchoolState> {
  const result = await db.query<Omit<ManualSchoolState, "schoolEnforcementStatus">>(
    `SELECT c.locked AS "schoolLocked",c.version AS "manualVersion",
      c.locked_at::text AS "lockedAt",c.locked_by_user_id AS "lockedByUserId",
      NULLIF(trim(concat(l.first_name,' ',l.last_name)),'') AS "lockedByName",
      c.last_unlocked_at::text AS "lastUnlockedAt",c.last_unlocked_by_user_id AS "lastUnlockedByUserId",
      NULLIF(trim(concat(u.first_name,' ',u.last_name)),'') AS "lastUnlockedByName",c.reason
     FROM school_subscription_manual_locks c
     LEFT JOIN app_users l ON l.id=c.locked_by_user_id
     LEFT JOIN app_users u ON u.id=c.last_unlocked_by_user_id WHERE c.school_id=$1`, [schoolId],
  );
  const row = result.rows[0] ?? {
    schoolLocked: false, manualVersion: 0, lockedAt: null, lockedByUserId: null, lockedByName: null,
    lastUnlockedAt: null, lastUnlockedByUserId: null, lastUnlockedByName: null, reason: null,
  };
  return { ...row, schoolEnforcementStatus: row.schoolLocked ? "LOCKED" : "ACTIVE" };
}

export async function assertManualSchoolUnlocked(db: CommunicationQueryClient, schoolId: number) {
  let manual: ManualSchoolState;
  try { manual = await readManualSchoolState(db, schoolId); }
  catch {
    logger.error({ schoolId }, "Manual school restriction could not be determined; no state changed");
    throw new AuthError(503, "Subscription access is temporarily unavailable. Please try again.", "SUBSCRIPTION_STATUS_UNAVAILABLE");
  }
  if (manual.schoolLocked) {
    throw new AuthError(403, "This school is locked by the Platform Owner. Please contact your School Administrator.", "SCHOOL_SUBSCRIPTION_LOCKED");
  }
}

export async function readSubscriptionScopeCounts(db: CommunicationQueryClient, schoolId: number, ids: number[], wholeSchool: boolean) {
  const result = await db.query<{
    cardsLocked: number; teacherCardsLocked: number; devicesLocked: number; teachersAffected: number; parentsAffected: number;
  }>(`SELECT
    (SELECT count(*)::integer FROM nfc_cards c WHERE c.school_id=$1 AND c.student_id=ANY($2::integer[]) AND LOWER(c.status)='active') AS "cardsLocked",
    CASE WHEN $3 THEN (SELECT count(*)::integer FROM employee_nfc_card_bindings b JOIN nfc_cards c ON c.id=b.nfc_card_id AND c.school_id=b.school_id
      WHERE b.school_id=$1 AND b.status='ACTIVE' AND LOWER(c.status)='active') ELSE 0 END AS "teacherCardsLocked",
    CASE WHEN $3 THEN (SELECT count(*)::integer FROM platform_devices d WHERE d.school_id=$1 AND UPPER(d.status)='ACTIVE') ELSE 0 END AS "devicesLocked",
    CASE WHEN $3 THEN (SELECT count(DISTINCT r.user_id)::integer FROM school_memberships r WHERE r.school_id=$1 AND r.status='ACTIVE' AND r.role='TEACHER') ELSE 0 END AS "teachersAffected",
    (SELECT count(DISTINCT p.user_id)::integer FROM parents p JOIN parent_student_relationships rel ON rel.parent_id=p.id
      JOIN students st ON st.id=rel.student_id WHERE st.school_id=$1 AND p.status='ACTIVE' AND rel.status='ACTIVE'
      AND st.id=ANY($2::integer[]) AND ${familyChildSchoolScope()}) AS "parentsAffected"`,
  [schoolId, ids, wholeSchool]);
  return result.rows[0];
}

/** Trusted authenticated Owner only; the HTTP boundary validates that permission.
 * Same advisory key as automatic reconciliation serializes overlapping actions,
 * but this writes only school control, never the automatic student restriction.
 */
export async function changeManualSchoolLock(
  schoolId: number, locked: boolean, actor: SchoolLockActor, expectedVersion: number,
  reason?: string, requestId?: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7749,$1::integer)", [schoolId]);
    const school = await client.query("SELECT id FROM schools WHERE id=$1 AND LOWER(status)='active' FOR SHARE", [schoolId]);
    if (!school.rows[0]) throw new AuthError(409, "A selected school is unavailable. Refresh your selection.");
    const before = await readManualSchoolState(client, schoolId);
    if (before.manualVersion !== expectedVersion) throw new AuthError(409, "The school lock changed. Refresh and confirm again.");
    const changed = before.schoolLocked !== locked;
    const version = before.manualVersion + (changed ? 1 : 0);
    const action = locked ? "SCHOOL_LOCKED" : "SCHOOL_UNLOCKED";
    if (changed) {
      await client.query(
        `INSERT INTO school_subscription_manual_locks(school_id,locked,version,locked_at,locked_by_user_id,last_unlocked_at,last_unlocked_by_user_id,reason)
         VALUES($1,$2,$3,CASE WHEN $2 THEN NOW() END,CASE WHEN $2 THEN $4::integer END,
           CASE WHEN NOT $2 THEN NOW() END,CASE WHEN NOT $2 THEN $4::integer END,$5)
         ON CONFLICT(school_id) DO UPDATE SET locked=EXCLUDED.locked,version=EXCLUDED.version,
           locked_at=CASE WHEN EXCLUDED.locked THEN NOW() ELSE school_subscription_manual_locks.locked_at END,
           locked_by_user_id=CASE WHEN EXCLUDED.locked THEN $4 ELSE school_subscription_manual_locks.locked_by_user_id END,
           last_unlocked_at=CASE WHEN NOT EXCLUDED.locked THEN NOW() ELSE school_subscription_manual_locks.last_unlocked_at END,
           last_unlocked_by_user_id=CASE WHEN NOT EXCLUDED.locked THEN $4 ELSE school_subscription_manual_locks.last_unlocked_by_user_id END,
           reason=EXCLUDED.reason,updated_at=NOW()`,
        [schoolId, locked, version, actor.id, reason?.trim() || null],
      );
    }
    const students = await client.query<{ id: number }>("SELECT id FROM students WHERE school_id=$1 AND LOWER(status)='active'", [schoolId]);
    const ids = students.rows.map(s => s.id);
    const scope = await readSubscriptionScopeCounts(client, schoolId, ids, true);
    // Accepted no-ops are still audited; only real transitions notify users.
    await client.query(
      `INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,severity,event_type,result,metadata)
       VALUES($1,'PLATFORM_OWNER',$2,$3,$4,$5,'Subscriptions',$4,'info',$5,'SUCCESS',$6::jsonb)`,
      [actor.email, actor.id, actor.clerkUserId, schoolId, action, JSON.stringify({
        source: "OWNER_MANUAL_CONTROL", previousState: before.schoolEnforcementStatus,
        newState: locked ? "LOCKED" : "ACTIVE", manualVersion: version, changed,
        reason: reason?.trim() || null, requestId: requestId ?? null,
        affectedScope: { students: ids.length, ...scope },
      })],
    );
    if (changed) {
      const recipients = await client.query<{ userId: number; studentId: number | null }>(
        `SELECT DISTINCT p.user_id AS "userId",st.id AS "studentId" FROM parents p
         JOIN parent_student_relationships rel ON rel.parent_id=p.id AND rel.status='ACTIVE'
         JOIN students st ON st.id=rel.student_id AND LOWER(st.status)='active'
         JOIN app_users u ON u.id=p.user_id AND u.status='ACTIVE'
         WHERE st.school_id=$1 AND p.status='ACTIVE' AND ${familyChildSchoolScope()}
         UNION SELECT st.user_id,st.id FROM students st JOIN app_users u ON u.id=st.user_id AND u.status='ACTIVE'
         WHERE st.school_id=$1 AND LOWER(st.status)='active'
         UNION SELECT r.user_id,NULL::integer FROM school_memberships r JOIN app_users u ON u.id=r.user_id AND u.status='ACTIVE'
         WHERE r.school_id=$1 AND r.status='ACTIVE' AND r.role IN ('SCHOOL_ADMIN','TEACHER')`, [schoolId],
      );
      for (const recipient of recipients.rows) {
        await queueCommunicationNotification(client, {
          recipientUserId: recipient.userId, schoolId, subjectStudentId: recipient.studentId, category: "ACCOUNT",
          eventKey: `school-manual-lock:${schoolId}:${version}:${recipient.userId}:${recipient.studentId ?? "staff"}`,
          subject: locked ? "School subscription services locked" : "School lock removed",
          body: locked
            ? "The Platform Owner has restricted this school's subscription-dependent services. Login, account, payment and inbox access remain available. Please contact your School Administrator."
            : "The Platform Owner has removed the school's manual lock. Unpaid student subscriptions and other account, card or device restrictions still apply.",
          link: "/", channels: ["IN_APP", "PUSH", "SMS", "EMAIL"],
        });
      }
    }
    await client.query("COMMIT");
    return { schoolId, changed, state: locked ? "LOCKED" as const : "ACTIVE" as const, manualVersion: version };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}