ALTER TABLE "fee_payment_notifications"
  DROP CONSTRAINT "fee_payment_notifications_event_check",
  ADD CONSTRAINT "fee_payment_notifications_event_check"
    CHECK ("event_type" IN ('PAYMENT_VERIFIED','PAYMENT_REJECTED','REFUND_APPROVED','REVERSAL_APPROVED'));

ALTER TABLE "fee_payment_notifications"
  ADD COLUMN "event_reference_id" integer DEFAULT 0 NOT NULL,
  DROP CONSTRAINT "fee_payment_notifications_delivery_unique",
  ADD CONSTRAINT "fee_payment_notifications_delivery_unique"
    UNIQUE ("payment_id", "recipient_user_id", "recipient_role", "event_type", "event_reference_id"),
  ADD CONSTRAINT "fee_payment_notifications_event_reference_check"
    CHECK (
      ("event_type" IN ('PAYMENT_VERIFIED','PAYMENT_REJECTED') AND "event_reference_id"=0)
      OR ("event_type" IN ('REFUND_APPROVED','REVERSAL_APPROVED') AND "event_reference_id">0)
    );