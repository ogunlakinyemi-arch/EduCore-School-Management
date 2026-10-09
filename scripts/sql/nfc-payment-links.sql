-- Additive link lifecycle; no existing payment, subscription or receipt is altered.
CREATE TABLE nfc_payment_links (
 id serial PRIMARY KEY,
 school_id integer NOT NULL,
 student_id integer NOT NULL,
 subscription_id integer NOT NULL,
 academic_session_id integer NOT NULL,
 academic_term_id integer NOT NULL,
 created_by integer NOT NULL REFERENCES app_users(id),
 reference text NOT NULL UNIQUE,
 token_hash text NOT NULL UNIQUE,
 mode text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING',
 payment_id integer REFERENCES student_subscription_payments(id),
 expected_allocations jsonb NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT NOW(),
 updated_at timestamptz NOT NULL DEFAULT NOW(),
 FOREIGN KEY(subscription_id,school_id,student_id) REFERENCES subscriptions(id,school_id,student_id),
 FOREIGN KEY(school_id,student_id,academic_session_id,academic_term_id)
   REFERENCES student_subscription_terms(school_id,student_id,academic_session_id,academic_term_id),
 CONSTRAINT nfc_payment_links_mode CHECK(mode IN ('DEVELOPMENT_SIMULATION','FLUTTERWAVE_SANDBOX')),
 CONSTRAINT nfc_payment_links_status CHECK(status IN ('PENDING','SIMULATED_SUCCESS','SIMULATED_FAILED','CANCELLED')),
 CONSTRAINT nfc_payment_links_isolation CHECK(
  (mode='DEVELOPMENT_SIMULATION' AND payment_id IS NULL) OR
  (mode='FLUTTERWAVE_SANDBOX' AND payment_id IS NOT NULL AND status IN ('PENDING','CANCELLED'))
 )
);
