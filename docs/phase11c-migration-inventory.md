# Phase 11C — SQL migration inventory

## Scope and counting

This is a source inventory of the checked-in PostgreSQL SQL files in `lib/db/drizzle/`, ordered by their numeric prefix and cross-checked against `lib/db/drizzle/meta/_journal.json`. The journal has 31 entries, `idx` 0–30, mapped one-to-one to files `0000`–`0030`; all entries declare `breakpoints: true`. The inventory describes SQL text only. “None” means no such statement was detected in that file; it does not establish database execution history or catalog state.

Counted directly in these files: **31 migrations**, **91 `CREATE TABLE` statements**, **181 `CREATE [UNIQUE] INDEX` statements**, **3 function definitions**, **6 trigger definitions**, **0 view definitions**. There are ALTER TABLE statements throughout; every migration’s ALTER activity is identified below. Index names below include unique indexes; table-level/inline uniqueness and primary keys are described separately as constraints. Unless described otherwise, all tables have a serial/integer primary key where shown in SQL and table-level constraints noted below.

Descriptions below are deliberately limited to what the SQL creates, alters, checks, or inserts. Column lists give all columns declared or added by that migration. A FK “to X” lists its target; where a file declares multiple FKs, the specific source-to-target columns are given when useful. Inline `REFERENCES`, `UNIQUE`, `CHECK`, and primary-key clauses count as constraints even when unnamed.

---

## 0000 — `lib/db/drizzle/0000_brainy_moon_knight.sql`

- **SQL description:** Creates the initial user, school, membership, parent/student, class, NFC-card, subscription, and audit-log structures; inserts relationship rows by matching parent/student school, normalized names, and normalized phone numbers.
- **Tables and columns created:**
  - `app_users`: `id, clerk_user_id, email, first_name, last_name, phone, status, created_at, updated_at`.
  - `audit_logs`: `id, user, role, actor_user_id, clerk_user_id, school_id, action, module, record_id, timestamp, severity, event_type, result, metadata`.
  - `nfc_cards`: `id, school_id, uid, student_id, status, scans, last_scan`.
  - `parent_student_relationships`: `id, parent_id, student_id, relationship_type, is_primary_guardian, is_emergency_contact, contact_priority, status, created_at, updated_at`.
  - `parents`: `id, school_id, user_id, name, email, phone`.
  - `school_classes`: `id, school_id, name, section, class_teacher, capacity`.
  - `school_memberships`: `id, user_id, school_id, role, status, created_at, updated_at`.
  - `schools`: `id, code, name, city, state, status, created_at`.
  - `students`: `id, school_id, user_id, admission_no, first_name, last_name, gender, class_name, section, parent_name, parent_phone, status, joined_at`.
  - `subscriptions`: `id, school_id, student_id, term, amount, school_share, edupulse_share, status, verification_status, provider, provider_reference, expires_at, created_at`.
- **Indexes:** `app_users_clerk_user_id_unique` (unique), `app_users_email_idx`, `audit_logs_school_idx`, `nfc_cards_uid_unique` (unique), `nfc_cards_school_idx`, `parent_student_relationship_unique` (unique), `parent_student_relationship_parent_idx`, `parent_student_relationship_student_idx`, `parents_user_unique` (unique), `parents_school_idx`, `school_classes_unique` (unique), `school_memberships_user_school_role_unique` (unique), `school_memberships_platform_role_unique` (unique partial where `school_id IS NULL`), `school_memberships_user_idx`, `school_memberships_school_idx`, `schools_code_unique` (unique), `students_school_admission_unique` (unique), `students_user_unique` (unique), `students_school_idx`, `subscriptions_school_idx`, `subscriptions_provider_reference_unique` (unique).
- **Constraints:** primary keys on all created tables; FKs `audit_logs.actor_user_id→app_users.id`, `audit_logs.school_id→schools.id`, `nfc_cards.school_id→schools.id`, `nfc_cards.student_id→students.id`, `parent_student_relationships.parent_id→parents.id`, `parent_student_relationships.student_id→students.id`, `parents.school_id→schools.id`, `parents.user_id→app_users.id`, `school_classes.school_id→schools.id`, `school_memberships.user_id→app_users.id`, `school_memberships.school_id→schools.id`, `students.school_id→schools.id`, `students.user_id→app_users.id`, `subscriptions.school_id→schools.id`, `subscriptions.student_id→students.id`. Unique constraints are represented by the indexes listed above; no separate CHECK constraint is declared.
- **Triggers/functions/views:** None.
- **Backfill/data statements:** `INSERT INTO parent_student_relationships … SELECT` links matching parents and students, assigning `Guardian`, primary/emergency true, priority 1, `ACTIVE`; requires both names/phones non-NULL and matching normalized values; `ON CONFLICT (parent_id,student_id) DO NOTHING`.
- **ALTER:** Adds the listed FKs to pre-existing tables just created in this file.
- **Potentially non-idempotent:** All unguarded `CREATE TABLE`, FK adds, and ordinary/unique index creates fail if objects already exist. The relationship insert has an `ON CONFLICT` guard for an existing parent/student pair.
- **Predecessor dependencies:** None detected; this is the first journaled migration. Its declared FKs refer to tables created in this file.

## 0001 — `lib/db/drizzle/0001_phase3_meta.sql`

- **SQL description:** Creates academic-session/term, employee, subject, class-subject, student-assignment, and teacher-assignment tables; adds academic/profile columns to parents, schools, and students; adds indexes and FKs; seeds one `LEGACY` session per school and assignments for students that match a class.
- **Tables and columns created:**
  - `academic_sessions`: `id, school_id, name, start_date, end_date, status, is_current, created_at, updated_at`.
  - `academic_terms`: `id, school_id, academic_session_id, name, start_date, end_date, status, is_current, created_at, updated_at`.
  - `class_subjects`: `id, school_id, school_class_id, subject_id, academic_session_id, academic_term_id, employee_id, section, status, created_at, updated_at`.
  - `employees`: `id, school_id, user_id, employee_no, first_name, middle_name, last_name, phone, email, address, photo, gender, employee_type, employment_status, date_employed, department, qualification, created_at, updated_at`.
  - `student_class_assignments`: `id, school_id, student_id, academic_session_id, academic_term_id, school_class_id, section, status, is_current, start_date, end_date, created_at, updated_at`.
  - `subjects`: `id, school_id, name, code, description, status, created_at, updated_at`.
  - `teacher_class_assignments`: `id, school_id, employee_id, academic_session_id, school_class_id, subject_id, section, assignment_type, status, start_date, end_date, created_at, updated_at`.
- **Columns added:** `parents.address,status,created_at,updated_at`; `schools.registration_number,address,lga,phone,email,website,logo,school_type,updated_at`; `students.middle_name,date_of_birth,photo,admission_date,admission_status,previous_school,address,medical_info,emergency_contact_name,emergency_contact_phone,created_at,updated_at`.
- **Indexes:** unique `academic_sessions_id_school_unique`, `academic_terms_id_school_unique`, `employees_id_school_unique`, `school_classes_id_school_unique`, `students_id_school_unique`, `subjects_id_school_unique`, `academic_sessions_school_name_unique`, `academic_terms_session_name_unique`, `employees_school_employee_no_unique`, `student_class_assignments_active_unique` (partial on active rows, with `COALESCE` term), `student_class_assignments_id_school_unique`, `subjects_school_code_unique`, `teacher_class_assignments_unique` (partial on active rows, with `COALESCE` subject); ordinary `academic_sessions_school_status_idx`, `academic_terms_school_status_idx`, `class_subjects_school_status_idx`, `employees_school_type_status_idx`, `student_class_assignments_school_current_idx`, `student_class_assignments_student_history_idx`, `subjects_school_status_idx`, `teacher_class_assignments_school_status_idx`; `student_class_assignments_current_unique` (unique partial where `is_current=true`); `class_subjects_unique` (unique partial on active rows with `COALESCE` term and section).
- **Constraints:** primary keys on new tables. FKs include school ownership for each new academic table; terms→sessions both by single-column and `(academic_session_id,school_id)` composite key; `class_subjects`→school class, subject, session, term, employee by single and composite school keys; employees→school and optional user; student assignments→school, student, session, optional term, class by single/composite school keys; teacher assignments→school, employee, session, class, optional subject by single/composite school keys. Composite referenced targets are the `(id,school_id)` unique indexes present or created by this migration. No CHECK constraints are declared.
- **Triggers/functions/views:** None.
- **Backfills/seeds:** Insert one completed, non-current `LEGACY` academic session for each school if absent (`ON CONFLICT (school_id,name) DO NOTHING`). Insert assignment rows by joining students to same-school class name/section and the `LEGACY` session, deriving status/current flag and `joined_at::date`, with `NOT EXISTS` per student/session.
- **ALTER:** Listed columns on three existing tables; all listed FKs; adds the `student_class_assignments_current_unique` index.
- **Potentially non-idempotent:** Unconditional table/column/index/FK creates are not rerunnable safely; seed session and assignment inserts have guards. Notably several uniqueness indexes for `(id,school_id)` are created here and recur in later migration SQL.
- **Predecessor dependencies:** Requires `0000` tables `schools, parents, students, app_users, school_classes`; references their columns and existing parent/student records.

## 0002 — `lib/db/drizzle/0002_overjoyed_sue_storm.sql`

- **SQL description:** Creates partner profiles, partner-user relationships, invitations/referral links, school attribution/conflicts, commission rules/ledger, payout information, and payout records; adds partner allocation fields to subscriptions.
- **Tables and columns created:**
  - `commission_ledger`: `id, partner_profile_id, school_id, student_id, subscription_id, commission_rule_id, academic_session_id, term, rate, count, amount, currency, status, payout_id, approved_at, payable_at, paid_at, held_at, reversed_at, cancelled_at, payment_reference, adjustment_reference, reversal_reference, created_by, created_at`.
  - `commission_rules`: `id, name, status, term, currency, calculation_basis, effective_at, ends_at, partner_rate, allocation_total, partner_amount, school_amount, edupulse_amount, created_at`.
  - `partner_attribution_conflicts`: `id, school_id, existing_partner_profile_id, attempted_partner_profile_id, referral_link_id, source, status, metadata, evidence, resolved_by, decision, resolved_at, created_at`.
  - `partner_invitations`: `id, partner_profile_id, invited_email, token_hash, status, expires_at, redeemed_at, revoked_at, created_by, created_at`.
  - `partner_payout_information`: `id, partner_profile_id, method, bank_name_encrypted, account_name_encrypted, account_number_encrypted, bank_code_encrypted, account_last4, encryption_key_version, status, created_at, updated_at`.
  - `partner_payouts`: `id, partner_profile_id, academic_session_id, term, amount, currency, status, payment_reference, payment_date, method, notes, provider, provider_reference, period_start, period_end, paid_at, reversed_at, reversal_reference, reversal_reason, created_at`.
  - `partner_profile_users`: `id, partner_profile_id, user_id, role, status, created_at`.
  - `partner_profiles`: `id, user_id, partner_code, type, full_name, business_name, email, phone, address, state, lga, registration_number, status, invited_at, registered_at, activated_at, deactivated_at, created_by, created_at, updated_at`.
  - `partner_referral_links`: `id, partner_profile_id, token_hash, status, created_by, created_at, revoked_at`.
  - `school_partner_attributions`: `id, school_id, partner_profile_id, referral_link_id, source, status, is_current, starts_at, ends_at, created_by, created_at`.
- **Columns added to `subscriptions`:** `partner_profile_id, partner_share, allocation_snapshot`.
- **Indexes:** Unique: `commission_ledger_subscription_period_unique`, `partner_invitations_token_hash_unique`, `partner_payout_information_partner_unique`, `partner_payouts_provider_reference_unique`, `partner_profile_users_unique`, `partner_profile_users_user_role_unique`, `partner_profiles_code_unique`, `partner_profiles_user_unique`, `partner_referral_links_hash_unique`, `school_partner_attributions_current_unique` (partial `is_current=true`). Ordinary: `commission_ledger_partner_status_idx`, `commission_rules_status_term_idx`, `partner_attribution_conflicts_school_status_idx`, `partner_attribution_conflicts_attempted_idx`, `partner_invitations_partner_status_idx`, `partner_payout_information_status_idx`, `partner_payouts_partner_status_idx`, `partner_profile_users_partner_idx`, `partner_profiles_email_idx`, `partner_profiles_status_idx`, `partner_referral_links_partner_status_idx`, `school_partner_attributions_school_history_idx`, `school_partner_attributions_partner_idx`, `subscriptions_partner_profile_idx`.
- **Constraints:** Primary keys. CHECKs: commission ledger nonnegative amount/positive count and status enum; commission-rule allocation amounts nonnegative and sum equal allocation total; partner payouts amount nonnegative; subscriptions partner allocation requires profile and non-NULL share and total equals school+EduCore+partner shares. FKs connect ledger to partner profile, school, student, subscription, rule, optional academic session, optional creator; attribution conflicts to school, existing/attempted profiles, optional referral link/resolver; invitations to profile/creator; payout information to profile; payouts to profile/optional session; profile users to profile/user; profiles to optional user/creator; referral links to profile/creator; school attribution to school/profile/optional referral/creator; subscriptions to optional partner profile. Other unique constraints are represented by indexes above.
- **Triggers/functions/views:** None.
- **Backfills:** None.
- **ALTER:** Adds 3 subscription columns; adds subscription partner FK and allocation CHECK.
- **Potentially non-idempotent:** Unconditional creates/additions, FKs and index creates; no guards detected.
- **Predecessor dependencies:** Requires `0000` tables `schools, students, subscriptions, app_users`; requires `0001` `academic_sessions`. Subscription allocation check references existing subscription columns `amount,school_share,edupulse_share`.

## 0003 — `lib/db/drizzle/0003_phase4_integrity.sql`

- **SQL description:** Inserts an active default partner commission rule if no active termless rule exists; adds an open-conflict uniqueness index, payout FK, and payout status check.
- **Tables/columns:** No table creation or column addition.
- **Indexes:** `partner_attribution_conflicts_open_unique` unique partial `(school_id,attempted_partner_profile_id)` where `status='OPEN'`, guarded by `IF NOT EXISTS`.
- **Constraints/FKs:** `commission_ledger.payout_id→partner_payouts.id`; `partner_payouts_status_check` allows `PENDING,PROCESSING,PAID,FAILED,REVERSED`.
- **Triggers/functions/views:** None.
- **Backfills/seeds:** Inserts default rule (`Default partner referral`, active, term NULL, NGN, `PER_ELIGIBLE_STUDENT_PER_TERM`, 100 partner rate and 5000/100/2000/2900 allocation values) only if no active termless rule exists.
- **ALTER:** Adds FK and CHECK.
- **Potentially non-idempotent:** FK/check adds are unguarded. Seed has `NOT EXISTS`; index guarded.
- **Predecessor dependencies:** Requires `0002` partner conflict, commission rules/ledger and payout tables/columns.

## 0004 — `lib/db/drizzle/0004_platform_operations.sql`

- **SQL description:** Ensures six `(id,school_id)` unique indexes, verifies/recreates one student-assignment composite FK, and creates platform device and notification tables and indexes if absent.
- **Tables/columns:** `platform_devices(id,serial_number,name,device_type,school_id,status,last_seen_at,created_at,updated_at)`; `platform_notifications(id,recipient_user_id,title,message,severity,is_read,read_at,created_at)`.
- **Indexes:** `academic_sessions_id_school_unique`, `academic_terms_id_school_unique`, `employees_id_school_unique`, `school_classes_id_school_unique`, `students_id_school_unique`, `subjects_id_school_unique` (each unique and `IF NOT EXISTS`); `platform_devices_school_idx`, `platform_notifications_recipient_idx` (`IF NOT EXISTS`).
- **Constraints:** Platform device serial unique; device type CHECK `NFC/BIOMETRIC/HYBRID`, status CHECK `ACTIVE/INACTIVE/MAINTENANCE`; notification severity CHECK `info/warning/critical`. `student_class_assignments_class_school_fk` is dropped if present and recreated as FK `(school_class_id,school_id)→school_classes(id,school_id)` using `NOT VALID`, then validated. A preceding DO block counts same-school class mismatches and raises with mismatch count before changing that FK if any exist.
- **Triggers/functions/views:** None.
- **Backfills:** None.
- **ALTER:** `CREATE TABLE IF NOT EXISTS` definitions; unique indexes; drop/add/validate assignment FK.
- **Potentially non-idempotent:** Tables and indexes are guarded. The FK repair is conditionally safe for absent old FK but unguarded add when executed and may reject duplicate existing named objects outside the preceding drop path. DO raises on mismatched data. Existing table definition is not reconciled by `IF NOT EXISTS`.
- **Predecessor dependencies:** Requires `0001` academic/session/class/student/employee/subject objects and assignment FK; `0000` schools/users.

## 0005 — `lib/db/drizzle/0005_tenant_reference_keys.sql`

- **SQL description:** Adds named unique constraints on six `(id,school_id)` key pairs.
- **Tables/columns:** No table creation or column addition; alters `school_classes, academic_sessions, academic_terms, students, employees, subjects`, columns `(id,school_id)`.
- **Indexes:** PostgreSQL creates backing unique indexes for constraints; no explicit `CREATE INDEX`.
- **Constraints:** Adds `school_classes_id_school_tenant_key`, `academic_sessions_id_school_tenant_key`, `academic_terms_id_school_tenant_key`, `students_id_school_tenant_key`, `employees_id_school_tenant_key`, `subjects_id_school_tenant_key` as UNIQUE.
- **Triggers/functions/views/backfills:** None.
- **ALTER:** Six `ALTER TABLE … ADD CONSTRAINT`.
- **Potentially non-idempotent:** All six adds are unguarded and fail when named constraints already exist.
- **Predecessor dependencies:** Requires the six tables/columns, created/modified by `0000`/`0001`; compatible unique `(id,school_id)` indexes are created earlier, including in `0001` and `0004`.

## 0006 — `lib/db/drizzle/0006_prepare_tenant_keys_publish.sql`

- **SQL description:** Drops four named composite school FKs in preparation for later key changes.
- **Tables/columns:** No create/add columns; touches `student_class_assignments, class_subjects, teacher_class_assignments`.
- **Indexes/constraints:** Drops `student_class_assignments_student_school_fk`, `student_class_assignments_class_school_fk`, `class_subjects_class_school_fk`, `teacher_class_assignments_class_school_fk`. Each `DROP CONSTRAINT IF EXISTS`.
- **Triggers/functions/views/backfills:** None.
- **ALTER:** Four guarded constraint drops.
- **Potentially non-idempotent:** Drops are guarded; otherwise no unguarded creation.
- **Predecessor dependencies:** Requires those tables/constraint names from `0001` (and the `0004` repair of the assignment class FK).

## 0007 — `lib/db/drizzle/0007_restore_tenant_foreign_keys.sql`

- **SQL description:** Rebinds class/student tenant unique constraints to existing indexes, recreates legacy named indexes, and restores four composite FKs.
- **Tables/columns:** No table/column creation; touches `school_classes, students, student_class_assignments, class_subjects, teacher_class_assignments`.
- **Indexes:** Recreates unique `school_classes_id_school_unique` and `students_id_school_unique`; neither create is guarded.
- **Constraints:** Drops/re-adds `school_classes_id_school_tenant_key` using existing `school_classes_id_school_unique`; similarly students. Adds and validates FKs `student_class_assignments_student_school_fk`, `student_class_assignments_class_school_fk`, `class_subjects_class_school_fk`, `teacher_class_assignments_class_school_fk`, each composite school-key FK and initially `NOT VALID`.
- **Triggers/functions/views/backfills:** None.
- **ALTER:** Drop and re-add two unique constraints; create two unique indexes; add then validate four FKs.
- **Potentially non-idempotent:** Drops/adds and index creation are unguarded; requires exact predecessor state and may fail if names/objects differ.
- **Predecessor dependencies:** Requires `0005` named tenant constraints, preexisting legacy unique indexes (`0001`/`0004`), and the four FK targets/columns; `0006` is the explicit prerequisite that removes the affected FKs.

## 0008 — `lib/db/drizzle/0008_align_tenant_fk_dependencies.sql`

- **SQL description:** Drops four composite FKs and two named tenant keys, re-adds tenant keys and restores/validates the four FKs in a stated dependency order.
- **Tables/columns:** No table/column creation; touches same five tables as `0007`.
- **Indexes:** No explicit index statement.
- **Constraints:** Drops four FKs listed in `0006`, drops/re-adds `school_classes_id_school_tenant_key` and `students_id_school_tenant_key`; adds/validates the four composite FKs listed for `0007`.
- **Triggers/functions/views/backfills:** None.
- **ALTER:** All operations are `ALTER TABLE`, with unguarded drops/adds and `NOT VALID` then `VALIDATE` for each FK.
- **Potentially non-idempotent:** All named drops/adds are unguarded; requires the exact existing constraints.
- **Predecessor dependencies:** Requires `0007` restored FK/key structures and referenced tables/keys from `0000`/`0001`; intended to align with pre-existing uniqueness/FK dependency ordering.

## 0009 — `lib/db/drizzle/0009_phase5_attendance.sql`

- **SQL description:** Adds device location/class/configuration status and NFC card lifecycle/reference fields; creates device credentials, assignment history, identification policies, biometric enrollments, attendance settings/events/corrections/discrepancies/notification events, and NFC card history.
- **Tables/columns created:**
  - `device_credentials`: `id,school_id,device_id,credential_identifier,secret_hash,status,issued_at,last_used_at,revoked_at,expires_at,created_at`.
  - `device_assignment_history`: `id,school_id,device_id,previous_school_id,previous_location,location,action,reason,actor_user_id,created_at`.
  - `student_identification_policies`: `id,school_id,student_id,policy,effective_from,effective_to,status,created_by,created_at,updated_at`.
  - `biometric_enrollments`: `id,school_id,student_id,employee_id,device_id,provider,provider_reference,status,enrolled_at,revoked_at,metadata`.
  - `attendance_settings`: `id,school_id,entry_window_start,entry_window_end,exit_window_start,exit_window_end,classroom_window_start,classroom_window_end,duplicate_suppression_seconds,notify_on_entry,notify_on_exit,notify_on_discrepancy,created_at,updated_at`.
  - `attendance_events`: `id,school_id,student_id,employee_id,device_id,nfc_card_id,identification_method,event_type,result,attendance_status,event_date,occurred_at,academic_session_id,academic_term_id,school_class_id,class_name_snapshot,section_snapshot,reason,actor_user_id,failure_reason,dedupe_key,created_at`.
  - `attendance_corrections`: `id,school_id,attendance_event_id,original_value,corrected_value,reason,actor_user_id,created_at`.
  - `attendance_discrepancies`: `id,school_id,student_id,attendance_event_id,discrepancy_type,status,details,resolved_by,resolved_at,created_at`.
  - `attendance_notification_events`: `id,school_id,attendance_event_id,discrepancy_id,notification_type,channel,status,recipient_user_id,payload,sent_at,created_at`.
  - `nfc_card_history`: `id,school_id,nfc_card_id,student_id,action,previous_status,new_status,replaced_by_card_id,reason,actor_user_id,created_at`.
- **Columns added:** `platform_devices.location,school_class_id,configuration_status`; `nfc_cards.issued_at,activated_at,deactivated_at,expires_at,replaced_at,replaced_by_card_id,replaced_by_school_id,last_device_id`.
- **Indexes:** `platform_devices_id_school_unique`, `nfc_cards_id_school_unique`, `device_credentials_device_status_idx`, `device_assignment_history_school_idx`, `device_assignment_history_device_idx`, `student_identification_policies_student_unique` (unique), `student_identification_policies_school_idx`, `biometric_enrollments_provider_reference_unique` (unique), `biometric_enrollments_school_status_idx`, `attendance_events_school_dedupe_unique` (unique), `attendance_events_id_school_unique` (unique), `attendance_events_school_date_idx`, `attendance_events_student_idx`, `attendance_events_employee_idx`, `attendance_corrections_school_idx`, `attendance_discrepancies_id_school_unique` (unique), `attendance_discrepancies_event_kind_unique` (unique), `attendance_discrepancies_school_status_idx`, `attendance_notification_events_queue_idx`, `nfc_card_history_school_idx`, `nfc_card_history_card_idx`.
- **Constraints:** `platform_devices_status_check` is dropped if present and replaced with values `ACTIVE,INACTIVE,MAINTENANCE,SUSPENDED,UNASSIGNED`; added composite platform device→class FK `NOT VALID`. New FKs include device credentials→school/device; assignment history→school/device/optional prior school/optional actor; identification policies→school/student and composite student-school FK; biometric enrollments→school, composite student/employee/device-school keys; attendance tables’ school, student/employee/device/card/session/term/class/user keys, with composite tenant FKs as declared; attendance event’s exactly-one student-or-employee CHECK; correction/discrepancy/notification composite event/discrepancy school FKs; card history composite card/student school FKs. `credential_identifier` is UNIQUE; attendance settings school is UNIQUE; other table-level key/check constraints include biometric exactly-one-subject, attendance events exactly-one-subject.
- **Triggers/functions/views:** None.
- **Backfills:** None.
- **ALTER:** `platform_devices` adds 3 `IF NOT EXISTS` columns, drops status CHECK `IF EXISTS` then adds replacement, creates platform unique index `IF NOT EXISTS`, and adds class FK (unguarded); `nfc_cards` adds 8 `IF NOT EXISTS` columns, creates unique index `IF NOT EXISTS`, adds four FKs.
- **Potentially non-idempotent:** New table/index/FK creates mostly unguarded; specific ALTER-added columns and two unique indexes are guarded. Status constraint is replaced each run, but other duplicate FK/table/index names fail.
- **Predecessor dependencies:** Requires `0000` schools/users/students/NFC cards; `0001` employees/classes/sessions/terms and their composite keys; `0004` platform devices.

## 0010 — `lib/db/drizzle/0010_historical_device_school_bindings.sql`

- **SQL description:** Records extant device/school pairings, makes the binding table append-only, and changes attendance-event device reference to a historical binding.
- **Tables/columns:** Creates `device_school_bindings(device_id,school_id,created_at)`; adds `device_assignment_history.new_school_id`.
- **Indexes:** `device_school_bindings_school_idx` (`IF NOT EXISTS`); composite PK `(device_id,school_id)`.
- **Constraints/FKs:** Binding device and school reference platform devices/schools; attendance `attendance_events_device_school_fk` references the composite binding key, added in a DO block only if not present and validated.
- **Triggers/functions/views:** Creates/replaces `prevent_device_school_binding_mutation()` raising on invocation; drops/recreates `device_school_bindings_append_only` (BEFORE UPDATE OR DELETE, row-level) and `device_school_bindings_no_truncate` (BEFORE TRUNCATE, statement-level), both execute that function.
- **Backfill:** `INSERT … SELECT` union of device/school pairs from attendance events, credentials, assignment history current school, previous school, new school, and current platform devices. Uses `ON CONFLICT(device_id,school_id) DO NOTHING`.
- **ALTER:** Add history column `IF NOT EXISTS` with school FK; create table/index `IF NOT EXISTS`; replace triggers; drop event FK `IF EXISTS`; conditional FK creation; validate.
- **Potentially non-idempotent:** Data insert and column/table/index are guarded; function is replaced and triggers replaced. Attendance FK is dropped conditionally and added conditionally. Validation expects the named constraint.
- **Predecessor dependencies:** Requires `0004` platform devices, `0009` history/credentials/attendance structures and original event device FK.

## 0011 — `lib/db/drizzle/0011_historical_device_references.sql`

- **SQL description:** Adds device-school bindings from biometric enrollments and NFC last-device references; repoints those composite FKs to the historical binding table.
- **Tables/columns:** None created/added.
- **Indexes:** None.
- **Constraints/FKs:** Drops/re-adds/validates `biometric_enrollments_device_school_fk` and `nfc_cards_last_device_school_fk`, targeting `device_school_bindings(device_id,school_id)`.
- **Triggers/functions/views:** None.
- **Backfill:** Inserts `(device_id,school_id)` from non-NULL biometric `device_id` and non-NULL NFC `last_device_id`, `ON CONFLICT DO NOTHING`.
- **ALTER:** Two FK replacement sequences (`DROP … IF EXISTS`; add `NOT VALID`; validate).
- **Potentially non-idempotent:** Backfill is conflict-safe; FK adds are not guarded after drop, but each preceding drop is guarded.
- **Predecessor dependencies:** Requires `0010` binding table/PK; requires `0009` biometric enrollments and NFC `last_device_id`.

## 0012 — `lib/db/drizzle/0012_phase6_academic_operations.sql`

- **SQL description:** Creates academic assignment, assessment type/assessment, grading rule, result, report-card/line, and timetable tables with school-scoped relationships and checks.
- **Tables and columns created:**
  - `academic_assignments`: `id,school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,teacher_employee_id,created_by,title,description,issue_date,due_date,max_score,status,created_at,updated_at`.
  - `academic_assessment_types`: `id,school_id,name,code,status`.
  - `academic_assessments`: `id,school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,assessment_type_id,teacher_employee_id,created_by,title,description,assessment_date,max_score,status,created_at,updated_at`.
  - `academic_grading_rules`: `id,school_id,min_score,max_score,grade,grade_point,remark,status,created_at,updated_at`.
  - `academic_results`: `id,school_id,assessment_id,student_id,student_class_assignment_id,teacher_employee_id,academic_session_id,academic_term_id,school_class_id,section_snapshot,subject_id,score,max_score,grade,grade_point,remark,status,created_by,published_by,published_at,created_at,updated_at`.
  - `academic_report_cards`: `id,school_id,student_id,academic_session_id,academic_term_id,student_class_assignment_id,school_class_id,class_name_snapshot,section_snapshot,status,teacher_remark,school_remark,published_by,published_at,created_at,updated_at`.
  - `academic_report_card_lines`: `id,school_id,report_card_id,result_id,subject_id,subject_name_snapshot,assessment_name_snapshot,score,max_score,grade,grade_point,remark`.
  - `academic_timetable_entries`: `id,school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,teacher_employee_id,weekday,start_time,end_time,room,status,created_by,created_at,updated_at`.
- **Indexes:** `academic_assignments_school_context_idx`, `academic_assessment_types_school_status_idx`, `academic_assessments_school_context_idx`, `academic_grading_rules_school_status_idx`, `academic_results_school_context_idx`, `academic_report_cards_school_student_idx`, `academic_report_card_lines_report_card_idx`, `academic_timetable_entries_school_context_idx`.
- **Unique constraints:** Assignment/assessment/assessment type/grading rule/result/report card/report-card-line/timetable `(id,school_id)` keys; `academic_assessment_types_school_code_unique`; `academic_results_assessment_student_unique`; report card `student_session_term_unique`; report-card-line `report_card_result_unique`.
- **CHECKs:** Assignment positive max score, due≥issue, status enum; assessment type status; assessment positive max score/status; grading rule min≥0 and max≥min/status; result score/max range, status, published metadata when status PUBLISHED; report card status and publication metadata; report card line score range; timetable weekday, end>start, status.
- **FKs:** Tables reference schools; assignments/assessments/timetable reference session, term, class, subject, employee within same school; assessments additionally reference assessment type within school; results reference assessment, student, class assignment, teacher, session, term, class, subject within school; report cards reference student/session/term/class assignment/class within school; lines reference report card/result/subject within school; creator/publisher references app users where declared.
- **Triggers/functions/views/backfills/ALTER:** None.
- **Potentially non-idempotent:** All table, index, and constraint creates are unguarded.
- **Predecessor dependencies:** Requires `0000` schools/users/students; `0001` sessions, terms, classes, subjects, employees, student assignments and their `(id,school_id)` keys.

## 0013 — `lib/db/drizzle/0013_phase7_finance.sql`

- **SQL description:** Creates school fee settings, categories, structures/lines, invoices/lines, adjustments, payments, and receipts; creates a function/trigger protecting verified-payment metadata.
- **Tables and columns:** `fee_school_settings(school_id,partial_payments_enabled,updated_by,updated_at)`; `fee_categories(id,school_id,name,description,compulsory,status,created_by,created_at,updated_at)`; `fee_structures(id,school_id,academic_session_id,academic_term_id,school_class_id,section,version,status,created_by,published_by,published_at,created_at)`; `fee_structure_lines(id,school_id,structure_id,category_id,category_name_snapshot,description_snapshot,amount_minor)`; `fee_invoices(id,school_id,student_id,parent_id,structure_id,academic_session_id,academic_term_id,invoice_number,student_name_snapshot,admission_no_snapshot,class_name_snapshot,section_snapshot,issue_date,due_date,currency,subtotal_minor,discount_minor,waiver_minor,total_minor,paid_minor,outstanding_minor,status,created_by,created_at)`; `fee_invoice_lines(id,school_id,invoice_id,category_id,category_name_snapshot,description_snapshot,amount_minor)`; `fee_adjustments(id,school_id,invoice_id,kind,amount_minor,reason,status,requested_by,approved_by,approved_at,created_at)`; `fee_payments(id,school_id,invoice_id,student_id,parent_id,reference,idempotency_key,amount_minor,currency,method,provider,provider_transaction_id,status,transfer_bank,transfer_reference,transfer_date,proof_url,submitted_by,verified_by,verified_at,verification_evidence_ref,reviewer_notes,verification_metadata,rejection_reason,provider_metadata,created_at)`; `fee_receipts(id,school_id,payment_id,receipt_number,snapshot,created_at)`.
- **Indexes:** `fee_categories_school_status_idx`; `fee_structures_version_context_unique` (unique with `COALESCE(section,'')`), `fee_structures_school_context_idx`; `fee_invoices_school_student_idx`; `fee_invoice_lines_invoice_idx`; `fee_adjustments_invoice_idx`; `fee_payments_school_status_idx`.
- **Constraints:** Composite unique keys for school-scoped reference `(id,school_id)` on category, structure, structure line, invoice, invoice line, adjustment, payment; category `(school_id,name)` unique; invoice `(school_id,invoice_number)` and `(school_id,student_id,structure_id)` unique; structure line `(structure_id,category_id)` unique; payment reference unique, `(school_id,idempotency_key)` unique, `(provider,provider_transaction_id)` unique; receipt payment unique and `(school_id,receipt_number)` unique. CHECKs cover category status; structure status; positive structure-line amount; invoice arithmetic/status; nonnegative invoice-line amount; adjustment positive amount/kind/status; payment method/status/currency/positive amount, evidence required for verified bank transfers, rejection reason required on REJECTED.
- **FKs:** school references throughout; structures to session/term/class composite keys; lines to structure/category composite keys; invoices to student/structure/session/term composite keys; invoice lines to invoice/optional category; adjustments to invoice; payments to invoice/student; receipts to payment; creator/reviewer/actor columns reference app users where declared.
- **Triggers/functions:** Function `protect_fee_payment_verification_metadata()` rejects changes to evidence reference, reviewer notes, verification metadata, verifier, or verification timestamp after old metadata is non-NULL; trigger `fee_payments_verification_metadata_immutable` BEFORE UPDATE row on `fee_payments`.
- **Views/backfills:** None.
- **ALTER:** None.
- **Potentially non-idempotent:** All tables/indexes/functions/triggers are unguarded.
- **Predecessor dependencies:** Requires `0000` schools/users/students; `0001` academic session/term/class composite keys; relies on those keys for FKs.

## 0014 — `lib/db/drizzle/0014_finance_payment_integrity.sql`

- **SQL description:** Adds bank-transfer and evidence checks/unique indexes, adds a payment composite unique key, then adds/backfills receipt invoice IDs and snapshots and adds a composite FK.
- **Tables/columns:** Adds `fee_receipts.invoice_id`.
- **Indexes:** `fee_payments_school_bank_transfer_ref_unique` unique partial on normalized bank and transfer reference for bank transfers with nonempty values; `fee_payments_school_verified_evidence_ref_unique` unique partial on normalized evidence reference for verified bank transfers with nonempty evidence.
- **Constraints:** Adds `fee_payments_bank_transfer_details_check`, `fee_payments_verification_evidence_length_check`, `fee_payments_id_invoice_school_unique`; adds `fee_receipts_payment_invoice_school_fk` referencing payment `(id,invoice_id,school_id)`.
- **Triggers/functions/views:** None.
- **Backfill:** Sets receipt invoice ID from matching payment by payment ID and school; merges JSON keys `invoiceId` and `schoolId` into each receipt snapshot; then makes invoice ID NOT NULL.
- **ALTER:** Add constraints, add column, set column NOT NULL, add composite FK.
- **Potentially non-idempotent:** All additions/index creates and both UPDATEs unguarded; repeated execution fails on duplicate columns/constraints/indexes. Backfill updates all matching rows.
- **Predecessor dependencies:** Requires `0013` payments/receipts and their columns; the new FK depends on payment unique key created in this same file.

## 0015 — `lib/db/drizzle/0015_school_bank_transfer_settings.sql`

- **SQL description:** Adds bank-transfer enablement/configuration fields to school fee settings and validates the fields when enabled.
- **Tables/columns:** Adds `fee_school_settings.bank_transfer_enabled,bank_name,bank_account_name,bank_account_number`.
- **Indexes:** None.
- **Constraints:** `fee_school_settings_bank_account_fields_check`: validates optional bank/name lengths and 10-digit account number; when transfer is enabled all three are non-NULL.
- **Triggers/functions/views/backfills:** None.
- **ALTER:** Adds four columns and one CHECK.
- **Potentially non-idempotent:** Column and CHECK additions unguarded.
- **Predecessor dependencies:** Requires `0013` `fee_school_settings`.

## 0016 — `lib/db/drizzle/0016_finance_refunds.sql`

- **SQL description:** Creates refund records and indexes for status and approved evidence lookup.
- **Tables/columns:** `fee_refunds(id,school_id,payment_id,invoice_id,reference,idempotency_key,amount_minor,currency,reason,status,requested_by,approved_by,evidence_reference,reviewer_notes,approved_at,created_at)`.
- **Indexes:** `fee_refunds_school_status_idx`; unique partial `fee_refunds_school_evidence_unique` on school/lower-trimmed evidence when approved and nonempty.
- **Constraints:** `(id,school_id)`, reference, and `(school_id,idempotency_key)` unique; amount positive and 3-letter uppercase currency CHECK; status enum; approved status requires approver, timestamp, nonempty evidence and reviewer notes. FKs school, requester, optional approver, and payment/invoice/school composite key.
- **Triggers/functions/views/backfills/ALTER:** None.
- **Potentially non-idempotent:** Table/index creation unguarded.
- **Predecessor dependencies:** Requires `0013` fee payments and `0014` payment `(id,invoice_id,school_id)` key; `0000` schools/app users.

## 0017 — `lib/db/drizzle/0017_fee_provider_payments.sql`

- **SQL description:** Adds provider-enable flags, checkout-session state, and durable provider webhook-event records.
- **Tables/columns:** Adds settings columns `paystack_enabled,flutterwave_enabled`; creates `fee_provider_checkout_sessions(payment_id,school_id,invoice_id,provider,reference,idempotency_key,state,claim_token,claim_expires_at,checkout_url,provider_session_metadata,attempt_count,last_error,created_at,updated_at)` and `fee_provider_webhook_events(id,provider,event_id,payment_id,school_id,provider_reference,webhook_transaction_id,verified_transaction_id,status,signature_verified,payload_sha256,error_message,received_at,updated_at,resolved_at)`.
- **Indexes:** Unique partial `fee_provider_checkout_sessions_one_open_invoice_unique` on `(school_id,invoice_id)` where state INITIALIZING/READY/FAILED; webhook ordinary indexes `fee_provider_webhook_events_school_status_idx` (descending received time), `fee_provider_webhook_events_reference_idx` (descending received time).
- **Constraints:** Checkout `payment_id` primary key, reference unique, school/provider/idempotency unique; provider/state enums, positive attempt count, paired claim token/expiry nullness, READY requires checkout URL; FKs to payment `(id,school_id)` and invoice `(id,school_id)`. Webhook provider/status enums, signature/link CHECK, provider/event unique, FKs to payment `(id,school_id)` and school.
- **Triggers/functions/views/backfills:** None.
- **ALTER:** Adds two settings columns.
- **Potentially non-idempotent:** Settings columns/table/index/constraints unguarded.
- **Predecessor dependencies:** Requires `0013` fee settings/payments/invoices and their `(id,school_id)` keys.

## 0018 — `lib/db/drizzle/0018_fee_payment_notifications.sql`

- **SQL description:** Creates school-scoped in-app payment notification records for verified payment event.
- **Tables/columns:** `fee_payment_notifications(id,school_id,payment_id,invoice_id,recipient_user_id,recipient_role,event_type,channel,is_read,read_at,created_at)`.
- **Indexes:** `fee_payment_notifications_recipient_idx`, `fee_payment_notifications_school_idx`.
- **Constraints:** `(id,school_id)` unique; delivery unique `(payment_id,recipient_user_id,recipient_role,event_type)`; role enum `PARENT,STUDENT,SCHOOL_ADMIN,ACCOUNTANT`; event fixed to `PAYMENT_VERIFIED`; channel fixed `IN_APP`; read flag/read timestamp consistency CHECK; composite payment/invoice/school FK and school/app-user FKs.
- **Triggers/functions/views/backfills/ALTER:** None.
- **Potentially non-idempotent:** Table/index/constraints unguarded.
- **Predecessor dependencies:** Requires `0013` payments, `0014` payment composite `(id,invoice_id,school_id)` key; schools and app users from `0000`.

## 0019 — `lib/db/drizzle/0019_phase7_finance_ledger_gaps.sql`

- **SQL description:** Adds requested percentage and amount/balance snapshots to fee adjustments, validates them, and adds refund transaction classification.
- **Tables/columns:** Adds `fee_adjustments.requested_percentage,approved_amount_minor,original_balance_minor,resulting_balance_minor`; adds `fee_refunds.transaction_type` default `REFUND`, NOT NULL.
- **Indexes:** None.
- **Constraints:** Adjustment percentage NULL or >0 and ≤100; approved amount NULL or >0; original/resulting balances NULL or ≥0. Refund transaction type check `REFUND/REVERSAL`.
- **Triggers/functions/views/backfills:** None.
- **ALTER:** Two ALTERs to adjustments, one to refunds.
- **Potentially non-idempotent:** All column and constraint additions unguarded.
- **Predecessor dependencies:** Requires `0013` fee adjustments and `0016` fee refunds.

## 0020 — `lib/db/drizzle/0020_finance_payment_notification_events.sql`

- **SQL description:** Expands payment notification event types to refunds/reversals and adds event-reference identity.
- **Tables/columns:** Adds `fee_payment_notifications.event_reference_id` default 0, NOT NULL.
- **Indexes:** None.
- **Constraints:** Replaces `fee_payment_notifications_event_check` to permit verified/rejected payment and approved refund/reversal events; replaces delivery unique key to include event reference; adds CHECK requiring reference 0 for payment events and >0 for refund/reversal events.
- **Triggers/functions/views/backfills:** None.
- **ALTER:** Drops/re-adds event CHECK; adds column, drops/re-adds delivery UNIQUE and adds CHECK.
- **Potentially non-idempotent:** All named drops/additions unguarded.
- **Predecessor dependencies:** Requires `0018` table and original event/delivery constraints.

## 0021 — `lib/db/drizzle/0021_fee_payment_notification_outbox.sql`

- **SQL description:** Creates retry outbox rows for payment notifications.
- **Tables/columns:** `fee_payment_notification_outbox(id,school_id,payment_id,invoice_id,event_type,event_reference_id,metadata,attempts,next_attempt_at,last_error,created_at)`.
- **Indexes:** `fee_payment_notification_outbox_retry_idx`.
- **Constraints:** PK; unique `(payment_id,event_type,event_reference_id)`; composite FK `(payment_id,invoice_id,school_id)→fee_payments`; school FK; event/reference CHECK matching payment vs refund/reversal types.
- **Triggers/functions/views/backfills/ALTER:** None.
- **Potentially non-idempotent:** Table/index creation unguarded.
- **Predecessor dependencies:** Requires `0013` fee payments and `0014` payment composite key; schools from `0000`.

## 0022 — `lib/db/drizzle/0022_payment_bound_notification_events.sql`

- **SQL description:** Expands permitted payment-notification and outbox event values to provider-checkout and manual-transfer events.
- **Tables/columns:** No create/add columns.
- **Indexes:** None.
- **Constraints:** Replaces notification event CHECK and event-reference CHECK; replaces outbox event CHECK. Payment-related event values include PAYMENT_VERIFIED, PAYMENT_REJECTED, provider checkout initiated/processing, provider payment failed, manual transfer submitted/approved/rejected (reference 0); refunds/reversals require positive reference.
- **Triggers/functions/views/backfills:** None.
- **ALTER:** Three named constraint drop/add pairs across `fee_payment_notifications` and `fee_payment_notification_outbox`.
- **Potentially non-idempotent:** Drops/additions unguarded.
- **Predecessor dependencies:** Requires `0020` notification event/reference constraints and `0021` outbox/event check.

## 0023 — `lib/db/drizzle/0023_invoice_generated_notifications.sql`

- **SQL description:** Creates in-app invoice-generated notification records and a notification retry outbox.
- **Tables/columns:** `fee_invoice_notifications(id,school_id,invoice_id,recipient_user_id,recipient_role,event_type,channel,is_read,read_at,created_at)`; `fee_invoice_notification_outbox(id,school_id,invoice_id,event_type,metadata,attempts,next_attempt_at,last_error,created_at)`.
- **Indexes:** `fee_invoice_notifications_recipient_idx`, `fee_invoice_notifications_school_idx`, `fee_invoice_notification_outbox_retry_idx`.
- **Constraints:** Notifications have `(id,school_id)` unique, delivery key `(school_id,invoice_id,recipient_user_id,recipient_role,event_type)` unique, invoice/school FK, role/event/channel/read-state CHECKs. Outbox delivery key `(school_id,invoice_id,event_type)` unique, invoice/school FK, fixed invoice-generated event check, nonnegative attempts check. Both tables have school FK; notification recipient references app user.
- **Triggers/functions/views/backfills/ALTER:** None.
- **Potentially non-idempotent:** Table/index creation unguarded.
- **Predecessor dependencies:** Requires `0013` invoices with `(id,school_id)` key; schools/app users from `0000`.

## 0024 — `lib/db/drizzle/0024_platform_company_employees.sql`

- **SQL description:** Creates platform company employee records and email/status indexes.
- **Tables/columns:** `platform_company_employees(id,full_name,email,phone,job_title,status,created_at,updated_at)`.
- **Indexes:** Unique `platform_company_employees_email_unique` on `lower(email)`; `platform_company_employees_status_idx`.
- **Constraints:** PK; status CHECK `ACTIVE/INACTIVE`.
- **Triggers/functions/views/backfills/ALTER:** None.
- **Potentially non-idempotent:** Table and both indexes use `IF NOT EXISTS`; a preexisting object with a different definition is not reconciled.
- **Predecessor dependencies:** None detected.

## 0025 — `lib/db/drizzle/0025_communication.sql`

- **SQL description:** Creates in-app notifications, delivery attempts, user preferences, templates, campaigns, campaign recipients, and push-device records.
- **Tables and columns:**
  - `communication_notifications`: `id,recipient_user_id,school_id,sender_user_id,category,event_key,subject,body,link,is_read,read_at,created_at`.
  - `communication_deliveries`: `id,notification_id,channel,status,provider_message_id,provider_acknowledged_at,sent_at,delivered_at,failed_at,error_code,last_error,attempts,next_attempt_at,last_attempt_at,created_at,updated_at`.
  - `communication_preferences`: `id,user_id,school_id,category,channel,enabled,created_at,updated_at`.
  - `communication_templates`: `id,school_id,template_key,name,category,channel,subject,body,allowed_variables,is_active,created_by_user_id,created_at,updated_at`.
  - `communication_campaigns`: `id,school_id,created_by_user_id,template_id,idempotency_key,title,subject,body,category,target_type,target_criteria,channels,status,recipient_count,scheduled_at,sent_at,created_at,updated_at`.
  - `communication_campaign_recipients`: `id,campaign_id,school_id,recipient_user_id,notification_id,status,error_code,created_at,sent_at`.
  - `communication_push_devices`: `id,user_id,school_id,provider,opaque_device_reference,status,created_at,last_used_at,revoked_at`.
- **Indexes:** Notifications: unique partial `communication_notifications_school_event_recipient_unique`, unique partial `communication_notifications_global_event_recipient_unique`; ordinary recipient-read, school-created, school/category/event indexes. Deliveries: unique `(notification_id,channel)` constraint; retry and provider-message indexes. Preferences: unique partial school/global indexes; user-school index. Templates: unique `(id,school_id)` and `(school_id,template_key,channel)` constraints; school-active index. Campaigns: unique `(id,school_id)` constraint, unique partial school/idempotency index, school/status index. Recipients: unique `(campaign_id,recipient_user_id)` constraint, school/status and user/school indexes. Push devices: unique partial active school/global indexes; user-school-status index.
- **Constraints/FKs:** Notifications recipient and optional sender→app users; optional school→schools; unique `(id,school_id,recipient_user_id)` and category/read-state checks. Deliveries notification FK with ON DELETE CASCADE; channel/status enums; nonnegative attempts; delivered timestamp requires DELIVERED/READ; provider acknowledgment disallowed for IN_APP. Preferences user and optional school FKs; category/channel enum checks. Templates school and optional creator FKs; variable array limited to declared list. Campaign school/creator FKs; optional template-school composite FK; category, target-type, nonempty allowed channels, status, nonnegative recipient count, JSON object criteria checks. Recipients user FK; campaign-school composite FK; notification-school-recipient composite FK; status enum. Push devices user/optional school FKs; provider fixed WEB_PUSH; active/revoked state and reference length checks.
- **Triggers/functions/views/backfills/ALTER:** None.
- **Potentially non-idempotent:** All table and index creates unguarded.
- **Predecessor dependencies:** Requires `0000` schools/app_users; campaign-template composite FK references template key created in this same file.

## 0026 — `lib/db/drizzle/0026_communication_entitlements.sql`

- **SQL description:** Adds optional student/class subjects to communication notifications with same-school integrity and dispatch indexes.
- **Tables/columns:** Adds `communication_notifications.subject_student_id,subject_class_id`.
- **Indexes:** Partial `communication_notifications_subject_student_dispatch_idx` and `communication_notifications_subject_class_dispatch_idx`.
- **Constraints:** FKs `(subject_student_id,school_id)→students(id,school_id)` and `(subject_class_id,school_id)→school_classes(id,school_id)`; each subject may be NULL or notification school must be non-NULL.
- **Triggers/functions/views/backfills:** None.
- **ALTER:** One ALTER adding two columns/four constraints; two indexes.
- **Potentially non-idempotent:** All additions unguarded.
- **Predecessor dependencies:** Requires `0025` notifications and `0001` student/class `(id,school_id)` keys.

## 0027 — `lib/db/drizzle/0027_library.sql`

- **SQL description:** Creates library authors, publishers, categories, books, copies, settings, staff, loans, renewals, and copy-status history.
- **Tables and columns:**
  - `library_authors`: `id,school_id,name,reference,created_by_user_id,created_at,updated_at`.
  - `library_publishers`: same author-shaped columns.
  - `library_categories`: `id,school_id,name,description,is_active,created_by_user_id,created_at,updated_at`.
  - `library_books`: `id,school_id,title,subtitle,isbn,author_id,publisher_id,category_id,publication_year,edition,subject,description,cover_reference,language,shelf_location,status,created_by_user_id,created_at,updated_at`.
  - `library_book_copies`: `id,school_id,book_id,copy_code,barcode,condition,status,location,acquired_on,acquisition_reference,created_by_user_id,created_at,updated_at`.
  - `library_settings`: `school_id,student_borrowing_enabled,teacher_borrowing_enabled,staff_borrowing_enabled,max_books_per_student,max_books_per_teacher,max_books_per_staff,student_loan_days,teacher_loan_days,staff_loan_days,max_renewals,renewal_requires_not_overdue,fines_enabled,updated_by_user_id,updated_at`.
  - `library_staff`: `id,school_id,user_id,can_manage_catalogue,is_active,assigned_by_user_id,created_at,updated_at`.
  - `library_loans`: `id,school_id,book_id,copy_id,borrower_type,borrower_user_id,borrower_student_id,issued_at,due_on,returned_at,returned_overdue,days_overdue_at_return,status,issued_by_user_id,returned_by_user_id,renewal_count,idempotency_key,notes,created_at,updated_at`.
  - `library_renewals`: `id,school_id,loan_id,renewed_by_user_id,previous_due_on,new_due_on,idempotency_key,created_at`.
  - `library_copy_status_history`: `id,school_id,copy_id,loan_id,previous_status,new_status,reason,notes,changed_by_user_id,created_at`.
- **Indexes:** Authors/publishers/categories unique school/name (lower name); books school search and partial ISBN indexes; copies unique school/lower copy code, unique partial school/barcode, available index; staff unique school/user, school-active index; loans unique partial school/idempotency and open-copy, borrower-history and overdue indexes; renewals unique school/loan/idempotency and loan-history index; copy history timeline index.
- **Constraints/FKs:** School-scoped composite uniques on authors, publishers, categories, books, copies, staff, loans. Category/name/title/code lengths; publication-year bounds; enumerated book/copy/loan/history statuses and copy conditions; settings count/day/renewal bounds and `fines_enabled=false`; staff school/user unique. Loans nonnegative renewal and overdue days, borrower student/type consistency, returned-state consistency; references book/copy/student within school and borrower/issuer/returner app users. Renewals composite loan/school FK and idempotency unique. History composite copy/school and optional loan/school FKs, status and reason checks. School and optional creator/updated-by/assignee user FKs appear on relevant tables.
- **Triggers/functions/views/backfills/ALTER:** None.
- **Potentially non-idempotent:** All creates unguarded.
- **Predecessor dependencies:** Requires `0000` schools/app_users; `0001` students `(id,school_id)` key.

## 0028 — `lib/db/drizzle/0028_school_operations.sql`

- **SQL description:** Creates school operation categories, assets, facilities, maintenance requests, operational tasks, and school operation settings.
- **Tables and columns:** `school_operation_categories(id,school_id,category_type,name,description,is_active,created_by_user_id,created_at,updated_at)`; `school_assets(id,school_id,category_id,category_type,asset_code,name,description,quantity,unit,location,condition,assigned_to_user_id,acquired_on,status,notes,created_by_user_id,created_at,updated_at)`; `school_facilities(id,school_id,name,facility_type,location,condition,capacity,status,notes,created_by_user_id,created_at,updated_at)`; `maintenance_requests(id,school_id,category_id,category_type,asset_id,title,description,location,reported_by_user_id,assigned_to_user_id,priority,status,reported_at,due_on,completed_at,notes,created_at,updated_at)`; `operational_tasks(id,school_id,category_id,category_type,title,description,assigned_to_user_id,created_by_user_id,priority,status,due_on,notes,completed_at,created_at,updated_at)`; `school_operations_settings(school_id,default_maintenance_priority,default_task_priority,staff_can_report_maintenance,updated_by_user_id,updated_at)`.
- **Indexes:** Categories unique school/type/lower(name), unique `(id,school_id,category_type)`, school/type/active index. Assets unique partial school/lower(asset_code); school/status/name index. Facilities unique school/lower(name); school/status/name index. Maintenance school/status/priority/time, reporter, assignee indexes. Tasks school/status/priority/due and assignee indexes.
- **Constraints/FKs:** Category type enum; asset quantity≥0, condition/status enum, category type fixed ASSET, category composite FK, `(id,school_id)` unique; facility nonnegative optional capacity, condition/status enums, `(id,school_id)` unique; maintenance fixed category type, priority/status enums, category-type composite FK, optional asset-school FK ON DELETE RESTRICT, `(id,school_id)` unique; task fixed category type, priority/status enums, category-type FK, `(id,school_id)` unique; settings priority enums. School and app-user FKs use ON DELETE RESTRICT as declared.
- **Triggers/functions/views/backfills/ALTER:** None.
- **Potentially non-idempotent:** All creates/indexes unguarded.
- **Predecessor dependencies:** Requires `0000` schools/app_users; same-file category/asset `(id,school_id)` keys support maintenance FKs.

## 0029 — `lib/db/drizzle/0029_operations_history.sql`

- **SQL description:** Creates asset-change, maintenance-status, and task-status histories; defines one append-only mutation function and three triggers.
- **Tables and columns:** `school_asset_history(id,school_id,asset_id,event_type,quantity_before,quantity_after,assigned_to_before_user_id,assigned_to_after_user_id,status_before,status_after,actor_user_id,event_at,metadata)`; `maintenance_request_status_history(id,school_id,maintenance_request_id,from_status,to_status,actor_user_id,occurred_at)`; `operational_task_status_history(id,school_id,task_id,from_status,to_status,actor_user_id,occurred_at)`.
- **Indexes:** `school_asset_history_asset_timeline_idx`, `maintenance_request_status_history_timeline_idx`, `operational_task_status_history_timeline_idx`.
- **Constraints/FKs:** Asset history event enum, nonnegative optional quantities, valid optional before/after statuses, asset-school composite FK ON DELETE RESTRICT, actor and optional assignee FKs to users. Maintenance/task status histories validate optional from and required to statuses; request/task composite school FKs ON DELETE RESTRICT; actor user FK.
- **Triggers/functions:** `prevent_operations_history_mutation()` raises `Operations history is append-only`; BEFORE UPDATE OR DELETE row triggers `school_asset_history_append_only`, `maintenance_request_status_history_append_only`, `operational_task_status_history_append_only`.
- **Views/backfills/ALTER:** None.
- **Potentially non-idempotent:** Table/index/function/trigger creates unguarded.
- **Predecessor dependencies:** Requires `0028` assets, maintenance requests, tasks and their composite `(id,school_id)` keys; `0000` app_users.

## 0030 — `lib/db/drizzle/0030_library_loan_copy_integrity.sql`

- **SQL description:** Makes book/copy/school a referenced unique key, replaces the library loan copy/school FK with a composite school/book/copy FK.
- **Tables/columns:** None created/added.
- **Indexes:** Backing unique index for `library_book_copies_school_book_id_unique`; explicit index statement absent.
- **Constraints/FKs:** Adds UNIQUE `(school_id,book_id,id)` on `library_book_copies`; drops `library_loans_copy_school_fk`; adds `library_loans_copy_book_school_fk` from `(school_id,book_id,copy_id)` to `library_book_copies(school_id,book_id,id)`.
- **Triggers/functions/views/backfills:** None.
- **ALTER:** Three ALTER TABLE operations: add unique constraint, drop old FK, add new FK.
- **Potentially non-idempotent:** All statements unguarded; repeat fails at existing unique constraint or absent old FK.
- **Predecessor dependencies:** Requires `0027` library book copies and loans; the target columns/old FK were created there.

---

## Findings summary

- **Coverage:** All 31 journaled SQL files, numbered continuously `0000`–`0030`, are inventoried in order.
- **Source-level object counts:** 91 table-create statements; 181 index-create statements; 3 function definitions; 6 trigger definitions; no view definitions.
- **Backfill/data statements detected:** Parent/student relationship match insert in `0000`; academic legacy-session and class-assignment inserts in `0001`; default commission-rule insert in `0003`; device/school binding inserts in `0010` and `0011`; receipt invoice/snapshot updates in `0014`. No other data backfill statement detected in the remaining files.
- **Object-creation safety:** Many baseline DDL statements are unguarded. Explicit guards are called out per migration; they are not evidence of historical execution or proof that differing preexisting object definitions are compatible.
- **Historical certainty:** This document is not a ledger/schema comparison. It neither establishes whether a migration was applied nor resolves SQL hash provenance; those questions require separate evidence.