type Db={query:(sql:string,values?:any[])=>Promise<{rows:any[]}>};
/** Atomic with consent withdrawal: a claimed row may already be in transport.
 * Hold that uncertainty instead of marking it unsent or allowing later replay. */
export async function withdrawTelegramDeliveries(db:Db,userId:number,scope:{
  teacherOnly?:boolean;category?:string;schoolId?:number|null;preferenceChange?:boolean;
}={}){
  await db.query(`UPDATE communication_deliveries d SET
    status=CASE WHEN d.status='PROCESSING' THEN 'FAILED' ELSE 'CANCELLED' END,
    error_code=CASE WHEN d.status='PROCESSING' THEN 'PROVIDER_OUTCOME_UNKNOWN' ELSE 'TELEGRAM_CONSENT_WITHDRAWN' END,
    last_error=CASE WHEN d.status='PROCESSING'
      THEN 'Consent withdrawn during processing. Provider acceptance must be reconciled; do not resend.'
      ELSE 'Telegram consent withdrawn; this work will not automatically resume.' END,
    updated_at=now()
    FROM communication_notifications n
    WHERE n.id=d.notification_id AND n.recipient_user_id=$1 AND d.channel='TELEGRAM'
      AND d.status IN ('QUEUED','FAILED','PROCESSING')
      AND d.error_code IS DISTINCT FROM 'PROVIDER_OUTCOME_UNKNOWN'
      AND ($2::text IS NULL OR n.category=$2) AND ($3::int IS NULL OR n.school_id=$3)
      ${scope.teacherOnly?"AND n.event_key LIKE 'TEACHER_PERIOD:%'":""}
      ${scope.preferenceChange?`AND (SELECT p.enabled FROM communication_preferences p
        WHERE p.user_id=$1 AND p.category=n.category AND p.channel='TELEGRAM'
          AND (p.school_id=n.school_id OR p.school_id IS NULL)
        ORDER BY CASE WHEN p.school_id=n.school_id THEN 0 ELSE 1 END LIMIT 1)=false`:""}`,
    [userId,scope.category??null,scope.schoolId??null]);
}
