ALTER TABLE "fee_payment_notifications"
  DROP CONSTRAINT "fee_payment_notifications_event_check",
  ADD CONSTRAINT "fee_payment_notifications_event_check"
    CHECK ("event_type" IN (
      'PAYMENT_VERIFIED','PAYMENT_REJECTED',
      'PROVIDER_CHECKOUT_INITIATED','PROVIDER_CHECKOUT_PROCESSING','PROVIDER_PAYMENT_FAILED',
      'MANUAL_TRANSFER_SUBMITTED','MANUAL_TRANSFER_APPROVED','MANUAL_TRANSFER_REJECTED',
      'REFUND_APPROVED','REVERSAL_APPROVED'
    )),
  DROP CONSTRAINT "fee_payment_notifications_event_reference_check",
  ADD CONSTRAINT "fee_payment_notifications_event_reference_check"
    CHECK (
      ("event_type" IN (
        'PAYMENT_VERIFIED','PAYMENT_REJECTED',
        'PROVIDER_CHECKOUT_INITIATED','PROVIDER_CHECKOUT_PROCESSING','PROVIDER_PAYMENT_FAILED',
        'MANUAL_TRANSFER_SUBMITTED','MANUAL_TRANSFER_APPROVED','MANUAL_TRANSFER_REJECTED'
      ) AND "event_reference_id"=0)
      OR ("event_type" IN ('REFUND_APPROVED','REVERSAL_APPROVED') AND "event_reference_id">0)
    );

ALTER TABLE "fee_payment_notification_outbox"
  DROP CONSTRAINT "fee_payment_notification_outbox_event_check",
  ADD CONSTRAINT "fee_payment_notification_outbox_event_check"
    CHECK (
      ("event_type" IN (
        'PAYMENT_VERIFIED','PAYMENT_REJECTED',
        'PROVIDER_CHECKOUT_INITIATED','PROVIDER_CHECKOUT_PROCESSING','PROVIDER_PAYMENT_FAILED',
        'MANUAL_TRANSFER_SUBMITTED','MANUAL_TRANSFER_APPROVED','MANUAL_TRANSFER_REJECTED'
      ) AND "event_reference_id"=0)
      OR ("event_type" IN ('REFUND_APPROVED','REVERSAL_APPROVED') AND "event_reference_id">0)
    );