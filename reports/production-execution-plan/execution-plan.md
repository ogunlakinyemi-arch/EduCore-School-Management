# Production reconciliation execution plan

**READY FOR CONTROLLED PRODUCTION EXECUTION PLAN** — planning complete is not rollout approval or permission to execute. Production writes/connections: **0**. No migrations, journal changes, database objects, backfills or deployment actions were performed.

## Evidence reused
Current focused preflight: 1,890 specifications; 798 passed, 86 replica/primary-certification warnings, 0 failed, 1,006 unassessed prerequisite-blocked. All five corrected default gates cleared. Existing isolated validation confirms exact defaults and old-row initialization; no new replay, Finance reconciliation, broad discovery or preflight run occurred.

## Batches
| Batch | Files (count) | Purpose | Blocked checks newly executable | Checkpoint |
|---|---|---|---:|---|
| 1 | 0061–0115 (55) | Structural prerequisites | 965 | Mandatory B1 |
| 2 | 0116–0138 (23) | Parent uniqueness and index supports | 0 | Mandatory B2 |
| 3 | 0139–0155 (17) | CHECK and foreign-key enforcement | 0 | Mandatory B3 |
| 4 | 0156–0160 (5) | Canonical function definitions | 0 | Mandatory B4 |
| 5 | 0161–0165 (5) | Trigger activation | 0 | Mandatory B5 |

**F0060 between B2 and B3:** unchanged 0060 supplies 96 Finance-owned canonical objects excluded from the 105 forward migrations. 41 blocked checks become executable at this external milestone. Verify prior complete application read-only; if these objects are absent, STOP pending separate authorization for unchanged 0060 through a supported route. Never silently include it in the 105, assume it is already applied, or replay 0000–0059. Exact reviewed schedule is in migration-manifest.json.

## Why this order
Create sequences before typed table-shell/default references; reconcile columns before ownership; complete PK/UNIQUE and supporting indexes before FK enforcement; satisfy the external Finance contract before dependent FK/behavior; verify all function bodies/callees before enabling triggers. 4942 object nodes and 12128 edges were checked; actual intra-file operation order and inter-file dependencies are checked, not inferred from numbers. PL/pgSQL runtime call dependencies are distinguished from creation dependencies. 0 unresolved ordering/provider/cycle errors.

Five approved defaults remain SAFE: empty school communication overrides, empty delivery-attempt/receipt tracking, default-deny Partner permissions. They do not fabricate history; all unrelated populated NOT NULL additions remain strict.

## Transaction and recovery policy
Each file is one guarded DO statement. Run only through an explicitly approved supported mechanism; checkpoint batches are not instructions to hold every file in one huge transaction. Within each batch preserve the exact listed order. Any file error/lock timeout stops immediately; that file can roll back atomically but earlier committed files remain. No reviewed down migration or inverse SQL exists: these operations are **not automatically safely reversible**. Do not invent DROP/DELETE/reset compensation. An authorized recovery owner must choose separately reviewed forward correction or verified restore/recovery. Keep affected writes quiesced from A through FINAL so no incomplete-key/trigger interval accepts application changes.

## Operational prerequisites (not investigated or approved here)
- Authoritative runtime/primary binding UNVERIFIED; operator evidence at A, no hidden discovery
- Backup/PITR availability and recovery point UNKNOWN until operator evidence at A
- Current primary fingerprint unknown; cached replica layout is planning baseline only
- Execution route must be confirmed: managed Replit Production uses supported Publish diff flow, not a custom production SQL runner/startup hook; exact staged effect/order must be demonstrated or STOP. External target requires separately approved documented process
- 105 forward migrations plus 0060 are journal-unregistered; six other historical files also require legitimate history review. No journal change now, no filename sorting/bulk stamp/replay
- Historical compiler/manifest retains pre-correction hashes for three files; this planning manifest pins their validated corrected hashes. Do not run regeneration/adoption without separate review
- Writer quiescence/maintenance window and recovery ownership require explicit operational authorization; keep affected writes paused through FINAL

Managed Replit schema synchronization does not imply that these SQL files will be executed in this exact order. Do not create a custom Production runner or deploy/startup migration hook. If the supported schema application cannot preserve dependency barriers and the reviewed CASH retirement, STOP and obtain a separately approved implementation plan.

## Read-only checks and stops
See execution-checkpoints.md. Each newly executable original data check must run before its relevant unique/CHECK/FK/index DDL, not only after it. Internal guard/constraint enforcement is not a substitute for the checkpoint. Known retained equivalent keys/index aliases and original ordinals are allowed only where the existing validation proves equivalence; any new object or unreviewed semantic difference stops execution.

- STOP: Intended Production authoritative primary not conclusively established
- STOP: Confirmed backup/PITR recovery evidence unavailable
- STOP: Current file/hash differs from corrected validated manifest
- STOP: Unexpected schema object beyond reviewed baseline/retained-equivalence allowlist
- STOP: Expected prerequisite missing or semantically different
- STOP: Unexpected affected row-count/stable-data digest change
- STOP: Uniqueness, primary-null, CHECK or foreign-key data gate fails
- STOP: Sequence ownership/metadata/authoritative position differs unexpectedly
- STOP: Any migration error, including guarded preflight or lock timeout
- STOP: Any newly executable preflight fails
- STOP: Any destructive table/column/data/reset operation discovered
- STOP: Any unapproved data transformation
- STOP: Supported schema-application route cannot preserve reviewed dependency order/guards
- STOP: Journal/history reconciliation cannot prove legitimate execution without replay/bulk-stamping

## Unlock groups
The JSON contains the exact original IDs, original query hashes, all data prerequisites and unlocking filenames for all 1,006 checks. The following groups summarize those records; no check is marked passed by this plan.

| Unlock stage | Child table | Check kind | Count | Missing prerequisite objects |
|---|---|---|---:|---|
| B1 | academic_result_batches | f, c, u, primary key NULL, p, sequence position | 15 | public.academic_result_batches with typed columns |
| B1 | academic_sessions | f | 1 | columns:public.academic_sessions.created_by. |
| B1 | academic_terms | f | 1 | columns:public.academic_terms.created_by. |
| B1 | admission_application_counters | c, primary key NULL, p, f | 4 | public.admission_application_counters with typed columns |
| B1 | admission_application_documents | f, c, u, primary key NULL, p, sequence position | 9 | public.admission_application_documents, public.admission_applications with typed columns |
| B1 | admission_applications | f, c, u, primary key NULL, p, unique index, sequence position | 25 | public.admission_applications with typed columns |
| B1 | admission_portal_classes | f, primary key NULL, p | 4 | public.admission_portal_classes, public.admission_portal_settings with typed columns |
| B1 | admission_portal_settings | c, primary key NULL, p, f, unique index | 11 | public.admission_portal_settings with typed columns |
| B1 | admission_request_rate_limits | primary key NULL, p, c | 3 | public.admission_request_rate_limits with typed columns |
| B1 | campus_presence | f, u, c, primary key NULL, p, unique index, sequence position | 14 | public.campus_presence, public.security_events with typed columns |
| B1 | communication_campaigns | c | 1 | columns:public.communication_campaigns.is_emergency. |
| B1 | communication_message_threads | c, f, u, primary key NULL, p, unique index, sequence position | 14 | public.communication_message_threads with typed columns |
| B1 | communication_messages | c, primary key NULL, p, f, unique index, sequence position | 9 | public.communication_messages, public.communication_message_threads with typed columns |
| B1 | curriculum_imports | f, primary key NULL, p, sequence position | 5 | public.curriculum_imports, public.curriculum_versions with typed columns |
| B1 | curriculum_progress | u, f, primary key NULL, p, c, sequence position | 9 | public.curriculum_progress, public.school_curriculum_assignments with typed columns |
| B1 | curriculum_topics | u, f, c, primary key NULL, p, sequence position | 9 | public.curriculum_topics, public.school_curriculum_assignments, public.curriculum_versions with typed columns |
| B1 | curriculum_versions | f, primary key NULL, p, c, sequence position | 7 | public.curriculum_versions with typed columns |
| B1 | employee_nfc_attendance_discrepancies | f, u, primary key NULL, p, c, unique index, sequence position | 10 | public.employee_nfc_attendance_discrepancies with typed columns |
| B1 | employee_nfc_card_bindings | f, u, primary key NULL, p, c, unique index, sequence position | 11 | public.employee_nfc_card_bindings with typed columns |
| B1 | employee_nfc_card_history | f, u, primary key NULL, p, sequence position | 10 | public.employee_nfc_card_history, public.employee_nfc_card_bindings with typed columns |
| B1 | employee_nfc_discrepancy_actions | f, primary key NULL, p, sequence position | 6 | public.employee_nfc_discrepancy_actions, public.employee_nfc_attendance_discrepancies with typed columns |
| B1 | exam_question_papers | c, f, u, primary key NULL, p, sequence position | 15 | public.exam_question_papers with typed columns |
| B1 | exam_question_reviews | c, f, primary key NULL, p, sequence position | 9 | public.exam_question_reviews, public.exam_question_papers, public.exam_question_versions with typed columns |
| B1 | exam_question_versions | f, u, c, primary key NULL, p, sequence position | 11 | public.exam_question_versions, public.exam_question_papers with typed columns |
| B1 | fee_invoices | f, c | 2 | columns:public.fee_invoices.employee_id. |
| B1 | fee_payment_line_allocations | c, f, u, primary key NULL, p, sequence position | 7 | public.fee_payment_line_allocations with typed columns |
| B1 | fee_payments | f, c | 2 | columns:public.fee_payments.employee_id. |
| B1 | lesson_note_documents | c, f, u, primary key NULL, p, sequence position | 8 | public.lesson_note_documents, public.lesson_notes with typed columns |
| B1 | lesson_note_reviews | c, f, primary key NULL, p, sequence position | 8 | public.lesson_note_reviews, public.lesson_notes with typed columns |
| B1 | lesson_notes | f, u, primary key NULL, p, c, unique index, sequence position | 17 | public.lesson_notes, public.curriculum_versions, public.school_curriculum_assignments with typed columns |
| B1 | payroll_employee_profiles | c, f, u, primary key NULL, p, unique index, sequence position | 17 | public.payroll_employee_profiles with typed columns |
| B1 | payroll_items | c, u, f, primary key NULL, p, unique index, sequence position | 14 | public.payroll_items, public.payroll_periods, public.payroll_employee_profiles with typed columns |
| B1 | payroll_payslips | c, u, f, primary key NULL, p, unique index, sequence position | 13 | public.payroll_payslips, public.payroll_items, public.payroll_transfers with typed columns |
| B1 | payroll_periods | c, f, u, primary key NULL, p, unique index, sequence position | 16 | public.payroll_periods with typed columns |
| B1 | payroll_transfers | c, u, f, primary key NULL, p, unique index, sequence position | 18 | public.payroll_transfers, public.payroll_items with typed columns |
| B1 | promotion_batch_students | f, u, primary key NULL, p, c, sequence position | 19 | public.promotion_batch_students, public.promotion_batches with typed columns |
| B1 | promotion_batches | c, f, u, primary key NULL, p, sequence position | 17 | public.promotion_batches with typed columns |
| B1 | promotion_history | f, c, primary key NULL, p, sequence position | 10 | public.promotion_history, public.promotion_batches, public.promotion_batch_students with typed columns |
| B1 | school_authorized_pickup_persons | f, primary key NULL, p, c, u, sequence position | 14 | public.school_authorized_pickup_persons with typed columns |
| B1 | school_branding_logos | c, primary key NULL, p, f, unique index, sequence position | 9 | public.school_branding_logos with typed columns |
| B1 | school_calendar_events | c, f, u, primary key NULL, p, unique index, sequence position | 15 | public.school_calendar_events with typed columns |
| B1 | school_curriculum_assignments | f, u, primary key NULL, p, c, unique index, sequence position | 13 | public.school_curriculum_assignments, public.curriculum_versions with typed columns |
| B1 | school_pickup_requests | f, u, c, primary key NULL, p, sequence position | 18 | public.school_pickup_requests, public.school_authorized_pickup_persons, public.security_events with typed columns |
| B1 | school_security_incident_attachments | u, f, c, primary key NULL, p, sequence position | 13 | public.school_security_incident_attachments, public.school_security_incidents with typed columns |
| B1 | school_security_incidents | f, u, c, primary key NULL, p, sequence position | 16 | public.school_security_incidents, public.security_locations with typed columns |
| B1 | school_security_operation_history | f, c, primary key NULL, p, u, sequence position | 10 | public.school_security_operation_history with typed columns |
| B1 | school_security_visitors | u, c, f, primary key NULL, p, sequence position | 15 | public.school_security_visitors, public.security_locations with typed columns |
| B1 | school_subscription_enforcement | primary key NULL, p, f | 4 | public.school_subscription_enforcement with typed columns |
| B1 | school_subscription_manual_locks | c, f, primary key NULL, p | 6 | public.school_subscription_manual_locks with typed columns |
| B1 | security_events | f, c, u, primary key NULL, p, sequence position | 24 | public.security_events, public.security_locations, public.security_readers with typed columns |
| B1 | security_locations | f, u, primary key NULL, p, c, sequence position | 10 | public.security_locations with typed columns |
| B1 | security_readers | f, u, c, primary key NULL, p, sequence position | 12 | public.security_readers, public.security_locations with typed columns |
| B1 | security_school_settings | primary key NULL, p, f | 4 | public.security_school_settings with typed columns |
| B1 | security_staff_grants | f, u, c, primary key NULL, p, unique index, sequence position | 12 | public.security_staff_grants with typed columns |
| B1 | settlement_payroll_audit_events | c, f, primary key NULL, p, sequence position | 8 | public.settlement_payroll_audit_events with typed columns |
| B1 | settlement_payroll_profiles | c, f, u, primary key NULL, p, unique index, sequence position | 16 | public.settlement_payroll_profiles with typed columns |
| B1 | staff_nfc_allocations | c, f, u, primary key NULL, p, unique index, sequence position | 18 | public.staff_nfc_allocations, public.staff_nfc_payments, public.staff_nfc_refunds, public.staff_nfc_billing_rules, public.staff_nfc_subscriptions with typed columns |
| B1 | staff_nfc_billing_rules | c, f, u, primary key NULL, p, sequence position | 13 | public.staff_nfc_billing_rules with typed columns |
| B1 | staff_nfc_partner_commissions | f, u, c, primary key NULL, p, sequence position | 14 | public.staff_nfc_partner_commissions, public.staff_nfc_allocations, public.staff_nfc_payments, public.staff_nfc_subscriptions with typed columns |
| B1 | staff_nfc_payments | f, u, c, primary key NULL, p, unique index, sequence position | 18 | public.staff_nfc_payments, public.staff_nfc_subscriptions with typed columns |
| B1 | staff_nfc_provider_events | c, f, primary key NULL, p, u, sequence position | 8 | public.staff_nfc_provider_events, public.staff_nfc_payments with typed columns |
| B1 | staff_nfc_receipts | u, f, primary key NULL, p, c, sequence position | 8 | public.staff_nfc_receipts, public.staff_nfc_payments with typed columns |
| B1 | staff_nfc_refunds | c, f, u, primary key NULL, p, unique index, sequence position | 11 | public.staff_nfc_refunds, public.staff_nfc_payments with typed columns |
| B1 | staff_nfc_subscriptions | c, f, u, primary key NULL, p, sequence position | 18 | public.staff_nfc_subscriptions, public.staff_nfc_billing_rules with typed columns |
| B1 | student_behaviour_configurations | c, primary key NULL, p, f | 7 | public.student_behaviour_configurations with typed columns |
| B1 | student_behaviour_records | c, f, u, primary key NULL, p, sequence position | 16 | public.student_behaviour_records with typed columns |
| B1 | student_care_grants | f, u, c, primary key NULL, p, sequence position | 9 | public.student_care_grants with typed columns |
| B1 | student_care_idempotency | f, primary key NULL, p, c, u, sequence position | 11 | public.student_care_idempotency with typed columns |
| B1 | student_care_record_history | u, f, primary key NULL, p, c, sequence position | 9 | public.student_care_record_history with typed columns |
| B1 | student_medical_profiles | c, u, primary key NULL, p, f, sequence position | 15 | public.student_medical_profiles with typed columns |
| B1 | student_medical_visits | u, primary key NULL, p, c, f, sequence position | 9 | public.student_medical_visits with typed columns |
| B1 | student_nfc_replacement_requests | f, c, u, primary key NULL, p, sequence position | 18 | public.student_nfc_replacement_requests with typed columns |
| F0060 | student_subscription_allocations | c, f, u, primary key NULL, p, unique index, sequence position | 21 | public.student_subscription_allocations, public.student_subscription_payments with typed columns |
| F0060 | student_subscription_payments | c, u, f, primary key NULL, p, unique index, sequence position | 20 | public.student_subscription_payments with typed columns |
| B1 | student_subscription_terms | f, c, primary key NULL, p, u | 10 | public.student_subscription_terms with typed columns |
| B1 | student_welfare_records | f, c, u, primary key NULL, p, sequence position | 14 | public.student_welfare_records with typed columns |
| B1 | teacher_duty_roster | f, c, u, primary key NULL, p, unique index, sequence position | 11 | public.teacher_duty_roster with typed columns |
| B1 | teacher_subject_assignments | f, c, u, primary key NULL, p, unique index, sequence position | 12 | public.teacher_subject_assignments with typed columns |
| B1 | transport_buses | c, f, u, primary key NULL, p, unique index, sequence position | 12 | public.transport_buses with typed columns |
| B1 | transport_fee_invoices | c, f, u, primary key NULL, p, sequence position | 18 | public.transport_fee_invoices, public.transport_student_assignments with typed columns |
| B1 | transport_history | f, c, primary key NULL, p, sequence position | 13 | public.transport_history, public.transport_student_assignments, public.transport_buses, public.transport_parent_requests, public.transport_routes, public.transport_route_staff with typed columns |
| B1 | transport_parent_requests | c, f, u, primary key NULL, p, unique index, sequence position | 16 | public.transport_parent_requests, public.transport_student_assignments with typed columns |
| B1 | transport_route_staff | f, u, primary key NULL, p, c, unique index, sequence position | 10 | public.transport_route_staff, public.transport_routes with typed columns |
| B1 | transport_route_stops | f, u, c, primary key NULL, p, sequence position | 12 | public.transport_route_stops, public.transport_routes with typed columns |
| B1 | transport_routes | c, f, u, primary key NULL, p, sequence position | 15 | public.transport_routes, public.transport_buses with typed columns |
| B1 | transport_school_policies | c, primary key NULL, p, f | 5 | public.transport_school_policies with typed columns |
| B1 | transport_student_assignments | f, c, u, primary key NULL, p, unique index, sequence position | 15 | public.transport_student_assignments, public.transport_route_stops, public.transport_routes with typed columns |

## Canonical final acceptance
Canonical model counts: {"tables":173,"columns":2309,"constraints":1432,"indexes":674,"functions":18,"triggers":22,"sequences":158}. Prior validated retained-object catalog counts: {"tables":173,"columns":2309,"constraints":1437,"indexes":671,"functions":18,"triggers":22,"sequences":158}. Do not blindly require equal raw index/constraint counts: retained equivalent tenant keys/index bindings produce documented differences. Require full canonical semantic coverage, the explicitly reviewed retained-extra allowlist, no conflicting extra CHECK, and preserved PK/index/FK OIDs where applicable. Final rerun of all 1,890 must have Failed=0 and prerequisite-blocked=0; conditional missing-column checks may become not applicable after columns exist. Sequence warnings require authoritative primary/cache evidence, not replica substitution.

## Summary
105 forward migrations; 5 execution batches; 8 mandatory checkpoints including the external Finance boundary; 1,006 blocked checks mapped; 105 conservatively HIGH-risk migrations; 0 unresolved graph dependencies. Execution readiness, target identity, backup evidence, journal legitimacy and supported route remain gated.
