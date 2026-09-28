type QueryClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};

/**
 * Enqueue role-scoped notifications using only current, active relationships
 * in the payment's own school. Call from the payment settlement transaction.
 */
export async function enqueueVerifiedFeePaymentNotifications(
  client: QueryClient,
  paymentId: number,
  schoolId: number,
): Promise<number> {
  const inserted = await client.query(
    `WITH target AS (
       SELECT p.id AS payment_id,p.school_id,p.invoice_id,p.student_id
       FROM fee_payments p
       JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
       WHERE p.id=$1 AND p.school_id=$2 AND p.status='VERIFIED'
     ), recipients AS (
       SELECT DISTINCT t.payment_id,t.school_id,t.invoice_id,pa.user_id AS user_id,'PARENT'::text AS role
       FROM target t
       JOIN students st ON st.id=t.student_id AND st.school_id=t.school_id AND LOWER(st.status)='active'
       JOIN parent_student_relationships rel ON rel.student_id=st.id AND rel.status='ACTIVE'
       JOIN parents pa ON pa.id=rel.parent_id AND pa.school_id=t.school_id
         AND pa.status='ACTIVE' AND pa.user_id IS NOT NULL
       JOIN app_users u ON u.id=pa.user_id AND u.status='ACTIVE'
       UNION
       SELECT t.payment_id,t.school_id,t.invoice_id,st.user_id,'STUDENT'::text
       FROM target t
       JOIN students st ON st.id=t.student_id AND st.school_id=t.school_id
         AND LOWER(st.status)='active' AND st.user_id IS NOT NULL
       JOIN app_users u ON u.id=st.user_id AND u.status='ACTIVE'
       UNION
       SELECT t.payment_id,t.school_id,t.invoice_id,m.user_id,m.role
       FROM target t
       JOIN school_memberships m ON m.school_id=t.school_id AND m.status='ACTIVE'
         AND m.role IN ('SCHOOL_ADMIN','ACCOUNTANT')
       JOIN app_users u ON u.id=m.user_id AND u.status='ACTIVE'
     )
     INSERT INTO fee_payment_notifications
       (school_id,payment_id,invoice_id,recipient_user_id,recipient_role,event_type,channel)
     SELECT school_id,payment_id,invoice_id,user_id,role,'PAYMENT_VERIFIED','IN_APP'
     FROM recipients
     ON CONFLICT (payment_id,recipient_user_id,recipient_role,event_type) DO NOTHING
     RETURNING id`,
    [paymentId, schoolId],
  );
  const createdCount = inserted.rowCount ?? inserted.rows.length;
  if (createdCount > 0) {
    await client.query(
      `INSERT INTO audit_logs ("user",role,school_id,action,module,record_id,severity,event_type,result,metadata)
       VALUES ('Finance notification service','SYSTEM',$1,'generated verified-payment notifications',
         'Finance',$2,'info','FEE_PAYMENT_NOTIFICATION','SUCCESS',$3)`,
      [schoolId, paymentId, { createdCount, eventType: "PAYMENT_VERIFIED", channel: "IN_APP" }],
    );
  }
  return createdCount;
}