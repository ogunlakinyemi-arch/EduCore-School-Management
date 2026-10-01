export const partnerSchoolRegistrationJoins = `
  LEFT JOIN LATERAL (
    SELECT attempt.metadata
    FROM audit_logs attempt
    WHERE attempt.school_id=s.id
      AND attempt.event_type='PARTNER_SCHOOL_REGISTRATION_ATTEMPT'
      AND attempt.metadata->>'source'='PARTNER_DIRECT'
    ORDER BY attempt.timestamp DESC,attempt.id DESC LIMIT 1
  ) school_attempt ON true
  LEFT JOIN LATERAL (
    SELECT ai.id,ai.metadata,
      CASE
        WHEN ai.metadata->>'invitationId' IS NOT NULL
          AND COALESCE(ai.metadata->>'dispatchStatus','REQUEST_ACCEPTED') NOT IN (
            'DISPATCHING','UNKNOWN_PROVIDER_STATE','OUTCOME_UNKNOWN','PROVIDER_REJECTED'
          )
        THEN ai.timestamp ELSE NULL
      END AS "invitationSentAt"
    FROM audit_logs ai
    WHERE ai.school_id=s.id
      AND ai.event_type='SCHOOL_ADMIN_INVITED'
      AND ai.metadata->>'role'='SCHOOL_ADMIN'
      AND ai.metadata->>'superseded' IS DISTINCT FROM 'true'
      AND NOT EXISTS (
        SELECT 1 FROM audit_logs superseded
        WHERE superseded.school_id=ai.school_id
          AND superseded.event_type='SCHOOL_INVITATION_SUPERSEDED'
          AND superseded.metadata->>'supersedesClaimId'=ai.metadata->>'claimId'
      )
    ORDER BY ai.timestamp DESC,ai.id DESC LIMIT 1
  ) school_invite ON true
  LEFT JOIN LATERAL (
    SELECT ua.timestamp AS "acceptedAt"
    FROM audit_logs ua
    WHERE ua.school_id=s.id
      AND ua.event_type='USER_ACTIVATED'
      AND ua.metadata->>'role'='SCHOOL_ADMIN'
      AND ua.metadata->>'claimId'=school_invite.metadata->>'claimId'
    ORDER BY ua.timestamp DESC,ua.id DESC LIMIT 1
  ) selected_accept ON true
  LEFT JOIN LATERAL (
    SELECT u.first_name AS "firstName",u.last_name AS "lastName",
           u.email,u.phone
    FROM school_memberships sm
    JOIN app_users u ON u.id=sm.user_id
    WHERE sm.school_id=s.id AND sm.role='SCHOOL_ADMIN' AND sm.status='ACTIVE'
    ORDER BY sm.created_at DESC,sm.id DESC LIMIT 1
  ) school_admin ON true`;

export function partnerSchoolRegistrationFields(attributionAlias = "a") {
  return `
  COALESCE(
    NULLIF(concat_ws(' ',school_admin."firstName",school_admin."lastName"),''),
    NULLIF(concat_ws(' ',school_invite.metadata->>'firstName',school_invite.metadata->>'lastName'),''),
    NULLIF(school_attempt.metadata->>'administratorName','')
  ) AS "adminName",
  COALESCE(school_admin.email,school_invite.metadata->>'invitedEmail',
           school_attempt.metadata->>'administratorEmail') AS "adminEmail",
  COALESCE(school_admin.phone,school_invite.metadata->>'phone',
           school_attempt.metadata->>'administratorPhone') AS "adminPhone",
  CASE WHEN LOWER(s.status)='active' AND EXISTS (
    SELECT 1 FROM school_memberships active_admin
    WHERE active_admin.school_id=s.id AND active_admin.role='SCHOOL_ADMIN' AND active_admin.status='ACTIVE'
  ) THEN 'ACTIVE' ELSE 'PENDING' END AS "registrationStatus",
  school_invite.metadata->>'invitationId' AS "invitationId",
  CASE
    WHEN selected_accept."acceptedAt" IS NOT NULL THEN 'ACCEPTED'
    WHEN school_invite.metadata->>'invitationId' IS NOT NULL THEN 'PENDING'
    WHEN school_invite.metadata->>'dispatchStatus' IN (
      'DISPATCHING','UNKNOWN_PROVIDER_STATE','OUTCOME_UNKNOWN','REGISTERED_OR_PENDING'
    ) THEN 'UNKNOWN'
    WHEN school_invite.metadata->>'dispatchStatus'='PROVIDER_REJECTED' THEN 'FAILED'
    ELSE NULL
  END AS "invitationStatus",
  school_invite."invitationSentAt",
  selected_accept."acceptedAt",
  ${attributionAlias}.starts_at AS "dateAdded",
  (SELECT COUNT(*)::int FROM students total_students WHERE total_students.school_id=s.id) AS "totalStudents",
  (SELECT CASE WHEN COUNT(*)=0 THEN 'attention'
      WHEN COUNT(*) FILTER (WHERE LOWER(sub.status)='active' AND sub.expires_at>NOW())>0 THEN 'active'
      ELSE 'expired' END
   FROM subscriptions sub WHERE sub.school_id=s.id) AS "subscriptionStatus"`;
}