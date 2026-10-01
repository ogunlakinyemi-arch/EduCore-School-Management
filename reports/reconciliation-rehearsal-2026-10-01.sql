-- GENERATED OFFLINE from the checked-in preview and production STRUCTURE-ONLY snapshot.
-- This rehearsal contains no production rows. Synthetic fixture rows use negative IDs and are rolled back.
-- Guardian/class/commission/device repeatability checks below are synthetic fixtures only, not historical-data validation.
-- The transaction is intentionally rollback-only; never change the final ROLLBACK to COMMIT.
-- No migration journal, ledger, or live/public object is modified.

BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE SCHEMA "edupulse_reconciliation_rehearsal";
SET LOCAL search_path = "edupulse_reconciliation_rehearsal", public;

-- Snapshot phase 1/4: all 29 production-structure tables, with no production data.
CREATE TABLE academic_sessions (id serial NOT NULL,school_id integer NOT NULL,name text NOT NULL,start_date date NOT NULL,end_date date NOT NULL,status text DEFAULT 'PLANNED'::text NOT NULL,is_current boolean DEFAULT false NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE academic_terms (id serial NOT NULL,school_id integer NOT NULL,academic_session_id integer NOT NULL,name text NOT NULL,start_date date NOT NULL,end_date date NOT NULL,status text DEFAULT 'PLANNED'::text NOT NULL,is_current boolean DEFAULT false NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE app_users (id serial NOT NULL,clerk_user_id text NOT NULL,email text NOT NULL,first_name text,last_name text,phone text,status text DEFAULT 'ACTIVE'::text NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE audit_logs (id serial NOT NULL,"user" text NOT NULL,role text NOT NULL,school_id integer,action text NOT NULL,module text NOT NULL,record_id integer,"timestamp" timestamp with time zone DEFAULT now() NOT NULL,severity text DEFAULT 'info'::text NOT NULL,actor_user_id integer,clerk_user_id text,event_type text DEFAULT 'APPLICATION_EVENT'::text NOT NULL,result text DEFAULT 'SUCCESS'::text NOT NULL,metadata jsonb);
CREATE TABLE class_subjects (id serial NOT NULL,school_id integer NOT NULL,school_class_id integer NOT NULL,subject_id integer NOT NULL,academic_session_id integer NOT NULL,academic_term_id integer,employee_id integer,section text,status text DEFAULT 'ACTIVE'::text NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE commission_ledger (id serial NOT NULL,partner_profile_id integer NOT NULL,school_id integer NOT NULL,student_id integer NOT NULL,subscription_id integer NOT NULL,commission_rule_id integer NOT NULL,academic_session_id integer,term text NOT NULL,rate numeric(12,4) NOT NULL,count integer DEFAULT 1 NOT NULL,amount numeric(12,2) NOT NULL,currency text DEFAULT 'NGN'::text NOT NULL,status text DEFAULT 'PENDING'::text NOT NULL,payout_id integer,approved_at timestamp with time zone,payable_at timestamp with time zone,paid_at timestamp with time zone,held_at timestamp with time zone,reversed_at timestamp with time zone,cancelled_at timestamp with time zone,payment_reference text,adjustment_reference text,reversal_reference text,created_by integer,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE commission_rules (id serial NOT NULL,name text NOT NULL,status text DEFAULT 'ACTIVE'::text NOT NULL,term text,currency text DEFAULT 'NGN'::text NOT NULL,calculation_basis text DEFAULT 'FIXED'::text NOT NULL,effective_at timestamp with time zone DEFAULT now() NOT NULL,ends_at timestamp with time zone,partner_rate numeric(12,4) DEFAULT '100'::numeric NOT NULL,allocation_total numeric(12,2) DEFAULT '5000'::numeric NOT NULL,partner_amount numeric(12,2) DEFAULT '100'::numeric NOT NULL,school_amount numeric(12,2) DEFAULT '2000'::numeric NOT NULL,edupulse_amount numeric(12,2) DEFAULT '2900'::numeric NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE employees (id serial NOT NULL,school_id integer NOT NULL,user_id integer,employee_no text NOT NULL,first_name text NOT NULL,middle_name text,last_name text NOT NULL,phone text,email text,address text,photo text,gender text,employee_type text DEFAULT 'TEACHER'::text NOT NULL,employment_status text DEFAULT 'ACTIVE'::text NOT NULL,date_employed date,department text,qualification text,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE nfc_cards (id serial NOT NULL,school_id integer NOT NULL,uid text NOT NULL,student_id integer,status text DEFAULT 'unassigned'::text NOT NULL,scans integer DEFAULT 0 NOT NULL,last_scan timestamp with time zone);
CREATE TABLE parent_student_relationships (id serial NOT NULL,parent_id integer NOT NULL,student_id integer NOT NULL,relationship_type text DEFAULT 'Guardian'::text NOT NULL,is_primary_guardian boolean DEFAULT false NOT NULL,is_emergency_contact boolean DEFAULT false NOT NULL,contact_priority integer DEFAULT 1 NOT NULL,status text DEFAULT 'ACTIVE'::text NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE parents (id serial NOT NULL,school_id integer NOT NULL,name text NOT NULL,email text NOT NULL,phone text NOT NULL,user_id integer,address text,status text DEFAULT 'ACTIVE'::text NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE partner_attribution_conflicts (id serial NOT NULL,school_id integer NOT NULL,existing_partner_profile_id integer,attempted_partner_profile_id integer NOT NULL,referral_link_id integer,source text NOT NULL,status text DEFAULT 'OPEN'::text NOT NULL,metadata jsonb,evidence jsonb,resolved_by integer,decision text,resolved_at timestamp with time zone,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE partner_invitations (id serial NOT NULL,partner_profile_id integer NOT NULL,invited_email text NOT NULL,token_hash text NOT NULL,status text DEFAULT 'ACTIVE'::text NOT NULL,expires_at timestamp with time zone,redeemed_at timestamp with time zone,revoked_at timestamp with time zone,created_by integer NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE partner_payout_information (id serial NOT NULL,partner_profile_id integer NOT NULL,method text NOT NULL,bank_name_encrypted text NOT NULL,account_name_encrypted text NOT NULL,account_number_encrypted text NOT NULL,bank_code_encrypted text,account_last4 text NOT NULL,encryption_key_version text NOT NULL,status text DEFAULT 'ACTIVE'::text NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE partner_payouts (id serial NOT NULL,partner_profile_id integer NOT NULL,academic_session_id integer,term text,amount numeric(12,2) NOT NULL,currency text DEFAULT 'NGN'::text NOT NULL,status text DEFAULT 'PENDING'::text NOT NULL,payment_reference text,payment_date timestamp with time zone,method text,notes text,provider text,provider_reference text,period_start timestamp with time zone NOT NULL,period_end timestamp with time zone NOT NULL,paid_at timestamp with time zone,reversed_at timestamp with time zone,reversal_reference text,reversal_reason text,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE partner_profile_users (id serial NOT NULL,partner_profile_id integer NOT NULL,user_id integer NOT NULL,role text DEFAULT 'PARTNER'::text NOT NULL,status text DEFAULT 'ACTIVE'::text NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE partner_profiles (id serial NOT NULL,user_id integer,partner_code text NOT NULL,type text DEFAULT 'RESELLER'::text NOT NULL,full_name text NOT NULL,business_name text,email text NOT NULL,phone text,address text,state text,lga text,registration_number text,status text DEFAULT 'PENDING'::text NOT NULL,invited_at timestamp with time zone,registered_at timestamp with time zone,activated_at timestamp with time zone,deactivated_at timestamp with time zone,created_by integer,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE partner_referral_links (id serial NOT NULL,partner_profile_id integer NOT NULL,token_hash text NOT NULL,status text DEFAULT 'ACTIVE'::text NOT NULL,created_by integer,created_at timestamp with time zone DEFAULT now() NOT NULL,revoked_at timestamp with time zone);
CREATE TABLE platform_devices (id serial NOT NULL,serial_number text NOT NULL,name text NOT NULL,device_type text NOT NULL,school_id integer,status text DEFAULT 'ACTIVE'::text NOT NULL,last_seen_at timestamp with time zone,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE platform_notifications (id serial NOT NULL,recipient_user_id integer,title text NOT NULL,message text NOT NULL,severity text DEFAULT 'info'::text NOT NULL,is_read boolean DEFAULT false NOT NULL,read_at timestamp with time zone,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE school_classes (id serial NOT NULL,school_id integer NOT NULL,name text NOT NULL,section text NOT NULL,class_teacher text,capacity integer DEFAULT 30 NOT NULL);
CREATE TABLE school_memberships (id serial NOT NULL,user_id integer NOT NULL,school_id integer,role text NOT NULL,status text DEFAULT 'ACTIVE'::text NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE school_partner_attributions (id serial NOT NULL,school_id integer NOT NULL,partner_profile_id integer NOT NULL,referral_link_id integer,source text DEFAULT 'REFERRAL_LINK'::text NOT NULL,status text DEFAULT 'ACTIVE'::text NOT NULL,is_current boolean DEFAULT true NOT NULL,starts_at timestamp with time zone DEFAULT now() NOT NULL,ends_at timestamp with time zone,created_by integer,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE schools (id serial NOT NULL,code text NOT NULL,name text NOT NULL,city text NOT NULL,state text NOT NULL,status text DEFAULT 'active'::text NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,registration_number text,address text,lga text,phone text,email text,website text,logo text,school_type text,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE student_class_assignments (id serial NOT NULL,school_id integer NOT NULL,student_id integer NOT NULL,academic_session_id integer NOT NULL,academic_term_id integer,school_class_id integer NOT NULL,section text NOT NULL,status text DEFAULT 'ACTIVE'::text NOT NULL,is_current boolean DEFAULT false NOT NULL,start_date date,end_date date,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE students (id serial NOT NULL,school_id integer NOT NULL,admission_no text NOT NULL,first_name text NOT NULL,last_name text NOT NULL,gender text NOT NULL,class_name text NOT NULL,section text NOT NULL,parent_name text,parent_phone text,status text DEFAULT 'active'::text NOT NULL,joined_at timestamp with time zone DEFAULT now() NOT NULL,user_id integer,middle_name text,date_of_birth date,photo text,admission_date date,admission_status text DEFAULT 'ADMITTED'::text NOT NULL,previous_school text,address text,medical_info text,emergency_contact_name text,emergency_contact_phone text,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE subjects (id serial NOT NULL,school_id integer NOT NULL,name text NOT NULL,code text NOT NULL,description text,status text DEFAULT 'ACTIVE'::text NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE subscriptions (id serial NOT NULL,school_id integer NOT NULL,student_id integer NOT NULL,term text NOT NULL,amount numeric(12,2) DEFAULT '5000'::numeric NOT NULL,school_share numeric(12,2) DEFAULT '2000'::numeric NOT NULL,edupulse_share numeric(12,2) DEFAULT '3000'::numeric NOT NULL,status text DEFAULT 'pending'::text NOT NULL,verification_status text DEFAULT 'pending'::text NOT NULL,provider text DEFAULT 'test'::text NOT NULL,provider_reference text,expires_at timestamp with time zone NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,partner_profile_id integer,partner_share numeric(12,2),allocation_snapshot jsonb);
CREATE TABLE teacher_class_assignments (id serial NOT NULL,school_id integer NOT NULL,employee_id integer NOT NULL,academic_session_id integer NOT NULL,school_class_id integer NOT NULL,subject_id integer,section text NOT NULL,assignment_type text DEFAULT 'CLASS_TEACHER'::text NOT NULL,status text DEFAULT 'ACTIVE'::text NOT NULL,start_date date,end_date date,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);

-- Snapshot phase 2/4: non-FK primary, unique, check, and exclusion constraints.
ALTER TABLE academic_sessions ADD CONSTRAINT academic_sessions_id_school_tenant_key UNIQUE (id, school_id);
ALTER TABLE academic_sessions ADD CONSTRAINT academic_sessions_pkey PRIMARY KEY (id);
ALTER TABLE academic_terms ADD CONSTRAINT academic_terms_id_school_tenant_key UNIQUE (id, school_id);
ALTER TABLE academic_terms ADD CONSTRAINT academic_terms_pkey PRIMARY KEY (id);
ALTER TABLE app_users ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE class_subjects ADD CONSTRAINT class_subjects_pkey PRIMARY KEY (id);
ALTER TABLE commission_ledger ADD CONSTRAINT commission_ledger_amount_nonnegative CHECK (((amount >= (0)::numeric) AND (count > 0)));
ALTER TABLE commission_ledger ADD CONSTRAINT commission_ledger_pkey PRIMARY KEY (id);
ALTER TABLE commission_ledger ADD CONSTRAINT commission_ledger_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'PAYABLE'::text, 'PAID'::text, 'HELD'::text, 'REVERSED'::text, 'CANCELLED'::text])));
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_allocation_integrity CHECK (((partner_amount >= (0)::numeric) AND (school_amount >= (0)::numeric) AND (edupulse_amount >= (0)::numeric) AND (((partner_amount + school_amount) + edupulse_amount) = allocation_total)));
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_pkey PRIMARY KEY (id);
ALTER TABLE employees ADD CONSTRAINT employees_id_school_tenant_key UNIQUE (id, school_id);
ALTER TABLE employees ADD CONSTRAINT employees_pkey PRIMARY KEY (id);
ALTER TABLE nfc_cards ADD CONSTRAINT nfc_cards_id_school_tenant_key UNIQUE (id, school_id);
ALTER TABLE nfc_cards ADD CONSTRAINT nfc_cards_pkey PRIMARY KEY (id);
ALTER TABLE parent_student_relationships ADD CONSTRAINT parent_student_relationships_pkey PRIMARY KEY (id);
ALTER TABLE parents ADD CONSTRAINT parents_pkey PRIMARY KEY (id);
ALTER TABLE partner_attribution_conflicts ADD CONSTRAINT partner_attribution_conflicts_pkey PRIMARY KEY (id);
ALTER TABLE partner_invitations ADD CONSTRAINT partner_invitations_pkey PRIMARY KEY (id);
ALTER TABLE partner_payout_information ADD CONSTRAINT partner_payout_information_pkey PRIMARY KEY (id);
ALTER TABLE partner_payouts ADD CONSTRAINT partner_payouts_amount_nonnegative CHECK ((amount >= (0)::numeric));
ALTER TABLE partner_payouts ADD CONSTRAINT partner_payouts_pkey PRIMARY KEY (id);
ALTER TABLE partner_payouts ADD CONSTRAINT partner_payouts_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'PAID'::text, 'FAILED'::text, 'REVERSED'::text])));
ALTER TABLE partner_profile_users ADD CONSTRAINT partner_profile_users_pkey PRIMARY KEY (id);
ALTER TABLE partner_profiles ADD CONSTRAINT partner_profiles_pkey PRIMARY KEY (id);
ALTER TABLE partner_referral_links ADD CONSTRAINT partner_referral_links_pkey PRIMARY KEY (id);
ALTER TABLE platform_devices ADD CONSTRAINT platform_devices_pkey PRIMARY KEY (id);
ALTER TABLE platform_devices ADD CONSTRAINT platform_devices_serial_number_key UNIQUE (serial_number);
ALTER TABLE platform_devices ADD CONSTRAINT platform_devices_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text, 'MAINTENANCE'::text])));
ALTER TABLE platform_devices ADD CONSTRAINT platform_devices_type_check CHECK ((device_type = ANY (ARRAY['NFC'::text, 'BIOMETRIC'::text, 'HYBRID'::text])));
ALTER TABLE platform_notifications ADD CONSTRAINT platform_notifications_pkey PRIMARY KEY (id);
ALTER TABLE platform_notifications ADD CONSTRAINT platform_notifications_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])));
ALTER TABLE school_classes ADD CONSTRAINT school_classes_id_school_tenant_key UNIQUE (id, school_id);
ALTER TABLE school_classes ADD CONSTRAINT school_classes_pkey PRIMARY KEY (id);
ALTER TABLE school_memberships ADD CONSTRAINT school_memberships_pkey PRIMARY KEY (id);
ALTER TABLE school_partner_attributions ADD CONSTRAINT school_partner_attributions_pkey PRIMARY KEY (id);
ALTER TABLE schools ADD CONSTRAINT schools_pkey PRIMARY KEY (id);
ALTER TABLE student_class_assignments ADD CONSTRAINT student_class_assignments_pkey PRIMARY KEY (id);
ALTER TABLE students ADD CONSTRAINT students_id_school_tenant_key UNIQUE (id, school_id);
ALTER TABLE students ADD CONSTRAINT students_pkey PRIMARY KEY (id);
ALTER TABLE subjects ADD CONSTRAINT subjects_id_school_tenant_key UNIQUE (id, school_id);
ALTER TABLE subjects ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_partner_allocation_integrity CHECK (((partner_profile_id IS NULL) OR ((partner_share IS NOT NULL) AND (amount = ((school_share + edupulse_share) + partner_share)))));
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE teacher_class_assignments ADD CONSTRAINT teacher_class_assignments_pkey PRIMARY KEY (id);

-- Snapshot phase 3/4: all 67 standalone indexes from the structural snapshot, preserved exactly.
CREATE UNIQUE INDEX academic_sessions_school_name_unique ON "edupulse_reconciliation_rehearsal".academic_sessions USING btree (school_id, name);
CREATE INDEX academic_sessions_school_status_idx ON "edupulse_reconciliation_rehearsal".academic_sessions USING btree (school_id, status);
CREATE INDEX academic_terms_school_status_idx ON "edupulse_reconciliation_rehearsal".academic_terms USING btree (school_id, status);
CREATE UNIQUE INDEX academic_terms_session_name_unique ON "edupulse_reconciliation_rehearsal".academic_terms USING btree (academic_session_id, name);
CREATE UNIQUE INDEX app_users_clerk_user_id_unique ON "edupulse_reconciliation_rehearsal".app_users USING btree (clerk_user_id);
CREATE INDEX app_users_email_idx ON "edupulse_reconciliation_rehearsal".app_users USING btree (email);
CREATE INDEX audit_logs_school_idx ON "edupulse_reconciliation_rehearsal".audit_logs USING btree (school_id, "timestamp");
CREATE INDEX class_subjects_school_status_idx ON "edupulse_reconciliation_rehearsal".class_subjects USING btree (school_id, status);
CREATE UNIQUE INDEX class_subjects_unique ON "edupulse_reconciliation_rehearsal".class_subjects USING btree (school_class_id, subject_id, academic_session_id, COALESCE(academic_term_id, 0), COALESCE(section, ''::text)) WHERE (status = 'ACTIVE'::text);
CREATE INDEX commission_ledger_partner_status_idx ON "edupulse_reconciliation_rehearsal".commission_ledger USING btree (partner_profile_id, status);
CREATE UNIQUE INDEX commission_ledger_subscription_period_unique ON "edupulse_reconciliation_rehearsal".commission_ledger USING btree (subscription_id, term);
CREATE INDEX commission_rules_status_term_idx ON "edupulse_reconciliation_rehearsal".commission_rules USING btree (status, term);
CREATE UNIQUE INDEX employees_school_employee_no_unique ON "edupulse_reconciliation_rehearsal".employees USING btree (school_id, employee_no);
CREATE INDEX employees_school_type_status_idx ON "edupulse_reconciliation_rehearsal".employees USING btree (school_id, employee_type, employment_status);
CREATE INDEX nfc_cards_school_idx ON "edupulse_reconciliation_rehearsal".nfc_cards USING btree (school_id);
CREATE UNIQUE INDEX nfc_cards_uid_unique ON "edupulse_reconciliation_rehearsal".nfc_cards USING btree (uid);
CREATE INDEX parent_student_relationship_parent_idx ON "edupulse_reconciliation_rehearsal".parent_student_relationships USING btree (parent_id, status);
CREATE INDEX parent_student_relationship_student_idx ON "edupulse_reconciliation_rehearsal".parent_student_relationships USING btree (student_id, status);
CREATE UNIQUE INDEX parent_student_relationship_unique ON "edupulse_reconciliation_rehearsal".parent_student_relationships USING btree (parent_id, student_id);
CREATE INDEX parents_school_idx ON "edupulse_reconciliation_rehearsal".parents USING btree (school_id);
CREATE UNIQUE INDEX parents_user_unique ON "edupulse_reconciliation_rehearsal".parents USING btree (user_id);
CREATE INDEX partner_attribution_conflicts_attempted_idx ON "edupulse_reconciliation_rehearsal".partner_attribution_conflicts USING btree (attempted_partner_profile_id);
CREATE UNIQUE INDEX partner_attribution_conflicts_open_unique ON "edupulse_reconciliation_rehearsal".partner_attribution_conflicts USING btree (school_id, attempted_partner_profile_id) WHERE (status = 'OPEN'::text);
CREATE INDEX partner_attribution_conflicts_school_status_idx ON "edupulse_reconciliation_rehearsal".partner_attribution_conflicts USING btree (school_id, status);
CREATE INDEX partner_invitations_partner_status_idx ON "edupulse_reconciliation_rehearsal".partner_invitations USING btree (partner_profile_id, status);
CREATE UNIQUE INDEX partner_invitations_token_hash_unique ON "edupulse_reconciliation_rehearsal".partner_invitations USING btree (token_hash);
CREATE UNIQUE INDEX partner_payout_information_partner_unique ON "edupulse_reconciliation_rehearsal".partner_payout_information USING btree (partner_profile_id);
CREATE INDEX partner_payout_information_status_idx ON "edupulse_reconciliation_rehearsal".partner_payout_information USING btree (status);
CREATE INDEX partner_payouts_partner_status_idx ON "edupulse_reconciliation_rehearsal".partner_payouts USING btree (partner_profile_id, status);
CREATE UNIQUE INDEX partner_payouts_provider_reference_unique ON "edupulse_reconciliation_rehearsal".partner_payouts USING btree (provider_reference);
CREATE INDEX partner_profile_users_partner_idx ON "edupulse_reconciliation_rehearsal".partner_profile_users USING btree (partner_profile_id, status);
CREATE UNIQUE INDEX partner_profile_users_unique ON "edupulse_reconciliation_rehearsal".partner_profile_users USING btree (partner_profile_id, user_id);
CREATE UNIQUE INDEX partner_profile_users_user_role_unique ON "edupulse_reconciliation_rehearsal".partner_profile_users USING btree (user_id, role);
CREATE UNIQUE INDEX partner_profiles_code_unique ON "edupulse_reconciliation_rehearsal".partner_profiles USING btree (partner_code);
CREATE INDEX partner_profiles_email_idx ON "edupulse_reconciliation_rehearsal".partner_profiles USING btree (email);
CREATE INDEX partner_profiles_status_idx ON "edupulse_reconciliation_rehearsal".partner_profiles USING btree (status);
CREATE UNIQUE INDEX partner_profiles_user_unique ON "edupulse_reconciliation_rehearsal".partner_profiles USING btree (user_id);
CREATE UNIQUE INDEX partner_referral_links_hash_unique ON "edupulse_reconciliation_rehearsal".partner_referral_links USING btree (token_hash);
CREATE INDEX partner_referral_links_partner_status_idx ON "edupulse_reconciliation_rehearsal".partner_referral_links USING btree (partner_profile_id, status);
CREATE INDEX platform_devices_school_idx ON "edupulse_reconciliation_rehearsal".platform_devices USING btree (school_id, status);
CREATE INDEX platform_notifications_recipient_idx ON "edupulse_reconciliation_rehearsal".platform_notifications USING btree (recipient_user_id, is_read, created_at);
CREATE UNIQUE INDEX school_classes_id_school_unique ON "edupulse_reconciliation_rehearsal".school_classes USING btree (id, school_id);
CREATE UNIQUE INDEX school_classes_unique ON "edupulse_reconciliation_rehearsal".school_classes USING btree (school_id, name, section);
CREATE UNIQUE INDEX school_memberships_platform_role_unique ON "edupulse_reconciliation_rehearsal".school_memberships USING btree (user_id, role) WHERE (school_id IS NULL);
CREATE INDEX school_memberships_school_idx ON "edupulse_reconciliation_rehearsal".school_memberships USING btree (school_id, status);
CREATE INDEX school_memberships_user_idx ON "edupulse_reconciliation_rehearsal".school_memberships USING btree (user_id, status);
CREATE UNIQUE INDEX school_memberships_user_school_role_unique ON "edupulse_reconciliation_rehearsal".school_memberships USING btree (user_id, school_id, role);
CREATE UNIQUE INDEX school_partner_attributions_current_unique ON "edupulse_reconciliation_rehearsal".school_partner_attributions USING btree (school_id) WHERE (is_current = true);
CREATE INDEX school_partner_attributions_partner_idx ON "edupulse_reconciliation_rehearsal".school_partner_attributions USING btree (partner_profile_id, status);
CREATE INDEX school_partner_attributions_school_history_idx ON "edupulse_reconciliation_rehearsal".school_partner_attributions USING btree (school_id, starts_at);
CREATE UNIQUE INDEX schools_code_unique ON "edupulse_reconciliation_rehearsal".schools USING btree (code);
CREATE UNIQUE INDEX student_class_assignments_active_unique ON "edupulse_reconciliation_rehearsal".student_class_assignments USING btree (student_id, academic_session_id, COALESCE(academic_term_id, 0), school_class_id, section) WHERE (status = 'ACTIVE'::text);
CREATE UNIQUE INDEX student_class_assignments_current_unique ON "edupulse_reconciliation_rehearsal".student_class_assignments USING btree (student_id) WHERE (is_current = true);
CREATE UNIQUE INDEX student_class_assignments_id_school_unique ON "edupulse_reconciliation_rehearsal".student_class_assignments USING btree (id, school_id);
CREATE INDEX student_class_assignments_school_current_idx ON "edupulse_reconciliation_rehearsal".student_class_assignments USING btree (school_id, is_current);
CREATE INDEX student_class_assignments_student_history_idx ON "edupulse_reconciliation_rehearsal".student_class_assignments USING btree (student_id, start_date);
CREATE UNIQUE INDEX students_id_school_unique ON "edupulse_reconciliation_rehearsal".students USING btree (id, school_id);
CREATE UNIQUE INDEX students_school_admission_unique ON "edupulse_reconciliation_rehearsal".students USING btree (school_id, admission_no);
CREATE INDEX students_school_idx ON "edupulse_reconciliation_rehearsal".students USING btree (school_id);
CREATE UNIQUE INDEX students_user_unique ON "edupulse_reconciliation_rehearsal".students USING btree (user_id);
CREATE UNIQUE INDEX subjects_school_code_unique ON "edupulse_reconciliation_rehearsal".subjects USING btree (school_id, code);
CREATE INDEX subjects_school_status_idx ON "edupulse_reconciliation_rehearsal".subjects USING btree (school_id, status);
CREATE INDEX subscriptions_partner_profile_idx ON "edupulse_reconciliation_rehearsal".subscriptions USING btree (partner_profile_id);
CREATE UNIQUE INDEX subscriptions_provider_reference_unique ON "edupulse_reconciliation_rehearsal".subscriptions USING btree (provider_reference);
CREATE INDEX subscriptions_school_idx ON "edupulse_reconciliation_rehearsal".subscriptions USING btree (school_id);
CREATE INDEX teacher_class_assignments_school_status_idx ON "edupulse_reconciliation_rehearsal".teacher_class_assignments USING btree (school_id, status);
CREATE UNIQUE INDEX teacher_class_assignments_unique ON "edupulse_reconciliation_rehearsal".teacher_class_assignments USING btree (employee_id, academic_session_id, school_class_id, section, assignment_type, COALESCE(subject_id, 0)) WHERE (status = 'ACTIVE'::text);

-- Snapshot phase 4/4: existing production foreign keys.
ALTER TABLE academic_sessions ADD CONSTRAINT academic_sessions_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE academic_terms ADD CONSTRAINT academic_terms_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE academic_terms ADD CONSTRAINT academic_terms_session_school_fk FOREIGN KEY (academic_session_id, school_id) REFERENCES academic_sessions(id, school_id);
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_user_id_app_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES app_users(id);
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE class_subjects ADD CONSTRAINT class_subjects_class_school_fk FOREIGN KEY (school_class_id, school_id) REFERENCES school_classes(id, school_id);
ALTER TABLE class_subjects ADD CONSTRAINT class_subjects_employee_school_fk FOREIGN KEY (employee_id, school_id) REFERENCES employees(id, school_id);
ALTER TABLE class_subjects ADD CONSTRAINT class_subjects_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE class_subjects ADD CONSTRAINT class_subjects_session_school_fk FOREIGN KEY (academic_session_id, school_id) REFERENCES academic_sessions(id, school_id);
ALTER TABLE class_subjects ADD CONSTRAINT class_subjects_subject_school_fk FOREIGN KEY (subject_id, school_id) REFERENCES subjects(id, school_id);
ALTER TABLE class_subjects ADD CONSTRAINT class_subjects_term_school_fk FOREIGN KEY (academic_term_id, school_id) REFERENCES academic_terms(id, school_id);
ALTER TABLE commission_ledger ADD CONSTRAINT commission_ledger_academic_session_id_academic_sessions_id_fk FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id);
ALTER TABLE commission_ledger ADD CONSTRAINT commission_ledger_commission_rule_id_commission_rules_id_fk FOREIGN KEY (commission_rule_id) REFERENCES commission_rules(id);
ALTER TABLE commission_ledger ADD CONSTRAINT commission_ledger_created_by_app_users_id_fk FOREIGN KEY (created_by) REFERENCES app_users(id);
ALTER TABLE commission_ledger ADD CONSTRAINT commission_ledger_partner_profile_id_partner_profiles_id_fk FOREIGN KEY (partner_profile_id) REFERENCES partner_profiles(id);
ALTER TABLE commission_ledger ADD CONSTRAINT commission_ledger_payout_id_partner_payouts_id_fk FOREIGN KEY (payout_id) REFERENCES partner_payouts(id);
ALTER TABLE commission_ledger ADD CONSTRAINT commission_ledger_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE commission_ledger ADD CONSTRAINT commission_ledger_student_id_students_id_fk FOREIGN KEY (student_id) REFERENCES students(id);
ALTER TABLE commission_ledger ADD CONSTRAINT commission_ledger_subscription_id_subscriptions_id_fk FOREIGN KEY (subscription_id) REFERENCES subscriptions(id);
ALTER TABLE employees ADD CONSTRAINT employees_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE employees ADD CONSTRAINT employees_user_id_app_users_id_fk FOREIGN KEY (user_id) REFERENCES app_users(id);
ALTER TABLE nfc_cards ADD CONSTRAINT nfc_cards_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE nfc_cards ADD CONSTRAINT nfc_cards_student_id_students_id_fk FOREIGN KEY (student_id) REFERENCES students(id);
ALTER TABLE parent_student_relationships ADD CONSTRAINT parent_student_relationships_parent_id_parents_id_fk FOREIGN KEY (parent_id) REFERENCES parents(id);
ALTER TABLE parent_student_relationships ADD CONSTRAINT parent_student_relationships_student_id_students_id_fk FOREIGN KEY (student_id) REFERENCES students(id);
ALTER TABLE parents ADD CONSTRAINT parents_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE parents ADD CONSTRAINT parents_user_id_app_users_id_fk FOREIGN KEY (user_id) REFERENCES app_users(id);
ALTER TABLE partner_attribution_conflicts ADD CONSTRAINT partner_attribution_conflicts_attempted_partner_profile_id_part FOREIGN KEY (attempted_partner_profile_id) REFERENCES partner_profiles(id);
ALTER TABLE partner_attribution_conflicts ADD CONSTRAINT partner_attribution_conflicts_existing_partner_profile_id_partn FOREIGN KEY (existing_partner_profile_id) REFERENCES partner_profiles(id);
ALTER TABLE partner_attribution_conflicts ADD CONSTRAINT partner_attribution_conflicts_referral_link_id_partner_referral FOREIGN KEY (referral_link_id) REFERENCES partner_referral_links(id);
ALTER TABLE partner_attribution_conflicts ADD CONSTRAINT partner_attribution_conflicts_resolved_by_app_users_id_fk FOREIGN KEY (resolved_by) REFERENCES app_users(id);
ALTER TABLE partner_attribution_conflicts ADD CONSTRAINT partner_attribution_conflicts_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE partner_invitations ADD CONSTRAINT partner_invitations_created_by_app_users_id_fk FOREIGN KEY (created_by) REFERENCES app_users(id);
ALTER TABLE partner_invitations ADD CONSTRAINT partner_invitations_partner_profile_id_partner_profiles_id_fk FOREIGN KEY (partner_profile_id) REFERENCES partner_profiles(id);
ALTER TABLE partner_payout_information ADD CONSTRAINT partner_payout_information_partner_profile_id_partner_profiles_ FOREIGN KEY (partner_profile_id) REFERENCES partner_profiles(id);
ALTER TABLE partner_payouts ADD CONSTRAINT partner_payouts_academic_session_id_academic_sessions_id_fk FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id);
ALTER TABLE partner_payouts ADD CONSTRAINT partner_payouts_partner_profile_id_partner_profiles_id_fk FOREIGN KEY (partner_profile_id) REFERENCES partner_profiles(id);
ALTER TABLE partner_profile_users ADD CONSTRAINT partner_profile_users_partner_profile_id_partner_profiles_id_fk FOREIGN KEY (partner_profile_id) REFERENCES partner_profiles(id);
ALTER TABLE partner_profile_users ADD CONSTRAINT partner_profile_users_user_id_app_users_id_fk FOREIGN KEY (user_id) REFERENCES app_users(id);
ALTER TABLE partner_profiles ADD CONSTRAINT partner_profiles_created_by_app_users_id_fk FOREIGN KEY (created_by) REFERENCES app_users(id);
ALTER TABLE partner_profiles ADD CONSTRAINT partner_profiles_user_id_app_users_id_fk FOREIGN KEY (user_id) REFERENCES app_users(id);
ALTER TABLE partner_referral_links ADD CONSTRAINT partner_referral_links_created_by_app_users_id_fk FOREIGN KEY (created_by) REFERENCES app_users(id);
ALTER TABLE partner_referral_links ADD CONSTRAINT partner_referral_links_partner_profile_id_partner_profiles_id_f FOREIGN KEY (partner_profile_id) REFERENCES partner_profiles(id);
ALTER TABLE platform_devices ADD CONSTRAINT platform_devices_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE platform_notifications ADD CONSTRAINT platform_notifications_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES app_users(id);
ALTER TABLE school_classes ADD CONSTRAINT school_classes_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE school_memberships ADD CONSTRAINT school_memberships_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE school_memberships ADD CONSTRAINT school_memberships_user_id_app_users_id_fk FOREIGN KEY (user_id) REFERENCES app_users(id);
ALTER TABLE school_partner_attributions ADD CONSTRAINT school_partner_attributions_created_by_app_users_id_fk FOREIGN KEY (created_by) REFERENCES app_users(id);
ALTER TABLE school_partner_attributions ADD CONSTRAINT school_partner_attributions_partner_profile_id_partner_profiles FOREIGN KEY (partner_profile_id) REFERENCES partner_profiles(id);
ALTER TABLE school_partner_attributions ADD CONSTRAINT school_partner_attributions_referral_link_id_partner_referral_l FOREIGN KEY (referral_link_id) REFERENCES partner_referral_links(id);
ALTER TABLE school_partner_attributions ADD CONSTRAINT school_partner_attributions_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE student_class_assignments ADD CONSTRAINT student_class_assignments_class_school_fk FOREIGN KEY (school_class_id, school_id) REFERENCES school_classes(id, school_id);
ALTER TABLE student_class_assignments ADD CONSTRAINT student_class_assignments_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE student_class_assignments ADD CONSTRAINT student_class_assignments_session_school_fk FOREIGN KEY (academic_session_id, school_id) REFERENCES academic_sessions(id, school_id);
ALTER TABLE student_class_assignments ADD CONSTRAINT student_class_assignments_student_school_fk FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id);
ALTER TABLE student_class_assignments ADD CONSTRAINT student_class_assignments_term_school_fk FOREIGN KEY (academic_term_id, school_id) REFERENCES academic_terms(id, school_id);
ALTER TABLE students ADD CONSTRAINT students_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE students ADD CONSTRAINT students_user_id_app_users_id_fk FOREIGN KEY (user_id) REFERENCES app_users(id);
ALTER TABLE subjects ADD CONSTRAINT subjects_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_partner_profile_id_partner_profiles_id_fk FOREIGN KEY (partner_profile_id) REFERENCES partner_profiles(id);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_student_id_students_id_fk FOREIGN KEY (student_id) REFERENCES students(id);
ALTER TABLE teacher_class_assignments ADD CONSTRAINT teacher_class_assignments_class_school_fk FOREIGN KEY (school_class_id, school_id) REFERENCES school_classes(id, school_id);
ALTER TABLE teacher_class_assignments ADD CONSTRAINT teacher_class_assignments_employee_school_fk FOREIGN KEY (employee_id, school_id) REFERENCES employees(id, school_id);
ALTER TABLE teacher_class_assignments ADD CONSTRAINT teacher_class_assignments_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE teacher_class_assignments ADD CONSTRAINT teacher_class_assignments_session_school_fk FOREIGN KEY (academic_session_id, school_id) REFERENCES academic_sessions(id, school_id);
ALTER TABLE teacher_class_assignments ADD CONSTRAINT teacher_class_assignments_subject_school_fk FOREIGN KEY (subject_id, school_id) REFERENCES subjects(id, school_id);

-- Development-to-production preview: all 410 statements in original order.
-- Original preview statement 001 / 410
CREATE TABLE "fee_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" integer NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_percentage" numeric(5, 2),
	"approved_amount_minor" integer,
	"original_balance_minor" integer,
	"resulting_balance_minor" integer,
	CONSTRAINT "fee_adjustments_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_adjustments_amount_minor_check" CHECK (amount_minor > 0),
	CONSTRAINT "fee_adjustments_approved_amount_check" CHECK ((approved_amount_minor IS NULL) OR (approved_amount_minor > 0)),
	CONSTRAINT "fee_adjustments_balance_check" CHECK ((original_balance_minor IS NULL) OR (original_balance_minor >= 0)),
	CONSTRAINT "fee_adjustments_kind_check" CHECK (kind = ANY (ARRAY['DISCOUNT'::text, 'SCHOLARSHIP'::text, 'WAIVER'::text])),
	CONSTRAINT "fee_adjustments_percentage_check" CHECK ((requested_percentage IS NULL) OR ((requested_percentage > (0)::numeric) AND (requested_percentage <= (100)::numeric))),
	CONSTRAINT "fee_adjustments_resulting_balance_check" CHECK ((resulting_balance_minor IS NULL) OR (resulting_balance_minor >= 0)),
	CONSTRAINT "fee_adjustments_status_check" CHECK (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text]))
);

-- Original preview statement 002 / 410
CREATE TABLE "student_identification_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"policy" text DEFAULT 'NFC_ONLY' NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Original preview statement 003 / 410
CREATE TABLE "device_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"credential_identifier" text NOT NULL,
	"secret_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_credentials_credential_identifier_key" UNIQUE("credential_identifier")
);

-- Original preview statement 004 / 410
CREATE TABLE "attendance_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"entry_window_start" time,
	"entry_window_end" time,
	"exit_window_start" time,
	"exit_window_end" time,
	"classroom_window_start" time,
	"classroom_window_end" time,
	"duplicate_suppression_seconds" integer DEFAULT 30 NOT NULL,
	"notify_on_entry" boolean DEFAULT true NOT NULL,
	"notify_on_exit" boolean DEFAULT true NOT NULL,
	"notify_on_discrepancy" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_settings_school_id_key" UNIQUE("school_id")
);

-- Original preview statement 005 / 410
CREATE TABLE "attendance_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer,
	"employee_id" integer,
	"device_id" integer,
	"nfc_card_id" integer,
	"identification_method" text NOT NULL,
	"event_type" text NOT NULL,
	"result" text NOT NULL,
	"attendance_status" text DEFAULT 'PRESENT' NOT NULL,
	"event_date" date NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"academic_session_id" integer,
	"academic_term_id" integer,
	"school_class_id" integer,
	"class_name_snapshot" text,
	"section_snapshot" text,
	"reason" text,
	"actor_user_id" integer,
	"failure_reason" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_events_id_school_tenant_key" UNIQUE("id","school_id"),
	CONSTRAINT "attendance_events_subject_check" CHECK ((((student_id IS NOT NULL))::integer + ((employee_id IS NOT NULL))::integer) = 1)
);

-- Original preview statement 006 / 410
CREATE TABLE "fee_invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"category_id" integer,
	"category_name_snapshot" text NOT NULL,
	"description_snapshot" text NOT NULL,
	"amount_minor" integer NOT NULL,
	CONSTRAINT "fee_invoice_lines_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_invoice_lines_amount_minor_check" CHECK (amount_minor >= 0)
);

-- Original preview statement 007 / 410
CREATE TABLE "fee_payment_notification_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"event_reference_id" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_payment_notification_outbox_delivery_unique" UNIQUE("payment_id","event_type","event_reference_id"),
	CONSTRAINT "fee_payment_notification_outbox_event_check" CHECK (((event_type = ANY (ARRAY['PAYMENT_VERIFIED'::text, 'PAYMENT_REJECTED'::text, 'PROVIDER_CHECKOUT_INITIATED'::text, 'PROVIDER_CHECKOUT_PROCESSING'::text, 'PROVIDER_PAYMENT_FAILED'::text, 'MANUAL_TRANSFER_SUBMITTED'::text, 'MANUAL_TRANSFER_APPROVED'::text, 'MANUAL_TRANSFER_REJECTED'::text])) AND (event_reference_id = 0)) OR ((event_type = ANY (ARRAY['REFUND_APPROVED'::text, 'REVERSAL_APPROVED'::text])) AND (event_reference_id > 0)))
);

-- Original preview statement 008 / 410
CREATE TABLE "fee_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"receipt_number" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" integer NOT NULL,
	CONSTRAINT "fee_receipts_payment_unique" UNIQUE("payment_id"),
	CONSTRAINT "fee_receipts_school_number_unique" UNIQUE("school_id","receipt_number")
);

-- Original preview statement 009 / 410
CREATE TABLE "fee_invoice_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"recipient_role" text NOT NULL,
	"event_type" text DEFAULT 'INVOICE_GENERATED' NOT NULL,
	"channel" text DEFAULT 'IN_APP' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_invoice_notifications_delivery_unique" UNIQUE("school_id","invoice_id","recipient_user_id","recipient_role","event_type"),
	CONSTRAINT "fee_invoice_notifications_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_invoice_notifications_channel_check" CHECK (channel = 'IN_APP'::text),
	CONSTRAINT "fee_invoice_notifications_event_check" CHECK (event_type = 'INVOICE_GENERATED'::text),
	CONSTRAINT "fee_invoice_notifications_read_check" CHECK (((is_read = false) AND (read_at IS NULL)) OR ((is_read = true) AND (read_at IS NOT NULL))),
	CONSTRAINT "fee_invoice_notifications_role_check" CHECK (recipient_role = ANY (ARRAY['PARENT'::text, 'STUDENT'::text, 'SCHOOL_ADMIN'::text, 'ACCOUNTANT'::text]))
);

-- Original preview statement 010 / 410
CREATE TABLE "attendance_notification_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"attendance_event_id" integer,
	"discrepancy_id" integer,
	"notification_type" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"recipient_user_id" integer,
	"payload" jsonb,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Original preview statement 011 / 410
CREATE TABLE "attendance_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"attendance_event_id" integer NOT NULL,
	"original_value" jsonb NOT NULL,
	"corrected_value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Original preview statement 012 / 410
CREATE TABLE "biometric_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer,
	"employee_id" integer,
	"device_id" integer,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "biometric_enrollments_subject_check" CHECK ((((student_id IS NOT NULL))::integer + ((employee_id IS NOT NULL))::integer) = 1)
);

-- Original preview statement 013 / 410
CREATE TABLE "nfc_card_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"nfc_card_id" integer NOT NULL,
	"student_id" integer,
	"action" text NOT NULL,
	"previous_status" text,
	"new_status" text,
	"replaced_by_card_id" integer,
	"reason" text,
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Original preview statement 014 / 410
CREATE TABLE "attendance_discrepancies" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"attendance_event_id" integer,
	"discrepancy_type" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"details" jsonb,
	"resolved_by" integer,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_discrepancies_id_school_tenant_key" UNIQUE("id","school_id")
);

-- Original preview statement 015 / 410
CREATE TABLE "fee_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"parent_id" integer,
	"structure_id" integer,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"invoice_number" text NOT NULL,
	"student_name_snapshot" text NOT NULL,
	"admission_no_snapshot" text NOT NULL,
	"class_name_snapshot" text NOT NULL,
	"section_snapshot" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"waiver_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer NOT NULL,
	"paid_minor" integer DEFAULT 0 NOT NULL,
	"outstanding_minor" integer NOT NULL,
	"status" text DEFAULT 'UNPAID' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_invoices_assignment_unique" UNIQUE("school_id","student_id","structure_id"),
	CONSTRAINT "fee_invoices_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_invoices_school_number_unique" UNIQUE("school_id","invoice_number"),
	CONSTRAINT "fee_invoices_amounts_check" CHECK ((subtotal_minor >= 0) AND (discount_minor >= 0) AND (waiver_minor >= 0) AND ((discount_minor + waiver_minor) <= subtotal_minor) AND (total_minor = ((subtotal_minor - discount_minor) - waiver_minor)) AND (paid_minor >= 0) AND (paid_minor <= total_minor) AND (outstanding_minor = (total_minor - paid_minor))),
	CONSTRAINT "fee_invoices_status_check" CHECK (status = ANY (ARRAY['UNPAID'::text, 'PARTIALLY_PAID'::text, 'PAID'::text, 'OVERDUE'::text, 'WAIVED'::text, 'CANCELLED'::text]))
);

-- Original preview statement 016 / 410
CREATE TABLE "academic_report_card_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"report_card_id" integer NOT NULL,
	"result_id" integer NOT NULL,
	"subject_id" integer NOT NULL,
	"subject_name_snapshot" text NOT NULL,
	"assessment_name_snapshot" text NOT NULL,
	"score" numeric(10, 2) NOT NULL,
	"max_score" numeric(10, 2) NOT NULL,
	"grade" text NOT NULL,
	"grade_point" numeric(5, 2) NOT NULL,
	"remark" text NOT NULL,
	CONSTRAINT "academic_report_card_lines_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_report_card_lines_report_card_result_unique" UNIQUE("report_card_id","result_id"),
	CONSTRAINT "academic_report_card_lines_score_check" CHECK ((score >= (0)::numeric) AND (max_score > (0)::numeric) AND (score <= max_score))
);

-- Original preview statement 017 / 410
CREATE TABLE "academic_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"section" text,
	"subject_id" integer NOT NULL,
	"assessment_type_id" integer NOT NULL,
	"teacher_employee_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"assessment_date" date NOT NULL,
	"max_score" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_assessments_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_assessments_max_score_check" CHECK (max_score > (0)::numeric),
	CONSTRAINT "academic_assessments_status_check" CHECK (status = ANY (ARRAY['DRAFT'::text, 'OPEN'::text, 'CLOSED'::text, 'PUBLISHED'::text, 'ARCHIVED'::text]))
);

-- Original preview statement 018 / 410
CREATE TABLE "device_assignment_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"previous_school_id" integer,
	"previous_location" text,
	"location" text,
	"action" text NOT NULL,
	"reason" text,
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"new_school_id" integer
);

-- Original preview statement 019 / 410
CREATE TABLE "fee_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"parent_id" integer,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"method" text NOT NULL,
	"provider" text DEFAULT 'MANUAL_BANK_TRANSFER' NOT NULL,
	"provider_transaction_id" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"transfer_bank" text,
	"transfer_reference" text,
	"transfer_date" date,
	"proof_url" text,
	"submitted_by" integer NOT NULL,
	"verified_by" integer,
	"verified_at" timestamp with time zone,
	"verification_evidence_ref" text,
	"reviewer_notes" text,
	"verification_metadata" jsonb,
	"rejection_reason" text,
	"provider_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_payments_id_invoice_school_unique" UNIQUE("id","invoice_id","school_id"),
	CONSTRAINT "fee_payments_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_payments_provider_tx_unique" UNIQUE("provider","provider_transaction_id"),
	CONSTRAINT "fee_payments_reference_key" UNIQUE("reference"),
	CONSTRAINT "fee_payments_school_idempotency_unique" UNIQUE("school_id","idempotency_key"),
	CONSTRAINT "fee_payments_amount_currency_check" CHECK ((amount_minor > 0) AND (currency ~ '^[A-Z]{3}$'::text)),
	CONSTRAINT "fee_payments_bank_transfer_details_check" CHECK ((method <> 'BANK_TRANSFER'::text) OR ((COALESCE(length(btrim(transfer_bank)), 0) >= 2) AND (COALESCE(length(btrim(transfer_reference)), 0) >= 2) AND (transfer_date IS NOT NULL))),
	CONSTRAINT "fee_payments_method_check" CHECK (method = ANY (ARRAY['BANK_TRANSFER'::text, 'REMITA'::text, 'FLUTTERWAVE'::text, 'PAYSTACK'::text])),
	CONSTRAINT "fee_payments_rejection_reason_check" CHECK ((status <> 'REJECTED'::text) OR (NULLIF(btrim(rejection_reason), ''::text) IS NOT NULL)),
	CONSTRAINT "fee_payments_status_check" CHECK (status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'VERIFIED'::text, 'FAILED'::text, 'REJECTED'::text, 'CANCELLED'::text, 'REVERSED'::text, 'REFUNDED'::text])),
	CONSTRAINT "fee_payments_verification_evidence_length_check" CHECK ((method <> 'BANK_TRANSFER'::text) OR (status <> 'VERIFIED'::text) OR ((length(btrim(verification_evidence_ref)) >= 3) AND (length(btrim(reviewer_notes)) >= 3))),
	CONSTRAINT "fee_payments_verified_evidence_check" CHECK ((method <> 'BANK_TRANSFER'::text) OR (status <> 'VERIFIED'::text) OR ((verified_by IS NOT NULL) AND (verified_at IS NOT NULL) AND (NULLIF(btrim(verification_evidence_ref), ''::text) IS NOT NULL) AND (NULLIF(btrim(reviewer_notes), ''::text) IS NOT NULL) AND (verification_metadata IS NOT NULL)))
);

-- Original preview statement 020 / 410
CREATE TABLE "academic_report_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"student_class_assignment_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"class_name_snapshot" text NOT NULL,
	"section_snapshot" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"teacher_remark" text NOT NULL,
	"school_remark" text NOT NULL,
	"published_by" integer,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_report_cards_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_report_cards_student_session_term_unique" UNIQUE("student_id","academic_session_id","academic_term_id"),
	CONSTRAINT "academic_report_cards_publication_check" CHECK (((status = 'PUBLISHED'::text) AND (published_by IS NOT NULL) AND (published_at IS NOT NULL)) OR (status <> 'PUBLISHED'::text)),
	CONSTRAINT "academic_report_cards_status_check" CHECK (status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'ARCHIVED'::text]))
);

-- Original preview statement 021 / 410
CREATE TABLE "fee_refunds" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" integer NOT NULL,
	"approved_by" integer,
	"evidence_reference" text,
	"reviewer_notes" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transaction_type" text DEFAULT 'REFUND' NOT NULL,
	CONSTRAINT "fee_refunds_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_refunds_reference_unique" UNIQUE("reference"),
	CONSTRAINT "fee_refunds_school_idempotency_unique" UNIQUE("school_id","idempotency_key"),
	CONSTRAINT "fee_refunds_amount_check" CHECK ((amount_minor > 0) AND (currency ~ '^[A-Z]{3}$'::text)),
	CONSTRAINT "fee_refunds_approval_evidence_check" CHECK ((status <> 'APPROVED'::text) OR ((approved_by IS NOT NULL) AND (approved_at IS NOT NULL) AND (NULLIF(btrim(evidence_reference), ''::text) IS NOT NULL) AND (NULLIF(btrim(reviewer_notes), ''::text) IS NOT NULL))),
	CONSTRAINT "fee_refunds_status_check" CHECK (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])),
	CONSTRAINT "fee_refunds_transaction_type_check" CHECK (transaction_type = ANY (ARRAY['REFUND'::text, 'REVERSAL'::text]))
);

-- Original preview statement 022 / 410
CREATE TABLE "academic_grading_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"min_score" numeric(10, 2) NOT NULL,
	"max_score" numeric(10, 2) NOT NULL,
	"grade" text NOT NULL,
	"grade_point" numeric(5, 2),
	"remark" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_grading_rules_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_grading_rules_score_range_check" CHECK ((min_score >= (0)::numeric) AND (max_score >= min_score)),
	CONSTRAINT "academic_grading_rules_status_check" CHECK (status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text, 'ARCHIVED'::text]))
);

-- Original preview statement 023 / 410
CREATE TABLE "communication_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" integer NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"provider_message_id" text,
	"provider_acknowledged_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error_code" text,
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_deliveries_notification_channel_unique" UNIQUE("notification_id","channel"),
	CONSTRAINT "communication_deliveries_attempts_check" CHECK (attempts >= 0),
	CONSTRAINT "communication_deliveries_channel_check" CHECK (channel = ANY (ARRAY['IN_APP'::text, 'SMS'::text, 'EMAIL'::text, 'PUSH'::text])),
	CONSTRAINT "communication_deliveries_delivered_status_check" CHECK ((delivered_at IS NULL) OR (status = ANY (ARRAY['DELIVERED'::text, 'READ'::text]))),
	CONSTRAINT "communication_deliveries_provider_ack_channel_check" CHECK ((provider_acknowledged_at IS NULL) OR (channel <> 'IN_APP'::text)),
	CONSTRAINT "communication_deliveries_status_check" CHECK (status = ANY (ARRAY['QUEUED'::text, 'PROCESSING'::text, 'SENT'::text, 'DELIVERED'::text, 'READ'::text, 'FAILED'::text, 'CANCELLED'::text]))
);

-- Original preview statement 024 / 410
CREATE TABLE "fee_provider_webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payment_id" integer,
	"school_id" integer,
	"provider_reference" text,
	"webhook_transaction_id" text,
	"verified_transaction_id" text,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"payload_sha256" text NOT NULL,
	"error_message" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "fee_provider_webhook_events_provider_event_unique" UNIQUE("provider","event_id"),
	CONSTRAINT "fee_provider_webhook_events_provider_check" CHECK (provider = ANY (ARRAY['PAYSTACK'::text, 'FLUTTERWAVE'::text])),
	CONSTRAINT "fee_provider_webhook_events_signature_link_check" CHECK ((payment_id IS NULL) OR ((school_id IS NOT NULL) AND (signature_verified OR (verified_transaction_id IS NOT NULL)))),
	CONSTRAINT "fee_provider_webhook_events_status_check" CHECK (status = ANY (ARRAY['RECEIVED'::text, 'VERIFIED'::text, 'PENDING'::text, 'FAILED'::text, 'RECONCILIATION_REQUIRED'::text]))
);

-- Original preview statement 025 / 410
CREATE TABLE "fee_structures" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"section" text,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" integer NOT NULL,
	"published_by" integer,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_structures_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_structures_status_check" CHECK (status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'INACTIVE'::text]))
);

-- Original preview statement 026 / 410
CREATE TABLE "academic_timetable_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"section" text NOT NULL,
	"subject_id" integer NOT NULL,
	"teacher_employee_id" integer NOT NULL,
	"weekday" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"room" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_timetable_entries_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_timetable_entries_status_check" CHECK (status = ANY (ARRAY['ACTIVE'::text, 'CANCELLED'::text, 'ARCHIVED'::text])),
	CONSTRAINT "academic_timetable_entries_time_check" CHECK (end_time > start_time),
	CONSTRAINT "academic_timetable_entries_weekday_check" CHECK (weekday = ANY (ARRAY['MONDAY'::text, 'TUESDAY'::text, 'WEDNESDAY'::text, 'THURSDAY'::text, 'FRIDAY'::text, 'SATURDAY'::text, 'SUNDAY'::text]))
);

-- Original preview statement 027 / 410
CREATE TABLE "communication_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"school_id" integer,
	"sender_user_id" integer,
	"category" text NOT NULL,
	"event_key" text,
	"subject" text,
	"body" text NOT NULL,
	"link" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject_student_id" integer,
	"subject_class_id" integer,
	CONSTRAINT "communication_notifications_id_school_recipient_unique" UNIQUE("id","school_id","recipient_user_id"),
	CONSTRAINT "communication_notifications_category_check" CHECK (category = ANY (ARRAY['ATTENDANCE'::text, 'ACADEMIC'::text, 'ASSIGNMENT'::text, 'FINANCE'::text, 'PAYMENT'::text, 'ANNOUNCEMENT'::text, 'ACCOUNT'::text, 'SYSTEM'::text, 'SUBSCRIPTION'::text, 'PARTNER'::text, 'SECURITY'::text])),
	CONSTRAINT "communication_notifications_read_check" CHECK (((is_read = false) AND (read_at IS NULL)) OR ((is_read = true) AND (read_at IS NOT NULL))),
	CONSTRAINT "communication_notifications_subject_class_school_check" CHECK ((subject_class_id IS NULL) OR (school_id IS NOT NULL)),
	CONSTRAINT "communication_notifications_subject_student_school_check" CHECK ((subject_student_id IS NULL) OR (school_id IS NOT NULL))
);

-- Original preview statement 028 / 410
CREATE TABLE "academic_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"section" text,
	"subject_id" integer NOT NULL,
	"teacher_employee_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"max_score" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_assignments_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_assignments_dates_check" CHECK (due_date >= issue_date),
	CONSTRAINT "academic_assignments_max_score_check" CHECK (max_score > (0)::numeric),
	CONSTRAINT "academic_assignments_status_check" CHECK (status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'CLOSED'::text, 'ARCHIVED'::text]))
);

-- Original preview statement 029 / 410
CREATE TABLE "platform_company_employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"job_title" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_company_employees_status_check" CHECK (status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text]))
);

-- Original preview statement 030 / 410
CREATE TABLE "academic_assessment_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	CONSTRAINT "academic_assessment_types_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_assessment_types_school_code_unique" UNIQUE("school_id","code"),
	CONSTRAINT "academic_assessment_types_status_check" CHECK (status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text, 'ARCHIVED'::text]))
);

-- Original preview statement 031 / 410
CREATE TABLE "fee_provider_checkout_sessions" (
	"payment_id" integer PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" text DEFAULT 'INITIALIZING' NOT NULL,
	"claim_token" text,
	"claim_expires_at" timestamp with time zone,
	"checkout_url" text,
	"provider_session_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_provider_checkout_sessions_reference_key" UNIQUE("reference"),
	CONSTRAINT "fee_provider_checkout_sessions_school_provider_idem_unique" UNIQUE("school_id","provider","idempotency_key"),
	CONSTRAINT "fee_provider_checkout_sessions_attempts_check" CHECK (attempt_count > 0),
	CONSTRAINT "fee_provider_checkout_sessions_claim_pair_check" CHECK ((claim_token IS NULL) = (claim_expires_at IS NULL)),
	CONSTRAINT "fee_provider_checkout_sessions_provider_check" CHECK (provider = ANY (ARRAY['PAYSTACK'::text, 'FLUTTERWAVE'::text])),
	CONSTRAINT "fee_provider_checkout_sessions_ready_url_check" CHECK ((state <> 'READY'::text) OR (checkout_url IS NOT NULL)),
	CONSTRAINT "fee_provider_checkout_sessions_state_check" CHECK (state = ANY (ARRAY['INITIALIZING'::text, 'READY'::text, 'FAILED'::text, 'SETTLED'::text, 'RELEASED'::text]))
);

-- Original preview statement 032 / 410
CREATE TABLE "fee_payment_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"recipient_role" text NOT NULL,
	"event_type" text DEFAULT 'PAYMENT_VERIFIED' NOT NULL,
	"channel" text DEFAULT 'IN_APP' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_reference_id" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "fee_payment_notifications_delivery_unique" UNIQUE("payment_id","recipient_user_id","recipient_role","event_type","event_reference_id"),
	CONSTRAINT "fee_payment_notifications_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_payment_notifications_channel_check" CHECK (channel = 'IN_APP'::text),
	CONSTRAINT "fee_payment_notifications_event_check" CHECK (event_type = ANY (ARRAY['PAYMENT_VERIFIED'::text, 'PAYMENT_REJECTED'::text, 'PROVIDER_CHECKOUT_INITIATED'::text, 'PROVIDER_CHECKOUT_PROCESSING'::text, 'PROVIDER_PAYMENT_FAILED'::text, 'MANUAL_TRANSFER_SUBMITTED'::text, 'MANUAL_TRANSFER_APPROVED'::text, 'MANUAL_TRANSFER_REJECTED'::text, 'REFUND_APPROVED'::text, 'REVERSAL_APPROVED'::text])),
	CONSTRAINT "fee_payment_notifications_event_reference_check" CHECK (((event_type = ANY (ARRAY['PAYMENT_VERIFIED'::text, 'PAYMENT_REJECTED'::text, 'PROVIDER_CHECKOUT_INITIATED'::text, 'PROVIDER_CHECKOUT_PROCESSING'::text, 'PROVIDER_PAYMENT_FAILED'::text, 'MANUAL_TRANSFER_SUBMITTED'::text, 'MANUAL_TRANSFER_APPROVED'::text, 'MANUAL_TRANSFER_REJECTED'::text])) AND (event_reference_id = 0)) OR ((event_type = ANY (ARRAY['REFUND_APPROVED'::text, 'REVERSAL_APPROVED'::text])) AND (event_reference_id > 0))),
	CONSTRAINT "fee_payment_notifications_read_check" CHECK (((is_read = false) AND (read_at IS NULL)) OR ((is_read = true) AND (read_at IS NOT NULL))),
	CONSTRAINT "fee_payment_notifications_role_check" CHECK (recipient_role = ANY (ARRAY['PARENT'::text, 'STUDENT'::text, 'SCHOOL_ADMIN'::text, 'ACCOUNTANT'::text]))
);

-- Original preview statement 033 / 410
CREATE TABLE "fee_school_settings" (
	"school_id" integer PRIMARY KEY NOT NULL,
	"partial_payments_enabled" boolean DEFAULT false NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bank_transfer_enabled" boolean DEFAULT false NOT NULL,
	"bank_name" text,
	"bank_account_name" text,
	"bank_account_number" text,
	"paystack_enabled" boolean DEFAULT false NOT NULL,
	"flutterwave_enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "fee_school_settings_bank_account_fields_check" CHECK (((bank_name IS NULL) OR ((COALESCE(length(btrim(bank_name)), 0) >= 2) AND (COALESCE(length(btrim(bank_name)), 0) <= 100))) AND ((bank_account_name IS NULL) OR ((COALESCE(length(btrim(bank_account_name)), 0) >= 2) AND (COALESCE(length(btrim(bank_account_name)), 0) <= 150))) AND ((bank_account_number IS NULL) OR (bank_account_number ~ '^[0-9]{10}$'::text)) AND ((NOT bank_transfer_enabled) OR ((bank_name IS NOT NULL) AND (bank_account_name IS NOT NULL) AND (bank_account_number IS NOT NULL))))
);

-- Original preview statement 034 / 410
CREATE TABLE "communication_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"template_key" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"allowed_variables" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_templates_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "communication_templates_school_key_channel_unique" UNIQUE("school_id","template_key","channel"),
	CONSTRAINT "communication_templates_category_check" CHECK (category = ANY (ARRAY['ATTENDANCE'::text, 'ACADEMIC'::text, 'ASSIGNMENT'::text, 'FINANCE'::text, 'PAYMENT'::text, 'ANNOUNCEMENT'::text, 'ACCOUNT'::text, 'SYSTEM'::text, 'SUBSCRIPTION'::text, 'PARTNER'::text, 'SECURITY'::text])),
	CONSTRAINT "communication_templates_channel_check" CHECK (channel = ANY (ARRAY['IN_APP'::text, 'SMS'::text, 'EMAIL'::text, 'PUSH'::text])),
	CONSTRAINT "communication_templates_variables_check" CHECK (allowed_variables <@ ARRAY['student_name'::text, 'parent_name'::text, 'school_name'::text, 'class_name'::text, 'amount'::text, 'invoice_number'::text, 'payment_date'::text, 'attendance_date'::text, 'term_name'::text, 'assignment_title'::text])
);

-- Original preview statement 035 / 410
CREATE TABLE "fee_invoice_notification_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"event_type" text DEFAULT 'INVOICE_GENERATED' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_invoice_notification_outbox_delivery_unique" UNIQUE("school_id","invoice_id","event_type"),
	CONSTRAINT "fee_invoice_notification_outbox_attempts_check" CHECK (attempts >= 0),
	CONSTRAINT "fee_invoice_notification_outbox_event_check" CHECK (event_type = 'INVOICE_GENERATED'::text)
);

-- Original preview statement 036 / 410
CREATE TABLE "communication_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"template_id" integer,
	"idempotency_key" text,
	"title" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"category" text DEFAULT 'ANNOUNCEMENT' NOT NULL,
	"target_type" text NOT NULL,
	"target_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channels" text[] NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_campaigns_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "communication_campaigns_category_check" CHECK (category = ANY (ARRAY['ATTENDANCE'::text, 'ACADEMIC'::text, 'ASSIGNMENT'::text, 'FINANCE'::text, 'PAYMENT'::text, 'ANNOUNCEMENT'::text, 'ACCOUNT'::text, 'SYSTEM'::text, 'SUBSCRIPTION'::text, 'PARTNER'::text, 'SECURITY'::text])),
	CONSTRAINT "communication_campaigns_channels_check" CHECK ((cardinality(channels) > 0) AND (channels <@ ARRAY['IN_APP'::text, 'SMS'::text, 'EMAIL'::text, 'PUSH'::text])),
	CONSTRAINT "communication_campaigns_recipient_count_check" CHECK (recipient_count >= 0),
	CONSTRAINT "communication_campaigns_status_check" CHECK (status = ANY (ARRAY['DRAFT'::text, 'QUEUED'::text, 'SENDING'::text, 'SENT'::text, 'FAILED'::text, 'CANCELLED'::text])),
	CONSTRAINT "communication_campaigns_target_criteria_check" CHECK (jsonb_typeof(target_criteria) = 'object'::text),
	CONSTRAINT "communication_campaigns_target_type_check" CHECK (target_type = ANY (ARRAY['SCHOOL'::text, 'PARENTS'::text, 'STUDENTS'::text, 'TEACHERS'::text, 'STAFF'::text, 'CLASS'::text, 'SECTION'::text, 'USERS'::text]))
);

-- Original preview statement 037 / 410
CREATE TABLE "academic_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"assessment_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"student_class_assignment_id" integer NOT NULL,
	"teacher_employee_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"section_snapshot" text NOT NULL,
	"subject_id" integer NOT NULL,
	"score" numeric(10, 2) NOT NULL,
	"max_score" numeric(10, 2) NOT NULL,
	"grade" text,
	"grade_point" numeric(5, 2),
	"remark" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" integer NOT NULL,
	"published_by" integer,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_results_assessment_student_unique" UNIQUE("assessment_id","student_id"),
	CONSTRAINT "academic_results_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_results_publication_check" CHECK (((status = 'PUBLISHED'::text) AND (published_by IS NOT NULL) AND (published_at IS NOT NULL)) OR (status <> 'PUBLISHED'::text)),
	CONSTRAINT "academic_results_score_check" CHECK ((score >= (0)::numeric) AND (max_score > (0)::numeric) AND (score <= max_score)),
	CONSTRAINT "academic_results_status_check" CHECK (status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED'::text, 'PUBLISHED'::text, 'ARCHIVED'::text]))
);

-- Original preview statement 038 / 410
CREATE TABLE "communication_campaign_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"school_id" integer NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"notification_id" integer,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "communication_campaign_recipients_campaign_user_unique" UNIQUE("campaign_id","recipient_user_id"),
	CONSTRAINT "communication_campaign_recipients_status_check" CHECK (status = ANY (ARRAY['QUEUED'::text, 'SENT'::text, 'FAILED'::text, 'SKIPPED'::text]))
);

-- Original preview statement 039 / 410
CREATE TABLE "fee_structure_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"structure_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"category_name_snapshot" text NOT NULL,
	"description_snapshot" text NOT NULL,
	"amount_minor" integer NOT NULL,
	CONSTRAINT "fee_structure_lines_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_structure_lines_structure_category_unique" UNIQUE("structure_id","category_id"),
	CONSTRAINT "fee_structure_lines_amount_minor_check" CHECK (amount_minor > 0)
);

-- Original preview statement 040 / 410
CREATE TABLE "library_book_copies" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"copy_code" text NOT NULL,
	"barcode" text,
	"condition" text DEFAULT 'GOOD' NOT NULL,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"location" text,
	"acquired_on" date,
	"acquisition_reference" text,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_book_copies_school_book_id_unique" UNIQUE("school_id","book_id","id"),
	CONSTRAINT "library_book_copies_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_book_copies_condition_check" CHECK (condition = ANY (ARRAY['NEW'::text, 'GOOD'::text, 'FAIR'::text, 'POOR'::text])),
	CONSTRAINT "library_book_copies_copy_code_check" CHECK ((length(btrim(copy_code)) >= 1) AND (length(btrim(copy_code)) <= 100)),
	CONSTRAINT "library_book_copies_status_check" CHECK (status = ANY (ARRAY['AVAILABLE'::text, 'BORROWED'::text, 'RESERVED'::text, 'LOST'::text, 'DAMAGED'::text, 'MAINTENANCE'::text, 'RETIRED'::text]))
);

-- Original preview statement 041 / 410
CREATE TABLE "library_authors" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"reference" text,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_authors_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_authors_name_check" CHECK ((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 200))
);

-- Original preview statement 042 / 410
CREATE TABLE "library_publishers" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"reference" text,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_publishers_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_publishers_name_check" CHECK ((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 200))
);

-- Original preview statement 043 / 410
CREATE TABLE "fee_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"compulsory" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_categories_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_categories_school_name_unique" UNIQUE("school_id","name"),
	CONSTRAINT "fee_categories_status_check" CHECK (status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text]))
);

-- Original preview statement 044 / 410
CREATE TABLE "library_books" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"isbn" text,
	"author_id" integer,
	"publisher_id" integer,
	"category_id" integer,
	"publication_year" integer,
	"edition" text,
	"subject" text,
	"description" text,
	"cover_reference" text,
	"language" text DEFAULT 'English' NOT NULL,
	"shelf_location" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_books_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_books_publication_year_check" CHECK ((publication_year IS NULL) OR ((publication_year >= 1000) AND (publication_year <= 2200))),
	CONSTRAINT "library_books_status_check" CHECK (status = ANY (ARRAY['ACTIVE'::text, 'ARCHIVED'::text])),
	CONSTRAINT "library_books_title_check" CHECK ((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 300))
);

-- Original preview statement 045 / 410
CREATE TABLE "school_facilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"facility_type" text NOT NULL,
	"location" text,
	"condition" text DEFAULT 'GOOD' NOT NULL,
	"capacity" integer,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_facilities_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "school_facilities_capacity_check" CHECK ((capacity IS NULL) OR (capacity >= 0)),
	CONSTRAINT "school_facilities_condition_check" CHECK (condition = ANY (ARRAY['NEW'::text, 'GOOD'::text, 'FAIR'::text, 'POOR'::text, 'DAMAGED'::text])),
	CONSTRAINT "school_facilities_status_check" CHECK (status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text, 'MAINTENANCE'::text, 'RETIRED'::text]))
);

-- Original preview statement 046 / 410
CREATE TABLE "communication_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"school_id" integer,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_preferences_category_check" CHECK (category = ANY (ARRAY['ATTENDANCE'::text, 'ACADEMIC'::text, 'ASSIGNMENT'::text, 'FINANCE'::text, 'PAYMENT'::text, 'ANNOUNCEMENT'::text, 'ACCOUNT'::text, 'SYSTEM'::text, 'SUBSCRIPTION'::text, 'PARTNER'::text, 'SECURITY'::text])),
	CONSTRAINT "communication_preferences_channel_check" CHECK (channel = ANY (ARRAY['IN_APP'::text, 'SMS'::text, 'EMAIL'::text, 'PUSH'::text]))
);

-- Original preview statement 047 / 410
CREATE TABLE "communication_push_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"school_id" integer,
	"provider" text DEFAULT 'WEB_PUSH' NOT NULL,
	"opaque_device_reference" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "communication_push_devices_provider_check" CHECK (provider = 'WEB_PUSH'::text),
	CONSTRAINT "communication_push_devices_reference_check" CHECK ((length(btrim(opaque_device_reference)) >= 1) AND (length(btrim(opaque_device_reference)) <= 256)),
	CONSTRAINT "communication_push_devices_status_check" CHECK (((status = 'ACTIVE'::text) AND (revoked_at IS NULL)) OR ((status = 'REVOKED'::text) AND (revoked_at IS NOT NULL)))
);

-- Original preview statement 048 / 410
CREATE TABLE "school_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"category_id" integer,
	"category_type" text DEFAULT 'ASSET' NOT NULL,
	"asset_code" text,
	"name" text NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit" text DEFAULT 'item' NOT NULL,
	"location" text,
	"condition" text DEFAULT 'GOOD' NOT NULL,
	"assigned_to_user_id" integer,
	"acquired_on" date,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"notes" text,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_assets_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "school_assets_category_type_check" CHECK (category_type = 'ASSET'::text),
	CONSTRAINT "school_assets_condition_check" CHECK (condition = ANY (ARRAY['NEW'::text, 'GOOD'::text, 'FAIR'::text, 'POOR'::text, 'DAMAGED'::text])),
	CONSTRAINT "school_assets_quantity_check" CHECK (quantity >= 0),
	CONSTRAINT "school_assets_status_check" CHECK (status = ANY (ARRAY['ACTIVE'::text, 'AVAILABLE'::text, 'ASSIGNED'::text, 'MAINTENANCE'::text, 'DAMAGED'::text, 'LOST'::text, 'RETIRED'::text]))
);

-- Original preview statement 049 / 410
CREATE TABLE "library_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"copy_id" integer NOT NULL,
	"borrower_type" text NOT NULL,
	"borrower_user_id" integer NOT NULL,
	"borrower_student_id" integer,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_on" date NOT NULL,
	"returned_at" timestamp with time zone,
	"returned_overdue" boolean,
	"days_overdue_at_return" integer,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"issued_by_user_id" integer NOT NULL,
	"returned_by_user_id" integer,
	"renewal_count" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_loans_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_loans_borrower_student_check" CHECK (((borrower_type = 'STUDENT'::text) AND (borrower_student_id IS NOT NULL)) OR ((borrower_type = ANY (ARRAY['TEACHER'::text, 'STAFF'::text])) AND (borrower_student_id IS NULL))),
	CONSTRAINT "library_loans_borrower_type_check" CHECK (borrower_type = ANY (ARRAY['STUDENT'::text, 'TEACHER'::text, 'STAFF'::text])),
	CONSTRAINT "library_loans_days_overdue_check" CHECK ((days_overdue_at_return IS NULL) OR (days_overdue_at_return >= 0)),
	CONSTRAINT "library_loans_renewal_count_check" CHECK (renewal_count >= 0),
	CONSTRAINT "library_loans_returned_state_check" CHECK (((status = 'RETURNED'::text) AND (returned_at IS NOT NULL) AND (returned_by_user_id IS NOT NULL) AND (returned_overdue IS NOT NULL) AND (days_overdue_at_return IS NOT NULL)) OR ((status <> 'RETURNED'::text) AND (returned_at IS NULL) AND (returned_by_user_id IS NULL) AND (returned_overdue IS NULL) AND (days_overdue_at_return IS NULL))),
	CONSTRAINT "library_loans_status_check" CHECK (status = ANY (ARRAY['OPEN'::text, 'RETURNED'::text, 'LOST'::text]))
);

-- Original preview statement 050 / 410
CREATE TABLE "library_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_categories_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_categories_name_check" CHECK ((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 100))
);

-- Original preview statement 051 / 410
CREATE TABLE "library_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"can_manage_catalogue" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"assigned_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_staff_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_staff_school_user_unique" UNIQUE("school_id","user_id")
);

-- Original preview statement 052 / 410
CREATE TABLE "library_renewals" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"loan_id" integer NOT NULL,
	"renewed_by_user_id" integer NOT NULL,
	"previous_due_on" date NOT NULL,
	"new_due_on" date NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_renewals_school_loan_key_unique" UNIQUE("school_id","loan_id","idempotency_key")
);

-- Original preview statement 053 / 410
CREATE TABLE "school_operations_settings" (
	"school_id" integer PRIMARY KEY NOT NULL,
	"default_maintenance_priority" text DEFAULT 'MEDIUM' NOT NULL,
	"default_task_priority" text DEFAULT 'MEDIUM' NOT NULL,
	"staff_can_report_maintenance" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_operations_default_maintenance_priority_check" CHECK (default_maintenance_priority = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'URGENT'::text])),
	CONSTRAINT "school_operations_default_task_priority_check" CHECK (default_task_priority = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'URGENT'::text]))
);

-- Original preview statement 054 / 410
CREATE TABLE "maintenance_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"category_id" integer,
	"category_type" text DEFAULT 'MAINTENANCE' NOT NULL,
	"asset_id" integer,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"reported_by_user_id" integer NOT NULL,
	"assigned_to_user_id" integer,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_on" date,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_requests_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "maintenance_requests_category_type_check" CHECK (category_type = 'MAINTENANCE'::text),
	CONSTRAINT "maintenance_requests_priority_check" CHECK (priority = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'URGENT'::text])),
	CONSTRAINT "maintenance_requests_status_check" CHECK (status = ANY (ARRAY['OPEN'::text, 'ASSIGNED'::text, 'IN_PROGRESS'::text, 'ON_HOLD'::text, 'COMPLETED'::text, 'CANCELLED'::text]))
);

-- Original preview statement 055 / 410
CREATE TABLE "operational_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"category_id" integer,
	"category_type" text DEFAULT 'TASK' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assigned_to_user_id" integer,
	"created_by_user_id" integer NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"due_on" date,
	"notes" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_tasks_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "operational_tasks_category_type_check" CHECK (category_type = 'TASK'::text),
	CONSTRAINT "operational_tasks_priority_check" CHECK (priority = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'URGENT'::text])),
	CONSTRAINT "operational_tasks_status_check" CHECK (status = ANY (ARRAY['OPEN'::text, 'ASSIGNED'::text, 'IN_PROGRESS'::text, 'ON_HOLD'::text, 'COMPLETED'::text, 'CANCELLED'::text]))
);

-- Original preview statement 056 / 410
CREATE TABLE "library_settings" (
	"school_id" integer PRIMARY KEY NOT NULL,
	"student_borrowing_enabled" boolean DEFAULT true NOT NULL,
	"teacher_borrowing_enabled" boolean DEFAULT false NOT NULL,
	"staff_borrowing_enabled" boolean DEFAULT false NOT NULL,
	"max_books_per_student" integer DEFAULT 3 NOT NULL,
	"max_books_per_teacher" integer DEFAULT 5 NOT NULL,
	"max_books_per_staff" integer DEFAULT 5 NOT NULL,
	"student_loan_days" integer DEFAULT 14 NOT NULL,
	"teacher_loan_days" integer DEFAULT 30 NOT NULL,
	"staff_loan_days" integer DEFAULT 30 NOT NULL,
	"max_renewals" integer DEFAULT 1 NOT NULL,
	"renewal_requires_not_overdue" boolean DEFAULT true NOT NULL,
	"fines_enabled" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_settings_fines_disabled_check" CHECK (fines_enabled = false),
	CONSTRAINT "library_settings_renewals_check" CHECK ((max_renewals >= 0) AND (max_renewals <= 20)),
	CONSTRAINT "library_settings_staff_days_check" CHECK ((staff_loan_days >= 1) AND (staff_loan_days <= 180)),
	CONSTRAINT "library_settings_staff_limit_check" CHECK ((max_books_per_staff >= 1) AND (max_books_per_staff <= 50)),
	CONSTRAINT "library_settings_student_days_check" CHECK ((student_loan_days >= 1) AND (student_loan_days <= 180)),
	CONSTRAINT "library_settings_student_limit_check" CHECK ((max_books_per_student >= 1) AND (max_books_per_student <= 50)),
	CONSTRAINT "library_settings_teacher_days_check" CHECK ((teacher_loan_days >= 1) AND (teacher_loan_days <= 180)),
	CONSTRAINT "library_settings_teacher_limit_check" CHECK ((max_books_per_teacher >= 1) AND (max_books_per_teacher <= 50))
);

-- Original preview statement 057 / 410
CREATE TABLE "library_copy_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"copy_id" integer NOT NULL,
	"loan_id" integer,
	"previous_status" text NOT NULL,
	"new_status" text NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"changed_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_copy_status_history_new_status_check" CHECK (new_status = ANY (ARRAY['AVAILABLE'::text, 'BORROWED'::text, 'RESERVED'::text, 'LOST'::text, 'DAMAGED'::text, 'MAINTENANCE'::text, 'RETIRED'::text])),
	CONSTRAINT "library_copy_status_history_reason_check" CHECK ((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500))
);

-- Original preview statement 058 / 410
CREATE TABLE "maintenance_request_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"maintenance_request_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_request_status_history_status_check" CHECK (((from_status IS NULL) OR (from_status = ANY (ARRAY['OPEN'::text, 'ASSIGNED'::text, 'IN_PROGRESS'::text, 'ON_HOLD'::text, 'COMPLETED'::text, 'CANCELLED'::text]))) AND (to_status = ANY (ARRAY['OPEN'::text, 'ASSIGNED'::text, 'IN_PROGRESS'::text, 'ON_HOLD'::text, 'COMPLETED'::text, 'CANCELLED'::text])))
);

-- Original preview statement 059 / 410
CREATE TABLE "school_operation_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"category_type" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_operation_categories_id_school_type_key" UNIQUE("id","school_id","category_type"),
	CONSTRAINT "school_operation_categories_type_check" CHECK (category_type = ANY (ARRAY['ASSET'::text, 'MAINTENANCE'::text, 'TASK'::text]))
);

-- Original preview statement 060 / 410
CREATE TABLE "operational_task_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_task_status_history_status_check" CHECK (((from_status IS NULL) OR (from_status = ANY (ARRAY['OPEN'::text, 'ASSIGNED'::text, 'IN_PROGRESS'::text, 'ON_HOLD'::text, 'COMPLETED'::text, 'CANCELLED'::text]))) AND (to_status = ANY (ARRAY['OPEN'::text, 'ASSIGNED'::text, 'IN_PROGRESS'::text, 'ON_HOLD'::text, 'COMPLETED'::text, 'CANCELLED'::text])))
);

-- Original preview statement 061 / 410
CREATE TABLE "school_asset_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"quantity_before" integer,
	"quantity_after" integer,
	"assigned_to_before_user_id" integer,
	"assigned_to_after_user_id" integer,
	"status_before" text,
	"status_after" text,
	"actor_user_id" integer NOT NULL,
	"event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "school_asset_history_event_type_check" CHECK (event_type = ANY (ARRAY['CREATED'::text, 'QUANTITY_CHANGED'::text, 'ASSIGNMENT_CHANGED'::text, 'STATUS_CHANGED'::text, 'UPDATED'::text])),
	CONSTRAINT "school_asset_history_quantity_check" CHECK (((quantity_before IS NULL) OR (quantity_before >= 0)) AND ((quantity_after IS NULL) OR (quantity_after >= 0))),
	CONSTRAINT "school_asset_history_status_check" CHECK (((status_before IS NULL) OR (status_before = ANY (ARRAY['ACTIVE'::text, 'AVAILABLE'::text, 'ASSIGNED'::text, 'MAINTENANCE'::text, 'DAMAGED'::text, 'LOST'::text, 'RETIRED'::text]))) AND ((status_after IS NULL) OR (status_after = ANY (ARRAY['ACTIVE'::text, 'AVAILABLE'::text, 'ASSIGNED'::text, 'MAINTENANCE'::text, 'DAMAGED'::text, 'LOST'::text, 'RETIRED'::text]))))
);

-- Original preview statement 062 / 410
CREATE TABLE "device_school_bindings" (
	"device_id" integer NOT NULL,
	"school_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_school_bindings_pkey" PRIMARY KEY("device_id","school_id")
);

-- Original preview statement 063 / 410
ALTER TABLE "platform_devices" DROP CONSTRAINT "platform_devices_status_check";

-- Original preview statement 064 / 410
ALTER TABLE "nfc_cards" ADD COLUMN "issued_at" timestamp with time zone;

-- Original preview statement 065 / 410
ALTER TABLE "nfc_cards" ADD COLUMN "activated_at" timestamp with time zone;

-- Original preview statement 066 / 410
ALTER TABLE "nfc_cards" ADD COLUMN "deactivated_at" timestamp with time zone;

-- Original preview statement 067 / 410
ALTER TABLE "nfc_cards" ADD COLUMN "expires_at" timestamp with time zone;

-- Original preview statement 068 / 410
ALTER TABLE "nfc_cards" ADD COLUMN "replaced_at" timestamp with time zone;

-- Original preview statement 069 / 410
ALTER TABLE "nfc_cards" ADD COLUMN "replaced_by_card_id" integer;

-- Original preview statement 070 / 410
ALTER TABLE "nfc_cards" ADD COLUMN "replaced_by_school_id" integer;

-- Original preview statement 071 / 410
ALTER TABLE "nfc_cards" ADD COLUMN "last_device_id" integer;

-- Original preview statement 072 / 410
ALTER TABLE "platform_devices" ADD COLUMN "location" text;

-- Original preview statement 073 / 410
ALTER TABLE "platform_devices" ADD COLUMN "school_class_id" integer;

-- Original preview statement 074 / 410
ALTER TABLE "platform_devices" ADD COLUMN "configuration_status" text DEFAULT 'PENDING' NOT NULL;

-- Original preview statement 075 / 410
ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 076 / 410
ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 077 / 410
ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 078 / 410
ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 079 / 410
ALTER TABLE "student_identification_policies" ADD CONSTRAINT "student_identification_policies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 080 / 410
ALTER TABLE "student_identification_policies" ADD CONSTRAINT "student_identification_policies_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 081 / 410
ALTER TABLE "student_identification_policies" ADD CONSTRAINT "student_identification_policies_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 082 / 410
ALTER TABLE "student_identification_policies" ADD CONSTRAINT "student_identification_policies_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 083 / 410
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "edupulse_reconciliation_rehearsal"."platform_devices"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 084 / 410
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 085 / 410
ALTER TABLE "attendance_settings" ADD CONSTRAINT "attendance_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 086 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_academic_session_id_fkey" FOREIGN KEY ("academic_session_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 087 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_academic_term_id_fkey" FOREIGN KEY ("academic_term_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_terms"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 088 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 089 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 090 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "edupulse_reconciliation_rehearsal"."platform_devices"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 091 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_device_school_fk" FOREIGN KEY ("device_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."device_school_bindings"("device_id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 092 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "edupulse_reconciliation_rehearsal"."employees"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 093 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 094 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_nfc_card_id_fkey" FOREIGN KEY ("nfc_card_id") REFERENCES "edupulse_reconciliation_rehearsal"."nfc_cards"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 095 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_school_class_id_fkey" FOREIGN KEY ("school_class_id") REFERENCES "edupulse_reconciliation_rehearsal"."school_classes"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 096 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 097 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 098 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 099 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 100 / 410
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 101 / 410
ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "fee_invoice_lines_category_school_fk" FOREIGN KEY ("category_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_categories"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 102 / 410
ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "fee_invoice_lines_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 103 / 410
ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "fee_invoice_lines_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 104 / 410
ALTER TABLE "fee_payment_notification_outbox" ADD CONSTRAINT "fee_payment_notification_outbox_payment_invoice_school_fk" FOREIGN KEY ("payment_id","invoice_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_payments"("id","invoice_id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 105 / 410
ALTER TABLE "fee_payment_notification_outbox" ADD CONSTRAINT "fee_payment_notification_outbox_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 106 / 410
ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_payment_invoice_school_fk" FOREIGN KEY ("payment_id","invoice_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_payments"("id","invoice_id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 107 / 410
ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_payment_school_fk" FOREIGN KEY ("payment_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_payments"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 108 / 410
ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 109 / 410
ALTER TABLE "fee_invoice_notifications" ADD CONSTRAINT "fee_invoice_notifications_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 110 / 410
ALTER TABLE "fee_invoice_notifications" ADD CONSTRAINT "fee_invoice_notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 111 / 410
ALTER TABLE "fee_invoice_notifications" ADD CONSTRAINT "fee_invoice_notifications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 112 / 410
ALTER TABLE "attendance_notification_events" ADD CONSTRAINT "attendance_notification_events_attendance_event_id_fkey" FOREIGN KEY ("attendance_event_id") REFERENCES "edupulse_reconciliation_rehearsal"."attendance_events"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 113 / 410
ALTER TABLE "attendance_notification_events" ADD CONSTRAINT "attendance_notification_events_discrepancy_id_fkey" FOREIGN KEY ("discrepancy_id") REFERENCES "edupulse_reconciliation_rehearsal"."attendance_discrepancies"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 114 / 410
ALTER TABLE "attendance_notification_events" ADD CONSTRAINT "attendance_notification_events_discrepancy_school_fk" FOREIGN KEY ("discrepancy_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."attendance_discrepancies"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 115 / 410
ALTER TABLE "attendance_notification_events" ADD CONSTRAINT "attendance_notification_events_event_school_fk" FOREIGN KEY ("attendance_event_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."attendance_events"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 116 / 410
ALTER TABLE "attendance_notification_events" ADD CONSTRAINT "attendance_notification_events_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 117 / 410
ALTER TABLE "attendance_notification_events" ADD CONSTRAINT "attendance_notification_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 118 / 410
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 119 / 410
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_attendance_event_id_fkey" FOREIGN KEY ("attendance_event_id") REFERENCES "edupulse_reconciliation_rehearsal"."attendance_events"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 120 / 410
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_event_school_fk" FOREIGN KEY ("attendance_event_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."attendance_events"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 121 / 410
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 122 / 410
ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "edupulse_reconciliation_rehearsal"."platform_devices"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 123 / 410
ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_device_school_fk" FOREIGN KEY ("device_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."device_school_bindings"("device_id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 124 / 410
ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "edupulse_reconciliation_rehearsal"."employees"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 125 / 410
ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 126 / 410
ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 127 / 410
ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 128 / 410
ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 129 / 410
ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 130 / 410
ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_card_school_fk" FOREIGN KEY ("nfc_card_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."nfc_cards"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 131 / 410
ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_nfc_card_id_fkey" FOREIGN KEY ("nfc_card_id") REFERENCES "edupulse_reconciliation_rehearsal"."nfc_cards"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 132 / 410
ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_replaced_by_card_id_fkey" FOREIGN KEY ("replaced_by_card_id") REFERENCES "edupulse_reconciliation_rehearsal"."nfc_cards"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 133 / 410
ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 134 / 410
ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 135 / 410
ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 136 / 410
ALTER TABLE "attendance_discrepancies" ADD CONSTRAINT "attendance_discrepancies_attendance_event_id_fkey" FOREIGN KEY ("attendance_event_id") REFERENCES "edupulse_reconciliation_rehearsal"."attendance_events"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 137 / 410
ALTER TABLE "attendance_discrepancies" ADD CONSTRAINT "attendance_discrepancies_event_school_fk" FOREIGN KEY ("attendance_event_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."attendance_events"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 138 / 410
ALTER TABLE "attendance_discrepancies" ADD CONSTRAINT "attendance_discrepancies_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 139 / 410
ALTER TABLE "attendance_discrepancies" ADD CONSTRAINT "attendance_discrepancies_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 140 / 410
ALTER TABLE "attendance_discrepancies" ADD CONSTRAINT "attendance_discrepancies_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 141 / 410
ALTER TABLE "attendance_discrepancies" ADD CONSTRAINT "attendance_discrepancies_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 142 / 410
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 143 / 410
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 144 / 410
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 145 / 410
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_structure_school_fk" FOREIGN KEY ("structure_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_structures"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 146 / 410
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 147 / 410
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 148 / 410
ALTER TABLE "academic_report_card_lines" ADD CONSTRAINT "academic_report_card_lines_report_card_school_fk" FOREIGN KEY ("report_card_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_report_cards"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 149 / 410
ALTER TABLE "academic_report_card_lines" ADD CONSTRAINT "academic_report_card_lines_result_school_fk" FOREIGN KEY ("result_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_results"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 150 / 410
ALTER TABLE "academic_report_card_lines" ADD CONSTRAINT "academic_report_card_lines_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 151 / 410
ALTER TABLE "academic_report_card_lines" ADD CONSTRAINT "academic_report_card_lines_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 152 / 410
ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 153 / 410
ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 154 / 410
ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 155 / 410
ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 156 / 410
ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 157 / 410
ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_teacher_school_fk" FOREIGN KEY ("teacher_employee_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 158 / 410
ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 159 / 410
ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_type_school_fk" FOREIGN KEY ("assessment_type_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_assessment_types"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 160 / 410
ALTER TABLE "device_assignment_history" ADD CONSTRAINT "device_assignment_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 161 / 410
ALTER TABLE "device_assignment_history" ADD CONSTRAINT "device_assignment_history_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "edupulse_reconciliation_rehearsal"."platform_devices"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 162 / 410
ALTER TABLE "device_assignment_history" ADD CONSTRAINT "device_assignment_history_new_school_id_fkey" FOREIGN KEY ("new_school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 163 / 410
ALTER TABLE "device_assignment_history" ADD CONSTRAINT "device_assignment_history_previous_school_id_fkey" FOREIGN KEY ("previous_school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 164 / 410
ALTER TABLE "device_assignment_history" ADD CONSTRAINT "device_assignment_history_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 165 / 410
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 166 / 410
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 167 / 410
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 168 / 410
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 169 / 410
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 170 / 410
ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_class_assignment_school_fk" FOREIGN KEY ("student_class_assignment_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."student_class_assignments"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 171 / 410
ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 172 / 410
ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 173 / 410
ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 174 / 410
ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 175 / 410
ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 176 / 410
ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 177 / 410
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 178 / 410
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_payment_invoice_school_fk" FOREIGN KEY ("payment_id","invoice_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_payments"("id","invoice_id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 179 / 410
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 180 / 410
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 181 / 410
ALTER TABLE "academic_grading_rules" ADD CONSTRAINT "academic_grading_rules_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 182 / 410
ALTER TABLE "communication_deliveries" ADD CONSTRAINT "communication_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "edupulse_reconciliation_rehearsal"."communication_notifications"("id") ON DELETE cascade ON UPDATE no action;

-- Original preview statement 183 / 410
ALTER TABLE "fee_provider_webhook_events" ADD CONSTRAINT "fee_provider_webhook_events_payment_school_fk" FOREIGN KEY ("payment_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_payments"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 184 / 410
ALTER TABLE "fee_provider_webhook_events" ADD CONSTRAINT "fee_provider_webhook_events_school_fk" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 185 / 410
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 186 / 410
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 187 / 410
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 188 / 410
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 189 / 410
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 190 / 410
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 191 / 410
ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 192 / 410
ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 193 / 410
ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 194 / 410
ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 195 / 410
ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 196 / 410
ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_teacher_school_fk" FOREIGN KEY ("teacher_employee_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 197 / 410
ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 198 / 410
ALTER TABLE "communication_notifications" ADD CONSTRAINT "communication_notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 199 / 410
ALTER TABLE "communication_notifications" ADD CONSTRAINT "communication_notifications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 200 / 410
ALTER TABLE "communication_notifications" ADD CONSTRAINT "communication_notifications_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 201 / 410
ALTER TABLE "communication_notifications" ADD CONSTRAINT "communication_notifications_subject_class_school_fk" FOREIGN KEY ("subject_class_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 202 / 410
ALTER TABLE "communication_notifications" ADD CONSTRAINT "communication_notifications_subject_student_school_fk" FOREIGN KEY ("subject_student_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 203 / 410
ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 204 / 410
ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 205 / 410
ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 206 / 410
ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 207 / 410
ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 208 / 410
ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_teacher_school_fk" FOREIGN KEY ("teacher_employee_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 209 / 410
ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 210 / 410
ALTER TABLE "academic_assessment_types" ADD CONSTRAINT "academic_assessment_types_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 211 / 410
ALTER TABLE "fee_provider_checkout_sessions" ADD CONSTRAINT "fee_provider_checkout_sessions_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 212 / 410
ALTER TABLE "fee_provider_checkout_sessions" ADD CONSTRAINT "fee_provider_checkout_sessions_payment_school_fk" FOREIGN KEY ("payment_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_payments"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 213 / 410
ALTER TABLE "fee_payment_notifications" ADD CONSTRAINT "fee_payment_notifications_payment_invoice_school_fk" FOREIGN KEY ("payment_id","invoice_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_payments"("id","invoice_id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 214 / 410
ALTER TABLE "fee_payment_notifications" ADD CONSTRAINT "fee_payment_notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 215 / 410
ALTER TABLE "fee_payment_notifications" ADD CONSTRAINT "fee_payment_notifications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 216 / 410
ALTER TABLE "fee_school_settings" ADD CONSTRAINT "fee_school_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 217 / 410
ALTER TABLE "fee_school_settings" ADD CONSTRAINT "fee_school_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 218 / 410
ALTER TABLE "communication_templates" ADD CONSTRAINT "communication_templates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 219 / 410
ALTER TABLE "communication_templates" ADD CONSTRAINT "communication_templates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 220 / 410
ALTER TABLE "fee_invoice_notification_outbox" ADD CONSTRAINT "fee_invoice_notification_outbox_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 221 / 410
ALTER TABLE "fee_invoice_notification_outbox" ADD CONSTRAINT "fee_invoice_notification_outbox_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 222 / 410
ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 223 / 410
ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 224 / 410
ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_template_school_fk" FOREIGN KEY ("template_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."communication_templates"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 225 / 410
ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_assessment_school_fk" FOREIGN KEY ("assessment_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_assessments"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 226 / 410
ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_class_assignment_school_fk" FOREIGN KEY ("student_class_assignment_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."student_class_assignments"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 227 / 410
ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 228 / 410
ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 229 / 410
ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 230 / 410
ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 231 / 410
ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 232 / 410
ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 233 / 410
ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 234 / 410
ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_teacher_school_fk" FOREIGN KEY ("teacher_employee_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 235 / 410
ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 236 / 410
ALTER TABLE "communication_campaign_recipients" ADD CONSTRAINT "communication_campaign_recipients_campaign_school_fk" FOREIGN KEY ("campaign_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."communication_campaigns"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 237 / 410
ALTER TABLE "communication_campaign_recipients" ADD CONSTRAINT "communication_campaign_recipients_notification_school_user_fk" FOREIGN KEY ("notification_id","school_id","recipient_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."communication_notifications"("id","school_id","recipient_user_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 238 / 410
ALTER TABLE "communication_campaign_recipients" ADD CONSTRAINT "communication_campaign_recipients_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 239 / 410
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_category_school_fk" FOREIGN KEY ("category_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_categories"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 240 / 410
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 241 / 410
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_structure_school_fk" FOREIGN KEY ("structure_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."fee_structures"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 242 / 410
ALTER TABLE "library_book_copies" ADD CONSTRAINT "library_book_copies_book_school_fk" FOREIGN KEY ("book_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."library_books"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 243 / 410
ALTER TABLE "library_book_copies" ADD CONSTRAINT "library_book_copies_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 244 / 410
ALTER TABLE "library_authors" ADD CONSTRAINT "library_authors_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 245 / 410
ALTER TABLE "library_authors" ADD CONSTRAINT "library_authors_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 246 / 410
ALTER TABLE "library_publishers" ADD CONSTRAINT "library_publishers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 247 / 410
ALTER TABLE "library_publishers" ADD CONSTRAINT "library_publishers_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 248 / 410
ALTER TABLE "fee_categories" ADD CONSTRAINT "fee_categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 249 / 410
ALTER TABLE "fee_categories" ADD CONSTRAINT "fee_categories_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 250 / 410
ALTER TABLE "library_books" ADD CONSTRAINT "library_books_author_school_fk" FOREIGN KEY ("author_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."library_authors"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 251 / 410
ALTER TABLE "library_books" ADD CONSTRAINT "library_books_category_school_fk" FOREIGN KEY ("category_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."library_categories"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 252 / 410
ALTER TABLE "library_books" ADD CONSTRAINT "library_books_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 253 / 410
ALTER TABLE "library_books" ADD CONSTRAINT "library_books_publisher_school_fk" FOREIGN KEY ("publisher_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."library_publishers"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 254 / 410
ALTER TABLE "library_books" ADD CONSTRAINT "library_books_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 255 / 410
ALTER TABLE "school_facilities" ADD CONSTRAINT "school_facilities_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 256 / 410
ALTER TABLE "school_facilities" ADD CONSTRAINT "school_facilities_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 257 / 410
ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 258 / 410
ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 259 / 410
ALTER TABLE "communication_push_devices" ADD CONSTRAINT "communication_push_devices_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 260 / 410
ALTER TABLE "communication_push_devices" ADD CONSTRAINT "communication_push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 261 / 410
ALTER TABLE "school_assets" ADD CONSTRAINT "school_assets_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 262 / 410
ALTER TABLE "school_assets" ADD CONSTRAINT "school_assets_category_school_fk" FOREIGN KEY ("category_id","school_id","category_type") REFERENCES "edupulse_reconciliation_rehearsal"."school_operation_categories"("id","school_id","category_type") ON DELETE no action ON UPDATE no action;

-- Original preview statement 263 / 410
ALTER TABLE "school_assets" ADD CONSTRAINT "school_assets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 264 / 410
ALTER TABLE "school_assets" ADD CONSTRAINT "school_assets_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 265 / 410
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_book_school_fk" FOREIGN KEY ("book_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."library_books"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 266 / 410
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_borrower_user_id_fkey" FOREIGN KEY ("borrower_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 267 / 410
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_copy_book_school_fk" FOREIGN KEY ("school_id","book_id","copy_id") REFERENCES "edupulse_reconciliation_rehearsal"."library_book_copies"("school_id","book_id","id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 268 / 410
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 269 / 410
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_returned_by_user_id_fkey" FOREIGN KEY ("returned_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 270 / 410
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_student_school_fk" FOREIGN KEY ("borrower_student_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 271 / 410
ALTER TABLE "library_categories" ADD CONSTRAINT "library_categories_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 272 / 410
ALTER TABLE "library_categories" ADD CONSTRAINT "library_categories_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 273 / 410
ALTER TABLE "library_staff" ADD CONSTRAINT "library_staff_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 274 / 410
ALTER TABLE "library_staff" ADD CONSTRAINT "library_staff_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 275 / 410
ALTER TABLE "library_staff" ADD CONSTRAINT "library_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 276 / 410
ALTER TABLE "library_renewals" ADD CONSTRAINT "library_renewals_loan_school_fk" FOREIGN KEY ("loan_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."library_loans"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 277 / 410
ALTER TABLE "library_renewals" ADD CONSTRAINT "library_renewals_renewed_by_user_id_fkey" FOREIGN KEY ("renewed_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 278 / 410
ALTER TABLE "school_operations_settings" ADD CONSTRAINT "school_operations_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 279 / 410
ALTER TABLE "school_operations_settings" ADD CONSTRAINT "school_operations_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 280 / 410
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_asset_school_fk" FOREIGN KEY ("asset_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."school_assets"("id","school_id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 281 / 410
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 282 / 410
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_category_school_fk" FOREIGN KEY ("category_id","school_id","category_type") REFERENCES "edupulse_reconciliation_rehearsal"."school_operation_categories"("id","school_id","category_type") ON DELETE no action ON UPDATE no action;

-- Original preview statement 283 / 410
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_reported_by_user_id_fkey" FOREIGN KEY ("reported_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 284 / 410
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 285 / 410
ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 286 / 410
ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_category_school_fk" FOREIGN KEY ("category_id","school_id","category_type") REFERENCES "edupulse_reconciliation_rehearsal"."school_operation_categories"("id","school_id","category_type") ON DELETE no action ON UPDATE no action;

-- Original preview statement 287 / 410
ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 288 / 410
ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 289 / 410
ALTER TABLE "library_settings" ADD CONSTRAINT "library_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 290 / 410
ALTER TABLE "library_settings" ADD CONSTRAINT "library_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 291 / 410
ALTER TABLE "library_copy_status_history" ADD CONSTRAINT "library_copy_status_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 292 / 410
ALTER TABLE "library_copy_status_history" ADD CONSTRAINT "library_copy_status_history_copy_school_fk" FOREIGN KEY ("copy_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."library_book_copies"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 293 / 410
ALTER TABLE "library_copy_status_history" ADD CONSTRAINT "library_copy_status_history_loan_school_fk" FOREIGN KEY ("loan_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."library_loans"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 294 / 410
ALTER TABLE "maintenance_request_status_history" ADD CONSTRAINT "maintenance_request_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 295 / 410
ALTER TABLE "maintenance_request_status_history" ADD CONSTRAINT "maintenance_request_status_history_request_school_fk" FOREIGN KEY ("maintenance_request_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."maintenance_requests"("id","school_id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 296 / 410
ALTER TABLE "school_operation_categories" ADD CONSTRAINT "school_operation_categories_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 297 / 410
ALTER TABLE "school_operation_categories" ADD CONSTRAINT "school_operation_categories_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 298 / 410
ALTER TABLE "operational_task_status_history" ADD CONSTRAINT "operational_task_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 299 / 410
ALTER TABLE "operational_task_status_history" ADD CONSTRAINT "operational_task_status_history_task_school_fk" FOREIGN KEY ("task_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."operational_tasks"("id","school_id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 300 / 410
ALTER TABLE "school_asset_history" ADD CONSTRAINT "school_asset_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 301 / 410
ALTER TABLE "school_asset_history" ADD CONSTRAINT "school_asset_history_asset_school_fk" FOREIGN KEY ("asset_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."school_assets"("id","school_id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 302 / 410
ALTER TABLE "school_asset_history" ADD CONSTRAINT "school_asset_history_assigned_to_after_user_id_fkey" FOREIGN KEY ("assigned_to_after_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 303 / 410
ALTER TABLE "school_asset_history" ADD CONSTRAINT "school_asset_history_assigned_to_before_user_id_fkey" FOREIGN KEY ("assigned_to_before_user_id") REFERENCES "edupulse_reconciliation_rehearsal"."app_users"("id") ON DELETE restrict ON UPDATE no action;

-- Original preview statement 304 / 410
ALTER TABLE "device_school_bindings" ADD CONSTRAINT "device_school_bindings_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "edupulse_reconciliation_rehearsal"."platform_devices"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 305 / 410
ALTER TABLE "device_school_bindings" ADD CONSTRAINT "device_school_bindings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "edupulse_reconciliation_rehearsal"."schools"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 306 / 410
CREATE INDEX "fee_adjustments_invoice_idx" ON "fee_adjustments" USING btree ("school_id","invoice_id","status");

-- Original preview statement 307 / 410
CREATE INDEX "student_identification_policies_school_idx" ON "student_identification_policies" USING btree ("school_id","status");

-- Original preview statement 308 / 410
CREATE UNIQUE INDEX "student_identification_policies_student_unique" ON "student_identification_policies" USING btree ("student_id");

-- Original preview statement 309 / 410
CREATE INDEX "device_credentials_device_status_idx" ON "device_credentials" USING btree ("device_id","status");

-- Original preview statement 310 / 410
CREATE INDEX "attendance_events_employee_idx" ON "attendance_events" USING btree ("employee_id","occurred_at");

-- Original preview statement 311 / 410
CREATE INDEX "attendance_events_school_date_idx" ON "attendance_events" USING btree ("school_id","event_date","occurred_at");

-- Original preview statement 312 / 410
CREATE UNIQUE INDEX "attendance_events_school_dedupe_unique" ON "attendance_events" USING btree ("school_id","dedupe_key");

-- Original preview statement 313 / 410
CREATE INDEX "attendance_events_student_idx" ON "attendance_events" USING btree ("student_id","occurred_at");

-- Original preview statement 314 / 410
CREATE INDEX "fee_invoice_lines_invoice_idx" ON "fee_invoice_lines" USING btree ("school_id","invoice_id");

-- Original preview statement 315 / 410
CREATE INDEX "fee_payment_notification_outbox_retry_idx" ON "fee_payment_notification_outbox" USING btree ("school_id","next_attempt_at","created_at");

-- Original preview statement 316 / 410
CREATE INDEX "fee_invoice_notifications_recipient_idx" ON "fee_invoice_notifications" USING btree ("recipient_user_id","is_read","created_at");

-- Original preview statement 317 / 410
CREATE INDEX "fee_invoice_notifications_school_idx" ON "fee_invoice_notifications" USING btree ("school_id","created_at");

-- Original preview statement 318 / 410
CREATE INDEX "attendance_notification_events_queue_idx" ON "attendance_notification_events" USING btree ("school_id","status","created_at");

-- Original preview statement 319 / 410
CREATE INDEX "attendance_corrections_school_idx" ON "attendance_corrections" USING btree ("school_id","created_at");

-- Original preview statement 320 / 410
CREATE UNIQUE INDEX "biometric_enrollments_provider_reference_unique" ON "biometric_enrollments" USING btree ("provider","provider_reference");

-- Original preview statement 321 / 410
CREATE INDEX "biometric_enrollments_school_status_idx" ON "biometric_enrollments" USING btree ("school_id","status");

-- Original preview statement 322 / 410
CREATE INDEX "nfc_card_history_card_idx" ON "nfc_card_history" USING btree ("nfc_card_id","created_at");

-- Original preview statement 323 / 410
CREATE INDEX "nfc_card_history_school_idx" ON "nfc_card_history" USING btree ("school_id","created_at");

-- Original preview statement 324 / 410
CREATE UNIQUE INDEX "attendance_discrepancies_event_kind_unique" ON "attendance_discrepancies" USING btree ("attendance_event_id","discrepancy_type");

-- Original preview statement 325 / 410
CREATE INDEX "attendance_discrepancies_school_status_idx" ON "attendance_discrepancies" USING btree ("school_id","status","created_at");

-- Original preview statement 326 / 410
CREATE INDEX "fee_invoices_school_student_idx" ON "fee_invoices" USING btree ("school_id","student_id","academic_session_id","academic_term_id");

-- Original preview statement 327 / 410
CREATE INDEX "academic_report_card_lines_report_card_idx" ON "academic_report_card_lines" USING btree ("school_id","report_card_id");

-- Original preview statement 328 / 410
CREATE INDEX "academic_assessments_school_context_idx" ON "academic_assessments" USING btree ("school_id","academic_session_id","academic_term_id","school_class_id");

-- Original preview statement 329 / 410
CREATE INDEX "device_assignment_history_device_idx" ON "device_assignment_history" USING btree ("device_id","created_at");

-- Original preview statement 330 / 410
CREATE INDEX "device_assignment_history_school_idx" ON "device_assignment_history" USING btree ("school_id","created_at");

-- Original preview statement 331 / 410
CREATE UNIQUE INDEX "fee_payments_school_bank_transfer_ref_unique" ON "fee_payments" USING btree ("school_id",lower(btrim(transfer_bank)),lower(btrim(transfer_reference))) WHERE ((method = 'BANK_TRANSFER'::text) AND (NULLIF(btrim(transfer_bank), ''::text) IS NOT NULL) AND (NULLIF(btrim(transfer_reference), ''::text) IS NOT NULL));

-- Original preview statement 332 / 410
CREATE INDEX "fee_payments_school_status_idx" ON "fee_payments" USING btree ("school_id","status","created_at");

-- Original preview statement 333 / 410
CREATE UNIQUE INDEX "fee_payments_school_verified_evidence_ref_unique" ON "fee_payments" USING btree ("school_id",lower(btrim(verification_evidence_ref))) WHERE ((method = 'BANK_TRANSFER'::text) AND (status = 'VERIFIED'::text) AND (NULLIF(btrim(verification_evidence_ref), ''::text) IS NOT NULL));

-- Original preview statement 334 / 410
CREATE INDEX "academic_report_cards_school_student_idx" ON "academic_report_cards" USING btree ("school_id","student_id","academic_session_id","academic_term_id");

-- Original preview statement 335 / 410
CREATE UNIQUE INDEX "fee_refunds_school_evidence_unique" ON "fee_refunds" USING btree ("school_id",lower(btrim(evidence_reference))) WHERE ((status = 'APPROVED'::text) AND (NULLIF(btrim(evidence_reference), ''::text) IS NOT NULL));

-- Original preview statement 336 / 410
CREATE INDEX "fee_refunds_school_status_idx" ON "fee_refunds" USING btree ("school_id","status","created_at");

-- Original preview statement 337 / 410
CREATE INDEX "academic_grading_rules_school_status_idx" ON "academic_grading_rules" USING btree ("school_id","status");

-- Original preview statement 338 / 410
CREATE INDEX "communication_deliveries_provider_message_idx" ON "communication_deliveries" USING btree ("channel","provider_message_id");

-- Original preview statement 339 / 410
CREATE INDEX "communication_deliveries_retry_idx" ON "communication_deliveries" USING btree ("status","next_attempt_at","created_at");

-- Original preview statement 340 / 410
CREATE INDEX "fee_provider_webhook_events_reference_idx" ON "fee_provider_webhook_events" USING btree ("provider","provider_reference","received_at" DESC NULLS FIRST);

-- Original preview statement 341 / 410
CREATE INDEX "fee_provider_webhook_events_school_status_idx" ON "fee_provider_webhook_events" USING btree ("school_id","status","received_at" DESC NULLS FIRST);

-- Original preview statement 342 / 410
CREATE INDEX "fee_structures_school_context_idx" ON "fee_structures" USING btree ("school_id","academic_session_id","academic_term_id","school_class_id");

-- Original preview statement 343 / 410
CREATE UNIQUE INDEX "fee_structures_version_context_unique" ON "fee_structures" USING btree ("school_id","academic_session_id","academic_term_id","school_class_id",COALESCE(section, ''::text),"version");

-- Original preview statement 344 / 410
CREATE INDEX "academic_timetable_entries_school_context_idx" ON "academic_timetable_entries" USING btree ("school_id","academic_session_id","academic_term_id","school_class_id","section");

-- Original preview statement 345 / 410
CREATE INDEX "communication_notifications_event_idx" ON "communication_notifications" USING btree ("school_id","category","created_at");

-- Original preview statement 346 / 410
CREATE UNIQUE INDEX "communication_notifications_global_event_recipient_unique" ON "communication_notifications" USING btree ("event_key","recipient_user_id") WHERE ((school_id IS NULL) AND (event_key IS NOT NULL));

-- Original preview statement 347 / 410
CREATE INDEX "communication_notifications_recipient_read_idx" ON "communication_notifications" USING btree ("recipient_user_id","is_read","created_at");

-- Original preview statement 348 / 410
CREATE INDEX "communication_notifications_school_created_idx" ON "communication_notifications" USING btree ("school_id","created_at");

-- Original preview statement 349 / 410
CREATE UNIQUE INDEX "communication_notifications_school_event_recipient_unique" ON "communication_notifications" USING btree ("school_id","event_key","recipient_user_id") WHERE ((school_id IS NOT NULL) AND (event_key IS NOT NULL));

-- Original preview statement 350 / 410
CREATE INDEX "communication_notifications_subject_class_dispatch_idx" ON "communication_notifications" USING btree ("school_id","subject_class_id","created_at") WHERE (subject_class_id IS NOT NULL);

-- Original preview statement 351 / 410
CREATE INDEX "communication_notifications_subject_student_dispatch_idx" ON "communication_notifications" USING btree ("school_id","subject_student_id","created_at") WHERE (subject_student_id IS NOT NULL);

-- Original preview statement 352 / 410
CREATE INDEX "academic_assignments_school_context_idx" ON "academic_assignments" USING btree ("school_id","academic_session_id","academic_term_id","school_class_id");

-- Original preview statement 353 / 410
CREATE UNIQUE INDEX "platform_company_employees_email_unique" ON "platform_company_employees" USING btree (lower(email));

-- Original preview statement 354 / 410
CREATE INDEX "platform_company_employees_status_idx" ON "platform_company_employees" USING btree ("status");

-- Original preview statement 355 / 410
CREATE INDEX "academic_assessment_types_school_status_idx" ON "academic_assessment_types" USING btree ("school_id","status");

-- Original preview statement 356 / 410
CREATE UNIQUE INDEX "fee_provider_checkout_sessions_one_open_invoice_unique" ON "fee_provider_checkout_sessions" USING btree ("school_id","invoice_id") WHERE (state = ANY (ARRAY['INITIALIZING'::text, 'READY'::text, 'FAILED'::text]));

-- Original preview statement 357 / 410
CREATE INDEX "fee_payment_notifications_recipient_idx" ON "fee_payment_notifications" USING btree ("recipient_user_id","is_read","created_at");

-- Original preview statement 358 / 410
CREATE INDEX "fee_payment_notifications_school_idx" ON "fee_payment_notifications" USING btree ("school_id","created_at");

-- Original preview statement 359 / 410
CREATE INDEX "communication_templates_school_active_idx" ON "communication_templates" USING btree ("school_id","is_active","category");

-- Original preview statement 360 / 410
CREATE INDEX "fee_invoice_notification_outbox_retry_idx" ON "fee_invoice_notification_outbox" USING btree ("school_id","next_attempt_at","created_at");

-- Original preview statement 361 / 410
CREATE UNIQUE INDEX "communication_campaigns_school_idempotency_unique" ON "communication_campaigns" USING btree ("school_id","idempotency_key") WHERE (idempotency_key IS NOT NULL);

-- Original preview statement 362 / 410
CREATE INDEX "communication_campaigns_school_status_idx" ON "communication_campaigns" USING btree ("school_id","status","created_at");

-- Original preview statement 363 / 410
CREATE INDEX "academic_results_school_context_idx" ON "academic_results" USING btree ("school_id","academic_session_id","academic_term_id","student_id");

-- Original preview statement 364 / 410
CREATE INDEX "communication_campaign_recipients_school_status_idx" ON "communication_campaign_recipients" USING btree ("school_id","status","created_at");

-- Original preview statement 365 / 410
CREATE INDEX "communication_campaign_recipients_user_idx" ON "communication_campaign_recipients" USING btree ("recipient_user_id","school_id","created_at");

-- Original preview statement 366 / 410
CREATE INDEX "library_book_copies_available_idx" ON "library_book_copies" USING btree ("school_id","book_id","status");

-- Original preview statement 367 / 410
CREATE UNIQUE INDEX "library_book_copies_school_barcode_unique" ON "library_book_copies" USING btree ("school_id","barcode") WHERE (barcode IS NOT NULL);

-- Original preview statement 368 / 410
CREATE UNIQUE INDEX "library_book_copies_school_code_unique" ON "library_book_copies" USING btree ("school_id",lower(copy_code));

-- Original preview statement 369 / 410
CREATE UNIQUE INDEX "library_authors_school_name_unique" ON "library_authors" USING btree ("school_id",lower(name));

-- Original preview statement 370 / 410
CREATE UNIQUE INDEX "library_publishers_school_name_unique" ON "library_publishers" USING btree ("school_id",lower(name));

-- Original preview statement 371 / 410
CREATE INDEX "fee_categories_school_status_idx" ON "fee_categories" USING btree ("school_id","status");

-- Original preview statement 372 / 410
CREATE INDEX "library_books_isbn_idx" ON "library_books" USING btree ("school_id","isbn") WHERE (isbn IS NOT NULL);

-- Original preview statement 373 / 410
CREATE INDEX "library_books_school_search_idx" ON "library_books" USING btree ("school_id","status",lower(title));

-- Original preview statement 374 / 410
CREATE UNIQUE INDEX "school_facilities_school_name_unique" ON "school_facilities" USING btree ("school_id",lower(name));

-- Original preview statement 375 / 410
CREATE INDEX "school_facilities_school_status_idx" ON "school_facilities" USING btree ("school_id","status","name");

-- Original preview statement 376 / 410
CREATE UNIQUE INDEX "communication_preferences_global_unique" ON "communication_preferences" USING btree ("user_id","category","channel") WHERE (school_id IS NULL);

-- Original preview statement 377 / 410
CREATE UNIQUE INDEX "communication_preferences_school_unique" ON "communication_preferences" USING btree ("user_id","school_id","category","channel") WHERE (school_id IS NOT NULL);

-- Original preview statement 378 / 410
CREATE INDEX "communication_preferences_user_idx" ON "communication_preferences" USING btree ("user_id","school_id");

-- Original preview statement 379 / 410
CREATE UNIQUE INDEX "communication_push_devices_global_active_unique" ON "communication_push_devices" USING btree ("user_id","provider","opaque_device_reference") WHERE ((school_id IS NULL) AND (status = 'ACTIVE'::text));

-- Original preview statement 380 / 410
CREATE UNIQUE INDEX "communication_push_devices_school_active_unique" ON "communication_push_devices" USING btree ("user_id","school_id","provider","opaque_device_reference") WHERE ((school_id IS NOT NULL) AND (status = 'ACTIVE'::text));

-- Original preview statement 381 / 410
CREATE INDEX "communication_push_devices_user_school_idx" ON "communication_push_devices" USING btree ("user_id","school_id","status");

-- Original preview statement 382 / 410
CREATE UNIQUE INDEX "school_assets_school_code_unique" ON "school_assets" USING btree ("school_id",lower(asset_code)) WHERE (asset_code IS NOT NULL);

-- Original preview statement 383 / 410
CREATE INDEX "school_assets_school_status_idx" ON "school_assets" USING btree ("school_id","status","name");

-- Original preview statement 384 / 410
CREATE INDEX "library_loans_borrower_history_idx" ON "library_loans" USING btree ("school_id","borrower_user_id","issued_at" DESC NULLS FIRST);

-- Original preview statement 385 / 410
CREATE UNIQUE INDEX "library_loans_open_copy_unique" ON "library_loans" USING btree ("school_id","copy_id") WHERE (status = 'OPEN'::text);

-- Original preview statement 386 / 410
CREATE INDEX "library_loans_overdue_idx" ON "library_loans" USING btree ("school_id","due_on") WHERE (status = 'OPEN'::text);

-- Original preview statement 387 / 410
CREATE UNIQUE INDEX "library_loans_school_idempotency_unique" ON "library_loans" USING btree ("school_id","idempotency_key") WHERE (idempotency_key IS NOT NULL);

-- Original preview statement 388 / 410
CREATE UNIQUE INDEX "library_categories_school_name_unique" ON "library_categories" USING btree ("school_id",lower(name));

-- Original preview statement 389 / 410
CREATE INDEX "library_staff_school_active_idx" ON "library_staff" USING btree ("school_id","is_active");

-- Original preview statement 390 / 410
CREATE INDEX "library_renewals_loan_history_idx" ON "library_renewals" USING btree ("school_id","loan_id","created_at");

-- Original preview statement 391 / 410
CREATE INDEX "maintenance_requests_assignee_idx" ON "maintenance_requests" USING btree ("school_id","assigned_to_user_id","status");

-- Original preview statement 392 / 410
CREATE INDEX "maintenance_requests_reporter_idx" ON "maintenance_requests" USING btree ("school_id","reported_by_user_id","reported_at");

-- Original preview statement 393 / 410
CREATE INDEX "maintenance_requests_school_status_idx" ON "maintenance_requests" USING btree ("school_id","status","priority","reported_at");

-- Original preview statement 394 / 410
CREATE INDEX "operational_tasks_assignee_idx" ON "operational_tasks" USING btree ("school_id","assigned_to_user_id","status");

-- Original preview statement 395 / 410
CREATE INDEX "operational_tasks_school_status_idx" ON "operational_tasks" USING btree ("school_id","status","priority","due_on");

-- Original preview statement 396 / 410
CREATE INDEX "library_copy_status_history_idx" ON "library_copy_status_history" USING btree ("school_id","copy_id","created_at" DESC NULLS FIRST);

-- Original preview statement 397 / 410
CREATE INDEX "maintenance_request_status_history_timeline_idx" ON "maintenance_request_status_history" USING btree ("school_id","maintenance_request_id","occurred_at","id");

-- Original preview statement 398 / 410
CREATE INDEX "school_operation_categories_school_active_idx" ON "school_operation_categories" USING btree ("school_id","category_type","is_active");

-- Original preview statement 399 / 410
CREATE UNIQUE INDEX "school_operation_categories_school_type_name_unique" ON "school_operation_categories" USING btree ("school_id","category_type",lower(name));

-- Original preview statement 400 / 410
CREATE INDEX "operational_task_status_history_timeline_idx" ON "operational_task_status_history" USING btree ("school_id","task_id","occurred_at","id");

-- Original preview statement 401 / 410
CREATE INDEX "school_asset_history_asset_timeline_idx" ON "school_asset_history" USING btree ("school_id","asset_id","event_at","id");

-- Original preview statement 402 / 410
CREATE INDEX "device_school_bindings_school_idx" ON "device_school_bindings" USING btree ("school_id");

-- Original preview statement 403 / 410
ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_last_device_school_fk" FOREIGN KEY ("last_device_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."device_school_bindings"("device_id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 404 / 410
ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_replaced_by_id_fk" FOREIGN KEY ("replaced_by_card_id") REFERENCES "edupulse_reconciliation_rehearsal"."nfc_cards"("id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 405 / 410
ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_replaced_by_school_fk" FOREIGN KEY ("replaced_by_card_id","replaced_by_school_id") REFERENCES "edupulse_reconciliation_rehearsal"."nfc_cards"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 406 / 410
ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 407 / 410
ALTER TABLE "platform_devices" ADD CONSTRAINT "platform_devices_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "edupulse_reconciliation_rehearsal"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

-- Original preview statement 408 / 410
CREATE UNIQUE INDEX "platform_devices_id_school_unique" ON "platform_devices" USING btree ("id","school_id");

-- Original preview statement 409 / 410
ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_id_school_tenant_key" UNIQUE("id","school_id");

-- Original preview statement 410 / 410
ALTER TABLE "platform_devices" ADD CONSTRAINT "platform_devices_status_supported_check" CHECK (status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text, 'MAINTENANCE'::text, 'SUSPENDED'::text, 'UNASSIGNED'::text]));

-- Focused post-preview assertions: structure only; no historical production data is present.
DO $reconciliation_assertions$
DECLARE
  relation_count integer;
  foreign_key_count integer;
  matched_preview_foreign_keys integer;
  tenant_key_count integer;
  unique_key_count integer;
  status_values text[];
  key_record record;
BEGIN
  IF current_schema() <> 'edupulse_reconciliation_rehearsal' THEN
    RAISE EXCEPTION 'unexpected rehearsal search_path schema: %', current_schema();
  END IF;

  SELECT count(*) INTO relation_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'edupulse_reconciliation_rehearsal' AND c.relkind = 'r';
  IF relation_count <> 91 THEN
    RAISE EXCEPTION 'expected 91 rehearsal tables; found %', relation_count;
  END IF;

  SELECT count(*) INTO foreign_key_count
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = 'edupulse_reconciliation_rehearsal' AND c.contype = 'f';
  IF foreign_key_count <> 304 THEN
    RAISE EXCEPTION 'expected 68 snapshot plus 236 preview FKs (304 total); found %', foreign_key_count;
  END IF;

  SELECT count(*) INTO matched_preview_foreign_keys
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = 'edupulse_reconciliation_rehearsal'
    AND c.contype = 'f'
    AND c.conname = ANY(ARRAY['fee_adjustments_approved_by_fkey', 'fee_adjustments_invoice_school_fk', 'fee_adjustments_requested_by_fkey', 'fee_adjustments_school_id_fkey', 'student_identification_policies_created_by_fkey', 'student_identification_policies_school_id_fkey', 'student_identification_policies_student_id_fkey', 'student_identification_policies_student_school_fk', 'device_credentials_device_id_fkey', 'device_credentials_school_id_fkey', 'attendance_settings_school_id_fkey', 'attendance_events_academic_session_id_fkey', 'attendance_events_academic_term_id_fkey', 'attendance_events_actor_user_id_fkey', 'attendance_events_class_school_fk', 'attendance_events_device_id_fkey', 'attendance_events_device_school_fk', 'attendance_events_employee_id_fkey', 'attendance_events_employee_school_fk', 'attendance_events_nfc_card_id_fkey', 'attendance_events_school_class_id_fkey', 'attendance_events_school_id_fkey', 'attendance_events_session_school_fk', 'attendance_events_student_id_fkey', 'attendance_events_student_school_fk', 'attendance_events_term_school_fk', 'fee_invoice_lines_category_school_fk', 'fee_invoice_lines_invoice_school_fk', 'fee_invoice_lines_school_id_fkey', 'fee_payment_notification_outbox_payment_invoice_school_fk', 'fee_payment_notification_outbox_school_id_fkey', 'fee_receipts_payment_invoice_school_fk', 'fee_receipts_payment_school_fk', 'fee_receipts_school_id_fkey', 'fee_invoice_notifications_invoice_school_fk', 'fee_invoice_notifications_recipient_user_id_fkey', 'fee_invoice_notifications_school_id_fkey', 'attendance_notification_events_attendance_event_id_fkey', 'attendance_notification_events_discrepancy_id_fkey', 'attendance_notification_events_discrepancy_school_fk', 'attendance_notification_events_event_school_fk', 'attendance_notification_events_recipient_user_id_fkey', 'attendance_notification_events_school_id_fkey', 'attendance_corrections_actor_user_id_fkey', 'attendance_corrections_attendance_event_id_fkey', 'attendance_corrections_event_school_fk', 'attendance_corrections_school_id_fkey', 'biometric_enrollments_device_id_fkey', 'biometric_enrollments_device_school_fk', 'biometric_enrollments_employee_id_fkey', 'biometric_enrollments_employee_school_fk', 'biometric_enrollments_school_id_fkey', 'biometric_enrollments_student_id_fkey', 'biometric_enrollments_student_school_fk', 'nfc_card_history_actor_user_id_fkey', 'nfc_card_history_card_school_fk', 'nfc_card_history_nfc_card_id_fkey', 'nfc_card_history_replaced_by_card_id_fkey', 'nfc_card_history_school_id_fkey', 'nfc_card_history_student_id_fkey', 'nfc_card_history_student_school_fk', 'attendance_discrepancies_attendance_event_id_fkey', 'attendance_discrepancies_event_school_fk', 'attendance_discrepancies_resolved_by_fkey', 'attendance_discrepancies_school_id_fkey', 'attendance_discrepancies_student_id_fkey', 'attendance_discrepancies_student_school_fk', 'fee_invoices_created_by_fkey', 'fee_invoices_school_id_fkey', 'fee_invoices_session_school_fk', 'fee_invoices_structure_school_fk', 'fee_invoices_student_school_fk', 'fee_invoices_term_school_fk', 'academic_report_card_lines_report_card_school_fk', 'academic_report_card_lines_result_school_fk', 'academic_report_card_lines_school_id_fkey', 'academic_report_card_lines_subject_school_fk', 'academic_assessments_class_school_fk', 'academic_assessments_created_by_fkey', 'academic_assessments_school_id_fkey', 'academic_assessments_session_school_fk', 'academic_assessments_subject_school_fk', 'academic_assessments_teacher_school_fk', 'academic_assessments_term_school_fk', 'academic_assessments_type_school_fk', 'device_assignment_history_actor_user_id_fkey', 'device_assignment_history_device_id_fkey', 'device_assignment_history_new_school_id_fkey', 'device_assignment_history_previous_school_id_fkey', 'device_assignment_history_school_id_fkey', 'fee_payments_invoice_school_fk', 'fee_payments_school_id_fkey', 'fee_payments_student_school_fk', 'fee_payments_submitted_by_fkey', 'fee_payments_verified_by_fkey', 'academic_report_cards_class_assignment_school_fk', 'academic_report_cards_class_school_fk', 'academic_report_cards_published_by_fkey', 'academic_report_cards_school_id_fkey', 'academic_report_cards_session_school_fk', 'academic_report_cards_student_school_fk', 'academic_report_cards_term_school_fk', 'fee_refunds_approved_by_fkey', 'fee_refunds_payment_invoice_school_fk', 'fee_refunds_requested_by_fkey', 'fee_refunds_school_id_fkey', 'academic_grading_rules_school_id_fkey', 'communication_deliveries_notification_id_fkey', 'fee_provider_webhook_events_payment_school_fk', 'fee_provider_webhook_events_school_fk', 'fee_structures_class_school_fk', 'fee_structures_created_by_fkey', 'fee_structures_published_by_fkey', 'fee_structures_school_id_fkey', 'fee_structures_session_school_fk', 'fee_structures_term_school_fk', 'academic_timetable_entries_class_school_fk', 'academic_timetable_entries_created_by_fkey', 'academic_timetable_entries_school_id_fkey', 'academic_timetable_entries_session_school_fk', 'academic_timetable_entries_subject_school_fk', 'academic_timetable_entries_teacher_school_fk', 'academic_timetable_entries_term_school_fk', 'communication_notifications_recipient_user_id_fkey', 'communication_notifications_school_id_fkey', 'communication_notifications_sender_user_id_fkey', 'communication_notifications_subject_class_school_fk', 'communication_notifications_subject_student_school_fk', 'academic_assignments_class_school_fk', 'academic_assignments_created_by_fkey', 'academic_assignments_school_id_fkey', 'academic_assignments_session_school_fk', 'academic_assignments_subject_school_fk', 'academic_assignments_teacher_school_fk', 'academic_assignments_term_school_fk', 'academic_assessment_types_school_id_fkey', 'fee_provider_checkout_sessions_invoice_school_fk', 'fee_provider_checkout_sessions_payment_school_fk', 'fee_payment_notifications_payment_invoice_school_fk', 'fee_payment_notifications_recipient_user_id_fkey', 'fee_payment_notifications_school_id_fkey', 'fee_school_settings_school_id_fkey', 'fee_school_settings_updated_by_fkey', 'communication_templates_created_by_user_id_fkey', 'communication_templates_school_id_fkey', 'fee_invoice_notification_outbox_invoice_school_fk', 'fee_invoice_notification_outbox_school_id_fkey', 'communication_campaigns_created_by_user_id_fkey', 'communication_campaigns_school_id_fkey', 'communication_campaigns_template_school_fk', 'academic_results_assessment_school_fk', 'academic_results_class_assignment_school_fk', 'academic_results_class_school_fk', 'academic_results_created_by_fkey', 'academic_results_published_by_fkey', 'academic_results_school_id_fkey', 'academic_results_session_school_fk', 'academic_results_student_school_fk', 'academic_results_subject_school_fk', 'academic_results_teacher_school_fk', 'academic_results_term_school_fk', 'communication_campaign_recipients_campaign_school_fk', 'communication_campaign_recipients_notification_school_user_fk', 'communication_campaign_recipients_recipient_user_id_fkey', 'fee_structure_lines_category_school_fk', 'fee_structure_lines_school_id_fkey', 'fee_structure_lines_structure_school_fk', 'library_book_copies_book_school_fk', 'library_book_copies_created_by_user_id_fkey', 'library_authors_created_by_user_id_fkey', 'library_authors_school_id_fkey', 'library_publishers_created_by_user_id_fkey', 'library_publishers_school_id_fkey', 'fee_categories_created_by_fkey', 'fee_categories_school_id_fkey', 'library_books_author_school_fk', 'library_books_category_school_fk', 'library_books_created_by_user_id_fkey', 'library_books_publisher_school_fk', 'library_books_school_id_fkey', 'school_facilities_created_by_user_id_fkey', 'school_facilities_school_id_fkey', 'communication_preferences_school_id_fkey', 'communication_preferences_user_id_fkey', 'communication_push_devices_school_id_fkey', 'communication_push_devices_user_id_fkey', 'school_assets_assigned_to_user_id_fkey', 'school_assets_category_school_fk', 'school_assets_created_by_user_id_fkey', 'school_assets_school_id_fkey', 'library_loans_book_school_fk', 'library_loans_borrower_user_id_fkey', 'library_loans_copy_book_school_fk', 'library_loans_issued_by_user_id_fkey', 'library_loans_returned_by_user_id_fkey', 'library_loans_student_school_fk', 'library_categories_created_by_user_id_fkey', 'library_categories_school_id_fkey', 'library_staff_assigned_by_user_id_fkey', 'library_staff_school_id_fkey', 'library_staff_user_id_fkey', 'library_renewals_loan_school_fk', 'library_renewals_renewed_by_user_id_fkey', 'school_operations_settings_school_id_fkey', 'school_operations_settings_updated_by_user_id_fkey', 'maintenance_requests_asset_school_fk', 'maintenance_requests_assigned_to_user_id_fkey', 'maintenance_requests_category_school_fk', 'maintenance_requests_reported_by_user_id_fkey', 'maintenance_requests_school_id_fkey', 'operational_tasks_assigned_to_user_id_fkey', 'operational_tasks_category_school_fk', 'operational_tasks_created_by_user_id_fkey', 'operational_tasks_school_id_fkey', 'library_settings_school_id_fkey', 'library_settings_updated_by_user_id_fkey', 'library_copy_status_history_changed_by_user_id_fkey', 'library_copy_status_history_copy_school_fk', 'library_copy_status_history_loan_school_fk', 'maintenance_request_status_history_actor_user_id_fkey', 'maintenance_request_status_history_request_school_fk', 'school_operation_categories_created_by_user_id_fkey', 'school_operation_categories_school_id_fkey', 'operational_task_status_history_actor_user_id_fkey', 'operational_task_status_history_task_school_fk', 'school_asset_history_actor_user_id_fkey', 'school_asset_history_asset_school_fk', 'school_asset_history_assigned_to_after_user_id_fkey', 'school_asset_history_assigned_to_before_user_id_fkey', 'device_school_bindings_device_id_fkey', 'device_school_bindings_school_id_fkey', 'nfc_cards_last_device_school_fk', 'nfc_cards_replaced_by_id_fk', 'nfc_cards_replaced_by_school_fk', 'nfc_cards_student_school_fk', 'platform_devices_class_school_fk']::text[]);
  IF matched_preview_foreign_keys <> 236 THEN
    RAISE EXCEPTION 'expected all 236 preview FK names to exist; found %', matched_preview_foreign_keys;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'edupulse_reconciliation_rehearsal'
      AND r.relname = 'school_operation_categories'
      AND c.contype IN ('p', 'u')
      AND pg_get_constraintdef(c.oid) LIKE 'UNIQUE (id, school_id, category_type)%'
  ) THEN
    RAISE EXCEPTION 'school operation category (id, school_id, category_type) key is not eligible';
  END IF;

  SELECT array_agg(captures[1] ORDER BY captures[1]) INTO status_values
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  CROSS JOIN LATERAL regexp_matches(
    pg_get_constraintdef(c.oid),
    $$'([^']+)'$$,
    'g'
  ) AS captures
  WHERE n.nspname = 'edupulse_reconciliation_rehearsal'
    AND r.relname = 'platform_devices'
    AND c.conname = 'platform_devices_status_supported_check';
  IF status_values IS DISTINCT FROM ARRAY[
    'ACTIVE', 'INACTIVE', 'MAINTENANCE', 'SUSPENDED', 'UNASSIGNED'
  ]::text[] THEN
    RAISE EXCEPTION 'expected exact five-value platform device status check; got %', status_values;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_class target ON target.oid = c.confrelid
    JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
    WHERE n.nspname = 'edupulse_reconciliation_rehearsal'
      AND r.relname = 'platform_devices'
      AND c.conname = 'platform_devices_class_school_fk'
      AND c.contype = 'f'
      AND c.convalidated
      AND target_ns.nspname = 'edupulse_reconciliation_rehearsal'
      AND target.relname = 'school_classes'
  ) THEN
    RAISE EXCEPTION 'class/school platform-device FK is absent or not validated';
  END IF;

  SELECT count(*) INTO tenant_key_count
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = 'edupulse_reconciliation_rehearsal'
    AND c.contype = 'u'
    AND c.conname = ANY(ARRAY['academic_sessions_id_school_tenant_key', 'academic_terms_id_school_tenant_key', 'employees_id_school_tenant_key', 'nfc_cards_id_school_tenant_key', 'school_classes_id_school_tenant_key', 'students_id_school_tenant_key', 'subjects_id_school_tenant_key']::text[]);
  IF tenant_key_count <> 7 THEN
    RAISE EXCEPTION 'expected seven existing tenant unique keys without recreation; found %', tenant_key_count;
  END IF;

  FOR key_record IN
    SELECT * FROM (VALUES
      ('academic_sessions', 'academic_sessions_id_school_tenant_key'),
      ('academic_terms', 'academic_terms_id_school_tenant_key'),
      ('employees', 'employees_id_school_tenant_key'),
      ('nfc_cards', 'nfc_cards_id_school_tenant_key'),
      ('school_classes', 'school_classes_id_school_tenant_key'),
      ('students', 'students_id_school_tenant_key'),
      ('subjects', 'subjects_id_school_tenant_key')
    ) AS existing_tenant_keys(table_name, constraint_name)
  LOOP
    SELECT count(*) INTO unique_key_count
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'edupulse_reconciliation_rehearsal'
      AND r.relname = key_record.table_name
      AND c.conname = key_record.constraint_name
      AND c.contype = 'u'
      AND c.convalidated;
    IF unique_key_count <> 1 THEN
      RAISE EXCEPTION 'existing key % was not preserved exactly once', key_record.constraint_name;
    END IF;
  END LOOP;
END
$reconciliation_assertions$;

-- Install only the three existing append-only/immutability function bodies and six triggers.
CREATE OR REPLACE FUNCTION "edupulse_reconciliation_rehearsal".prevent_device_school_binding_mutation()
RETURNS trigger LANGUAGE plpgsql
SET search_path = "edupulse_reconciliation_rehearsal", public
AS $$
BEGIN
  RAISE EXCEPTION 'device_school_bindings is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION "edupulse_reconciliation_rehearsal".protect_fee_payment_verification_metadata()
RETURNS trigger LANGUAGE plpgsql
SET search_path = "edupulse_reconciliation_rehearsal", public
AS $$
BEGIN
  IF OLD.verification_metadata IS NOT NULL AND (
    NEW.verification_evidence_ref IS DISTINCT FROM OLD.verification_evidence_ref
    OR NEW.reviewer_notes IS DISTINCT FROM OLD.reviewer_notes
    OR NEW.verification_metadata IS DISTINCT FROM OLD.verification_metadata
    OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
    OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
  ) THEN
    RAISE EXCEPTION 'verified payment metadata is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "edupulse_reconciliation_rehearsal".prevent_operations_history_mutation()
RETURNS trigger LANGUAGE plpgsql
SET search_path = "edupulse_reconciliation_rehearsal", public
AS $$
BEGIN
  RAISE EXCEPTION 'Operations history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER device_school_bindings_append_only
  BEFORE UPDATE OR DELETE ON "edupulse_reconciliation_rehearsal".device_school_bindings
  FOR EACH ROW EXECUTE FUNCTION "edupulse_reconciliation_rehearsal".prevent_device_school_binding_mutation();
CREATE TRIGGER device_school_bindings_no_truncate
  BEFORE TRUNCATE ON "edupulse_reconciliation_rehearsal".device_school_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION "edupulse_reconciliation_rehearsal".prevent_device_school_binding_mutation();
CREATE TRIGGER fee_payments_verification_metadata_immutable
  BEFORE UPDATE ON "edupulse_reconciliation_rehearsal".fee_payments
  FOR EACH ROW EXECUTE FUNCTION "edupulse_reconciliation_rehearsal".protect_fee_payment_verification_metadata();
CREATE TRIGGER school_asset_history_append_only
  BEFORE UPDATE OR DELETE ON "edupulse_reconciliation_rehearsal".school_asset_history
  FOR EACH ROW EXECUTE FUNCTION "edupulse_reconciliation_rehearsal".prevent_operations_history_mutation();
CREATE TRIGGER maintenance_request_status_history_append_only
  BEFORE UPDATE OR DELETE ON "edupulse_reconciliation_rehearsal".maintenance_request_status_history
  FOR EACH ROW EXECUTE FUNCTION "edupulse_reconciliation_rehearsal".prevent_operations_history_mutation();
CREATE TRIGGER operational_task_status_history_append_only
  BEFORE UPDATE OR DELETE ON "edupulse_reconciliation_rehearsal".operational_task_status_history
  FOR EACH ROW EXECUTE FUNCTION "edupulse_reconciliation_rehearsal".prevent_operations_history_mutation();

-- Synthetic fixtures only: negative sentinel IDs and rehearsal-only codes.
-- These are not historical production records and are rolled back at the end.
INSERT INTO "edupulse_reconciliation_rehearsal".schools
  (id, code, name, city, state)
VALUES
  (-61001, 'REHEARSAL_ONLY_61001', 'Rehearsal current school', 'Fixture City', 'Fixture State'),
  (-61002, 'REHEARSAL_ONLY_61002', 'Rehearsal prior school', 'Fixture City', 'Fixture State');

INSERT INTO "edupulse_reconciliation_rehearsal".app_users
  (id, clerk_user_id, email, first_name, last_name)
VALUES
  (-62001, 'rehearsal-user-62001', 'rehearsal-62001@example.invalid', 'Fixture', 'One'),
  (-62002, 'rehearsal-user-62002', 'rehearsal-62002@example.invalid', 'Fixture', 'Two');

INSERT INTO "edupulse_reconciliation_rehearsal".school_classes
  (id, school_id, name, section)
VALUES
  (-67020, -61001, 'Rehearsal exact class', 'A'),
  (-67021, -61002, 'Rehearsal prior-school class', 'A');

-- Candidate-matching guardians exercise normalized names, digits-only phone
-- equality, and same-school isolation. The ambiguous and cross-school students
-- must not get relationships from the synthetic unique-candidate backfill.
INSERT INTO "edupulse_reconciliation_rehearsal".parents
  (id, school_id, name, email, phone)
VALUES
  (-67001, -61001, 'Unique Guardian', 'guardian-67001@example.invalid', '+1 (555) 000-0100'),
  (-67002, -61001, 'Ambiguous Guardian', 'guardian-67002@example.invalid', '+1 555 000 0200'),
  (-67003, -61001, '  AMBIGUOUS GUARDIAN ', 'guardian-67003@example.invalid', '1-555-000-0200'),
  (-67004, -61002, 'Cross School Guardian', 'guardian-67004@example.invalid', '+1 (555) 000-0300');
INSERT INTO "edupulse_reconciliation_rehearsal".students
  (id, school_id, admission_no, first_name, last_name, gender, class_name, section,
   parent_name, parent_phone)
VALUES
  (-67101, -61001, 'REHEARSAL_STUDENT_67101', 'Unique', 'Guardian Match', 'OTHER',
   'Rehearsal exact class', 'A', '  unique guardian ', '15550000100'),
  (-67102, -61001, 'REHEARSAL_STUDENT_67102', 'Ambiguous', 'Guardian Match', 'OTHER',
   'No historical class', 'Z', 'Ambiguous Guardian', '15550000200'),
  (-67103, -61001, 'REHEARSAL_STUDENT_67103', 'Cross', 'School Mismatch', 'OTHER',
   'No historical class', 'Z', 'Cross School Guardian', '15550000300'),
  (-67104, -61001, 'REHEARSAL_STUDENT_67104', 'Unmatched', 'Class Student', 'OTHER',
   'Unmatched historical class', 'Z', NULL, NULL);

-- A real source row in the rehearsal schema proves the old school is retained
-- by the historical-pair backfill even though the device now belongs elsewhere.
INSERT INTO "edupulse_reconciliation_rehearsal".platform_devices
  (id, serial_number, name, device_type, school_id, school_class_id)
VALUES
  (-63001, 'REHEARSAL_DEVICE_63001', 'Synthetic reassigned device', 'NFC', -61001, -67020);

INSERT INTO "edupulse_reconciliation_rehearsal".device_assignment_history
  (id, school_id, device_id, previous_school_id, previous_location, location,
   action, reason, actor_user_id, new_school_id)
VALUES
  (-64001, -61001, -63001, -61002, 'Prior fixture room', 'Current fixture room',
   'REASSIGNED', 'Synthetic historical binding rehearsal', -62001, -61001);

DO $device_domain_fixture$
DECLARE
  device_status text;
  device_number integer := 0;
  rejected boolean;
BEGIN
  -- The initial -63001 row already proves same-school class acceptance.
  FOREACH device_status IN ARRAY ARRAY[
    'ACTIVE', 'INACTIVE', 'MAINTENANCE', 'SUSPENDED', 'UNASSIGNED'
  ] LOOP
    device_number := device_number + 1;
    INSERT INTO "edupulse_reconciliation_rehearsal".platform_devices
      (id, serial_number, name, device_type, school_id, school_class_id, status)
    VALUES
      (-63010 - device_number,
       'REHEARSAL_STATUS_' || device_number,
       'Synthetic status fixture',
       'NFC',
       -61001,
       -67020,
       device_status);
  END LOOP;

  rejected := false;
  BEGIN
    INSERT INTO "edupulse_reconciliation_rehearsal".platform_devices
      (id, serial_number, name, device_type, school_id, school_class_id, status)
    VALUES
      (-63020, 'REHEARSAL_STATUS_UNSUPPORTED', 'Synthetic unsupported status',
       'NFC', -61001, -67020, 'REHEARSAL_UNSUPPORTED');
    RAISE EXCEPTION 'unsupported device status unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  WHEN raise_exception THEN
    IF SQLERRM = 'unsupported device status unexpectedly succeeded' THEN
      RAISE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'unsupported device status was not rejected';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "edupulse_reconciliation_rehearsal".platform_devices
      (id, serial_number, name, device_type, school_id, school_class_id)
    VALUES
      (-63021, 'REHEARSAL_CROSS_SCHOOL_CLASS', 'Synthetic cross-school class',
       'NFC', -61001, -67021);
    RAISE EXCEPTION 'cross-school device/class binding unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  WHEN raise_exception THEN
    IF SQLERRM = 'cross-school device/class binding unexpectedly succeeded' THEN
      RAISE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'cross-school device/class binding was not rejected';
  END IF;
END
$device_domain_fixture$;

-- Same source union as the historical-binding migration, scoped entirely to
-- rehearsal tables. Safe to repeat because of the pair primary key.
INSERT INTO "edupulse_reconciliation_rehearsal".device_school_bindings (device_id, school_id)
SELECT device_id, school_id
FROM "edupulse_reconciliation_rehearsal".attendance_events
WHERE device_id IS NOT NULL
UNION
SELECT device_id, school_id
FROM "edupulse_reconciliation_rehearsal".device_credentials
UNION
SELECT device_id, school_id
FROM "edupulse_reconciliation_rehearsal".device_assignment_history
UNION
SELECT device_id, previous_school_id
FROM "edupulse_reconciliation_rehearsal".device_assignment_history
WHERE previous_school_id IS NOT NULL
UNION
SELECT device_id, new_school_id
FROM "edupulse_reconciliation_rehearsal".device_assignment_history
WHERE new_school_id IS NOT NULL
UNION
SELECT id, school_id
FROM "edupulse_reconciliation_rehearsal".platform_devices
WHERE school_id IS NOT NULL
ON CONFLICT (device_id, school_id) DO NOTHING;

-- Repeat the complete source union. It must be idempotent while retaining both
-- distinct school pairs (current and prior) represented by real fixture history.
INSERT INTO "edupulse_reconciliation_rehearsal".device_school_bindings (device_id, school_id)
SELECT device_id, school_id
FROM "edupulse_reconciliation_rehearsal".attendance_events
WHERE device_id IS NOT NULL
UNION
SELECT device_id, school_id
FROM "edupulse_reconciliation_rehearsal".device_credentials
UNION
SELECT device_id, school_id
FROM "edupulse_reconciliation_rehearsal".device_assignment_history
UNION
SELECT device_id, previous_school_id
FROM "edupulse_reconciliation_rehearsal".device_assignment_history
WHERE previous_school_id IS NOT NULL
UNION
SELECT device_id, new_school_id
FROM "edupulse_reconciliation_rehearsal".device_assignment_history
WHERE new_school_id IS NOT NULL
UNION
SELECT id, school_id
FROM "edupulse_reconciliation_rehearsal".platform_devices
WHERE school_id IS NOT NULL
ON CONFLICT (device_id, school_id) DO NOTHING;

DO $binding_fixture$
DECLARE
  historical_pair_count integer;
BEGIN
  SELECT count(*) INTO historical_pair_count
  FROM "edupulse_reconciliation_rehearsal".device_school_bindings
  WHERE device_id = -63001 AND school_id IN (-61001, -61002);
  IF historical_pair_count <> 2 THEN
    RAISE EXCEPTION 'expected two distinct synthetic device/school history pairs; found %', historical_pair_count;
  END IF;
END
$binding_fixture$;

-- Guardian reconciliation rehearsal: only a uniquely matched candidate and
-- only a missing link are inserted. Name matching is trimmed/case-folded,
-- phones use digits-only normalization, and school_id is part of the match.
DO $guardian_precondition$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "edupulse_reconciliation_rehearsal".parent_student_relationships
    WHERE student_id IN (-67101, -67102, -67103)
  ) THEN
    RAISE EXCEPTION 'guardian fixtures unexpectedly began with existing links';
  END IF;
END
$guardian_precondition$;

WITH candidates AS (
  SELECT p.id AS parent_id, st.id AS student_id,
         count(*) OVER (PARTITION BY st.id) AS candidate_count
  FROM "edupulse_reconciliation_rehearsal".students st
  JOIN "edupulse_reconciliation_rehearsal".parents p
    ON p.school_id = st.school_id
   AND lower(btrim(p.name)) = lower(btrim(st.parent_name))
   AND regexp_replace(p.phone, '\D', '', 'g')
       = regexp_replace(st.parent_phone, '\D', '', 'g')
  WHERE st.parent_name IS NOT NULL AND st.parent_phone IS NOT NULL
)
INSERT INTO "edupulse_reconciliation_rehearsal".parent_student_relationships
  (parent_id, student_id, relationship_type, is_primary_guardian,
   is_emergency_contact, contact_priority, status)
SELECT c.parent_id, c.student_id, 'Guardian', true, true, 1, 'ACTIVE'
FROM candidates c
WHERE c.candidate_count = 1
  AND NOT EXISTS (
    SELECT 1 FROM "edupulse_reconciliation_rehearsal".parent_student_relationships existing
    WHERE existing.parent_id = c.parent_id AND existing.student_id = c.student_id
  )
ON CONFLICT (parent_id, student_id) DO NOTHING;

WITH candidates AS (
  SELECT p.id AS parent_id, st.id AS student_id,
         count(*) OVER (PARTITION BY st.id) AS candidate_count
  FROM "edupulse_reconciliation_rehearsal".students st
  JOIN "edupulse_reconciliation_rehearsal".parents p
    ON p.school_id = st.school_id
   AND lower(btrim(p.name)) = lower(btrim(st.parent_name))
   AND regexp_replace(p.phone, '\D', '', 'g')
       = regexp_replace(st.parent_phone, '\D', '', 'g')
  WHERE st.parent_name IS NOT NULL AND st.parent_phone IS NOT NULL
)
INSERT INTO "edupulse_reconciliation_rehearsal".parent_student_relationships
  (parent_id, student_id, relationship_type, is_primary_guardian,
   is_emergency_contact, contact_priority, status)
SELECT c.parent_id, c.student_id, 'Guardian', true, true, 1, 'ACTIVE'
FROM candidates c
WHERE c.candidate_count = 1
  AND NOT EXISTS (
    SELECT 1 FROM "edupulse_reconciliation_rehearsal".parent_student_relationships existing
    WHERE existing.parent_id = c.parent_id AND existing.student_id = c.student_id
  )
ON CONFLICT (parent_id, student_id) DO NOTHING;

DO $guardian_assertions$
DECLARE
  unique_links integer;
  ambiguous_links integer;
  school_mismatch_links integer;
BEGIN
  SELECT count(*) INTO unique_links
  FROM "edupulse_reconciliation_rehearsal".parent_student_relationships
  WHERE student_id = -67101 AND parent_id = -67001;
  SELECT count(*) INTO ambiguous_links
  FROM "edupulse_reconciliation_rehearsal".parent_student_relationships
  WHERE student_id = -67102;
  SELECT count(*) INTO school_mismatch_links
  FROM "edupulse_reconciliation_rehearsal".parent_student_relationships
  WHERE student_id = -67103;
  IF unique_links <> 1 OR ambiguous_links <> 0 OR school_mismatch_links <> 0 THEN
    RAISE EXCEPTION 'guardian candidate rehearsal mismatch: unique %, ambiguous %, cross-school %',
      unique_links, ambiguous_links, school_mismatch_links;
  END IF;
END
$guardian_assertions$;

-- LEGACY session seeding and exact same-school class reconciliation, each run
-- twice. There is deliberately no fabricated prior-class assignment.
INSERT INTO "edupulse_reconciliation_rehearsal".academic_sessions
  (school_id, name, start_date, end_date, status, is_current)
SELECT id, 'LEGACY', CURRENT_DATE, CURRENT_DATE, 'COMPLETED', false
FROM "edupulse_reconciliation_rehearsal".schools
WHERE id IN (-61001, -61002)
ON CONFLICT (school_id, name) DO NOTHING;
INSERT INTO "edupulse_reconciliation_rehearsal".academic_sessions
  (school_id, name, start_date, end_date, status, is_current)
SELECT id, 'LEGACY', CURRENT_DATE, CURRENT_DATE, 'COMPLETED', false
FROM "edupulse_reconciliation_rehearsal".schools
WHERE id IN (-61001, -61002)
ON CONFLICT (school_id, name) DO NOTHING;

INSERT INTO "edupulse_reconciliation_rehearsal".student_class_assignments
  (school_id, student_id, academic_session_id, school_class_id, section,
   status, is_current, start_date)
SELECT st.school_id, st.id, s.id, sc.id, st.section,
       CASE WHEN upper(st.status) = 'ACTIVE' THEN 'ACTIVE' ELSE upper(st.status) END,
       upper(st.status) = 'ACTIVE', st.joined_at::date
FROM "edupulse_reconciliation_rehearsal".students st
JOIN "edupulse_reconciliation_rehearsal".school_classes sc
  ON sc.school_id = st.school_id
 AND sc.name = st.class_name
 AND sc.section = st.section
JOIN "edupulse_reconciliation_rehearsal".academic_sessions s
  ON s.school_id = st.school_id AND s.name = 'LEGACY'
WHERE st.id IN (-67101, -67104)
  AND NOT EXISTS (
    SELECT 1 FROM "edupulse_reconciliation_rehearsal".student_class_assignments a
    WHERE a.student_id = st.id AND a.academic_session_id = s.id
  );

INSERT INTO "edupulse_reconciliation_rehearsal".student_class_assignments
  (school_id, student_id, academic_session_id, school_class_id, section,
   status, is_current, start_date)
SELECT st.school_id, st.id, s.id, sc.id, st.section,
       CASE WHEN upper(st.status) = 'ACTIVE' THEN 'ACTIVE' ELSE upper(st.status) END,
       upper(st.status) = 'ACTIVE', st.joined_at::date
FROM "edupulse_reconciliation_rehearsal".students st
JOIN "edupulse_reconciliation_rehearsal".school_classes sc
  ON sc.school_id = st.school_id
 AND sc.name = st.class_name
 AND sc.section = st.section
JOIN "edupulse_reconciliation_rehearsal".academic_sessions s
  ON s.school_id = st.school_id AND s.name = 'LEGACY'
WHERE st.id IN (-67101, -67104)
  AND NOT EXISTS (
    SELECT 1 FROM "edupulse_reconciliation_rehearsal".student_class_assignments a
    WHERE a.student_id = st.id AND a.academic_session_id = s.id
  );

DO $legacy_class_assertions$
DECLARE
  legacy_count integer;
  exact_count integer;
  unmatched_count integer;
BEGIN
  SELECT count(*) INTO legacy_count
  FROM "edupulse_reconciliation_rehearsal".academic_sessions
  WHERE name = 'LEGACY' AND school_id IN (-61001, -61002);
  SELECT count(*) INTO exact_count
  FROM "edupulse_reconciliation_rehearsal".student_class_assignments
  WHERE student_id = -67101
    AND academic_session_id = (
      SELECT id FROM "edupulse_reconciliation_rehearsal".academic_sessions
      WHERE school_id = -61001 AND name = 'LEGACY'
    )
    AND school_class_id = -67020
    AND section = 'A';
  SELECT count(*) INTO unmatched_count
  FROM "edupulse_reconciliation_rehearsal".student_class_assignments
  WHERE student_id = -67104;
  IF legacy_count <> 2 OR exact_count <> 1 OR unmatched_count <> 0 THEN
    RAISE EXCEPTION 'LEGACY/class fixture mismatch: sessions %, exact assignments %, unmatched assignments %',
      legacy_count, exact_count, unmatched_count;
  END IF;
END
$legacy_class_assertions$;

-- Reviewed 0003 default commission-rule seed, run twice with the migration's
-- guard. Exact reviewed allocation amounts and one ACTIVE NULL-term rule required.
INSERT INTO "edupulse_reconciliation_rehearsal".commission_rules
  (name, status, term, currency, calculation_basis, effective_at,
   partner_rate, allocation_total, partner_amount, school_amount, edupulse_amount)
SELECT 'Default partner referral', 'ACTIVE', NULL, 'NGN',
       'PER_ELIGIBLE_STUDENT_PER_TERM', NOW(), 100, 5000, 100, 2000, 2900
WHERE NOT EXISTS (
  SELECT 1 FROM "edupulse_reconciliation_rehearsal".commission_rules
  WHERE status = 'ACTIVE' AND term IS NULL
);
INSERT INTO "edupulse_reconciliation_rehearsal".commission_rules
  (name, status, term, currency, calculation_basis, effective_at,
   partner_rate, allocation_total, partner_amount, school_amount, edupulse_amount)
SELECT 'Default partner referral', 'ACTIVE', NULL, 'NGN',
       'PER_ELIGIBLE_STUDENT_PER_TERM', NOW(), 100, 5000, 100, 2000, 2900
WHERE NOT EXISTS (
  SELECT 1 FROM "edupulse_reconciliation_rehearsal".commission_rules
  WHERE status = 'ACTIVE' AND term IS NULL
);
DO $commission_seed_assertion$
DECLARE
  seed_count integer;
BEGIN
  SELECT count(*) INTO seed_count
  FROM "edupulse_reconciliation_rehearsal".commission_rules
  WHERE status = 'ACTIVE' AND term IS NULL
    AND name = 'Default partner referral'
    AND currency = 'NGN'
    AND calculation_basis = 'PER_ELIGIBLE_STUDENT_PER_TERM'
    AND partner_rate = 100
    AND allocation_total = 5000
    AND partner_amount = 100
    AND school_amount = 2000
    AND edupulse_amount = 2900;
  IF seed_count <> 1 THEN
    RAISE EXCEPTION 'expected one exact reviewed ACTIVE NULL-term commission seed; found %', seed_count;
  END IF;
END
$commission_seed_assertion$;

-- The payment fixture satisfies the new tenant FKs and VERIFIED evidence checks.
INSERT INTO "edupulse_reconciliation_rehearsal".academic_sessions
  (id, school_id, name, start_date, end_date)
VALUES (-65001, -61001, 'REHEARSAL SESSION', DATE '2026-01-01', DATE '2026-12-31');
INSERT INTO "edupulse_reconciliation_rehearsal".academic_terms
  (id, school_id, academic_session_id, name, start_date, end_date)
VALUES (-65002, -61001, -65001, 'REHEARSAL TERM', DATE '2026-01-01', DATE '2026-12-31');
INSERT INTO "edupulse_reconciliation_rehearsal".students
  (id, school_id, admission_no, first_name, last_name, gender, class_name, section)
VALUES (-65003, -61001, 'REHEARSAL_STUDENT_65003', 'Fixture', 'Student', 'OTHER', 'Fixture Class', 'A');
INSERT INTO "edupulse_reconciliation_rehearsal".fee_invoices
  (id, school_id, student_id, academic_session_id, academic_term_id,
   invoice_number, student_name_snapshot, admission_no_snapshot,
   class_name_snapshot, section_snapshot, issue_date, due_date,
   subtotal_minor, discount_minor, waiver_minor, total_minor,
   paid_minor, outstanding_minor, created_by)
VALUES
  (-65004, -61001, -65003, -65001, -65002, 'REHEARSAL_INVOICE_65004',
   'Fixture Student', 'REHEARSAL_STUDENT_65003', 'Fixture Class', 'A',
   DATE '2026-01-01', DATE '2026-12-31', 100, 0, 0, 100, 0, 100, -62001);
INSERT INTO "edupulse_reconciliation_rehearsal".fee_payments
  (id, school_id, invoice_id, student_id, reference, idempotency_key,
   amount_minor, method, transfer_bank, transfer_reference, transfer_date,
   submitted_by)
VALUES
  (-65005, -61001, -65004, -65003, 'REHEARSAL_PAYMENT_65005',
   'REHEARSAL_IDEMPOTENCY_65005', 100, 'BANK_TRANSFER',
   'Fixture Bank', 'Fixture Transfer 65005', DATE '2026-01-02', -62001);
UPDATE "edupulse_reconciliation_rehearsal".fee_payments
SET status = 'VERIFIED',
    verified_by = -62002,
    verified_at = TIMESTAMPTZ '2026-01-03 12:00:00+00',
    verification_evidence_ref = 'fixture-evidence-65005',
    reviewer_notes = 'synthetic immutable fixture',
    verification_metadata = '{"source":"synthetic rehearsal"}'::jsonb
WHERE id = -65005;

DO $fee_guard_fixture$
DECLARE
  field_name text;
  rejected boolean;
BEGIN
  FOREACH field_name IN ARRAY ARRAY[
    'verification_evidence_ref',
    'reviewer_notes',
    'verification_metadata',
    'verified_by',
    'verified_at'
  ] LOOP
    rejected := false;
    BEGIN
      CASE field_name
        WHEN 'verification_evidence_ref' THEN
          UPDATE "edupulse_reconciliation_rehearsal".fee_payments
          SET verification_evidence_ref = 'tampered-evidence'
          WHERE id = -65005;
        WHEN 'reviewer_notes' THEN
          UPDATE "edupulse_reconciliation_rehearsal".fee_payments
          SET reviewer_notes = 'tampered-note'
          WHERE id = -65005;
        WHEN 'verification_metadata' THEN
          UPDATE "edupulse_reconciliation_rehearsal".fee_payments
          SET verification_metadata = '{"tampered":true}'::jsonb
          WHERE id = -65005;
        WHEN 'verified_by' THEN
          UPDATE "edupulse_reconciliation_rehearsal".fee_payments
          SET verified_by = -62001
          WHERE id = -65005;
        WHEN 'verified_at' THEN
          UPDATE "edupulse_reconciliation_rehearsal".fee_payments
          SET verified_at = TIMESTAMPTZ '2026-01-04 12:00:00+00'
          WHERE id = -65005;
      END CASE;
      RAISE EXCEPTION 'verification metadata mutation unexpectedly succeeded: %', field_name;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'verified payment metadata is immutable' THEN
        rejected := true;
      ELSIF SQLERRM LIKE 'verification metadata mutation unexpectedly succeeded:%' THEN
        RAISE;
      ELSE
        RAISE;
      END IF;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION 'verification metadata guard did not reject field %', field_name;
    END IF;
  END LOOP;
END
$fee_guard_fixture$;

-- Parent rows exist only so all three operation-history tables can be tested
-- through their real FK and append-only trigger paths.
INSERT INTO "edupulse_reconciliation_rehearsal".school_operation_categories
  (id, school_id, category_type, name, created_by_user_id)
VALUES
  (-66001, -61001, 'ASSET', 'Fixture asset category', -62001),
  (-66002, -61001, 'MAINTENANCE', 'Fixture maintenance category', -62001),
  (-66003, -61001, 'TASK', 'Fixture task category', -62001),
  (-66010, -61002, 'TASK', 'Prior-school task category', -62001);

DO $category_fk_fixture$
DECLARE
  rejected boolean;
BEGIN
  rejected := false;
  BEGIN
    INSERT INTO "edupulse_reconciliation_rehearsal".operational_tasks
      (id, school_id, category_id, category_type, title, created_by_user_id)
    VALUES
      (-66101, -61001, -66002, 'TASK', 'Wrong category type fixture', -62001);
    RAISE EXCEPTION 'wrong category type unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  WHEN raise_exception THEN
    IF SQLERRM = 'wrong category type unexpectedly succeeded' THEN
      RAISE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'wrong category type was not rejected by its composite FK';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "edupulse_reconciliation_rehearsal".operational_tasks
      (id, school_id, category_id, category_type, title, created_by_user_id)
    VALUES
      (-66102, -61001, -66010, 'TASK', 'Wrong category tenant fixture', -62001);
    RAISE EXCEPTION 'wrong category tenant unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  WHEN raise_exception THEN
    IF SQLERRM = 'wrong category tenant unexpectedly succeeded' THEN
      RAISE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'wrong category tenant was not rejected by its composite FK';
  END IF;
END
$category_fk_fixture$;

INSERT INTO "edupulse_reconciliation_rehearsal".school_assets
  (id, school_id, category_id, category_type, asset_code, name, created_by_user_id)
VALUES (-66004, -61001, -66001, 'ASSET', 'REHEARSAL_ASSET_66004', 'Fixture asset', -62001);
INSERT INTO "edupulse_reconciliation_rehearsal".maintenance_requests
  (id, school_id, category_id, category_type, title, description, reported_by_user_id)
VALUES
  (-66005, -61001, -66002, 'MAINTENANCE', 'Fixture request', 'Synthetic rehearsal request', -62001);
INSERT INTO "edupulse_reconciliation_rehearsal".operational_tasks
  (id, school_id, category_id, category_type, title, created_by_user_id)
VALUES (-66006, -61001, -66003, 'TASK', 'Fixture task', -62001);
INSERT INTO "edupulse_reconciliation_rehearsal".school_asset_history
  (id, school_id, asset_id, event_type, actor_user_id)
VALUES (-66007, -61001, -66004, 'CREATED', -62001);
INSERT INTO "edupulse_reconciliation_rehearsal".maintenance_request_status_history
  (id, school_id, maintenance_request_id, to_status, actor_user_id)
VALUES (-66008, -61001, -66005, 'OPEN', -62001);
INSERT INTO "edupulse_reconciliation_rehearsal".operational_task_status_history
  (id, school_id, task_id, to_status, actor_user_id)
VALUES (-66009, -61001, -66006, 'OPEN', -62001);

DO $append_only_fixture$
DECLARE
  table_name text;
  operation text;
  rejected boolean;
  target_id integer;
  expected_message text;
BEGIN
  FOREACH operation IN ARRAY ARRAY['UPDATE', 'DELETE'] LOOP
    rejected := false;
    BEGIN
      IF operation = 'UPDATE' THEN
        UPDATE "edupulse_reconciliation_rehearsal".device_school_bindings
        SET created_at = created_at
        WHERE device_id = -63001 AND school_id = -61002;
      ELSE
        DELETE FROM "edupulse_reconciliation_rehearsal".device_school_bindings
        WHERE device_id = -63001 AND school_id = -61002;
      END IF;
      RAISE EXCEPTION 'device binding % unexpectedly succeeded', operation;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'device_school_bindings is append-only' THEN
        rejected := true;
      ELSIF SQLERRM LIKE 'device binding % unexpectedly succeeded' THEN
        RAISE;
      ELSE
        RAISE;
      END IF;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION 'device binding % guard did not reject mutation', operation;
    END IF;
  END LOOP;

  rejected := false;
  BEGIN
    -- CASCADE gets past PostgreSQL's dependent-FK precheck so this tests the
    -- actual BEFORE TRUNCATE guard; every dependent table is rehearsal-only.
    EXECUTE 'TRUNCATE TABLE "edupulse_reconciliation_rehearsal".device_school_bindings CASCADE';
    RAISE EXCEPTION 'device binding TRUNCATE unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'device_school_bindings is append-only' THEN
      rejected := true;
    ELSIF SQLERRM = 'device binding TRUNCATE unexpectedly succeeded' THEN
      RAISE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'device binding TRUNCATE guard did not reject mutation';
  END IF;

  FOR table_name, target_id IN
    SELECT * FROM (VALUES
      ('school_asset_history', -66007),
      ('maintenance_request_status_history', -66008),
      ('operational_task_status_history', -66009)
    ) AS history_targets(table_name, target_id)
  LOOP
    FOREACH operation IN ARRAY ARRAY['UPDATE', 'DELETE'] LOOP
      rejected := false;
      expected_message := 'Operations history is append-only';
      BEGIN
        IF operation = 'UPDATE' THEN
          EXECUTE format(
            'UPDATE "edupulse_reconciliation_rehearsal".%I SET id = id WHERE id = $1',
            table_name
          ) USING target_id;
        ELSE
          EXECUTE format(
            'DELETE FROM "edupulse_reconciliation_rehearsal".%I WHERE id = $1',
            table_name
          ) USING target_id;
        END IF;
        RAISE EXCEPTION 'operations history % unexpectedly succeeded on %', operation, table_name;
      EXCEPTION WHEN SQLSTATE '55000' THEN
        IF SQLERRM = expected_message THEN
          rejected := true;
        ELSE
          RAISE;
        END IF;
      WHEN raise_exception THEN
        IF SQLERRM LIKE 'operations history % unexpectedly succeeded on %' THEN
          RAISE;
        ELSE
          RAISE;
        END IF;
      END;
      IF NOT rejected THEN
        RAISE EXCEPTION 'operations history % guard did not reject %', operation, table_name;
      END IF;
    END LOOP;
  END LOOP;
END
$append_only_fixture$;

ROLLBACK;
