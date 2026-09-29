-- Phase11B disposable migration/recovery fixture.
--
-- SAFETY: This fixture is intentionally restricted to a database whose name
-- begins with "phase11b_disposable_". Create and migrate a fresh local test
-- database with that prefix before applying this file. Never point it at dev
-- or production. All identities, people, and records below are synthetic.
-- The transaction commits fixture rows; to repeat, drop/recreate the isolated
-- database and apply the migrations and this fixture again.
--
-- No provider integrations or notification deliveries are invoked. Finance
-- data is an unpaid invoice only; payment/provider/webhook/refund/payout rows
-- and encrypted payout details are omitted to avoid simulating real financial
-- workflows. Partner invitations and referral tokens are omitted. Communication
-- data is in-app only; delivery, dispatch, and notification outbox rows are
-- omitted so no channel can cause a notification.

BEGIN;

DO $guard$
BEGIN
  IF left(current_database(), length('phase11b_disposable_')) <> 'phase11b_disposable_'
     OR current_user <> 'runner'
     OR current_setting('port') <> '15439'
     OR inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing Phase11B fixture outside local runner-owned disposable PostgreSQL: database "%"',
      current_database();
  END IF;
END
$guard$;

-- Two schools and isolated synthetic accounts.
INSERT INTO schools (id, code, name, city, state, status, email, school_type)
VALUES
  (911101, 'P11B-DISP-A', 'Fixture North School', 'Testville', 'Test State', 'active', 'school-a@phase11b.invalid', 'SECONDARY'),
  (911102, 'P11B-DISP-B', 'Fixture South School', 'Sampleton', 'Sample State', 'active', 'school-b@phase11b.invalid', 'PRIMARY');

INSERT INTO app_users (id, clerk_user_id, email, first_name, last_name, status)
VALUES
  (911001, 'phase11b-fixture-admin-a', 'admin-a@phase11b.invalid', 'Synthetic', 'Admin A', 'ACTIVE'),
  (911002, 'phase11b-fixture-parent-a', 'parent-a@phase11b.invalid', 'Synthetic', 'Parent A', 'ACTIVE'),
  (911003, 'phase11b-fixture-student-a', 'student-a@phase11b.invalid', 'Synthetic', 'Student A', 'ACTIVE'),
  (911004, 'phase11b-fixture-teacher-a', 'teacher-a@phase11b.invalid', 'Synthetic', 'Teacher A', 'ACTIVE'),
  (911005, 'phase11b-fixture-admin-b', 'admin-b@phase11b.invalid', 'Synthetic', 'Admin B', 'ACTIVE'),
  (911006, 'phase11b-fixture-parent-b', 'parent-b@phase11b.invalid', 'Synthetic', 'Parent B', 'ACTIVE'),
  (911007, 'phase11b-fixture-student-b', 'student-b@phase11b.invalid', 'Synthetic', 'Student B', 'ACTIVE'),
  (911008, 'phase11b-fixture-teacher-b', 'teacher-b@phase11b.invalid', 'Synthetic', 'Teacher B', 'ACTIVE');

INSERT INTO school_memberships (id, user_id, school_id, role, status)
VALUES
  (911011, 911001, 911101, 'SCHOOL_ADMIN', 'ACTIVE'),
  (911012, 911004, 911101, 'TEACHER', 'ACTIVE'),
  (911013, 911005, 911102, 'SCHOOL_ADMIN', 'ACTIVE'),
  (911014, 911008, 911102, 'TEACHER', 'ACTIVE');

INSERT INTO school_classes (id, school_id, name, section, class_teacher, capacity)
VALUES
  (911201, 911101, 'Year 7', 'A', 'Synthetic Teacher A', 30),
  (911202, 911102, 'Primary 5', 'B', 'Synthetic Teacher B', 25);

INSERT INTO students (id, school_id, user_id, admission_no, first_name, last_name, gender, class_name, section, status)
VALUES
  (911501, 911101, 911003, 'DISP-A-001', 'Synthetic', 'Student A', 'OTHER', 'Year 7', 'A', 'active'),
  (911502, 911102, 911007, 'DISP-B-001', 'Synthetic', 'Student B', 'OTHER', 'Primary 5', 'B', 'active');

INSERT INTO parents (id, school_id, user_id, name, email, phone, address, status)
VALUES
  (911601, 911101, 911002, 'Synthetic Parent A', 'parent-a@phase11b.invalid', '0000000001', 'Fixture address A', 'ACTIVE'),
  (911602, 911102, 911006, 'Synthetic Parent B', 'parent-b@phase11b.invalid', '0000000002', 'Fixture address B', 'ACTIVE');

INSERT INTO parent_student_relationships
  (id, parent_id, student_id, relationship_type, is_primary_guardian, is_emergency_contact, contact_priority, status)
VALUES
  (911611, 911601, 911501, 'Guardian', true, true, 1, 'ACTIVE'),
  (911612, 911602, 911502, 'Guardian', true, true, 1, 'ACTIVE');

INSERT INTO employees (id, school_id, user_id, employee_no, first_name, last_name, email, employee_type, employment_status)
VALUES
  (911301, 911101, 911004, 'DISP-EMP-A', 'Synthetic', 'Teacher A', 'teacher-a@phase11b.invalid', 'TEACHER', 'ACTIVE'),
  (911302, 911102, 911008, 'DISP-EMP-B', 'Synthetic', 'Teacher B', 'teacher-b@phase11b.invalid', 'TEACHER', 'ACTIVE');

-- Academic sessions, terms, subjects, assignments, and class rosters.
INSERT INTO academic_sessions (id, school_id, name, start_date, end_date, status, is_current)
VALUES
  (911401, 911101, 'Fixture Session A', '2024-09-01', '2025-07-31', 'ACTIVE', true),
  (911402, 911102, 'Fixture Session B', '2024-09-01', '2025-07-31', 'ACTIVE', true);

INSERT INTO academic_terms (id, school_id, academic_session_id, name, start_date, end_date, status, is_current)
VALUES
  (911411, 911101, 911401, 'Fixture Term A', '2024-09-01', '2024-12-20', 'ACTIVE', true),
  (911412, 911102, 911402, 'Fixture Term B', '2024-09-01', '2024-12-20', 'ACTIVE', true);

INSERT INTO student_class_assignments
  (id, school_id, student_id, academic_session_id, academic_term_id, school_class_id, section, status, is_current)
VALUES
  (911421, 911101, 911501, 911401, 911411, 911201, 'A', 'ACTIVE', true),
  (911422, 911102, 911502, 911402, 911412, 911202, 'B', 'ACTIVE', true);

INSERT INTO subjects (id, school_id, name, code, status)
VALUES
  (911431, 911101, 'Fixture Mathematics A', 'DISP-MATH-A', 'ACTIVE'),
  (911432, 911102, 'Fixture Mathematics B', 'DISP-MATH-B', 'ACTIVE');

INSERT INTO class_subjects
  (id, school_id, school_class_id, subject_id, academic_session_id, academic_term_id, employee_id, section, status)
VALUES
  (911441, 911101, 911201, 911431, 911401, 911411, 911301, 'A', 'ACTIVE'),
  (911442, 911102, 911202, 911432, 911402, 911412, 911302, 'B', 'ACTIVE');

INSERT INTO teacher_class_assignments
  (id, school_id, employee_id, academic_session_id, school_class_id, subject_id, section, assignment_type, status)
VALUES
  (911451, 911101, 911301, 911401, 911201, 911431, 'A', 'CLASS_TEACHER', 'ACTIVE'),
  (911452, 911102, 911302, 911402, 911202, 911432, 'B', 'CLASS_TEACHER', 'ACTIVE');

INSERT INTO academic_assessment_types (id, school_id, name, code, status)
VALUES
  (911461, 911101, 'Fixture Quiz A', 'DISP-QUIZ-A', 'ACTIVE'),
  (911462, 911102, 'Fixture Quiz B', 'DISP-QUIZ-B', 'ACTIVE');

INSERT INTO academic_assessments
  (id, school_id, academic_session_id, academic_term_id, school_class_id, section, subject_id,
   assessment_type_id, teacher_employee_id, created_by, title, description, assessment_date,
   max_score, status)
VALUES
  (911471, 911101, 911401, 911411, 911201, 'A', 911431, 911461, 911301, 911001,
   'Fixture assessment A', 'Synthetic disposable assessment.', '2024-10-01', 10, 'OPEN'),
  (911472, 911102, 911402, 911412, 911202, 'B', 911432, 911462, 911302, 911005,
   'Fixture assessment B', 'Synthetic disposable assessment.', '2024-10-01', 10, 'OPEN');

INSERT INTO academic_results
  (id, school_id, assessment_id, student_id, student_class_assignment_id, teacher_employee_id,
   academic_session_id, academic_term_id, school_class_id, section_snapshot, subject_id, score,
   max_score, grade, remark, status, created_by)
VALUES
  (911481, 911101, 911471, 911501, 911421, 911301, 911401, 911411, 911201, 'A', 911431,
   8, 10, 'B', 'Synthetic fixture result.', 'SUBMITTED', 911001),
  (911482, 911102, 911472, 911502, 911422, 911302, 911402, 911412, 911202, 'B', 911432,
   9, 10, 'A', 'Synthetic fixture result.', 'SUBMITTED', 911005);

-- Partner attribution is local data only; no invitation/referral token is live.
INSERT INTO partner_profiles (id, partner_code, type, full_name, business_name, email, status)
VALUES (911801, 'DISP-PARTNER', 'RESELLER', 'Synthetic Partner', 'Fixture Partner LLC', 'partner@phase11b.invalid', 'ACTIVE');

INSERT INTO school_partner_attributions
  (id, school_id, partner_profile_id, source, status, is_current, created_by)
VALUES
  (911811, 911101, 911801, 'FIXTURE', 'ACTIVE', true, 911001),
  (911812, 911102, 911801, 'FIXTURE', 'ACTIVE', true, 911005);

-- Synthetic pending subscriptions use the local "test" provider label only;
-- they do not contact or create a session with any payment provider.
INSERT INTO subscriptions
  (id, school_id, student_id, term, amount, school_share, edupulse_share, partner_profile_id,
   partner_share, allocation_snapshot, status, verification_status, provider, expires_at)
VALUES
  (911821, 911101, 911501, 'Fixture Term A', 12000, 5000, 6000, 911801, 1000,
   '{"synthetic":true}'::jsonb, 'pending', 'pending', 'test', '2030-01-01 00:00:00+00'),
  (911822, 911102, 911502, 'Fixture Term B', 12000, 5000, 6000, 911801, 1000,
   '{"synthetic":true}'::jsonb, 'pending', 'pending', 'test', '2030-01-01 00:00:00+00');

-- An unpaid invoice and draft fee structure exercise finance schema without
-- creating a payment, checkout, webhook, or provider reference.
INSERT INTO fee_categories (id, school_id, name, description, compulsory, status, created_by)
VALUES
  (911901, 911101, 'Fixture tuition A', 'Synthetic test fee', true, 'ACTIVE', 911001),
  (911902, 911102, 'Fixture tuition B', 'Synthetic test fee', true, 'ACTIVE', 911005);

INSERT INTO fee_structures (id, school_id, academic_session_id, academic_term_id, school_class_id, section, status, created_by)
VALUES
  (911911, 911101, 911401, 911411, 911201, 'A', 'DRAFT', 911001),
  (911912, 911102, 911402, 911412, 911202, 'B', 'DRAFT', 911005);

INSERT INTO fee_structure_lines
  (id, school_id, structure_id, category_id, category_name_snapshot, description_snapshot, amount_minor)
VALUES
  (911921, 911101, 911911, 911901, 'Fixture tuition A', 'Synthetic test fee', 10000),
  (911922, 911102, 911912, 911902, 'Fixture tuition B', 'Synthetic test fee', 12000);

INSERT INTO fee_invoices
  (id, school_id, student_id, parent_id, structure_id, academic_session_id, academic_term_id,
   invoice_number, student_name_snapshot, admission_no_snapshot, class_name_snapshot, section_snapshot,
   issue_date, due_date, subtotal_minor, total_minor, paid_minor, outstanding_minor, status, created_by)
VALUES
  (911931, 911101, 911501, 911601, 911911, 911401, 911411, 'DISP-A-INV-001', 'Synthetic Student A', 'DISP-A-001', 'Year 7', 'A',
   '2024-09-02', '2024-10-02', 10000, 10000, 0, 10000, 'UNPAID', 911001),
  (911932, 911102, 911502, 911602, 911912, 911402, 911412, 'DISP-B-INV-001', 'Synthetic Student B', 'DISP-B-001', 'Primary 5', 'B',
   '2024-09-02', '2024-10-02', 12000, 12000, 0, 12000, 'UNPAID', 911005);

INSERT INTO fee_invoice_lines (id, school_id, invoice_id, category_id, category_name_snapshot, description_snapshot, amount_minor)
VALUES
  (911941, 911101, 911931, 911901, 'Fixture tuition A', 'Synthetic test fee', 10000),
  (911942, 911102, 911932, 911902, 'Fixture tuition B', 'Synthetic test fee', 12000);

-- NFC/attendance: synthetic locally-bound readers, cards, scans, and history.
INSERT INTO platform_devices (id, serial_number, name, device_type, school_id, school_class_id, configuration_status, status)
VALUES
  (911701, 'DISP-DEVICE-A', 'Fixture Reader A', 'NFC', 911101, 911201, 'CONFIGURED', 'ACTIVE'),
  (911702, 'DISP-DEVICE-B', 'Fixture Reader B', 'NFC', 911102, 911202, 'CONFIGURED', 'ACTIVE');

INSERT INTO device_school_bindings (device_id, school_id)
VALUES (911701, 911101), (911702, 911102);

INSERT INTO nfc_cards (id, school_id, uid, student_id, status, scans, issued_at, activated_at, last_device_id)
VALUES
  (911711, 911101, 'DISP-CARD-A-001', 911501, 'active', 1, '2024-09-02 08:00:00+00', '2024-09-02 08:01:00+00', 911701),
  (911712, 911102, 'DISP-CARD-B-001', 911502, 'active', 1, '2024-09-02 08:00:00+00', '2024-09-02 08:01:00+00', 911702);

INSERT INTO nfc_card_history (id, school_id, nfc_card_id, student_id, action, previous_status, new_status, reason, actor_user_id)
VALUES
  (911721, 911101, 911711, 911501, 'ISSUED', NULL, 'active', 'Synthetic fixture issuance', 911001),
  (911722, 911102, 911712, 911502, 'ISSUED', NULL, 'active', 'Synthetic fixture issuance', 911005);

INSERT INTO attendance_settings (id, school_id, notify_on_entry, notify_on_exit, notify_on_discrepancy)
VALUES (911731, 911101, false, false, false), (911732, 911102, false, false, false);

INSERT INTO attendance_events
  (id, school_id, student_id, device_id, nfc_card_id, identification_method, event_type, result,
   attendance_status, event_date, occurred_at, academic_session_id, academic_term_id, school_class_id,
   class_name_snapshot, section_snapshot, actor_user_id, dedupe_key)
VALUES
  (911741, 911101, 911501, 911701, 911711, 'NFC', 'ENTRY', 'SUCCESS', 'PRESENT', '2024-09-03',
   '2024-09-03 08:10:00+00', 911401, 911411, 911201, 'Year 7', 'A', 911001, 'phase11b-fixture-a-entry'),
  (911742, 911102, 911502, 911702, 911712, 'NFC', 'ENTRY', 'SUCCESS', 'PRESENT', '2024-09-03',
   '2024-09-03 08:12:00+00', 911402, 911412, 911202, 'Primary 5', 'B', 911005, 'phase11b-fixture-b-entry');

-- Communication records are in-app only; intentionally no delivery/outbox rows.
INSERT INTO communication_notifications
  (id, recipient_user_id, school_id, subject_student_id, sender_user_id, category, subject, body)
VALUES
  (911951, 911002, 911101, 911501, 911001, 'ANNOUNCEMENT', 'Fixture notice A', 'Synthetic local in-app notice.'),
  (911952, 911006, 911102, 911502, 911005, 'ANNOUNCEMENT', 'Fixture notice B', 'Synthetic local in-app notice.');

-- Library catalogue and a copy per school; no borrowing notifications.
INSERT INTO library_authors (id, school_id, name, created_by_user_id)
VALUES (911961, 911101, 'Synthetic Author A', 911001), (911962, 911102, 'Synthetic Author B', 911005);

INSERT INTO library_publishers (id, school_id, name, created_by_user_id)
VALUES (911971, 911101, 'Fixture Publisher A', 911001), (911972, 911102, 'Fixture Publisher B', 911005);

INSERT INTO library_categories (id, school_id, name, created_by_user_id)
VALUES (911981, 911101, 'Fixture Reading A', 911001), (911982, 911102, 'Fixture Reading B', 911005);

INSERT INTO library_books
  (id, school_id, title, author_id, publisher_id, category_id, publication_year, status, created_by_user_id)
VALUES
  (911991, 911101, 'Synthetic Book A', 911961, 911971, 911981, 2020, 'ACTIVE', 911001),
  (911992, 911102, 'Synthetic Book B', 911962, 911972, 911982, 2021, 'ACTIVE', 911005);

INSERT INTO library_book_copies (id, school_id, book_id, copy_code, condition, status, created_by_user_id)
VALUES
  (912001, 911101, 911991, 'DISP-COPY-A-001', 'GOOD', 'AVAILABLE', 911001),
  (912002, 911102, 911992, 'DISP-COPY-B-001', 'GOOD', 'AVAILABLE', 911005);

-- Operations assets, facilities, and a task, all tied to their owning school.
INSERT INTO school_operation_categories (id, school_id, category_type, name, created_by_user_id)
VALUES
  (912011, 911101, 'ASSET', 'Fixture equipment A', 911001),
  (912012, 911102, 'ASSET', 'Fixture equipment B', 911005),
  (912013, 911101, 'TASK', 'Fixture task A', 911001),
  (912014, 911102, 'TASK', 'Fixture task B', 911005);

INSERT INTO school_assets
  (id, school_id, category_id, category_type, asset_code, name, quantity, unit, condition, status, created_by_user_id)
VALUES
  (912021, 911101, 912011, 'ASSET', 'DISP-ASSET-A', 'Synthetic classroom projector A', 1, 'item', 'GOOD', 'AVAILABLE', 911001),
  (912022, 911102, 912012, 'ASSET', 'DISP-ASSET-B', 'Synthetic classroom projector B', 1, 'item', 'GOOD', 'AVAILABLE', 911005);

INSERT INTO school_facilities (id, school_id, name, facility_type, condition, capacity, status, created_by_user_id)
VALUES
  (912031, 911101, 'Fixture Hall A', 'HALL', 'GOOD', 40, 'ACTIVE', 911001),
  (912032, 911102, 'Fixture Hall B', 'HALL', 'GOOD', 35, 'ACTIVE', 911005);

INSERT INTO operational_tasks
  (id, school_id, category_id, category_type, title, description, created_by_user_id, priority, status)
VALUES
  (912041, 911101, 912013, 'TASK', 'Fixture safety check A', 'Synthetic local task.', 911001, 'LOW', 'OPEN'),
  (912042, 911102, 912014, 'TASK', 'Fixture safety check B', 'Synthetic local task.', 911005, 'LOW', 'OPEN');

-- Audit rows preserve a small sample of tenant-scoped change history.
INSERT INTO audit_logs (id, "user", role, actor_user_id, clerk_user_id, school_id, action, module, record_id, severity, event_type, result, metadata)
VALUES
  (912051, 'admin-a@phase11b.invalid', 'SCHOOL_ADMIN', 911001, 'phase11b-fixture-admin-a', 911101,
   'FIXTURE_SEED', 'PHASE11B_DISPOSABLE', 911501, 'info', 'APPLICATION_EVENT', 'SUCCESS', '{"synthetic":true,"fixture":"phase11b"}'::jsonb),
  (912052, 'admin-b@phase11b.invalid', 'SCHOOL_ADMIN', 911005, 'phase11b-fixture-admin-b', 911102,
   'FIXTURE_SEED', 'PHASE11B_DISPOSABLE', 911502, 'info', 'APPLICATION_EVENT', 'SUCCESS', '{"synthetic":true,"fixture":"phase11b"}'::jsonb);

-- Advance serial sequences past explicit fixture IDs so subsequent test inserts
-- do not collide. Only tables populated by this fixture are included.
DO $sequences$
DECLARE
  t text;
  seq_name text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'schools', 'app_users', 'school_memberships', 'school_classes', 'students',
    'parents', 'parent_student_relationships', 'employees', 'academic_sessions',
    'academic_terms', 'student_class_assignments', 'subjects', 'class_subjects',
    'teacher_class_assignments', 'academic_assessment_types', 'academic_assessments',
    'academic_results', 'partner_profiles', 'school_partner_attributions', 'subscriptions',
    'fee_categories', 'fee_structures', 'fee_structure_lines', 'fee_invoices',
    'fee_invoice_lines', 'platform_devices', 'nfc_cards', 'nfc_card_history',
    'attendance_settings', 'attendance_events', 'communication_notifications',
    'library_authors', 'library_publishers', 'library_categories', 'library_books',
    'library_book_copies', 'school_operation_categories', 'school_assets',
    'school_facilities', 'operational_tasks', 'audit_logs'
  ]
  LOOP
    seq_name := pg_get_serial_sequence(format('%I.%I', current_schema(), t), 'id');
    IF seq_name IS NOT NULL THEN
      EXECUTE format(
        'SELECT setval(%L, (SELECT GREATEST(COALESCE(MAX(id), 1), 1) FROM %I.%I), true)',
        seq_name, current_schema(), t
      );
    END IF;
  END LOOP;
END
$sequences$;

COMMIT;