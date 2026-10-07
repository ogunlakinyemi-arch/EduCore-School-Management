# Exact Batch 1 checklist — 0061–0115

**NOT EXECUTED. BLOCKED — FINAL EXECUTION GATE INCOMPLETE.** Checkboxes are future execution-checkpoint requirements, not actions performed by this read-only gate. No commands/runner or rollout approval are provided. This is 55 pinned files, in exact reviewed order.

No batching/ordering change to the existing plan. Each of the 965 checks is assigned to exactly one first-available filename; source plan's prerequisite-provider lists can contain multiple filenames for the same check and must not be summed as independent unlocks. 41 checks depend on the separately gated unchanged-0060 milestone. Current observed states are cached replica planning states, never primary certification.

Global requirements: verified authoritative primary, usable recovery protection, legitimate history, supported executor with confirmed transaction/commit/pause behavior, approved write-quiescence and preservation baselines, unchanged source hashes and exact prerequisites. Do not execute any file during this review.

## 0061_reconcile_sequences_a_1.sql

- [ ] Hash matches **139dbbf347107caa7761c2652cbd1bd3c33c86c4833047bcd0664c1fc95b3644**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: none of the forward package; common A/system/temp-helper prerequisites still required.
- [ ] Required objects verified: canonical system schemas/types and session-local guards; no public-object creation prerequisites.
- [ ] Expected schema: Missing sequences may be created with listed exact parameters; matching existing sequences remain unchanged; any different metadata fails closed. No ownership attachment in this structural tier unless already legitimately owned.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Create only missing sequences; new empty sequences retain canonical start/is_called semantics. Existing current last_value/is_called/cache positions and OIDs are preserved, not compared blindly with canonical start.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| sequences | sequences:public.academic_assessment_types.academic_assessment_types_id_seq. | CREATE SEQUENCE public."academic_assessment_types_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.academic_assessments.academic_assessments_id_seq. | CREATE SEQUENCE public."academic_assessments_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.academic_assignments.academic_assignments_id_seq. | CREATE SEQUENCE public."academic_assignments_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.academic_grading_rules.academic_grading_rules_id_seq. | CREATE SEQUENCE public."academic_grading_rules_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.academic_report_card_lines.academic_report_card_lines_id_seq. | CREATE SEQUENCE public."academic_report_card_lines_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.academic_report_cards.academic_report_cards_id_seq. | CREATE SEQUENCE public."academic_report_cards_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.academic_sessions.academic_sessions_id_seq. | CREATE SEQUENCE public."academic_sessions_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.academic_terms.academic_terms_id_seq. | CREATE SEQUENCE public."academic_terms_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.academic_timetable_entries.academic_timetable_entries_id_seq. | CREATE SEQUENCE public."academic_timetable_entries_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.app_users.app_users_id_seq. | CREATE SEQUENCE public."app_users_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.attendance_corrections.attendance_corrections_id_seq. | CREATE SEQUENCE public."attendance_corrections_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.attendance_notification_events.attendance_notification_events_id_seq. | CREATE SEQUENCE public."attendance_notification_events_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.attendance_settings.attendance_settings_id_seq. | CREATE SEQUENCE public."attendance_settings_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.audit_logs.audit_logs_id_seq. | CREATE SEQUENCE public."audit_logs_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.biometric_enrollments.biometric_enrollments_id_seq. | CREATE SEQUENCE public."biometric_enrollments_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.commission_ledger.commission_ledger_id_seq. | CREATE SEQUENCE public."commission_ledger_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.commission_rules.commission_rules_id_seq. | CREATE SEQUENCE public."commission_rules_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.communication_campaign_recipients.communication_campaign_recipients_id_seq. | CREATE SEQUENCE public."communication_campaign_recipients_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.communication_preferences.communication_preferences_id_seq. | CREATE SEQUENCE public."communication_preferences_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.device_assignment_history.device_assignment_history_id_seq. | CREATE SEQUENCE public."device_assignment_history_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.device_credentials.device_credentials_id_seq. | CREATE SEQUENCE public."device_credentials_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_adjustments.fee_adjustments_id_seq. | CREATE SEQUENCE public."fee_adjustments_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_invoice_lines.fee_invoice_lines_id_seq. | CREATE SEQUENCE public."fee_invoice_lines_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_invoice_notification_outbox.fee_invoice_notification_outbox_id_seq. | CREATE SEQUENCE public."fee_invoice_notification_outbox_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_invoice_notifications.fee_invoice_notifications_id_seq. | CREATE SEQUENCE public."fee_invoice_notifications_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_payment_notification_outbox.fee_payment_notification_outbox_id_seq. | CREATE SEQUENCE public."fee_payment_notification_outbox_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_payment_notifications.fee_payment_notifications_id_seq. | CREATE SEQUENCE public."fee_payment_notifications_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_provider_webhook_events.fee_provider_webhook_events_id_seq. | CREATE SEQUENCE public."fee_provider_webhook_events_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_receipts.fee_receipts_id_seq. | CREATE SEQUENCE public."fee_receipts_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_refunds.fee_refunds_id_seq. | CREATE SEQUENCE public."fee_refunds_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_structure_lines.fee_structure_lines_id_seq. | CREATE SEQUENCE public."fee_structure_lines_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_structures.fee_structures_id_seq. | CREATE SEQUENCE public."fee_structures_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.library_authors.library_authors_id_seq. | CREATE SEQUENCE public."library_authors_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.library_book_copies.library_book_copies_id_seq. | CREATE SEQUENCE public."library_book_copies_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.library_books.library_books_id_seq. | CREATE SEQUENCE public."library_books_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.library_categories.library_categories_id_seq. | CREATE SEQUENCE public."library_categories_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.library_copy_status_history.library_copy_status_history_id_seq. | CREATE SEQUENCE public."library_copy_status_history_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.library_loans.library_loans_id_seq. | CREATE SEQUENCE public."library_loans_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.library_publishers.library_publishers_id_seq. | CREATE SEQUENCE public."library_publishers_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.library_renewals.library_renewals_id_seq. | CREATE SEQUENCE public."library_renewals_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.library_staff.library_staff_id_seq. | CREATE SEQUENCE public."library_staff_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.maintenance_requests.maintenance_requests_id_seq. | CREATE SEQUENCE public."maintenance_requests_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.nfc_card_history.nfc_card_history_id_seq. | CREATE SEQUENCE public."nfc_card_history_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.nfc_cards.nfc_cards_id_seq. | CREATE SEQUENCE public."nfc_cards_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.operational_tasks.operational_tasks_id_seq. | CREATE SEQUENCE public."operational_tasks_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.parent_student_relationships.parent_student_relationships_id_seq. | CREATE SEQUENCE public."parent_student_relationships_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.parents.parents_id_seq. | CREATE SEQUENCE public."parents_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.partner_attribution_conflicts.partner_attribution_conflicts_id_seq. | CREATE SEQUENCE public."partner_attribution_conflicts_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.partner_invitations.partner_invitations_id_seq. | CREATE SEQUENCE public."partner_invitations_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.partner_payout_information.partner_payout_information_id_seq. | CREATE SEQUENCE public."partner_payout_information_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.partner_payouts.partner_payouts_id_seq. | CREATE SEQUENCE public."partner_payouts_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.partner_referral_links.partner_referral_links_id_seq. | CREATE SEQUENCE public."partner_referral_links_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.platform_company_employees.platform_company_employees_id_seq. | CREATE SEQUENCE public."platform_company_employees_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.platform_notifications.platform_notifications_id_seq. | CREATE SEQUENCE public."platform_notifications_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_assets.school_assets_id_seq. | CREATE SEQUENCE public."school_assets_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_classes.school_classes_id_seq. | CREATE SEQUENCE public."school_classes_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_facilities.school_facilities_id_seq. | CREATE SEQUENCE public."school_facilities_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_memberships.school_memberships_id_seq. | CREATE SEQUENCE public."school_memberships_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.schools.schools_id_seq. | CREATE SEQUENCE public."schools_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.student_identification_policies.student_identification_policies_id_seq. | CREATE SEQUENCE public."student_identification_policies_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.students.students_id_seq. | CREATE SEQUENCE public."students_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.subscriptions.subscriptions_id_seq. | CREATE SEQUENCE public."subscriptions_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.academic_assessment_types; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_assessments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_assignments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_grading_rules; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_report_card_lines; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_report_cards; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_sessions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_terms; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_timetable_entries; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.app_users; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_corrections; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_notification_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.audit_logs; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.biometric_enrollments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.commission_ledger; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.commission_rules; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_campaign_recipients; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_preferences; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.device_assignment_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.device_credentials; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_adjustments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoice_lines; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoice_notification_outbox; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoice_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payment_notification_outbox; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payment_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_provider_webhook_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_receipts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_refunds; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_structure_lines; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_structures; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_authors; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_book_copies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_books; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_categories; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_copy_status_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_loans; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_publishers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_renewals; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_staff; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.maintenance_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.nfc_card_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.nfc_cards; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.operational_tasks; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.parent_student_relationships; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.parents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_attribution_conflicts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_invitations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_payout_information; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_payouts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_referral_links; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.platform_company_employees; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.platform_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_assets; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_classes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_facilities; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_memberships; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.schools; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_identification_policies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.students; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.subscriptions; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_assessment_types_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_assessments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_assignments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_grading_rules_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_report_card_lines_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_report_cards_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_sessions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_terms_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_timetable_entries_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.app_users_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.attendance_corrections_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.attendance_notification_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.attendance_settings_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.audit_logs_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.biometric_enrollments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.commission_ledger_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.commission_rules_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_campaign_recipients_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_preferences_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.device_assignment_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.device_credentials_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_adjustments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_invoice_lines_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_invoice_notification_outbox_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_invoice_notifications_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_payment_notification_outbox_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_payment_notifications_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_provider_webhook_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_receipts_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_refunds_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_structure_lines_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_structures_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_authors_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_book_copies_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_books_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_categories_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_copy_status_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_loans_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_publishers_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_renewals_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_staff_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.maintenance_requests_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.nfc_card_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.nfc_cards_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.operational_tasks_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.parent_student_relationships_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.parents_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_attribution_conflicts_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_invitations_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_payout_information_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_payouts_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_referral_links_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.platform_company_employees_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.platform_notifications_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_assets_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_classes_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_facilities_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_memberships_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.schools_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_identification_policies_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.students_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.subscriptions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0062_reconcile_sequences_b_1.sql

- [ ] Hash matches **432f1f5aaea9a9d1b42af6d7e82808736e43ff43a0311ca3016d464f0fb7743c**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: none of the forward package; common A/system/temp-helper prerequisites still required.
- [ ] Required objects verified: canonical system schemas/types and session-local guards; no public-object creation prerequisites.
- [ ] Expected schema: Missing sequences may be created with listed exact parameters; matching existing sequences remain unchanged; any different metadata fails closed. No ownership attachment in this structural tier unless already legitimately owned.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Create only missing sequences; new empty sequences retain canonical start/is_called semantics. Existing current last_value/is_called/cache positions and OIDs are preserved, not compared blindly with canonical start.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| sequences | sequences:public.partner_profile_users.partner_profile_users_id_seq. | CREATE SEQUENCE public."partner_profile_users_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.partner_profiles.partner_profiles_id_seq. | CREATE SEQUENCE public."partner_profiles_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_branding_logos.school_branding_logos_id_seq. | CREATE SEQUENCE public."school_branding_logos_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_calendar_events.school_calendar_events_id_seq. | CREATE SEQUENCE public."school_calendar_events_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_partner_attributions.school_partner_attributions_id_seq. | CREATE SEQUENCE public."school_partner_attributions_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.teacher_duty_roster.teacher_duty_roster_id_seq. | CREATE SEQUENCE public."teacher_duty_roster_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.teacher_subject_assignments.teacher_subject_assignments_id_seq. | CREATE SEQUENCE public."teacher_subject_assignments_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.partner_profile_users; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_branding_logos; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_calendar_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_partner_attributions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.teacher_duty_roster; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.teacher_subject_assignments; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_profile_users_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_profiles_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_branding_logos_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_calendar_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_partner_attributions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.teacher_duty_roster_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.teacher_subject_assignments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0063_reconcile_sequences_c_1.sql

- [ ] Hash matches **cf4c0c0de415b65c10cb60143ffeb5ae51d4b6c1f647768cd14c75dd9212b440**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: none of the forward package; common A/system/temp-helper prerequisites still required.
- [ ] Required objects verified: canonical system schemas/types and session-local guards; no public-object creation prerequisites.
- [ ] Expected schema: Missing sequences may be created with listed exact parameters; matching existing sequences remain unchanged; any different metadata fails closed. No ownership attachment in this structural tier unless already legitimately owned.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Create only missing sequences; new empty sequences retain canonical start/is_called semantics. Existing current last_value/is_called/cache positions and OIDs are preserved, not compared blindly with canonical start.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| sequences | sequences:public.admission_application_documents.admission_application_documents_id_seq. | CREATE SEQUENCE public."admission_application_documents_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.admission_applications.admission_applications_id_seq. | CREATE SEQUENCE public."admission_applications_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.class_subjects.class_subjects_id_seq. | CREATE SEQUENCE public."class_subjects_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.employees.employees_id_seq. | CREATE SEQUENCE public."employees_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.student_behaviour_records.student_behaviour_records_id_seq. | CREATE SEQUENCE public."student_behaviour_records_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.student_care_grants.student_care_grants_id_seq. | CREATE SEQUENCE public."student_care_grants_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.student_care_idempotency.student_care_idempotency_id_seq. | CREATE SEQUENCE public."student_care_idempotency_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.student_care_record_history.student_care_record_history_id_seq. | CREATE SEQUENCE public."student_care_record_history_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.student_class_assignments.student_class_assignments_id_seq. | CREATE SEQUENCE public."student_class_assignments_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.student_medical_profiles.student_medical_profiles_id_seq. | CREATE SEQUENCE public."student_medical_profiles_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.student_medical_visits.student_medical_visits_id_seq. | CREATE SEQUENCE public."student_medical_visits_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.student_welfare_records.student_welfare_records_id_seq. | CREATE SEQUENCE public."student_welfare_records_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.subjects.subjects_id_seq. | CREATE SEQUENCE public."subjects_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.teacher_class_assignments.teacher_class_assignments_id_seq. | CREATE SEQUENCE public."teacher_class_assignments_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.admission_application_documents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.admission_applications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.class_subjects; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employees; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_behaviour_records; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_care_grants; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_care_idempotency; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_care_record_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_class_assignments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_medical_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_medical_visits; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_welfare_records; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.subjects; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.teacher_class_assignments; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.admission_application_documents_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.admission_applications_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.class_subjects_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.employees_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_behaviour_records_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_care_grants_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_care_idempotency_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_care_record_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_class_assignments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_medical_profiles_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_medical_visits_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_welfare_records_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.subjects_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.teacher_class_assignments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0064_reconcile_sequences_d_1.sql

- [ ] Hash matches **e508239c12a37fbb88b520d6b665404660655fd5b4ae11a1ab84194f0f466b01**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: none of the forward package; common A/system/temp-helper prerequisites still required.
- [ ] Required objects verified: canonical system schemas/types and session-local guards; no public-object creation prerequisites.
- [ ] Expected schema: Missing sequences may be created with listed exact parameters; matching existing sequences remain unchanged; any different metadata fails closed. No ownership attachment in this structural tier unless already legitimately owned.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Create only missing sequences; new empty sequences retain canonical start/is_called semantics. Existing current last_value/is_called/cache positions and OIDs are preserved, not compared blindly with canonical start.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| sequences | sequences:public.attendance_discrepancies.attendance_discrepancies_id_seq. | CREATE SEQUENCE public."attendance_discrepancies_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.attendance_events.attendance_events_id_seq. | CREATE SEQUENCE public."attendance_events_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_discrepancies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_events; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.attendance_discrepancies_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.attendance_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0065_reconcile_sequences_e_1.sql

- [ ] Hash matches **c012082477382af76235f78a4029baac70b24662821d5a11e15f91161767328e**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: none of the forward package; common A/system/temp-helper prerequisites still required.
- [ ] Required objects verified: canonical system schemas/types and session-local guards; no public-object creation prerequisites.
- [ ] Expected schema: Missing sequences may be created with listed exact parameters; matching existing sequences remain unchanged; any different metadata fails closed. No ownership attachment in this structural tier unless already legitimately owned.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Create only missing sequences; new empty sequences retain canonical start/is_called semantics. Existing current last_value/is_called/cache positions and OIDs are preserved, not compared blindly with canonical start.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| sequences | sequences:public.academic_result_batches.academic_result_batches_id_seq. | CREATE SEQUENCE public."academic_result_batches_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.academic_results.academic_results_id_seq. | CREATE SEQUENCE public."academic_results_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.curriculum_imports.curriculum_imports_id_seq. | CREATE SEQUENCE public."curriculum_imports_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.curriculum_progress.curriculum_progress_id_seq. | CREATE SEQUENCE public."curriculum_progress_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.curriculum_topics.curriculum_topics_id_seq. | CREATE SEQUENCE public."curriculum_topics_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.curriculum_versions.curriculum_versions_id_seq. | CREATE SEQUENCE public."curriculum_versions_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.exam_question_papers.exam_question_papers_id_seq. | CREATE SEQUENCE public."exam_question_papers_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.exam_question_reviews.exam_question_reviews_id_seq. | CREATE SEQUENCE public."exam_question_reviews_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.exam_question_versions.exam_question_versions_id_seq. | CREATE SEQUENCE public."exam_question_versions_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.lesson_note_documents.lesson_note_documents_id_seq. | CREATE SEQUENCE public."lesson_note_documents_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.lesson_note_reviews.lesson_note_reviews_id_seq. | CREATE SEQUENCE public."lesson_note_reviews_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.lesson_notes.lesson_notes_id_seq. | CREATE SEQUENCE public."lesson_notes_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.promotion_batch_students.promotion_batch_students_id_seq. | CREATE SEQUENCE public."promotion_batch_students_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.promotion_batches.promotion_batches_id_seq. | CREATE SEQUENCE public."promotion_batches_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.promotion_history.promotion_history_id_seq. | CREATE SEQUENCE public."promotion_history_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_curriculum_assignments.school_curriculum_assignments_id_seq. | CREATE SEQUENCE public."school_curriculum_assignments_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.academic_result_batches; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_results; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_imports; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_progress; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_topics; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_versions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.exam_question_papers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.exam_question_reviews; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.exam_question_versions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.lesson_note_documents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.lesson_note_reviews; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.lesson_notes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.promotion_batch_students; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.promotion_batches; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.promotion_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_curriculum_assignments; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_result_batches_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_results_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.curriculum_imports_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.curriculum_progress_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.curriculum_topics_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.curriculum_versions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.exam_question_papers_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.exam_question_reviews_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.exam_question_versions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.lesson_note_documents_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.lesson_note_reviews_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.lesson_notes_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.promotion_batch_students_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.promotion_batches_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.promotion_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_curriculum_assignments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0066_reconcile_sequences_f_1.sql

- [ ] Hash matches **28bbf763cb1163425731fe2a7d7d8f1d6af7bb41a4813b9cf369b54a9cbe7349**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: none of the forward package; common A/system/temp-helper prerequisites still required.
- [ ] Required objects verified: canonical system schemas/types and session-local guards; no public-object creation prerequisites.
- [ ] Expected schema: Missing sequences may be created with listed exact parameters; matching existing sequences remain unchanged; any different metadata fails closed. No ownership attachment in this structural tier unless already legitimately owned.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Create only missing sequences; new empty sequences retain canonical start/is_called semantics. Existing current last_value/is_called/cache positions and OIDs are preserved, not compared blindly with canonical start.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| sequences | sequences:public.fee_categories.fee_categories_id_seq. | CREATE SEQUENCE public."fee_categories_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_invoices.fee_invoices_id_seq. | CREATE SEQUENCE public."fee_invoices_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_payment_line_allocations.fee_payment_line_allocations_id_seq. | CREATE SEQUENCE public."fee_payment_line_allocations_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.fee_payments.fee_payments_id_seq. | CREATE SEQUENCE public."fee_payments_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.payroll_employee_profiles.payroll_employee_profiles_id_seq. | CREATE SEQUENCE public."payroll_employee_profiles_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.payroll_items.payroll_items_id_seq. | CREATE SEQUENCE public."payroll_items_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.payroll_payslips.payroll_payslips_id_seq. | CREATE SEQUENCE public."payroll_payslips_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.payroll_periods.payroll_periods_id_seq. | CREATE SEQUENCE public."payroll_periods_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.payroll_transfers.payroll_transfers_id_seq. | CREATE SEQUENCE public."payroll_transfers_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.settlement_payroll_audit_events.settlement_payroll_audit_events_id_seq. | CREATE SEQUENCE public."settlement_payroll_audit_events_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.settlement_payroll_profiles.settlement_payroll_profiles_id_seq. | CREATE SEQUENCE public."settlement_payroll_profiles_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.staff_nfc_allocations.staff_nfc_allocations_id_seq. | CREATE SEQUENCE public."staff_nfc_allocations_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.staff_nfc_billing_rules.staff_nfc_billing_rules_id_seq. | CREATE SEQUENCE public."staff_nfc_billing_rules_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.staff_nfc_partner_commissions.staff_nfc_partner_commissions_id_seq. | CREATE SEQUENCE public."staff_nfc_partner_commissions_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.staff_nfc_payments.staff_nfc_payments_id_seq. | CREATE SEQUENCE public."staff_nfc_payments_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.staff_nfc_provider_events.staff_nfc_provider_events_id_seq. | CREATE SEQUENCE public."staff_nfc_provider_events_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.staff_nfc_receipts.staff_nfc_receipts_id_seq. | CREATE SEQUENCE public."staff_nfc_receipts_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.staff_nfc_refunds.staff_nfc_refunds_id_seq. | CREATE SEQUENCE public."staff_nfc_refunds_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.staff_nfc_subscriptions.staff_nfc_subscriptions_id_seq. | CREATE SEQUENCE public."staff_nfc_subscriptions_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.student_nfc_replacement_requests.student_nfc_replacement_requests_id_seq. | CREATE SEQUENCE public."student_nfc_replacement_requests_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.fee_categories; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payment_line_allocations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_employee_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_items; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_payslips; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_periods; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_transfers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.settlement_payroll_audit_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.settlement_payroll_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_allocations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_billing_rules; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_partner_commissions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_payments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_provider_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_receipts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_refunds; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_subscriptions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_nfc_replacement_requests; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_categories_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_invoices_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_payment_line_allocations_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_payments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.payroll_employee_profiles_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.payroll_items_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.payroll_payslips_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.payroll_periods_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.payroll_transfers_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.settlement_payroll_audit_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.settlement_payroll_profiles_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_allocations_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_billing_rules_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_partner_commissions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_payments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_provider_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_receipts_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_refunds_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_subscriptions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_nfc_replacement_requests_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0067_reconcile_sequences_g_1.sql

- [ ] Hash matches **a2271f414a4e12e93d5d0d4cbf9a8848aae8f57150839a1601e2fa063393941e**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: none of the forward package; common A/system/temp-helper prerequisites still required.
- [ ] Required objects verified: canonical system schemas/types and session-local guards; no public-object creation prerequisites.
- [ ] Expected schema: Missing sequences may be created with listed exact parameters; matching existing sequences remain unchanged; any different metadata fails closed. No ownership attachment in this structural tier unless already legitimately owned.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Create only missing sequences; new empty sequences retain canonical start/is_called semantics. Existing current last_value/is_called/cache positions and OIDs are preserved, not compared blindly with canonical start.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| sequences | sequences:public.campus_presence.campus_presence_id_seq. | CREATE SEQUENCE public."campus_presence_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.employee_nfc_attendance_discrepancies.employee_nfc_attendance_discrepancies_id_seq. | CREATE SEQUENCE public."employee_nfc_attendance_discrepancies_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.employee_nfc_card_bindings.employee_nfc_card_bindings_id_seq. | CREATE SEQUENCE public."employee_nfc_card_bindings_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.employee_nfc_card_history.employee_nfc_card_history_id_seq. | CREATE SEQUENCE public."employee_nfc_card_history_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.employee_nfc_discrepancy_actions.employee_nfc_discrepancy_actions_id_seq. | CREATE SEQUENCE public."employee_nfc_discrepancy_actions_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.maintenance_request_status_history.maintenance_request_status_history_id_seq. | CREATE SEQUENCE public."maintenance_request_status_history_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.operational_task_status_history.operational_task_status_history_id_seq. | CREATE SEQUENCE public."operational_task_status_history_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.platform_devices.platform_devices_id_seq. | CREATE SEQUENCE public."platform_devices_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_asset_history.school_asset_history_id_seq. | CREATE SEQUENCE public."school_asset_history_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_authorized_pickup_persons.school_authorized_pickup_persons_id_seq. | CREATE SEQUENCE public."school_authorized_pickup_persons_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_operation_categories.school_operation_categories_id_seq. | CREATE SEQUENCE public."school_operation_categories_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_pickup_requests.school_pickup_requests_id_seq. | CREATE SEQUENCE public."school_pickup_requests_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_security_incident_attachments.school_security_incident_attachments_id_seq. | CREATE SEQUENCE public."school_security_incident_attachments_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_security_incidents.school_security_incidents_id_seq. | CREATE SEQUENCE public."school_security_incidents_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_security_operation_history.school_security_operation_history_id_seq. | CREATE SEQUENCE public."school_security_operation_history_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.school_security_visitors.school_security_visitors_id_seq. | CREATE SEQUENCE public."school_security_visitors_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.security_events.security_events_id_seq. | CREATE SEQUENCE public."security_events_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.security_locations.security_locations_id_seq. | CREATE SEQUENCE public."security_locations_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.security_readers.security_readers_id_seq. | CREATE SEQUENCE public."security_readers_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.security_staff_grants.security_staff_grants_id_seq. | CREATE SEQUENCE public."security_staff_grants_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.transport_buses.transport_buses_id_seq. | CREATE SEQUENCE public."transport_buses_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.transport_fee_invoices.transport_fee_invoices_id_seq. | CREATE SEQUENCE public."transport_fee_invoices_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.transport_history.transport_history_id_seq. | CREATE SEQUENCE public."transport_history_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.transport_parent_requests.transport_parent_requests_id_seq. | CREATE SEQUENCE public."transport_parent_requests_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.transport_route_staff.transport_route_staff_id_seq. | CREATE SEQUENCE public."transport_route_staff_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.transport_route_stops.transport_route_stops_id_seq. | CREATE SEQUENCE public."transport_route_stops_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.transport_routes.transport_routes_id_seq. | CREATE SEQUENCE public."transport_routes_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.transport_student_assignments.transport_student_assignments_id_seq. | CREATE SEQUENCE public."transport_student_assignments_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.campus_presence; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_attendance_discrepancies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_card_bindings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_card_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_discrepancy_actions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.maintenance_request_status_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.operational_task_status_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.platform_devices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_asset_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_authorized_pickup_persons; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_operation_categories; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_pickup_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_incident_attachments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_incidents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_operation_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_visitors; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_locations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_readers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_staff_grants; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_buses; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_fee_invoices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_parent_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_route_staff; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_route_stops; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_routes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_student_assignments; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.campus_presence_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.employee_nfc_attendance_discrepancies_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.employee_nfc_card_bindings_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.employee_nfc_card_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.employee_nfc_discrepancy_actions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.maintenance_request_status_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.operational_task_status_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.platform_devices_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_asset_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_authorized_pickup_persons_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_operation_categories_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_pickup_requests_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_security_incident_attachments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_security_incidents_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_security_operation_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_security_visitors_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.security_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.security_locations_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.security_readers_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.security_staff_grants_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_buses_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_fee_invoices_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_parent_requests_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_route_staff_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_route_stops_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_routes_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_student_assignments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0068_reconcile_sequences_h_1.sql

- [ ] Hash matches **41d14c77f9ab96cdddbe6f27264dc16f3b7d47ecb3ba030a094c3004bea71279**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: none of the forward package; common A/system/temp-helper prerequisites still required.
- [ ] Required objects verified: canonical system schemas/types and session-local guards; no public-object creation prerequisites.
- [ ] Expected schema: Missing sequences may be created with listed exact parameters; matching existing sequences remain unchanged; any different metadata fails closed. No ownership attachment in this structural tier unless already legitimately owned.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Create only missing sequences; new empty sequences retain canonical start/is_called semantics. Existing current last_value/is_called/cache positions and OIDs are preserved, not compared blindly with canonical start.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| sequences | sequences:public.communication_campaigns.communication_campaigns_id_seq. | CREATE SEQUENCE public."communication_campaigns_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.communication_deliveries.communication_deliveries_id_seq. | CREATE SEQUENCE public."communication_deliveries_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.communication_message_threads.communication_message_threads_id_seq. | CREATE SEQUENCE public."communication_message_threads_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.communication_messages.communication_messages_id_seq. | CREATE SEQUENCE public."communication_messages_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.communication_notifications.communication_notifications_id_seq. | CREATE SEQUENCE public."communication_notifications_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.communication_push_devices.communication_push_devices_id_seq. | CREATE SEQUENCE public."communication_push_devices_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |
| sequences | sequences:public.communication_templates.communication_templates_id_seq. | CREATE SEQUENCE public."communication_templates_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.communication_campaigns; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_deliveries; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_message_threads; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_messages; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_push_devices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_templates; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_campaigns_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_deliveries_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_message_threads_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_messages_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_notifications_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_push_devices_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_templates_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0069_reconcile_table_shells_a_1.sql

- [ ] Hash matches **4923ae0629d962624bb5adbebfeaa09ad17c48ec9d275d4d702ccb8318db85f0**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0063_reconcile_sequences_c_1.sql.
- [ ] Required objects verified: sequences:public.academic_assessment_types.academic_assessment_types_id_seq.; sequences:public.academic_assessments.academic_assessments_id_seq.; sequences:public.academic_assignments.academic_assignments_id_seq.; sequences:public.academic_grading_rules.academic_grading_rules_id_seq.; sequences:public.academic_report_card_lines.academic_report_card_lines_id_seq.; sequences:public.academic_report_cards.academic_report_cards_id_seq.; sequences:public.academic_sessions.academic_sessions_id_seq.; sequences:public.academic_terms.academic_terms_id_seq.; sequences:public.academic_timetable_entries.academic_timetable_entries_id_seq.; sequences:public.app_users.app_users_id_seq.; sequences:public.attendance_corrections.attendance_corrections_id_seq.; sequences:public.attendance_notification_events.attendance_notification_events_id_seq.; sequences:public.attendance_settings.attendance_settings_id_seq.; sequences:public.audit_logs.audit_logs_id_seq.; sequences:public.biometric_enrollments.biometric_enrollments_id_seq.; sequences:public.commission_ledger.commission_ledger_id_seq.; sequences:public.commission_rules.commission_rules_id_seq.; sequences:public.communication_campaign_recipients.communication_campaign_recipients_id_seq.; sequences:public.communication_preferences.communication_preferences_id_seq.; sequences:public.device_assignment_history.device_assignment_history_id_seq.; sequences:public.device_credentials.device_credentials_id_seq.; sequences:public.fee_adjustments.fee_adjustments_id_seq.; sequences:public.fee_invoice_lines.fee_invoice_lines_id_seq.; sequences:public.fee_invoice_notification_outbox.fee_invoice_notification_outbox_id_seq.; sequences:public.fee_invoice_notifications.fee_invoice_notifications_id_seq.; sequences:public.fee_payment_notification_outbox.fee_payment_notification_outbox_id_seq.; sequences:public.fee_payment_notifications.fee_payment_notifications_id_seq.; sequences:public.fee_provider_webhook_events.fee_provider_webhook_events_id_seq.; sequences:public.fee_receipts.fee_receipts_id_seq.; sequences:public.fee_refunds.fee_refunds_id_seq.; sequences:public.fee_structure_lines.fee_structure_lines_id_seq.; sequences:public.fee_structures.fee_structures_id_seq.; sequences:public.library_authors.library_authors_id_seq.; sequences:public.library_book_copies.library_book_copies_id_seq.; sequences:public.library_books.library_books_id_seq.; sequences:public.library_categories.library_categories_id_seq.; sequences:public.library_copy_status_history.library_copy_status_history_id_seq.; sequences:public.library_loans.library_loans_id_seq.; sequences:public.library_publishers.library_publishers_id_seq.; sequences:public.library_renewals.library_renewals_id_seq.; sequences:public.library_staff.library_staff_id_seq.; sequences:public.maintenance_requests.maintenance_requests_id_seq.; sequences:public.nfc_card_history.nfc_card_history_id_seq.; sequences:public.nfc_cards.nfc_cards_id_seq.; sequences:public.operational_tasks.operational_tasks_id_seq.; sequences:public.parent_student_relationships.parent_student_relationships_id_seq.; sequences:public.parents.parents_id_seq.; sequences:public.partner_attribution_conflicts.partner_attribution_conflicts_id_seq.; sequences:public.partner_invitations.partner_invitations_id_seq.; sequences:public.partner_payout_information.partner_payout_information_id_seq.; sequences:public.partner_payouts.partner_payouts_id_seq.; sequences:public.partner_referral_links.partner_referral_links_id_seq.; sequences:public.employees.employees_id_seq.; sequences:public.platform_company_employees.platform_company_employees_id_seq.; sequences:public.platform_notifications.platform_notifications_id_seq.; sequences:public.school_assets.school_assets_id_seq.; sequences:public.school_classes.school_classes_id_seq.; sequences:public.school_facilities.school_facilities_id_seq.; sequences:public.school_memberships.school_memberships_id_seq.; sequences:public.schools.schools_id_seq.; sequences:public.student_identification_policies.student_identification_policies_id_seq.; sequences:public.students.students_id_seq.; sequences:public.subscriptions.subscriptions_id_seq..
- [ ] Expected schema: Missing tables receive complete typed column/default/NOT NULL shells exactly as listed; PK/UNIQUE/CHECK/FK enforcement belongs to later tiers. Existing matching table identity/storage contracts are preserved and later columns reconciled separately.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| tables | tables:public..academic_assessment_types. | CREATE TABLE public."academic_assessment_types" ("id" integer DEFAULT nextval('academic_assessment_types_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "name" text NOT NULL, "code" text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL) |
| tables | tables:public..academic_assessments. | CREATE TABLE public."academic_assessments" ("id" integer DEFAULT nextval('academic_assessments_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "school_class_id" integer NOT NULL, "section" text, "subject_id" integer NOT NULL, "assessment_type_id" integer NOT NULL, "teacher_employee_id" integer NOT NULL, "created_by" integer NOT NULL, "title" text NOT NULL, "description" text NOT NULL, "assessment_date" date NOT NULL, "max_score" numeric(10,2) NOT NULL, "status" text DEFAULT 'DRAFT'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..academic_assignments. | CREATE TABLE public."academic_assignments" ("id" integer DEFAULT nextval('academic_assignments_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "school_class_id" integer NOT NULL, "section" text, "subject_id" integer NOT NULL, "teacher_employee_id" integer NOT NULL, "created_by" integer NOT NULL, "title" text NOT NULL, "description" text NOT NULL, "issue_date" date NOT NULL, "due_date" date NOT NULL, "max_score" numeric(10,2) NOT NULL, "status" text DEFAULT 'DRAFT'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..academic_grading_rules. | CREATE TABLE public."academic_grading_rules" ("id" integer DEFAULT nextval('academic_grading_rules_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "min_score" numeric(10,2) NOT NULL, "max_score" numeric(10,2) NOT NULL, "grade" text NOT NULL, "grade_point" numeric(5,2), "remark" text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..academic_report_card_lines. | CREATE TABLE public."academic_report_card_lines" ("id" integer DEFAULT nextval('academic_report_card_lines_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "report_card_id" integer NOT NULL, "result_id" integer NOT NULL, "subject_id" integer NOT NULL, "subject_name_snapshot" text NOT NULL, "assessment_name_snapshot" text NOT NULL, "score" numeric(10,2) NOT NULL, "max_score" numeric(10,2) NOT NULL, "grade" text NOT NULL, "grade_point" numeric(5,2) NOT NULL, "remark" text NOT NULL) |
| tables | tables:public..academic_report_cards. | CREATE TABLE public."academic_report_cards" ("id" integer DEFAULT nextval('academic_report_cards_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "student_class_assignment_id" integer NOT NULL, "school_class_id" integer NOT NULL, "class_name_snapshot" text NOT NULL, "section_snapshot" text NOT NULL, "status" text DEFAULT 'DRAFT'::text NOT NULL, "teacher_remark" text NOT NULL, "school_remark" text NOT NULL, "published_by" integer, "published_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..academic_sessions. | CREATE TABLE public."academic_sessions" ("id" integer DEFAULT nextval('academic_sessions_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "name" text NOT NULL, "start_date" date NOT NULL, "end_date" date NOT NULL, "status" text DEFAULT 'PLANNED'::text NOT NULL, "is_current" boolean DEFAULT false NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "created_by" integer) |
| tables | tables:public..academic_terms. | CREATE TABLE public."academic_terms" ("id" integer DEFAULT nextval('academic_terms_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "name" text NOT NULL, "start_date" date NOT NULL, "end_date" date NOT NULL, "status" text DEFAULT 'PLANNED'::text NOT NULL, "is_current" boolean DEFAULT false NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "created_by" integer) |
| tables | tables:public..academic_timetable_entries. | CREATE TABLE public."academic_timetable_entries" ("id" integer DEFAULT nextval('academic_timetable_entries_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "school_class_id" integer NOT NULL, "section" text NOT NULL, "subject_id" integer NOT NULL, "teacher_employee_id" integer NOT NULL, "weekday" text NOT NULL, "start_time" time without time zone NOT NULL, "end_time" time without time zone NOT NULL, "room" text, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..app_users. | CREATE TABLE public."app_users" ("id" integer DEFAULT nextval('app_users_id_seq'::regclass) NOT NULL, "clerk_user_id" text NOT NULL, "email" text NOT NULL, "first_name" text, "last_name" text, "phone" text, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..attendance_corrections. | CREATE TABLE public."attendance_corrections" ("id" integer DEFAULT nextval('attendance_corrections_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "attendance_event_id" integer NOT NULL, "original_value" jsonb NOT NULL, "corrected_value" jsonb NOT NULL, "reason" text NOT NULL, "actor_user_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..attendance_notification_events. | CREATE TABLE public."attendance_notification_events" ("id" integer DEFAULT nextval('attendance_notification_events_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "attendance_event_id" integer, "discrepancy_id" integer, "notification_type" text NOT NULL, "channel" text NOT NULL, "status" text DEFAULT 'PENDING'::text NOT NULL, "recipient_user_id" integer, "payload" jsonb, "sent_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..attendance_settings. | CREATE TABLE public."attendance_settings" ("id" integer DEFAULT nextval('attendance_settings_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "entry_window_start" time without time zone, "entry_window_end" time without time zone, "exit_window_start" time without time zone, "exit_window_end" time without time zone, "classroom_window_start" time without time zone, "classroom_window_end" time without time zone, "duplicate_suppression_seconds" integer DEFAULT 30 NOT NULL, "notify_on_entry" boolean DEFAULT true NOT NULL, "notify_on_exit" boolean DEFAULT true NOT NULL, "notify_on_discrepancy" boolean DEFAULT true NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..audit_logs. | CREATE TABLE public."audit_logs" ("id" integer DEFAULT nextval('audit_logs_id_seq'::regclass) NOT NULL, "user" text NOT NULL, "role" text NOT NULL, "actor_user_id" integer, "clerk_user_id" text, "school_id" integer, "action" text NOT NULL, "module" text NOT NULL, "record_id" integer, "timestamp" timestamp with time zone DEFAULT now() NOT NULL, "severity" text DEFAULT 'info'::text NOT NULL, "event_type" text DEFAULT 'APPLICATION_EVENT'::text NOT NULL, "result" text DEFAULT 'SUCCESS'::text NOT NULL, "metadata" jsonb) |
| tables | tables:public..biometric_enrollments. | CREATE TABLE public."biometric_enrollments" ("id" integer DEFAULT nextval('biometric_enrollments_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer, "employee_id" integer, "device_id" integer, "provider" text NOT NULL, "provider_reference" text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "enrolled_at" timestamp with time zone DEFAULT now() NOT NULL, "revoked_at" timestamp with time zone, "metadata" jsonb) |
| tables | tables:public..commission_ledger. | CREATE TABLE public."commission_ledger" ("id" integer DEFAULT nextval('commission_ledger_id_seq'::regclass) NOT NULL, "partner_profile_id" integer NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "subscription_id" integer NOT NULL, "commission_rule_id" integer NOT NULL, "academic_session_id" integer, "term" text NOT NULL, "rate" numeric(12,4) NOT NULL, "count" integer DEFAULT 1 NOT NULL, "amount" numeric(12,2) NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "status" text DEFAULT 'PENDING'::text NOT NULL, "payout_id" integer, "approved_at" timestamp with time zone, "payable_at" timestamp with time zone, "paid_at" timestamp with time zone, "held_at" timestamp with time zone, "reversed_at" timestamp with time zone, "cancelled_at" timestamp with time zone, "payment_reference" text, "adjustment_reference" text, "reversal_reference" text, "created_by" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..commission_rules. | CREATE TABLE public."commission_rules" ("id" integer DEFAULT nextval('commission_rules_id_seq'::regclass) NOT NULL, "name" text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "term" text, "currency" text DEFAULT 'NGN'::text NOT NULL, "calculation_basis" text DEFAULT 'FIXED'::text NOT NULL, "effective_at" timestamp with time zone DEFAULT now() NOT NULL, "ends_at" timestamp with time zone, "partner_rate" numeric(12,4) DEFAULT '100'::numeric NOT NULL, "allocation_total" numeric(12,2) DEFAULT '5000'::numeric NOT NULL, "partner_amount" numeric(12,2) DEFAULT '100'::numeric NOT NULL, "school_amount" numeric(12,2) DEFAULT '2000'::numeric NOT NULL, "edupulse_amount" numeric(12,2) DEFAULT '2900'::numeric NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..communication_campaign_recipients. | CREATE TABLE public."communication_campaign_recipients" ("id" integer DEFAULT nextval('communication_campaign_recipients_id_seq'::regclass) NOT NULL, "campaign_id" integer NOT NULL, "school_id" integer NOT NULL, "recipient_user_id" integer NOT NULL, "notification_id" integer, "status" text DEFAULT 'QUEUED'::text NOT NULL, "error_code" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "sent_at" timestamp with time zone) |
| tables | tables:public..communication_preferences. | CREATE TABLE public."communication_preferences" ("id" integer DEFAULT nextval('communication_preferences_id_seq'::regclass) NOT NULL, "user_id" integer NOT NULL, "school_id" integer, "category" text NOT NULL, "channel" text NOT NULL, "enabled" boolean DEFAULT true NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..device_assignment_history. | CREATE TABLE public."device_assignment_history" ("id" integer DEFAULT nextval('device_assignment_history_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "device_id" integer NOT NULL, "previous_school_id" integer, "previous_location" text, "location" text, "action" text NOT NULL, "reason" text, "actor_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "new_school_id" integer) |
| tables | tables:public..device_credentials. | CREATE TABLE public."device_credentials" ("id" integer DEFAULT nextval('device_credentials_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "device_id" integer NOT NULL, "credential_identifier" text NOT NULL, "secret_hash" text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "issued_at" timestamp with time zone DEFAULT now() NOT NULL, "last_used_at" timestamp with time zone, "revoked_at" timestamp with time zone, "expires_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..fee_adjustments. | CREATE TABLE public."fee_adjustments" ("id" integer DEFAULT nextval('fee_adjustments_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "invoice_id" integer NOT NULL, "kind" text NOT NULL, "amount_minor" integer NOT NULL, "reason" text NOT NULL, "status" text DEFAULT 'PENDING'::text NOT NULL, "requested_by" integer NOT NULL, "approved_by" integer, "approved_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "requested_percentage" numeric(5,2), "approved_amount_minor" integer, "original_balance_minor" integer, "resulting_balance_minor" integer) |
| tables | tables:public..fee_invoice_lines. | CREATE TABLE public."fee_invoice_lines" ("id" integer DEFAULT nextval('fee_invoice_lines_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "invoice_id" integer NOT NULL, "category_id" integer, "category_name_snapshot" text NOT NULL, "description_snapshot" text NOT NULL, "amount_minor" integer NOT NULL) |
| tables | tables:public..fee_invoice_notification_outbox. | CREATE TABLE public."fee_invoice_notification_outbox" ("id" integer DEFAULT nextval('fee_invoice_notification_outbox_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "invoice_id" integer NOT NULL, "event_type" text DEFAULT 'INVOICE_GENERATED'::text NOT NULL, "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL, "attempts" integer DEFAULT 0 NOT NULL, "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL, "last_error" text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..fee_invoice_notifications. | CREATE TABLE public."fee_invoice_notifications" ("id" integer DEFAULT nextval('fee_invoice_notifications_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "invoice_id" integer NOT NULL, "recipient_user_id" integer NOT NULL, "recipient_role" text NOT NULL, "event_type" text DEFAULT 'INVOICE_GENERATED'::text NOT NULL, "channel" text DEFAULT 'IN_APP'::text NOT NULL, "is_read" boolean DEFAULT false NOT NULL, "read_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..fee_payment_notification_outbox. | CREATE TABLE public."fee_payment_notification_outbox" ("id" integer DEFAULT nextval('fee_payment_notification_outbox_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "payment_id" integer NOT NULL, "invoice_id" integer NOT NULL, "event_type" text NOT NULL, "event_reference_id" integer DEFAULT 0 NOT NULL, "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL, "attempts" integer DEFAULT 0 NOT NULL, "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL, "last_error" text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..fee_payment_notifications. | CREATE TABLE public."fee_payment_notifications" ("id" integer DEFAULT nextval('fee_payment_notifications_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "payment_id" integer NOT NULL, "invoice_id" integer NOT NULL, "recipient_user_id" integer NOT NULL, "recipient_role" text NOT NULL, "event_type" text DEFAULT 'PAYMENT_VERIFIED'::text NOT NULL, "channel" text DEFAULT 'IN_APP'::text NOT NULL, "is_read" boolean DEFAULT false NOT NULL, "read_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "event_reference_id" integer DEFAULT 0 NOT NULL) |
| tables | tables:public..fee_provider_checkout_sessions. | CREATE TABLE public."fee_provider_checkout_sessions" ("payment_id" integer NOT NULL, "school_id" integer NOT NULL, "invoice_id" integer NOT NULL, "provider" text NOT NULL, "reference" text NOT NULL, "idempotency_key" text NOT NULL, "state" text DEFAULT 'INITIALIZING'::text NOT NULL, "claim_token" text, "claim_expires_at" timestamp with time zone, "checkout_url" text, "provider_session_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL, "attempt_count" integer DEFAULT 1 NOT NULL, "last_error" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..fee_provider_webhook_events. | CREATE TABLE public."fee_provider_webhook_events" ("id" integer DEFAULT nextval('fee_provider_webhook_events_id_seq'::regclass) NOT NULL, "provider" text NOT NULL, "event_id" text NOT NULL, "payment_id" integer, "school_id" integer, "provider_reference" text, "webhook_transaction_id" text, "verified_transaction_id" text, "status" text DEFAULT 'RECEIVED'::text NOT NULL, "signature_verified" boolean DEFAULT false NOT NULL, "payload_sha256" text NOT NULL, "error_message" text, "received_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "resolved_at" timestamp with time zone) |
| tables | tables:public..fee_receipts. | CREATE TABLE public."fee_receipts" ("id" integer DEFAULT nextval('fee_receipts_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "payment_id" integer NOT NULL, "receipt_number" text NOT NULL, "snapshot" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "invoice_id" integer NOT NULL) |
| tables | tables:public..fee_refunds. | CREATE TABLE public."fee_refunds" ("id" integer DEFAULT nextval('fee_refunds_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "payment_id" integer NOT NULL, "invoice_id" integer NOT NULL, "reference" text NOT NULL, "idempotency_key" text NOT NULL, "amount_minor" integer NOT NULL, "currency" text NOT NULL, "reason" text NOT NULL, "status" text DEFAULT 'PENDING'::text NOT NULL, "requested_by" integer NOT NULL, "approved_by" integer, "evidence_reference" text, "reviewer_notes" text, "approved_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "transaction_type" text DEFAULT 'REFUND'::text NOT NULL) |
| tables | tables:public..fee_school_settings. | CREATE TABLE public."fee_school_settings" ("school_id" integer NOT NULL, "partial_payments_enabled" boolean DEFAULT false NOT NULL, "updated_by" integer, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "bank_transfer_enabled" boolean DEFAULT false NOT NULL, "bank_name" text, "bank_account_name" text, "bank_account_number" text, "paystack_enabled" boolean DEFAULT false NOT NULL, "flutterwave_enabled" boolean DEFAULT false NOT NULL) |
| tables | tables:public..fee_structure_lines. | CREATE TABLE public."fee_structure_lines" ("id" integer DEFAULT nextval('fee_structure_lines_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "structure_id" integer NOT NULL, "category_id" integer NOT NULL, "category_name_snapshot" text NOT NULL, "description_snapshot" text NOT NULL, "amount_minor" integer NOT NULL) |
| tables | tables:public..fee_structures. | CREATE TABLE public."fee_structures" ("id" integer DEFAULT nextval('fee_structures_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "school_class_id" integer NOT NULL, "section" text, "version" integer DEFAULT 1 NOT NULL, "status" text DEFAULT 'DRAFT'::text NOT NULL, "created_by" integer NOT NULL, "published_by" integer, "published_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..library_authors. | CREATE TABLE public."library_authors" ("id" integer DEFAULT nextval('library_authors_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "name" text NOT NULL, "reference" text, "created_by_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..library_book_copies. | CREATE TABLE public."library_book_copies" ("id" integer DEFAULT nextval('library_book_copies_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "book_id" integer NOT NULL, "copy_code" text NOT NULL, "barcode" text, "condition" text DEFAULT 'GOOD'::text NOT NULL, "status" text DEFAULT 'AVAILABLE'::text NOT NULL, "location" text, "acquired_on" date, "acquisition_reference" text, "created_by_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..library_books. | CREATE TABLE public."library_books" ("id" integer DEFAULT nextval('library_books_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "title" text NOT NULL, "subtitle" text, "isbn" text, "author_id" integer, "publisher_id" integer, "category_id" integer, "publication_year" integer, "edition" text, "subject" text, "description" text, "cover_reference" text, "language" text DEFAULT 'English'::text NOT NULL, "shelf_location" text, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_by_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..library_categories. | CREATE TABLE public."library_categories" ("id" integer DEFAULT nextval('library_categories_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "name" text NOT NULL, "description" text, "is_active" boolean DEFAULT true NOT NULL, "created_by_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..library_copy_status_history. | CREATE TABLE public."library_copy_status_history" ("id" integer DEFAULT nextval('library_copy_status_history_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "copy_id" integer NOT NULL, "loan_id" integer, "previous_status" text NOT NULL, "new_status" text NOT NULL, "reason" text NOT NULL, "notes" text, "changed_by_user_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..library_loans. | CREATE TABLE public."library_loans" ("id" integer DEFAULT nextval('library_loans_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "book_id" integer NOT NULL, "copy_id" integer NOT NULL, "borrower_type" text NOT NULL, "borrower_user_id" integer NOT NULL, "borrower_student_id" integer, "issued_at" timestamp with time zone DEFAULT now() NOT NULL, "due_on" date NOT NULL, "returned_at" timestamp with time zone, "returned_overdue" boolean, "days_overdue_at_return" integer, "status" text DEFAULT 'OPEN'::text NOT NULL, "issued_by_user_id" integer NOT NULL, "returned_by_user_id" integer, "renewal_count" integer DEFAULT 0 NOT NULL, "idempotency_key" text, "notes" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..library_publishers. | CREATE TABLE public."library_publishers" ("id" integer DEFAULT nextval('library_publishers_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "name" text NOT NULL, "reference" text, "created_by_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..library_renewals. | CREATE TABLE public."library_renewals" ("id" integer DEFAULT nextval('library_renewals_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "loan_id" integer NOT NULL, "renewed_by_user_id" integer NOT NULL, "previous_due_on" date NOT NULL, "new_due_on" date NOT NULL, "idempotency_key" text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..library_settings. | CREATE TABLE public."library_settings" ("school_id" integer NOT NULL, "student_borrowing_enabled" boolean DEFAULT true NOT NULL, "teacher_borrowing_enabled" boolean DEFAULT false NOT NULL, "staff_borrowing_enabled" boolean DEFAULT false NOT NULL, "max_books_per_student" integer DEFAULT 3 NOT NULL, "max_books_per_teacher" integer DEFAULT 5 NOT NULL, "max_books_per_staff" integer DEFAULT 5 NOT NULL, "student_loan_days" integer DEFAULT 14 NOT NULL, "teacher_loan_days" integer DEFAULT 30 NOT NULL, "staff_loan_days" integer DEFAULT 30 NOT NULL, "max_renewals" integer DEFAULT 1 NOT NULL, "renewal_requires_not_overdue" boolean DEFAULT true NOT NULL, "fines_enabled" boolean DEFAULT false NOT NULL, "updated_by_user_id" integer, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..library_staff. | CREATE TABLE public."library_staff" ("id" integer DEFAULT nextval('library_staff_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "user_id" integer NOT NULL, "can_manage_catalogue" boolean DEFAULT false NOT NULL, "is_active" boolean DEFAULT true NOT NULL, "assigned_by_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..maintenance_requests. | CREATE TABLE public."maintenance_requests" ("id" integer DEFAULT nextval('maintenance_requests_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "category_id" integer, "category_type" text DEFAULT 'MAINTENANCE'::text NOT NULL, "asset_id" integer, "title" text NOT NULL, "description" text NOT NULL, "location" text, "reported_by_user_id" integer NOT NULL, "assigned_to_user_id" integer, "priority" text DEFAULT 'MEDIUM'::text NOT NULL, "status" text DEFAULT 'OPEN'::text NOT NULL, "reported_at" timestamp with time zone DEFAULT now() NOT NULL, "due_on" date, "completed_at" timestamp with time zone, "notes" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..nfc_card_history. | CREATE TABLE public."nfc_card_history" ("id" integer DEFAULT nextval('nfc_card_history_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "nfc_card_id" integer NOT NULL, "student_id" integer, "action" text NOT NULL, "previous_status" text, "new_status" text, "replaced_by_card_id" integer, "reason" text, "actor_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..nfc_cards. | CREATE TABLE public."nfc_cards" ("id" integer DEFAULT nextval('nfc_cards_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "uid" text NOT NULL, "student_id" integer, "status" text DEFAULT 'unassigned'::text NOT NULL, "scans" integer DEFAULT 0 NOT NULL, "last_scan" timestamp with time zone, "issued_at" timestamp with time zone, "activated_at" timestamp with time zone, "deactivated_at" timestamp with time zone, "expires_at" timestamp with time zone, "replaced_at" timestamp with time zone, "replaced_by_card_id" integer, "replaced_by_school_id" integer, "last_device_id" integer) |
| tables | tables:public..operational_tasks. | CREATE TABLE public."operational_tasks" ("id" integer DEFAULT nextval('operational_tasks_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "category_id" integer, "category_type" text DEFAULT 'TASK'::text NOT NULL, "title" text NOT NULL, "description" text, "assigned_to_user_id" integer, "created_by_user_id" integer NOT NULL, "priority" text DEFAULT 'MEDIUM'::text NOT NULL, "status" text DEFAULT 'OPEN'::text NOT NULL, "due_on" date, "notes" text, "completed_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..parent_student_relationships. | CREATE TABLE public."parent_student_relationships" ("id" integer DEFAULT nextval('parent_student_relationships_id_seq'::regclass) NOT NULL, "parent_id" integer NOT NULL, "student_id" integer NOT NULL, "relationship_type" text DEFAULT 'Guardian'::text NOT NULL, "is_primary_guardian" boolean DEFAULT false NOT NULL, "is_emergency_contact" boolean DEFAULT false NOT NULL, "contact_priority" integer DEFAULT 1 NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..parents. | CREATE TABLE public."parents" ("id" integer DEFAULT nextval('parents_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "user_id" integer, "name" text NOT NULL, "email" text NOT NULL, "phone" text NOT NULL, "address" text, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "default_relationship_type" text, "emergency_contact_name" text, "emergency_contact_phone" text) |
| tables | tables:public..partner_attribution_conflicts. | CREATE TABLE public."partner_attribution_conflicts" ("id" integer DEFAULT nextval('partner_attribution_conflicts_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "existing_partner_profile_id" integer, "attempted_partner_profile_id" integer NOT NULL, "referral_link_id" integer, "source" text NOT NULL, "status" text DEFAULT 'OPEN'::text NOT NULL, "metadata" jsonb, "evidence" jsonb, "resolved_by" integer, "decision" text, "resolved_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..partner_invitations. | CREATE TABLE public."partner_invitations" ("id" integer DEFAULT nextval('partner_invitations_id_seq'::regclass) NOT NULL, "partner_profile_id" integer NOT NULL, "invited_email" text NOT NULL, "token_hash" text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "expires_at" timestamp with time zone, "redeemed_at" timestamp with time zone, "revoked_at" timestamp with time zone, "created_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..partner_payout_information. | CREATE TABLE public."partner_payout_information" ("id" integer DEFAULT nextval('partner_payout_information_id_seq'::regclass) NOT NULL, "partner_profile_id" integer NOT NULL, "method" text NOT NULL, "bank_name_encrypted" text NOT NULL, "account_name_encrypted" text NOT NULL, "account_number_encrypted" text NOT NULL, "bank_code_encrypted" text, "account_last4" text NOT NULL, "encryption_key_version" text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..partner_payouts. | CREATE TABLE public."partner_payouts" ("id" integer DEFAULT nextval('partner_payouts_id_seq'::regclass) NOT NULL, "partner_profile_id" integer NOT NULL, "academic_session_id" integer, "term" text, "amount" numeric(12,2) NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "status" text DEFAULT 'PENDING'::text NOT NULL, "payment_reference" text, "payment_date" timestamp with time zone, "method" text, "notes" text, "provider" text, "provider_reference" text, "period_start" timestamp with time zone NOT NULL, "period_end" timestamp with time zone NOT NULL, "paid_at" timestamp with time zone, "reversed_at" timestamp with time zone, "reversal_reference" text, "reversal_reason" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..partner_referral_links. | CREATE TABLE public."partner_referral_links" ("id" integer DEFAULT nextval('partner_referral_links_id_seq'::regclass) NOT NULL, "partner_profile_id" integer NOT NULL, "token_hash" text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_by" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "revoked_at" timestamp with time zone) |
| tables | tables:public..platform_company_employees. | CREATE TABLE public."platform_company_employees" ("id" integer DEFAULT nextval('platform_company_employees_id_seq'::regclass) NOT NULL, "full_name" text NOT NULL, "email" text NOT NULL, "phone" text, "job_title" text, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..platform_notifications. | CREATE TABLE public."platform_notifications" ("id" integer DEFAULT nextval('platform_notifications_id_seq'::regclass) NOT NULL, "recipient_user_id" integer, "title" text NOT NULL, "message" text NOT NULL, "severity" text DEFAULT 'info'::text NOT NULL, "is_read" boolean DEFAULT false NOT NULL, "read_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_assets. | CREATE TABLE public."school_assets" ("id" integer DEFAULT nextval('school_assets_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "category_id" integer, "category_type" text DEFAULT 'ASSET'::text NOT NULL, "asset_code" text, "name" text NOT NULL, "description" text, "quantity" integer DEFAULT 1 NOT NULL, "unit" text DEFAULT 'item'::text NOT NULL, "location" text, "condition" text DEFAULT 'GOOD'::text NOT NULL, "assigned_to_user_id" integer, "acquired_on" date, "status" text DEFAULT 'AVAILABLE'::text NOT NULL, "notes" text, "created_by_user_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_classes. | CREATE TABLE public."school_classes" ("id" integer DEFAULT nextval('school_classes_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "name" text NOT NULL, "section" text NOT NULL, "class_teacher" text, "capacity" integer DEFAULT 30 NOT NULL) |
| tables | tables:public..school_facilities. | CREATE TABLE public."school_facilities" ("id" integer DEFAULT nextval('school_facilities_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "name" text NOT NULL, "facility_type" text NOT NULL, "location" text, "condition" text DEFAULT 'GOOD'::text NOT NULL, "capacity" integer, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "notes" text, "created_by_user_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_memberships. | CREATE TABLE public."school_memberships" ("id" integer DEFAULT nextval('school_memberships_id_seq'::regclass) NOT NULL, "user_id" integer NOT NULL, "school_id" integer, "role" text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_operations_settings. | CREATE TABLE public."school_operations_settings" ("school_id" integer NOT NULL, "default_maintenance_priority" text DEFAULT 'MEDIUM'::text NOT NULL, "default_task_priority" text DEFAULT 'MEDIUM'::text NOT NULL, "staff_can_report_maintenance" boolean DEFAULT true NOT NULL, "updated_by_user_id" integer NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..schools. | CREATE TABLE public."schools" ("id" integer DEFAULT nextval('schools_id_seq'::regclass) NOT NULL, "code" text NOT NULL, "name" text NOT NULL, "city" text NOT NULL, "state" text NOT NULL, "status" text DEFAULT 'active'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "registration_number" text, "address" text, "lga" text, "phone" text, "email" text, "website" text, "logo" text, "school_type" text, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "communication_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL) |
| tables | tables:public..student_identification_policies. | CREATE TABLE public."student_identification_policies" ("id" integer DEFAULT nextval('student_identification_policies_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "policy" text DEFAULT 'NFC_ONLY'::text NOT NULL, "effective_from" date, "effective_to" date, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_by" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..students. | CREATE TABLE public."students" ("id" integer DEFAULT nextval('students_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "user_id" integer, "admission_no" text NOT NULL, "first_name" text NOT NULL, "last_name" text NOT NULL, "gender" text NOT NULL, "class_name" text NOT NULL, "section" text NOT NULL, "parent_name" text, "parent_phone" text, "status" text DEFAULT 'active'::text NOT NULL, "joined_at" timestamp with time zone DEFAULT now() NOT NULL, "middle_name" text, "date_of_birth" date, "photo" text, "admission_date" date, "admission_status" text DEFAULT 'ADMITTED'::text NOT NULL, "previous_school" text, "address" text, "medical_info" text, "emergency_contact_name" text, "emergency_contact_phone" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "email" text) |
| tables | tables:public..subscriptions. | CREATE TABLE public."subscriptions" ("id" integer DEFAULT nextval('subscriptions_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "term" text NOT NULL, "amount" numeric(12,2) DEFAULT '5000'::numeric NOT NULL, "school_share" numeric(12,2) DEFAULT '2000'::numeric NOT NULL, "edupulse_share" numeric(12,2) DEFAULT '3000'::numeric NOT NULL, "status" text DEFAULT 'pending'::text NOT NULL, "verification_status" text DEFAULT 'pending'::text NOT NULL, "provider" text DEFAULT 'test'::text NOT NULL, "provider_reference" text, "expires_at" timestamp with time zone NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "partner_profile_id" integer, "partner_share" numeric(12,2), "allocation_snapshot" jsonb) |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.academic_assessment_types; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_assessments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_assignments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_grading_rules; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_report_card_lines; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_report_cards; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_sessions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_terms; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_timetable_entries; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.app_users; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_corrections; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_notification_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.audit_logs; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.biometric_enrollments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.commission_ledger; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.commission_rules; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_campaign_recipients; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_preferences; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.device_assignment_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.device_credentials; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_adjustments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoice_lines; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoice_notification_outbox; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoice_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payment_notification_outbox; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payment_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_provider_checkout_sessions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_provider_webhook_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_receipts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_refunds; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_school_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_structure_lines; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_structures; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_authors; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_book_copies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_books; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_categories; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_copy_status_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_loans; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_publishers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_renewals; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_staff; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.maintenance_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.nfc_card_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.nfc_cards; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.operational_tasks; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.parent_student_relationships; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.parents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_attribution_conflicts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_invitations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_payout_information; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_payouts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_referral_links; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.platform_company_employees; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.platform_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_assets; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_classes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_facilities; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_memberships; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_operations_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.schools; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_identification_policies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.students; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.subscriptions; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0070_reconcile_table_shells_b_1.sql

- [ ] Hash matches **c1f7a06430e7091fae24fee37a8793822399adad1e14cb05f0d2b0b29b255e78**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0062_reconcile_sequences_b_1.sql.
- [ ] Required objects verified: sequences:public.partner_profile_users.partner_profile_users_id_seq.; sequences:public.partner_profiles.partner_profiles_id_seq.; sequences:public.school_branding_logos.school_branding_logos_id_seq.; sequences:public.school_calendar_events.school_calendar_events_id_seq.; sequences:public.school_partner_attributions.school_partner_attributions_id_seq.; sequences:public.teacher_duty_roster.teacher_duty_roster_id_seq.; sequences:public.teacher_subject_assignments.teacher_subject_assignments_id_seq..
- [ ] Expected schema: Missing tables receive complete typed column/default/NOT NULL shells exactly as listed; PK/UNIQUE/CHECK/FK enforcement belongs to later tiers. Existing matching table identity/storage contracts are preserved and later columns reconciled separately.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **47**; IDs 991, 992, 993, 994, 995, 996, 997, 998, 999, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1490, 1491, 1492, 1493, 1494, 1495, 1496, 1497, 1498, 1499, 1500, 1501, 1502, 1503, 1504, 1505, 1506, 1507, 1508, 1684, 1685, 1686, 1726, 1727, 1836, 1837, 1880, 1881. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| tables | tables:public..partner_profile_users. | CREATE TABLE public."partner_profile_users" ("id" integer DEFAULT nextval('partner_profile_users_id_seq'::regclass) NOT NULL, "partner_profile_id" integer NOT NULL, "user_id" integer NOT NULL, "role" text DEFAULT 'PARTNER'::text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "nfc_activation_enabled" boolean DEFAULT false NOT NULL) |
| tables | tables:public..partner_profiles. | CREATE TABLE public."partner_profiles" ("id" integer DEFAULT nextval('partner_profiles_id_seq'::regclass) NOT NULL, "user_id" integer, "partner_code" text NOT NULL, "type" text DEFAULT 'RESELLER'::text NOT NULL, "full_name" text NOT NULL, "business_name" text, "email" text NOT NULL, "phone" text, "address" text, "state" text, "lga" text, "registration_number" text, "status" text DEFAULT 'PENDING'::text NOT NULL, "invited_at" timestamp with time zone, "registered_at" timestamp with time zone, "activated_at" timestamp with time zone, "deactivated_at" timestamp with time zone, "created_by" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "nfc_activation_enabled" boolean DEFAULT false NOT NULL) |
| tables | tables:public..school_branding_logos. | CREATE TABLE public."school_branding_logos" ("id" integer DEFAULT nextval('school_branding_logos_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "object_path" text NOT NULL, "content_type" text NOT NULL, "byte_size" integer NOT NULL, "is_current" boolean DEFAULT true NOT NULL, "updated_by_user_id" integer NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_calendar_events. | CREATE TABLE public."school_calendar_events" ("id" integer DEFAULT nextval('school_calendar_events_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "academic_session_id" integer, "academic_term_id" integer, "source" text NOT NULL, "source_key" text NOT NULL, "title" text NOT NULL, "category" text NOT NULL, "start_date" date NOT NULL, "end_date" date, "is_academic" boolean DEFAULT true NOT NULL, "audience" text[] DEFAULT ARRAY['TEACHER'::text, 'STUDENT'::text, 'PARENT'::text, 'STAFF'::text] NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "notes" text, "created_by_user_id" integer NOT NULL, "updated_by_user_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_partner_attributions. | CREATE TABLE public."school_partner_attributions" ("id" integer DEFAULT nextval('school_partner_attributions_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "partner_profile_id" integer NOT NULL, "referral_link_id" integer, "source" text DEFAULT 'REFERRAL_LINK'::text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "is_current" boolean DEFAULT true NOT NULL, "starts_at" timestamp with time zone DEFAULT now() NOT NULL, "ends_at" timestamp with time zone, "created_by" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..teacher_duty_roster. | CREATE TABLE public."teacher_duty_roster" ("id" integer DEFAULT nextval('teacher_duty_roster_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "employee_id" integer NOT NULL, "duty_role" text NOT NULL, "start_date" date NOT NULL, "end_date" date NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "notes" text, "created_by_user_id" integer NOT NULL, "updated_by_user_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..teacher_subject_assignments. | CREATE TABLE public."teacher_subject_assignments" ("id" integer DEFAULT nextval('teacher_subject_assignments_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "employee_id" integer NOT NULL, "subject_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "start_date" date NOT NULL, "end_date" date, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_by_user_id" integer NOT NULL, "updated_by_user_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.partner_profile_users; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_branding_logos; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_calendar_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_partner_attributions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.teacher_duty_roster; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.teacher_subject_assignments; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs 991, 992, 993, 994, 995, 996, 997, 998, 999, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1490, 1491, 1492, 1493, 1494, 1495, 1496, 1497, 1498, 1499, 1500, 1501, 1502, 1503, 1504, 1505, 1506, 1507, 1508, 1684, 1685, 1686, 1726, 1727, 1836, 1837, 1880, 1881
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0071_reconcile_table_shells_c_1.sql

- [ ] Hash matches **fef705ade1c2fee580d807834cb64366ed7b9e50f08c53e9409bf9f930f97b18**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0063_reconcile_sequences_c_1.sql.
- [ ] Required objects verified: sequences:public.admission_application_documents.admission_application_documents_id_seq.; sequences:public.admission_applications.admission_applications_id_seq.; sequences:public.class_subjects.class_subjects_id_seq.; sequences:public.subjects.subjects_id_seq.; sequences:public.employees.employees_id_seq.; sequences:public.student_behaviour_records.student_behaviour_records_id_seq.; sequences:public.student_care_grants.student_care_grants_id_seq.; sequences:public.student_care_idempotency.student_care_idempotency_id_seq.; sequences:public.student_care_record_history.student_care_record_history_id_seq.; sequences:public.student_class_assignments.student_class_assignments_id_seq.; sequences:public.student_medical_profiles.student_medical_profiles_id_seq.; sequences:public.student_medical_visits.student_medical_visits_id_seq.; sequences:public.student_welfare_records.student_welfare_records_id_seq.; sequences:public.teacher_class_assignments.teacher_class_assignments_id_seq..
- [ ] Expected schema: Missing tables receive complete typed column/default/NOT NULL shells exactly as listed; PK/UNIQUE/CHECK/FK enforcement belongs to later tiers. Existing matching table identity/storage contracts are preserved and later columns reconciled separately.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **146**; IDs 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 1306, 1307, 1308, 1309, 1310, 1311, 1312, 1313, 1314, 1315, 1316, 1317, 1318, 1319, 1320, 1321, 1322, 1323, 1324, 1325, 1326, 1327, 1328, 1329, 1330, 1331, 1332, 1333, 1334, 1335, 1336, 1337, 1338, 1339, 1340, 1341, 1342, 1343, 1344, 1345, 1346, 1347, 1348, 1349, 1350, 1351, 1352, 1353, 1371, 1372, 1373, 1374, 1375, 1376, 1377, 1378, 1379, 1380, 1381, 1382, 1383, 1384, 1385, 1386, 1387, 1388, 1389, 1390, 1391, 1392, 1451, 1452, 1453, 1454, 1455, 1456, 1457, 1458, 1459, 1460, 1461, 1462, 1463, 1617, 1618, 1619, 1743, 1744, 1864, 1865, 1866, 1867, 1870, 1871, 1875. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| tables | tables:public..admission_application_counters. | CREATE TABLE public."admission_application_counters" ("school_id" integer NOT NULL, "current_value" integer DEFAULT 0 NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..admission_application_documents. | CREATE TABLE public."admission_application_documents" ("id" integer DEFAULT nextval('admission_application_documents_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "application_id" integer NOT NULL, "document_type" text NOT NULL, "file_name" text NOT NULL, "content_type" text NOT NULL, "byte_size" integer NOT NULL, "object_path" text NOT NULL, "created_by_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..admission_applications. | CREATE TABLE public."admission_applications" ("id" integer DEFAULT nextval('admission_applications_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "application_number" text NOT NULL, "status" text DEFAULT 'Submitted'::text NOT NULL, "source" text NOT NULL, "applicant_first_name" text NOT NULL, "applicant_middle_name" text, "applicant_last_name" text NOT NULL, "date_of_birth" date NOT NULL, "gender" text NOT NULL, "photo_object_path" text, "previous_school" text, "previous_class" text, "intended_class_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer, "applicant_address" text, "guardian_name" text NOT NULL, "guardian_phone" text NOT NULL, "guardian_email" text, "guardian_relationship" text, "guardian_address" text, "emergency_contact_name" text, "emergency_contact_phone" text, "emergency_contact_relationship" text, "receipt_secret_hash" text, "idempotency_key" text NOT NULL, "payload_hash" text NOT NULL, "assessment" jsonb, "interview" jsonb, "internal_notes" text, "public_message" text, "converted_student_id" integer, "converted_parent_id" integer, "created_by_user_id" integer, "version" integer DEFAULT 1 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..admission_portal_classes. | CREATE TABLE public."admission_portal_classes" ("school_id" integer NOT NULL, "class_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..admission_portal_settings. | CREATE TABLE public."admission_portal_settings" ("school_id" integer NOT NULL, "portal_key" text NOT NULL, "is_open" boolean DEFAULT false NOT NULL, "academic_session_id" integer, "academic_term_id" integer, "deadline" date, "fee_info" text, "requirements" jsonb DEFAULT '[]'::jsonb NOT NULL, "required_documents" jsonb DEFAULT '[]'::jsonb NOT NULL, "instructions" text, "entrance_examination" text, "interview_information" text, "public_description" text, "public_address" text, "public_phone" text, "public_email" text, "logo_object_path" text, "updated_by_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..admission_request_rate_limits. | CREATE TABLE public."admission_request_rate_limits" ("bucket_hash" text NOT NULL, "bucket_started_at" timestamp with time zone NOT NULL, "request_count" integer DEFAULT 0 NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..class_subjects. | CREATE TABLE public."class_subjects" ("id" integer DEFAULT nextval('class_subjects_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "school_class_id" integer NOT NULL, "subject_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer, "employee_id" integer, "section" text, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..employees. | CREATE TABLE public."employees" ("id" integer DEFAULT nextval('employees_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "user_id" integer, "employee_no" text NOT NULL, "first_name" text NOT NULL, "middle_name" text, "last_name" text NOT NULL, "phone" text, "email" text, "address" text, "photo" text, "gender" text, "employee_type" text DEFAULT 'TEACHER'::text NOT NULL, "employment_status" text DEFAULT 'ACTIVE'::text NOT NULL, "date_employed" date, "department" text, "qualification" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..student_behaviour_configurations. | CREATE TABLE public."student_behaviour_configurations" ("school_id" integer NOT NULL, "categories" jsonb DEFAULT '["POSITIVE", "CONCERN", "INCIDENT", "RULE_VIOLATION", "RECOGNITION"]'::jsonb NOT NULL, "actions" jsonb DEFAULT '["Verbal warning", "Written warning", "Detention", "Counselling", "Parent meeting", "Behaviour agreement", "Suspension"]'::jsonb NOT NULL, "updated_by_user_id" integer NOT NULL, "version" integer DEFAULT 1 NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..student_behaviour_records. | CREATE TABLE public."student_behaviour_records" ("id" integer DEFAULT nextval('student_behaviour_records_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "occurred_at" timestamp with time zone DEFAULT now() NOT NULL, "school_class_id" integer, "subject_id" integer, "category" text NOT NULL, "severity" text NOT NULL, "description" text NOT NULL, "location" text, "reporter_user_id" integer NOT NULL, "action" text, "parent_notification_status" text DEFAULT 'NOT_REQUESTED'::text NOT NULL, "parent_notification_id" integer, "follow_up_at" timestamp with time zone, "follow_up_notes" text, "status" text DEFAULT 'REVIEW'::text NOT NULL, "resolution" text, "internal_notes" text, "parent_visible" boolean DEFAULT false NOT NULL, "version" integer DEFAULT 1 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "archived_at" timestamp with time zone) |
| tables | tables:public..student_care_grants. | CREATE TABLE public."student_care_grants" ("id" integer DEFAULT nextval('student_care_grants_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "user_id" integer NOT NULL, "permissions" text[] DEFAULT '{}'::text[] NOT NULL, "active" boolean DEFAULT true NOT NULL, "granted_by_user_id" integer NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..student_care_idempotency. | CREATE TABLE public."student_care_idempotency" ("id" integer DEFAULT nextval('student_care_idempotency_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "request_key" text NOT NULL, "resource_type" text NOT NULL, "request_hash" text NOT NULL, "resource_id" integer NOT NULL, "response_revision" integer DEFAULT 1 NOT NULL, "created_by_user_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..student_care_record_history. | CREATE TABLE public."student_care_record_history" ("id" integer DEFAULT nextval('student_care_record_history_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "record_type" text NOT NULL, "record_id" integer NOT NULL, "revision" integer NOT NULL, "changed_by_user_id" integer NOT NULL, "snapshot" jsonb NOT NULL, "changed_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..student_class_assignments. | CREATE TABLE public."student_class_assignments" ("id" integer DEFAULT nextval('student_class_assignments_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer, "school_class_id" integer NOT NULL, "section" text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "is_current" boolean DEFAULT false NOT NULL, "start_date" date, "end_date" date, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..student_medical_profiles. | CREATE TABLE public."student_medical_profiles" ("id" integer DEFAULT nextval('student_medical_profiles_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "blood_group" text, "genotype" text, "allergies" jsonb DEFAULT '[]'::jsonb NOT NULL, "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL, "support_needs" jsonb DEFAULT '[]'::jsonb NOT NULL, "medications" jsonb DEFAULT '[]'::jsonb NOT NULL, "emergency_medical_notes" text, "provider_contacts" jsonb DEFAULT '[]'::jsonb NOT NULL, "emergency_contacts" jsonb DEFAULT '[]'::jsonb NOT NULL, "version" integer DEFAULT 1 NOT NULL, "updated_by_user_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "archived_at" timestamp with time zone) |
| tables | tables:public..student_medical_visits. | CREATE TABLE public."student_medical_visits" ("id" integer DEFAULT nextval('student_medical_visits_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "occurred_at" timestamp with time zone NOT NULL, "reason" text NOT NULL, "symptoms" text, "observations" text, "action_taken" text, "treatment" text, "referral" text, "follow_up_at" timestamp with time zone, "follow_up_notes" text, "notes" text, "recorded_by_user_id" integer NOT NULL, "version" integer DEFAULT 1 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "archived_at" timestamp with time zone) |
| tables | tables:public..student_welfare_records. | CREATE TABLE public."student_welfare_records" ("id" integer DEFAULT nextval('student_welfare_records_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "category" text NOT NULL, "concern" text NOT NULL, "assigned_staff_user_id" integer, "follow_up_at" timestamp with time zone, "follow_up_status" text DEFAULT 'PENDING'::text NOT NULL, "status" text DEFAULT 'OPEN'::text NOT NULL, "resolution" text, "internal_notes" text, "parent_visible" boolean DEFAULT false NOT NULL, "created_by_user_id" integer NOT NULL, "version" integer DEFAULT 1 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "archived_at" timestamp with time zone) |
| tables | tables:public..subjects. | CREATE TABLE public."subjects" ("id" integer DEFAULT nextval('subjects_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "name" text NOT NULL, "code" text NOT NULL, "description" text, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..teacher_class_assignments. | CREATE TABLE public."teacher_class_assignments" ("id" integer DEFAULT nextval('teacher_class_assignments_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "employee_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "school_class_id" integer NOT NULL, "subject_id" integer, "section" text NOT NULL, "assignment_type" text DEFAULT 'CLASS_TEACHER'::text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "start_date" date, "end_date" date, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.admission_application_counters; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.admission_application_documents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.admission_applications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.admission_portal_classes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.admission_portal_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.admission_request_rate_limits; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.class_subjects; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employees; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_behaviour_configurations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_behaviour_records; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_care_grants; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_care_idempotency; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_care_record_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_class_assignments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_medical_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_medical_visits; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_welfare_records; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.subjects; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.teacher_class_assignments; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 1306, 1307, 1308, 1309, 1310, 1311, 1312, 1313, 1314, 1315, 1316, 1317, 1318, 1319, 1320, 1321, 1322, 1323, 1324, 1325, 1326, 1327, 1328, 1329, 1330, 1331, 1332, 1333, 1334, 1335, 1336, 1337, 1338, 1339, 1340, 1341, 1342, 1343, 1344, 1345, 1346, 1347, 1348, 1349, 1350, 1351, 1352, 1353, 1371, 1372, 1373, 1374, 1375, 1376, 1377, 1378, 1379, 1380, 1381, 1382, 1383, 1384, 1385, 1386, 1387, 1388, 1389, 1390, 1391, 1392, 1451, 1452, 1453, 1454, 1455, 1456, 1457, 1458, 1459, 1460, 1461, 1462, 1463, 1617, 1618, 1619, 1743, 1744, 1864, 1865, 1866, 1867, 1870, 1871, 1875
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0072_reconcile_table_shells_d_1.sql

- [ ] Hash matches **35d525bb67da365c3165039ef7c83980297a43f4b9b29ea527046802353b69c2**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0064_reconcile_sequences_d_1.sql.
- [ ] Required objects verified: sequences:public.attendance_discrepancies.attendance_discrepancies_id_seq.; sequences:public.attendance_events.attendance_events_id_seq..
- [ ] Expected schema: Missing tables receive complete typed column/default/NOT NULL shells exactly as listed; PK/UNIQUE/CHECK/FK enforcement belongs to later tiers. Existing matching table identity/storage contracts are preserved and later columns reconciled separately.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| tables | tables:public..attendance_discrepancies. | CREATE TABLE public."attendance_discrepancies" ("id" integer DEFAULT nextval('attendance_discrepancies_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "attendance_event_id" integer, "discrepancy_type" text NOT NULL, "status" text DEFAULT 'OPEN'::text NOT NULL, "details" jsonb, "resolved_by" integer, "resolved_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..attendance_events. | CREATE TABLE public."attendance_events" ("id" integer DEFAULT nextval('attendance_events_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer, "employee_id" integer, "device_id" integer, "nfc_card_id" integer, "identification_method" text NOT NULL, "event_type" text NOT NULL, "result" text NOT NULL, "attendance_status" text DEFAULT 'PRESENT'::text NOT NULL, "event_date" date NOT NULL, "occurred_at" timestamp with time zone NOT NULL, "academic_session_id" integer, "academic_term_id" integer, "school_class_id" integer, "class_name_snapshot" text, "section_snapshot" text, "reason" text, "actor_user_id" integer, "failure_reason" text, "dedupe_key" text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_discrepancies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_events; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0073_reconcile_table_shells_e_1.sql

- [ ] Hash matches **d6cee7fffc9c6637211cbb1b039905df42039359f6b7d4ce6e4cc6ee2ae86f2a**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0065_reconcile_sequences_e_1.sql.
- [ ] Required objects verified: sequences:public.academic_result_batches.academic_result_batches_id_seq.; sequences:public.academic_results.academic_results_id_seq.; sequences:public.curriculum_imports.curriculum_imports_id_seq.; sequences:public.curriculum_progress.curriculum_progress_id_seq.; sequences:public.curriculum_topics.curriculum_topics_id_seq.; sequences:public.curriculum_versions.curriculum_versions_id_seq.; sequences:public.exam_question_papers.exam_question_papers_id_seq.; sequences:public.exam_question_reviews.exam_question_reviews_id_seq.; sequences:public.exam_question_versions.exam_question_versions_id_seq.; sequences:public.lesson_note_documents.lesson_note_documents_id_seq.; sequences:public.lesson_note_reviews.lesson_note_reviews_id_seq.; sequences:public.lesson_notes.lesson_notes_id_seq.; sequences:public.promotion_batch_students.promotion_batch_students_id_seq.; sequences:public.students.students_id_seq.; sequences:public.promotion_batches.promotion_batches_id_seq.; sequences:public.promotion_history.promotion_history_id_seq.; sequences:public.school_curriculum_assignments.school_curriculum_assignments_id_seq..
- [ ] Expected schema: Missing tables receive complete typed column/default/NOT NULL shells exactly as listed; PK/UNIQUE/CHECK/FK enforcement belongs to later tiers. Existing matching table identity/storage contracts are preserved and later columns reconciled separately.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **172**; IDs 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 358, 359, 360, 361, 362, 363, 364, 365, 366, 367, 368, 369, 370, 371, 372, 373, 374, 375, 376, 377, 378, 379, 380, 381, 382, 383, 435, 436, 437, 438, 439, 440, 441, 442, 443, 444, 445, 446, 447, 448, 449, 450, 451, 452, 453, 454, 455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 465, 466, 636, 637, 638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649, 650, 651, 652, 653, 654, 655, 656, 657, 658, 659, 660, 661, 662, 663, 664, 915, 916, 917, 918, 919, 920, 921, 922, 923, 924, 925, 926, 927, 928, 929, 930, 931, 932, 933, 934, 935, 936, 937, 938, 939, 940, 941, 942, 943, 944, 945, 946, 947, 948, 949, 950, 951, 952, 953, 954, 955, 956, 957, 1014, 1015, 1016, 1017, 1018, 1019, 1020, 1021, 1022, 1023, 1024, 1650, 1689, 1738, 1766, 1767, 1768, 1769, 1777, 1778, 1779, 1795, 1796, 1797, 1830, 1831, 1832, 1839. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| tables | tables:public..academic_result_batches. | CREATE TABLE public."academic_result_batches" ("id" integer DEFAULT nextval('academic_result_batches_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "school_class_id" integer NOT NULL, "section" text DEFAULT ''::text NOT NULL, "subject_id" integer NOT NULL, "teacher_employee_id" integer NOT NULL, "components" jsonb DEFAULT '[]'::jsonb NOT NULL, "status" text DEFAULT 'DRAFT'::text NOT NULL, "revision" integer DEFAULT 0 NOT NULL, "return_comment" text, "created_by" integer NOT NULL, "submitted_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..academic_results. | CREATE TABLE public."academic_results" ("id" integer DEFAULT nextval('academic_results_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "assessment_id" integer NOT NULL, "student_id" integer NOT NULL, "student_class_assignment_id" integer NOT NULL, "teacher_employee_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "school_class_id" integer NOT NULL, "section_snapshot" text NOT NULL, "subject_id" integer NOT NULL, "score" numeric(10,2) NOT NULL, "max_score" numeric(10,2) NOT NULL, "grade" text, "grade_point" numeric(5,2), "remark" text, "status" text DEFAULT 'DRAFT'::text NOT NULL, "created_by" integer NOT NULL, "published_by" integer, "published_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "review_status" text DEFAULT 'NOT_REVIEWED'::text NOT NULL, "review_comment" text, "reviewed_by" integer, "reviewed_at" timestamp with time zone) |
| tables | tables:public..curriculum_imports. | CREATE TABLE public."curriculum_imports" ("id" integer DEFAULT nextval('curriculum_imports_id_seq'::regclass) NOT NULL, "uploaded_by" integer NOT NULL, "filename" text NOT NULL, "content_type" text NOT NULL, "object_path" text NOT NULL, "detected_type" text NOT NULL, "preview_rows" jsonb NOT NULL, "headers" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "confirmed_version_id" integer) |
| tables | tables:public..curriculum_progress. | CREATE TABLE public."curriculum_progress" ("id" integer DEFAULT nextval('curriculum_progress_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "mapping_id" integer NOT NULL, "topic_id" integer NOT NULL, "progress_status" text NOT NULL, "completed_date" date, "comment" text, "updated_by" integer NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..curriculum_topics. | CREATE TABLE public."curriculum_topics" ("id" integer DEFAULT nextval('curriculum_topics_id_seq'::regclass) NOT NULL, "curriculum_version_id" integer, "school_id" integer, "mapping_id" integer, "class_level" text NOT NULL, "subject_code" text NOT NULL, "parent_topic_id" integer, "title" text NOT NULL, "learning_objectives" jsonb DEFAULT '[]'::jsonb NOT NULL, "learning_outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL, "suggested_resources" jsonb DEFAULT '[]'::jsonb NOT NULL, "source_kind" text NOT NULL, "sequence_order" integer DEFAULT 0 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..curriculum_versions. | CREATE TABLE public."curriculum_versions" ("id" integer DEFAULT nextval('curriculum_versions_id_seq'::regclass) NOT NULL, "title" text NOT NULL, "education_level" text NOT NULL, "class_levels" jsonb DEFAULT '[]'::jsonb NOT NULL, "subject_codes" jsonb DEFAULT '[]'::jsonb NOT NULL, "source_kind" text NOT NULL, "source_organization" text NOT NULL, "source_reference" text NOT NULL, "source_version" text, "effective_date" date, "verified_date" date, "description" text, "source_document_path" text, "derived_from_version_id" integer, "status" text DEFAULT 'DRAFT'::text NOT NULL, "created_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "published_at" timestamp with time zone, "archived_at" timestamp with time zone) |
| tables | tables:public..exam_question_papers. | CREATE TABLE public."exam_question_papers" ("id" integer DEFAULT nextval('exam_question_papers_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "school_class_id" integer NOT NULL, "section" text DEFAULT ''::text NOT NULL, "subject_id" integer NOT NULL, "teacher_employee_id" integer NOT NULL, "examination_name" text NOT NULL, "instructions" text DEFAULT ''::text NOT NULL, "duration" text, "total_marks" numeric(10,2), "status" text DEFAULT 'DRAFT'::text NOT NULL, "revision" integer DEFAULT 0 NOT NULL, "submitted_at" timestamp with time zone, "approved_at" timestamp with time zone, "created_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..exam_question_reviews. | CREATE TABLE public."exam_question_reviews" ("id" integer DEFAULT nextval('exam_question_reviews_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "paper_id" integer NOT NULL, "version_id" integer NOT NULL, "reviewer_user_id" integer NOT NULL, "decision" text NOT NULL, "comment" text DEFAULT ''::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..exam_question_versions. | CREATE TABLE public."exam_question_versions" ("id" integer DEFAULT nextval('exam_question_versions_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "paper_id" integer NOT NULL, "revision" integer NOT NULL, "filename" text NOT NULL, "mime_type" text NOT NULL, "object_path" text NOT NULL, "sha256" text NOT NULL, "preview_text" text DEFAULT ''::text NOT NULL, "created_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..lesson_note_documents. | CREATE TABLE public."lesson_note_documents" ("id" integer DEFAULT nextval('lesson_note_documents_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "lesson_note_id" integer NOT NULL, "note_revision" integer NOT NULL, "filename" text NOT NULL, "byte_size" integer NOT NULL, "staging_path" text NOT NULL, "object_path" text NOT NULL, "sha256" text, "context" jsonb NOT NULL, "status" text DEFAULT 'PENDING'::text NOT NULL, "uploaded_by" integer NOT NULL, "expires_at" timestamp with time zone NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "ready_at" timestamp with time zone) |
| tables | tables:public..lesson_note_reviews. | CREATE TABLE public."lesson_note_reviews" ("id" integer DEFAULT nextval('lesson_note_reviews_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "lesson_note_id" integer NOT NULL, "reviewer_user_id" integer NOT NULL, "decision" text NOT NULL, "comment" text, "note_revision" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..lesson_notes. | CREATE TABLE public."lesson_notes" ("id" integer DEFAULT nextval('lesson_notes_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "school_class_id" integer NOT NULL, "subject_id" integer NOT NULL, "teacher_employee_id" integer NOT NULL, "section" text, "week" integer NOT NULL, "lesson_date" date NOT NULL, "curriculum_mapping_id" integer, "curriculum_version_id" integer, "topic_id" integer, "sub_topic_id" integer, "content" jsonb DEFAULT '{}'::jsonb NOT NULL, "status" text DEFAULT 'DRAFT'::text NOT NULL, "revision" integer DEFAULT 0 NOT NULL, "created_by" integer NOT NULL, "submitted_at" timestamp with time zone, "approved_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..promotion_batch_students. | CREATE TABLE public."promotion_batch_students" ("id" integer DEFAULT nextval('promotion_batch_students_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "batch_id" integer NOT NULL, "student_id" integer NOT NULL, "student_name_snapshot" text NOT NULL, "admission_no_snapshot" text NOT NULL, "source_assignment_id" integer NOT NULL, "source_session_id" integer NOT NULL, "source_term_id" integer, "source_class_id" integer NOT NULL, "source_class_name" text NOT NULL, "source_section" text NOT NULL, "recommendation" text NOT NULL, "status" text DEFAULT 'Pending'::text NOT NULL, "reason" text, "academic_performance" jsonb NOT NULL, "attendance_summary" jsonb NOT NULL, "target_term_id" integer, "target_class_id" integer, "target_section" text, "reviewed_by" integer, "reviewed_at" timestamp with time zone, "finalized_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..promotion_batches. | CREATE TABLE public."promotion_batches" ("id" integer DEFAULT nextval('promotion_batches_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "source_session_id" integer NOT NULL, "target_session_id" integer NOT NULL, "status" text DEFAULT 'PREPARED'::text NOT NULL, "idempotency_actor_user_id" integer NOT NULL, "idempotency_key" text NOT NULL, "prepared_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "finalized_by" integer, "finalized_at" timestamp with time zone, "finalization_actor_user_id" integer, "finalization_idempotency_key" text) |
| tables | tables:public..promotion_history. | CREATE TABLE public."promotion_history" ("id" integer DEFAULT nextval('promotion_history_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "batch_id" integer, "batch_student_id" integer, "student_id" integer, "actor_user_id" integer, "event_type" text NOT NULL, "result" text NOT NULL, "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_curriculum_assignments. | CREATE TABLE public."school_curriculum_assignments" ("id" integer DEFAULT nextval('school_curriculum_assignments_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "curriculum_version_id" integer NOT NULL, "school_class_id" integer NOT NULL, "subject_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "confirmed_by" integer NOT NULL, "confirmed_at" timestamp with time zone DEFAULT now() NOT NULL) |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.academic_result_batches; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_results; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_imports; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_progress; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_topics; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_versions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.exam_question_papers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.exam_question_reviews; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.exam_question_versions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.lesson_note_documents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.lesson_note_reviews; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.lesson_notes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.promotion_batch_students; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.promotion_batches; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.promotion_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_curriculum_assignments; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 358, 359, 360, 361, 362, 363, 364, 365, 366, 367, 368, 369, 370, 371, 372, 373, 374, 375, 376, 377, 378, 379, 380, 381, 382, 383, 435, 436, 437, 438, 439, 440, 441, 442, 443, 444, 445, 446, 447, 448, 449, 450, 451, 452, 453, 454, 455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 465, 466, 636, 637, 638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649, 650, 651, 652, 653, 654, 655, 656, 657, 658, 659, 660, 661, 662, 663, 664, 915, 916, 917, 918, 919, 920, 921, 922, 923, 924, 925, 926, 927, 928, 929, 930, 931, 932, 933, 934, 935, 936, 937, 938, 939, 940, 941, 942, 943, 944, 945, 946, 947, 948, 949, 950, 951, 952, 953, 954, 955, 956, 957, 1014, 1015, 1016, 1017, 1018, 1019, 1020, 1021, 1022, 1023, 1024, 1650, 1689, 1738, 1766, 1767, 1768, 1769, 1777, 1778, 1779, 1795, 1796, 1797, 1830, 1831, 1832, 1839
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0074_reconcile_table_shells_f_1.sql

- [ ] Hash matches **e7e9e8f96a1e0d739e94781c058ff1f5108107db2036527f9b2148dce405f2dc**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0066_reconcile_sequences_f_1.sql.
- [ ] Required objects verified: sequences:public.fee_categories.fee_categories_id_seq.; sequences:public.fee_invoices.fee_invoices_id_seq.; sequences:public.fee_payment_line_allocations.fee_payment_line_allocations_id_seq.; sequences:public.fee_payments.fee_payments_id_seq.; sequences:public.payroll_employee_profiles.payroll_employee_profiles_id_seq.; sequences:public.payroll_items.payroll_items_id_seq.; sequences:public.payroll_payslips.payroll_payslips_id_seq.; sequences:public.payroll_periods.payroll_periods_id_seq.; sequences:public.payroll_transfers.payroll_transfers_id_seq.; sequences:public.settlement_payroll_audit_events.settlement_payroll_audit_events_id_seq.; sequences:public.settlement_payroll_profiles.settlement_payroll_profiles_id_seq.; sequences:public.staff_nfc_allocations.staff_nfc_allocations_id_seq.; sequences:public.staff_nfc_billing_rules.staff_nfc_billing_rules_id_seq.; sequences:public.staff_nfc_partner_commissions.staff_nfc_partner_commissions_id_seq.; sequences:public.staff_nfc_payments.staff_nfc_payments_id_seq.; sequences:public.staff_nfc_provider_events.staff_nfc_provider_events_id_seq.; sequences:public.staff_nfc_receipts.staff_nfc_receipts_id_seq.; sequences:public.staff_nfc_refunds.staff_nfc_refunds_id_seq.; sequences:public.staff_nfc_subscriptions.staff_nfc_subscriptions_id_seq.; sequences:public.subscriptions.subscriptions_id_seq.; sequences:public.student_nfc_replacement_requests.student_nfc_replacement_requests_id_seq..
- [ ] Expected schema: Missing tables receive complete typed column/default/NOT NULL shells exactly as listed; PK/UNIQUE/CHECK/FK enforcement belongs to later tiers. Existing matching table identity/storage contracts are preserved and later columns reconciled separately.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **255**; IDs 528, 529, 530, 531, 532, 533, 838, 839, 840, 841, 842, 843, 844, 845, 846, 847, 848, 849, 850, 851, 852, 853, 854, 855, 856, 857, 858, 859, 860, 861, 862, 863, 864, 865, 866, 867, 868, 869, 870, 871, 872, 873, 874, 875, 876, 877, 878, 879, 880, 881, 882, 883, 884, 885, 886, 887, 888, 889, 890, 891, 892, 893, 894, 895, 896, 897, 898, 899, 900, 1121, 1122, 1123, 1124, 1125, 1126, 1127, 1128, 1129, 1130, 1190, 1191, 1192, 1193, 1194, 1195, 1196, 1197, 1198, 1199, 1200, 1201, 1202, 1203, 1204, 1205, 1206, 1207, 1208, 1209, 1210, 1211, 1212, 1213, 1214, 1215, 1216, 1217, 1218, 1219, 1220, 1221, 1222, 1223, 1224, 1225, 1226, 1227, 1228, 1229, 1230, 1231, 1232, 1233, 1234, 1235, 1236, 1237, 1238, 1239, 1240, 1241, 1242, 1243, 1244, 1245, 1246, 1247, 1248, 1249, 1250, 1251, 1252, 1253, 1254, 1255, 1256, 1257, 1258, 1259, 1260, 1261, 1262, 1263, 1264, 1265, 1266, 1267, 1268, 1269, 1270, 1271, 1272, 1273, 1274, 1275, 1276, 1277, 1278, 1279, 1280, 1281, 1282, 1283, 1284, 1285, 1286, 1287, 1288, 1289, 1290, 1291, 1292, 1293, 1294, 1295, 1296, 1297, 1298, 1299, 1300, 1301, 1302, 1303, 1304, 1305, 1393, 1394, 1395, 1396, 1397, 1398, 1399, 1400, 1401, 1402, 1403, 1404, 1405, 1406, 1407, 1408, 1409, 1441, 1442, 1443, 1444, 1445, 1446, 1447, 1448, 1449, 1450, 1671, 1672, 1673, 1674, 1675, 1676, 1677, 1678, 1679, 1680, 1700, 1701, 1702, 1703, 1704, 1705, 1786, 1822, 1823, 1824, 1825, 1826, 1854, 1855, 1856, 1857, 1858, 1859, 1860, 1861, 1862, 1863, 1872. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| tables | tables:public..fee_categories. | CREATE TABLE public."fee_categories" ("id" integer DEFAULT nextval('fee_categories_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "name" text NOT NULL, "description" text, "compulsory" boolean DEFAULT false NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "transport_only" boolean DEFAULT false NOT NULL) |
| tables | tables:public..fee_invoices. | CREATE TABLE public."fee_invoices" ("id" integer DEFAULT nextval('fee_invoices_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer, "parent_id" integer, "structure_id" integer, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "invoice_number" text NOT NULL, "student_name_snapshot" text NOT NULL, "admission_no_snapshot" text NOT NULL, "class_name_snapshot" text NOT NULL, "section_snapshot" text NOT NULL, "issue_date" date NOT NULL, "due_date" date NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "subtotal_minor" integer NOT NULL, "discount_minor" integer DEFAULT 0 NOT NULL, "waiver_minor" integer DEFAULT 0 NOT NULL, "total_minor" integer NOT NULL, "paid_minor" integer DEFAULT 0 NOT NULL, "outstanding_minor" integer NOT NULL, "status" text DEFAULT 'UNPAID'::text NOT NULL, "created_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "employee_id" integer) |
| tables | tables:public..fee_payment_line_allocations. | CREATE TABLE public."fee_payment_line_allocations" ("id" integer DEFAULT nextval('fee_payment_line_allocations_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "invoice_id" integer NOT NULL, "payment_id" integer NOT NULL, "line_id" integer NOT NULL, "amount_minor" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..fee_payments. | CREATE TABLE public."fee_payments" ("id" integer DEFAULT nextval('fee_payments_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "invoice_id" integer NOT NULL, "student_id" integer, "parent_id" integer, "reference" text NOT NULL, "idempotency_key" text NOT NULL, "amount_minor" integer NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "method" text NOT NULL, "provider" text DEFAULT 'MANUAL_BANK_TRANSFER'::text NOT NULL, "provider_transaction_id" text, "status" text DEFAULT 'PENDING'::text NOT NULL, "transfer_bank" text, "transfer_reference" text, "transfer_date" date, "proof_url" text, "submitted_by" integer NOT NULL, "verified_by" integer, "verified_at" timestamp with time zone, "verification_evidence_ref" text, "reviewer_notes" text, "verification_metadata" jsonb, "rejection_reason" text, "provider_metadata" jsonb, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "employee_id" integer, "selected_line_ids" integer[]) |
| tables | tables:public..payroll_employee_profiles. | CREATE TABLE public."payroll_employee_profiles" ("id" integer DEFAULT nextval('payroll_employee_profiles_id_seq'::regclass) NOT NULL, "scope" text NOT NULL, "school_id" integer, "employee_id" integer, "company_employee_id" integer, "monthly_salary_minor" integer NOT NULL, "allowance_minor" integer DEFAULT 0 NOT NULL, "deduction_minor" integer DEFAULT 0 NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "bank_name_encrypted" text NOT NULL, "bank_code_encrypted" text NOT NULL, "account_name_encrypted" text NOT NULL, "account_number_encrypted" text NOT NULL, "account_last4" text NOT NULL, "encryption_key_version" text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_by" integer NOT NULL, "updated_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..payroll_items. | CREATE TABLE public."payroll_items" ("id" integer DEFAULT nextval('payroll_items_id_seq'::regclass) NOT NULL, "scope" text NOT NULL, "school_id" integer, "period_id" integer NOT NULL, "employee_profile_id" integer NOT NULL, "period_month" text NOT NULL, "employee_name_snapshot" text NOT NULL, "employee_number_snapshot" text, "role_snapshot" text NOT NULL, "base_salary_minor" integer NOT NULL, "allowance_minor" integer DEFAULT 0 NOT NULL, "bonus_minor" integer DEFAULT 0 NOT NULL, "deduction_minor" integer DEFAULT 0 NOT NULL, "adjustment_minor" integer DEFAULT 0 NOT NULL, "adjustment_reason" text, "net_salary_minor" integer NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "bank_name_encrypted" text NOT NULL, "bank_code_encrypted" text NOT NULL, "account_name_encrypted" text NOT NULL, "account_number_encrypted" text NOT NULL, "account_last4" text NOT NULL, "encryption_key_version" text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..payroll_payslips. | CREATE TABLE public."payroll_payslips" ("id" integer DEFAULT nextval('payroll_payslips_id_seq'::regclass) NOT NULL, "scope" text NOT NULL, "school_id" integer, "period_id" integer NOT NULL, "payroll_item_id" integer NOT NULL, "transfer_id" integer NOT NULL, "payslip_number" text NOT NULL, "employee_name_snapshot" text NOT NULL, "employee_role_snapshot" text NOT NULL, "period_month" text NOT NULL, "base_salary_minor" integer NOT NULL, "allowance_minor" integer NOT NULL, "bonus_minor" integer NOT NULL, "deduction_minor" integer NOT NULL, "adjustment_minor" integer NOT NULL, "net_salary_minor" integer NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "issued_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..payroll_periods. | CREATE TABLE public."payroll_periods" ("id" integer DEFAULT nextval('payroll_periods_id_seq'::regclass) NOT NULL, "scope" text NOT NULL, "school_id" integer, "period_month" text NOT NULL, "status" text DEFAULT 'DRAFT'::text NOT NULL, "employee_count" integer NOT NULL, "gross_salary_minor" integer NOT NULL, "allowance_minor" integer NOT NULL, "bonus_minor" integer DEFAULT 0 NOT NULL, "deduction_minor" integer NOT NULL, "adjustment_minor" integer DEFAULT 0 NOT NULL, "net_salary_minor" integer NOT NULL, "created_by" integer NOT NULL, "submitted_by" integer, "submitted_at" timestamp with time zone, "approved_by" integer, "approved_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..payroll_transfers. | CREATE TABLE public."payroll_transfers" ("id" integer DEFAULT nextval('payroll_transfers_id_seq'::regclass) NOT NULL, "scope" text NOT NULL, "school_id" integer, "period_id" integer NOT NULL, "payroll_item_id" integer NOT NULL, "attempt_number" integer DEFAULT 1 NOT NULL, "idempotency_key_hash" text NOT NULL, "provider" text NOT NULL, "provider_mode" text NOT NULL, "provider_reference" text NOT NULL, "provider_transaction_id" text, "amount_minor" integer NOT NULL, "provider_fee_minor" integer DEFAULT 0 NOT NULL, "settlement_amount_minor" integer DEFAULT 0 NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "status" text DEFAULT 'CLAIMED'::text NOT NULL, "requires_reconciliation" boolean DEFAULT false NOT NULL, "external_transfer_verified" boolean DEFAULT false NOT NULL, "provider_status" text, "failure_message" text, "requested_by" integer NOT NULL, "verified_by" integer, "verified_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_subscription_enforcement. | CREATE TABLE public."school_subscription_enforcement" ("school_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "restricted_student_ids" integer[] DEFAULT '{}'::integer[] NOT NULL, "school_locked" boolean DEFAULT false NOT NULL, "version" integer DEFAULT 0 NOT NULL, "snapshot" jsonb NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_subscription_manual_locks. | CREATE TABLE public."school_subscription_manual_locks" ("school_id" integer NOT NULL, "locked" boolean DEFAULT false NOT NULL, "version" integer DEFAULT 0 NOT NULL, "locked_at" timestamp with time zone, "locked_by_user_id" integer, "last_unlocked_at" timestamp with time zone, "last_unlocked_by_user_id" integer, "reason" text, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..settlement_payroll_audit_events. | CREATE TABLE public."settlement_payroll_audit_events" ("id" integer DEFAULT nextval('settlement_payroll_audit_events_id_seq'::regclass) NOT NULL, "scope" text NOT NULL, "school_id" integer, "actor_user_id" integer NOT NULL, "actor_role" text NOT NULL, "record_type" text NOT NULL, "record_id" integer, "action" text NOT NULL, "amount_minor" integer, "currency" text, "provider_reference" text, "previous_status" text, "new_status" text, "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL, "occurred_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..settlement_payroll_profiles. | CREATE TABLE public."settlement_payroll_profiles" ("id" integer DEFAULT nextval('settlement_payroll_profiles_id_seq'::regclass) NOT NULL, "scope" text NOT NULL, "school_id" integer, "business_name" text NOT NULL, "business_registration_number" text, "settlement_contact_email" text NOT NULL, "settlement_contact_phone" text, "bank_name_encrypted" text NOT NULL, "bank_code_encrypted" text NOT NULL, "account_name_encrypted" text NOT NULL, "account_number_encrypted" text NOT NULL, "account_last4" text NOT NULL, "encryption_key_version" text NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "provider" text DEFAULT 'FLUTTERWAVE'::text NOT NULL, "provider_business_id" text, "provider_subaccount_id" text, "verification_status" text DEFAULT 'PENDING_VERIFICATION'::text NOT NULL, "verified_at" timestamp with time zone, "verified_by" integer, "created_by" integer NOT NULL, "updated_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..staff_nfc_allocations. | CREATE TABLE public."staff_nfc_allocations" ("id" integer DEFAULT nextval('staff_nfc_allocations_id_seq'::regclass) NOT NULL, "idempotency_key" text NOT NULL, "entry_type" text DEFAULT 'CREDIT'::text NOT NULL, "product" text DEFAULT 'TEACHER_STAFF_NFC_EID'::text NOT NULL, "recipient_type" text NOT NULL, "recipient_id" integer, "school_id" integer NOT NULL, "employee_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "subscription_id" integer NOT NULL, "payment_id" integer NOT NULL, "refund_id" integer, "allocation_rule_id" integer NOT NULL, "billing_rule_version" integer NOT NULL, "attribution_id" integer, "amount_minor" integer NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..staff_nfc_billing_rules. | CREATE TABLE public."staff_nfc_billing_rules" ("id" integer DEFAULT nextval('staff_nfc_billing_rules_id_seq'::regclass) NOT NULL, "version" integer NOT NULL, "product" text DEFAULT 'TEACHER_STAFF_NFC_EID'::text NOT NULL, "billing_frequency" text DEFAULT 'ACADEMIC_TERM'::text NOT NULL, "price_minor" integer NOT NULL, "school_share_minor" integer NOT NULL, "platform_share_minor" integer NOT NULL, "partner_commission_minor" integer NOT NULL, "no_partner_platform_share_minor" integer NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "effective_at" timestamp with time zone NOT NULL, "created_by" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..staff_nfc_partner_commissions. | CREATE TABLE public."staff_nfc_partner_commissions" ("id" integer DEFAULT nextval('staff_nfc_partner_commissions_id_seq'::regclass) NOT NULL, "allocation_id" integer NOT NULL, "partner_profile_id" integer NOT NULL, "school_id" integer NOT NULL, "employee_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "subscription_id" integer NOT NULL, "payment_id" integer NOT NULL, "recipient_type" text DEFAULT 'PARTNER'::text NOT NULL, "commission_minor" integer NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "status" text DEFAULT 'PENDING'::text NOT NULL, "paid_at" timestamp with time zone, "payment_reference" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..staff_nfc_payments. | CREATE TABLE public."staff_nfc_payments" ("id" integer DEFAULT nextval('staff_nfc_payments_id_seq'::regclass) NOT NULL, "subscription_id" integer NOT NULL, "employee_id" integer NOT NULL, "school_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "provider" text NOT NULL, "provider_mode" text NOT NULL, "reference" text NOT NULL, "idempotency_key" text NOT NULL, "gross_amount_minor" integer NOT NULL, "provider_fee_minor" integer, "settlement_amount_minor" integer, "refunded_amount_minor" integer DEFAULT 0 NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "status" text DEFAULT 'PENDING'::text NOT NULL, "settlement_status" text DEFAULT 'PENDING'::text NOT NULL, "reconciliation_status" text DEFAULT 'PENDING'::text NOT NULL, "refund_status" text DEFAULT 'NONE'::text NOT NULL, "checkout_url" text, "provider_transaction_id" text, "provider_paid_at" timestamp with time zone, "paid_at" timestamp with time zone, "failure_code" text, "created_by" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..staff_nfc_provider_events. | CREATE TABLE public."staff_nfc_provider_events" ("id" integer DEFAULT nextval('staff_nfc_provider_events_id_seq'::regclass) NOT NULL, "provider" text DEFAULT 'FLUTTERWAVE'::text NOT NULL, "event_id" text NOT NULL, "provider_reference" text NOT NULL, "provider_transaction_id" text NOT NULL, "payload_sha256" text NOT NULL, "signature_verified" boolean DEFAULT true NOT NULL, "outcome" text DEFAULT 'RECEIVED'::text NOT NULL, "payment_id" integer, "school_id" integer, "failure_code" text, "received_at" timestamp with time zone DEFAULT now() NOT NULL, "resolved_at" timestamp with time zone) |
| tables | tables:public..staff_nfc_receipts. | CREATE TABLE public."staff_nfc_receipts" ("id" integer DEFAULT nextval('staff_nfc_receipts_id_seq'::regclass) NOT NULL, "payment_id" integer NOT NULL, "subscription_id" integer NOT NULL, "school_id" integer NOT NULL, "receipt_number" text NOT NULL, "issued_at" timestamp with time zone DEFAULT now() NOT NULL, "snapshot" jsonb NOT NULL) |
| tables | tables:public..staff_nfc_refunds. | CREATE TABLE public."staff_nfc_refunds" ("id" integer DEFAULT nextval('staff_nfc_refunds_id_seq'::regclass) NOT NULL, "payment_id" integer NOT NULL, "school_id" integer NOT NULL, "amount_minor" integer NOT NULL, "idempotency_key" text NOT NULL, "reason" text NOT NULL, "status" text DEFAULT 'REQUESTED'::text NOT NULL, "provider_refund_id" text, "created_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "completed_at" timestamp with time zone, "provider_verified_at" timestamp with time zone, "failure_code" text) |
| tables | tables:public..staff_nfc_subscriptions. | CREATE TABLE public."staff_nfc_subscriptions" ("id" integer DEFAULT nextval('staff_nfc_subscriptions_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "employee_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "product" text DEFAULT 'TEACHER_STAFF_NFC_EID'::text NOT NULL, "billing_rule_id" integer NOT NULL, "billing_rule_version" integer NOT NULL, "price_minor" integer NOT NULL, "school_share_minor" integer NOT NULL, "platform_share_minor" integer NOT NULL, "partner_share_minor" integer DEFAULT 0 NOT NULL, "partner_profile_id" integer, "attribution_id" integer, "currency" text DEFAULT 'NGN'::text NOT NULL, "status" text DEFAULT 'UNPAID'::text NOT NULL, "due_date" date NOT NULL, "created_by" integer, "paid_at" timestamp with time zone, "refunded_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..student_nfc_replacement_requests. | CREATE TABLE public."student_nfc_replacement_requests" ("id" integer DEFAULT nextval('student_nfc_replacement_requests_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer, "old_card_id" integer NOT NULL, "invoice_id" integer NOT NULL, "requested_by" integer NOT NULL, "reason" text NOT NULL, "status" text DEFAULT 'REQUESTED'::text NOT NULL, "new_card_id" integer, "issued_by" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "issued_at" timestamp with time zone, "employee_id" integer) |
| tables | tables:public..student_subscription_terms. | CREATE TABLE public."student_subscription_terms" ("school_id" integer NOT NULL, "student_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "subscription_id" integer, "legacy_invoice_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.fee_categories; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payment_line_allocations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_employee_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_items; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_payslips; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_periods; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_transfers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_subscription_enforcement; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_subscription_manual_locks; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.settlement_payroll_audit_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.settlement_payroll_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_allocations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_billing_rules; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_partner_commissions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_payments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_provider_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_receipts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_refunds; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_subscriptions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_nfc_replacement_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_subscription_terms; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs 528, 529, 530, 531, 532, 533, 838, 839, 840, 841, 842, 843, 844, 845, 846, 847, 848, 849, 850, 851, 852, 853, 854, 855, 856, 857, 858, 859, 860, 861, 862, 863, 864, 865, 866, 867, 868, 869, 870, 871, 872, 873, 874, 875, 876, 877, 878, 879, 880, 881, 882, 883, 884, 885, 886, 887, 888, 889, 890, 891, 892, 893, 894, 895, 896, 897, 898, 899, 900, 1121, 1122, 1123, 1124, 1125, 1126, 1127, 1128, 1129, 1130, 1190, 1191, 1192, 1193, 1194, 1195, 1196, 1197, 1198, 1199, 1200, 1201, 1202, 1203, 1204, 1205, 1206, 1207, 1208, 1209, 1210, 1211, 1212, 1213, 1214, 1215, 1216, 1217, 1218, 1219, 1220, 1221, 1222, 1223, 1224, 1225, 1226, 1227, 1228, 1229, 1230, 1231, 1232, 1233, 1234, 1235, 1236, 1237, 1238, 1239, 1240, 1241, 1242, 1243, 1244, 1245, 1246, 1247, 1248, 1249, 1250, 1251, 1252, 1253, 1254, 1255, 1256, 1257, 1258, 1259, 1260, 1261, 1262, 1263, 1264, 1265, 1266, 1267, 1268, 1269, 1270, 1271, 1272, 1273, 1274, 1275, 1276, 1277, 1278, 1279, 1280, 1281, 1282, 1283, 1284, 1285, 1286, 1287, 1288, 1289, 1290, 1291, 1292, 1293, 1294, 1295, 1296, 1297, 1298, 1299, 1300, 1301, 1302, 1303, 1304, 1305, 1393, 1394, 1395, 1396, 1397, 1398, 1399, 1400, 1401, 1402, 1403, 1404, 1405, 1406, 1407, 1408, 1409, 1441, 1442, 1443, 1444, 1445, 1446, 1447, 1448, 1449, 1450, 1671, 1672, 1673, 1674, 1675, 1676, 1677, 1678, 1679, 1680, 1700, 1701, 1702, 1703, 1704, 1705, 1786, 1822, 1823, 1824, 1825, 1826, 1854, 1855, 1856, 1857, 1858, 1859, 1860, 1861, 1862, 1863, 1872
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0075_reconcile_table_shells_g_1.sql

- [ ] Hash matches **296e0c051a5f7b2ebf1c7e722570800ddbe308acb27e012ec88c0754dea50b50**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0064_reconcile_sequences_d_1.sql, 0066_reconcile_sequences_f_1.sql, 0067_reconcile_sequences_g_1.sql.
- [ ] Required objects verified: sequences:public.campus_presence.campus_presence_id_seq.; sequences:public.attendance_discrepancies.attendance_discrepancies_id_seq.; sequences:public.employee_nfc_attendance_discrepancies.employee_nfc_attendance_discrepancies_id_seq.; sequences:public.employee_nfc_card_bindings.employee_nfc_card_bindings_id_seq.; sequences:public.employee_nfc_card_history.employee_nfc_card_history_id_seq.; sequences:public.nfc_card_history.nfc_card_history_id_seq.; sequences:public.employee_nfc_discrepancy_actions.employee_nfc_discrepancy_actions_id_seq.; sequences:public.maintenance_request_status_history.maintenance_request_status_history_id_seq.; sequences:public.operational_task_status_history.operational_task_status_history_id_seq.; sequences:public.platform_devices.platform_devices_id_seq.; sequences:public.school_asset_history.school_asset_history_id_seq.; sequences:public.school_authorized_pickup_persons.school_authorized_pickup_persons_id_seq.; sequences:public.school_operation_categories.school_operation_categories_id_seq.; sequences:public.school_pickup_requests.school_pickup_requests_id_seq.; sequences:public.school_security_incident_attachments.school_security_incident_attachments_id_seq.; sequences:public.school_security_incidents.school_security_incidents_id_seq.; sequences:public.school_security_operation_history.school_security_operation_history_id_seq.; sequences:public.school_security_visitors.school_security_visitors_id_seq.; sequences:public.security_events.security_events_id_seq.; sequences:public.security_locations.security_locations_id_seq.; sequences:public.security_readers.security_readers_id_seq.; sequences:public.security_staff_grants.security_staff_grants_id_seq.; sequences:public.transport_buses.transport_buses_id_seq.; sequences:public.fee_invoices.fee_invoices_id_seq.; sequences:public.transport_fee_invoices.transport_fee_invoices_id_seq.; sequences:public.transport_history.transport_history_id_seq.; sequences:public.transport_parent_requests.transport_parent_requests_id_seq.; sequences:public.transport_route_staff.transport_route_staff_id_seq.; sequences:public.transport_route_stops.transport_route_stops_id_seq.; sequences:public.transport_routes.transport_routes_id_seq.; sequences:public.transport_student_assignments.transport_student_assignments_id_seq..
- [ ] Expected schema: Missing tables receive complete typed column/default/NOT NULL shells exactly as listed; PK/UNIQUE/CHECK/FK enforcement belongs to later tiers. Existing matching table identity/storage contracts are preserved and later columns reconciled separately.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **315**; IDs 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 419, 420, 421, 422, 423, 424, 425, 426, 427, 428, 429, 978, 979, 980, 981, 982, 983, 984, 985, 986, 987, 988, 989, 990, 1054, 1055, 1056, 1057, 1058, 1059, 1060, 1061, 1062, 1063, 1064, 1065, 1066, 1067, 1068, 1069, 1070, 1071, 1072, 1073, 1074, 1075, 1076, 1077, 1078, 1079, 1080, 1081, 1082, 1083, 1084, 1085, 1086, 1087, 1088, 1089, 1090, 1091, 1092, 1093, 1094, 1095, 1096, 1097, 1098, 1099, 1100, 1101, 1102, 1103, 1104, 1105, 1106, 1107, 1108, 1109, 1110, 1111, 1112, 1113, 1114, 1115, 1116, 1117, 1118, 1119, 1120, 1133, 1134, 1135, 1136, 1137, 1138, 1139, 1140, 1141, 1142, 1143, 1144, 1145, 1146, 1147, 1148, 1149, 1150, 1151, 1152, 1153, 1154, 1155, 1156, 1157, 1158, 1159, 1160, 1161, 1162, 1163, 1164, 1165, 1166, 1167, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175, 1176, 1177, 1178, 1179, 1180, 1181, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1509, 1510, 1511, 1512, 1513, 1514, 1515, 1516, 1517, 1518, 1519, 1520, 1521, 1522, 1523, 1524, 1525, 1526, 1527, 1528, 1529, 1530, 1531, 1532, 1533, 1534, 1535, 1536, 1537, 1538, 1539, 1540, 1541, 1542, 1543, 1544, 1545, 1546, 1547, 1548, 1549, 1550, 1551, 1552, 1553, 1554, 1555, 1556, 1557, 1558, 1559, 1560, 1561, 1562, 1563, 1564, 1565, 1566, 1567, 1568, 1569, 1570, 1571, 1572, 1573, 1574, 1575, 1576, 1577, 1578, 1579, 1580, 1581, 1582, 1583, 1584, 1585, 1586, 1587, 1588, 1589, 1590, 1591, 1592, 1593, 1594, 1595, 1596, 1597, 1598, 1599, 1600, 1601, 1602, 1603, 1604, 1605, 1606, 1607, 1608, 1609, 1610, 1611, 1612, 1626, 1627, 1639, 1640, 1641, 1699, 1728, 1729, 1730, 1731, 1753, 1772, 1773, 1774, 1775, 1835, 1844, 1845, 1846, 1847, 1848, 1850, 1851, 1852, 1853, 1882, 1883, 1884, 1885, 1886, 1887, 1888, 1889. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| tables | tables:public..campus_presence. | CREATE TABLE public."campus_presence" ("id" bigint DEFAULT nextval('campus_presence_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "person_type" text NOT NULL, "student_id" integer, "employee_id" integer, "state" text NOT NULL, "last_security_event_id" bigint NOT NULL, "last_occurred_at" timestamp with time zone NOT NULL, "review_reason" text, "resolved_by_user_id" integer, "resolution_reason" text, "reviewed_at" timestamp with time zone, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..employee_nfc_attendance_discrepancies. | CREATE TABLE public."employee_nfc_attendance_discrepancies" ("id" integer DEFAULT nextval('employee_nfc_attendance_discrepancies_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "employee_id" integer NOT NULL, "attendance_event_id" integer NOT NULL, "kind" text NOT NULL, "status" text DEFAULT 'OPEN'::text NOT NULL, "details" jsonb DEFAULT '{}'::jsonb NOT NULL, "resolved_at" timestamp with time zone, "resolved_by_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..employee_nfc_card_bindings. | CREATE TABLE public."employee_nfc_card_bindings" ("id" integer DEFAULT nextval('employee_nfc_card_bindings_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "nfc_card_id" integer NOT NULL, "employee_id" integer NOT NULL, "status" text DEFAULT 'ASSIGNED'::text NOT NULL, "created_by_user_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..employee_nfc_card_history. | CREATE TABLE public."employee_nfc_card_history" ("id" integer DEFAULT nextval('employee_nfc_card_history_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "binding_id" integer NOT NULL, "nfc_card_id" integer NOT NULL, "employee_id" integer NOT NULL, "action" text NOT NULL, "previous_status" text, "new_status" text, "replacement_nfc_card_id" integer, "reason" text, "actor_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..employee_nfc_discrepancy_actions. | CREATE TABLE public."employee_nfc_discrepancy_actions" ("id" integer DEFAULT nextval('employee_nfc_discrepancy_actions_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "discrepancy_id" integer NOT NULL, "resolution" text NOT NULL, "reason" text NOT NULL, "actor_user_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..maintenance_request_status_history. | CREATE TABLE public."maintenance_request_status_history" ("id" integer DEFAULT nextval('maintenance_request_status_history_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "maintenance_request_id" integer NOT NULL, "from_status" text, "to_status" text NOT NULL, "actor_user_id" integer NOT NULL, "occurred_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..operational_task_status_history. | CREATE TABLE public."operational_task_status_history" ("id" integer DEFAULT nextval('operational_task_status_history_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "task_id" integer NOT NULL, "from_status" text, "to_status" text NOT NULL, "actor_user_id" integer NOT NULL, "occurred_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..platform_devices. | CREATE TABLE public."platform_devices" ("id" integer DEFAULT nextval('platform_devices_id_seq'::regclass) NOT NULL, "serial_number" text NOT NULL, "name" text NOT NULL, "device_type" text NOT NULL, "school_id" integer, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "last_seen_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "location" text, "school_class_id" integer, "configuration_status" text DEFAULT 'PENDING'::text NOT NULL) |
| tables | tables:public..school_asset_history. | CREATE TABLE public."school_asset_history" ("id" integer DEFAULT nextval('school_asset_history_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "asset_id" integer NOT NULL, "event_type" text NOT NULL, "quantity_before" integer, "quantity_after" integer, "assigned_to_before_user_id" integer, "assigned_to_after_user_id" integer, "status_before" text, "status_after" text, "actor_user_id" integer NOT NULL, "event_at" timestamp with time zone DEFAULT now() NOT NULL, "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL) |
| tables | tables:public..school_authorized_pickup_persons. | CREATE TABLE public."school_authorized_pickup_persons" ("id" integer DEFAULT nextval('school_authorized_pickup_persons_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "nominated_by_parent_id" integer NOT NULL, "full_name" text NOT NULL, "phone" text NOT NULL, "relationship" text, "identity_reference" text, "status" text DEFAULT 'PENDING'::text NOT NULL, "valid_from" timestamp with time zone, "valid_until" timestamp with time zone, "requested_at" timestamp with time zone DEFAULT now() NOT NULL, "decision_by_user_id" integer, "decision_reason" text, "decided_at" timestamp with time zone, "version" integer DEFAULT 1 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_operation_categories. | CREATE TABLE public."school_operation_categories" ("id" integer DEFAULT nextval('school_operation_categories_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "category_type" text NOT NULL, "name" text NOT NULL, "description" text, "is_active" boolean DEFAULT true NOT NULL, "created_by_user_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_pickup_requests. | CREATE TABLE public."school_pickup_requests" ("id" integer DEFAULT nextval('school_pickup_requests_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "requested_by_parent_id" integer NOT NULL, "pickup_person_id" integer NOT NULL, "requested_pickup_at" timestamp with time zone NOT NULL, "valid_from" timestamp with time zone NOT NULL, "valid_until" timestamp with time zone NOT NULL, "reason" text, "status" text DEFAULT 'PENDING'::text NOT NULL, "decision_by_user_id" integer, "decision_reason" text, "decided_at" timestamp with time zone, "completed_at" timestamp with time zone, "completed_by_user_id" integer, "completion_pickup_person_id" integer, "recorded_security_event_id" bigint, "completion_idempotency_key" text, "version" integer DEFAULT 1 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_security_incident_attachments. | CREATE TABLE public."school_security_incident_attachments" ("id" integer DEFAULT nextval('school_security_incident_attachments_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "incident_id" integer NOT NULL, "object_path" text NOT NULL, "file_name" text NOT NULL, "content_type" text NOT NULL, "byte_size" integer NOT NULL, "status" text DEFAULT 'PENDING_UPLOAD'::text NOT NULL, "uploaded_by_user_id" integer NOT NULL, "upload_expires_at" timestamp with time zone NOT NULL, "confirmed_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_security_incidents. | CREATE TABLE public."school_security_incidents" ("id" integer DEFAULT nextval('school_security_incidents_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "incident_type" text NOT NULL, "occurred_at" timestamp with time zone NOT NULL, "security_location_id" integer, "security_device_id" integer, "student_id" integer, "involved_persons" jsonb DEFAULT '[]'::jsonb NOT NULL, "assigned_staff_user_id" integer, "description" text NOT NULL, "severity" text DEFAULT 'LOW'::text NOT NULL, "status" text DEFAULT 'OPEN'::text NOT NULL, "resolution" text, "created_by_user_id" integer NOT NULL, "version" integer DEFAULT 1 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_security_operation_history. | CREATE TABLE public."school_security_operation_history" ("id" integer DEFAULT nextval('school_security_operation_history_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer, "entity_type" text NOT NULL, "entity_id" integer NOT NULL, "revision" integer NOT NULL, "event_type" text NOT NULL, "actor_user_id" integer NOT NULL, "result" text DEFAULT 'SUCCESS'::text NOT NULL, "snapshot" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..school_security_visitors. | CREATE TABLE public."school_security_visitors" ("id" integer DEFAULT nextval('school_security_visitors_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "visitor_name" text NOT NULL, "phone" text, "id_reference" text, "purpose" text NOT NULL, "host_name" text, "host_student_id" integer, "checked_in_at" timestamp with time zone DEFAULT now() NOT NULL, "checked_out_at" timestamp with time zone, "checkout_idempotency_key" text, "status" text DEFAULT 'ON_SITE'::text NOT NULL, "notes" text, "security_officer_user_id" integer NOT NULL, "security_location_id" integer, "security_device_id" integer, "version" integer DEFAULT 1 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..security_events. | CREATE TABLE public."security_events" ("id" bigint DEFAULT nextval('security_events_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "reader_id" integer, "location_id" integer, "device_id" integer NOT NULL, "attendance_event_id" integer, "nfc_card_id" integer, "student_id" integer, "employee_id" integer, "person_type" text NOT NULL, "person_name_snapshot" text, "admission_number_snapshot" text, "employee_number_snapshot" text, "class_name_snapshot" text, "section_snapshot" text, "location_name_snapshot" text, "reader_name_snapshot" text, "event_type" text NOT NULL, "identity_result" text NOT NULL, "reason_code" text, "card_uid_sha256" text, "event_key" text NOT NULL, "occurred_at" timestamp with time zone NOT NULL, "received_at" timestamp with time zone DEFAULT now() NOT NULL, "sync_status" text DEFAULT 'SYNCED'::text NOT NULL, "physical_control_status" text DEFAULT 'NOT_CONNECTED'::text NOT NULL, "actor_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..security_locations. | CREATE TABLE public."security_locations" ("id" integer DEFAULT nextval('security_locations_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "name" text NOT NULL, "description" text, "zone_type" text DEFAULT 'OTHER'::text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_by_user_id" integer, "updated_by_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..security_readers. | CREATE TABLE public."security_readers" ("id" integer DEFAULT nextval('security_readers_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "location_id" integer NOT NULL, "device_id" integer NOT NULL, "name" text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "permissions" text[] DEFAULT ARRAY['ENTRY'::text, 'EXIT'::text] NOT NULL, "created_by_user_id" integer, "updated_by_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..security_school_settings. | CREATE TABLE public."security_school_settings" ("school_id" integer NOT NULL, "security_enabled" boolean DEFAULT true NOT NULL, "parent_entry_alerts" boolean DEFAULT true NOT NULL, "parent_exit_alerts" boolean DEFAULT true NOT NULL, "updated_by_user_id" integer, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..security_staff_grants. | CREATE TABLE public."security_staff_grants" ("id" integer DEFAULT nextval('security_staff_grants_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "user_id" integer NOT NULL, "permissions" text[] NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "expires_at" timestamp with time zone, "granted_by_user_id" integer NOT NULL, "revoked_by_user_id" integer, "revoked_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..transport_buses. | CREATE TABLE public."transport_buses" ("id" integer DEFAULT nextval('transport_buses_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "name" text NOT NULL, "registration_number" text NOT NULL, "make" text, "capacity" integer NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "notes" text, "created_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..transport_fee_invoices. | CREATE TABLE public."transport_fee_invoices" ("id" integer DEFAULT nextval('transport_fee_invoices_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "assignment_id" integer NOT NULL, "academic_session_id" integer NOT NULL, "academic_term_id" integer NOT NULL, "fee_category_id" integer, "amount_minor" integer NOT NULL, "due_date" date NOT NULL, "status" text DEFAULT 'PLANNED'::text NOT NULL, "fee_invoice_id" integer, "created_by" integer NOT NULL, "updated_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..transport_history. | CREATE TABLE public."transport_history" ("id" integer DEFAULT nextval('transport_history_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "assignment_id" integer, "route_id" integer, "bus_id" integer, "request_id" integer, "route_staff_id" integer, "student_id" integer, "event_type" text NOT NULL, "effective_date" date NOT NULL, "reason" text NOT NULL, "actor_user_id" integer, "actor_role" text NOT NULL, "before_state" jsonb, "after_state" jsonb, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..transport_parent_requests. | CREATE TABLE public."transport_parent_requests" ("id" integer DEFAULT nextval('transport_parent_requests_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "parent_id" integer NOT NULL, "assignment_id" integer, "request_type" text NOT NULL, "request_date" timestamp with time zone DEFAULT now() NOT NULL, "effective_date" date NOT NULL, "reason" text NOT NULL, "status" text DEFAULT 'PENDING'::text NOT NULL, "school_action" text, "school_note" text, "reviewed_by" integer, "reviewed_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..transport_route_staff. | CREATE TABLE public."transport_route_staff" ("id" integer DEFAULT nextval('transport_route_staff_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "route_id" integer NOT NULL, "employee_id" integer NOT NULL, "role" text DEFAULT 'ACCOMPANIER'::text NOT NULL, "is_active" boolean DEFAULT true NOT NULL, "assigned_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..transport_route_stops. | CREATE TABLE public."transport_route_stops" ("id" integer DEFAULT nextval('transport_route_stops_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "route_id" integer NOT NULL, "name" text NOT NULL, "stop_type" text NOT NULL, "sequence" integer NOT NULL, "notes" text, "is_active" boolean DEFAULT true NOT NULL, "created_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..transport_routes. | CREATE TABLE public."transport_routes" ("id" integer DEFAULT nextval('transport_routes_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "bus_id" integer NOT NULL, "driver_employee_id" integer NOT NULL, "name" text NOT NULL, "weekdays" text[] NOT NULL, "departure_time" text NOT NULL, "arrival_time" text NOT NULL, "fare_minor" integer DEFAULT 0 NOT NULL, "currency" text DEFAULT 'NGN'::text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..transport_school_policies. | CREATE TABLE public."transport_school_policies" ("school_id" integer NOT NULL, "payment_required" boolean DEFAULT false NOT NULL, "suspend_when_overdue" boolean DEFAULT false NOT NULL, "updated_by" integer NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..transport_student_assignments. | CREATE TABLE public."transport_student_assignments" ("id" integer DEFAULT nextval('transport_student_assignments_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "route_id" integer NOT NULL, "pickup_stop_id" integer NOT NULL, "dropoff_stop_id" integer NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "effective_date" date NOT NULL, "end_date" date, "reason" text NOT NULL, "created_by" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.campus_presence; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_attendance_discrepancies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_card_bindings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_card_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_discrepancy_actions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.maintenance_request_status_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.operational_task_status_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.platform_devices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_asset_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_authorized_pickup_persons; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_operation_categories; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_pickup_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_incident_attachments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_incidents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_operation_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_visitors; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_locations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_readers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_school_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_staff_grants; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_buses; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_fee_invoices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_parent_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_route_staff; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_route_stops; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_routes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_school_policies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_student_assignments; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 419, 420, 421, 422, 423, 424, 425, 426, 427, 428, 429, 978, 979, 980, 981, 982, 983, 984, 985, 986, 987, 988, 989, 990, 1054, 1055, 1056, 1057, 1058, 1059, 1060, 1061, 1062, 1063, 1064, 1065, 1066, 1067, 1068, 1069, 1070, 1071, 1072, 1073, 1074, 1075, 1076, 1077, 1078, 1079, 1080, 1081, 1082, 1083, 1084, 1085, 1086, 1087, 1088, 1089, 1090, 1091, 1092, 1093, 1094, 1095, 1096, 1097, 1098, 1099, 1100, 1101, 1102, 1103, 1104, 1105, 1106, 1107, 1108, 1109, 1110, 1111, 1112, 1113, 1114, 1115, 1116, 1117, 1118, 1119, 1120, 1133, 1134, 1135, 1136, 1137, 1138, 1139, 1140, 1141, 1142, 1143, 1144, 1145, 1146, 1147, 1148, 1149, 1150, 1151, 1152, 1153, 1154, 1155, 1156, 1157, 1158, 1159, 1160, 1161, 1162, 1163, 1164, 1165, 1166, 1167, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175, 1176, 1177, 1178, 1179, 1180, 1181, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1509, 1510, 1511, 1512, 1513, 1514, 1515, 1516, 1517, 1518, 1519, 1520, 1521, 1522, 1523, 1524, 1525, 1526, 1527, 1528, 1529, 1530, 1531, 1532, 1533, 1534, 1535, 1536, 1537, 1538, 1539, 1540, 1541, 1542, 1543, 1544, 1545, 1546, 1547, 1548, 1549, 1550, 1551, 1552, 1553, 1554, 1555, 1556, 1557, 1558, 1559, 1560, 1561, 1562, 1563, 1564, 1565, 1566, 1567, 1568, 1569, 1570, 1571, 1572, 1573, 1574, 1575, 1576, 1577, 1578, 1579, 1580, 1581, 1582, 1583, 1584, 1585, 1586, 1587, 1588, 1589, 1590, 1591, 1592, 1593, 1594, 1595, 1596, 1597, 1598, 1599, 1600, 1601, 1602, 1603, 1604, 1605, 1606, 1607, 1608, 1609, 1610, 1611, 1612, 1626, 1627, 1639, 1640, 1641, 1699, 1728, 1729, 1730, 1731, 1753, 1772, 1773, 1774, 1775, 1835, 1844, 1845, 1846, 1847, 1848, 1850, 1851, 1852, 1853, 1882, 1883, 1884, 1885, 1886, 1887, 1888, 1889
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0076_reconcile_table_shells_h_1.sql

- [ ] Hash matches **6a6d3f8411772c6c8bc25606abcb6a754abaab947484d3ea03deb4536488e3ef**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0068_reconcile_sequences_h_1.sql.
- [ ] Required objects verified: sequences:public.communication_campaigns.communication_campaigns_id_seq.; sequences:public.communication_deliveries.communication_deliveries_id_seq.; sequences:public.communication_message_threads.communication_message_threads_id_seq.; sequences:public.communication_messages.communication_messages_id_seq.; sequences:public.communication_notifications.communication_notifications_id_seq.; sequences:public.communication_push_devices.communication_push_devices_id_seq.; sequences:public.communication_templates.communication_templates_id_seq..
- [ ] Expected schema: Missing tables receive complete typed column/default/NOT NULL shells exactly as listed; PK/UNIQUE/CHECK/FK enforcement belongs to later tiers. Existing matching table identity/storage contracts are preserved and later columns reconciled separately.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **23**; IDs 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 1631, 1632, 1760, 1761. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| tables | tables:public..communication_campaigns. | CREATE TABLE public."communication_campaigns" ("id" integer DEFAULT nextval('communication_campaigns_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "created_by_user_id" integer NOT NULL, "template_id" integer, "idempotency_key" text, "title" text NOT NULL, "subject" text, "body" text NOT NULL, "category" text DEFAULT 'ANNOUNCEMENT'::text NOT NULL, "target_type" text NOT NULL, "target_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL, "channels" text[] NOT NULL, "status" text DEFAULT 'DRAFT'::text NOT NULL, "recipient_count" integer DEFAULT 0 NOT NULL, "scheduled_at" timestamp with time zone, "sent_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "is_emergency" boolean DEFAULT false NOT NULL, "expires_at" timestamp with time zone) |
| tables | tables:public..communication_deliveries. | CREATE TABLE public."communication_deliveries" ("id" integer DEFAULT nextval('communication_deliveries_id_seq'::regclass) NOT NULL, "notification_id" integer NOT NULL, "channel" text NOT NULL, "status" text DEFAULT 'QUEUED'::text NOT NULL, "provider_message_id" text, "provider_acknowledged_at" timestamp with time zone, "sent_at" timestamp with time zone, "delivered_at" timestamp with time zone, "failed_at" timestamp with time zone, "error_code" text, "last_error" text, "attempts" integer DEFAULT 0 NOT NULL, "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL, "last_attempt_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "push_attempts" jsonb DEFAULT '{}'::jsonb NOT NULL, "receipt_ids" jsonb DEFAULT '[]'::jsonb NOT NULL, "provider_name" text) |
| tables | tables:public..communication_message_threads. | CREATE TABLE public."communication_message_threads" ("id" integer DEFAULT nextval('communication_message_threads_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "subject_class_id" integer, "parent_user_id" integer NOT NULL, "created_by_user_id" integer NOT NULL, "request_key" text NOT NULL, "request_hash" text NOT NULL, "subject" text NOT NULL, "category" text DEFAULT 'GENERAL'::text NOT NULL, "parent_last_read_at" timestamp with time zone, "school_last_read_at" timestamp with time zone, "parent_archived_at" timestamp with time zone, "school_archived_at" timestamp with time zone, "last_message_at" timestamp with time zone DEFAULT now() NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..communication_messages. | CREATE TABLE public."communication_messages" ("id" integer DEFAULT nextval('communication_messages_id_seq'::regclass) NOT NULL, "thread_id" integer NOT NULL, "school_id" integer NOT NULL, "sender_user_id" integer NOT NULL, "request_key" text NOT NULL, "content_hash" text NOT NULL, "body" text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |
| tables | tables:public..communication_notifications. | CREATE TABLE public."communication_notifications" ("id" integer DEFAULT nextval('communication_notifications_id_seq'::regclass) NOT NULL, "recipient_user_id" integer NOT NULL, "school_id" integer, "sender_user_id" integer, "category" text NOT NULL, "event_key" text, "subject" text, "body" text NOT NULL, "link" text, "is_read" boolean DEFAULT false NOT NULL, "read_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "subject_student_id" integer, "subject_class_id" integer, "archived_at" timestamp with time zone) |
| tables | tables:public..communication_push_devices. | CREATE TABLE public."communication_push_devices" ("id" integer DEFAULT nextval('communication_push_devices_id_seq'::regclass) NOT NULL, "user_id" integer NOT NULL, "school_id" integer, "provider" text DEFAULT 'WEB_PUSH'::text NOT NULL, "opaque_device_reference" text NOT NULL, "status" text DEFAULT 'ACTIVE'::text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "last_used_at" timestamp with time zone, "revoked_at" timestamp with time zone, "subscription" jsonb, "session_id" text) |
| tables | tables:public..communication_templates. | CREATE TABLE public."communication_templates" ("id" integer DEFAULT nextval('communication_templates_id_seq'::regclass) NOT NULL, "school_id" integer NOT NULL, "template_key" text NOT NULL, "name" text NOT NULL, "category" text NOT NULL, "channel" text NOT NULL, "subject" text, "body" text NOT NULL, "allowed_variables" text[] DEFAULT ARRAY[]::text[] NOT NULL, "is_active" boolean DEFAULT true NOT NULL, "created_by_user_id" integer, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL) |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.communication_campaigns; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_deliveries; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_message_threads; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_messages; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_push_devices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_templates; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 1631, 1632, 1760, 1761
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0077_reconcile_table_shells_i_1.sql

- [ ] Hash matches **9a8ac0b946c6b8b3f097d29b6a96cde6b29f4d970b0fafdadbe10a98b593931b**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: none of the forward package; common A/system/temp-helper prerequisites still required.
- [ ] Required objects verified: canonical system schemas/types and session-local guards; no public-object creation prerequisites.
- [ ] Expected schema: Missing tables receive complete typed column/default/NOT NULL shells exactly as listed; PK/UNIQUE/CHECK/FK enforcement belongs to later tiers. Existing matching table identity/storage contracts are preserved and later columns reconciled separately.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| tables | tables:public..device_school_bindings. | CREATE TABLE public."device_school_bindings" ("device_id" integer NOT NULL, "school_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL) |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.device_school_bindings; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0078_reconcile_columns_a_1.sql

- [ ] Hash matches **99b7ae3018248823d9e3ee70d0937a131df0badbe5dea4b1bcffcc9527808852**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0069_reconcile_table_shells_a_1.sql.
- [ ] Required objects verified: tables:public..academic_assessment_types.; sequences:public.academic_assessment_types.academic_assessment_types_id_seq.; tables:public..academic_assessments.; sequences:public.academic_assessments.academic_assessments_id_seq.; tables:public..academic_assignments.; sequences:public.academic_assignments.academic_assignments_id_seq.; tables:public..academic_grading_rules.; sequences:public.academic_grading_rules.academic_grading_rules_id_seq.; tables:public..academic_report_card_lines.; sequences:public.academic_report_card_lines.academic_report_card_lines_id_seq.; tables:public..academic_report_cards.; sequences:public.academic_report_cards.academic_report_cards_id_seq.; tables:public..academic_sessions.; sequences:public.academic_sessions.academic_sessions_id_seq.; tables:public..academic_terms.; sequences:public.academic_terms.academic_terms_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **1**; IDs 100. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.academic_assessment_types.id. | ALTER TABLE public."academic_assessment_types" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.academic_assessment_types.school_id. | ALTER TABLE public."academic_assessment_types" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.academic_assessment_types.name. | ALTER TABLE public."academic_assessment_types" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.academic_assessment_types.code. | ALTER TABLE public."academic_assessment_types" ADD COLUMN "code" text NOT NULL |
| columns | columns:public.academic_assessment_types.status. | ALTER TABLE public."academic_assessment_types" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.academic_assessments.id. | ALTER TABLE public."academic_assessments" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.academic_assessments.school_id. | ALTER TABLE public."academic_assessments" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.academic_assessments.academic_session_id. | ALTER TABLE public."academic_assessments" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.academic_assessments.academic_term_id. | ALTER TABLE public."academic_assessments" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.academic_assessments.school_class_id. | ALTER TABLE public."academic_assessments" ADD COLUMN "school_class_id" integer NOT NULL |
| columns | columns:public.academic_assessments.section. | ALTER TABLE public."academic_assessments" ADD COLUMN "section" text |
| columns | columns:public.academic_assessments.subject_id. | ALTER TABLE public."academic_assessments" ADD COLUMN "subject_id" integer NOT NULL |
| columns | columns:public.academic_assessments.assessment_type_id. | ALTER TABLE public."academic_assessments" ADD COLUMN "assessment_type_id" integer NOT NULL |
| columns | columns:public.academic_assessments.teacher_employee_id. | ALTER TABLE public."academic_assessments" ADD COLUMN "teacher_employee_id" integer NOT NULL |
| columns | columns:public.academic_assessments.created_by. | ALTER TABLE public."academic_assessments" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.academic_assessments.title. | ALTER TABLE public."academic_assessments" ADD COLUMN "title" text NOT NULL |
| columns | columns:public.academic_assessments.description. | ALTER TABLE public."academic_assessments" ADD COLUMN "description" text NOT NULL |
| columns | columns:public.academic_assessments.assessment_date. | ALTER TABLE public."academic_assessments" ADD COLUMN "assessment_date" date NOT NULL |
| columns | columns:public.academic_assessments.max_score. | ALTER TABLE public."academic_assessments" ADD COLUMN "max_score" numeric(10,2) NOT NULL |
| columns | columns:public.academic_assessments.status. | ALTER TABLE public."academic_assessments" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.academic_assessments.created_at. | ALTER TABLE public."academic_assessments" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_assessments.updated_at. | ALTER TABLE public."academic_assessments" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_assignments.id. | ALTER TABLE public."academic_assignments" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.academic_assignments.school_id. | ALTER TABLE public."academic_assignments" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.academic_assignments.academic_session_id. | ALTER TABLE public."academic_assignments" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.academic_assignments.academic_term_id. | ALTER TABLE public."academic_assignments" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.academic_assignments.school_class_id. | ALTER TABLE public."academic_assignments" ADD COLUMN "school_class_id" integer NOT NULL |
| columns | columns:public.academic_assignments.section. | ALTER TABLE public."academic_assignments" ADD COLUMN "section" text |
| columns | columns:public.academic_assignments.subject_id. | ALTER TABLE public."academic_assignments" ADD COLUMN "subject_id" integer NOT NULL |
| columns | columns:public.academic_assignments.teacher_employee_id. | ALTER TABLE public."academic_assignments" ADD COLUMN "teacher_employee_id" integer NOT NULL |
| columns | columns:public.academic_assignments.created_by. | ALTER TABLE public."academic_assignments" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.academic_assignments.title. | ALTER TABLE public."academic_assignments" ADD COLUMN "title" text NOT NULL |
| columns | columns:public.academic_assignments.description. | ALTER TABLE public."academic_assignments" ADD COLUMN "description" text NOT NULL |
| columns | columns:public.academic_assignments.issue_date. | ALTER TABLE public."academic_assignments" ADD COLUMN "issue_date" date NOT NULL |
| columns | columns:public.academic_assignments.due_date. | ALTER TABLE public."academic_assignments" ADD COLUMN "due_date" date NOT NULL |
| columns | columns:public.academic_assignments.max_score. | ALTER TABLE public."academic_assignments" ADD COLUMN "max_score" numeric(10,2) NOT NULL |
| columns | columns:public.academic_assignments.status. | ALTER TABLE public."academic_assignments" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.academic_assignments.created_at. | ALTER TABLE public."academic_assignments" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_assignments.updated_at. | ALTER TABLE public."academic_assignments" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_grading_rules.id. | ALTER TABLE public."academic_grading_rules" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.academic_grading_rules.school_id. | ALTER TABLE public."academic_grading_rules" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.academic_grading_rules.min_score. | ALTER TABLE public."academic_grading_rules" ADD COLUMN "min_score" numeric(10,2) NOT NULL |
| columns | columns:public.academic_grading_rules.max_score. | ALTER TABLE public."academic_grading_rules" ADD COLUMN "max_score" numeric(10,2) NOT NULL |
| columns | columns:public.academic_grading_rules.grade. | ALTER TABLE public."academic_grading_rules" ADD COLUMN "grade" text NOT NULL |
| columns | columns:public.academic_grading_rules.grade_point. | ALTER TABLE public."academic_grading_rules" ADD COLUMN "grade_point" numeric(5,2) |
| columns | columns:public.academic_grading_rules.remark. | ALTER TABLE public."academic_grading_rules" ADD COLUMN "remark" text NOT NULL |
| columns | columns:public.academic_grading_rules.status. | ALTER TABLE public."academic_grading_rules" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.academic_grading_rules.created_at. | ALTER TABLE public."academic_grading_rules" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_grading_rules.updated_at. | ALTER TABLE public."academic_grading_rules" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_report_card_lines.id. | ALTER TABLE public."academic_report_card_lines" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.academic_report_card_lines.school_id. | ALTER TABLE public."academic_report_card_lines" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.academic_report_card_lines.report_card_id. | ALTER TABLE public."academic_report_card_lines" ADD COLUMN "report_card_id" integer NOT NULL |
| columns | columns:public.academic_report_card_lines.result_id. | ALTER TABLE public."academic_report_card_lines" ADD COLUMN "result_id" integer NOT NULL |
| columns | columns:public.academic_report_card_lines.subject_id. | ALTER TABLE public."academic_report_card_lines" ADD COLUMN "subject_id" integer NOT NULL |
| columns | columns:public.academic_report_card_lines.subject_name_snapshot. | ALTER TABLE public."academic_report_card_lines" ADD COLUMN "subject_name_snapshot" text NOT NULL |
| columns | columns:public.academic_report_card_lines.assessment_name_snapshot. | ALTER TABLE public."academic_report_card_lines" ADD COLUMN "assessment_name_snapshot" text NOT NULL |
| columns | columns:public.academic_report_card_lines.score. | ALTER TABLE public."academic_report_card_lines" ADD COLUMN "score" numeric(10,2) NOT NULL |
| columns | columns:public.academic_report_card_lines.max_score. | ALTER TABLE public."academic_report_card_lines" ADD COLUMN "max_score" numeric(10,2) NOT NULL |
| columns | columns:public.academic_report_card_lines.grade. | ALTER TABLE public."academic_report_card_lines" ADD COLUMN "grade" text NOT NULL |
| columns | columns:public.academic_report_card_lines.grade_point. | ALTER TABLE public."academic_report_card_lines" ADD COLUMN "grade_point" numeric(5,2) NOT NULL |
| columns | columns:public.academic_report_card_lines.remark. | ALTER TABLE public."academic_report_card_lines" ADD COLUMN "remark" text NOT NULL |
| columns | columns:public.academic_report_cards.id. | ALTER TABLE public."academic_report_cards" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.academic_report_cards.school_id. | ALTER TABLE public."academic_report_cards" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.academic_report_cards.student_id. | ALTER TABLE public."academic_report_cards" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.academic_report_cards.academic_session_id. | ALTER TABLE public."academic_report_cards" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.academic_report_cards.academic_term_id. | ALTER TABLE public."academic_report_cards" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.academic_report_cards.student_class_assignment_id. | ALTER TABLE public."academic_report_cards" ADD COLUMN "student_class_assignment_id" integer NOT NULL |
| columns | columns:public.academic_report_cards.school_class_id. | ALTER TABLE public."academic_report_cards" ADD COLUMN "school_class_id" integer NOT NULL |
| columns | columns:public.academic_report_cards.class_name_snapshot. | ALTER TABLE public."academic_report_cards" ADD COLUMN "class_name_snapshot" text NOT NULL |
| columns | columns:public.academic_report_cards.section_snapshot. | ALTER TABLE public."academic_report_cards" ADD COLUMN "section_snapshot" text NOT NULL |
| columns | columns:public.academic_report_cards.status. | ALTER TABLE public."academic_report_cards" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.academic_report_cards.teacher_remark. | ALTER TABLE public."academic_report_cards" ADD COLUMN "teacher_remark" text NOT NULL |
| columns | columns:public.academic_report_cards.school_remark. | ALTER TABLE public."academic_report_cards" ADD COLUMN "school_remark" text NOT NULL |
| columns | columns:public.academic_report_cards.published_by. | ALTER TABLE public."academic_report_cards" ADD COLUMN "published_by" integer |
| columns | columns:public.academic_report_cards.published_at. | ALTER TABLE public."academic_report_cards" ADD COLUMN "published_at" timestamp with time zone |
| columns | columns:public.academic_report_cards.created_at. | ALTER TABLE public."academic_report_cards" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_report_cards.updated_at. | ALTER TABLE public."academic_report_cards" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_sessions.id. | ALTER TABLE public."academic_sessions" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.academic_sessions.school_id. | ALTER TABLE public."academic_sessions" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.academic_sessions.name. | ALTER TABLE public."academic_sessions" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.academic_sessions.start_date. | ALTER TABLE public."academic_sessions" ADD COLUMN "start_date" date NOT NULL |
| columns | columns:public.academic_sessions.end_date. | ALTER TABLE public."academic_sessions" ADD COLUMN "end_date" date NOT NULL |
| columns | columns:public.academic_sessions.status. | ALTER TABLE public."academic_sessions" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.academic_sessions.is_current. | ALTER TABLE public."academic_sessions" ADD COLUMN "is_current" boolean NOT NULL |
| columns | columns:public.academic_sessions.created_at. | ALTER TABLE public."academic_sessions" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_sessions.updated_at. | ALTER TABLE public."academic_sessions" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_sessions.created_by. | ALTER TABLE public."academic_sessions" ADD COLUMN "created_by" integer |
| columns | columns:public.academic_terms.id. | ALTER TABLE public."academic_terms" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.academic_terms.school_id. | ALTER TABLE public."academic_terms" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.academic_terms.academic_session_id. | ALTER TABLE public."academic_terms" ADD COLUMN "academic_session_id" integer NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.academic_assessment_types; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_assessments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_assignments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_grading_rules; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_report_card_lines; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_report_cards; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_sessions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_terms; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs 100
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0079_reconcile_columns_a_2.sql

- [ ] Hash matches **9d48515f92845e42e7846ed66cab41bf2ada49cb6c5d334d25c69c0af9453ff9**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0069_reconcile_table_shells_a_1.sql.
- [ ] Required objects verified: tables:public..academic_terms.; tables:public..academic_timetable_entries.; sequences:public.academic_timetable_entries.academic_timetable_entries_id_seq.; tables:public..app_users.; sequences:public.app_users.app_users_id_seq.; tables:public..attendance_corrections.; sequences:public.attendance_corrections.attendance_corrections_id_seq.; tables:public..attendance_notification_events.; sequences:public.attendance_notification_events.attendance_notification_events_id_seq.; tables:public..attendance_settings.; sequences:public.attendance_settings.attendance_settings_id_seq.; tables:public..audit_logs.; sequences:public.audit_logs.audit_logs_id_seq.; tables:public..biometric_enrollments.; sequences:public.biometric_enrollments.biometric_enrollments_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **1**; IDs 106. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.academic_terms.name. | ALTER TABLE public."academic_terms" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.academic_terms.start_date. | ALTER TABLE public."academic_terms" ADD COLUMN "start_date" date NOT NULL |
| columns | columns:public.academic_terms.end_date. | ALTER TABLE public."academic_terms" ADD COLUMN "end_date" date NOT NULL |
| columns | columns:public.academic_terms.status. | ALTER TABLE public."academic_terms" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.academic_terms.is_current. | ALTER TABLE public."academic_terms" ADD COLUMN "is_current" boolean NOT NULL |
| columns | columns:public.academic_terms.created_at. | ALTER TABLE public."academic_terms" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_terms.updated_at. | ALTER TABLE public."academic_terms" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_terms.created_by. | ALTER TABLE public."academic_terms" ADD COLUMN "created_by" integer |
| columns | columns:public.academic_timetable_entries.id. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.academic_timetable_entries.school_id. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.academic_timetable_entries.academic_session_id. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.academic_timetable_entries.academic_term_id. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.academic_timetable_entries.school_class_id. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "school_class_id" integer NOT NULL |
| columns | columns:public.academic_timetable_entries.section. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "section" text NOT NULL |
| columns | columns:public.academic_timetable_entries.subject_id. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "subject_id" integer NOT NULL |
| columns | columns:public.academic_timetable_entries.teacher_employee_id. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "teacher_employee_id" integer NOT NULL |
| columns | columns:public.academic_timetable_entries.weekday. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "weekday" text NOT NULL |
| columns | columns:public.academic_timetable_entries.start_time. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "start_time" time without time zone NOT NULL |
| columns | columns:public.academic_timetable_entries.end_time. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "end_time" time without time zone NOT NULL |
| columns | columns:public.academic_timetable_entries.room. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "room" text |
| columns | columns:public.academic_timetable_entries.status. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.academic_timetable_entries.created_by. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.academic_timetable_entries.created_at. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_timetable_entries.updated_at. | ALTER TABLE public."academic_timetable_entries" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.app_users.id. | ALTER TABLE public."app_users" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.app_users.clerk_user_id. | ALTER TABLE public."app_users" ADD COLUMN "clerk_user_id" text NOT NULL |
| columns | columns:public.app_users.email. | ALTER TABLE public."app_users" ADD COLUMN "email" text NOT NULL |
| columns | columns:public.app_users.first_name. | ALTER TABLE public."app_users" ADD COLUMN "first_name" text |
| columns | columns:public.app_users.last_name. | ALTER TABLE public."app_users" ADD COLUMN "last_name" text |
| columns | columns:public.app_users.phone. | ALTER TABLE public."app_users" ADD COLUMN "phone" text |
| columns | columns:public.app_users.status. | ALTER TABLE public."app_users" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.app_users.created_at. | ALTER TABLE public."app_users" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.app_users.updated_at. | ALTER TABLE public."app_users" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.attendance_corrections.id. | ALTER TABLE public."attendance_corrections" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.attendance_corrections.school_id. | ALTER TABLE public."attendance_corrections" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.attendance_corrections.attendance_event_id. | ALTER TABLE public."attendance_corrections" ADD COLUMN "attendance_event_id" integer NOT NULL |
| columns | columns:public.attendance_corrections.original_value. | ALTER TABLE public."attendance_corrections" ADD COLUMN "original_value" jsonb NOT NULL |
| columns | columns:public.attendance_corrections.corrected_value. | ALTER TABLE public."attendance_corrections" ADD COLUMN "corrected_value" jsonb NOT NULL |
| columns | columns:public.attendance_corrections.reason. | ALTER TABLE public."attendance_corrections" ADD COLUMN "reason" text NOT NULL |
| columns | columns:public.attendance_corrections.actor_user_id. | ALTER TABLE public."attendance_corrections" ADD COLUMN "actor_user_id" integer NOT NULL |
| columns | columns:public.attendance_corrections.created_at. | ALTER TABLE public."attendance_corrections" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.attendance_notification_events.id. | ALTER TABLE public."attendance_notification_events" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.attendance_notification_events.school_id. | ALTER TABLE public."attendance_notification_events" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.attendance_notification_events.attendance_event_id. | ALTER TABLE public."attendance_notification_events" ADD COLUMN "attendance_event_id" integer |
| columns | columns:public.attendance_notification_events.discrepancy_id. | ALTER TABLE public."attendance_notification_events" ADD COLUMN "discrepancy_id" integer |
| columns | columns:public.attendance_notification_events.notification_type. | ALTER TABLE public."attendance_notification_events" ADD COLUMN "notification_type" text NOT NULL |
| columns | columns:public.attendance_notification_events.channel. | ALTER TABLE public."attendance_notification_events" ADD COLUMN "channel" text NOT NULL |
| columns | columns:public.attendance_notification_events.status. | ALTER TABLE public."attendance_notification_events" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.attendance_notification_events.recipient_user_id. | ALTER TABLE public."attendance_notification_events" ADD COLUMN "recipient_user_id" integer |
| columns | columns:public.attendance_notification_events.payload. | ALTER TABLE public."attendance_notification_events" ADD COLUMN "payload" jsonb |
| columns | columns:public.attendance_notification_events.sent_at. | ALTER TABLE public."attendance_notification_events" ADD COLUMN "sent_at" timestamp with time zone |
| columns | columns:public.attendance_notification_events.created_at. | ALTER TABLE public."attendance_notification_events" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.attendance_settings.id. | ALTER TABLE public."attendance_settings" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.attendance_settings.school_id. | ALTER TABLE public."attendance_settings" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.attendance_settings.entry_window_start. | ALTER TABLE public."attendance_settings" ADD COLUMN "entry_window_start" time without time zone |
| columns | columns:public.attendance_settings.entry_window_end. | ALTER TABLE public."attendance_settings" ADD COLUMN "entry_window_end" time without time zone |
| columns | columns:public.attendance_settings.exit_window_start. | ALTER TABLE public."attendance_settings" ADD COLUMN "exit_window_start" time without time zone |
| columns | columns:public.attendance_settings.exit_window_end. | ALTER TABLE public."attendance_settings" ADD COLUMN "exit_window_end" time without time zone |
| columns | columns:public.attendance_settings.classroom_window_start. | ALTER TABLE public."attendance_settings" ADD COLUMN "classroom_window_start" time without time zone |
| columns | columns:public.attendance_settings.classroom_window_end. | ALTER TABLE public."attendance_settings" ADD COLUMN "classroom_window_end" time without time zone |
| columns | columns:public.attendance_settings.duplicate_suppression_seconds. | ALTER TABLE public."attendance_settings" ADD COLUMN "duplicate_suppression_seconds" integer NOT NULL |
| columns | columns:public.attendance_settings.notify_on_entry. | ALTER TABLE public."attendance_settings" ADD COLUMN "notify_on_entry" boolean NOT NULL |
| columns | columns:public.attendance_settings.notify_on_exit. | ALTER TABLE public."attendance_settings" ADD COLUMN "notify_on_exit" boolean NOT NULL |
| columns | columns:public.attendance_settings.notify_on_discrepancy. | ALTER TABLE public."attendance_settings" ADD COLUMN "notify_on_discrepancy" boolean NOT NULL |
| columns | columns:public.attendance_settings.created_at. | ALTER TABLE public."attendance_settings" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.attendance_settings.updated_at. | ALTER TABLE public."attendance_settings" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.audit_logs.id. | ALTER TABLE public."audit_logs" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.audit_logs.user. | ALTER TABLE public."audit_logs" ADD COLUMN "user" text NOT NULL |
| columns | columns:public.audit_logs.role. | ALTER TABLE public."audit_logs" ADD COLUMN "role" text NOT NULL |
| columns | columns:public.audit_logs.actor_user_id. | ALTER TABLE public."audit_logs" ADD COLUMN "actor_user_id" integer |
| columns | columns:public.audit_logs.clerk_user_id. | ALTER TABLE public."audit_logs" ADD COLUMN "clerk_user_id" text |
| columns | columns:public.audit_logs.school_id. | ALTER TABLE public."audit_logs" ADD COLUMN "school_id" integer |
| columns | columns:public.audit_logs.action. | ALTER TABLE public."audit_logs" ADD COLUMN "action" text NOT NULL |
| columns | columns:public.audit_logs.module. | ALTER TABLE public."audit_logs" ADD COLUMN "module" text NOT NULL |
| columns | columns:public.audit_logs.record_id. | ALTER TABLE public."audit_logs" ADD COLUMN "record_id" integer |
| columns | columns:public.audit_logs.timestamp. | ALTER TABLE public."audit_logs" ADD COLUMN "timestamp" timestamp with time zone NOT NULL |
| columns | columns:public.audit_logs.severity. | ALTER TABLE public."audit_logs" ADD COLUMN "severity" text NOT NULL |
| columns | columns:public.audit_logs.event_type. | ALTER TABLE public."audit_logs" ADD COLUMN "event_type" text NOT NULL |
| columns | columns:public.audit_logs.result. | ALTER TABLE public."audit_logs" ADD COLUMN "result" text NOT NULL |
| columns | columns:public.audit_logs.metadata. | ALTER TABLE public."audit_logs" ADD COLUMN "metadata" jsonb |
| columns | columns:public.biometric_enrollments.id. | ALTER TABLE public."biometric_enrollments" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.biometric_enrollments.school_id. | ALTER TABLE public."biometric_enrollments" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.biometric_enrollments.student_id. | ALTER TABLE public."biometric_enrollments" ADD COLUMN "student_id" integer |
| columns | columns:public.biometric_enrollments.employee_id. | ALTER TABLE public."biometric_enrollments" ADD COLUMN "employee_id" integer |
| columns | columns:public.biometric_enrollments.device_id. | ALTER TABLE public."biometric_enrollments" ADD COLUMN "device_id" integer |
| columns | columns:public.biometric_enrollments.provider. | ALTER TABLE public."biometric_enrollments" ADD COLUMN "provider" text NOT NULL |
| columns | columns:public.biometric_enrollments.provider_reference. | ALTER TABLE public."biometric_enrollments" ADD COLUMN "provider_reference" text NOT NULL |
| columns | columns:public.biometric_enrollments.status. | ALTER TABLE public."biometric_enrollments" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.biometric_enrollments.enrolled_at. | ALTER TABLE public."biometric_enrollments" ADD COLUMN "enrolled_at" timestamp with time zone NOT NULL |
| columns | columns:public.biometric_enrollments.revoked_at. | ALTER TABLE public."biometric_enrollments" ADD COLUMN "revoked_at" timestamp with time zone |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.academic_terms; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_timetable_entries; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.app_users; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_corrections; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_notification_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.audit_logs; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.biometric_enrollments; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs 106
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0080_reconcile_columns_a_3.sql

- [ ] Hash matches **d3bf86220897045cb542227c18b486066247b019141244c74ce59b438a2ab087**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0069_reconcile_table_shells_a_1.sql.
- [ ] Required objects verified: tables:public..biometric_enrollments.; tables:public..commission_ledger.; sequences:public.commission_ledger.commission_ledger_id_seq.; tables:public..commission_rules.; sequences:public.commission_rules.commission_rules_id_seq.; tables:public..communication_campaign_recipients.; sequences:public.communication_campaign_recipients.communication_campaign_recipients_id_seq.; tables:public..communication_preferences.; sequences:public.communication_preferences.communication_preferences_id_seq.; tables:public..device_assignment_history.; sequences:public.device_assignment_history.device_assignment_history_id_seq.; tables:public..device_credentials.; sequences:public.device_credentials.device_credentials_id_seq.; tables:public..fee_adjustments.; sequences:public.fee_adjustments.fee_adjustments_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.biometric_enrollments.metadata. | ALTER TABLE public."biometric_enrollments" ADD COLUMN "metadata" jsonb |
| columns | columns:public.commission_ledger.id. | ALTER TABLE public."commission_ledger" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.commission_ledger.partner_profile_id. | ALTER TABLE public."commission_ledger" ADD COLUMN "partner_profile_id" integer NOT NULL |
| columns | columns:public.commission_ledger.school_id. | ALTER TABLE public."commission_ledger" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.commission_ledger.student_id. | ALTER TABLE public."commission_ledger" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.commission_ledger.subscription_id. | ALTER TABLE public."commission_ledger" ADD COLUMN "subscription_id" integer NOT NULL |
| columns | columns:public.commission_ledger.commission_rule_id. | ALTER TABLE public."commission_ledger" ADD COLUMN "commission_rule_id" integer NOT NULL |
| columns | columns:public.commission_ledger.academic_session_id. | ALTER TABLE public."commission_ledger" ADD COLUMN "academic_session_id" integer |
| columns | columns:public.commission_ledger.term. | ALTER TABLE public."commission_ledger" ADD COLUMN "term" text NOT NULL |
| columns | columns:public.commission_ledger.rate. | ALTER TABLE public."commission_ledger" ADD COLUMN "rate" numeric(12,4) NOT NULL |
| columns | columns:public.commission_ledger.count. | ALTER TABLE public."commission_ledger" ADD COLUMN "count" integer NOT NULL |
| columns | columns:public.commission_ledger.amount. | ALTER TABLE public."commission_ledger" ADD COLUMN "amount" numeric(12,2) NOT NULL |
| columns | columns:public.commission_ledger.currency. | ALTER TABLE public."commission_ledger" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.commission_ledger.status. | ALTER TABLE public."commission_ledger" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.commission_ledger.payout_id. | ALTER TABLE public."commission_ledger" ADD COLUMN "payout_id" integer |
| columns | columns:public.commission_ledger.approved_at. | ALTER TABLE public."commission_ledger" ADD COLUMN "approved_at" timestamp with time zone |
| columns | columns:public.commission_ledger.payable_at. | ALTER TABLE public."commission_ledger" ADD COLUMN "payable_at" timestamp with time zone |
| columns | columns:public.commission_ledger.paid_at. | ALTER TABLE public."commission_ledger" ADD COLUMN "paid_at" timestamp with time zone |
| columns | columns:public.commission_ledger.held_at. | ALTER TABLE public."commission_ledger" ADD COLUMN "held_at" timestamp with time zone |
| columns | columns:public.commission_ledger.reversed_at. | ALTER TABLE public."commission_ledger" ADD COLUMN "reversed_at" timestamp with time zone |
| columns | columns:public.commission_ledger.cancelled_at. | ALTER TABLE public."commission_ledger" ADD COLUMN "cancelled_at" timestamp with time zone |
| columns | columns:public.commission_ledger.payment_reference. | ALTER TABLE public."commission_ledger" ADD COLUMN "payment_reference" text |
| columns | columns:public.commission_ledger.adjustment_reference. | ALTER TABLE public."commission_ledger" ADD COLUMN "adjustment_reference" text |
| columns | columns:public.commission_ledger.reversal_reference. | ALTER TABLE public."commission_ledger" ADD COLUMN "reversal_reference" text |
| columns | columns:public.commission_ledger.created_by. | ALTER TABLE public."commission_ledger" ADD COLUMN "created_by" integer |
| columns | columns:public.commission_ledger.created_at. | ALTER TABLE public."commission_ledger" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.commission_rules.id. | ALTER TABLE public."commission_rules" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.commission_rules.name. | ALTER TABLE public."commission_rules" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.commission_rules.status. | ALTER TABLE public."commission_rules" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.commission_rules.term. | ALTER TABLE public."commission_rules" ADD COLUMN "term" text |
| columns | columns:public.commission_rules.currency. | ALTER TABLE public."commission_rules" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.commission_rules.calculation_basis. | ALTER TABLE public."commission_rules" ADD COLUMN "calculation_basis" text NOT NULL |
| columns | columns:public.commission_rules.effective_at. | ALTER TABLE public."commission_rules" ADD COLUMN "effective_at" timestamp with time zone NOT NULL |
| columns | columns:public.commission_rules.ends_at. | ALTER TABLE public."commission_rules" ADD COLUMN "ends_at" timestamp with time zone |
| columns | columns:public.commission_rules.partner_rate. | ALTER TABLE public."commission_rules" ADD COLUMN "partner_rate" numeric(12,4) NOT NULL |
| columns | columns:public.commission_rules.allocation_total. | ALTER TABLE public."commission_rules" ADD COLUMN "allocation_total" numeric(12,2) NOT NULL |
| columns | columns:public.commission_rules.partner_amount. | ALTER TABLE public."commission_rules" ADD COLUMN "partner_amount" numeric(12,2) NOT NULL |
| columns | columns:public.commission_rules.school_amount. | ALTER TABLE public."commission_rules" ADD COLUMN "school_amount" numeric(12,2) NOT NULL |
| columns | columns:public.commission_rules.edupulse_amount. | ALTER TABLE public."commission_rules" ADD COLUMN "edupulse_amount" numeric(12,2) NOT NULL |
| columns | columns:public.commission_rules.created_at. | ALTER TABLE public."commission_rules" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_campaign_recipients.id. | ALTER TABLE public."communication_campaign_recipients" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.communication_campaign_recipients.campaign_id. | ALTER TABLE public."communication_campaign_recipients" ADD COLUMN "campaign_id" integer NOT NULL |
| columns | columns:public.communication_campaign_recipients.school_id. | ALTER TABLE public."communication_campaign_recipients" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.communication_campaign_recipients.recipient_user_id. | ALTER TABLE public."communication_campaign_recipients" ADD COLUMN "recipient_user_id" integer NOT NULL |
| columns | columns:public.communication_campaign_recipients.notification_id. | ALTER TABLE public."communication_campaign_recipients" ADD COLUMN "notification_id" integer |
| columns | columns:public.communication_campaign_recipients.status. | ALTER TABLE public."communication_campaign_recipients" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.communication_campaign_recipients.error_code. | ALTER TABLE public."communication_campaign_recipients" ADD COLUMN "error_code" text |
| columns | columns:public.communication_campaign_recipients.created_at. | ALTER TABLE public."communication_campaign_recipients" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_campaign_recipients.sent_at. | ALTER TABLE public."communication_campaign_recipients" ADD COLUMN "sent_at" timestamp with time zone |
| columns | columns:public.communication_preferences.id. | ALTER TABLE public."communication_preferences" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.communication_preferences.user_id. | ALTER TABLE public."communication_preferences" ADD COLUMN "user_id" integer NOT NULL |
| columns | columns:public.communication_preferences.school_id. | ALTER TABLE public."communication_preferences" ADD COLUMN "school_id" integer |
| columns | columns:public.communication_preferences.category. | ALTER TABLE public."communication_preferences" ADD COLUMN "category" text NOT NULL |
| columns | columns:public.communication_preferences.channel. | ALTER TABLE public."communication_preferences" ADD COLUMN "channel" text NOT NULL |
| columns | columns:public.communication_preferences.enabled. | ALTER TABLE public."communication_preferences" ADD COLUMN "enabled" boolean NOT NULL |
| columns | columns:public.communication_preferences.created_at. | ALTER TABLE public."communication_preferences" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_preferences.updated_at. | ALTER TABLE public."communication_preferences" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.device_assignment_history.id. | ALTER TABLE public."device_assignment_history" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.device_assignment_history.school_id. | ALTER TABLE public."device_assignment_history" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.device_assignment_history.device_id. | ALTER TABLE public."device_assignment_history" ADD COLUMN "device_id" integer NOT NULL |
| columns | columns:public.device_assignment_history.previous_school_id. | ALTER TABLE public."device_assignment_history" ADD COLUMN "previous_school_id" integer |
| columns | columns:public.device_assignment_history.previous_location. | ALTER TABLE public."device_assignment_history" ADD COLUMN "previous_location" text |
| columns | columns:public.device_assignment_history.location. | ALTER TABLE public."device_assignment_history" ADD COLUMN "location" text |
| columns | columns:public.device_assignment_history.action. | ALTER TABLE public."device_assignment_history" ADD COLUMN "action" text NOT NULL |
| columns | columns:public.device_assignment_history.reason. | ALTER TABLE public."device_assignment_history" ADD COLUMN "reason" text |
| columns | columns:public.device_assignment_history.actor_user_id. | ALTER TABLE public."device_assignment_history" ADD COLUMN "actor_user_id" integer |
| columns | columns:public.device_assignment_history.created_at. | ALTER TABLE public."device_assignment_history" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.device_assignment_history.new_school_id. | ALTER TABLE public."device_assignment_history" ADD COLUMN "new_school_id" integer |
| columns | columns:public.device_credentials.id. | ALTER TABLE public."device_credentials" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.device_credentials.school_id. | ALTER TABLE public."device_credentials" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.device_credentials.device_id. | ALTER TABLE public."device_credentials" ADD COLUMN "device_id" integer NOT NULL |
| columns | columns:public.device_credentials.credential_identifier. | ALTER TABLE public."device_credentials" ADD COLUMN "credential_identifier" text NOT NULL |
| columns | columns:public.device_credentials.secret_hash. | ALTER TABLE public."device_credentials" ADD COLUMN "secret_hash" text NOT NULL |
| columns | columns:public.device_credentials.status. | ALTER TABLE public."device_credentials" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.device_credentials.issued_at. | ALTER TABLE public."device_credentials" ADD COLUMN "issued_at" timestamp with time zone NOT NULL |
| columns | columns:public.device_credentials.last_used_at. | ALTER TABLE public."device_credentials" ADD COLUMN "last_used_at" timestamp with time zone |
| columns | columns:public.device_credentials.revoked_at. | ALTER TABLE public."device_credentials" ADD COLUMN "revoked_at" timestamp with time zone |
| columns | columns:public.device_credentials.expires_at. | ALTER TABLE public."device_credentials" ADD COLUMN "expires_at" timestamp with time zone |
| columns | columns:public.device_credentials.created_at. | ALTER TABLE public."device_credentials" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_adjustments.id. | ALTER TABLE public."fee_adjustments" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_adjustments.school_id. | ALTER TABLE public."fee_adjustments" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_adjustments.invoice_id. | ALTER TABLE public."fee_adjustments" ADD COLUMN "invoice_id" integer NOT NULL |
| columns | columns:public.fee_adjustments.kind. | ALTER TABLE public."fee_adjustments" ADD COLUMN "kind" text NOT NULL |
| columns | columns:public.fee_adjustments.amount_minor. | ALTER TABLE public."fee_adjustments" ADD COLUMN "amount_minor" integer NOT NULL |
| columns | columns:public.fee_adjustments.reason. | ALTER TABLE public."fee_adjustments" ADD COLUMN "reason" text NOT NULL |
| columns | columns:public.fee_adjustments.status. | ALTER TABLE public."fee_adjustments" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.fee_adjustments.requested_by. | ALTER TABLE public."fee_adjustments" ADD COLUMN "requested_by" integer NOT NULL |
| columns | columns:public.fee_adjustments.approved_by. | ALTER TABLE public."fee_adjustments" ADD COLUMN "approved_by" integer |
| columns | columns:public.fee_adjustments.approved_at. | ALTER TABLE public."fee_adjustments" ADD COLUMN "approved_at" timestamp with time zone |
| columns | columns:public.fee_adjustments.created_at. | ALTER TABLE public."fee_adjustments" ADD COLUMN "created_at" timestamp with time zone NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.biometric_enrollments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.commission_ledger; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.commission_rules; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_campaign_recipients; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_preferences; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.device_assignment_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.device_credentials; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_adjustments; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0081_reconcile_columns_a_4.sql

- [ ] Hash matches **6f37a5bc240d68cc8a7c3b98988f2969e72fcad85b72d8ce45060ecf4d2a84c1**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0069_reconcile_table_shells_a_1.sql.
- [ ] Required objects verified: tables:public..fee_adjustments.; tables:public..fee_invoice_lines.; sequences:public.fee_invoice_lines.fee_invoice_lines_id_seq.; tables:public..fee_invoice_notification_outbox.; sequences:public.fee_invoice_notification_outbox.fee_invoice_notification_outbox_id_seq.; tables:public..fee_invoice_notifications.; sequences:public.fee_invoice_notifications.fee_invoice_notifications_id_seq.; tables:public..fee_payment_notification_outbox.; sequences:public.fee_payment_notification_outbox.fee_payment_notification_outbox_id_seq.; tables:public..fee_payment_notifications.; sequences:public.fee_payment_notifications.fee_payment_notifications_id_seq.; tables:public..fee_provider_checkout_sessions.; tables:public..fee_provider_webhook_events.; sequences:public.fee_provider_webhook_events.fee_provider_webhook_events_id_seq.; tables:public..fee_receipts.; sequences:public.fee_receipts.fee_receipts_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.fee_adjustments.requested_percentage. | ALTER TABLE public."fee_adjustments" ADD COLUMN "requested_percentage" numeric(5,2) |
| columns | columns:public.fee_adjustments.approved_amount_minor. | ALTER TABLE public."fee_adjustments" ADD COLUMN "approved_amount_minor" integer |
| columns | columns:public.fee_adjustments.original_balance_minor. | ALTER TABLE public."fee_adjustments" ADD COLUMN "original_balance_minor" integer |
| columns | columns:public.fee_adjustments.resulting_balance_minor. | ALTER TABLE public."fee_adjustments" ADD COLUMN "resulting_balance_minor" integer |
| columns | columns:public.fee_invoice_lines.id. | ALTER TABLE public."fee_invoice_lines" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_invoice_lines.school_id. | ALTER TABLE public."fee_invoice_lines" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_invoice_lines.invoice_id. | ALTER TABLE public."fee_invoice_lines" ADD COLUMN "invoice_id" integer NOT NULL |
| columns | columns:public.fee_invoice_lines.category_id. | ALTER TABLE public."fee_invoice_lines" ADD COLUMN "category_id" integer |
| columns | columns:public.fee_invoice_lines.category_name_snapshot. | ALTER TABLE public."fee_invoice_lines" ADD COLUMN "category_name_snapshot" text NOT NULL |
| columns | columns:public.fee_invoice_lines.description_snapshot. | ALTER TABLE public."fee_invoice_lines" ADD COLUMN "description_snapshot" text NOT NULL |
| columns | columns:public.fee_invoice_lines.amount_minor. | ALTER TABLE public."fee_invoice_lines" ADD COLUMN "amount_minor" integer NOT NULL |
| columns | columns:public.fee_invoice_notification_outbox.id. | ALTER TABLE public."fee_invoice_notification_outbox" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_invoice_notification_outbox.school_id. | ALTER TABLE public."fee_invoice_notification_outbox" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_invoice_notification_outbox.invoice_id. | ALTER TABLE public."fee_invoice_notification_outbox" ADD COLUMN "invoice_id" integer NOT NULL |
| columns | columns:public.fee_invoice_notification_outbox.event_type. | ALTER TABLE public."fee_invoice_notification_outbox" ADD COLUMN "event_type" text NOT NULL |
| columns | columns:public.fee_invoice_notification_outbox.metadata. | ALTER TABLE public."fee_invoice_notification_outbox" ADD COLUMN "metadata" jsonb NOT NULL |
| columns | columns:public.fee_invoice_notification_outbox.attempts. | ALTER TABLE public."fee_invoice_notification_outbox" ADD COLUMN "attempts" integer NOT NULL |
| columns | columns:public.fee_invoice_notification_outbox.next_attempt_at. | ALTER TABLE public."fee_invoice_notification_outbox" ADD COLUMN "next_attempt_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_invoice_notification_outbox.last_error. | ALTER TABLE public."fee_invoice_notification_outbox" ADD COLUMN "last_error" text NOT NULL |
| columns | columns:public.fee_invoice_notification_outbox.created_at. | ALTER TABLE public."fee_invoice_notification_outbox" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_invoice_notifications.id. | ALTER TABLE public."fee_invoice_notifications" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_invoice_notifications.school_id. | ALTER TABLE public."fee_invoice_notifications" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_invoice_notifications.invoice_id. | ALTER TABLE public."fee_invoice_notifications" ADD COLUMN "invoice_id" integer NOT NULL |
| columns | columns:public.fee_invoice_notifications.recipient_user_id. | ALTER TABLE public."fee_invoice_notifications" ADD COLUMN "recipient_user_id" integer NOT NULL |
| columns | columns:public.fee_invoice_notifications.recipient_role. | ALTER TABLE public."fee_invoice_notifications" ADD COLUMN "recipient_role" text NOT NULL |
| columns | columns:public.fee_invoice_notifications.event_type. | ALTER TABLE public."fee_invoice_notifications" ADD COLUMN "event_type" text NOT NULL |
| columns | columns:public.fee_invoice_notifications.channel. | ALTER TABLE public."fee_invoice_notifications" ADD COLUMN "channel" text NOT NULL |
| columns | columns:public.fee_invoice_notifications.is_read. | ALTER TABLE public."fee_invoice_notifications" ADD COLUMN "is_read" boolean NOT NULL |
| columns | columns:public.fee_invoice_notifications.read_at. | ALTER TABLE public."fee_invoice_notifications" ADD COLUMN "read_at" timestamp with time zone |
| columns | columns:public.fee_invoice_notifications.created_at. | ALTER TABLE public."fee_invoice_notifications" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_payment_notification_outbox.id. | ALTER TABLE public."fee_payment_notification_outbox" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_payment_notification_outbox.school_id. | ALTER TABLE public."fee_payment_notification_outbox" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_payment_notification_outbox.payment_id. | ALTER TABLE public."fee_payment_notification_outbox" ADD COLUMN "payment_id" integer NOT NULL |
| columns | columns:public.fee_payment_notification_outbox.invoice_id. | ALTER TABLE public."fee_payment_notification_outbox" ADD COLUMN "invoice_id" integer NOT NULL |
| columns | columns:public.fee_payment_notification_outbox.event_type. | ALTER TABLE public."fee_payment_notification_outbox" ADD COLUMN "event_type" text NOT NULL |
| columns | columns:public.fee_payment_notification_outbox.event_reference_id. | ALTER TABLE public."fee_payment_notification_outbox" ADD COLUMN "event_reference_id" integer NOT NULL |
| columns | columns:public.fee_payment_notification_outbox.metadata. | ALTER TABLE public."fee_payment_notification_outbox" ADD COLUMN "metadata" jsonb NOT NULL |
| columns | columns:public.fee_payment_notification_outbox.attempts. | ALTER TABLE public."fee_payment_notification_outbox" ADD COLUMN "attempts" integer NOT NULL |
| columns | columns:public.fee_payment_notification_outbox.next_attempt_at. | ALTER TABLE public."fee_payment_notification_outbox" ADD COLUMN "next_attempt_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_payment_notification_outbox.last_error. | ALTER TABLE public."fee_payment_notification_outbox" ADD COLUMN "last_error" text NOT NULL |
| columns | columns:public.fee_payment_notification_outbox.created_at. | ALTER TABLE public."fee_payment_notification_outbox" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_payment_notifications.id. | ALTER TABLE public."fee_payment_notifications" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_payment_notifications.school_id. | ALTER TABLE public."fee_payment_notifications" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_payment_notifications.payment_id. | ALTER TABLE public."fee_payment_notifications" ADD COLUMN "payment_id" integer NOT NULL |
| columns | columns:public.fee_payment_notifications.invoice_id. | ALTER TABLE public."fee_payment_notifications" ADD COLUMN "invoice_id" integer NOT NULL |
| columns | columns:public.fee_payment_notifications.recipient_user_id. | ALTER TABLE public."fee_payment_notifications" ADD COLUMN "recipient_user_id" integer NOT NULL |
| columns | columns:public.fee_payment_notifications.recipient_role. | ALTER TABLE public."fee_payment_notifications" ADD COLUMN "recipient_role" text NOT NULL |
| columns | columns:public.fee_payment_notifications.event_type. | ALTER TABLE public."fee_payment_notifications" ADD COLUMN "event_type" text NOT NULL |
| columns | columns:public.fee_payment_notifications.channel. | ALTER TABLE public."fee_payment_notifications" ADD COLUMN "channel" text NOT NULL |
| columns | columns:public.fee_payment_notifications.is_read. | ALTER TABLE public."fee_payment_notifications" ADD COLUMN "is_read" boolean NOT NULL |
| columns | columns:public.fee_payment_notifications.read_at. | ALTER TABLE public."fee_payment_notifications" ADD COLUMN "read_at" timestamp with time zone |
| columns | columns:public.fee_payment_notifications.created_at. | ALTER TABLE public."fee_payment_notifications" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_payment_notifications.event_reference_id. | ALTER TABLE public."fee_payment_notifications" ADD COLUMN "event_reference_id" integer NOT NULL |
| columns | columns:public.fee_provider_checkout_sessions.payment_id. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "payment_id" integer NOT NULL |
| columns | columns:public.fee_provider_checkout_sessions.school_id. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_provider_checkout_sessions.invoice_id. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "invoice_id" integer NOT NULL |
| columns | columns:public.fee_provider_checkout_sessions.provider. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "provider" text NOT NULL |
| columns | columns:public.fee_provider_checkout_sessions.reference. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "reference" text NOT NULL |
| columns | columns:public.fee_provider_checkout_sessions.idempotency_key. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "idempotency_key" text NOT NULL |
| columns | columns:public.fee_provider_checkout_sessions.state. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "state" text NOT NULL |
| columns | columns:public.fee_provider_checkout_sessions.claim_token. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "claim_token" text |
| columns | columns:public.fee_provider_checkout_sessions.claim_expires_at. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "claim_expires_at" timestamp with time zone |
| columns | columns:public.fee_provider_checkout_sessions.checkout_url. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "checkout_url" text |
| columns | columns:public.fee_provider_checkout_sessions.provider_session_metadata. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "provider_session_metadata" jsonb NOT NULL |
| columns | columns:public.fee_provider_checkout_sessions.attempt_count. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "attempt_count" integer NOT NULL |
| columns | columns:public.fee_provider_checkout_sessions.last_error. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "last_error" text |
| columns | columns:public.fee_provider_checkout_sessions.created_at. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_provider_checkout_sessions.updated_at. | ALTER TABLE public."fee_provider_checkout_sessions" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_provider_webhook_events.id. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_provider_webhook_events.provider. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "provider" text NOT NULL |
| columns | columns:public.fee_provider_webhook_events.event_id. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "event_id" text NOT NULL |
| columns | columns:public.fee_provider_webhook_events.payment_id. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "payment_id" integer |
| columns | columns:public.fee_provider_webhook_events.school_id. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "school_id" integer |
| columns | columns:public.fee_provider_webhook_events.provider_reference. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "provider_reference" text |
| columns | columns:public.fee_provider_webhook_events.webhook_transaction_id. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "webhook_transaction_id" text |
| columns | columns:public.fee_provider_webhook_events.verified_transaction_id. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "verified_transaction_id" text |
| columns | columns:public.fee_provider_webhook_events.status. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.fee_provider_webhook_events.signature_verified. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "signature_verified" boolean NOT NULL |
| columns | columns:public.fee_provider_webhook_events.payload_sha256. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "payload_sha256" text NOT NULL |
| columns | columns:public.fee_provider_webhook_events.error_message. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "error_message" text |
| columns | columns:public.fee_provider_webhook_events.received_at. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "received_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_provider_webhook_events.updated_at. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_provider_webhook_events.resolved_at. | ALTER TABLE public."fee_provider_webhook_events" ADD COLUMN "resolved_at" timestamp with time zone |
| columns | columns:public.fee_receipts.id. | ALTER TABLE public."fee_receipts" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_receipts.school_id. | ALTER TABLE public."fee_receipts" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_receipts.payment_id. | ALTER TABLE public."fee_receipts" ADD COLUMN "payment_id" integer NOT NULL |
| columns | columns:public.fee_receipts.receipt_number. | ALTER TABLE public."fee_receipts" ADD COLUMN "receipt_number" text NOT NULL |
| columns | columns:public.fee_receipts.snapshot. | ALTER TABLE public."fee_receipts" ADD COLUMN "snapshot" jsonb NOT NULL |
| columns | columns:public.fee_receipts.created_at. | ALTER TABLE public."fee_receipts" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_receipts.invoice_id. | ALTER TABLE public."fee_receipts" ADD COLUMN "invoice_id" integer NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.fee_adjustments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoice_lines; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoice_notification_outbox; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoice_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payment_notification_outbox; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payment_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_provider_checkout_sessions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_provider_webhook_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_receipts; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0082_reconcile_columns_a_5.sql

- [ ] Hash matches **23f34c48d328183a14732aca53ae17d776a136d899a6d078d024964008835448**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0069_reconcile_table_shells_a_1.sql.
- [ ] Required objects verified: tables:public..fee_refunds.; sequences:public.fee_refunds.fee_refunds_id_seq.; tables:public..fee_school_settings.; tables:public..fee_structure_lines.; sequences:public.fee_structure_lines.fee_structure_lines_id_seq.; tables:public..fee_structures.; sequences:public.fee_structures.fee_structures_id_seq.; tables:public..library_authors.; sequences:public.library_authors.library_authors_id_seq.; tables:public..library_book_copies.; sequences:public.library_book_copies.library_book_copies_id_seq.; tables:public..library_books.; sequences:public.library_books.library_books_id_seq.; tables:public..library_categories.; sequences:public.library_categories.library_categories_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.fee_refunds.id. | ALTER TABLE public."fee_refunds" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_refunds.school_id. | ALTER TABLE public."fee_refunds" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_refunds.payment_id. | ALTER TABLE public."fee_refunds" ADD COLUMN "payment_id" integer NOT NULL |
| columns | columns:public.fee_refunds.invoice_id. | ALTER TABLE public."fee_refunds" ADD COLUMN "invoice_id" integer NOT NULL |
| columns | columns:public.fee_refunds.reference. | ALTER TABLE public."fee_refunds" ADD COLUMN "reference" text NOT NULL |
| columns | columns:public.fee_refunds.idempotency_key. | ALTER TABLE public."fee_refunds" ADD COLUMN "idempotency_key" text NOT NULL |
| columns | columns:public.fee_refunds.amount_minor. | ALTER TABLE public."fee_refunds" ADD COLUMN "amount_minor" integer NOT NULL |
| columns | columns:public.fee_refunds.currency. | ALTER TABLE public."fee_refunds" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.fee_refunds.reason. | ALTER TABLE public."fee_refunds" ADD COLUMN "reason" text NOT NULL |
| columns | columns:public.fee_refunds.status. | ALTER TABLE public."fee_refunds" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.fee_refunds.requested_by. | ALTER TABLE public."fee_refunds" ADD COLUMN "requested_by" integer NOT NULL |
| columns | columns:public.fee_refunds.approved_by. | ALTER TABLE public."fee_refunds" ADD COLUMN "approved_by" integer |
| columns | columns:public.fee_refunds.evidence_reference. | ALTER TABLE public."fee_refunds" ADD COLUMN "evidence_reference" text |
| columns | columns:public.fee_refunds.reviewer_notes. | ALTER TABLE public."fee_refunds" ADD COLUMN "reviewer_notes" text |
| columns | columns:public.fee_refunds.approved_at. | ALTER TABLE public."fee_refunds" ADD COLUMN "approved_at" timestamp with time zone |
| columns | columns:public.fee_refunds.created_at. | ALTER TABLE public."fee_refunds" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_refunds.transaction_type. | ALTER TABLE public."fee_refunds" ADD COLUMN "transaction_type" text NOT NULL |
| columns | columns:public.fee_school_settings.school_id. | ALTER TABLE public."fee_school_settings" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_school_settings.partial_payments_enabled. | ALTER TABLE public."fee_school_settings" ADD COLUMN "partial_payments_enabled" boolean NOT NULL |
| columns | columns:public.fee_school_settings.updated_by. | ALTER TABLE public."fee_school_settings" ADD COLUMN "updated_by" integer |
| columns | columns:public.fee_school_settings.updated_at. | ALTER TABLE public."fee_school_settings" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_school_settings.bank_transfer_enabled. | ALTER TABLE public."fee_school_settings" ADD COLUMN "bank_transfer_enabled" boolean NOT NULL |
| columns | columns:public.fee_school_settings.bank_name. | ALTER TABLE public."fee_school_settings" ADD COLUMN "bank_name" text |
| columns | columns:public.fee_school_settings.bank_account_name. | ALTER TABLE public."fee_school_settings" ADD COLUMN "bank_account_name" text |
| columns | columns:public.fee_school_settings.bank_account_number. | ALTER TABLE public."fee_school_settings" ADD COLUMN "bank_account_number" text |
| columns | columns:public.fee_school_settings.paystack_enabled. | ALTER TABLE public."fee_school_settings" ADD COLUMN "paystack_enabled" boolean NOT NULL |
| columns | columns:public.fee_school_settings.flutterwave_enabled. | ALTER TABLE public."fee_school_settings" ADD COLUMN "flutterwave_enabled" boolean NOT NULL |
| columns | columns:public.fee_structure_lines.id. | ALTER TABLE public."fee_structure_lines" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_structure_lines.school_id. | ALTER TABLE public."fee_structure_lines" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_structure_lines.structure_id. | ALTER TABLE public."fee_structure_lines" ADD COLUMN "structure_id" integer NOT NULL |
| columns | columns:public.fee_structure_lines.category_id. | ALTER TABLE public."fee_structure_lines" ADD COLUMN "category_id" integer NOT NULL |
| columns | columns:public.fee_structure_lines.category_name_snapshot. | ALTER TABLE public."fee_structure_lines" ADD COLUMN "category_name_snapshot" text NOT NULL |
| columns | columns:public.fee_structure_lines.description_snapshot. | ALTER TABLE public."fee_structure_lines" ADD COLUMN "description_snapshot" text NOT NULL |
| columns | columns:public.fee_structure_lines.amount_minor. | ALTER TABLE public."fee_structure_lines" ADD COLUMN "amount_minor" integer NOT NULL |
| columns | columns:public.fee_structures.id. | ALTER TABLE public."fee_structures" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_structures.school_id. | ALTER TABLE public."fee_structures" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_structures.academic_session_id. | ALTER TABLE public."fee_structures" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.fee_structures.academic_term_id. | ALTER TABLE public."fee_structures" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.fee_structures.school_class_id. | ALTER TABLE public."fee_structures" ADD COLUMN "school_class_id" integer NOT NULL |
| columns | columns:public.fee_structures.section. | ALTER TABLE public."fee_structures" ADD COLUMN "section" text |
| columns | columns:public.fee_structures.version. | ALTER TABLE public."fee_structures" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.fee_structures.status. | ALTER TABLE public."fee_structures" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.fee_structures.created_by. | ALTER TABLE public."fee_structures" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.fee_structures.published_by. | ALTER TABLE public."fee_structures" ADD COLUMN "published_by" integer |
| columns | columns:public.fee_structures.published_at. | ALTER TABLE public."fee_structures" ADD COLUMN "published_at" timestamp with time zone |
| columns | columns:public.fee_structures.created_at. | ALTER TABLE public."fee_structures" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_authors.id. | ALTER TABLE public."library_authors" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.library_authors.school_id. | ALTER TABLE public."library_authors" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.library_authors.name. | ALTER TABLE public."library_authors" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.library_authors.reference. | ALTER TABLE public."library_authors" ADD COLUMN "reference" text |
| columns | columns:public.library_authors.created_by_user_id. | ALTER TABLE public."library_authors" ADD COLUMN "created_by_user_id" integer |
| columns | columns:public.library_authors.created_at. | ALTER TABLE public."library_authors" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_authors.updated_at. | ALTER TABLE public."library_authors" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_book_copies.id. | ALTER TABLE public."library_book_copies" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.library_book_copies.school_id. | ALTER TABLE public."library_book_copies" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.library_book_copies.book_id. | ALTER TABLE public."library_book_copies" ADD COLUMN "book_id" integer NOT NULL |
| columns | columns:public.library_book_copies.copy_code. | ALTER TABLE public."library_book_copies" ADD COLUMN "copy_code" text NOT NULL |
| columns | columns:public.library_book_copies.barcode. | ALTER TABLE public."library_book_copies" ADD COLUMN "barcode" text |
| columns | columns:public.library_book_copies.condition. | ALTER TABLE public."library_book_copies" ADD COLUMN "condition" text NOT NULL |
| columns | columns:public.library_book_copies.status. | ALTER TABLE public."library_book_copies" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.library_book_copies.location. | ALTER TABLE public."library_book_copies" ADD COLUMN "location" text |
| columns | columns:public.library_book_copies.acquired_on. | ALTER TABLE public."library_book_copies" ADD COLUMN "acquired_on" date |
| columns | columns:public.library_book_copies.acquisition_reference. | ALTER TABLE public."library_book_copies" ADD COLUMN "acquisition_reference" text |
| columns | columns:public.library_book_copies.created_by_user_id. | ALTER TABLE public."library_book_copies" ADD COLUMN "created_by_user_id" integer |
| columns | columns:public.library_book_copies.created_at. | ALTER TABLE public."library_book_copies" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_book_copies.updated_at. | ALTER TABLE public."library_book_copies" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_books.id. | ALTER TABLE public."library_books" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.library_books.school_id. | ALTER TABLE public."library_books" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.library_books.title. | ALTER TABLE public."library_books" ADD COLUMN "title" text NOT NULL |
| columns | columns:public.library_books.subtitle. | ALTER TABLE public."library_books" ADD COLUMN "subtitle" text |
| columns | columns:public.library_books.isbn. | ALTER TABLE public."library_books" ADD COLUMN "isbn" text |
| columns | columns:public.library_books.author_id. | ALTER TABLE public."library_books" ADD COLUMN "author_id" integer |
| columns | columns:public.library_books.publisher_id. | ALTER TABLE public."library_books" ADD COLUMN "publisher_id" integer |
| columns | columns:public.library_books.category_id. | ALTER TABLE public."library_books" ADD COLUMN "category_id" integer |
| columns | columns:public.library_books.publication_year. | ALTER TABLE public."library_books" ADD COLUMN "publication_year" integer |
| columns | columns:public.library_books.edition. | ALTER TABLE public."library_books" ADD COLUMN "edition" text |
| columns | columns:public.library_books.subject. | ALTER TABLE public."library_books" ADD COLUMN "subject" text |
| columns | columns:public.library_books.description. | ALTER TABLE public."library_books" ADD COLUMN "description" text |
| columns | columns:public.library_books.cover_reference. | ALTER TABLE public."library_books" ADD COLUMN "cover_reference" text |
| columns | columns:public.library_books.language. | ALTER TABLE public."library_books" ADD COLUMN "language" text NOT NULL |
| columns | columns:public.library_books.shelf_location. | ALTER TABLE public."library_books" ADD COLUMN "shelf_location" text |
| columns | columns:public.library_books.status. | ALTER TABLE public."library_books" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.library_books.created_by_user_id. | ALTER TABLE public."library_books" ADD COLUMN "created_by_user_id" integer |
| columns | columns:public.library_books.created_at. | ALTER TABLE public."library_books" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_books.updated_at. | ALTER TABLE public."library_books" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_categories.id. | ALTER TABLE public."library_categories" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.library_categories.school_id. | ALTER TABLE public."library_categories" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.library_categories.name. | ALTER TABLE public."library_categories" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.library_categories.description. | ALTER TABLE public."library_categories" ADD COLUMN "description" text |
| columns | columns:public.library_categories.is_active. | ALTER TABLE public."library_categories" ADD COLUMN "is_active" boolean NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.fee_refunds; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_school_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_structure_lines; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_structures; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_authors; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_book_copies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_books; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_categories; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0083_reconcile_columns_a_6.sql

- [ ] Hash matches **482f6f051a14bdd9cc9a7cae8512e5b62e442922632e51bf13a33937df66bb1b**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0069_reconcile_table_shells_a_1.sql.
- [ ] Required objects verified: tables:public..library_categories.; tables:public..library_copy_status_history.; sequences:public.library_copy_status_history.library_copy_status_history_id_seq.; tables:public..library_loans.; sequences:public.library_loans.library_loans_id_seq.; tables:public..library_publishers.; sequences:public.library_publishers.library_publishers_id_seq.; tables:public..library_renewals.; sequences:public.library_renewals.library_renewals_id_seq.; tables:public..library_settings.; tables:public..library_staff.; sequences:public.library_staff.library_staff_id_seq.; tables:public..maintenance_requests.; sequences:public.maintenance_requests.maintenance_requests_id_seq.; tables:public..nfc_card_history.; sequences:public.nfc_card_history.nfc_card_history_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.library_categories.created_by_user_id. | ALTER TABLE public."library_categories" ADD COLUMN "created_by_user_id" integer |
| columns | columns:public.library_categories.created_at. | ALTER TABLE public."library_categories" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_categories.updated_at. | ALTER TABLE public."library_categories" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_copy_status_history.id. | ALTER TABLE public."library_copy_status_history" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.library_copy_status_history.school_id. | ALTER TABLE public."library_copy_status_history" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.library_copy_status_history.copy_id. | ALTER TABLE public."library_copy_status_history" ADD COLUMN "copy_id" integer NOT NULL |
| columns | columns:public.library_copy_status_history.loan_id. | ALTER TABLE public."library_copy_status_history" ADD COLUMN "loan_id" integer |
| columns | columns:public.library_copy_status_history.previous_status. | ALTER TABLE public."library_copy_status_history" ADD COLUMN "previous_status" text NOT NULL |
| columns | columns:public.library_copy_status_history.new_status. | ALTER TABLE public."library_copy_status_history" ADD COLUMN "new_status" text NOT NULL |
| columns | columns:public.library_copy_status_history.reason. | ALTER TABLE public."library_copy_status_history" ADD COLUMN "reason" text NOT NULL |
| columns | columns:public.library_copy_status_history.notes. | ALTER TABLE public."library_copy_status_history" ADD COLUMN "notes" text |
| columns | columns:public.library_copy_status_history.changed_by_user_id. | ALTER TABLE public."library_copy_status_history" ADD COLUMN "changed_by_user_id" integer NOT NULL |
| columns | columns:public.library_copy_status_history.created_at. | ALTER TABLE public."library_copy_status_history" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_loans.id. | ALTER TABLE public."library_loans" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.library_loans.school_id. | ALTER TABLE public."library_loans" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.library_loans.book_id. | ALTER TABLE public."library_loans" ADD COLUMN "book_id" integer NOT NULL |
| columns | columns:public.library_loans.copy_id. | ALTER TABLE public."library_loans" ADD COLUMN "copy_id" integer NOT NULL |
| columns | columns:public.library_loans.borrower_type. | ALTER TABLE public."library_loans" ADD COLUMN "borrower_type" text NOT NULL |
| columns | columns:public.library_loans.borrower_user_id. | ALTER TABLE public."library_loans" ADD COLUMN "borrower_user_id" integer NOT NULL |
| columns | columns:public.library_loans.borrower_student_id. | ALTER TABLE public."library_loans" ADD COLUMN "borrower_student_id" integer |
| columns | columns:public.library_loans.issued_at. | ALTER TABLE public."library_loans" ADD COLUMN "issued_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_loans.due_on. | ALTER TABLE public."library_loans" ADD COLUMN "due_on" date NOT NULL |
| columns | columns:public.library_loans.returned_at. | ALTER TABLE public."library_loans" ADD COLUMN "returned_at" timestamp with time zone |
| columns | columns:public.library_loans.returned_overdue. | ALTER TABLE public."library_loans" ADD COLUMN "returned_overdue" boolean |
| columns | columns:public.library_loans.days_overdue_at_return. | ALTER TABLE public."library_loans" ADD COLUMN "days_overdue_at_return" integer |
| columns | columns:public.library_loans.status. | ALTER TABLE public."library_loans" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.library_loans.issued_by_user_id. | ALTER TABLE public."library_loans" ADD COLUMN "issued_by_user_id" integer NOT NULL |
| columns | columns:public.library_loans.returned_by_user_id. | ALTER TABLE public."library_loans" ADD COLUMN "returned_by_user_id" integer |
| columns | columns:public.library_loans.renewal_count. | ALTER TABLE public."library_loans" ADD COLUMN "renewal_count" integer NOT NULL |
| columns | columns:public.library_loans.idempotency_key. | ALTER TABLE public."library_loans" ADD COLUMN "idempotency_key" text |
| columns | columns:public.library_loans.notes. | ALTER TABLE public."library_loans" ADD COLUMN "notes" text |
| columns | columns:public.library_loans.created_at. | ALTER TABLE public."library_loans" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_loans.updated_at. | ALTER TABLE public."library_loans" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_publishers.id. | ALTER TABLE public."library_publishers" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.library_publishers.school_id. | ALTER TABLE public."library_publishers" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.library_publishers.name. | ALTER TABLE public."library_publishers" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.library_publishers.reference. | ALTER TABLE public."library_publishers" ADD COLUMN "reference" text |
| columns | columns:public.library_publishers.created_by_user_id. | ALTER TABLE public."library_publishers" ADD COLUMN "created_by_user_id" integer |
| columns | columns:public.library_publishers.created_at. | ALTER TABLE public."library_publishers" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_publishers.updated_at. | ALTER TABLE public."library_publishers" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_renewals.id. | ALTER TABLE public."library_renewals" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.library_renewals.school_id. | ALTER TABLE public."library_renewals" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.library_renewals.loan_id. | ALTER TABLE public."library_renewals" ADD COLUMN "loan_id" integer NOT NULL |
| columns | columns:public.library_renewals.renewed_by_user_id. | ALTER TABLE public."library_renewals" ADD COLUMN "renewed_by_user_id" integer NOT NULL |
| columns | columns:public.library_renewals.previous_due_on. | ALTER TABLE public."library_renewals" ADD COLUMN "previous_due_on" date NOT NULL |
| columns | columns:public.library_renewals.new_due_on. | ALTER TABLE public."library_renewals" ADD COLUMN "new_due_on" date NOT NULL |
| columns | columns:public.library_renewals.idempotency_key. | ALTER TABLE public."library_renewals" ADD COLUMN "idempotency_key" text NOT NULL |
| columns | columns:public.library_renewals.created_at. | ALTER TABLE public."library_renewals" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_settings.school_id. | ALTER TABLE public."library_settings" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.library_settings.student_borrowing_enabled. | ALTER TABLE public."library_settings" ADD COLUMN "student_borrowing_enabled" boolean NOT NULL |
| columns | columns:public.library_settings.teacher_borrowing_enabled. | ALTER TABLE public."library_settings" ADD COLUMN "teacher_borrowing_enabled" boolean NOT NULL |
| columns | columns:public.library_settings.staff_borrowing_enabled. | ALTER TABLE public."library_settings" ADD COLUMN "staff_borrowing_enabled" boolean NOT NULL |
| columns | columns:public.library_settings.max_books_per_student. | ALTER TABLE public."library_settings" ADD COLUMN "max_books_per_student" integer NOT NULL |
| columns | columns:public.library_settings.max_books_per_teacher. | ALTER TABLE public."library_settings" ADD COLUMN "max_books_per_teacher" integer NOT NULL |
| columns | columns:public.library_settings.max_books_per_staff. | ALTER TABLE public."library_settings" ADD COLUMN "max_books_per_staff" integer NOT NULL |
| columns | columns:public.library_settings.student_loan_days. | ALTER TABLE public."library_settings" ADD COLUMN "student_loan_days" integer NOT NULL |
| columns | columns:public.library_settings.teacher_loan_days. | ALTER TABLE public."library_settings" ADD COLUMN "teacher_loan_days" integer NOT NULL |
| columns | columns:public.library_settings.staff_loan_days. | ALTER TABLE public."library_settings" ADD COLUMN "staff_loan_days" integer NOT NULL |
| columns | columns:public.library_settings.max_renewals. | ALTER TABLE public."library_settings" ADD COLUMN "max_renewals" integer NOT NULL |
| columns | columns:public.library_settings.renewal_requires_not_overdue. | ALTER TABLE public."library_settings" ADD COLUMN "renewal_requires_not_overdue" boolean NOT NULL |
| columns | columns:public.library_settings.fines_enabled. | ALTER TABLE public."library_settings" ADD COLUMN "fines_enabled" boolean NOT NULL |
| columns | columns:public.library_settings.updated_by_user_id. | ALTER TABLE public."library_settings" ADD COLUMN "updated_by_user_id" integer |
| columns | columns:public.library_settings.updated_at. | ALTER TABLE public."library_settings" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_staff.id. | ALTER TABLE public."library_staff" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.library_staff.school_id. | ALTER TABLE public."library_staff" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.library_staff.user_id. | ALTER TABLE public."library_staff" ADD COLUMN "user_id" integer NOT NULL |
| columns | columns:public.library_staff.can_manage_catalogue. | ALTER TABLE public."library_staff" ADD COLUMN "can_manage_catalogue" boolean NOT NULL |
| columns | columns:public.library_staff.is_active. | ALTER TABLE public."library_staff" ADD COLUMN "is_active" boolean NOT NULL |
| columns | columns:public.library_staff.assigned_by_user_id. | ALTER TABLE public."library_staff" ADD COLUMN "assigned_by_user_id" integer |
| columns | columns:public.library_staff.created_at. | ALTER TABLE public."library_staff" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.library_staff.updated_at. | ALTER TABLE public."library_staff" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.maintenance_requests.id. | ALTER TABLE public."maintenance_requests" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.maintenance_requests.school_id. | ALTER TABLE public."maintenance_requests" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.maintenance_requests.category_id. | ALTER TABLE public."maintenance_requests" ADD COLUMN "category_id" integer |
| columns | columns:public.maintenance_requests.category_type. | ALTER TABLE public."maintenance_requests" ADD COLUMN "category_type" text NOT NULL |
| columns | columns:public.maintenance_requests.asset_id. | ALTER TABLE public."maintenance_requests" ADD COLUMN "asset_id" integer |
| columns | columns:public.maintenance_requests.title. | ALTER TABLE public."maintenance_requests" ADD COLUMN "title" text NOT NULL |
| columns | columns:public.maintenance_requests.description. | ALTER TABLE public."maintenance_requests" ADD COLUMN "description" text NOT NULL |
| columns | columns:public.maintenance_requests.location. | ALTER TABLE public."maintenance_requests" ADD COLUMN "location" text |
| columns | columns:public.maintenance_requests.reported_by_user_id. | ALTER TABLE public."maintenance_requests" ADD COLUMN "reported_by_user_id" integer NOT NULL |
| columns | columns:public.maintenance_requests.assigned_to_user_id. | ALTER TABLE public."maintenance_requests" ADD COLUMN "assigned_to_user_id" integer |
| columns | columns:public.maintenance_requests.priority. | ALTER TABLE public."maintenance_requests" ADD COLUMN "priority" text NOT NULL |
| columns | columns:public.maintenance_requests.status. | ALTER TABLE public."maintenance_requests" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.maintenance_requests.reported_at. | ALTER TABLE public."maintenance_requests" ADD COLUMN "reported_at" timestamp with time zone NOT NULL |
| columns | columns:public.maintenance_requests.due_on. | ALTER TABLE public."maintenance_requests" ADD COLUMN "due_on" date |
| columns | columns:public.maintenance_requests.completed_at. | ALTER TABLE public."maintenance_requests" ADD COLUMN "completed_at" timestamp with time zone |
| columns | columns:public.maintenance_requests.notes. | ALTER TABLE public."maintenance_requests" ADD COLUMN "notes" text |
| columns | columns:public.maintenance_requests.created_at. | ALTER TABLE public."maintenance_requests" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.maintenance_requests.updated_at. | ALTER TABLE public."maintenance_requests" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.nfc_card_history.id. | ALTER TABLE public."nfc_card_history" ADD COLUMN "id" integer NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.library_categories; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_copy_status_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_loans; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_publishers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_renewals; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_staff; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.maintenance_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.nfc_card_history; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0084_reconcile_columns_a_7.sql

- [ ] Hash matches **15f5662e4de3b5b2680c8e9c48ca029e7976b5b2de50514ab86d8d25aaa537db**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0069_reconcile_table_shells_a_1.sql.
- [ ] Required objects verified: tables:public..nfc_card_history.; tables:public..nfc_cards.; sequences:public.nfc_cards.nfc_cards_id_seq.; tables:public..operational_tasks.; sequences:public.operational_tasks.operational_tasks_id_seq.; tables:public..parent_student_relationships.; sequences:public.parent_student_relationships.parent_student_relationships_id_seq.; tables:public..parents.; sequences:public.parents.parents_id_seq.; tables:public..partner_attribution_conflicts.; sequences:public.partner_attribution_conflicts.partner_attribution_conflicts_id_seq.; tables:public..partner_invitations.; sequences:public.partner_invitations.partner_invitations_id_seq.; tables:public..partner_payout_information.; sequences:public.partner_payout_information.partner_payout_information_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.nfc_card_history.school_id. | ALTER TABLE public."nfc_card_history" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.nfc_card_history.nfc_card_id. | ALTER TABLE public."nfc_card_history" ADD COLUMN "nfc_card_id" integer NOT NULL |
| columns | columns:public.nfc_card_history.student_id. | ALTER TABLE public."nfc_card_history" ADD COLUMN "student_id" integer |
| columns | columns:public.nfc_card_history.action. | ALTER TABLE public."nfc_card_history" ADD COLUMN "action" text NOT NULL |
| columns | columns:public.nfc_card_history.previous_status. | ALTER TABLE public."nfc_card_history" ADD COLUMN "previous_status" text |
| columns | columns:public.nfc_card_history.new_status. | ALTER TABLE public."nfc_card_history" ADD COLUMN "new_status" text |
| columns | columns:public.nfc_card_history.replaced_by_card_id. | ALTER TABLE public."nfc_card_history" ADD COLUMN "replaced_by_card_id" integer |
| columns | columns:public.nfc_card_history.reason. | ALTER TABLE public."nfc_card_history" ADD COLUMN "reason" text |
| columns | columns:public.nfc_card_history.actor_user_id. | ALTER TABLE public."nfc_card_history" ADD COLUMN "actor_user_id" integer |
| columns | columns:public.nfc_card_history.created_at. | ALTER TABLE public."nfc_card_history" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.nfc_cards.id. | ALTER TABLE public."nfc_cards" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.nfc_cards.school_id. | ALTER TABLE public."nfc_cards" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.nfc_cards.uid. | ALTER TABLE public."nfc_cards" ADD COLUMN "uid" text NOT NULL |
| columns | columns:public.nfc_cards.student_id. | ALTER TABLE public."nfc_cards" ADD COLUMN "student_id" integer |
| columns | columns:public.nfc_cards.status. | ALTER TABLE public."nfc_cards" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.nfc_cards.scans. | ALTER TABLE public."nfc_cards" ADD COLUMN "scans" integer NOT NULL |
| columns | columns:public.nfc_cards.last_scan. | ALTER TABLE public."nfc_cards" ADD COLUMN "last_scan" timestamp with time zone |
| columns | columns:public.nfc_cards.issued_at. | ALTER TABLE public."nfc_cards" ADD COLUMN "issued_at" timestamp with time zone |
| columns | columns:public.nfc_cards.activated_at. | ALTER TABLE public."nfc_cards" ADD COLUMN "activated_at" timestamp with time zone |
| columns | columns:public.nfc_cards.deactivated_at. | ALTER TABLE public."nfc_cards" ADD COLUMN "deactivated_at" timestamp with time zone |
| columns | columns:public.nfc_cards.expires_at. | ALTER TABLE public."nfc_cards" ADD COLUMN "expires_at" timestamp with time zone |
| columns | columns:public.nfc_cards.replaced_at. | ALTER TABLE public."nfc_cards" ADD COLUMN "replaced_at" timestamp with time zone |
| columns | columns:public.nfc_cards.replaced_by_card_id. | ALTER TABLE public."nfc_cards" ADD COLUMN "replaced_by_card_id" integer |
| columns | columns:public.nfc_cards.replaced_by_school_id. | ALTER TABLE public."nfc_cards" ADD COLUMN "replaced_by_school_id" integer |
| columns | columns:public.nfc_cards.last_device_id. | ALTER TABLE public."nfc_cards" ADD COLUMN "last_device_id" integer |
| columns | columns:public.operational_tasks.id. | ALTER TABLE public."operational_tasks" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.operational_tasks.school_id. | ALTER TABLE public."operational_tasks" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.operational_tasks.category_id. | ALTER TABLE public."operational_tasks" ADD COLUMN "category_id" integer |
| columns | columns:public.operational_tasks.category_type. | ALTER TABLE public."operational_tasks" ADD COLUMN "category_type" text NOT NULL |
| columns | columns:public.operational_tasks.title. | ALTER TABLE public."operational_tasks" ADD COLUMN "title" text NOT NULL |
| columns | columns:public.operational_tasks.description. | ALTER TABLE public."operational_tasks" ADD COLUMN "description" text |
| columns | columns:public.operational_tasks.assigned_to_user_id. | ALTER TABLE public."operational_tasks" ADD COLUMN "assigned_to_user_id" integer |
| columns | columns:public.operational_tasks.created_by_user_id. | ALTER TABLE public."operational_tasks" ADD COLUMN "created_by_user_id" integer NOT NULL |
| columns | columns:public.operational_tasks.priority. | ALTER TABLE public."operational_tasks" ADD COLUMN "priority" text NOT NULL |
| columns | columns:public.operational_tasks.status. | ALTER TABLE public."operational_tasks" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.operational_tasks.due_on. | ALTER TABLE public."operational_tasks" ADD COLUMN "due_on" date |
| columns | columns:public.operational_tasks.notes. | ALTER TABLE public."operational_tasks" ADD COLUMN "notes" text |
| columns | columns:public.operational_tasks.completed_at. | ALTER TABLE public."operational_tasks" ADD COLUMN "completed_at" timestamp with time zone |
| columns | columns:public.operational_tasks.created_at. | ALTER TABLE public."operational_tasks" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.operational_tasks.updated_at. | ALTER TABLE public."operational_tasks" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.parent_student_relationships.id. | ALTER TABLE public."parent_student_relationships" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.parent_student_relationships.parent_id. | ALTER TABLE public."parent_student_relationships" ADD COLUMN "parent_id" integer NOT NULL |
| columns | columns:public.parent_student_relationships.student_id. | ALTER TABLE public."parent_student_relationships" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.parent_student_relationships.relationship_type. | ALTER TABLE public."parent_student_relationships" ADD COLUMN "relationship_type" text NOT NULL |
| columns | columns:public.parent_student_relationships.is_primary_guardian. | ALTER TABLE public."parent_student_relationships" ADD COLUMN "is_primary_guardian" boolean NOT NULL |
| columns | columns:public.parent_student_relationships.is_emergency_contact. | ALTER TABLE public."parent_student_relationships" ADD COLUMN "is_emergency_contact" boolean NOT NULL |
| columns | columns:public.parent_student_relationships.contact_priority. | ALTER TABLE public."parent_student_relationships" ADD COLUMN "contact_priority" integer NOT NULL |
| columns | columns:public.parent_student_relationships.status. | ALTER TABLE public."parent_student_relationships" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.parent_student_relationships.created_at. | ALTER TABLE public."parent_student_relationships" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.parent_student_relationships.updated_at. | ALTER TABLE public."parent_student_relationships" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.parents.id. | ALTER TABLE public."parents" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.parents.school_id. | ALTER TABLE public."parents" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.parents.user_id. | ALTER TABLE public."parents" ADD COLUMN "user_id" integer |
| columns | columns:public.parents.name. | ALTER TABLE public."parents" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.parents.email. | ALTER TABLE public."parents" ADD COLUMN "email" text NOT NULL |
| columns | columns:public.parents.phone. | ALTER TABLE public."parents" ADD COLUMN "phone" text NOT NULL |
| columns | columns:public.parents.address. | ALTER TABLE public."parents" ADD COLUMN "address" text |
| columns | columns:public.parents.status. | ALTER TABLE public."parents" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.parents.created_at. | ALTER TABLE public."parents" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.parents.updated_at. | ALTER TABLE public."parents" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.parents.default_relationship_type. | ALTER TABLE public."parents" ADD COLUMN "default_relationship_type" text |
| columns | columns:public.parents.emergency_contact_name. | ALTER TABLE public."parents" ADD COLUMN "emergency_contact_name" text |
| columns | columns:public.parents.emergency_contact_phone. | ALTER TABLE public."parents" ADD COLUMN "emergency_contact_phone" text |
| columns | columns:public.partner_attribution_conflicts.id. | ALTER TABLE public."partner_attribution_conflicts" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.partner_attribution_conflicts.school_id. | ALTER TABLE public."partner_attribution_conflicts" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.partner_attribution_conflicts.existing_partner_profile_id. | ALTER TABLE public."partner_attribution_conflicts" ADD COLUMN "existing_partner_profile_id" integer |
| columns | columns:public.partner_attribution_conflicts.attempted_partner_profile_id. | ALTER TABLE public."partner_attribution_conflicts" ADD COLUMN "attempted_partner_profile_id" integer NOT NULL |
| columns | columns:public.partner_attribution_conflicts.referral_link_id. | ALTER TABLE public."partner_attribution_conflicts" ADD COLUMN "referral_link_id" integer |
| columns | columns:public.partner_attribution_conflicts.source. | ALTER TABLE public."partner_attribution_conflicts" ADD COLUMN "source" text NOT NULL |
| columns | columns:public.partner_attribution_conflicts.status. | ALTER TABLE public."partner_attribution_conflicts" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.partner_attribution_conflicts.metadata. | ALTER TABLE public."partner_attribution_conflicts" ADD COLUMN "metadata" jsonb |
| columns | columns:public.partner_attribution_conflicts.evidence. | ALTER TABLE public."partner_attribution_conflicts" ADD COLUMN "evidence" jsonb |
| columns | columns:public.partner_attribution_conflicts.resolved_by. | ALTER TABLE public."partner_attribution_conflicts" ADD COLUMN "resolved_by" integer |
| columns | columns:public.partner_attribution_conflicts.decision. | ALTER TABLE public."partner_attribution_conflicts" ADD COLUMN "decision" text |
| columns | columns:public.partner_attribution_conflicts.resolved_at. | ALTER TABLE public."partner_attribution_conflicts" ADD COLUMN "resolved_at" timestamp with time zone |
| columns | columns:public.partner_attribution_conflicts.created_at. | ALTER TABLE public."partner_attribution_conflicts" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.partner_invitations.id. | ALTER TABLE public."partner_invitations" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.partner_invitations.partner_profile_id. | ALTER TABLE public."partner_invitations" ADD COLUMN "partner_profile_id" integer NOT NULL |
| columns | columns:public.partner_invitations.invited_email. | ALTER TABLE public."partner_invitations" ADD COLUMN "invited_email" text NOT NULL |
| columns | columns:public.partner_invitations.token_hash. | ALTER TABLE public."partner_invitations" ADD COLUMN "token_hash" text NOT NULL |
| columns | columns:public.partner_invitations.status. | ALTER TABLE public."partner_invitations" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.partner_invitations.expires_at. | ALTER TABLE public."partner_invitations" ADD COLUMN "expires_at" timestamp with time zone |
| columns | columns:public.partner_invitations.redeemed_at. | ALTER TABLE public."partner_invitations" ADD COLUMN "redeemed_at" timestamp with time zone |
| columns | columns:public.partner_invitations.revoked_at. | ALTER TABLE public."partner_invitations" ADD COLUMN "revoked_at" timestamp with time zone |
| columns | columns:public.partner_invitations.created_by. | ALTER TABLE public."partner_invitations" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.partner_invitations.created_at. | ALTER TABLE public."partner_invitations" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.partner_payout_information.id. | ALTER TABLE public."partner_payout_information" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.partner_payout_information.partner_profile_id. | ALTER TABLE public."partner_payout_information" ADD COLUMN "partner_profile_id" integer NOT NULL |
| columns | columns:public.partner_payout_information.method. | ALTER TABLE public."partner_payout_information" ADD COLUMN "method" text NOT NULL |
| columns | columns:public.partner_payout_information.bank_name_encrypted. | ALTER TABLE public."partner_payout_information" ADD COLUMN "bank_name_encrypted" text NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.nfc_card_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.nfc_cards; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.operational_tasks; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.parent_student_relationships; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.parents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_attribution_conflicts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_invitations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_payout_information; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0085_reconcile_columns_a_8.sql

- [ ] Hash matches **f2bee2303dda8a17a260612ea36b26f45d575dbdf22a327168bf86ad6557ecca**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0069_reconcile_table_shells_a_1.sql.
- [ ] Required objects verified: tables:public..partner_payout_information.; tables:public..partner_payouts.; sequences:public.partner_payouts.partner_payouts_id_seq.; tables:public..partner_referral_links.; sequences:public.partner_referral_links.partner_referral_links_id_seq.; tables:public..platform_company_employees.; sequences:public.platform_company_employees.platform_company_employees_id_seq.; tables:public..platform_notifications.; sequences:public.platform_notifications.platform_notifications_id_seq.; tables:public..school_assets.; sequences:public.school_assets.school_assets_id_seq.; tables:public..school_classes.; sequences:public.school_classes.school_classes_id_seq.; tables:public..school_facilities.; sequences:public.school_facilities.school_facilities_id_seq.; tables:public..school_memberships.; sequences:public.school_memberships.school_memberships_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.partner_payout_information.account_name_encrypted. | ALTER TABLE public."partner_payout_information" ADD COLUMN "account_name_encrypted" text NOT NULL |
| columns | columns:public.partner_payout_information.account_number_encrypted. | ALTER TABLE public."partner_payout_information" ADD COLUMN "account_number_encrypted" text NOT NULL |
| columns | columns:public.partner_payout_information.bank_code_encrypted. | ALTER TABLE public."partner_payout_information" ADD COLUMN "bank_code_encrypted" text |
| columns | columns:public.partner_payout_information.account_last4. | ALTER TABLE public."partner_payout_information" ADD COLUMN "account_last4" text NOT NULL |
| columns | columns:public.partner_payout_information.encryption_key_version. | ALTER TABLE public."partner_payout_information" ADD COLUMN "encryption_key_version" text NOT NULL |
| columns | columns:public.partner_payout_information.status. | ALTER TABLE public."partner_payout_information" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.partner_payout_information.created_at. | ALTER TABLE public."partner_payout_information" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.partner_payout_information.updated_at. | ALTER TABLE public."partner_payout_information" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.partner_payouts.id. | ALTER TABLE public."partner_payouts" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.partner_payouts.partner_profile_id. | ALTER TABLE public."partner_payouts" ADD COLUMN "partner_profile_id" integer NOT NULL |
| columns | columns:public.partner_payouts.academic_session_id. | ALTER TABLE public."partner_payouts" ADD COLUMN "academic_session_id" integer |
| columns | columns:public.partner_payouts.term. | ALTER TABLE public."partner_payouts" ADD COLUMN "term" text |
| columns | columns:public.partner_payouts.amount. | ALTER TABLE public."partner_payouts" ADD COLUMN "amount" numeric(12,2) NOT NULL |
| columns | columns:public.partner_payouts.currency. | ALTER TABLE public."partner_payouts" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.partner_payouts.status. | ALTER TABLE public."partner_payouts" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.partner_payouts.payment_reference. | ALTER TABLE public."partner_payouts" ADD COLUMN "payment_reference" text |
| columns | columns:public.partner_payouts.payment_date. | ALTER TABLE public."partner_payouts" ADD COLUMN "payment_date" timestamp with time zone |
| columns | columns:public.partner_payouts.method. | ALTER TABLE public."partner_payouts" ADD COLUMN "method" text |
| columns | columns:public.partner_payouts.notes. | ALTER TABLE public."partner_payouts" ADD COLUMN "notes" text |
| columns | columns:public.partner_payouts.provider. | ALTER TABLE public."partner_payouts" ADD COLUMN "provider" text |
| columns | columns:public.partner_payouts.provider_reference. | ALTER TABLE public."partner_payouts" ADD COLUMN "provider_reference" text |
| columns | columns:public.partner_payouts.period_start. | ALTER TABLE public."partner_payouts" ADD COLUMN "period_start" timestamp with time zone NOT NULL |
| columns | columns:public.partner_payouts.period_end. | ALTER TABLE public."partner_payouts" ADD COLUMN "period_end" timestamp with time zone NOT NULL |
| columns | columns:public.partner_payouts.paid_at. | ALTER TABLE public."partner_payouts" ADD COLUMN "paid_at" timestamp with time zone |
| columns | columns:public.partner_payouts.reversed_at. | ALTER TABLE public."partner_payouts" ADD COLUMN "reversed_at" timestamp with time zone |
| columns | columns:public.partner_payouts.reversal_reference. | ALTER TABLE public."partner_payouts" ADD COLUMN "reversal_reference" text |
| columns | columns:public.partner_payouts.reversal_reason. | ALTER TABLE public."partner_payouts" ADD COLUMN "reversal_reason" text |
| columns | columns:public.partner_payouts.created_at. | ALTER TABLE public."partner_payouts" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.partner_referral_links.id. | ALTER TABLE public."partner_referral_links" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.partner_referral_links.partner_profile_id. | ALTER TABLE public."partner_referral_links" ADD COLUMN "partner_profile_id" integer NOT NULL |
| columns | columns:public.partner_referral_links.token_hash. | ALTER TABLE public."partner_referral_links" ADD COLUMN "token_hash" text NOT NULL |
| columns | columns:public.partner_referral_links.status. | ALTER TABLE public."partner_referral_links" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.partner_referral_links.created_by. | ALTER TABLE public."partner_referral_links" ADD COLUMN "created_by" integer |
| columns | columns:public.partner_referral_links.created_at. | ALTER TABLE public."partner_referral_links" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.partner_referral_links.revoked_at. | ALTER TABLE public."partner_referral_links" ADD COLUMN "revoked_at" timestamp with time zone |
| columns | columns:public.platform_company_employees.id. | ALTER TABLE public."platform_company_employees" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.platform_company_employees.full_name. | ALTER TABLE public."platform_company_employees" ADD COLUMN "full_name" text NOT NULL |
| columns | columns:public.platform_company_employees.email. | ALTER TABLE public."platform_company_employees" ADD COLUMN "email" text NOT NULL |
| columns | columns:public.platform_company_employees.phone. | ALTER TABLE public."platform_company_employees" ADD COLUMN "phone" text |
| columns | columns:public.platform_company_employees.job_title. | ALTER TABLE public."platform_company_employees" ADD COLUMN "job_title" text |
| columns | columns:public.platform_company_employees.status. | ALTER TABLE public."platform_company_employees" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.platform_company_employees.created_at. | ALTER TABLE public."platform_company_employees" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.platform_company_employees.updated_at. | ALTER TABLE public."platform_company_employees" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.platform_notifications.id. | ALTER TABLE public."platform_notifications" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.platform_notifications.recipient_user_id. | ALTER TABLE public."platform_notifications" ADD COLUMN "recipient_user_id" integer |
| columns | columns:public.platform_notifications.title. | ALTER TABLE public."platform_notifications" ADD COLUMN "title" text NOT NULL |
| columns | columns:public.platform_notifications.message. | ALTER TABLE public."platform_notifications" ADD COLUMN "message" text NOT NULL |
| columns | columns:public.platform_notifications.severity. | ALTER TABLE public."platform_notifications" ADD COLUMN "severity" text NOT NULL |
| columns | columns:public.platform_notifications.is_read. | ALTER TABLE public."platform_notifications" ADD COLUMN "is_read" boolean NOT NULL |
| columns | columns:public.platform_notifications.read_at. | ALTER TABLE public."platform_notifications" ADD COLUMN "read_at" timestamp with time zone |
| columns | columns:public.platform_notifications.created_at. | ALTER TABLE public."platform_notifications" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_assets.id. | ALTER TABLE public."school_assets" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_assets.school_id. | ALTER TABLE public."school_assets" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_assets.category_id. | ALTER TABLE public."school_assets" ADD COLUMN "category_id" integer |
| columns | columns:public.school_assets.category_type. | ALTER TABLE public."school_assets" ADD COLUMN "category_type" text NOT NULL |
| columns | columns:public.school_assets.asset_code. | ALTER TABLE public."school_assets" ADD COLUMN "asset_code" text |
| columns | columns:public.school_assets.name. | ALTER TABLE public."school_assets" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.school_assets.description. | ALTER TABLE public."school_assets" ADD COLUMN "description" text |
| columns | columns:public.school_assets.quantity. | ALTER TABLE public."school_assets" ADD COLUMN "quantity" integer NOT NULL |
| columns | columns:public.school_assets.unit. | ALTER TABLE public."school_assets" ADD COLUMN "unit" text NOT NULL |
| columns | columns:public.school_assets.location. | ALTER TABLE public."school_assets" ADD COLUMN "location" text |
| columns | columns:public.school_assets.condition. | ALTER TABLE public."school_assets" ADD COLUMN "condition" text NOT NULL |
| columns | columns:public.school_assets.assigned_to_user_id. | ALTER TABLE public."school_assets" ADD COLUMN "assigned_to_user_id" integer |
| columns | columns:public.school_assets.acquired_on. | ALTER TABLE public."school_assets" ADD COLUMN "acquired_on" date |
| columns | columns:public.school_assets.status. | ALTER TABLE public."school_assets" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.school_assets.notes. | ALTER TABLE public."school_assets" ADD COLUMN "notes" text |
| columns | columns:public.school_assets.created_by_user_id. | ALTER TABLE public."school_assets" ADD COLUMN "created_by_user_id" integer NOT NULL |
| columns | columns:public.school_assets.created_at. | ALTER TABLE public."school_assets" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_assets.updated_at. | ALTER TABLE public."school_assets" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_classes.id. | ALTER TABLE public."school_classes" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_classes.school_id. | ALTER TABLE public."school_classes" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_classes.name. | ALTER TABLE public."school_classes" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.school_classes.section. | ALTER TABLE public."school_classes" ADD COLUMN "section" text NOT NULL |
| columns | columns:public.school_classes.class_teacher. | ALTER TABLE public."school_classes" ADD COLUMN "class_teacher" text |
| columns | columns:public.school_classes.capacity. | ALTER TABLE public."school_classes" ADD COLUMN "capacity" integer NOT NULL |
| columns | columns:public.school_facilities.id. | ALTER TABLE public."school_facilities" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_facilities.school_id. | ALTER TABLE public."school_facilities" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_facilities.name. | ALTER TABLE public."school_facilities" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.school_facilities.facility_type. | ALTER TABLE public."school_facilities" ADD COLUMN "facility_type" text NOT NULL |
| columns | columns:public.school_facilities.location. | ALTER TABLE public."school_facilities" ADD COLUMN "location" text |
| columns | columns:public.school_facilities.condition. | ALTER TABLE public."school_facilities" ADD COLUMN "condition" text NOT NULL |
| columns | columns:public.school_facilities.capacity. | ALTER TABLE public."school_facilities" ADD COLUMN "capacity" integer |
| columns | columns:public.school_facilities.status. | ALTER TABLE public."school_facilities" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.school_facilities.notes. | ALTER TABLE public."school_facilities" ADD COLUMN "notes" text |
| columns | columns:public.school_facilities.created_by_user_id. | ALTER TABLE public."school_facilities" ADD COLUMN "created_by_user_id" integer NOT NULL |
| columns | columns:public.school_facilities.created_at. | ALTER TABLE public."school_facilities" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_facilities.updated_at. | ALTER TABLE public."school_facilities" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_memberships.id. | ALTER TABLE public."school_memberships" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_memberships.user_id. | ALTER TABLE public."school_memberships" ADD COLUMN "user_id" integer NOT NULL |
| columns | columns:public.school_memberships.school_id. | ALTER TABLE public."school_memberships" ADD COLUMN "school_id" integer |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.partner_payout_information; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_payouts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_referral_links; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.platform_company_employees; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.platform_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_assets; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_classes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_facilities; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_memberships; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0086_reconcile_columns_a_9.sql

- [ ] Hash matches **52dda91b433c3fbe82c8120415ec47b7daf30a6171a4052257bf0595648a48f7**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0069_reconcile_table_shells_a_1.sql.
- [ ] Required objects verified: tables:public..school_memberships.; tables:public..school_operations_settings.; tables:public..schools.; sequences:public.schools.schools_id_seq.; tables:public..student_identification_policies.; sequences:public.student_identification_policies.student_identification_policies_id_seq.; tables:public..students.; sequences:public.students.students_id_seq.; tables:public..subscriptions.; sequences:public.subscriptions.subscriptions_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: Only approved deterministic new-field initialization: schools.communication_defaults = '{}'::jsonb. Preserve all pre-existing values/relationships and row counts; no manual update/backfill.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.school_memberships.role. | ALTER TABLE public."school_memberships" ADD COLUMN "role" text NOT NULL |
| columns | columns:public.school_memberships.status. | ALTER TABLE public."school_memberships" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.school_memberships.created_at. | ALTER TABLE public."school_memberships" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_memberships.updated_at. | ALTER TABLE public."school_memberships" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_operations_settings.school_id. | ALTER TABLE public."school_operations_settings" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_operations_settings.default_maintenance_priority. | ALTER TABLE public."school_operations_settings" ADD COLUMN "default_maintenance_priority" text NOT NULL |
| columns | columns:public.school_operations_settings.default_task_priority. | ALTER TABLE public."school_operations_settings" ADD COLUMN "default_task_priority" text NOT NULL |
| columns | columns:public.school_operations_settings.staff_can_report_maintenance. | ALTER TABLE public."school_operations_settings" ADD COLUMN "staff_can_report_maintenance" boolean NOT NULL |
| columns | columns:public.school_operations_settings.updated_by_user_id. | ALTER TABLE public."school_operations_settings" ADD COLUMN "updated_by_user_id" integer NOT NULL |
| columns | columns:public.school_operations_settings.updated_at. | ALTER TABLE public."school_operations_settings" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.schools.id. | ALTER TABLE public."schools" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.schools.code. | ALTER TABLE public."schools" ADD COLUMN "code" text NOT NULL |
| columns | columns:public.schools.name. | ALTER TABLE public."schools" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.schools.city. | ALTER TABLE public."schools" ADD COLUMN "city" text NOT NULL |
| columns | columns:public.schools.state. | ALTER TABLE public."schools" ADD COLUMN "state" text NOT NULL |
| columns | columns:public.schools.status. | ALTER TABLE public."schools" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.schools.created_at. | ALTER TABLE public."schools" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.schools.registration_number. | ALTER TABLE public."schools" ADD COLUMN "registration_number" text |
| columns | columns:public.schools.address. | ALTER TABLE public."schools" ADD COLUMN "address" text |
| columns | columns:public.schools.lga. | ALTER TABLE public."schools" ADD COLUMN "lga" text |
| columns | columns:public.schools.phone. | ALTER TABLE public."schools" ADD COLUMN "phone" text |
| columns | columns:public.schools.email. | ALTER TABLE public."schools" ADD COLUMN "email" text |
| columns | columns:public.schools.website. | ALTER TABLE public."schools" ADD COLUMN "website" text |
| columns | columns:public.schools.logo. | ALTER TABLE public."schools" ADD COLUMN "logo" text |
| columns | columns:public.schools.school_type. | ALTER TABLE public."schools" ADD COLUMN "school_type" text |
| columns | columns:public.schools.updated_at. | ALTER TABLE public."schools" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.schools.communication_defaults. | ALTER TABLE public."schools" ADD COLUMN "communication_defaults" jsonb NOT NULL DEFAULT '{}'::jsonb |
| columns | columns:public.student_identification_policies.id. | ALTER TABLE public."student_identification_policies" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.student_identification_policies.school_id. | ALTER TABLE public."student_identification_policies" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.student_identification_policies.student_id. | ALTER TABLE public."student_identification_policies" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.student_identification_policies.policy. | ALTER TABLE public."student_identification_policies" ADD COLUMN "policy" text NOT NULL |
| columns | columns:public.student_identification_policies.effective_from. | ALTER TABLE public."student_identification_policies" ADD COLUMN "effective_from" date |
| columns | columns:public.student_identification_policies.effective_to. | ALTER TABLE public."student_identification_policies" ADD COLUMN "effective_to" date |
| columns | columns:public.student_identification_policies.status. | ALTER TABLE public."student_identification_policies" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.student_identification_policies.created_by. | ALTER TABLE public."student_identification_policies" ADD COLUMN "created_by" integer |
| columns | columns:public.student_identification_policies.created_at. | ALTER TABLE public."student_identification_policies" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_identification_policies.updated_at. | ALTER TABLE public."student_identification_policies" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.students.id. | ALTER TABLE public."students" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.students.school_id. | ALTER TABLE public."students" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.students.user_id. | ALTER TABLE public."students" ADD COLUMN "user_id" integer |
| columns | columns:public.students.admission_no. | ALTER TABLE public."students" ADD COLUMN "admission_no" text NOT NULL |
| columns | columns:public.students.first_name. | ALTER TABLE public."students" ADD COLUMN "first_name" text NOT NULL |
| columns | columns:public.students.last_name. | ALTER TABLE public."students" ADD COLUMN "last_name" text NOT NULL |
| columns | columns:public.students.gender. | ALTER TABLE public."students" ADD COLUMN "gender" text NOT NULL |
| columns | columns:public.students.class_name. | ALTER TABLE public."students" ADD COLUMN "class_name" text NOT NULL |
| columns | columns:public.students.section. | ALTER TABLE public."students" ADD COLUMN "section" text NOT NULL |
| columns | columns:public.students.parent_name. | ALTER TABLE public."students" ADD COLUMN "parent_name" text |
| columns | columns:public.students.parent_phone. | ALTER TABLE public."students" ADD COLUMN "parent_phone" text |
| columns | columns:public.students.status. | ALTER TABLE public."students" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.students.joined_at. | ALTER TABLE public."students" ADD COLUMN "joined_at" timestamp with time zone NOT NULL |
| columns | columns:public.students.middle_name. | ALTER TABLE public."students" ADD COLUMN "middle_name" text |
| columns | columns:public.students.date_of_birth. | ALTER TABLE public."students" ADD COLUMN "date_of_birth" date |
| columns | columns:public.students.photo. | ALTER TABLE public."students" ADD COLUMN "photo" text |
| columns | columns:public.students.admission_date. | ALTER TABLE public."students" ADD COLUMN "admission_date" date |
| columns | columns:public.students.admission_status. | ALTER TABLE public."students" ADD COLUMN "admission_status" text NOT NULL |
| columns | columns:public.students.previous_school. | ALTER TABLE public."students" ADD COLUMN "previous_school" text |
| columns | columns:public.students.address. | ALTER TABLE public."students" ADD COLUMN "address" text |
| columns | columns:public.students.medical_info. | ALTER TABLE public."students" ADD COLUMN "medical_info" text |
| columns | columns:public.students.emergency_contact_name. | ALTER TABLE public."students" ADD COLUMN "emergency_contact_name" text |
| columns | columns:public.students.emergency_contact_phone. | ALTER TABLE public."students" ADD COLUMN "emergency_contact_phone" text |
| columns | columns:public.students.created_at. | ALTER TABLE public."students" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.students.updated_at. | ALTER TABLE public."students" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.students.email. | ALTER TABLE public."students" ADD COLUMN "email" text |
| columns | columns:public.subscriptions.id. | ALTER TABLE public."subscriptions" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.subscriptions.school_id. | ALTER TABLE public."subscriptions" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.subscriptions.student_id. | ALTER TABLE public."subscriptions" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.subscriptions.term. | ALTER TABLE public."subscriptions" ADD COLUMN "term" text NOT NULL |
| columns | columns:public.subscriptions.amount. | ALTER TABLE public."subscriptions" ADD COLUMN "amount" numeric(12,2) NOT NULL |
| columns | columns:public.subscriptions.school_share. | ALTER TABLE public."subscriptions" ADD COLUMN "school_share" numeric(12,2) NOT NULL |
| columns | columns:public.subscriptions.edupulse_share. | ALTER TABLE public."subscriptions" ADD COLUMN "edupulse_share" numeric(12,2) NOT NULL |
| columns | columns:public.subscriptions.status. | ALTER TABLE public."subscriptions" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.subscriptions.verification_status. | ALTER TABLE public."subscriptions" ADD COLUMN "verification_status" text NOT NULL |
| columns | columns:public.subscriptions.provider. | ALTER TABLE public."subscriptions" ADD COLUMN "provider" text NOT NULL |
| columns | columns:public.subscriptions.provider_reference. | ALTER TABLE public."subscriptions" ADD COLUMN "provider_reference" text |
| columns | columns:public.subscriptions.expires_at. | ALTER TABLE public."subscriptions" ADD COLUMN "expires_at" timestamp with time zone NOT NULL |
| columns | columns:public.subscriptions.created_at. | ALTER TABLE public."subscriptions" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.subscriptions.partner_profile_id. | ALTER TABLE public."subscriptions" ADD COLUMN "partner_profile_id" integer |
| columns | columns:public.subscriptions.partner_share. | ALTER TABLE public."subscriptions" ADD COLUMN "partner_share" numeric(12,2) |
| columns | columns:public.subscriptions.allocation_snapshot. | ALTER TABLE public."subscriptions" ADD COLUMN "allocation_snapshot" jsonb |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.school_memberships; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_operations_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.schools; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_identification_policies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.students; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.subscriptions; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous
- STOP if schools.communication_defaults default/guard/old-row initializer differs from jsonb NOT NULL DEFAULT '{}'::jsonb

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0087_reconcile_columns_b_1.sql

- [ ] Hash matches **3f6276caaca6004ebcd8c948196b482c01b806d46684da8fcb4d548139253fc2**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0062_reconcile_sequences_b_1.sql, 0070_reconcile_table_shells_b_1.sql.
- [ ] Required objects verified: tables:public..partner_profile_users.; sequences:public.partner_profile_users.partner_profile_users_id_seq.; tables:public..partner_profiles.; sequences:public.partner_profiles.partner_profiles_id_seq.; tables:public..school_branding_logos.; sequences:public.school_branding_logos.school_branding_logos_id_seq.; tables:public..school_calendar_events.; sequences:public.school_calendar_events.school_calendar_events_id_seq.; tables:public..school_partner_attributions.; sequences:public.school_partner_attributions.school_partner_attributions_id_seq.; tables:public..teacher_duty_roster.; sequences:public.teacher_duty_roster.teacher_duty_roster_id_seq.; tables:public..teacher_subject_assignments.; sequences:public.teacher_subject_assignments.teacher_subject_assignments_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: Only approved deterministic new-field initialization: partner_profile_users.nfc_activation_enabled = false; partner_profiles.nfc_activation_enabled = false. Preserve all pre-existing values/relationships and row counts; no manual update/backfill.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.partner_profile_users.id. | ALTER TABLE public."partner_profile_users" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.partner_profile_users.partner_profile_id. | ALTER TABLE public."partner_profile_users" ADD COLUMN "partner_profile_id" integer NOT NULL |
| columns | columns:public.partner_profile_users.user_id. | ALTER TABLE public."partner_profile_users" ADD COLUMN "user_id" integer NOT NULL |
| columns | columns:public.partner_profile_users.role. | ALTER TABLE public."partner_profile_users" ADD COLUMN "role" text NOT NULL |
| columns | columns:public.partner_profile_users.status. | ALTER TABLE public."partner_profile_users" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.partner_profile_users.created_at. | ALTER TABLE public."partner_profile_users" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.partner_profile_users.nfc_activation_enabled. | ALTER TABLE public."partner_profile_users" ADD COLUMN "nfc_activation_enabled" boolean NOT NULL DEFAULT false |
| columns | columns:public.partner_profiles.id. | ALTER TABLE public."partner_profiles" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.partner_profiles.user_id. | ALTER TABLE public."partner_profiles" ADD COLUMN "user_id" integer |
| columns | columns:public.partner_profiles.partner_code. | ALTER TABLE public."partner_profiles" ADD COLUMN "partner_code" text NOT NULL |
| columns | columns:public.partner_profiles.type. | ALTER TABLE public."partner_profiles" ADD COLUMN "type" text NOT NULL |
| columns | columns:public.partner_profiles.full_name. | ALTER TABLE public."partner_profiles" ADD COLUMN "full_name" text NOT NULL |
| columns | columns:public.partner_profiles.business_name. | ALTER TABLE public."partner_profiles" ADD COLUMN "business_name" text |
| columns | columns:public.partner_profiles.email. | ALTER TABLE public."partner_profiles" ADD COLUMN "email" text NOT NULL |
| columns | columns:public.partner_profiles.phone. | ALTER TABLE public."partner_profiles" ADD COLUMN "phone" text |
| columns | columns:public.partner_profiles.address. | ALTER TABLE public."partner_profiles" ADD COLUMN "address" text |
| columns | columns:public.partner_profiles.state. | ALTER TABLE public."partner_profiles" ADD COLUMN "state" text |
| columns | columns:public.partner_profiles.lga. | ALTER TABLE public."partner_profiles" ADD COLUMN "lga" text |
| columns | columns:public.partner_profiles.registration_number. | ALTER TABLE public."partner_profiles" ADD COLUMN "registration_number" text |
| columns | columns:public.partner_profiles.status. | ALTER TABLE public."partner_profiles" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.partner_profiles.invited_at. | ALTER TABLE public."partner_profiles" ADD COLUMN "invited_at" timestamp with time zone |
| columns | columns:public.partner_profiles.registered_at. | ALTER TABLE public."partner_profiles" ADD COLUMN "registered_at" timestamp with time zone |
| columns | columns:public.partner_profiles.activated_at. | ALTER TABLE public."partner_profiles" ADD COLUMN "activated_at" timestamp with time zone |
| columns | columns:public.partner_profiles.deactivated_at. | ALTER TABLE public."partner_profiles" ADD COLUMN "deactivated_at" timestamp with time zone |
| columns | columns:public.partner_profiles.created_by. | ALTER TABLE public."partner_profiles" ADD COLUMN "created_by" integer |
| columns | columns:public.partner_profiles.created_at. | ALTER TABLE public."partner_profiles" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.partner_profiles.updated_at. | ALTER TABLE public."partner_profiles" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.partner_profiles.nfc_activation_enabled. | ALTER TABLE public."partner_profiles" ADD COLUMN "nfc_activation_enabled" boolean NOT NULL DEFAULT false |
| columns | columns:public.school_branding_logos.id. | ALTER TABLE public."school_branding_logos" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_branding_logos.school_id. | ALTER TABLE public."school_branding_logos" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_branding_logos.object_path. | ALTER TABLE public."school_branding_logos" ADD COLUMN "object_path" text NOT NULL |
| columns | columns:public.school_branding_logos.content_type. | ALTER TABLE public."school_branding_logos" ADD COLUMN "content_type" text NOT NULL |
| columns | columns:public.school_branding_logos.byte_size. | ALTER TABLE public."school_branding_logos" ADD COLUMN "byte_size" integer NOT NULL |
| columns | columns:public.school_branding_logos.is_current. | ALTER TABLE public."school_branding_logos" ADD COLUMN "is_current" boolean NOT NULL |
| columns | columns:public.school_branding_logos.updated_by_user_id. | ALTER TABLE public."school_branding_logos" ADD COLUMN "updated_by_user_id" integer NOT NULL |
| columns | columns:public.school_branding_logos.updated_at. | ALTER TABLE public."school_branding_logos" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_calendar_events.id. | ALTER TABLE public."school_calendar_events" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_calendar_events.school_id. | ALTER TABLE public."school_calendar_events" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_calendar_events.academic_session_id. | ALTER TABLE public."school_calendar_events" ADD COLUMN "academic_session_id" integer |
| columns | columns:public.school_calendar_events.academic_term_id. | ALTER TABLE public."school_calendar_events" ADD COLUMN "academic_term_id" integer |
| columns | columns:public.school_calendar_events.source. | ALTER TABLE public."school_calendar_events" ADD COLUMN "source" text NOT NULL |
| columns | columns:public.school_calendar_events.source_key. | ALTER TABLE public."school_calendar_events" ADD COLUMN "source_key" text NOT NULL |
| columns | columns:public.school_calendar_events.title. | ALTER TABLE public."school_calendar_events" ADD COLUMN "title" text NOT NULL |
| columns | columns:public.school_calendar_events.category. | ALTER TABLE public."school_calendar_events" ADD COLUMN "category" text NOT NULL |
| columns | columns:public.school_calendar_events.start_date. | ALTER TABLE public."school_calendar_events" ADD COLUMN "start_date" date NOT NULL |
| columns | columns:public.school_calendar_events.end_date. | ALTER TABLE public."school_calendar_events" ADD COLUMN "end_date" date |
| columns | columns:public.school_calendar_events.is_academic. | ALTER TABLE public."school_calendar_events" ADD COLUMN "is_academic" boolean NOT NULL |
| columns | columns:public.school_calendar_events.audience. | ALTER TABLE public."school_calendar_events" ADD COLUMN "audience" text[] NOT NULL |
| columns | columns:public.school_calendar_events.status. | ALTER TABLE public."school_calendar_events" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.school_calendar_events.notes. | ALTER TABLE public."school_calendar_events" ADD COLUMN "notes" text |
| columns | columns:public.school_calendar_events.created_by_user_id. | ALTER TABLE public."school_calendar_events" ADD COLUMN "created_by_user_id" integer NOT NULL |
| columns | columns:public.school_calendar_events.updated_by_user_id. | ALTER TABLE public."school_calendar_events" ADD COLUMN "updated_by_user_id" integer NOT NULL |
| columns | columns:public.school_calendar_events.created_at. | ALTER TABLE public."school_calendar_events" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_calendar_events.updated_at. | ALTER TABLE public."school_calendar_events" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_partner_attributions.id. | ALTER TABLE public."school_partner_attributions" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_partner_attributions.school_id. | ALTER TABLE public."school_partner_attributions" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_partner_attributions.partner_profile_id. | ALTER TABLE public."school_partner_attributions" ADD COLUMN "partner_profile_id" integer NOT NULL |
| columns | columns:public.school_partner_attributions.referral_link_id. | ALTER TABLE public."school_partner_attributions" ADD COLUMN "referral_link_id" integer |
| columns | columns:public.school_partner_attributions.source. | ALTER TABLE public."school_partner_attributions" ADD COLUMN "source" text NOT NULL |
| columns | columns:public.school_partner_attributions.status. | ALTER TABLE public."school_partner_attributions" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.school_partner_attributions.is_current. | ALTER TABLE public."school_partner_attributions" ADD COLUMN "is_current" boolean NOT NULL |
| columns | columns:public.school_partner_attributions.starts_at. | ALTER TABLE public."school_partner_attributions" ADD COLUMN "starts_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_partner_attributions.ends_at. | ALTER TABLE public."school_partner_attributions" ADD COLUMN "ends_at" timestamp with time zone |
| columns | columns:public.school_partner_attributions.created_by. | ALTER TABLE public."school_partner_attributions" ADD COLUMN "created_by" integer |
| columns | columns:public.school_partner_attributions.created_at. | ALTER TABLE public."school_partner_attributions" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.teacher_duty_roster.id. | ALTER TABLE public."teacher_duty_roster" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.teacher_duty_roster.school_id. | ALTER TABLE public."teacher_duty_roster" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.teacher_duty_roster.employee_id. | ALTER TABLE public."teacher_duty_roster" ADD COLUMN "employee_id" integer NOT NULL |
| columns | columns:public.teacher_duty_roster.duty_role. | ALTER TABLE public."teacher_duty_roster" ADD COLUMN "duty_role" text NOT NULL |
| columns | columns:public.teacher_duty_roster.start_date. | ALTER TABLE public."teacher_duty_roster" ADD COLUMN "start_date" date NOT NULL |
| columns | columns:public.teacher_duty_roster.end_date. | ALTER TABLE public."teacher_duty_roster" ADD COLUMN "end_date" date NOT NULL |
| columns | columns:public.teacher_duty_roster.status. | ALTER TABLE public."teacher_duty_roster" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.teacher_duty_roster.notes. | ALTER TABLE public."teacher_duty_roster" ADD COLUMN "notes" text |
| columns | columns:public.teacher_duty_roster.created_by_user_id. | ALTER TABLE public."teacher_duty_roster" ADD COLUMN "created_by_user_id" integer NOT NULL |
| columns | columns:public.teacher_duty_roster.updated_by_user_id. | ALTER TABLE public."teacher_duty_roster" ADD COLUMN "updated_by_user_id" integer NOT NULL |
| columns | columns:public.teacher_duty_roster.created_at. | ALTER TABLE public."teacher_duty_roster" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.teacher_duty_roster.updated_at. | ALTER TABLE public."teacher_duty_roster" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.teacher_subject_assignments.id. | ALTER TABLE public."teacher_subject_assignments" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.teacher_subject_assignments.school_id. | ALTER TABLE public."teacher_subject_assignments" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.teacher_subject_assignments.employee_id. | ALTER TABLE public."teacher_subject_assignments" ADD COLUMN "employee_id" integer NOT NULL |
| columns | columns:public.teacher_subject_assignments.subject_id. | ALTER TABLE public."teacher_subject_assignments" ADD COLUMN "subject_id" integer NOT NULL |
| columns | columns:public.teacher_subject_assignments.academic_session_id. | ALTER TABLE public."teacher_subject_assignments" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.teacher_subject_assignments.start_date. | ALTER TABLE public."teacher_subject_assignments" ADD COLUMN "start_date" date NOT NULL |
| columns | columns:public.teacher_subject_assignments.end_date. | ALTER TABLE public."teacher_subject_assignments" ADD COLUMN "end_date" date |
| columns | columns:public.teacher_subject_assignments.status. | ALTER TABLE public."teacher_subject_assignments" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.teacher_subject_assignments.created_by_user_id. | ALTER TABLE public."teacher_subject_assignments" ADD COLUMN "created_by_user_id" integer NOT NULL |
| columns | columns:public.teacher_subject_assignments.updated_by_user_id. | ALTER TABLE public."teacher_subject_assignments" ADD COLUMN "updated_by_user_id" integer NOT NULL |
| columns | columns:public.teacher_subject_assignments.created_at. | ALTER TABLE public."teacher_subject_assignments" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.teacher_subject_assignments.updated_at. | ALTER TABLE public."teacher_subject_assignments" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.partner_profile_users; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_branding_logos; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_calendar_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_partner_attributions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.teacher_duty_roster; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.teacher_subject_assignments; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous
- STOP if partner_profile_users.nfc_activation_enabled default/guard/old-row initializer differs from boolean NOT NULL DEFAULT false
- STOP if partner_profiles.nfc_activation_enabled default/guard/old-row initializer differs from boolean NOT NULL DEFAULT false

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0088_reconcile_columns_c_1.sql

- [ ] Hash matches **2f504a248a2bbde968b95da82153dad82fb3d2d4cc60d6892f7314d50bb8c46b**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0063_reconcile_sequences_c_1.sql, 0071_reconcile_table_shells_c_1.sql.
- [ ] Required objects verified: tables:public..admission_application_counters.; tables:public..admission_application_documents.; sequences:public.admission_application_documents.admission_application_documents_id_seq.; tables:public..admission_applications.; sequences:public.admission_applications.admission_applications_id_seq.; tables:public..admission_portal_classes.; tables:public..admission_portal_settings.; tables:public..admission_request_rate_limits.; tables:public..class_subjects.; sequences:public.class_subjects.class_subjects_id_seq.; tables:public..employees.; sequences:public.employees.employees_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.admission_application_counters.school_id. | ALTER TABLE public."admission_application_counters" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.admission_application_counters.current_value. | ALTER TABLE public."admission_application_counters" ADD COLUMN "current_value" integer NOT NULL |
| columns | columns:public.admission_application_counters.updated_at. | ALTER TABLE public."admission_application_counters" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.admission_application_documents.id. | ALTER TABLE public."admission_application_documents" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.admission_application_documents.school_id. | ALTER TABLE public."admission_application_documents" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.admission_application_documents.application_id. | ALTER TABLE public."admission_application_documents" ADD COLUMN "application_id" integer NOT NULL |
| columns | columns:public.admission_application_documents.document_type. | ALTER TABLE public."admission_application_documents" ADD COLUMN "document_type" text NOT NULL |
| columns | columns:public.admission_application_documents.file_name. | ALTER TABLE public."admission_application_documents" ADD COLUMN "file_name" text NOT NULL |
| columns | columns:public.admission_application_documents.content_type. | ALTER TABLE public."admission_application_documents" ADD COLUMN "content_type" text NOT NULL |
| columns | columns:public.admission_application_documents.byte_size. | ALTER TABLE public."admission_application_documents" ADD COLUMN "byte_size" integer NOT NULL |
| columns | columns:public.admission_application_documents.object_path. | ALTER TABLE public."admission_application_documents" ADD COLUMN "object_path" text NOT NULL |
| columns | columns:public.admission_application_documents.created_by_user_id. | ALTER TABLE public."admission_application_documents" ADD COLUMN "created_by_user_id" integer |
| columns | columns:public.admission_application_documents.created_at. | ALTER TABLE public."admission_application_documents" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.admission_applications.id. | ALTER TABLE public."admission_applications" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.admission_applications.school_id. | ALTER TABLE public."admission_applications" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.admission_applications.application_number. | ALTER TABLE public."admission_applications" ADD COLUMN "application_number" text NOT NULL |
| columns | columns:public.admission_applications.status. | ALTER TABLE public."admission_applications" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.admission_applications.source. | ALTER TABLE public."admission_applications" ADD COLUMN "source" text NOT NULL |
| columns | columns:public.admission_applications.applicant_first_name. | ALTER TABLE public."admission_applications" ADD COLUMN "applicant_first_name" text NOT NULL |
| columns | columns:public.admission_applications.applicant_middle_name. | ALTER TABLE public."admission_applications" ADD COLUMN "applicant_middle_name" text |
| columns | columns:public.admission_applications.applicant_last_name. | ALTER TABLE public."admission_applications" ADD COLUMN "applicant_last_name" text NOT NULL |
| columns | columns:public.admission_applications.date_of_birth. | ALTER TABLE public."admission_applications" ADD COLUMN "date_of_birth" date NOT NULL |
| columns | columns:public.admission_applications.gender. | ALTER TABLE public."admission_applications" ADD COLUMN "gender" text NOT NULL |
| columns | columns:public.admission_applications.photo_object_path. | ALTER TABLE public."admission_applications" ADD COLUMN "photo_object_path" text |
| columns | columns:public.admission_applications.previous_school. | ALTER TABLE public."admission_applications" ADD COLUMN "previous_school" text |
| columns | columns:public.admission_applications.previous_class. | ALTER TABLE public."admission_applications" ADD COLUMN "previous_class" text |
| columns | columns:public.admission_applications.intended_class_id. | ALTER TABLE public."admission_applications" ADD COLUMN "intended_class_id" integer NOT NULL |
| columns | columns:public.admission_applications.academic_session_id. | ALTER TABLE public."admission_applications" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.admission_applications.academic_term_id. | ALTER TABLE public."admission_applications" ADD COLUMN "academic_term_id" integer |
| columns | columns:public.admission_applications.applicant_address. | ALTER TABLE public."admission_applications" ADD COLUMN "applicant_address" text |
| columns | columns:public.admission_applications.guardian_name. | ALTER TABLE public."admission_applications" ADD COLUMN "guardian_name" text NOT NULL |
| columns | columns:public.admission_applications.guardian_phone. | ALTER TABLE public."admission_applications" ADD COLUMN "guardian_phone" text NOT NULL |
| columns | columns:public.admission_applications.guardian_email. | ALTER TABLE public."admission_applications" ADD COLUMN "guardian_email" text |
| columns | columns:public.admission_applications.guardian_relationship. | ALTER TABLE public."admission_applications" ADD COLUMN "guardian_relationship" text |
| columns | columns:public.admission_applications.guardian_address. | ALTER TABLE public."admission_applications" ADD COLUMN "guardian_address" text |
| columns | columns:public.admission_applications.emergency_contact_name. | ALTER TABLE public."admission_applications" ADD COLUMN "emergency_contact_name" text |
| columns | columns:public.admission_applications.emergency_contact_phone. | ALTER TABLE public."admission_applications" ADD COLUMN "emergency_contact_phone" text |
| columns | columns:public.admission_applications.emergency_contact_relationship. | ALTER TABLE public."admission_applications" ADD COLUMN "emergency_contact_relationship" text |
| columns | columns:public.admission_applications.receipt_secret_hash. | ALTER TABLE public."admission_applications" ADD COLUMN "receipt_secret_hash" text |
| columns | columns:public.admission_applications.idempotency_key. | ALTER TABLE public."admission_applications" ADD COLUMN "idempotency_key" text NOT NULL |
| columns | columns:public.admission_applications.payload_hash. | ALTER TABLE public."admission_applications" ADD COLUMN "payload_hash" text NOT NULL |
| columns | columns:public.admission_applications.assessment. | ALTER TABLE public."admission_applications" ADD COLUMN "assessment" jsonb |
| columns | columns:public.admission_applications.interview. | ALTER TABLE public."admission_applications" ADD COLUMN "interview" jsonb |
| columns | columns:public.admission_applications.internal_notes. | ALTER TABLE public."admission_applications" ADD COLUMN "internal_notes" text |
| columns | columns:public.admission_applications.public_message. | ALTER TABLE public."admission_applications" ADD COLUMN "public_message" text |
| columns | columns:public.admission_applications.converted_student_id. | ALTER TABLE public."admission_applications" ADD COLUMN "converted_student_id" integer |
| columns | columns:public.admission_applications.converted_parent_id. | ALTER TABLE public."admission_applications" ADD COLUMN "converted_parent_id" integer |
| columns | columns:public.admission_applications.created_by_user_id. | ALTER TABLE public."admission_applications" ADD COLUMN "created_by_user_id" integer |
| columns | columns:public.admission_applications.version. | ALTER TABLE public."admission_applications" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.admission_applications.created_at. | ALTER TABLE public."admission_applications" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.admission_applications.updated_at. | ALTER TABLE public."admission_applications" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.admission_portal_classes.school_id. | ALTER TABLE public."admission_portal_classes" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.admission_portal_classes.class_id. | ALTER TABLE public."admission_portal_classes" ADD COLUMN "class_id" integer NOT NULL |
| columns | columns:public.admission_portal_classes.created_at. | ALTER TABLE public."admission_portal_classes" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.admission_portal_settings.school_id. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.admission_portal_settings.portal_key. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "portal_key" text NOT NULL |
| columns | columns:public.admission_portal_settings.is_open. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "is_open" boolean NOT NULL |
| columns | columns:public.admission_portal_settings.academic_session_id. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "academic_session_id" integer |
| columns | columns:public.admission_portal_settings.academic_term_id. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "academic_term_id" integer |
| columns | columns:public.admission_portal_settings.deadline. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "deadline" date |
| columns | columns:public.admission_portal_settings.fee_info. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "fee_info" text |
| columns | columns:public.admission_portal_settings.requirements. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "requirements" jsonb NOT NULL |
| columns | columns:public.admission_portal_settings.required_documents. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "required_documents" jsonb NOT NULL |
| columns | columns:public.admission_portal_settings.instructions. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "instructions" text |
| columns | columns:public.admission_portal_settings.entrance_examination. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "entrance_examination" text |
| columns | columns:public.admission_portal_settings.interview_information. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "interview_information" text |
| columns | columns:public.admission_portal_settings.public_description. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "public_description" text |
| columns | columns:public.admission_portal_settings.public_address. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "public_address" text |
| columns | columns:public.admission_portal_settings.public_phone. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "public_phone" text |
| columns | columns:public.admission_portal_settings.public_email. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "public_email" text |
| columns | columns:public.admission_portal_settings.logo_object_path. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "logo_object_path" text |
| columns | columns:public.admission_portal_settings.updated_by_user_id. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "updated_by_user_id" integer |
| columns | columns:public.admission_portal_settings.created_at. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.admission_portal_settings.updated_at. | ALTER TABLE public."admission_portal_settings" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.admission_request_rate_limits.bucket_hash. | ALTER TABLE public."admission_request_rate_limits" ADD COLUMN "bucket_hash" text NOT NULL |
| columns | columns:public.admission_request_rate_limits.bucket_started_at. | ALTER TABLE public."admission_request_rate_limits" ADD COLUMN "bucket_started_at" timestamp with time zone NOT NULL |
| columns | columns:public.admission_request_rate_limits.request_count. | ALTER TABLE public."admission_request_rate_limits" ADD COLUMN "request_count" integer NOT NULL |
| columns | columns:public.admission_request_rate_limits.updated_at. | ALTER TABLE public."admission_request_rate_limits" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.class_subjects.id. | ALTER TABLE public."class_subjects" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.class_subjects.school_id. | ALTER TABLE public."class_subjects" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.class_subjects.school_class_id. | ALTER TABLE public."class_subjects" ADD COLUMN "school_class_id" integer NOT NULL |
| columns | columns:public.class_subjects.subject_id. | ALTER TABLE public."class_subjects" ADD COLUMN "subject_id" integer NOT NULL |
| columns | columns:public.class_subjects.academic_session_id. | ALTER TABLE public."class_subjects" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.class_subjects.academic_term_id. | ALTER TABLE public."class_subjects" ADD COLUMN "academic_term_id" integer |
| columns | columns:public.class_subjects.employee_id. | ALTER TABLE public."class_subjects" ADD COLUMN "employee_id" integer |
| columns | columns:public.class_subjects.section. | ALTER TABLE public."class_subjects" ADD COLUMN "section" text |
| columns | columns:public.class_subjects.status. | ALTER TABLE public."class_subjects" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.class_subjects.created_at. | ALTER TABLE public."class_subjects" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.class_subjects.updated_at. | ALTER TABLE public."class_subjects" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.employees.id. | ALTER TABLE public."employees" ADD COLUMN "id" integer NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.admission_application_counters; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.admission_application_documents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.admission_applications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.admission_portal_classes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.admission_portal_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.admission_request_rate_limits; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.class_subjects; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employees; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0089_reconcile_columns_c_2.sql

- [ ] Hash matches **c09d5d2c4280762299799706ebb316fb425273afb978d6fda8bd8a8c360b2cec**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0063_reconcile_sequences_c_1.sql, 0071_reconcile_table_shells_c_1.sql.
- [ ] Required objects verified: tables:public..employees.; tables:public..student_behaviour_configurations.; tables:public..student_behaviour_records.; sequences:public.student_behaviour_records.student_behaviour_records_id_seq.; tables:public..student_care_grants.; sequences:public.student_care_grants.student_care_grants_id_seq.; tables:public..student_care_idempotency.; sequences:public.student_care_idempotency.student_care_idempotency_id_seq.; tables:public..student_care_record_history.; sequences:public.student_care_record_history.student_care_record_history_id_seq.; tables:public..student_class_assignments.; sequences:public.student_class_assignments.student_class_assignments_id_seq.; tables:public..student_medical_profiles.; sequences:public.student_medical_profiles.student_medical_profiles_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.employees.school_id. | ALTER TABLE public."employees" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.employees.user_id. | ALTER TABLE public."employees" ADD COLUMN "user_id" integer |
| columns | columns:public.employees.employee_no. | ALTER TABLE public."employees" ADD COLUMN "employee_no" text NOT NULL |
| columns | columns:public.employees.first_name. | ALTER TABLE public."employees" ADD COLUMN "first_name" text NOT NULL |
| columns | columns:public.employees.middle_name. | ALTER TABLE public."employees" ADD COLUMN "middle_name" text |
| columns | columns:public.employees.last_name. | ALTER TABLE public."employees" ADD COLUMN "last_name" text NOT NULL |
| columns | columns:public.employees.phone. | ALTER TABLE public."employees" ADD COLUMN "phone" text |
| columns | columns:public.employees.email. | ALTER TABLE public."employees" ADD COLUMN "email" text |
| columns | columns:public.employees.address. | ALTER TABLE public."employees" ADD COLUMN "address" text |
| columns | columns:public.employees.photo. | ALTER TABLE public."employees" ADD COLUMN "photo" text |
| columns | columns:public.employees.gender. | ALTER TABLE public."employees" ADD COLUMN "gender" text |
| columns | columns:public.employees.employee_type. | ALTER TABLE public."employees" ADD COLUMN "employee_type" text NOT NULL |
| columns | columns:public.employees.employment_status. | ALTER TABLE public."employees" ADD COLUMN "employment_status" text NOT NULL |
| columns | columns:public.employees.date_employed. | ALTER TABLE public."employees" ADD COLUMN "date_employed" date |
| columns | columns:public.employees.department. | ALTER TABLE public."employees" ADD COLUMN "department" text |
| columns | columns:public.employees.qualification. | ALTER TABLE public."employees" ADD COLUMN "qualification" text |
| columns | columns:public.employees.created_at. | ALTER TABLE public."employees" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.employees.updated_at. | ALTER TABLE public."employees" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_behaviour_configurations.school_id. | ALTER TABLE public."student_behaviour_configurations" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.student_behaviour_configurations.categories. | ALTER TABLE public."student_behaviour_configurations" ADD COLUMN "categories" jsonb NOT NULL |
| columns | columns:public.student_behaviour_configurations.actions. | ALTER TABLE public."student_behaviour_configurations" ADD COLUMN "actions" jsonb NOT NULL |
| columns | columns:public.student_behaviour_configurations.updated_by_user_id. | ALTER TABLE public."student_behaviour_configurations" ADD COLUMN "updated_by_user_id" integer NOT NULL |
| columns | columns:public.student_behaviour_configurations.version. | ALTER TABLE public."student_behaviour_configurations" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.student_behaviour_configurations.updated_at. | ALTER TABLE public."student_behaviour_configurations" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_behaviour_records.id. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.student_behaviour_records.school_id. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.student_behaviour_records.student_id. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.student_behaviour_records.occurred_at. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "occurred_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_behaviour_records.school_class_id. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "school_class_id" integer |
| columns | columns:public.student_behaviour_records.subject_id. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "subject_id" integer |
| columns | columns:public.student_behaviour_records.category. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "category" text NOT NULL |
| columns | columns:public.student_behaviour_records.severity. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "severity" text NOT NULL |
| columns | columns:public.student_behaviour_records.description. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "description" text NOT NULL |
| columns | columns:public.student_behaviour_records.location. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "location" text |
| columns | columns:public.student_behaviour_records.reporter_user_id. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "reporter_user_id" integer NOT NULL |
| columns | columns:public.student_behaviour_records.action. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "action" text |
| columns | columns:public.student_behaviour_records.parent_notification_status. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "parent_notification_status" text NOT NULL |
| columns | columns:public.student_behaviour_records.parent_notification_id. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "parent_notification_id" integer |
| columns | columns:public.student_behaviour_records.follow_up_at. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "follow_up_at" timestamp with time zone |
| columns | columns:public.student_behaviour_records.follow_up_notes. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "follow_up_notes" text |
| columns | columns:public.student_behaviour_records.status. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.student_behaviour_records.resolution. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "resolution" text |
| columns | columns:public.student_behaviour_records.internal_notes. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "internal_notes" text |
| columns | columns:public.student_behaviour_records.parent_visible. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "parent_visible" boolean NOT NULL |
| columns | columns:public.student_behaviour_records.version. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.student_behaviour_records.created_at. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_behaviour_records.updated_at. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_behaviour_records.archived_at. | ALTER TABLE public."student_behaviour_records" ADD COLUMN "archived_at" timestamp with time zone |
| columns | columns:public.student_care_grants.id. | ALTER TABLE public."student_care_grants" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.student_care_grants.school_id. | ALTER TABLE public."student_care_grants" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.student_care_grants.user_id. | ALTER TABLE public."student_care_grants" ADD COLUMN "user_id" integer NOT NULL |
| columns | columns:public.student_care_grants.permissions. | ALTER TABLE public."student_care_grants" ADD COLUMN "permissions" text[] NOT NULL |
| columns | columns:public.student_care_grants.active. | ALTER TABLE public."student_care_grants" ADD COLUMN "active" boolean NOT NULL |
| columns | columns:public.student_care_grants.granted_by_user_id. | ALTER TABLE public."student_care_grants" ADD COLUMN "granted_by_user_id" integer NOT NULL |
| columns | columns:public.student_care_grants.updated_at. | ALTER TABLE public."student_care_grants" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_care_grants.created_at. | ALTER TABLE public."student_care_grants" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_care_idempotency.id. | ALTER TABLE public."student_care_idempotency" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.student_care_idempotency.school_id. | ALTER TABLE public."student_care_idempotency" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.student_care_idempotency.student_id. | ALTER TABLE public."student_care_idempotency" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.student_care_idempotency.request_key. | ALTER TABLE public."student_care_idempotency" ADD COLUMN "request_key" text NOT NULL |
| columns | columns:public.student_care_idempotency.resource_type. | ALTER TABLE public."student_care_idempotency" ADD COLUMN "resource_type" text NOT NULL |
| columns | columns:public.student_care_idempotency.request_hash. | ALTER TABLE public."student_care_idempotency" ADD COLUMN "request_hash" text NOT NULL |
| columns | columns:public.student_care_idempotency.resource_id. | ALTER TABLE public."student_care_idempotency" ADD COLUMN "resource_id" integer NOT NULL |
| columns | columns:public.student_care_idempotency.response_revision. | ALTER TABLE public."student_care_idempotency" ADD COLUMN "response_revision" integer NOT NULL |
| columns | columns:public.student_care_idempotency.created_by_user_id. | ALTER TABLE public."student_care_idempotency" ADD COLUMN "created_by_user_id" integer NOT NULL |
| columns | columns:public.student_care_idempotency.created_at. | ALTER TABLE public."student_care_idempotency" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_care_record_history.id. | ALTER TABLE public."student_care_record_history" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.student_care_record_history.school_id. | ALTER TABLE public."student_care_record_history" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.student_care_record_history.student_id. | ALTER TABLE public."student_care_record_history" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.student_care_record_history.record_type. | ALTER TABLE public."student_care_record_history" ADD COLUMN "record_type" text NOT NULL |
| columns | columns:public.student_care_record_history.record_id. | ALTER TABLE public."student_care_record_history" ADD COLUMN "record_id" integer NOT NULL |
| columns | columns:public.student_care_record_history.revision. | ALTER TABLE public."student_care_record_history" ADD COLUMN "revision" integer NOT NULL |
| columns | columns:public.student_care_record_history.changed_by_user_id. | ALTER TABLE public."student_care_record_history" ADD COLUMN "changed_by_user_id" integer NOT NULL |
| columns | columns:public.student_care_record_history.snapshot. | ALTER TABLE public."student_care_record_history" ADD COLUMN "snapshot" jsonb NOT NULL |
| columns | columns:public.student_care_record_history.changed_at. | ALTER TABLE public."student_care_record_history" ADD COLUMN "changed_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_class_assignments.id. | ALTER TABLE public."student_class_assignments" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.student_class_assignments.school_id. | ALTER TABLE public."student_class_assignments" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.student_class_assignments.student_id. | ALTER TABLE public."student_class_assignments" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.student_class_assignments.academic_session_id. | ALTER TABLE public."student_class_assignments" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.student_class_assignments.academic_term_id. | ALTER TABLE public."student_class_assignments" ADD COLUMN "academic_term_id" integer |
| columns | columns:public.student_class_assignments.school_class_id. | ALTER TABLE public."student_class_assignments" ADD COLUMN "school_class_id" integer NOT NULL |
| columns | columns:public.student_class_assignments.section. | ALTER TABLE public."student_class_assignments" ADD COLUMN "section" text NOT NULL |
| columns | columns:public.student_class_assignments.status. | ALTER TABLE public."student_class_assignments" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.student_class_assignments.is_current. | ALTER TABLE public."student_class_assignments" ADD COLUMN "is_current" boolean NOT NULL |
| columns | columns:public.student_class_assignments.start_date. | ALTER TABLE public."student_class_assignments" ADD COLUMN "start_date" date |
| columns | columns:public.student_class_assignments.end_date. | ALTER TABLE public."student_class_assignments" ADD COLUMN "end_date" date |
| columns | columns:public.student_class_assignments.created_at. | ALTER TABLE public."student_class_assignments" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_class_assignments.updated_at. | ALTER TABLE public."student_class_assignments" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_medical_profiles.id. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.student_medical_profiles.school_id. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "school_id" integer NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.employees; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_behaviour_configurations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_behaviour_records; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_care_grants; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_care_idempotency; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_care_record_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_class_assignments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_medical_profiles; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0090_reconcile_columns_c_3.sql

- [ ] Hash matches **aad21db9c4d66aeb219d0866d784cbce45a601ca0db88d7c47c17909419d5660**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0063_reconcile_sequences_c_1.sql, 0071_reconcile_table_shells_c_1.sql.
- [ ] Required objects verified: tables:public..student_medical_profiles.; tables:public..student_medical_visits.; sequences:public.student_medical_visits.student_medical_visits_id_seq.; tables:public..student_welfare_records.; sequences:public.student_welfare_records.student_welfare_records_id_seq.; tables:public..subjects.; sequences:public.subjects.subjects_id_seq.; tables:public..teacher_class_assignments.; sequences:public.teacher_class_assignments.teacher_class_assignments_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.student_medical_profiles.student_id. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.student_medical_profiles.blood_group. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "blood_group" text |
| columns | columns:public.student_medical_profiles.genotype. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "genotype" text |
| columns | columns:public.student_medical_profiles.allergies. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "allergies" jsonb NOT NULL |
| columns | columns:public.student_medical_profiles.conditions. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "conditions" jsonb NOT NULL |
| columns | columns:public.student_medical_profiles.support_needs. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "support_needs" jsonb NOT NULL |
| columns | columns:public.student_medical_profiles.medications. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "medications" jsonb NOT NULL |
| columns | columns:public.student_medical_profiles.emergency_medical_notes. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "emergency_medical_notes" text |
| columns | columns:public.student_medical_profiles.provider_contacts. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "provider_contacts" jsonb NOT NULL |
| columns | columns:public.student_medical_profiles.emergency_contacts. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "emergency_contacts" jsonb NOT NULL |
| columns | columns:public.student_medical_profiles.version. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.student_medical_profiles.updated_by_user_id. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "updated_by_user_id" integer NOT NULL |
| columns | columns:public.student_medical_profiles.created_at. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_medical_profiles.updated_at. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_medical_profiles.archived_at. | ALTER TABLE public."student_medical_profiles" ADD COLUMN "archived_at" timestamp with time zone |
| columns | columns:public.student_medical_visits.id. | ALTER TABLE public."student_medical_visits" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.student_medical_visits.school_id. | ALTER TABLE public."student_medical_visits" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.student_medical_visits.student_id. | ALTER TABLE public."student_medical_visits" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.student_medical_visits.occurred_at. | ALTER TABLE public."student_medical_visits" ADD COLUMN "occurred_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_medical_visits.reason. | ALTER TABLE public."student_medical_visits" ADD COLUMN "reason" text NOT NULL |
| columns | columns:public.student_medical_visits.symptoms. | ALTER TABLE public."student_medical_visits" ADD COLUMN "symptoms" text |
| columns | columns:public.student_medical_visits.observations. | ALTER TABLE public."student_medical_visits" ADD COLUMN "observations" text |
| columns | columns:public.student_medical_visits.action_taken. | ALTER TABLE public."student_medical_visits" ADD COLUMN "action_taken" text |
| columns | columns:public.student_medical_visits.treatment. | ALTER TABLE public."student_medical_visits" ADD COLUMN "treatment" text |
| columns | columns:public.student_medical_visits.referral. | ALTER TABLE public."student_medical_visits" ADD COLUMN "referral" text |
| columns | columns:public.student_medical_visits.follow_up_at. | ALTER TABLE public."student_medical_visits" ADD COLUMN "follow_up_at" timestamp with time zone |
| columns | columns:public.student_medical_visits.follow_up_notes. | ALTER TABLE public."student_medical_visits" ADD COLUMN "follow_up_notes" text |
| columns | columns:public.student_medical_visits.notes. | ALTER TABLE public."student_medical_visits" ADD COLUMN "notes" text |
| columns | columns:public.student_medical_visits.recorded_by_user_id. | ALTER TABLE public."student_medical_visits" ADD COLUMN "recorded_by_user_id" integer NOT NULL |
| columns | columns:public.student_medical_visits.version. | ALTER TABLE public."student_medical_visits" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.student_medical_visits.created_at. | ALTER TABLE public."student_medical_visits" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_medical_visits.updated_at. | ALTER TABLE public."student_medical_visits" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_medical_visits.archived_at. | ALTER TABLE public."student_medical_visits" ADD COLUMN "archived_at" timestamp with time zone |
| columns | columns:public.student_welfare_records.id. | ALTER TABLE public."student_welfare_records" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.student_welfare_records.school_id. | ALTER TABLE public."student_welfare_records" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.student_welfare_records.student_id. | ALTER TABLE public."student_welfare_records" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.student_welfare_records.category. | ALTER TABLE public."student_welfare_records" ADD COLUMN "category" text NOT NULL |
| columns | columns:public.student_welfare_records.concern. | ALTER TABLE public."student_welfare_records" ADD COLUMN "concern" text NOT NULL |
| columns | columns:public.student_welfare_records.assigned_staff_user_id. | ALTER TABLE public."student_welfare_records" ADD COLUMN "assigned_staff_user_id" integer |
| columns | columns:public.student_welfare_records.follow_up_at. | ALTER TABLE public."student_welfare_records" ADD COLUMN "follow_up_at" timestamp with time zone |
| columns | columns:public.student_welfare_records.follow_up_status. | ALTER TABLE public."student_welfare_records" ADD COLUMN "follow_up_status" text NOT NULL |
| columns | columns:public.student_welfare_records.status. | ALTER TABLE public."student_welfare_records" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.student_welfare_records.resolution. | ALTER TABLE public."student_welfare_records" ADD COLUMN "resolution" text |
| columns | columns:public.student_welfare_records.internal_notes. | ALTER TABLE public."student_welfare_records" ADD COLUMN "internal_notes" text |
| columns | columns:public.student_welfare_records.parent_visible. | ALTER TABLE public."student_welfare_records" ADD COLUMN "parent_visible" boolean NOT NULL |
| columns | columns:public.student_welfare_records.created_by_user_id. | ALTER TABLE public."student_welfare_records" ADD COLUMN "created_by_user_id" integer NOT NULL |
| columns | columns:public.student_welfare_records.version. | ALTER TABLE public."student_welfare_records" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.student_welfare_records.created_at. | ALTER TABLE public."student_welfare_records" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_welfare_records.updated_at. | ALTER TABLE public."student_welfare_records" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_welfare_records.archived_at. | ALTER TABLE public."student_welfare_records" ADD COLUMN "archived_at" timestamp with time zone |
| columns | columns:public.subjects.id. | ALTER TABLE public."subjects" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.subjects.school_id. | ALTER TABLE public."subjects" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.subjects.name. | ALTER TABLE public."subjects" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.subjects.code. | ALTER TABLE public."subjects" ADD COLUMN "code" text NOT NULL |
| columns | columns:public.subjects.description. | ALTER TABLE public."subjects" ADD COLUMN "description" text |
| columns | columns:public.subjects.status. | ALTER TABLE public."subjects" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.subjects.created_at. | ALTER TABLE public."subjects" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.subjects.updated_at. | ALTER TABLE public."subjects" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.teacher_class_assignments.id. | ALTER TABLE public."teacher_class_assignments" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.teacher_class_assignments.school_id. | ALTER TABLE public."teacher_class_assignments" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.teacher_class_assignments.employee_id. | ALTER TABLE public."teacher_class_assignments" ADD COLUMN "employee_id" integer NOT NULL |
| columns | columns:public.teacher_class_assignments.academic_session_id. | ALTER TABLE public."teacher_class_assignments" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.teacher_class_assignments.school_class_id. | ALTER TABLE public."teacher_class_assignments" ADD COLUMN "school_class_id" integer NOT NULL |
| columns | columns:public.teacher_class_assignments.subject_id. | ALTER TABLE public."teacher_class_assignments" ADD COLUMN "subject_id" integer |
| columns | columns:public.teacher_class_assignments.section. | ALTER TABLE public."teacher_class_assignments" ADD COLUMN "section" text NOT NULL |
| columns | columns:public.teacher_class_assignments.assignment_type. | ALTER TABLE public."teacher_class_assignments" ADD COLUMN "assignment_type" text NOT NULL |
| columns | columns:public.teacher_class_assignments.status. | ALTER TABLE public."teacher_class_assignments" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.teacher_class_assignments.start_date. | ALTER TABLE public."teacher_class_assignments" ADD COLUMN "start_date" date |
| columns | columns:public.teacher_class_assignments.end_date. | ALTER TABLE public."teacher_class_assignments" ADD COLUMN "end_date" date |
| columns | columns:public.teacher_class_assignments.created_at. | ALTER TABLE public."teacher_class_assignments" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.teacher_class_assignments.updated_at. | ALTER TABLE public."teacher_class_assignments" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.student_medical_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_medical_visits; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_welfare_records; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.subjects; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.teacher_class_assignments; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0091_reconcile_columns_d_1.sql

- [ ] Hash matches **dea67688bc7796172b8379be10fa77f4fb9259cab2ed1434cb098f298b90a2fa**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0064_reconcile_sequences_d_1.sql, 0072_reconcile_table_shells_d_1.sql.
- [ ] Required objects verified: tables:public..attendance_discrepancies.; sequences:public.attendance_discrepancies.attendance_discrepancies_id_seq.; tables:public..attendance_events.; sequences:public.attendance_events.attendance_events_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.attendance_discrepancies.id. | ALTER TABLE public."attendance_discrepancies" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.attendance_discrepancies.school_id. | ALTER TABLE public."attendance_discrepancies" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.attendance_discrepancies.student_id. | ALTER TABLE public."attendance_discrepancies" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.attendance_discrepancies.attendance_event_id. | ALTER TABLE public."attendance_discrepancies" ADD COLUMN "attendance_event_id" integer |
| columns | columns:public.attendance_discrepancies.discrepancy_type. | ALTER TABLE public."attendance_discrepancies" ADD COLUMN "discrepancy_type" text NOT NULL |
| columns | columns:public.attendance_discrepancies.status. | ALTER TABLE public."attendance_discrepancies" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.attendance_discrepancies.details. | ALTER TABLE public."attendance_discrepancies" ADD COLUMN "details" jsonb |
| columns | columns:public.attendance_discrepancies.resolved_by. | ALTER TABLE public."attendance_discrepancies" ADD COLUMN "resolved_by" integer |
| columns | columns:public.attendance_discrepancies.resolved_at. | ALTER TABLE public."attendance_discrepancies" ADD COLUMN "resolved_at" timestamp with time zone |
| columns | columns:public.attendance_discrepancies.created_at. | ALTER TABLE public."attendance_discrepancies" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.attendance_events.id. | ALTER TABLE public."attendance_events" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.attendance_events.school_id. | ALTER TABLE public."attendance_events" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.attendance_events.student_id. | ALTER TABLE public."attendance_events" ADD COLUMN "student_id" integer |
| columns | columns:public.attendance_events.employee_id. | ALTER TABLE public."attendance_events" ADD COLUMN "employee_id" integer |
| columns | columns:public.attendance_events.device_id. | ALTER TABLE public."attendance_events" ADD COLUMN "device_id" integer |
| columns | columns:public.attendance_events.nfc_card_id. | ALTER TABLE public."attendance_events" ADD COLUMN "nfc_card_id" integer |
| columns | columns:public.attendance_events.identification_method. | ALTER TABLE public."attendance_events" ADD COLUMN "identification_method" text NOT NULL |
| columns | columns:public.attendance_events.event_type. | ALTER TABLE public."attendance_events" ADD COLUMN "event_type" text NOT NULL |
| columns | columns:public.attendance_events.result. | ALTER TABLE public."attendance_events" ADD COLUMN "result" text NOT NULL |
| columns | columns:public.attendance_events.attendance_status. | ALTER TABLE public."attendance_events" ADD COLUMN "attendance_status" text NOT NULL |
| columns | columns:public.attendance_events.event_date. | ALTER TABLE public."attendance_events" ADD COLUMN "event_date" date NOT NULL |
| columns | columns:public.attendance_events.occurred_at. | ALTER TABLE public."attendance_events" ADD COLUMN "occurred_at" timestamp with time zone NOT NULL |
| columns | columns:public.attendance_events.academic_session_id. | ALTER TABLE public."attendance_events" ADD COLUMN "academic_session_id" integer |
| columns | columns:public.attendance_events.academic_term_id. | ALTER TABLE public."attendance_events" ADD COLUMN "academic_term_id" integer |
| columns | columns:public.attendance_events.school_class_id. | ALTER TABLE public."attendance_events" ADD COLUMN "school_class_id" integer |
| columns | columns:public.attendance_events.class_name_snapshot. | ALTER TABLE public."attendance_events" ADD COLUMN "class_name_snapshot" text |
| columns | columns:public.attendance_events.section_snapshot. | ALTER TABLE public."attendance_events" ADD COLUMN "section_snapshot" text |
| columns | columns:public.attendance_events.reason. | ALTER TABLE public."attendance_events" ADD COLUMN "reason" text |
| columns | columns:public.attendance_events.actor_user_id. | ALTER TABLE public."attendance_events" ADD COLUMN "actor_user_id" integer |
| columns | columns:public.attendance_events.failure_reason. | ALTER TABLE public."attendance_events" ADD COLUMN "failure_reason" text |
| columns | columns:public.attendance_events.dedupe_key. | ALTER TABLE public."attendance_events" ADD COLUMN "dedupe_key" text NOT NULL |
| columns | columns:public.attendance_events.created_at. | ALTER TABLE public."attendance_events" ADD COLUMN "created_at" timestamp with time zone NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_discrepancies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_events; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0092_reconcile_columns_e_1.sql

- [ ] Hash matches **f9b7ff767667e3b413ba98bacbeb2a72af3d527f314bdf30711f9e90c8aa4fc8**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0065_reconcile_sequences_e_1.sql, 0073_reconcile_table_shells_e_1.sql.
- [ ] Required objects verified: tables:public..academic_result_batches.; sequences:public.academic_result_batches.academic_result_batches_id_seq.; tables:public..academic_results.; sequences:public.academic_results.academic_results_id_seq.; tables:public..curriculum_imports.; sequences:public.curriculum_imports.curriculum_imports_id_seq.; tables:public..curriculum_progress.; sequences:public.curriculum_progress.curriculum_progress_id_seq.; tables:public..curriculum_topics.; sequences:public.curriculum_topics.curriculum_topics_id_seq.; tables:public..curriculum_versions.; sequences:public.curriculum_versions.curriculum_versions_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.academic_result_batches.id. | ALTER TABLE public."academic_result_batches" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.academic_result_batches.school_id. | ALTER TABLE public."academic_result_batches" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.academic_result_batches.academic_session_id. | ALTER TABLE public."academic_result_batches" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.academic_result_batches.academic_term_id. | ALTER TABLE public."academic_result_batches" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.academic_result_batches.school_class_id. | ALTER TABLE public."academic_result_batches" ADD COLUMN "school_class_id" integer NOT NULL |
| columns | columns:public.academic_result_batches.section. | ALTER TABLE public."academic_result_batches" ADD COLUMN "section" text NOT NULL |
| columns | columns:public.academic_result_batches.subject_id. | ALTER TABLE public."academic_result_batches" ADD COLUMN "subject_id" integer NOT NULL |
| columns | columns:public.academic_result_batches.teacher_employee_id. | ALTER TABLE public."academic_result_batches" ADD COLUMN "teacher_employee_id" integer NOT NULL |
| columns | columns:public.academic_result_batches.components. | ALTER TABLE public."academic_result_batches" ADD COLUMN "components" jsonb NOT NULL |
| columns | columns:public.academic_result_batches.status. | ALTER TABLE public."academic_result_batches" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.academic_result_batches.revision. | ALTER TABLE public."academic_result_batches" ADD COLUMN "revision" integer NOT NULL |
| columns | columns:public.academic_result_batches.return_comment. | ALTER TABLE public."academic_result_batches" ADD COLUMN "return_comment" text |
| columns | columns:public.academic_result_batches.created_by. | ALTER TABLE public."academic_result_batches" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.academic_result_batches.submitted_at. | ALTER TABLE public."academic_result_batches" ADD COLUMN "submitted_at" timestamp with time zone |
| columns | columns:public.academic_result_batches.created_at. | ALTER TABLE public."academic_result_batches" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_result_batches.updated_at. | ALTER TABLE public."academic_result_batches" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_results.id. | ALTER TABLE public."academic_results" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.academic_results.school_id. | ALTER TABLE public."academic_results" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.academic_results.assessment_id. | ALTER TABLE public."academic_results" ADD COLUMN "assessment_id" integer NOT NULL |
| columns | columns:public.academic_results.student_id. | ALTER TABLE public."academic_results" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.academic_results.student_class_assignment_id. | ALTER TABLE public."academic_results" ADD COLUMN "student_class_assignment_id" integer NOT NULL |
| columns | columns:public.academic_results.teacher_employee_id. | ALTER TABLE public."academic_results" ADD COLUMN "teacher_employee_id" integer NOT NULL |
| columns | columns:public.academic_results.academic_session_id. | ALTER TABLE public."academic_results" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.academic_results.academic_term_id. | ALTER TABLE public."academic_results" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.academic_results.school_class_id. | ALTER TABLE public."academic_results" ADD COLUMN "school_class_id" integer NOT NULL |
| columns | columns:public.academic_results.section_snapshot. | ALTER TABLE public."academic_results" ADD COLUMN "section_snapshot" text NOT NULL |
| columns | columns:public.academic_results.subject_id. | ALTER TABLE public."academic_results" ADD COLUMN "subject_id" integer NOT NULL |
| columns | columns:public.academic_results.score. | ALTER TABLE public."academic_results" ADD COLUMN "score" numeric(10,2) NOT NULL |
| columns | columns:public.academic_results.max_score. | ALTER TABLE public."academic_results" ADD COLUMN "max_score" numeric(10,2) NOT NULL |
| columns | columns:public.academic_results.grade. | ALTER TABLE public."academic_results" ADD COLUMN "grade" text |
| columns | columns:public.academic_results.grade_point. | ALTER TABLE public."academic_results" ADD COLUMN "grade_point" numeric(5,2) |
| columns | columns:public.academic_results.remark. | ALTER TABLE public."academic_results" ADD COLUMN "remark" text |
| columns | columns:public.academic_results.status. | ALTER TABLE public."academic_results" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.academic_results.created_by. | ALTER TABLE public."academic_results" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.academic_results.published_by. | ALTER TABLE public."academic_results" ADD COLUMN "published_by" integer |
| columns | columns:public.academic_results.published_at. | ALTER TABLE public."academic_results" ADD COLUMN "published_at" timestamp with time zone |
| columns | columns:public.academic_results.created_at. | ALTER TABLE public."academic_results" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_results.updated_at. | ALTER TABLE public."academic_results" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.academic_results.review_status. | ALTER TABLE public."academic_results" ADD COLUMN "review_status" text NOT NULL |
| columns | columns:public.academic_results.review_comment. | ALTER TABLE public."academic_results" ADD COLUMN "review_comment" text |
| columns | columns:public.academic_results.reviewed_by. | ALTER TABLE public."academic_results" ADD COLUMN "reviewed_by" integer |
| columns | columns:public.academic_results.reviewed_at. | ALTER TABLE public."academic_results" ADD COLUMN "reviewed_at" timestamp with time zone |
| columns | columns:public.curriculum_imports.id. | ALTER TABLE public."curriculum_imports" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.curriculum_imports.uploaded_by. | ALTER TABLE public."curriculum_imports" ADD COLUMN "uploaded_by" integer NOT NULL |
| columns | columns:public.curriculum_imports.filename. | ALTER TABLE public."curriculum_imports" ADD COLUMN "filename" text NOT NULL |
| columns | columns:public.curriculum_imports.content_type. | ALTER TABLE public."curriculum_imports" ADD COLUMN "content_type" text NOT NULL |
| columns | columns:public.curriculum_imports.object_path. | ALTER TABLE public."curriculum_imports" ADD COLUMN "object_path" text NOT NULL |
| columns | columns:public.curriculum_imports.detected_type. | ALTER TABLE public."curriculum_imports" ADD COLUMN "detected_type" text NOT NULL |
| columns | columns:public.curriculum_imports.preview_rows. | ALTER TABLE public."curriculum_imports" ADD COLUMN "preview_rows" jsonb NOT NULL |
| columns | columns:public.curriculum_imports.headers. | ALTER TABLE public."curriculum_imports" ADD COLUMN "headers" jsonb NOT NULL |
| columns | columns:public.curriculum_imports.created_at. | ALTER TABLE public."curriculum_imports" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.curriculum_imports.confirmed_version_id. | ALTER TABLE public."curriculum_imports" ADD COLUMN "confirmed_version_id" integer |
| columns | columns:public.curriculum_progress.id. | ALTER TABLE public."curriculum_progress" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.curriculum_progress.school_id. | ALTER TABLE public."curriculum_progress" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.curriculum_progress.mapping_id. | ALTER TABLE public."curriculum_progress" ADD COLUMN "mapping_id" integer NOT NULL |
| columns | columns:public.curriculum_progress.topic_id. | ALTER TABLE public."curriculum_progress" ADD COLUMN "topic_id" integer NOT NULL |
| columns | columns:public.curriculum_progress.progress_status. | ALTER TABLE public."curriculum_progress" ADD COLUMN "progress_status" text NOT NULL |
| columns | columns:public.curriculum_progress.completed_date. | ALTER TABLE public."curriculum_progress" ADD COLUMN "completed_date" date |
| columns | columns:public.curriculum_progress.comment. | ALTER TABLE public."curriculum_progress" ADD COLUMN "comment" text |
| columns | columns:public.curriculum_progress.updated_by. | ALTER TABLE public."curriculum_progress" ADD COLUMN "updated_by" integer NOT NULL |
| columns | columns:public.curriculum_progress.updated_at. | ALTER TABLE public."curriculum_progress" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.curriculum_topics.id. | ALTER TABLE public."curriculum_topics" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.curriculum_topics.curriculum_version_id. | ALTER TABLE public."curriculum_topics" ADD COLUMN "curriculum_version_id" integer |
| columns | columns:public.curriculum_topics.school_id. | ALTER TABLE public."curriculum_topics" ADD COLUMN "school_id" integer |
| columns | columns:public.curriculum_topics.mapping_id. | ALTER TABLE public."curriculum_topics" ADD COLUMN "mapping_id" integer |
| columns | columns:public.curriculum_topics.class_level. | ALTER TABLE public."curriculum_topics" ADD COLUMN "class_level" text NOT NULL |
| columns | columns:public.curriculum_topics.subject_code. | ALTER TABLE public."curriculum_topics" ADD COLUMN "subject_code" text NOT NULL |
| columns | columns:public.curriculum_topics.parent_topic_id. | ALTER TABLE public."curriculum_topics" ADD COLUMN "parent_topic_id" integer |
| columns | columns:public.curriculum_topics.title. | ALTER TABLE public."curriculum_topics" ADD COLUMN "title" text NOT NULL |
| columns | columns:public.curriculum_topics.learning_objectives. | ALTER TABLE public."curriculum_topics" ADD COLUMN "learning_objectives" jsonb NOT NULL |
| columns | columns:public.curriculum_topics.learning_outcomes. | ALTER TABLE public."curriculum_topics" ADD COLUMN "learning_outcomes" jsonb NOT NULL |
| columns | columns:public.curriculum_topics.suggested_resources. | ALTER TABLE public."curriculum_topics" ADD COLUMN "suggested_resources" jsonb NOT NULL |
| columns | columns:public.curriculum_topics.source_kind. | ALTER TABLE public."curriculum_topics" ADD COLUMN "source_kind" text NOT NULL |
| columns | columns:public.curriculum_topics.sequence_order. | ALTER TABLE public."curriculum_topics" ADD COLUMN "sequence_order" integer NOT NULL |
| columns | columns:public.curriculum_topics.created_at. | ALTER TABLE public."curriculum_topics" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.curriculum_versions.id. | ALTER TABLE public."curriculum_versions" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.curriculum_versions.title. | ALTER TABLE public."curriculum_versions" ADD COLUMN "title" text NOT NULL |
| columns | columns:public.curriculum_versions.education_level. | ALTER TABLE public."curriculum_versions" ADD COLUMN "education_level" text NOT NULL |
| columns | columns:public.curriculum_versions.class_levels. | ALTER TABLE public."curriculum_versions" ADD COLUMN "class_levels" jsonb NOT NULL |
| columns | columns:public.curriculum_versions.subject_codes. | ALTER TABLE public."curriculum_versions" ADD COLUMN "subject_codes" jsonb NOT NULL |
| columns | columns:public.curriculum_versions.source_kind. | ALTER TABLE public."curriculum_versions" ADD COLUMN "source_kind" text NOT NULL |
| columns | columns:public.curriculum_versions.source_organization. | ALTER TABLE public."curriculum_versions" ADD COLUMN "source_organization" text NOT NULL |
| columns | columns:public.curriculum_versions.source_reference. | ALTER TABLE public."curriculum_versions" ADD COLUMN "source_reference" text NOT NULL |
| columns | columns:public.curriculum_versions.source_version. | ALTER TABLE public."curriculum_versions" ADD COLUMN "source_version" text |
| columns | columns:public.curriculum_versions.effective_date. | ALTER TABLE public."curriculum_versions" ADD COLUMN "effective_date" date |
| columns | columns:public.curriculum_versions.verified_date. | ALTER TABLE public."curriculum_versions" ADD COLUMN "verified_date" date |
| columns | columns:public.curriculum_versions.description. | ALTER TABLE public."curriculum_versions" ADD COLUMN "description" text |
| columns | columns:public.curriculum_versions.source_document_path. | ALTER TABLE public."curriculum_versions" ADD COLUMN "source_document_path" text |
| columns | columns:public.curriculum_versions.derived_from_version_id. | ALTER TABLE public."curriculum_versions" ADD COLUMN "derived_from_version_id" integer |
| columns | columns:public.curriculum_versions.status. | ALTER TABLE public."curriculum_versions" ADD COLUMN "status" text NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.academic_result_batches; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_results; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_imports; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_progress; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_topics; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_versions; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0093_reconcile_columns_e_2.sql

- [ ] Hash matches **2a78e89674f8467a1084c083c9297ed73bd4268aea83a2ae74e438f73b1da360**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0065_reconcile_sequences_e_1.sql, 0073_reconcile_table_shells_e_1.sql.
- [ ] Required objects verified: tables:public..curriculum_versions.; tables:public..exam_question_papers.; sequences:public.exam_question_papers.exam_question_papers_id_seq.; tables:public..exam_question_reviews.; sequences:public.exam_question_reviews.exam_question_reviews_id_seq.; tables:public..exam_question_versions.; sequences:public.exam_question_versions.exam_question_versions_id_seq.; tables:public..lesson_note_documents.; sequences:public.lesson_note_documents.lesson_note_documents_id_seq.; tables:public..lesson_note_reviews.; sequences:public.lesson_note_reviews.lesson_note_reviews_id_seq.; tables:public..lesson_notes.; sequences:public.lesson_notes.lesson_notes_id_seq.; tables:public..promotion_batch_students.; sequences:public.promotion_batch_students.promotion_batch_students_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.curriculum_versions.created_by. | ALTER TABLE public."curriculum_versions" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.curriculum_versions.created_at. | ALTER TABLE public."curriculum_versions" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.curriculum_versions.published_at. | ALTER TABLE public."curriculum_versions" ADD COLUMN "published_at" timestamp with time zone |
| columns | columns:public.curriculum_versions.archived_at. | ALTER TABLE public."curriculum_versions" ADD COLUMN "archived_at" timestamp with time zone |
| columns | columns:public.exam_question_papers.id. | ALTER TABLE public."exam_question_papers" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.exam_question_papers.school_id. | ALTER TABLE public."exam_question_papers" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.exam_question_papers.academic_session_id. | ALTER TABLE public."exam_question_papers" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.exam_question_papers.academic_term_id. | ALTER TABLE public."exam_question_papers" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.exam_question_papers.school_class_id. | ALTER TABLE public."exam_question_papers" ADD COLUMN "school_class_id" integer NOT NULL |
| columns | columns:public.exam_question_papers.section. | ALTER TABLE public."exam_question_papers" ADD COLUMN "section" text NOT NULL |
| columns | columns:public.exam_question_papers.subject_id. | ALTER TABLE public."exam_question_papers" ADD COLUMN "subject_id" integer NOT NULL |
| columns | columns:public.exam_question_papers.teacher_employee_id. | ALTER TABLE public."exam_question_papers" ADD COLUMN "teacher_employee_id" integer NOT NULL |
| columns | columns:public.exam_question_papers.examination_name. | ALTER TABLE public."exam_question_papers" ADD COLUMN "examination_name" text NOT NULL |
| columns | columns:public.exam_question_papers.instructions. | ALTER TABLE public."exam_question_papers" ADD COLUMN "instructions" text NOT NULL |
| columns | columns:public.exam_question_papers.duration. | ALTER TABLE public."exam_question_papers" ADD COLUMN "duration" text |
| columns | columns:public.exam_question_papers.total_marks. | ALTER TABLE public."exam_question_papers" ADD COLUMN "total_marks" numeric(10,2) |
| columns | columns:public.exam_question_papers.status. | ALTER TABLE public."exam_question_papers" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.exam_question_papers.revision. | ALTER TABLE public."exam_question_papers" ADD COLUMN "revision" integer NOT NULL |
| columns | columns:public.exam_question_papers.submitted_at. | ALTER TABLE public."exam_question_papers" ADD COLUMN "submitted_at" timestamp with time zone |
| columns | columns:public.exam_question_papers.approved_at. | ALTER TABLE public."exam_question_papers" ADD COLUMN "approved_at" timestamp with time zone |
| columns | columns:public.exam_question_papers.created_by. | ALTER TABLE public."exam_question_papers" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.exam_question_papers.created_at. | ALTER TABLE public."exam_question_papers" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.exam_question_papers.updated_at. | ALTER TABLE public."exam_question_papers" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.exam_question_reviews.id. | ALTER TABLE public."exam_question_reviews" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.exam_question_reviews.school_id. | ALTER TABLE public."exam_question_reviews" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.exam_question_reviews.paper_id. | ALTER TABLE public."exam_question_reviews" ADD COLUMN "paper_id" integer NOT NULL |
| columns | columns:public.exam_question_reviews.version_id. | ALTER TABLE public."exam_question_reviews" ADD COLUMN "version_id" integer NOT NULL |
| columns | columns:public.exam_question_reviews.reviewer_user_id. | ALTER TABLE public."exam_question_reviews" ADD COLUMN "reviewer_user_id" integer NOT NULL |
| columns | columns:public.exam_question_reviews.decision. | ALTER TABLE public."exam_question_reviews" ADD COLUMN "decision" text NOT NULL |
| columns | columns:public.exam_question_reviews.comment. | ALTER TABLE public."exam_question_reviews" ADD COLUMN "comment" text NOT NULL |
| columns | columns:public.exam_question_reviews.created_at. | ALTER TABLE public."exam_question_reviews" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.exam_question_versions.id. | ALTER TABLE public."exam_question_versions" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.exam_question_versions.school_id. | ALTER TABLE public."exam_question_versions" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.exam_question_versions.paper_id. | ALTER TABLE public."exam_question_versions" ADD COLUMN "paper_id" integer NOT NULL |
| columns | columns:public.exam_question_versions.revision. | ALTER TABLE public."exam_question_versions" ADD COLUMN "revision" integer NOT NULL |
| columns | columns:public.exam_question_versions.filename. | ALTER TABLE public."exam_question_versions" ADD COLUMN "filename" text NOT NULL |
| columns | columns:public.exam_question_versions.mime_type. | ALTER TABLE public."exam_question_versions" ADD COLUMN "mime_type" text NOT NULL |
| columns | columns:public.exam_question_versions.object_path. | ALTER TABLE public."exam_question_versions" ADD COLUMN "object_path" text NOT NULL |
| columns | columns:public.exam_question_versions.sha256. | ALTER TABLE public."exam_question_versions" ADD COLUMN "sha256" text NOT NULL |
| columns | columns:public.exam_question_versions.preview_text. | ALTER TABLE public."exam_question_versions" ADD COLUMN "preview_text" text NOT NULL |
| columns | columns:public.exam_question_versions.created_by. | ALTER TABLE public."exam_question_versions" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.exam_question_versions.created_at. | ALTER TABLE public."exam_question_versions" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.lesson_note_documents.id. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.lesson_note_documents.school_id. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.lesson_note_documents.lesson_note_id. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "lesson_note_id" integer NOT NULL |
| columns | columns:public.lesson_note_documents.note_revision. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "note_revision" integer NOT NULL |
| columns | columns:public.lesson_note_documents.filename. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "filename" text NOT NULL |
| columns | columns:public.lesson_note_documents.byte_size. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "byte_size" integer NOT NULL |
| columns | columns:public.lesson_note_documents.staging_path. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "staging_path" text NOT NULL |
| columns | columns:public.lesson_note_documents.object_path. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "object_path" text NOT NULL |
| columns | columns:public.lesson_note_documents.sha256. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "sha256" text |
| columns | columns:public.lesson_note_documents.context. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "context" jsonb NOT NULL |
| columns | columns:public.lesson_note_documents.status. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.lesson_note_documents.uploaded_by. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "uploaded_by" integer NOT NULL |
| columns | columns:public.lesson_note_documents.expires_at. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "expires_at" timestamp with time zone NOT NULL |
| columns | columns:public.lesson_note_documents.created_at. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.lesson_note_documents.ready_at. | ALTER TABLE public."lesson_note_documents" ADD COLUMN "ready_at" timestamp with time zone |
| columns | columns:public.lesson_note_reviews.id. | ALTER TABLE public."lesson_note_reviews" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.lesson_note_reviews.school_id. | ALTER TABLE public."lesson_note_reviews" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.lesson_note_reviews.lesson_note_id. | ALTER TABLE public."lesson_note_reviews" ADD COLUMN "lesson_note_id" integer NOT NULL |
| columns | columns:public.lesson_note_reviews.reviewer_user_id. | ALTER TABLE public."lesson_note_reviews" ADD COLUMN "reviewer_user_id" integer NOT NULL |
| columns | columns:public.lesson_note_reviews.decision. | ALTER TABLE public."lesson_note_reviews" ADD COLUMN "decision" text NOT NULL |
| columns | columns:public.lesson_note_reviews.comment. | ALTER TABLE public."lesson_note_reviews" ADD COLUMN "comment" text |
| columns | columns:public.lesson_note_reviews.note_revision. | ALTER TABLE public."lesson_note_reviews" ADD COLUMN "note_revision" integer NOT NULL |
| columns | columns:public.lesson_note_reviews.created_at. | ALTER TABLE public."lesson_note_reviews" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.lesson_notes.id. | ALTER TABLE public."lesson_notes" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.lesson_notes.school_id. | ALTER TABLE public."lesson_notes" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.lesson_notes.academic_session_id. | ALTER TABLE public."lesson_notes" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.lesson_notes.academic_term_id. | ALTER TABLE public."lesson_notes" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.lesson_notes.school_class_id. | ALTER TABLE public."lesson_notes" ADD COLUMN "school_class_id" integer NOT NULL |
| columns | columns:public.lesson_notes.subject_id. | ALTER TABLE public."lesson_notes" ADD COLUMN "subject_id" integer NOT NULL |
| columns | columns:public.lesson_notes.teacher_employee_id. | ALTER TABLE public."lesson_notes" ADD COLUMN "teacher_employee_id" integer NOT NULL |
| columns | columns:public.lesson_notes.section. | ALTER TABLE public."lesson_notes" ADD COLUMN "section" text |
| columns | columns:public.lesson_notes.week. | ALTER TABLE public."lesson_notes" ADD COLUMN "week" integer NOT NULL |
| columns | columns:public.lesson_notes.lesson_date. | ALTER TABLE public."lesson_notes" ADD COLUMN "lesson_date" date NOT NULL |
| columns | columns:public.lesson_notes.curriculum_mapping_id. | ALTER TABLE public."lesson_notes" ADD COLUMN "curriculum_mapping_id" integer |
| columns | columns:public.lesson_notes.curriculum_version_id. | ALTER TABLE public."lesson_notes" ADD COLUMN "curriculum_version_id" integer |
| columns | columns:public.lesson_notes.topic_id. | ALTER TABLE public."lesson_notes" ADD COLUMN "topic_id" integer |
| columns | columns:public.lesson_notes.sub_topic_id. | ALTER TABLE public."lesson_notes" ADD COLUMN "sub_topic_id" integer |
| columns | columns:public.lesson_notes.content. | ALTER TABLE public."lesson_notes" ADD COLUMN "content" jsonb NOT NULL |
| columns | columns:public.lesson_notes.status. | ALTER TABLE public."lesson_notes" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.lesson_notes.revision. | ALTER TABLE public."lesson_notes" ADD COLUMN "revision" integer NOT NULL |
| columns | columns:public.lesson_notes.created_by. | ALTER TABLE public."lesson_notes" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.lesson_notes.submitted_at. | ALTER TABLE public."lesson_notes" ADD COLUMN "submitted_at" timestamp with time zone |
| columns | columns:public.lesson_notes.approved_at. | ALTER TABLE public."lesson_notes" ADD COLUMN "approved_at" timestamp with time zone |
| columns | columns:public.lesson_notes.created_at. | ALTER TABLE public."lesson_notes" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.lesson_notes.updated_at. | ALTER TABLE public."lesson_notes" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.promotion_batch_students.id. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.promotion_batch_students.school_id. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.promotion_batch_students.batch_id. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "batch_id" integer NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_versions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.exam_question_papers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.exam_question_reviews; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.exam_question_versions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.lesson_note_documents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.lesson_note_reviews; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.lesson_notes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.promotion_batch_students; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0094_reconcile_columns_e_3.sql

- [ ] Hash matches **443be36c2b3b586a77a862e3f75f7b2b31ff3918f5b728194ef526911892d44a**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0065_reconcile_sequences_e_1.sql, 0073_reconcile_table_shells_e_1.sql.
- [ ] Required objects verified: tables:public..promotion_batch_students.; tables:public..promotion_batches.; sequences:public.promotion_batches.promotion_batches_id_seq.; tables:public..promotion_history.; sequences:public.promotion_history.promotion_history_id_seq.; tables:public..school_curriculum_assignments.; sequences:public.school_curriculum_assignments.school_curriculum_assignments_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.promotion_batch_students.student_id. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.promotion_batch_students.student_name_snapshot. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "student_name_snapshot" text NOT NULL |
| columns | columns:public.promotion_batch_students.admission_no_snapshot. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "admission_no_snapshot" text NOT NULL |
| columns | columns:public.promotion_batch_students.source_assignment_id. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "source_assignment_id" integer NOT NULL |
| columns | columns:public.promotion_batch_students.source_session_id. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "source_session_id" integer NOT NULL |
| columns | columns:public.promotion_batch_students.source_term_id. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "source_term_id" integer |
| columns | columns:public.promotion_batch_students.source_class_id. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "source_class_id" integer NOT NULL |
| columns | columns:public.promotion_batch_students.source_class_name. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "source_class_name" text NOT NULL |
| columns | columns:public.promotion_batch_students.source_section. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "source_section" text NOT NULL |
| columns | columns:public.promotion_batch_students.recommendation. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "recommendation" text NOT NULL |
| columns | columns:public.promotion_batch_students.status. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.promotion_batch_students.reason. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "reason" text |
| columns | columns:public.promotion_batch_students.academic_performance. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "academic_performance" jsonb NOT NULL |
| columns | columns:public.promotion_batch_students.attendance_summary. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "attendance_summary" jsonb NOT NULL |
| columns | columns:public.promotion_batch_students.target_term_id. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "target_term_id" integer |
| columns | columns:public.promotion_batch_students.target_class_id. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "target_class_id" integer |
| columns | columns:public.promotion_batch_students.target_section. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "target_section" text |
| columns | columns:public.promotion_batch_students.reviewed_by. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "reviewed_by" integer |
| columns | columns:public.promotion_batch_students.reviewed_at. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "reviewed_at" timestamp with time zone |
| columns | columns:public.promotion_batch_students.finalized_at. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "finalized_at" timestamp with time zone |
| columns | columns:public.promotion_batch_students.created_at. | ALTER TABLE public."promotion_batch_students" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.promotion_batches.id. | ALTER TABLE public."promotion_batches" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.promotion_batches.school_id. | ALTER TABLE public."promotion_batches" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.promotion_batches.source_session_id. | ALTER TABLE public."promotion_batches" ADD COLUMN "source_session_id" integer NOT NULL |
| columns | columns:public.promotion_batches.target_session_id. | ALTER TABLE public."promotion_batches" ADD COLUMN "target_session_id" integer NOT NULL |
| columns | columns:public.promotion_batches.status. | ALTER TABLE public."promotion_batches" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.promotion_batches.idempotency_actor_user_id. | ALTER TABLE public."promotion_batches" ADD COLUMN "idempotency_actor_user_id" integer NOT NULL |
| columns | columns:public.promotion_batches.idempotency_key. | ALTER TABLE public."promotion_batches" ADD COLUMN "idempotency_key" text NOT NULL |
| columns | columns:public.promotion_batches.prepared_by. | ALTER TABLE public."promotion_batches" ADD COLUMN "prepared_by" integer NOT NULL |
| columns | columns:public.promotion_batches.created_at. | ALTER TABLE public."promotion_batches" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.promotion_batches.finalized_by. | ALTER TABLE public."promotion_batches" ADD COLUMN "finalized_by" integer |
| columns | columns:public.promotion_batches.finalized_at. | ALTER TABLE public."promotion_batches" ADD COLUMN "finalized_at" timestamp with time zone |
| columns | columns:public.promotion_batches.finalization_actor_user_id. | ALTER TABLE public."promotion_batches" ADD COLUMN "finalization_actor_user_id" integer |
| columns | columns:public.promotion_batches.finalization_idempotency_key. | ALTER TABLE public."promotion_batches" ADD COLUMN "finalization_idempotency_key" text |
| columns | columns:public.promotion_history.id. | ALTER TABLE public."promotion_history" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.promotion_history.school_id. | ALTER TABLE public."promotion_history" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.promotion_history.batch_id. | ALTER TABLE public."promotion_history" ADD COLUMN "batch_id" integer |
| columns | columns:public.promotion_history.batch_student_id. | ALTER TABLE public."promotion_history" ADD COLUMN "batch_student_id" integer |
| columns | columns:public.promotion_history.student_id. | ALTER TABLE public."promotion_history" ADD COLUMN "student_id" integer |
| columns | columns:public.promotion_history.actor_user_id. | ALTER TABLE public."promotion_history" ADD COLUMN "actor_user_id" integer |
| columns | columns:public.promotion_history.event_type. | ALTER TABLE public."promotion_history" ADD COLUMN "event_type" text NOT NULL |
| columns | columns:public.promotion_history.result. | ALTER TABLE public."promotion_history" ADD COLUMN "result" text NOT NULL |
| columns | columns:public.promotion_history.metadata. | ALTER TABLE public."promotion_history" ADD COLUMN "metadata" jsonb NOT NULL |
| columns | columns:public.promotion_history.created_at. | ALTER TABLE public."promotion_history" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_curriculum_assignments.id. | ALTER TABLE public."school_curriculum_assignments" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_curriculum_assignments.school_id. | ALTER TABLE public."school_curriculum_assignments" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_curriculum_assignments.curriculum_version_id. | ALTER TABLE public."school_curriculum_assignments" ADD COLUMN "curriculum_version_id" integer NOT NULL |
| columns | columns:public.school_curriculum_assignments.school_class_id. | ALTER TABLE public."school_curriculum_assignments" ADD COLUMN "school_class_id" integer NOT NULL |
| columns | columns:public.school_curriculum_assignments.subject_id. | ALTER TABLE public."school_curriculum_assignments" ADD COLUMN "subject_id" integer NOT NULL |
| columns | columns:public.school_curriculum_assignments.academic_session_id. | ALTER TABLE public."school_curriculum_assignments" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.school_curriculum_assignments.academic_term_id. | ALTER TABLE public."school_curriculum_assignments" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.school_curriculum_assignments.status. | ALTER TABLE public."school_curriculum_assignments" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.school_curriculum_assignments.confirmed_by. | ALTER TABLE public."school_curriculum_assignments" ADD COLUMN "confirmed_by" integer NOT NULL |
| columns | columns:public.school_curriculum_assignments.confirmed_at. | ALTER TABLE public."school_curriculum_assignments" ADD COLUMN "confirmed_at" timestamp with time zone NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.promotion_batch_students; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.promotion_batches; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.promotion_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_curriculum_assignments; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0095_reconcile_columns_f_1.sql

- [ ] Hash matches **bbbcadb1bc353bdfd7bda4218785a456785847d95d9897116dc47c92beabc02d**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0066_reconcile_sequences_f_1.sql, 0074_reconcile_table_shells_f_1.sql.
- [ ] Required objects verified: tables:public..fee_categories.; sequences:public.fee_categories.fee_categories_id_seq.; tables:public..fee_invoices.; sequences:public.fee_invoices.fee_invoices_id_seq.; tables:public..fee_payment_line_allocations.; sequences:public.fee_payment_line_allocations.fee_payment_line_allocations_id_seq.; tables:public..fee_payments.; sequences:public.fee_payments.fee_payments_id_seq.; tables:public..payroll_employee_profiles.; sequences:public.payroll_employee_profiles.payroll_employee_profiles_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **4**; IDs 516, 518, 555, 560. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.fee_categories.id. | ALTER TABLE public."fee_categories" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_categories.school_id. | ALTER TABLE public."fee_categories" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_categories.name. | ALTER TABLE public."fee_categories" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.fee_categories.description. | ALTER TABLE public."fee_categories" ADD COLUMN "description" text |
| columns | columns:public.fee_categories.compulsory. | ALTER TABLE public."fee_categories" ADD COLUMN "compulsory" boolean NOT NULL |
| columns | columns:public.fee_categories.status. | ALTER TABLE public."fee_categories" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.fee_categories.created_by. | ALTER TABLE public."fee_categories" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.fee_categories.created_at. | ALTER TABLE public."fee_categories" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_categories.updated_at. | ALTER TABLE public."fee_categories" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_categories.transport_only. | ALTER TABLE public."fee_categories" ADD COLUMN "transport_only" boolean NOT NULL |
| columns | columns:public.fee_invoices.id. | ALTER TABLE public."fee_invoices" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_invoices.school_id. | ALTER TABLE public."fee_invoices" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_invoices.student_id. | ALTER TABLE public."fee_invoices" ADD COLUMN "student_id" integer |
| columns | columns:public.fee_invoices.parent_id. | ALTER TABLE public."fee_invoices" ADD COLUMN "parent_id" integer |
| columns | columns:public.fee_invoices.structure_id. | ALTER TABLE public."fee_invoices" ADD COLUMN "structure_id" integer |
| columns | columns:public.fee_invoices.academic_session_id. | ALTER TABLE public."fee_invoices" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.fee_invoices.academic_term_id. | ALTER TABLE public."fee_invoices" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.fee_invoices.invoice_number. | ALTER TABLE public."fee_invoices" ADD COLUMN "invoice_number" text NOT NULL |
| columns | columns:public.fee_invoices.student_name_snapshot. | ALTER TABLE public."fee_invoices" ADD COLUMN "student_name_snapshot" text NOT NULL |
| columns | columns:public.fee_invoices.admission_no_snapshot. | ALTER TABLE public."fee_invoices" ADD COLUMN "admission_no_snapshot" text NOT NULL |
| columns | columns:public.fee_invoices.class_name_snapshot. | ALTER TABLE public."fee_invoices" ADD COLUMN "class_name_snapshot" text NOT NULL |
| columns | columns:public.fee_invoices.section_snapshot. | ALTER TABLE public."fee_invoices" ADD COLUMN "section_snapshot" text NOT NULL |
| columns | columns:public.fee_invoices.issue_date. | ALTER TABLE public."fee_invoices" ADD COLUMN "issue_date" date NOT NULL |
| columns | columns:public.fee_invoices.due_date. | ALTER TABLE public."fee_invoices" ADD COLUMN "due_date" date NOT NULL |
| columns | columns:public.fee_invoices.currency. | ALTER TABLE public."fee_invoices" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.fee_invoices.subtotal_minor. | ALTER TABLE public."fee_invoices" ADD COLUMN "subtotal_minor" integer NOT NULL |
| columns | columns:public.fee_invoices.discount_minor. | ALTER TABLE public."fee_invoices" ADD COLUMN "discount_minor" integer NOT NULL |
| columns | columns:public.fee_invoices.waiver_minor. | ALTER TABLE public."fee_invoices" ADD COLUMN "waiver_minor" integer NOT NULL |
| columns | columns:public.fee_invoices.total_minor. | ALTER TABLE public."fee_invoices" ADD COLUMN "total_minor" integer NOT NULL |
| columns | columns:public.fee_invoices.paid_minor. | ALTER TABLE public."fee_invoices" ADD COLUMN "paid_minor" integer NOT NULL |
| columns | columns:public.fee_invoices.outstanding_minor. | ALTER TABLE public."fee_invoices" ADD COLUMN "outstanding_minor" integer NOT NULL |
| columns | columns:public.fee_invoices.status. | ALTER TABLE public."fee_invoices" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.fee_invoices.created_by. | ALTER TABLE public."fee_invoices" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.fee_invoices.created_at. | ALTER TABLE public."fee_invoices" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_invoices.employee_id. | ALTER TABLE public."fee_invoices" ADD COLUMN "employee_id" integer |
| columns | columns:public.fee_payment_line_allocations.id. | ALTER TABLE public."fee_payment_line_allocations" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_payment_line_allocations.school_id. | ALTER TABLE public."fee_payment_line_allocations" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_payment_line_allocations.invoice_id. | ALTER TABLE public."fee_payment_line_allocations" ADD COLUMN "invoice_id" integer NOT NULL |
| columns | columns:public.fee_payment_line_allocations.payment_id. | ALTER TABLE public."fee_payment_line_allocations" ADD COLUMN "payment_id" integer NOT NULL |
| columns | columns:public.fee_payment_line_allocations.line_id. | ALTER TABLE public."fee_payment_line_allocations" ADD COLUMN "line_id" integer NOT NULL |
| columns | columns:public.fee_payment_line_allocations.amount_minor. | ALTER TABLE public."fee_payment_line_allocations" ADD COLUMN "amount_minor" integer NOT NULL |
| columns | columns:public.fee_payment_line_allocations.created_at. | ALTER TABLE public."fee_payment_line_allocations" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_payments.id. | ALTER TABLE public."fee_payments" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.fee_payments.school_id. | ALTER TABLE public."fee_payments" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.fee_payments.invoice_id. | ALTER TABLE public."fee_payments" ADD COLUMN "invoice_id" integer NOT NULL |
| columns | columns:public.fee_payments.student_id. | ALTER TABLE public."fee_payments" ADD COLUMN "student_id" integer |
| columns | columns:public.fee_payments.parent_id. | ALTER TABLE public."fee_payments" ADD COLUMN "parent_id" integer |
| columns | columns:public.fee_payments.reference. | ALTER TABLE public."fee_payments" ADD COLUMN "reference" text NOT NULL |
| columns | columns:public.fee_payments.idempotency_key. | ALTER TABLE public."fee_payments" ADD COLUMN "idempotency_key" text NOT NULL |
| columns | columns:public.fee_payments.amount_minor. | ALTER TABLE public."fee_payments" ADD COLUMN "amount_minor" integer NOT NULL |
| columns | columns:public.fee_payments.currency. | ALTER TABLE public."fee_payments" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.fee_payments.method. | ALTER TABLE public."fee_payments" ADD COLUMN "method" text NOT NULL |
| columns | columns:public.fee_payments.provider. | ALTER TABLE public."fee_payments" ADD COLUMN "provider" text NOT NULL |
| columns | columns:public.fee_payments.provider_transaction_id. | ALTER TABLE public."fee_payments" ADD COLUMN "provider_transaction_id" text |
| columns | columns:public.fee_payments.status. | ALTER TABLE public."fee_payments" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.fee_payments.transfer_bank. | ALTER TABLE public."fee_payments" ADD COLUMN "transfer_bank" text |
| columns | columns:public.fee_payments.transfer_reference. | ALTER TABLE public."fee_payments" ADD COLUMN "transfer_reference" text |
| columns | columns:public.fee_payments.transfer_date. | ALTER TABLE public."fee_payments" ADD COLUMN "transfer_date" date |
| columns | columns:public.fee_payments.proof_url. | ALTER TABLE public."fee_payments" ADD COLUMN "proof_url" text |
| columns | columns:public.fee_payments.submitted_by. | ALTER TABLE public."fee_payments" ADD COLUMN "submitted_by" integer NOT NULL |
| columns | columns:public.fee_payments.verified_by. | ALTER TABLE public."fee_payments" ADD COLUMN "verified_by" integer |
| columns | columns:public.fee_payments.verified_at. | ALTER TABLE public."fee_payments" ADD COLUMN "verified_at" timestamp with time zone |
| columns | columns:public.fee_payments.verification_evidence_ref. | ALTER TABLE public."fee_payments" ADD COLUMN "verification_evidence_ref" text |
| columns | columns:public.fee_payments.reviewer_notes. | ALTER TABLE public."fee_payments" ADD COLUMN "reviewer_notes" text |
| columns | columns:public.fee_payments.verification_metadata. | ALTER TABLE public."fee_payments" ADD COLUMN "verification_metadata" jsonb |
| columns | columns:public.fee_payments.rejection_reason. | ALTER TABLE public."fee_payments" ADD COLUMN "rejection_reason" text |
| columns | columns:public.fee_payments.provider_metadata. | ALTER TABLE public."fee_payments" ADD COLUMN "provider_metadata" jsonb |
| columns | columns:public.fee_payments.created_at. | ALTER TABLE public."fee_payments" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.fee_payments.employee_id. | ALTER TABLE public."fee_payments" ADD COLUMN "employee_id" integer |
| columns | columns:public.fee_payments.selected_line_ids. | ALTER TABLE public."fee_payments" ADD COLUMN "selected_line_ids" integer[] |
| columns | columns:public.payroll_employee_profiles.id. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.payroll_employee_profiles.scope. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "scope" text NOT NULL |
| columns | columns:public.payroll_employee_profiles.school_id. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "school_id" integer |
| columns | columns:public.payroll_employee_profiles.employee_id. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "employee_id" integer |
| columns | columns:public.payroll_employee_profiles.company_employee_id. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "company_employee_id" integer |
| columns | columns:public.payroll_employee_profiles.monthly_salary_minor. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "monthly_salary_minor" integer NOT NULL |
| columns | columns:public.payroll_employee_profiles.allowance_minor. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "allowance_minor" integer NOT NULL |
| columns | columns:public.payroll_employee_profiles.deduction_minor. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "deduction_minor" integer NOT NULL |
| columns | columns:public.payroll_employee_profiles.currency. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.payroll_employee_profiles.bank_name_encrypted. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "bank_name_encrypted" text NOT NULL |
| columns | columns:public.payroll_employee_profiles.bank_code_encrypted. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "bank_code_encrypted" text NOT NULL |
| columns | columns:public.payroll_employee_profiles.account_name_encrypted. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "account_name_encrypted" text NOT NULL |
| columns | columns:public.payroll_employee_profiles.account_number_encrypted. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "account_number_encrypted" text NOT NULL |
| columns | columns:public.payroll_employee_profiles.account_last4. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "account_last4" text NOT NULL |
| columns | columns:public.payroll_employee_profiles.encryption_key_version. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "encryption_key_version" text NOT NULL |
| columns | columns:public.payroll_employee_profiles.status. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.payroll_employee_profiles.created_by. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.payroll_employee_profiles.updated_by. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "updated_by" integer NOT NULL |
| columns | columns:public.payroll_employee_profiles.created_at. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.payroll_employee_profiles.updated_at. | ALTER TABLE public."payroll_employee_profiles" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.fee_categories; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payment_line_allocations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_employee_profiles; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs 516, 518, 555, 560
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0096_reconcile_columns_f_2.sql

- [ ] Hash matches **4726d7fe7b7e709ebeac506cc09cf5bddcbbcf8f3975a9dfb3ffed44640eae91**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0066_reconcile_sequences_f_1.sql, 0074_reconcile_table_shells_f_1.sql.
- [ ] Required objects verified: tables:public..payroll_items.; sequences:public.payroll_items.payroll_items_id_seq.; tables:public..payroll_payslips.; sequences:public.payroll_payslips.payroll_payslips_id_seq.; tables:public..payroll_periods.; sequences:public.payroll_periods.payroll_periods_id_seq.; tables:public..payroll_transfers.; sequences:public.payroll_transfers.payroll_transfers_id_seq.; tables:public..school_subscription_enforcement..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.payroll_items.id. | ALTER TABLE public."payroll_items" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.payroll_items.scope. | ALTER TABLE public."payroll_items" ADD COLUMN "scope" text NOT NULL |
| columns | columns:public.payroll_items.school_id. | ALTER TABLE public."payroll_items" ADD COLUMN "school_id" integer |
| columns | columns:public.payroll_items.period_id. | ALTER TABLE public."payroll_items" ADD COLUMN "period_id" integer NOT NULL |
| columns | columns:public.payroll_items.employee_profile_id. | ALTER TABLE public."payroll_items" ADD COLUMN "employee_profile_id" integer NOT NULL |
| columns | columns:public.payroll_items.period_month. | ALTER TABLE public."payroll_items" ADD COLUMN "period_month" text NOT NULL |
| columns | columns:public.payroll_items.employee_name_snapshot. | ALTER TABLE public."payroll_items" ADD COLUMN "employee_name_snapshot" text NOT NULL |
| columns | columns:public.payroll_items.employee_number_snapshot. | ALTER TABLE public."payroll_items" ADD COLUMN "employee_number_snapshot" text |
| columns | columns:public.payroll_items.role_snapshot. | ALTER TABLE public."payroll_items" ADD COLUMN "role_snapshot" text NOT NULL |
| columns | columns:public.payroll_items.base_salary_minor. | ALTER TABLE public."payroll_items" ADD COLUMN "base_salary_minor" integer NOT NULL |
| columns | columns:public.payroll_items.allowance_minor. | ALTER TABLE public."payroll_items" ADD COLUMN "allowance_minor" integer NOT NULL |
| columns | columns:public.payroll_items.bonus_minor. | ALTER TABLE public."payroll_items" ADD COLUMN "bonus_minor" integer NOT NULL |
| columns | columns:public.payroll_items.deduction_minor. | ALTER TABLE public."payroll_items" ADD COLUMN "deduction_minor" integer NOT NULL |
| columns | columns:public.payroll_items.adjustment_minor. | ALTER TABLE public."payroll_items" ADD COLUMN "adjustment_minor" integer NOT NULL |
| columns | columns:public.payroll_items.adjustment_reason. | ALTER TABLE public."payroll_items" ADD COLUMN "adjustment_reason" text |
| columns | columns:public.payroll_items.net_salary_minor. | ALTER TABLE public."payroll_items" ADD COLUMN "net_salary_minor" integer NOT NULL |
| columns | columns:public.payroll_items.currency. | ALTER TABLE public."payroll_items" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.payroll_items.bank_name_encrypted. | ALTER TABLE public."payroll_items" ADD COLUMN "bank_name_encrypted" text NOT NULL |
| columns | columns:public.payroll_items.bank_code_encrypted. | ALTER TABLE public."payroll_items" ADD COLUMN "bank_code_encrypted" text NOT NULL |
| columns | columns:public.payroll_items.account_name_encrypted. | ALTER TABLE public."payroll_items" ADD COLUMN "account_name_encrypted" text NOT NULL |
| columns | columns:public.payroll_items.account_number_encrypted. | ALTER TABLE public."payroll_items" ADD COLUMN "account_number_encrypted" text NOT NULL |
| columns | columns:public.payroll_items.account_last4. | ALTER TABLE public."payroll_items" ADD COLUMN "account_last4" text NOT NULL |
| columns | columns:public.payroll_items.encryption_key_version. | ALTER TABLE public."payroll_items" ADD COLUMN "encryption_key_version" text NOT NULL |
| columns | columns:public.payroll_items.created_at. | ALTER TABLE public."payroll_items" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.payroll_items.updated_at. | ALTER TABLE public."payroll_items" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.payroll_payslips.id. | ALTER TABLE public."payroll_payslips" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.payroll_payslips.scope. | ALTER TABLE public."payroll_payslips" ADD COLUMN "scope" text NOT NULL |
| columns | columns:public.payroll_payslips.school_id. | ALTER TABLE public."payroll_payslips" ADD COLUMN "school_id" integer |
| columns | columns:public.payroll_payslips.period_id. | ALTER TABLE public."payroll_payslips" ADD COLUMN "period_id" integer NOT NULL |
| columns | columns:public.payroll_payslips.payroll_item_id. | ALTER TABLE public."payroll_payslips" ADD COLUMN "payroll_item_id" integer NOT NULL |
| columns | columns:public.payroll_payslips.transfer_id. | ALTER TABLE public."payroll_payslips" ADD COLUMN "transfer_id" integer NOT NULL |
| columns | columns:public.payroll_payslips.payslip_number. | ALTER TABLE public."payroll_payslips" ADD COLUMN "payslip_number" text NOT NULL |
| columns | columns:public.payroll_payslips.employee_name_snapshot. | ALTER TABLE public."payroll_payslips" ADD COLUMN "employee_name_snapshot" text NOT NULL |
| columns | columns:public.payroll_payslips.employee_role_snapshot. | ALTER TABLE public."payroll_payslips" ADD COLUMN "employee_role_snapshot" text NOT NULL |
| columns | columns:public.payroll_payslips.period_month. | ALTER TABLE public."payroll_payslips" ADD COLUMN "period_month" text NOT NULL |
| columns | columns:public.payroll_payslips.base_salary_minor. | ALTER TABLE public."payroll_payslips" ADD COLUMN "base_salary_minor" integer NOT NULL |
| columns | columns:public.payroll_payslips.allowance_minor. | ALTER TABLE public."payroll_payslips" ADD COLUMN "allowance_minor" integer NOT NULL |
| columns | columns:public.payroll_payslips.bonus_minor. | ALTER TABLE public."payroll_payslips" ADD COLUMN "bonus_minor" integer NOT NULL |
| columns | columns:public.payroll_payslips.deduction_minor. | ALTER TABLE public."payroll_payslips" ADD COLUMN "deduction_minor" integer NOT NULL |
| columns | columns:public.payroll_payslips.adjustment_minor. | ALTER TABLE public."payroll_payslips" ADD COLUMN "adjustment_minor" integer NOT NULL |
| columns | columns:public.payroll_payslips.net_salary_minor. | ALTER TABLE public."payroll_payslips" ADD COLUMN "net_salary_minor" integer NOT NULL |
| columns | columns:public.payroll_payslips.currency. | ALTER TABLE public."payroll_payslips" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.payroll_payslips.issued_at. | ALTER TABLE public."payroll_payslips" ADD COLUMN "issued_at" timestamp with time zone NOT NULL |
| columns | columns:public.payroll_periods.id. | ALTER TABLE public."payroll_periods" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.payroll_periods.scope. | ALTER TABLE public."payroll_periods" ADD COLUMN "scope" text NOT NULL |
| columns | columns:public.payroll_periods.school_id. | ALTER TABLE public."payroll_periods" ADD COLUMN "school_id" integer |
| columns | columns:public.payroll_periods.period_month. | ALTER TABLE public."payroll_periods" ADD COLUMN "period_month" text NOT NULL |
| columns | columns:public.payroll_periods.status. | ALTER TABLE public."payroll_periods" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.payroll_periods.employee_count. | ALTER TABLE public."payroll_periods" ADD COLUMN "employee_count" integer NOT NULL |
| columns | columns:public.payroll_periods.gross_salary_minor. | ALTER TABLE public."payroll_periods" ADD COLUMN "gross_salary_minor" integer NOT NULL |
| columns | columns:public.payroll_periods.allowance_minor. | ALTER TABLE public."payroll_periods" ADD COLUMN "allowance_minor" integer NOT NULL |
| columns | columns:public.payroll_periods.bonus_minor. | ALTER TABLE public."payroll_periods" ADD COLUMN "bonus_minor" integer NOT NULL |
| columns | columns:public.payroll_periods.deduction_minor. | ALTER TABLE public."payroll_periods" ADD COLUMN "deduction_minor" integer NOT NULL |
| columns | columns:public.payroll_periods.adjustment_minor. | ALTER TABLE public."payroll_periods" ADD COLUMN "adjustment_minor" integer NOT NULL |
| columns | columns:public.payroll_periods.net_salary_minor. | ALTER TABLE public."payroll_periods" ADD COLUMN "net_salary_minor" integer NOT NULL |
| columns | columns:public.payroll_periods.created_by. | ALTER TABLE public."payroll_periods" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.payroll_periods.submitted_by. | ALTER TABLE public."payroll_periods" ADD COLUMN "submitted_by" integer |
| columns | columns:public.payroll_periods.submitted_at. | ALTER TABLE public."payroll_periods" ADD COLUMN "submitted_at" timestamp with time zone |
| columns | columns:public.payroll_periods.approved_by. | ALTER TABLE public."payroll_periods" ADD COLUMN "approved_by" integer |
| columns | columns:public.payroll_periods.approved_at. | ALTER TABLE public."payroll_periods" ADD COLUMN "approved_at" timestamp with time zone |
| columns | columns:public.payroll_periods.created_at. | ALTER TABLE public."payroll_periods" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.payroll_periods.updated_at. | ALTER TABLE public."payroll_periods" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.payroll_transfers.id. | ALTER TABLE public."payroll_transfers" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.payroll_transfers.scope. | ALTER TABLE public."payroll_transfers" ADD COLUMN "scope" text NOT NULL |
| columns | columns:public.payroll_transfers.school_id. | ALTER TABLE public."payroll_transfers" ADD COLUMN "school_id" integer |
| columns | columns:public.payroll_transfers.period_id. | ALTER TABLE public."payroll_transfers" ADD COLUMN "period_id" integer NOT NULL |
| columns | columns:public.payroll_transfers.payroll_item_id. | ALTER TABLE public."payroll_transfers" ADD COLUMN "payroll_item_id" integer NOT NULL |
| columns | columns:public.payroll_transfers.attempt_number. | ALTER TABLE public."payroll_transfers" ADD COLUMN "attempt_number" integer NOT NULL |
| columns | columns:public.payroll_transfers.idempotency_key_hash. | ALTER TABLE public."payroll_transfers" ADD COLUMN "idempotency_key_hash" text NOT NULL |
| columns | columns:public.payroll_transfers.provider. | ALTER TABLE public."payroll_transfers" ADD COLUMN "provider" text NOT NULL |
| columns | columns:public.payroll_transfers.provider_mode. | ALTER TABLE public."payroll_transfers" ADD COLUMN "provider_mode" text NOT NULL |
| columns | columns:public.payroll_transfers.provider_reference. | ALTER TABLE public."payroll_transfers" ADD COLUMN "provider_reference" text NOT NULL |
| columns | columns:public.payroll_transfers.provider_transaction_id. | ALTER TABLE public."payroll_transfers" ADD COLUMN "provider_transaction_id" text |
| columns | columns:public.payroll_transfers.amount_minor. | ALTER TABLE public."payroll_transfers" ADD COLUMN "amount_minor" integer NOT NULL |
| columns | columns:public.payroll_transfers.provider_fee_minor. | ALTER TABLE public."payroll_transfers" ADD COLUMN "provider_fee_minor" integer NOT NULL |
| columns | columns:public.payroll_transfers.settlement_amount_minor. | ALTER TABLE public."payroll_transfers" ADD COLUMN "settlement_amount_minor" integer NOT NULL |
| columns | columns:public.payroll_transfers.currency. | ALTER TABLE public."payroll_transfers" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.payroll_transfers.status. | ALTER TABLE public."payroll_transfers" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.payroll_transfers.requires_reconciliation. | ALTER TABLE public."payroll_transfers" ADD COLUMN "requires_reconciliation" boolean NOT NULL |
| columns | columns:public.payroll_transfers.external_transfer_verified. | ALTER TABLE public."payroll_transfers" ADD COLUMN "external_transfer_verified" boolean NOT NULL |
| columns | columns:public.payroll_transfers.provider_status. | ALTER TABLE public."payroll_transfers" ADD COLUMN "provider_status" text |
| columns | columns:public.payroll_transfers.failure_message. | ALTER TABLE public."payroll_transfers" ADD COLUMN "failure_message" text |
| columns | columns:public.payroll_transfers.requested_by. | ALTER TABLE public."payroll_transfers" ADD COLUMN "requested_by" integer NOT NULL |
| columns | columns:public.payroll_transfers.verified_by. | ALTER TABLE public."payroll_transfers" ADD COLUMN "verified_by" integer |
| columns | columns:public.payroll_transfers.verified_at. | ALTER TABLE public."payroll_transfers" ADD COLUMN "verified_at" timestamp with time zone |
| columns | columns:public.payroll_transfers.created_at. | ALTER TABLE public."payroll_transfers" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.payroll_transfers.updated_at. | ALTER TABLE public."payroll_transfers" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_subscription_enforcement.school_id. | ALTER TABLE public."school_subscription_enforcement" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_subscription_enforcement.academic_term_id. | ALTER TABLE public."school_subscription_enforcement" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.school_subscription_enforcement.restricted_student_ids. | ALTER TABLE public."school_subscription_enforcement" ADD COLUMN "restricted_student_ids" integer[] NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_items; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_payslips; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_periods; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_transfers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_subscription_enforcement; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0097_reconcile_columns_f_3.sql

- [ ] Hash matches **fc77e687511595eeee66b961bb41052c3097e0a5b8fbb70d2e939eb5a3850a84**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0066_reconcile_sequences_f_1.sql, 0074_reconcile_table_shells_f_1.sql.
- [ ] Required objects verified: tables:public..school_subscription_enforcement.; tables:public..school_subscription_manual_locks.; tables:public..settlement_payroll_audit_events.; sequences:public.settlement_payroll_audit_events.settlement_payroll_audit_events_id_seq.; tables:public..settlement_payroll_profiles.; sequences:public.settlement_payroll_profiles.settlement_payroll_profiles_id_seq.; tables:public..staff_nfc_allocations.; sequences:public.staff_nfc_allocations.staff_nfc_allocations_id_seq.; tables:public..staff_nfc_billing_rules.; sequences:public.staff_nfc_billing_rules.staff_nfc_billing_rules_id_seq.; tables:public..staff_nfc_partner_commissions.; sequences:public.staff_nfc_partner_commissions.staff_nfc_partner_commissions_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.school_subscription_enforcement.school_locked. | ALTER TABLE public."school_subscription_enforcement" ADD COLUMN "school_locked" boolean NOT NULL |
| columns | columns:public.school_subscription_enforcement.version. | ALTER TABLE public."school_subscription_enforcement" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.school_subscription_enforcement.snapshot. | ALTER TABLE public."school_subscription_enforcement" ADD COLUMN "snapshot" jsonb NOT NULL |
| columns | columns:public.school_subscription_enforcement.updated_at. | ALTER TABLE public."school_subscription_enforcement" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_subscription_manual_locks.school_id. | ALTER TABLE public."school_subscription_manual_locks" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_subscription_manual_locks.locked. | ALTER TABLE public."school_subscription_manual_locks" ADD COLUMN "locked" boolean NOT NULL |
| columns | columns:public.school_subscription_manual_locks.version. | ALTER TABLE public."school_subscription_manual_locks" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.school_subscription_manual_locks.locked_at. | ALTER TABLE public."school_subscription_manual_locks" ADD COLUMN "locked_at" timestamp with time zone |
| columns | columns:public.school_subscription_manual_locks.locked_by_user_id. | ALTER TABLE public."school_subscription_manual_locks" ADD COLUMN "locked_by_user_id" integer |
| columns | columns:public.school_subscription_manual_locks.last_unlocked_at. | ALTER TABLE public."school_subscription_manual_locks" ADD COLUMN "last_unlocked_at" timestamp with time zone |
| columns | columns:public.school_subscription_manual_locks.last_unlocked_by_user_id. | ALTER TABLE public."school_subscription_manual_locks" ADD COLUMN "last_unlocked_by_user_id" integer |
| columns | columns:public.school_subscription_manual_locks.reason. | ALTER TABLE public."school_subscription_manual_locks" ADD COLUMN "reason" text |
| columns | columns:public.school_subscription_manual_locks.updated_at. | ALTER TABLE public."school_subscription_manual_locks" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.settlement_payroll_audit_events.id. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.settlement_payroll_audit_events.scope. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "scope" text NOT NULL |
| columns | columns:public.settlement_payroll_audit_events.school_id. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "school_id" integer |
| columns | columns:public.settlement_payroll_audit_events.actor_user_id. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "actor_user_id" integer NOT NULL |
| columns | columns:public.settlement_payroll_audit_events.actor_role. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "actor_role" text NOT NULL |
| columns | columns:public.settlement_payroll_audit_events.record_type. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "record_type" text NOT NULL |
| columns | columns:public.settlement_payroll_audit_events.record_id. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "record_id" integer |
| columns | columns:public.settlement_payroll_audit_events.action. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "action" text NOT NULL |
| columns | columns:public.settlement_payroll_audit_events.amount_minor. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "amount_minor" integer |
| columns | columns:public.settlement_payroll_audit_events.currency. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "currency" text |
| columns | columns:public.settlement_payroll_audit_events.provider_reference. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "provider_reference" text |
| columns | columns:public.settlement_payroll_audit_events.previous_status. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "previous_status" text |
| columns | columns:public.settlement_payroll_audit_events.new_status. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "new_status" text |
| columns | columns:public.settlement_payroll_audit_events.metadata. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "metadata" jsonb NOT NULL |
| columns | columns:public.settlement_payroll_audit_events.occurred_at. | ALTER TABLE public."settlement_payroll_audit_events" ADD COLUMN "occurred_at" timestamp with time zone NOT NULL |
| columns | columns:public.settlement_payroll_profiles.id. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.settlement_payroll_profiles.scope. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "scope" text NOT NULL |
| columns | columns:public.settlement_payroll_profiles.school_id. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "school_id" integer |
| columns | columns:public.settlement_payroll_profiles.business_name. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "business_name" text NOT NULL |
| columns | columns:public.settlement_payroll_profiles.business_registration_number. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "business_registration_number" text |
| columns | columns:public.settlement_payroll_profiles.settlement_contact_email. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "settlement_contact_email" text NOT NULL |
| columns | columns:public.settlement_payroll_profiles.settlement_contact_phone. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "settlement_contact_phone" text |
| columns | columns:public.settlement_payroll_profiles.bank_name_encrypted. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "bank_name_encrypted" text NOT NULL |
| columns | columns:public.settlement_payroll_profiles.bank_code_encrypted. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "bank_code_encrypted" text NOT NULL |
| columns | columns:public.settlement_payroll_profiles.account_name_encrypted. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "account_name_encrypted" text NOT NULL |
| columns | columns:public.settlement_payroll_profiles.account_number_encrypted. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "account_number_encrypted" text NOT NULL |
| columns | columns:public.settlement_payroll_profiles.account_last4. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "account_last4" text NOT NULL |
| columns | columns:public.settlement_payroll_profiles.encryption_key_version. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "encryption_key_version" text NOT NULL |
| columns | columns:public.settlement_payroll_profiles.currency. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.settlement_payroll_profiles.provider. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "provider" text NOT NULL |
| columns | columns:public.settlement_payroll_profiles.provider_business_id. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "provider_business_id" text |
| columns | columns:public.settlement_payroll_profiles.provider_subaccount_id. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "provider_subaccount_id" text |
| columns | columns:public.settlement_payroll_profiles.verification_status. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "verification_status" text NOT NULL |
| columns | columns:public.settlement_payroll_profiles.verified_at. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "verified_at" timestamp with time zone |
| columns | columns:public.settlement_payroll_profiles.verified_by. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "verified_by" integer |
| columns | columns:public.settlement_payroll_profiles.created_by. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.settlement_payroll_profiles.updated_by. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "updated_by" integer NOT NULL |
| columns | columns:public.settlement_payroll_profiles.created_at. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.settlement_payroll_profiles.updated_at. | ALTER TABLE public."settlement_payroll_profiles" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.staff_nfc_allocations.id. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.staff_nfc_allocations.idempotency_key. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "idempotency_key" text NOT NULL |
| columns | columns:public.staff_nfc_allocations.entry_type. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "entry_type" text NOT NULL |
| columns | columns:public.staff_nfc_allocations.product. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "product" text NOT NULL |
| columns | columns:public.staff_nfc_allocations.recipient_type. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "recipient_type" text NOT NULL |
| columns | columns:public.staff_nfc_allocations.recipient_id. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "recipient_id" integer |
| columns | columns:public.staff_nfc_allocations.school_id. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.staff_nfc_allocations.employee_id. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "employee_id" integer NOT NULL |
| columns | columns:public.staff_nfc_allocations.academic_session_id. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.staff_nfc_allocations.academic_term_id. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.staff_nfc_allocations.subscription_id. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "subscription_id" integer NOT NULL |
| columns | columns:public.staff_nfc_allocations.payment_id. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "payment_id" integer NOT NULL |
| columns | columns:public.staff_nfc_allocations.refund_id. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "refund_id" integer |
| columns | columns:public.staff_nfc_allocations.allocation_rule_id. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "allocation_rule_id" integer NOT NULL |
| columns | columns:public.staff_nfc_allocations.billing_rule_version. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "billing_rule_version" integer NOT NULL |
| columns | columns:public.staff_nfc_allocations.attribution_id. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "attribution_id" integer |
| columns | columns:public.staff_nfc_allocations.amount_minor. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "amount_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_allocations.currency. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.staff_nfc_allocations.created_at. | ALTER TABLE public."staff_nfc_allocations" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.staff_nfc_billing_rules.id. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.staff_nfc_billing_rules.version. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.staff_nfc_billing_rules.product. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "product" text NOT NULL |
| columns | columns:public.staff_nfc_billing_rules.billing_frequency. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "billing_frequency" text NOT NULL |
| columns | columns:public.staff_nfc_billing_rules.price_minor. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "price_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_billing_rules.school_share_minor. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "school_share_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_billing_rules.platform_share_minor. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "platform_share_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_billing_rules.partner_commission_minor. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "partner_commission_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_billing_rules.no_partner_platform_share_minor. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "no_partner_platform_share_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_billing_rules.currency. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.staff_nfc_billing_rules.status. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.staff_nfc_billing_rules.effective_at. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "effective_at" timestamp with time zone NOT NULL |
| columns | columns:public.staff_nfc_billing_rules.created_by. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "created_by" integer |
| columns | columns:public.staff_nfc_billing_rules.created_at. | ALTER TABLE public."staff_nfc_billing_rules" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.staff_nfc_partner_commissions.id. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.staff_nfc_partner_commissions.allocation_id. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "allocation_id" integer NOT NULL |
| columns | columns:public.staff_nfc_partner_commissions.partner_profile_id. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "partner_profile_id" integer NOT NULL |
| columns | columns:public.staff_nfc_partner_commissions.school_id. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.staff_nfc_partner_commissions.employee_id. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "employee_id" integer NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.school_subscription_enforcement; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_subscription_manual_locks; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.settlement_payroll_audit_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.settlement_payroll_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_allocations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_billing_rules; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_partner_commissions; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0098_reconcile_columns_f_4.sql

- [ ] Hash matches **95dfa02c66f0b989ffbecce657a6e6d624725ca9336836e8087f1f9f859c9f9d**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0066_reconcile_sequences_f_1.sql, 0074_reconcile_table_shells_f_1.sql.
- [ ] Required objects verified: tables:public..staff_nfc_partner_commissions.; tables:public..staff_nfc_payments.; sequences:public.staff_nfc_payments.staff_nfc_payments_id_seq.; tables:public..staff_nfc_provider_events.; sequences:public.staff_nfc_provider_events.staff_nfc_provider_events_id_seq.; tables:public..staff_nfc_receipts.; sequences:public.staff_nfc_receipts.staff_nfc_receipts_id_seq.; tables:public..staff_nfc_refunds.; sequences:public.staff_nfc_refunds.staff_nfc_refunds_id_seq.; tables:public..staff_nfc_subscriptions.; sequences:public.staff_nfc_subscriptions.staff_nfc_subscriptions_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.staff_nfc_partner_commissions.academic_session_id. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.staff_nfc_partner_commissions.academic_term_id. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.staff_nfc_partner_commissions.subscription_id. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "subscription_id" integer NOT NULL |
| columns | columns:public.staff_nfc_partner_commissions.payment_id. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "payment_id" integer NOT NULL |
| columns | columns:public.staff_nfc_partner_commissions.recipient_type. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "recipient_type" text NOT NULL |
| columns | columns:public.staff_nfc_partner_commissions.commission_minor. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "commission_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_partner_commissions.currency. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.staff_nfc_partner_commissions.status. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.staff_nfc_partner_commissions.paid_at. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "paid_at" timestamp with time zone |
| columns | columns:public.staff_nfc_partner_commissions.payment_reference. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "payment_reference" text |
| columns | columns:public.staff_nfc_partner_commissions.created_at. | ALTER TABLE public."staff_nfc_partner_commissions" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.staff_nfc_payments.id. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.staff_nfc_payments.subscription_id. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "subscription_id" integer NOT NULL |
| columns | columns:public.staff_nfc_payments.employee_id. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "employee_id" integer NOT NULL |
| columns | columns:public.staff_nfc_payments.school_id. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.staff_nfc_payments.academic_session_id. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.staff_nfc_payments.academic_term_id. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.staff_nfc_payments.provider. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "provider" text NOT NULL |
| columns | columns:public.staff_nfc_payments.provider_mode. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "provider_mode" text NOT NULL |
| columns | columns:public.staff_nfc_payments.reference. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "reference" text NOT NULL |
| columns | columns:public.staff_nfc_payments.idempotency_key. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "idempotency_key" text NOT NULL |
| columns | columns:public.staff_nfc_payments.gross_amount_minor. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "gross_amount_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_payments.provider_fee_minor. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "provider_fee_minor" integer |
| columns | columns:public.staff_nfc_payments.settlement_amount_minor. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "settlement_amount_minor" integer |
| columns | columns:public.staff_nfc_payments.refunded_amount_minor. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "refunded_amount_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_payments.currency. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.staff_nfc_payments.status. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.staff_nfc_payments.settlement_status. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "settlement_status" text NOT NULL |
| columns | columns:public.staff_nfc_payments.reconciliation_status. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "reconciliation_status" text NOT NULL |
| columns | columns:public.staff_nfc_payments.refund_status. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "refund_status" text NOT NULL |
| columns | columns:public.staff_nfc_payments.checkout_url. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "checkout_url" text |
| columns | columns:public.staff_nfc_payments.provider_transaction_id. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "provider_transaction_id" text |
| columns | columns:public.staff_nfc_payments.provider_paid_at. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "provider_paid_at" timestamp with time zone |
| columns | columns:public.staff_nfc_payments.paid_at. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "paid_at" timestamp with time zone |
| columns | columns:public.staff_nfc_payments.failure_code. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "failure_code" text |
| columns | columns:public.staff_nfc_payments.created_by. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "created_by" integer |
| columns | columns:public.staff_nfc_payments.created_at. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.staff_nfc_payments.updated_at. | ALTER TABLE public."staff_nfc_payments" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.staff_nfc_provider_events.id. | ALTER TABLE public."staff_nfc_provider_events" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.staff_nfc_provider_events.provider. | ALTER TABLE public."staff_nfc_provider_events" ADD COLUMN "provider" text NOT NULL |
| columns | columns:public.staff_nfc_provider_events.event_id. | ALTER TABLE public."staff_nfc_provider_events" ADD COLUMN "event_id" text NOT NULL |
| columns | columns:public.staff_nfc_provider_events.provider_reference. | ALTER TABLE public."staff_nfc_provider_events" ADD COLUMN "provider_reference" text NOT NULL |
| columns | columns:public.staff_nfc_provider_events.provider_transaction_id. | ALTER TABLE public."staff_nfc_provider_events" ADD COLUMN "provider_transaction_id" text NOT NULL |
| columns | columns:public.staff_nfc_provider_events.payload_sha256. | ALTER TABLE public."staff_nfc_provider_events" ADD COLUMN "payload_sha256" text NOT NULL |
| columns | columns:public.staff_nfc_provider_events.signature_verified. | ALTER TABLE public."staff_nfc_provider_events" ADD COLUMN "signature_verified" boolean NOT NULL |
| columns | columns:public.staff_nfc_provider_events.outcome. | ALTER TABLE public."staff_nfc_provider_events" ADD COLUMN "outcome" text NOT NULL |
| columns | columns:public.staff_nfc_provider_events.payment_id. | ALTER TABLE public."staff_nfc_provider_events" ADD COLUMN "payment_id" integer |
| columns | columns:public.staff_nfc_provider_events.school_id. | ALTER TABLE public."staff_nfc_provider_events" ADD COLUMN "school_id" integer |
| columns | columns:public.staff_nfc_provider_events.failure_code. | ALTER TABLE public."staff_nfc_provider_events" ADD COLUMN "failure_code" text |
| columns | columns:public.staff_nfc_provider_events.received_at. | ALTER TABLE public."staff_nfc_provider_events" ADD COLUMN "received_at" timestamp with time zone NOT NULL |
| columns | columns:public.staff_nfc_provider_events.resolved_at. | ALTER TABLE public."staff_nfc_provider_events" ADD COLUMN "resolved_at" timestamp with time zone |
| columns | columns:public.staff_nfc_receipts.id. | ALTER TABLE public."staff_nfc_receipts" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.staff_nfc_receipts.payment_id. | ALTER TABLE public."staff_nfc_receipts" ADD COLUMN "payment_id" integer NOT NULL |
| columns | columns:public.staff_nfc_receipts.subscription_id. | ALTER TABLE public."staff_nfc_receipts" ADD COLUMN "subscription_id" integer NOT NULL |
| columns | columns:public.staff_nfc_receipts.school_id. | ALTER TABLE public."staff_nfc_receipts" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.staff_nfc_receipts.receipt_number. | ALTER TABLE public."staff_nfc_receipts" ADD COLUMN "receipt_number" text NOT NULL |
| columns | columns:public.staff_nfc_receipts.issued_at. | ALTER TABLE public."staff_nfc_receipts" ADD COLUMN "issued_at" timestamp with time zone NOT NULL |
| columns | columns:public.staff_nfc_receipts.snapshot. | ALTER TABLE public."staff_nfc_receipts" ADD COLUMN "snapshot" jsonb NOT NULL |
| columns | columns:public.staff_nfc_refunds.id. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.staff_nfc_refunds.payment_id. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "payment_id" integer NOT NULL |
| columns | columns:public.staff_nfc_refunds.school_id. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.staff_nfc_refunds.amount_minor. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "amount_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_refunds.idempotency_key. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "idempotency_key" text NOT NULL |
| columns | columns:public.staff_nfc_refunds.reason. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "reason" text NOT NULL |
| columns | columns:public.staff_nfc_refunds.status. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.staff_nfc_refunds.provider_refund_id. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "provider_refund_id" text |
| columns | columns:public.staff_nfc_refunds.created_by. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.staff_nfc_refunds.created_at. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.staff_nfc_refunds.updated_at. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.staff_nfc_refunds.completed_at. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "completed_at" timestamp with time zone |
| columns | columns:public.staff_nfc_refunds.provider_verified_at. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "provider_verified_at" timestamp with time zone |
| columns | columns:public.staff_nfc_refunds.failure_code. | ALTER TABLE public."staff_nfc_refunds" ADD COLUMN "failure_code" text |
| columns | columns:public.staff_nfc_subscriptions.id. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.school_id. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.employee_id. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "employee_id" integer NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.academic_session_id. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.academic_term_id. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.product. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "product" text NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.billing_rule_id. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "billing_rule_id" integer NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.billing_rule_version. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "billing_rule_version" integer NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.price_minor. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "price_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.school_share_minor. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "school_share_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.platform_share_minor. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "platform_share_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.partner_share_minor. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "partner_share_minor" integer NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.partner_profile_id. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "partner_profile_id" integer |
| columns | columns:public.staff_nfc_subscriptions.attribution_id. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "attribution_id" integer |
| columns | columns:public.staff_nfc_subscriptions.currency. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.status. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.due_date. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "due_date" date NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.created_by. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "created_by" integer |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_partner_commissions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_payments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_provider_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_receipts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_refunds; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_subscriptions; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0099_reconcile_columns_f_5.sql

- [ ] Hash matches **d833a02ea0fb895066047c128ddec93df8d47a43aac7b18f398d3cead56c7181**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0066_reconcile_sequences_f_1.sql, 0074_reconcile_table_shells_f_1.sql.
- [ ] Required objects verified: tables:public..staff_nfc_subscriptions.; tables:public..student_nfc_replacement_requests.; sequences:public.student_nfc_replacement_requests.student_nfc_replacement_requests_id_seq.; tables:public..student_subscription_terms..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.staff_nfc_subscriptions.paid_at. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "paid_at" timestamp with time zone |
| columns | columns:public.staff_nfc_subscriptions.refunded_at. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "refunded_at" timestamp with time zone |
| columns | columns:public.staff_nfc_subscriptions.created_at. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.staff_nfc_subscriptions.updated_at. | ALTER TABLE public."staff_nfc_subscriptions" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_nfc_replacement_requests.id. | ALTER TABLE public."student_nfc_replacement_requests" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.student_nfc_replacement_requests.school_id. | ALTER TABLE public."student_nfc_replacement_requests" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.student_nfc_replacement_requests.student_id. | ALTER TABLE public."student_nfc_replacement_requests" ADD COLUMN "student_id" integer |
| columns | columns:public.student_nfc_replacement_requests.old_card_id. | ALTER TABLE public."student_nfc_replacement_requests" ADD COLUMN "old_card_id" integer NOT NULL |
| columns | columns:public.student_nfc_replacement_requests.invoice_id. | ALTER TABLE public."student_nfc_replacement_requests" ADD COLUMN "invoice_id" integer NOT NULL |
| columns | columns:public.student_nfc_replacement_requests.requested_by. | ALTER TABLE public."student_nfc_replacement_requests" ADD COLUMN "requested_by" integer NOT NULL |
| columns | columns:public.student_nfc_replacement_requests.reason. | ALTER TABLE public."student_nfc_replacement_requests" ADD COLUMN "reason" text NOT NULL |
| columns | columns:public.student_nfc_replacement_requests.status. | ALTER TABLE public."student_nfc_replacement_requests" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.student_nfc_replacement_requests.new_card_id. | ALTER TABLE public."student_nfc_replacement_requests" ADD COLUMN "new_card_id" integer |
| columns | columns:public.student_nfc_replacement_requests.issued_by. | ALTER TABLE public."student_nfc_replacement_requests" ADD COLUMN "issued_by" integer |
| columns | columns:public.student_nfc_replacement_requests.created_at. | ALTER TABLE public."student_nfc_replacement_requests" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.student_nfc_replacement_requests.issued_at. | ALTER TABLE public."student_nfc_replacement_requests" ADD COLUMN "issued_at" timestamp with time zone |
| columns | columns:public.student_nfc_replacement_requests.employee_id. | ALTER TABLE public."student_nfc_replacement_requests" ADD COLUMN "employee_id" integer |
| columns | columns:public.student_subscription_terms.school_id. | ALTER TABLE public."student_subscription_terms" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.student_subscription_terms.student_id. | ALTER TABLE public."student_subscription_terms" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.student_subscription_terms.academic_session_id. | ALTER TABLE public."student_subscription_terms" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.student_subscription_terms.academic_term_id. | ALTER TABLE public."student_subscription_terms" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.student_subscription_terms.subscription_id. | ALTER TABLE public."student_subscription_terms" ADD COLUMN "subscription_id" integer |
| columns | columns:public.student_subscription_terms.legacy_invoice_id. | ALTER TABLE public."student_subscription_terms" ADD COLUMN "legacy_invoice_id" integer |
| columns | columns:public.student_subscription_terms.created_at. | ALTER TABLE public."student_subscription_terms" ADD COLUMN "created_at" timestamp with time zone NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_subscriptions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_nfc_replacement_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_subscription_terms; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0100_reconcile_columns_g_1.sql

- [ ] Hash matches **cc85cf9585824285d4d411563fec4cf034dc9a935cbc3f0737fbe1ca753a9ee8**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0067_reconcile_sequences_g_1.sql, 0075_reconcile_table_shells_g_1.sql.
- [ ] Required objects verified: tables:public..campus_presence.; sequences:public.campus_presence.campus_presence_id_seq.; tables:public..employee_nfc_attendance_discrepancies.; sequences:public.employee_nfc_attendance_discrepancies.employee_nfc_attendance_discrepancies_id_seq.; tables:public..employee_nfc_card_bindings.; sequences:public.employee_nfc_card_bindings.employee_nfc_card_bindings_id_seq.; tables:public..employee_nfc_card_history.; sequences:public.employee_nfc_card_history.employee_nfc_card_history_id_seq.; tables:public..employee_nfc_discrepancy_actions.; sequences:public.employee_nfc_discrepancy_actions.employee_nfc_discrepancy_actions_id_seq.; tables:public..maintenance_request_status_history.; sequences:public.maintenance_request_status_history.maintenance_request_status_history_id_seq.; tables:public..operational_task_status_history.; sequences:public.operational_task_status_history.operational_task_status_history_id_seq.; tables:public..platform_devices.; sequences:public.platform_devices.platform_devices_id_seq.; tables:public..school_asset_history.; sequences:public.school_asset_history.school_asset_history_id_seq.; tables:public..school_authorized_pickup_persons.; sequences:public.school_authorized_pickup_persons.school_authorized_pickup_persons_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.campus_presence.id. | ALTER TABLE public."campus_presence" ADD COLUMN "id" bigint NOT NULL |
| columns | columns:public.campus_presence.school_id. | ALTER TABLE public."campus_presence" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.campus_presence.person_type. | ALTER TABLE public."campus_presence" ADD COLUMN "person_type" text NOT NULL |
| columns | columns:public.campus_presence.student_id. | ALTER TABLE public."campus_presence" ADD COLUMN "student_id" integer |
| columns | columns:public.campus_presence.employee_id. | ALTER TABLE public."campus_presence" ADD COLUMN "employee_id" integer |
| columns | columns:public.campus_presence.state. | ALTER TABLE public."campus_presence" ADD COLUMN "state" text NOT NULL |
| columns | columns:public.campus_presence.last_security_event_id. | ALTER TABLE public."campus_presence" ADD COLUMN "last_security_event_id" bigint NOT NULL |
| columns | columns:public.campus_presence.last_occurred_at. | ALTER TABLE public."campus_presence" ADD COLUMN "last_occurred_at" timestamp with time zone NOT NULL |
| columns | columns:public.campus_presence.review_reason. | ALTER TABLE public."campus_presence" ADD COLUMN "review_reason" text |
| columns | columns:public.campus_presence.resolved_by_user_id. | ALTER TABLE public."campus_presence" ADD COLUMN "resolved_by_user_id" integer |
| columns | columns:public.campus_presence.resolution_reason. | ALTER TABLE public."campus_presence" ADD COLUMN "resolution_reason" text |
| columns | columns:public.campus_presence.reviewed_at. | ALTER TABLE public."campus_presence" ADD COLUMN "reviewed_at" timestamp with time zone |
| columns | columns:public.campus_presence.updated_at. | ALTER TABLE public."campus_presence" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.employee_nfc_attendance_discrepancies.id. | ALTER TABLE public."employee_nfc_attendance_discrepancies" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.employee_nfc_attendance_discrepancies.school_id. | ALTER TABLE public."employee_nfc_attendance_discrepancies" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.employee_nfc_attendance_discrepancies.employee_id. | ALTER TABLE public."employee_nfc_attendance_discrepancies" ADD COLUMN "employee_id" integer NOT NULL |
| columns | columns:public.employee_nfc_attendance_discrepancies.attendance_event_id. | ALTER TABLE public."employee_nfc_attendance_discrepancies" ADD COLUMN "attendance_event_id" integer NOT NULL |
| columns | columns:public.employee_nfc_attendance_discrepancies.kind. | ALTER TABLE public."employee_nfc_attendance_discrepancies" ADD COLUMN "kind" text NOT NULL |
| columns | columns:public.employee_nfc_attendance_discrepancies.status. | ALTER TABLE public."employee_nfc_attendance_discrepancies" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.employee_nfc_attendance_discrepancies.details. | ALTER TABLE public."employee_nfc_attendance_discrepancies" ADD COLUMN "details" jsonb NOT NULL |
| columns | columns:public.employee_nfc_attendance_discrepancies.resolved_at. | ALTER TABLE public."employee_nfc_attendance_discrepancies" ADD COLUMN "resolved_at" timestamp with time zone |
| columns | columns:public.employee_nfc_attendance_discrepancies.resolved_by_user_id. | ALTER TABLE public."employee_nfc_attendance_discrepancies" ADD COLUMN "resolved_by_user_id" integer |
| columns | columns:public.employee_nfc_attendance_discrepancies.created_at. | ALTER TABLE public."employee_nfc_attendance_discrepancies" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.employee_nfc_card_bindings.id. | ALTER TABLE public."employee_nfc_card_bindings" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.employee_nfc_card_bindings.school_id. | ALTER TABLE public."employee_nfc_card_bindings" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.employee_nfc_card_bindings.nfc_card_id. | ALTER TABLE public."employee_nfc_card_bindings" ADD COLUMN "nfc_card_id" integer NOT NULL |
| columns | columns:public.employee_nfc_card_bindings.employee_id. | ALTER TABLE public."employee_nfc_card_bindings" ADD COLUMN "employee_id" integer NOT NULL |
| columns | columns:public.employee_nfc_card_bindings.status. | ALTER TABLE public."employee_nfc_card_bindings" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.employee_nfc_card_bindings.created_by_user_id. | ALTER TABLE public."employee_nfc_card_bindings" ADD COLUMN "created_by_user_id" integer NOT NULL |
| columns | columns:public.employee_nfc_card_bindings.created_at. | ALTER TABLE public."employee_nfc_card_bindings" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.employee_nfc_card_bindings.updated_at. | ALTER TABLE public."employee_nfc_card_bindings" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.employee_nfc_card_history.id. | ALTER TABLE public."employee_nfc_card_history" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.employee_nfc_card_history.school_id. | ALTER TABLE public."employee_nfc_card_history" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.employee_nfc_card_history.binding_id. | ALTER TABLE public."employee_nfc_card_history" ADD COLUMN "binding_id" integer NOT NULL |
| columns | columns:public.employee_nfc_card_history.nfc_card_id. | ALTER TABLE public."employee_nfc_card_history" ADD COLUMN "nfc_card_id" integer NOT NULL |
| columns | columns:public.employee_nfc_card_history.employee_id. | ALTER TABLE public."employee_nfc_card_history" ADD COLUMN "employee_id" integer NOT NULL |
| columns | columns:public.employee_nfc_card_history.action. | ALTER TABLE public."employee_nfc_card_history" ADD COLUMN "action" text NOT NULL |
| columns | columns:public.employee_nfc_card_history.previous_status. | ALTER TABLE public."employee_nfc_card_history" ADD COLUMN "previous_status" text |
| columns | columns:public.employee_nfc_card_history.new_status. | ALTER TABLE public."employee_nfc_card_history" ADD COLUMN "new_status" text |
| columns | columns:public.employee_nfc_card_history.replacement_nfc_card_id. | ALTER TABLE public."employee_nfc_card_history" ADD COLUMN "replacement_nfc_card_id" integer |
| columns | columns:public.employee_nfc_card_history.reason. | ALTER TABLE public."employee_nfc_card_history" ADD COLUMN "reason" text |
| columns | columns:public.employee_nfc_card_history.actor_user_id. | ALTER TABLE public."employee_nfc_card_history" ADD COLUMN "actor_user_id" integer |
| columns | columns:public.employee_nfc_card_history.created_at. | ALTER TABLE public."employee_nfc_card_history" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.employee_nfc_discrepancy_actions.id. | ALTER TABLE public."employee_nfc_discrepancy_actions" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.employee_nfc_discrepancy_actions.school_id. | ALTER TABLE public."employee_nfc_discrepancy_actions" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.employee_nfc_discrepancy_actions.discrepancy_id. | ALTER TABLE public."employee_nfc_discrepancy_actions" ADD COLUMN "discrepancy_id" integer NOT NULL |
| columns | columns:public.employee_nfc_discrepancy_actions.resolution. | ALTER TABLE public."employee_nfc_discrepancy_actions" ADD COLUMN "resolution" text NOT NULL |
| columns | columns:public.employee_nfc_discrepancy_actions.reason. | ALTER TABLE public."employee_nfc_discrepancy_actions" ADD COLUMN "reason" text NOT NULL |
| columns | columns:public.employee_nfc_discrepancy_actions.actor_user_id. | ALTER TABLE public."employee_nfc_discrepancy_actions" ADD COLUMN "actor_user_id" integer NOT NULL |
| columns | columns:public.employee_nfc_discrepancy_actions.created_at. | ALTER TABLE public."employee_nfc_discrepancy_actions" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.maintenance_request_status_history.id. | ALTER TABLE public."maintenance_request_status_history" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.maintenance_request_status_history.school_id. | ALTER TABLE public."maintenance_request_status_history" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.maintenance_request_status_history.maintenance_request_id. | ALTER TABLE public."maintenance_request_status_history" ADD COLUMN "maintenance_request_id" integer NOT NULL |
| columns | columns:public.maintenance_request_status_history.from_status. | ALTER TABLE public."maintenance_request_status_history" ADD COLUMN "from_status" text |
| columns | columns:public.maintenance_request_status_history.to_status. | ALTER TABLE public."maintenance_request_status_history" ADD COLUMN "to_status" text NOT NULL |
| columns | columns:public.maintenance_request_status_history.actor_user_id. | ALTER TABLE public."maintenance_request_status_history" ADD COLUMN "actor_user_id" integer NOT NULL |
| columns | columns:public.maintenance_request_status_history.occurred_at. | ALTER TABLE public."maintenance_request_status_history" ADD COLUMN "occurred_at" timestamp with time zone NOT NULL |
| columns | columns:public.operational_task_status_history.id. | ALTER TABLE public."operational_task_status_history" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.operational_task_status_history.school_id. | ALTER TABLE public."operational_task_status_history" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.operational_task_status_history.task_id. | ALTER TABLE public."operational_task_status_history" ADD COLUMN "task_id" integer NOT NULL |
| columns | columns:public.operational_task_status_history.from_status. | ALTER TABLE public."operational_task_status_history" ADD COLUMN "from_status" text |
| columns | columns:public.operational_task_status_history.to_status. | ALTER TABLE public."operational_task_status_history" ADD COLUMN "to_status" text NOT NULL |
| columns | columns:public.operational_task_status_history.actor_user_id. | ALTER TABLE public."operational_task_status_history" ADD COLUMN "actor_user_id" integer NOT NULL |
| columns | columns:public.operational_task_status_history.occurred_at. | ALTER TABLE public."operational_task_status_history" ADD COLUMN "occurred_at" timestamp with time zone NOT NULL |
| columns | columns:public.platform_devices.id. | ALTER TABLE public."platform_devices" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.platform_devices.serial_number. | ALTER TABLE public."platform_devices" ADD COLUMN "serial_number" text NOT NULL |
| columns | columns:public.platform_devices.name. | ALTER TABLE public."platform_devices" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.platform_devices.device_type. | ALTER TABLE public."platform_devices" ADD COLUMN "device_type" text NOT NULL |
| columns | columns:public.platform_devices.school_id. | ALTER TABLE public."platform_devices" ADD COLUMN "school_id" integer |
| columns | columns:public.platform_devices.status. | ALTER TABLE public."platform_devices" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.platform_devices.last_seen_at. | ALTER TABLE public."platform_devices" ADD COLUMN "last_seen_at" timestamp with time zone |
| columns | columns:public.platform_devices.created_at. | ALTER TABLE public."platform_devices" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.platform_devices.updated_at. | ALTER TABLE public."platform_devices" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.platform_devices.location. | ALTER TABLE public."platform_devices" ADD COLUMN "location" text |
| columns | columns:public.platform_devices.school_class_id. | ALTER TABLE public."platform_devices" ADD COLUMN "school_class_id" integer |
| columns | columns:public.platform_devices.configuration_status. | ALTER TABLE public."platform_devices" ADD COLUMN "configuration_status" text NOT NULL |
| columns | columns:public.school_asset_history.id. | ALTER TABLE public."school_asset_history" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_asset_history.school_id. | ALTER TABLE public."school_asset_history" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_asset_history.asset_id. | ALTER TABLE public."school_asset_history" ADD COLUMN "asset_id" integer NOT NULL |
| columns | columns:public.school_asset_history.event_type. | ALTER TABLE public."school_asset_history" ADD COLUMN "event_type" text NOT NULL |
| columns | columns:public.school_asset_history.quantity_before. | ALTER TABLE public."school_asset_history" ADD COLUMN "quantity_before" integer |
| columns | columns:public.school_asset_history.quantity_after. | ALTER TABLE public."school_asset_history" ADD COLUMN "quantity_after" integer |
| columns | columns:public.school_asset_history.assigned_to_before_user_id. | ALTER TABLE public."school_asset_history" ADD COLUMN "assigned_to_before_user_id" integer |
| columns | columns:public.school_asset_history.assigned_to_after_user_id. | ALTER TABLE public."school_asset_history" ADD COLUMN "assigned_to_after_user_id" integer |
| columns | columns:public.school_asset_history.status_before. | ALTER TABLE public."school_asset_history" ADD COLUMN "status_before" text |
| columns | columns:public.school_asset_history.status_after. | ALTER TABLE public."school_asset_history" ADD COLUMN "status_after" text |
| columns | columns:public.school_asset_history.actor_user_id. | ALTER TABLE public."school_asset_history" ADD COLUMN "actor_user_id" integer NOT NULL |
| columns | columns:public.school_asset_history.event_at. | ALTER TABLE public."school_asset_history" ADD COLUMN "event_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_asset_history.metadata. | ALTER TABLE public."school_asset_history" ADD COLUMN "metadata" jsonb NOT NULL |
| columns | columns:public.school_authorized_pickup_persons.id. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "id" integer NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.campus_presence; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_attendance_discrepancies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_card_bindings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_card_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_discrepancy_actions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.maintenance_request_status_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.operational_task_status_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.platform_devices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_asset_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_authorized_pickup_persons; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0101_reconcile_columns_g_2.sql

- [ ] Hash matches **d378169d4926bcf8ff2771329a9113103574e5e2cffad8fc87dfa1653d282783**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0067_reconcile_sequences_g_1.sql, 0075_reconcile_table_shells_g_1.sql.
- [ ] Required objects verified: tables:public..school_authorized_pickup_persons.; tables:public..school_operation_categories.; sequences:public.school_operation_categories.school_operation_categories_id_seq.; tables:public..school_pickup_requests.; sequences:public.school_pickup_requests.school_pickup_requests_id_seq.; tables:public..school_security_incident_attachments.; sequences:public.school_security_incident_attachments.school_security_incident_attachments_id_seq.; tables:public..school_security_incidents.; sequences:public.school_security_incidents.school_security_incidents_id_seq.; tables:public..school_security_operation_history.; sequences:public.school_security_operation_history.school_security_operation_history_id_seq.; tables:public..school_security_visitors.; sequences:public.school_security_visitors.school_security_visitors_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.school_authorized_pickup_persons.school_id. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_authorized_pickup_persons.student_id. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.school_authorized_pickup_persons.nominated_by_parent_id. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "nominated_by_parent_id" integer NOT NULL |
| columns | columns:public.school_authorized_pickup_persons.full_name. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "full_name" text NOT NULL |
| columns | columns:public.school_authorized_pickup_persons.phone. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "phone" text NOT NULL |
| columns | columns:public.school_authorized_pickup_persons.relationship. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "relationship" text |
| columns | columns:public.school_authorized_pickup_persons.identity_reference. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "identity_reference" text |
| columns | columns:public.school_authorized_pickup_persons.status. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.school_authorized_pickup_persons.valid_from. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "valid_from" timestamp with time zone |
| columns | columns:public.school_authorized_pickup_persons.valid_until. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "valid_until" timestamp with time zone |
| columns | columns:public.school_authorized_pickup_persons.requested_at. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "requested_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_authorized_pickup_persons.decision_by_user_id. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "decision_by_user_id" integer |
| columns | columns:public.school_authorized_pickup_persons.decision_reason. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "decision_reason" text |
| columns | columns:public.school_authorized_pickup_persons.decided_at. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "decided_at" timestamp with time zone |
| columns | columns:public.school_authorized_pickup_persons.version. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.school_authorized_pickup_persons.created_at. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_authorized_pickup_persons.updated_at. | ALTER TABLE public."school_authorized_pickup_persons" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_operation_categories.id. | ALTER TABLE public."school_operation_categories" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_operation_categories.school_id. | ALTER TABLE public."school_operation_categories" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_operation_categories.category_type. | ALTER TABLE public."school_operation_categories" ADD COLUMN "category_type" text NOT NULL |
| columns | columns:public.school_operation_categories.name. | ALTER TABLE public."school_operation_categories" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.school_operation_categories.description. | ALTER TABLE public."school_operation_categories" ADD COLUMN "description" text |
| columns | columns:public.school_operation_categories.is_active. | ALTER TABLE public."school_operation_categories" ADD COLUMN "is_active" boolean NOT NULL |
| columns | columns:public.school_operation_categories.created_by_user_id. | ALTER TABLE public."school_operation_categories" ADD COLUMN "created_by_user_id" integer NOT NULL |
| columns | columns:public.school_operation_categories.created_at. | ALTER TABLE public."school_operation_categories" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_operation_categories.updated_at. | ALTER TABLE public."school_operation_categories" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_pickup_requests.id. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_pickup_requests.school_id. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_pickup_requests.student_id. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.school_pickup_requests.requested_by_parent_id. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "requested_by_parent_id" integer NOT NULL |
| columns | columns:public.school_pickup_requests.pickup_person_id. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "pickup_person_id" integer NOT NULL |
| columns | columns:public.school_pickup_requests.requested_pickup_at. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "requested_pickup_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_pickup_requests.valid_from. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "valid_from" timestamp with time zone NOT NULL |
| columns | columns:public.school_pickup_requests.valid_until. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "valid_until" timestamp with time zone NOT NULL |
| columns | columns:public.school_pickup_requests.reason. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "reason" text |
| columns | columns:public.school_pickup_requests.status. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.school_pickup_requests.decision_by_user_id. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "decision_by_user_id" integer |
| columns | columns:public.school_pickup_requests.decision_reason. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "decision_reason" text |
| columns | columns:public.school_pickup_requests.decided_at. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "decided_at" timestamp with time zone |
| columns | columns:public.school_pickup_requests.completed_at. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "completed_at" timestamp with time zone |
| columns | columns:public.school_pickup_requests.completed_by_user_id. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "completed_by_user_id" integer |
| columns | columns:public.school_pickup_requests.completion_pickup_person_id. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "completion_pickup_person_id" integer |
| columns | columns:public.school_pickup_requests.recorded_security_event_id. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "recorded_security_event_id" bigint |
| columns | columns:public.school_pickup_requests.completion_idempotency_key. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "completion_idempotency_key" text |
| columns | columns:public.school_pickup_requests.version. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.school_pickup_requests.created_at. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_pickup_requests.updated_at. | ALTER TABLE public."school_pickup_requests" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_security_incident_attachments.id. | ALTER TABLE public."school_security_incident_attachments" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_security_incident_attachments.school_id. | ALTER TABLE public."school_security_incident_attachments" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_security_incident_attachments.incident_id. | ALTER TABLE public."school_security_incident_attachments" ADD COLUMN "incident_id" integer NOT NULL |
| columns | columns:public.school_security_incident_attachments.object_path. | ALTER TABLE public."school_security_incident_attachments" ADD COLUMN "object_path" text NOT NULL |
| columns | columns:public.school_security_incident_attachments.file_name. | ALTER TABLE public."school_security_incident_attachments" ADD COLUMN "file_name" text NOT NULL |
| columns | columns:public.school_security_incident_attachments.content_type. | ALTER TABLE public."school_security_incident_attachments" ADD COLUMN "content_type" text NOT NULL |
| columns | columns:public.school_security_incident_attachments.byte_size. | ALTER TABLE public."school_security_incident_attachments" ADD COLUMN "byte_size" integer NOT NULL |
| columns | columns:public.school_security_incident_attachments.status. | ALTER TABLE public."school_security_incident_attachments" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.school_security_incident_attachments.uploaded_by_user_id. | ALTER TABLE public."school_security_incident_attachments" ADD COLUMN "uploaded_by_user_id" integer NOT NULL |
| columns | columns:public.school_security_incident_attachments.upload_expires_at. | ALTER TABLE public."school_security_incident_attachments" ADD COLUMN "upload_expires_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_security_incident_attachments.confirmed_at. | ALTER TABLE public."school_security_incident_attachments" ADD COLUMN "confirmed_at" timestamp with time zone |
| columns | columns:public.school_security_incident_attachments.created_at. | ALTER TABLE public."school_security_incident_attachments" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_security_incidents.id. | ALTER TABLE public."school_security_incidents" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_security_incidents.school_id. | ALTER TABLE public."school_security_incidents" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_security_incidents.incident_type. | ALTER TABLE public."school_security_incidents" ADD COLUMN "incident_type" text NOT NULL |
| columns | columns:public.school_security_incidents.occurred_at. | ALTER TABLE public."school_security_incidents" ADD COLUMN "occurred_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_security_incidents.security_location_id. | ALTER TABLE public."school_security_incidents" ADD COLUMN "security_location_id" integer |
| columns | columns:public.school_security_incidents.security_device_id. | ALTER TABLE public."school_security_incidents" ADD COLUMN "security_device_id" integer |
| columns | columns:public.school_security_incidents.student_id. | ALTER TABLE public."school_security_incidents" ADD COLUMN "student_id" integer |
| columns | columns:public.school_security_incidents.involved_persons. | ALTER TABLE public."school_security_incidents" ADD COLUMN "involved_persons" jsonb NOT NULL |
| columns | columns:public.school_security_incidents.assigned_staff_user_id. | ALTER TABLE public."school_security_incidents" ADD COLUMN "assigned_staff_user_id" integer |
| columns | columns:public.school_security_incidents.description. | ALTER TABLE public."school_security_incidents" ADD COLUMN "description" text NOT NULL |
| columns | columns:public.school_security_incidents.severity. | ALTER TABLE public."school_security_incidents" ADD COLUMN "severity" text NOT NULL |
| columns | columns:public.school_security_incidents.status. | ALTER TABLE public."school_security_incidents" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.school_security_incidents.resolution. | ALTER TABLE public."school_security_incidents" ADD COLUMN "resolution" text |
| columns | columns:public.school_security_incidents.created_by_user_id. | ALTER TABLE public."school_security_incidents" ADD COLUMN "created_by_user_id" integer NOT NULL |
| columns | columns:public.school_security_incidents.version. | ALTER TABLE public."school_security_incidents" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.school_security_incidents.created_at. | ALTER TABLE public."school_security_incidents" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_security_incidents.updated_at. | ALTER TABLE public."school_security_incidents" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_security_operation_history.id. | ALTER TABLE public."school_security_operation_history" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_security_operation_history.school_id. | ALTER TABLE public."school_security_operation_history" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_security_operation_history.student_id. | ALTER TABLE public."school_security_operation_history" ADD COLUMN "student_id" integer |
| columns | columns:public.school_security_operation_history.entity_type. | ALTER TABLE public."school_security_operation_history" ADD COLUMN "entity_type" text NOT NULL |
| columns | columns:public.school_security_operation_history.entity_id. | ALTER TABLE public."school_security_operation_history" ADD COLUMN "entity_id" integer NOT NULL |
| columns | columns:public.school_security_operation_history.revision. | ALTER TABLE public."school_security_operation_history" ADD COLUMN "revision" integer NOT NULL |
| columns | columns:public.school_security_operation_history.event_type. | ALTER TABLE public."school_security_operation_history" ADD COLUMN "event_type" text NOT NULL |
| columns | columns:public.school_security_operation_history.actor_user_id. | ALTER TABLE public."school_security_operation_history" ADD COLUMN "actor_user_id" integer NOT NULL |
| columns | columns:public.school_security_operation_history.result. | ALTER TABLE public."school_security_operation_history" ADD COLUMN "result" text NOT NULL |
| columns | columns:public.school_security_operation_history.snapshot. | ALTER TABLE public."school_security_operation_history" ADD COLUMN "snapshot" jsonb NOT NULL |
| columns | columns:public.school_security_operation_history.created_at. | ALTER TABLE public."school_security_operation_history" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_security_visitors.id. | ALTER TABLE public."school_security_visitors" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.school_security_visitors.school_id. | ALTER TABLE public."school_security_visitors" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.school_security_visitors.visitor_name. | ALTER TABLE public."school_security_visitors" ADD COLUMN "visitor_name" text NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.school_authorized_pickup_persons; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_operation_categories; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_pickup_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_incident_attachments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_incidents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_operation_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_visitors; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0102_reconcile_columns_g_3.sql

- [ ] Hash matches **3e0e9e385de5f7c7ad61024249099716235ae7f1c87450a296903b7e96abfc9c**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0067_reconcile_sequences_g_1.sql, 0075_reconcile_table_shells_g_1.sql.
- [ ] Required objects verified: tables:public..school_security_visitors.; tables:public..security_events.; sequences:public.security_events.security_events_id_seq.; tables:public..security_locations.; sequences:public.security_locations.security_locations_id_seq.; tables:public..security_readers.; sequences:public.security_readers.security_readers_id_seq.; tables:public..security_school_settings.; tables:public..security_staff_grants.; sequences:public.security_staff_grants.security_staff_grants_id_seq.; tables:public..transport_buses.; sequences:public.transport_buses.transport_buses_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.school_security_visitors.phone. | ALTER TABLE public."school_security_visitors" ADD COLUMN "phone" text |
| columns | columns:public.school_security_visitors.id_reference. | ALTER TABLE public."school_security_visitors" ADD COLUMN "id_reference" text |
| columns | columns:public.school_security_visitors.purpose. | ALTER TABLE public."school_security_visitors" ADD COLUMN "purpose" text NOT NULL |
| columns | columns:public.school_security_visitors.host_name. | ALTER TABLE public."school_security_visitors" ADD COLUMN "host_name" text |
| columns | columns:public.school_security_visitors.host_student_id. | ALTER TABLE public."school_security_visitors" ADD COLUMN "host_student_id" integer |
| columns | columns:public.school_security_visitors.checked_in_at. | ALTER TABLE public."school_security_visitors" ADD COLUMN "checked_in_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_security_visitors.checked_out_at. | ALTER TABLE public."school_security_visitors" ADD COLUMN "checked_out_at" timestamp with time zone |
| columns | columns:public.school_security_visitors.checkout_idempotency_key. | ALTER TABLE public."school_security_visitors" ADD COLUMN "checkout_idempotency_key" text |
| columns | columns:public.school_security_visitors.status. | ALTER TABLE public."school_security_visitors" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.school_security_visitors.notes. | ALTER TABLE public."school_security_visitors" ADD COLUMN "notes" text |
| columns | columns:public.school_security_visitors.security_officer_user_id. | ALTER TABLE public."school_security_visitors" ADD COLUMN "security_officer_user_id" integer NOT NULL |
| columns | columns:public.school_security_visitors.security_location_id. | ALTER TABLE public."school_security_visitors" ADD COLUMN "security_location_id" integer |
| columns | columns:public.school_security_visitors.security_device_id. | ALTER TABLE public."school_security_visitors" ADD COLUMN "security_device_id" integer |
| columns | columns:public.school_security_visitors.version. | ALTER TABLE public."school_security_visitors" ADD COLUMN "version" integer NOT NULL |
| columns | columns:public.school_security_visitors.created_at. | ALTER TABLE public."school_security_visitors" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.school_security_visitors.updated_at. | ALTER TABLE public."school_security_visitors" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.security_events.id. | ALTER TABLE public."security_events" ADD COLUMN "id" bigint NOT NULL |
| columns | columns:public.security_events.school_id. | ALTER TABLE public."security_events" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.security_events.reader_id. | ALTER TABLE public."security_events" ADD COLUMN "reader_id" integer |
| columns | columns:public.security_events.location_id. | ALTER TABLE public."security_events" ADD COLUMN "location_id" integer |
| columns | columns:public.security_events.device_id. | ALTER TABLE public."security_events" ADD COLUMN "device_id" integer NOT NULL |
| columns | columns:public.security_events.attendance_event_id. | ALTER TABLE public."security_events" ADD COLUMN "attendance_event_id" integer |
| columns | columns:public.security_events.nfc_card_id. | ALTER TABLE public."security_events" ADD COLUMN "nfc_card_id" integer |
| columns | columns:public.security_events.student_id. | ALTER TABLE public."security_events" ADD COLUMN "student_id" integer |
| columns | columns:public.security_events.employee_id. | ALTER TABLE public."security_events" ADD COLUMN "employee_id" integer |
| columns | columns:public.security_events.person_type. | ALTER TABLE public."security_events" ADD COLUMN "person_type" text NOT NULL |
| columns | columns:public.security_events.person_name_snapshot. | ALTER TABLE public."security_events" ADD COLUMN "person_name_snapshot" text |
| columns | columns:public.security_events.admission_number_snapshot. | ALTER TABLE public."security_events" ADD COLUMN "admission_number_snapshot" text |
| columns | columns:public.security_events.employee_number_snapshot. | ALTER TABLE public."security_events" ADD COLUMN "employee_number_snapshot" text |
| columns | columns:public.security_events.class_name_snapshot. | ALTER TABLE public."security_events" ADD COLUMN "class_name_snapshot" text |
| columns | columns:public.security_events.section_snapshot. | ALTER TABLE public."security_events" ADD COLUMN "section_snapshot" text |
| columns | columns:public.security_events.location_name_snapshot. | ALTER TABLE public."security_events" ADD COLUMN "location_name_snapshot" text |
| columns | columns:public.security_events.reader_name_snapshot. | ALTER TABLE public."security_events" ADD COLUMN "reader_name_snapshot" text |
| columns | columns:public.security_events.event_type. | ALTER TABLE public."security_events" ADD COLUMN "event_type" text NOT NULL |
| columns | columns:public.security_events.identity_result. | ALTER TABLE public."security_events" ADD COLUMN "identity_result" text NOT NULL |
| columns | columns:public.security_events.reason_code. | ALTER TABLE public."security_events" ADD COLUMN "reason_code" text |
| columns | columns:public.security_events.card_uid_sha256. | ALTER TABLE public."security_events" ADD COLUMN "card_uid_sha256" text |
| columns | columns:public.security_events.event_key. | ALTER TABLE public."security_events" ADD COLUMN "event_key" text NOT NULL |
| columns | columns:public.security_events.occurred_at. | ALTER TABLE public."security_events" ADD COLUMN "occurred_at" timestamp with time zone NOT NULL |
| columns | columns:public.security_events.received_at. | ALTER TABLE public."security_events" ADD COLUMN "received_at" timestamp with time zone NOT NULL |
| columns | columns:public.security_events.sync_status. | ALTER TABLE public."security_events" ADD COLUMN "sync_status" text NOT NULL |
| columns | columns:public.security_events.physical_control_status. | ALTER TABLE public."security_events" ADD COLUMN "physical_control_status" text NOT NULL |
| columns | columns:public.security_events.actor_user_id. | ALTER TABLE public."security_events" ADD COLUMN "actor_user_id" integer |
| columns | columns:public.security_events.created_at. | ALTER TABLE public."security_events" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.security_locations.id. | ALTER TABLE public."security_locations" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.security_locations.school_id. | ALTER TABLE public."security_locations" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.security_locations.name. | ALTER TABLE public."security_locations" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.security_locations.description. | ALTER TABLE public."security_locations" ADD COLUMN "description" text |
| columns | columns:public.security_locations.zone_type. | ALTER TABLE public."security_locations" ADD COLUMN "zone_type" text NOT NULL |
| columns | columns:public.security_locations.status. | ALTER TABLE public."security_locations" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.security_locations.created_by_user_id. | ALTER TABLE public."security_locations" ADD COLUMN "created_by_user_id" integer |
| columns | columns:public.security_locations.updated_by_user_id. | ALTER TABLE public."security_locations" ADD COLUMN "updated_by_user_id" integer |
| columns | columns:public.security_locations.created_at. | ALTER TABLE public."security_locations" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.security_locations.updated_at. | ALTER TABLE public."security_locations" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.security_readers.id. | ALTER TABLE public."security_readers" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.security_readers.school_id. | ALTER TABLE public."security_readers" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.security_readers.location_id. | ALTER TABLE public."security_readers" ADD COLUMN "location_id" integer NOT NULL |
| columns | columns:public.security_readers.device_id. | ALTER TABLE public."security_readers" ADD COLUMN "device_id" integer NOT NULL |
| columns | columns:public.security_readers.name. | ALTER TABLE public."security_readers" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.security_readers.status. | ALTER TABLE public."security_readers" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.security_readers.permissions. | ALTER TABLE public."security_readers" ADD COLUMN "permissions" text[] NOT NULL |
| columns | columns:public.security_readers.created_by_user_id. | ALTER TABLE public."security_readers" ADD COLUMN "created_by_user_id" integer |
| columns | columns:public.security_readers.updated_by_user_id. | ALTER TABLE public."security_readers" ADD COLUMN "updated_by_user_id" integer |
| columns | columns:public.security_readers.created_at. | ALTER TABLE public."security_readers" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.security_readers.updated_at. | ALTER TABLE public."security_readers" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.security_school_settings.school_id. | ALTER TABLE public."security_school_settings" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.security_school_settings.security_enabled. | ALTER TABLE public."security_school_settings" ADD COLUMN "security_enabled" boolean NOT NULL |
| columns | columns:public.security_school_settings.parent_entry_alerts. | ALTER TABLE public."security_school_settings" ADD COLUMN "parent_entry_alerts" boolean NOT NULL |
| columns | columns:public.security_school_settings.parent_exit_alerts. | ALTER TABLE public."security_school_settings" ADD COLUMN "parent_exit_alerts" boolean NOT NULL |
| columns | columns:public.security_school_settings.updated_by_user_id. | ALTER TABLE public."security_school_settings" ADD COLUMN "updated_by_user_id" integer |
| columns | columns:public.security_school_settings.updated_at. | ALTER TABLE public."security_school_settings" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.security_staff_grants.id. | ALTER TABLE public."security_staff_grants" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.security_staff_grants.school_id. | ALTER TABLE public."security_staff_grants" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.security_staff_grants.user_id. | ALTER TABLE public."security_staff_grants" ADD COLUMN "user_id" integer NOT NULL |
| columns | columns:public.security_staff_grants.permissions. | ALTER TABLE public."security_staff_grants" ADD COLUMN "permissions" text[] NOT NULL |
| columns | columns:public.security_staff_grants.status. | ALTER TABLE public."security_staff_grants" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.security_staff_grants.expires_at. | ALTER TABLE public."security_staff_grants" ADD COLUMN "expires_at" timestamp with time zone |
| columns | columns:public.security_staff_grants.granted_by_user_id. | ALTER TABLE public."security_staff_grants" ADD COLUMN "granted_by_user_id" integer NOT NULL |
| columns | columns:public.security_staff_grants.revoked_by_user_id. | ALTER TABLE public."security_staff_grants" ADD COLUMN "revoked_by_user_id" integer |
| columns | columns:public.security_staff_grants.revoked_at. | ALTER TABLE public."security_staff_grants" ADD COLUMN "revoked_at" timestamp with time zone |
| columns | columns:public.security_staff_grants.created_at. | ALTER TABLE public."security_staff_grants" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.security_staff_grants.updated_at. | ALTER TABLE public."security_staff_grants" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_buses.id. | ALTER TABLE public."transport_buses" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.transport_buses.school_id. | ALTER TABLE public."transport_buses" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.transport_buses.name. | ALTER TABLE public."transport_buses" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.transport_buses.registration_number. | ALTER TABLE public."transport_buses" ADD COLUMN "registration_number" text NOT NULL |
| columns | columns:public.transport_buses.make. | ALTER TABLE public."transport_buses" ADD COLUMN "make" text |
| columns | columns:public.transport_buses.capacity. | ALTER TABLE public."transport_buses" ADD COLUMN "capacity" integer NOT NULL |
| columns | columns:public.transport_buses.status. | ALTER TABLE public."transport_buses" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.transport_buses.notes. | ALTER TABLE public."transport_buses" ADD COLUMN "notes" text |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_visitors; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_locations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_readers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_school_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_staff_grants; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_buses; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0103_reconcile_columns_g_4.sql

- [ ] Hash matches **0a5f120039c8a6c9587eb4210094bf3f765b110cbf50c6bba82ffa8d42c339b4**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0067_reconcile_sequences_g_1.sql, 0075_reconcile_table_shells_g_1.sql.
- [ ] Required objects verified: tables:public..transport_buses.; tables:public..transport_fee_invoices.; sequences:public.transport_fee_invoices.transport_fee_invoices_id_seq.; tables:public..transport_history.; sequences:public.transport_history.transport_history_id_seq.; tables:public..transport_parent_requests.; sequences:public.transport_parent_requests.transport_parent_requests_id_seq.; tables:public..transport_route_staff.; sequences:public.transport_route_staff.transport_route_staff_id_seq.; tables:public..transport_route_stops.; sequences:public.transport_route_stops.transport_route_stops_id_seq.; tables:public..transport_routes.; sequences:public.transport_routes.transport_routes_id_seq.; tables:public..transport_school_policies.; tables:public..transport_student_assignments.; sequences:public.transport_student_assignments.transport_student_assignments_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.transport_buses.created_by. | ALTER TABLE public."transport_buses" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.transport_buses.created_at. | ALTER TABLE public."transport_buses" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_buses.updated_at. | ALTER TABLE public."transport_buses" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_fee_invoices.id. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.transport_fee_invoices.school_id. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.transport_fee_invoices.assignment_id. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "assignment_id" integer NOT NULL |
| columns | columns:public.transport_fee_invoices.academic_session_id. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "academic_session_id" integer NOT NULL |
| columns | columns:public.transport_fee_invoices.academic_term_id. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "academic_term_id" integer NOT NULL |
| columns | columns:public.transport_fee_invoices.fee_category_id. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "fee_category_id" integer |
| columns | columns:public.transport_fee_invoices.amount_minor. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "amount_minor" integer NOT NULL |
| columns | columns:public.transport_fee_invoices.due_date. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "due_date" date NOT NULL |
| columns | columns:public.transport_fee_invoices.status. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.transport_fee_invoices.fee_invoice_id. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "fee_invoice_id" integer |
| columns | columns:public.transport_fee_invoices.created_by. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.transport_fee_invoices.updated_by. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "updated_by" integer NOT NULL |
| columns | columns:public.transport_fee_invoices.created_at. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_fee_invoices.updated_at. | ALTER TABLE public."transport_fee_invoices" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_history.id. | ALTER TABLE public."transport_history" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.transport_history.school_id. | ALTER TABLE public."transport_history" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.transport_history.assignment_id. | ALTER TABLE public."transport_history" ADD COLUMN "assignment_id" integer |
| columns | columns:public.transport_history.route_id. | ALTER TABLE public."transport_history" ADD COLUMN "route_id" integer |
| columns | columns:public.transport_history.bus_id. | ALTER TABLE public."transport_history" ADD COLUMN "bus_id" integer |
| columns | columns:public.transport_history.request_id. | ALTER TABLE public."transport_history" ADD COLUMN "request_id" integer |
| columns | columns:public.transport_history.route_staff_id. | ALTER TABLE public."transport_history" ADD COLUMN "route_staff_id" integer |
| columns | columns:public.transport_history.student_id. | ALTER TABLE public."transport_history" ADD COLUMN "student_id" integer |
| columns | columns:public.transport_history.event_type. | ALTER TABLE public."transport_history" ADD COLUMN "event_type" text NOT NULL |
| columns | columns:public.transport_history.effective_date. | ALTER TABLE public."transport_history" ADD COLUMN "effective_date" date NOT NULL |
| columns | columns:public.transport_history.reason. | ALTER TABLE public."transport_history" ADD COLUMN "reason" text NOT NULL |
| columns | columns:public.transport_history.actor_user_id. | ALTER TABLE public."transport_history" ADD COLUMN "actor_user_id" integer |
| columns | columns:public.transport_history.actor_role. | ALTER TABLE public."transport_history" ADD COLUMN "actor_role" text NOT NULL |
| columns | columns:public.transport_history.before_state. | ALTER TABLE public."transport_history" ADD COLUMN "before_state" jsonb |
| columns | columns:public.transport_history.after_state. | ALTER TABLE public."transport_history" ADD COLUMN "after_state" jsonb |
| columns | columns:public.transport_history.created_at. | ALTER TABLE public."transport_history" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_parent_requests.id. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.transport_parent_requests.school_id. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.transport_parent_requests.student_id. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.transport_parent_requests.parent_id. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "parent_id" integer NOT NULL |
| columns | columns:public.transport_parent_requests.assignment_id. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "assignment_id" integer |
| columns | columns:public.transport_parent_requests.request_type. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "request_type" text NOT NULL |
| columns | columns:public.transport_parent_requests.request_date. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "request_date" timestamp with time zone NOT NULL |
| columns | columns:public.transport_parent_requests.effective_date. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "effective_date" date NOT NULL |
| columns | columns:public.transport_parent_requests.reason. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "reason" text NOT NULL |
| columns | columns:public.transport_parent_requests.status. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.transport_parent_requests.school_action. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "school_action" text |
| columns | columns:public.transport_parent_requests.school_note. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "school_note" text |
| columns | columns:public.transport_parent_requests.reviewed_by. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "reviewed_by" integer |
| columns | columns:public.transport_parent_requests.reviewed_at. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "reviewed_at" timestamp with time zone |
| columns | columns:public.transport_parent_requests.created_at. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_parent_requests.updated_at. | ALTER TABLE public."transport_parent_requests" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_route_staff.id. | ALTER TABLE public."transport_route_staff" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.transport_route_staff.school_id. | ALTER TABLE public."transport_route_staff" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.transport_route_staff.route_id. | ALTER TABLE public."transport_route_staff" ADD COLUMN "route_id" integer NOT NULL |
| columns | columns:public.transport_route_staff.employee_id. | ALTER TABLE public."transport_route_staff" ADD COLUMN "employee_id" integer NOT NULL |
| columns | columns:public.transport_route_staff.role. | ALTER TABLE public."transport_route_staff" ADD COLUMN "role" text NOT NULL |
| columns | columns:public.transport_route_staff.is_active. | ALTER TABLE public."transport_route_staff" ADD COLUMN "is_active" boolean NOT NULL |
| columns | columns:public.transport_route_staff.assigned_by. | ALTER TABLE public."transport_route_staff" ADD COLUMN "assigned_by" integer NOT NULL |
| columns | columns:public.transport_route_staff.created_at. | ALTER TABLE public."transport_route_staff" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_route_staff.updated_at. | ALTER TABLE public."transport_route_staff" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_route_stops.id. | ALTER TABLE public."transport_route_stops" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.transport_route_stops.school_id. | ALTER TABLE public."transport_route_stops" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.transport_route_stops.route_id. | ALTER TABLE public."transport_route_stops" ADD COLUMN "route_id" integer NOT NULL |
| columns | columns:public.transport_route_stops.name. | ALTER TABLE public."transport_route_stops" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.transport_route_stops.stop_type. | ALTER TABLE public."transport_route_stops" ADD COLUMN "stop_type" text NOT NULL |
| columns | columns:public.transport_route_stops.sequence. | ALTER TABLE public."transport_route_stops" ADD COLUMN "sequence" integer NOT NULL |
| columns | columns:public.transport_route_stops.notes. | ALTER TABLE public."transport_route_stops" ADD COLUMN "notes" text |
| columns | columns:public.transport_route_stops.is_active. | ALTER TABLE public."transport_route_stops" ADD COLUMN "is_active" boolean NOT NULL |
| columns | columns:public.transport_route_stops.created_by. | ALTER TABLE public."transport_route_stops" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.transport_route_stops.created_at. | ALTER TABLE public."transport_route_stops" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_route_stops.updated_at. | ALTER TABLE public."transport_route_stops" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_routes.id. | ALTER TABLE public."transport_routes" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.transport_routes.school_id. | ALTER TABLE public."transport_routes" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.transport_routes.bus_id. | ALTER TABLE public."transport_routes" ADD COLUMN "bus_id" integer NOT NULL |
| columns | columns:public.transport_routes.driver_employee_id. | ALTER TABLE public."transport_routes" ADD COLUMN "driver_employee_id" integer NOT NULL |
| columns | columns:public.transport_routes.name. | ALTER TABLE public."transport_routes" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.transport_routes.weekdays. | ALTER TABLE public."transport_routes" ADD COLUMN "weekdays" text[] NOT NULL |
| columns | columns:public.transport_routes.departure_time. | ALTER TABLE public."transport_routes" ADD COLUMN "departure_time" text NOT NULL |
| columns | columns:public.transport_routes.arrival_time. | ALTER TABLE public."transport_routes" ADD COLUMN "arrival_time" text NOT NULL |
| columns | columns:public.transport_routes.fare_minor. | ALTER TABLE public."transport_routes" ADD COLUMN "fare_minor" integer NOT NULL |
| columns | columns:public.transport_routes.currency. | ALTER TABLE public."transport_routes" ADD COLUMN "currency" text NOT NULL |
| columns | columns:public.transport_routes.status. | ALTER TABLE public."transport_routes" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.transport_routes.created_by. | ALTER TABLE public."transport_routes" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.transport_routes.created_at. | ALTER TABLE public."transport_routes" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_routes.updated_at. | ALTER TABLE public."transport_routes" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_school_policies.school_id. | ALTER TABLE public."transport_school_policies" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.transport_school_policies.payment_required. | ALTER TABLE public."transport_school_policies" ADD COLUMN "payment_required" boolean NOT NULL |
| columns | columns:public.transport_school_policies.suspend_when_overdue. | ALTER TABLE public."transport_school_policies" ADD COLUMN "suspend_when_overdue" boolean NOT NULL |
| columns | columns:public.transport_school_policies.updated_by. | ALTER TABLE public."transport_school_policies" ADD COLUMN "updated_by" integer NOT NULL |
| columns | columns:public.transport_school_policies.updated_at. | ALTER TABLE public."transport_school_policies" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_student_assignments.id. | ALTER TABLE public."transport_student_assignments" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.transport_student_assignments.school_id. | ALTER TABLE public."transport_student_assignments" ADD COLUMN "school_id" integer NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.transport_buses; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_fee_invoices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_parent_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_route_staff; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_route_stops; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_routes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_school_policies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_student_assignments; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0104_reconcile_columns_g_5.sql

- [ ] Hash matches **b4bb165458605c9b45ef979317dd3d7582d2f34fdf29d9e2be7a6514e9a3cc9f**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0075_reconcile_table_shells_g_1.sql.
- [ ] Required objects verified: tables:public..transport_student_assignments..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.transport_student_assignments.student_id. | ALTER TABLE public."transport_student_assignments" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.transport_student_assignments.route_id. | ALTER TABLE public."transport_student_assignments" ADD COLUMN "route_id" integer NOT NULL |
| columns | columns:public.transport_student_assignments.pickup_stop_id. | ALTER TABLE public."transport_student_assignments" ADD COLUMN "pickup_stop_id" integer NOT NULL |
| columns | columns:public.transport_student_assignments.dropoff_stop_id. | ALTER TABLE public."transport_student_assignments" ADD COLUMN "dropoff_stop_id" integer NOT NULL |
| columns | columns:public.transport_student_assignments.status. | ALTER TABLE public."transport_student_assignments" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.transport_student_assignments.effective_date. | ALTER TABLE public."transport_student_assignments" ADD COLUMN "effective_date" date NOT NULL |
| columns | columns:public.transport_student_assignments.end_date. | ALTER TABLE public."transport_student_assignments" ADD COLUMN "end_date" date |
| columns | columns:public.transport_student_assignments.reason. | ALTER TABLE public."transport_student_assignments" ADD COLUMN "reason" text NOT NULL |
| columns | columns:public.transport_student_assignments.created_by. | ALTER TABLE public."transport_student_assignments" ADD COLUMN "created_by" integer NOT NULL |
| columns | columns:public.transport_student_assignments.created_at. | ALTER TABLE public."transport_student_assignments" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.transport_student_assignments.updated_at. | ALTER TABLE public."transport_student_assignments" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.transport_student_assignments; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0105_reconcile_columns_h_1.sql

- [ ] Hash matches **0d91b5690a44c6ed277375ca54f31a6afefd383bfbe072adb21015f7e5676ec4**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0068_reconcile_sequences_h_1.sql, 0076_reconcile_table_shells_h_1.sql.
- [ ] Required objects verified: tables:public..communication_campaigns.; sequences:public.communication_campaigns.communication_campaigns_id_seq.; tables:public..communication_deliveries.; sequences:public.communication_deliveries.communication_deliveries_id_seq.; tables:public..communication_message_threads.; sequences:public.communication_message_threads.communication_message_threads_id_seq.; tables:public..communication_messages.; sequences:public.communication_messages.communication_messages_id_seq.; tables:public..communication_notifications.; sequences:public.communication_notifications.communication_notifications_id_seq.; tables:public..communication_push_devices.; sequences:public.communication_push_devices.communication_push_devices_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: Only approved deterministic new-field initialization: communication_deliveries.push_attempts = '{}'::jsonb; communication_deliveries.receipt_ids = '[]'::jsonb. Preserve all pre-existing values/relationships and row counts; no manual update/backfill.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **1**; IDs 286. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.communication_campaigns.id. | ALTER TABLE public."communication_campaigns" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.communication_campaigns.school_id. | ALTER TABLE public."communication_campaigns" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.communication_campaigns.created_by_user_id. | ALTER TABLE public."communication_campaigns" ADD COLUMN "created_by_user_id" integer NOT NULL |
| columns | columns:public.communication_campaigns.template_id. | ALTER TABLE public."communication_campaigns" ADD COLUMN "template_id" integer |
| columns | columns:public.communication_campaigns.idempotency_key. | ALTER TABLE public."communication_campaigns" ADD COLUMN "idempotency_key" text |
| columns | columns:public.communication_campaigns.title. | ALTER TABLE public."communication_campaigns" ADD COLUMN "title" text NOT NULL |
| columns | columns:public.communication_campaigns.subject. | ALTER TABLE public."communication_campaigns" ADD COLUMN "subject" text |
| columns | columns:public.communication_campaigns.body. | ALTER TABLE public."communication_campaigns" ADD COLUMN "body" text NOT NULL |
| columns | columns:public.communication_campaigns.category. | ALTER TABLE public."communication_campaigns" ADD COLUMN "category" text NOT NULL |
| columns | columns:public.communication_campaigns.target_type. | ALTER TABLE public."communication_campaigns" ADD COLUMN "target_type" text NOT NULL |
| columns | columns:public.communication_campaigns.target_criteria. | ALTER TABLE public."communication_campaigns" ADD COLUMN "target_criteria" jsonb NOT NULL |
| columns | columns:public.communication_campaigns.channels. | ALTER TABLE public."communication_campaigns" ADD COLUMN "channels" text[] NOT NULL |
| columns | columns:public.communication_campaigns.status. | ALTER TABLE public."communication_campaigns" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.communication_campaigns.recipient_count. | ALTER TABLE public."communication_campaigns" ADD COLUMN "recipient_count" integer NOT NULL |
| columns | columns:public.communication_campaigns.scheduled_at. | ALTER TABLE public."communication_campaigns" ADD COLUMN "scheduled_at" timestamp with time zone |
| columns | columns:public.communication_campaigns.sent_at. | ALTER TABLE public."communication_campaigns" ADD COLUMN "sent_at" timestamp with time zone |
| columns | columns:public.communication_campaigns.created_at. | ALTER TABLE public."communication_campaigns" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_campaigns.updated_at. | ALTER TABLE public."communication_campaigns" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_campaigns.is_emergency. | ALTER TABLE public."communication_campaigns" ADD COLUMN "is_emergency" boolean NOT NULL |
| columns | columns:public.communication_campaigns.expires_at. | ALTER TABLE public."communication_campaigns" ADD COLUMN "expires_at" timestamp with time zone |
| columns | columns:public.communication_deliveries.id. | ALTER TABLE public."communication_deliveries" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.communication_deliveries.notification_id. | ALTER TABLE public."communication_deliveries" ADD COLUMN "notification_id" integer NOT NULL |
| columns | columns:public.communication_deliveries.channel. | ALTER TABLE public."communication_deliveries" ADD COLUMN "channel" text NOT NULL |
| columns | columns:public.communication_deliveries.status. | ALTER TABLE public."communication_deliveries" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.communication_deliveries.provider_message_id. | ALTER TABLE public."communication_deliveries" ADD COLUMN "provider_message_id" text |
| columns | columns:public.communication_deliveries.provider_acknowledged_at. | ALTER TABLE public."communication_deliveries" ADD COLUMN "provider_acknowledged_at" timestamp with time zone |
| columns | columns:public.communication_deliveries.sent_at. | ALTER TABLE public."communication_deliveries" ADD COLUMN "sent_at" timestamp with time zone |
| columns | columns:public.communication_deliveries.delivered_at. | ALTER TABLE public."communication_deliveries" ADD COLUMN "delivered_at" timestamp with time zone |
| columns | columns:public.communication_deliveries.failed_at. | ALTER TABLE public."communication_deliveries" ADD COLUMN "failed_at" timestamp with time zone |
| columns | columns:public.communication_deliveries.error_code. | ALTER TABLE public."communication_deliveries" ADD COLUMN "error_code" text |
| columns | columns:public.communication_deliveries.last_error. | ALTER TABLE public."communication_deliveries" ADD COLUMN "last_error" text |
| columns | columns:public.communication_deliveries.attempts. | ALTER TABLE public."communication_deliveries" ADD COLUMN "attempts" integer NOT NULL |
| columns | columns:public.communication_deliveries.next_attempt_at. | ALTER TABLE public."communication_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_deliveries.last_attempt_at. | ALTER TABLE public."communication_deliveries" ADD COLUMN "last_attempt_at" timestamp with time zone |
| columns | columns:public.communication_deliveries.created_at. | ALTER TABLE public."communication_deliveries" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_deliveries.updated_at. | ALTER TABLE public."communication_deliveries" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_deliveries.push_attempts. | ALTER TABLE public."communication_deliveries" ADD COLUMN "push_attempts" jsonb NOT NULL DEFAULT '{}'::jsonb |
| columns | columns:public.communication_deliveries.receipt_ids. | ALTER TABLE public."communication_deliveries" ADD COLUMN "receipt_ids" jsonb NOT NULL DEFAULT '[]'::jsonb |
| columns | columns:public.communication_deliveries.provider_name. | ALTER TABLE public."communication_deliveries" ADD COLUMN "provider_name" text |
| columns | columns:public.communication_message_threads.id. | ALTER TABLE public."communication_message_threads" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.communication_message_threads.school_id. | ALTER TABLE public."communication_message_threads" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.communication_message_threads.student_id. | ALTER TABLE public."communication_message_threads" ADD COLUMN "student_id" integer NOT NULL |
| columns | columns:public.communication_message_threads.subject_class_id. | ALTER TABLE public."communication_message_threads" ADD COLUMN "subject_class_id" integer |
| columns | columns:public.communication_message_threads.parent_user_id. | ALTER TABLE public."communication_message_threads" ADD COLUMN "parent_user_id" integer NOT NULL |
| columns | columns:public.communication_message_threads.created_by_user_id. | ALTER TABLE public."communication_message_threads" ADD COLUMN "created_by_user_id" integer NOT NULL |
| columns | columns:public.communication_message_threads.request_key. | ALTER TABLE public."communication_message_threads" ADD COLUMN "request_key" text NOT NULL |
| columns | columns:public.communication_message_threads.request_hash. | ALTER TABLE public."communication_message_threads" ADD COLUMN "request_hash" text NOT NULL |
| columns | columns:public.communication_message_threads.subject. | ALTER TABLE public."communication_message_threads" ADD COLUMN "subject" text NOT NULL |
| columns | columns:public.communication_message_threads.category. | ALTER TABLE public."communication_message_threads" ADD COLUMN "category" text NOT NULL |
| columns | columns:public.communication_message_threads.parent_last_read_at. | ALTER TABLE public."communication_message_threads" ADD COLUMN "parent_last_read_at" timestamp with time zone |
| columns | columns:public.communication_message_threads.school_last_read_at. | ALTER TABLE public."communication_message_threads" ADD COLUMN "school_last_read_at" timestamp with time zone |
| columns | columns:public.communication_message_threads.parent_archived_at. | ALTER TABLE public."communication_message_threads" ADD COLUMN "parent_archived_at" timestamp with time zone |
| columns | columns:public.communication_message_threads.school_archived_at. | ALTER TABLE public."communication_message_threads" ADD COLUMN "school_archived_at" timestamp with time zone |
| columns | columns:public.communication_message_threads.last_message_at. | ALTER TABLE public."communication_message_threads" ADD COLUMN "last_message_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_message_threads.created_at. | ALTER TABLE public."communication_message_threads" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_message_threads.updated_at. | ALTER TABLE public."communication_message_threads" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_messages.id. | ALTER TABLE public."communication_messages" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.communication_messages.thread_id. | ALTER TABLE public."communication_messages" ADD COLUMN "thread_id" integer NOT NULL |
| columns | columns:public.communication_messages.school_id. | ALTER TABLE public."communication_messages" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.communication_messages.sender_user_id. | ALTER TABLE public."communication_messages" ADD COLUMN "sender_user_id" integer NOT NULL |
| columns | columns:public.communication_messages.request_key. | ALTER TABLE public."communication_messages" ADD COLUMN "request_key" text NOT NULL |
| columns | columns:public.communication_messages.content_hash. | ALTER TABLE public."communication_messages" ADD COLUMN "content_hash" text NOT NULL |
| columns | columns:public.communication_messages.body. | ALTER TABLE public."communication_messages" ADD COLUMN "body" text NOT NULL |
| columns | columns:public.communication_messages.created_at. | ALTER TABLE public."communication_messages" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_notifications.id. | ALTER TABLE public."communication_notifications" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.communication_notifications.recipient_user_id. | ALTER TABLE public."communication_notifications" ADD COLUMN "recipient_user_id" integer NOT NULL |
| columns | columns:public.communication_notifications.school_id. | ALTER TABLE public."communication_notifications" ADD COLUMN "school_id" integer |
| columns | columns:public.communication_notifications.sender_user_id. | ALTER TABLE public."communication_notifications" ADD COLUMN "sender_user_id" integer |
| columns | columns:public.communication_notifications.category. | ALTER TABLE public."communication_notifications" ADD COLUMN "category" text NOT NULL |
| columns | columns:public.communication_notifications.event_key. | ALTER TABLE public."communication_notifications" ADD COLUMN "event_key" text |
| columns | columns:public.communication_notifications.subject. | ALTER TABLE public."communication_notifications" ADD COLUMN "subject" text |
| columns | columns:public.communication_notifications.body. | ALTER TABLE public."communication_notifications" ADD COLUMN "body" text NOT NULL |
| columns | columns:public.communication_notifications.link. | ALTER TABLE public."communication_notifications" ADD COLUMN "link" text |
| columns | columns:public.communication_notifications.is_read. | ALTER TABLE public."communication_notifications" ADD COLUMN "is_read" boolean NOT NULL |
| columns | columns:public.communication_notifications.read_at. | ALTER TABLE public."communication_notifications" ADD COLUMN "read_at" timestamp with time zone |
| columns | columns:public.communication_notifications.created_at. | ALTER TABLE public."communication_notifications" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_notifications.subject_student_id. | ALTER TABLE public."communication_notifications" ADD COLUMN "subject_student_id" integer |
| columns | columns:public.communication_notifications.subject_class_id. | ALTER TABLE public."communication_notifications" ADD COLUMN "subject_class_id" integer |
| columns | columns:public.communication_notifications.archived_at. | ALTER TABLE public."communication_notifications" ADD COLUMN "archived_at" timestamp with time zone |
| columns | columns:public.communication_push_devices.id. | ALTER TABLE public."communication_push_devices" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.communication_push_devices.user_id. | ALTER TABLE public."communication_push_devices" ADD COLUMN "user_id" integer NOT NULL |
| columns | columns:public.communication_push_devices.school_id. | ALTER TABLE public."communication_push_devices" ADD COLUMN "school_id" integer |
| columns | columns:public.communication_push_devices.provider. | ALTER TABLE public."communication_push_devices" ADD COLUMN "provider" text NOT NULL |
| columns | columns:public.communication_push_devices.opaque_device_reference. | ALTER TABLE public."communication_push_devices" ADD COLUMN "opaque_device_reference" text NOT NULL |
| columns | columns:public.communication_push_devices.status. | ALTER TABLE public."communication_push_devices" ADD COLUMN "status" text NOT NULL |
| columns | columns:public.communication_push_devices.created_at. | ALTER TABLE public."communication_push_devices" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_push_devices.last_used_at. | ALTER TABLE public."communication_push_devices" ADD COLUMN "last_used_at" timestamp with time zone |
| columns | columns:public.communication_push_devices.revoked_at. | ALTER TABLE public."communication_push_devices" ADD COLUMN "revoked_at" timestamp with time zone |
| columns | columns:public.communication_push_devices.subscription. | ALTER TABLE public."communication_push_devices" ADD COLUMN "subscription" jsonb |
| columns | columns:public.communication_push_devices.session_id. | ALTER TABLE public."communication_push_devices" ADD COLUMN "session_id" text |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.communication_campaigns; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_deliveries; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_message_threads; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_messages; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_push_devices; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs 286
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous
- STOP if communication_deliveries.push_attempts default/guard/old-row initializer differs from jsonb NOT NULL DEFAULT '{}'::jsonb
- STOP if communication_deliveries.receipt_ids default/guard/old-row initializer differs from jsonb NOT NULL DEFAULT '[]'::jsonb

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0106_reconcile_columns_h_2.sql

- [ ] Hash matches **a5dd799c7d2bef4d81f4098c913141acc3f25f41094e76d85dbdb2cf6cd9ad0a**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0068_reconcile_sequences_h_1.sql, 0076_reconcile_table_shells_h_1.sql.
- [ ] Required objects verified: tables:public..communication_templates.; sequences:public.communication_templates.communication_templates_id_seq..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.communication_templates.id. | ALTER TABLE public."communication_templates" ADD COLUMN "id" integer NOT NULL |
| columns | columns:public.communication_templates.school_id. | ALTER TABLE public."communication_templates" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.communication_templates.template_key. | ALTER TABLE public."communication_templates" ADD COLUMN "template_key" text NOT NULL |
| columns | columns:public.communication_templates.name. | ALTER TABLE public."communication_templates" ADD COLUMN "name" text NOT NULL |
| columns | columns:public.communication_templates.category. | ALTER TABLE public."communication_templates" ADD COLUMN "category" text NOT NULL |
| columns | columns:public.communication_templates.channel. | ALTER TABLE public."communication_templates" ADD COLUMN "channel" text NOT NULL |
| columns | columns:public.communication_templates.subject. | ALTER TABLE public."communication_templates" ADD COLUMN "subject" text |
| columns | columns:public.communication_templates.body. | ALTER TABLE public."communication_templates" ADD COLUMN "body" text NOT NULL |
| columns | columns:public.communication_templates.allowed_variables. | ALTER TABLE public."communication_templates" ADD COLUMN "allowed_variables" text[] NOT NULL |
| columns | columns:public.communication_templates.is_active. | ALTER TABLE public."communication_templates" ADD COLUMN "is_active" boolean NOT NULL |
| columns | columns:public.communication_templates.created_by_user_id. | ALTER TABLE public."communication_templates" ADD COLUMN "created_by_user_id" integer |
| columns | columns:public.communication_templates.created_at. | ALTER TABLE public."communication_templates" ADD COLUMN "created_at" timestamp with time zone NOT NULL |
| columns | columns:public.communication_templates.updated_at. | ALTER TABLE public."communication_templates" ADD COLUMN "updated_at" timestamp with time zone NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.communication_templates; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0107_reconcile_columns_i_1.sql

- [ ] Hash matches **43bf2fa8fb8fb57ae520bfbdb603755ee1899cbc244e0d4817eaddac6d9b8928**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0077_reconcile_table_shells_i_1.sql.
- [ ] Required objects verified: tables:public..device_school_bindings..
- [ ] Expected schema: Missing columns are added by exact listed source DDL and guarded default/nullability reconciliation. Canonical defaults/NOT NULL are checked; populated required additions remain strict except the five approved tuples. Existing equivalent definitions are no-ops; only pre-reviewed fee_invoices/fee_payments student_id NOT NULL relaxation is permitted where present, with no value rewrite.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Serial/default metadata may reference the already-created exact sequences; default definition changes alone must not call nextval or consume values. No row insertion or position reset.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| columns | columns:public.device_school_bindings.device_id. | ALTER TABLE public."device_school_bindings" ADD COLUMN "device_id" integer NOT NULL |
| columns | columns:public.device_school_bindings.school_id. | ALTER TABLE public."device_school_bindings" ADD COLUMN "school_id" integer NOT NULL |
| columns | columns:public.device_school_bindings.created_at. | ALTER TABLE public."device_school_bindings" ADD COLUMN "created_at" timestamp with time zone NOT NULL |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.device_school_bindings; account only explicitly approved new fields/empty new table
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0108_reconcile_sequence_ownership_a_1.sql

- [ ] Hash matches **48311cbc2df0936c97a9f086eb10c18a26351f9d29b76a824248382a398bcb19**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0061_reconcile_sequences_a_1.sql, 0078_reconcile_columns_a_1.sql, 0079_reconcile_columns_a_2.sql, 0080_reconcile_columns_a_3.sql, 0081_reconcile_columns_a_4.sql, 0082_reconcile_columns_a_5.sql, 0083_reconcile_columns_a_6.sql, 0084_reconcile_columns_a_7.sql, 0085_reconcile_columns_a_8.sql, 0086_reconcile_columns_a_9.sql.
- [ ] Required objects verified: sequences:public.academic_assessment_types.academic_assessment_types_id_seq.; columns:public.academic_assessment_types.id.; sequences:public.academic_assessments.academic_assessments_id_seq.; columns:public.academic_assessments.id.; sequences:public.academic_assignments.academic_assignments_id_seq.; columns:public.academic_assignments.id.; sequences:public.academic_grading_rules.academic_grading_rules_id_seq.; columns:public.academic_grading_rules.id.; sequences:public.academic_report_card_lines.academic_report_card_lines_id_seq.; columns:public.academic_report_card_lines.id.; sequences:public.academic_report_cards.academic_report_cards_id_seq.; columns:public.academic_report_cards.id.; sequences:public.academic_sessions.academic_sessions_id_seq.; columns:public.academic_sessions.id.; sequences:public.academic_terms.academic_terms_id_seq.; columns:public.academic_terms.id.; sequences:public.academic_timetable_entries.academic_timetable_entries_id_seq.; columns:public.academic_timetable_entries.id.; sequences:public.app_users.app_users_id_seq.; columns:public.app_users.id.; sequences:public.attendance_corrections.attendance_corrections_id_seq.; columns:public.attendance_corrections.id.; sequences:public.attendance_notification_events.attendance_notification_events_id_seq.; columns:public.attendance_notification_events.id.; sequences:public.attendance_settings.attendance_settings_id_seq.; columns:public.attendance_settings.id.; sequences:public.audit_logs.audit_logs_id_seq.; columns:public.audit_logs.id.; sequences:public.biometric_enrollments.biometric_enrollments_id_seq.; columns:public.biometric_enrollments.id.; sequences:public.commission_ledger.commission_ledger_id_seq.; columns:public.commission_ledger.id.; sequences:public.commission_rules.commission_rules_id_seq.; columns:public.commission_rules.id.; sequences:public.communication_campaign_recipients.communication_campaign_recipients_id_seq.; columns:public.communication_campaign_recipients.id.; sequences:public.communication_preferences.communication_preferences_id_seq.; columns:public.communication_preferences.id.; sequences:public.device_assignment_history.device_assignment_history_id_seq.; columns:public.device_assignment_history.id.; sequences:public.device_credentials.device_credentials_id_seq.; columns:public.device_credentials.id.; sequences:public.fee_adjustments.fee_adjustments_id_seq.; columns:public.fee_adjustments.id.; sequences:public.fee_invoice_lines.fee_invoice_lines_id_seq.; columns:public.fee_invoice_lines.id.; sequences:public.fee_invoice_notification_outbox.fee_invoice_notification_outbox_id_seq.; columns:public.fee_invoice_notification_outbox.id.; sequences:public.fee_invoice_notifications.fee_invoice_notifications_id_seq.; columns:public.fee_invoice_notifications.id.; sequences:public.fee_payment_notification_outbox.fee_payment_notification_outbox_id_seq.; columns:public.fee_payment_notification_outbox.id.; sequences:public.fee_payment_notifications.fee_payment_notifications_id_seq.; columns:public.fee_payment_notifications.id.; sequences:public.fee_provider_webhook_events.fee_provider_webhook_events_id_seq.; columns:public.fee_provider_webhook_events.id.; sequences:public.fee_receipts.fee_receipts_id_seq.; columns:public.fee_receipts.id.; sequences:public.fee_refunds.fee_refunds_id_seq.; columns:public.fee_refunds.id.; sequences:public.fee_structure_lines.fee_structure_lines_id_seq.; columns:public.fee_structure_lines.id.; sequences:public.fee_structures.fee_structures_id_seq.; columns:public.fee_structures.id.; sequences:public.library_authors.library_authors_id_seq.; columns:public.library_authors.id.; sequences:public.library_book_copies.library_book_copies_id_seq.; columns:public.library_book_copies.id.; sequences:public.library_books.library_books_id_seq.; columns:public.library_books.id.; sequences:public.library_categories.library_categories_id_seq.; columns:public.library_categories.id.; sequences:public.library_copy_status_history.library_copy_status_history_id_seq.; columns:public.library_copy_status_history.id.; sequences:public.library_loans.library_loans_id_seq.; columns:public.library_loans.id.; sequences:public.library_publishers.library_publishers_id_seq.; columns:public.library_publishers.id.; sequences:public.library_renewals.library_renewals_id_seq.; columns:public.library_renewals.id.; sequences:public.library_staff.library_staff_id_seq.; columns:public.library_staff.id.; sequences:public.maintenance_requests.maintenance_requests_id_seq.; columns:public.maintenance_requests.id.; sequences:public.nfc_card_history.nfc_card_history_id_seq.; columns:public.nfc_card_history.id.; sequences:public.nfc_cards.nfc_cards_id_seq.; columns:public.nfc_cards.id.; sequences:public.operational_tasks.operational_tasks_id_seq.; columns:public.operational_tasks.id.; sequences:public.parent_student_relationships.parent_student_relationships_id_seq.; columns:public.parent_student_relationships.id.; sequences:public.parents.parents_id_seq.; columns:public.parents.id.; sequences:public.partner_attribution_conflicts.partner_attribution_conflicts_id_seq.; columns:public.partner_attribution_conflicts.id.; sequences:public.partner_invitations.partner_invitations_id_seq.; columns:public.partner_invitations.id.; sequences:public.partner_payout_information.partner_payout_information_id_seq.; columns:public.partner_payout_information.id.; sequences:public.partner_payouts.partner_payouts_id_seq.; columns:public.partner_payouts.id.; sequences:public.partner_referral_links.partner_referral_links_id_seq.; columns:public.partner_referral_links.id.; sequences:public.platform_company_employees.platform_company_employees_id_seq.; columns:public.platform_company_employees.id.; sequences:public.platform_notifications.platform_notifications_id_seq.; columns:public.platform_notifications.id.; sequences:public.school_assets.school_assets_id_seq.; columns:public.school_assets.id.; sequences:public.school_classes.school_classes_id_seq.; columns:public.school_classes.id.; sequences:public.school_facilities.school_facilities_id_seq.; columns:public.school_facilities.id.; sequences:public.school_memberships.school_memberships_id_seq.; columns:public.school_memberships.id.; sequences:public.schools.schools_id_seq.; columns:public.schools.id.; sequences:public.student_identification_policies.student_identification_policies_id_seq.; columns:public.student_identification_policies.id.; sequences:public.students.students_id_seq.; columns:public.students.id.; sequences:public.subscriptions.subscriptions_id_seq.; columns:public.subscriptions.id..
- [ ] Expected schema: Attach missing sequence OWNED BY only to exact listed existing typed owner column after prerequisites. Matching ownership is unchanged; conflicting ownership fails. No reassignment/reset/reseed.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Ownership metadata only where missing and correct; no value advancement/reset or type/position changes.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| ownership | ownership:public.academic_assessment_types.academic_assessment_types_id_seq. | ALTER SEQUENCE public."academic_assessment_types_id_seq" OWNED BY public."academic_assessment_types"."id" |
| ownership | ownership:public.academic_assessments.academic_assessments_id_seq. | ALTER SEQUENCE public."academic_assessments_id_seq" OWNED BY public."academic_assessments"."id" |
| ownership | ownership:public.academic_assignments.academic_assignments_id_seq. | ALTER SEQUENCE public."academic_assignments_id_seq" OWNED BY public."academic_assignments"."id" |
| ownership | ownership:public.academic_grading_rules.academic_grading_rules_id_seq. | ALTER SEQUENCE public."academic_grading_rules_id_seq" OWNED BY public."academic_grading_rules"."id" |
| ownership | ownership:public.academic_report_card_lines.academic_report_card_lines_id_seq. | ALTER SEQUENCE public."academic_report_card_lines_id_seq" OWNED BY public."academic_report_card_lines"."id" |
| ownership | ownership:public.academic_report_cards.academic_report_cards_id_seq. | ALTER SEQUENCE public."academic_report_cards_id_seq" OWNED BY public."academic_report_cards"."id" |
| ownership | ownership:public.academic_sessions.academic_sessions_id_seq. | ALTER SEQUENCE public."academic_sessions_id_seq" OWNED BY public."academic_sessions"."id" |
| ownership | ownership:public.academic_terms.academic_terms_id_seq. | ALTER SEQUENCE public."academic_terms_id_seq" OWNED BY public."academic_terms"."id" |
| ownership | ownership:public.academic_timetable_entries.academic_timetable_entries_id_seq. | ALTER SEQUENCE public."academic_timetable_entries_id_seq" OWNED BY public."academic_timetable_entries"."id" |
| ownership | ownership:public.app_users.app_users_id_seq. | ALTER SEQUENCE public."app_users_id_seq" OWNED BY public."app_users"."id" |
| ownership | ownership:public.attendance_corrections.attendance_corrections_id_seq. | ALTER SEQUENCE public."attendance_corrections_id_seq" OWNED BY public."attendance_corrections"."id" |
| ownership | ownership:public.attendance_notification_events.attendance_notification_events_id_seq. | ALTER SEQUENCE public."attendance_notification_events_id_seq" OWNED BY public."attendance_notification_events"."id" |
| ownership | ownership:public.attendance_settings.attendance_settings_id_seq. | ALTER SEQUENCE public."attendance_settings_id_seq" OWNED BY public."attendance_settings"."id" |
| ownership | ownership:public.audit_logs.audit_logs_id_seq. | ALTER SEQUENCE public."audit_logs_id_seq" OWNED BY public."audit_logs"."id" |
| ownership | ownership:public.biometric_enrollments.biometric_enrollments_id_seq. | ALTER SEQUENCE public."biometric_enrollments_id_seq" OWNED BY public."biometric_enrollments"."id" |
| ownership | ownership:public.commission_ledger.commission_ledger_id_seq. | ALTER SEQUENCE public."commission_ledger_id_seq" OWNED BY public."commission_ledger"."id" |
| ownership | ownership:public.commission_rules.commission_rules_id_seq. | ALTER SEQUENCE public."commission_rules_id_seq" OWNED BY public."commission_rules"."id" |
| ownership | ownership:public.communication_campaign_recipients.communication_campaign_recipients_id_seq. | ALTER SEQUENCE public."communication_campaign_recipients_id_seq" OWNED BY public."communication_campaign_recipients"."id" |
| ownership | ownership:public.communication_preferences.communication_preferences_id_seq. | ALTER SEQUENCE public."communication_preferences_id_seq" OWNED BY public."communication_preferences"."id" |
| ownership | ownership:public.device_assignment_history.device_assignment_history_id_seq. | ALTER SEQUENCE public."device_assignment_history_id_seq" OWNED BY public."device_assignment_history"."id" |
| ownership | ownership:public.device_credentials.device_credentials_id_seq. | ALTER SEQUENCE public."device_credentials_id_seq" OWNED BY public."device_credentials"."id" |
| ownership | ownership:public.fee_adjustments.fee_adjustments_id_seq. | ALTER SEQUENCE public."fee_adjustments_id_seq" OWNED BY public."fee_adjustments"."id" |
| ownership | ownership:public.fee_invoice_lines.fee_invoice_lines_id_seq. | ALTER SEQUENCE public."fee_invoice_lines_id_seq" OWNED BY public."fee_invoice_lines"."id" |
| ownership | ownership:public.fee_invoice_notification_outbox.fee_invoice_notification_outbox_id_seq. | ALTER SEQUENCE public."fee_invoice_notification_outbox_id_seq" OWNED BY public."fee_invoice_notification_outbox"."id" |
| ownership | ownership:public.fee_invoice_notifications.fee_invoice_notifications_id_seq. | ALTER SEQUENCE public."fee_invoice_notifications_id_seq" OWNED BY public."fee_invoice_notifications"."id" |
| ownership | ownership:public.fee_payment_notification_outbox.fee_payment_notification_outbox_id_seq. | ALTER SEQUENCE public."fee_payment_notification_outbox_id_seq" OWNED BY public."fee_payment_notification_outbox"."id" |
| ownership | ownership:public.fee_payment_notifications.fee_payment_notifications_id_seq. | ALTER SEQUENCE public."fee_payment_notifications_id_seq" OWNED BY public."fee_payment_notifications"."id" |
| ownership | ownership:public.fee_provider_webhook_events.fee_provider_webhook_events_id_seq. | ALTER SEQUENCE public."fee_provider_webhook_events_id_seq" OWNED BY public."fee_provider_webhook_events"."id" |
| ownership | ownership:public.fee_receipts.fee_receipts_id_seq. | ALTER SEQUENCE public."fee_receipts_id_seq" OWNED BY public."fee_receipts"."id" |
| ownership | ownership:public.fee_refunds.fee_refunds_id_seq. | ALTER SEQUENCE public."fee_refunds_id_seq" OWNED BY public."fee_refunds"."id" |
| ownership | ownership:public.fee_structure_lines.fee_structure_lines_id_seq. | ALTER SEQUENCE public."fee_structure_lines_id_seq" OWNED BY public."fee_structure_lines"."id" |
| ownership | ownership:public.fee_structures.fee_structures_id_seq. | ALTER SEQUENCE public."fee_structures_id_seq" OWNED BY public."fee_structures"."id" |
| ownership | ownership:public.library_authors.library_authors_id_seq. | ALTER SEQUENCE public."library_authors_id_seq" OWNED BY public."library_authors"."id" |
| ownership | ownership:public.library_book_copies.library_book_copies_id_seq. | ALTER SEQUENCE public."library_book_copies_id_seq" OWNED BY public."library_book_copies"."id" |
| ownership | ownership:public.library_books.library_books_id_seq. | ALTER SEQUENCE public."library_books_id_seq" OWNED BY public."library_books"."id" |
| ownership | ownership:public.library_categories.library_categories_id_seq. | ALTER SEQUENCE public."library_categories_id_seq" OWNED BY public."library_categories"."id" |
| ownership | ownership:public.library_copy_status_history.library_copy_status_history_id_seq. | ALTER SEQUENCE public."library_copy_status_history_id_seq" OWNED BY public."library_copy_status_history"."id" |
| ownership | ownership:public.library_loans.library_loans_id_seq. | ALTER SEQUENCE public."library_loans_id_seq" OWNED BY public."library_loans"."id" |
| ownership | ownership:public.library_publishers.library_publishers_id_seq. | ALTER SEQUENCE public."library_publishers_id_seq" OWNED BY public."library_publishers"."id" |
| ownership | ownership:public.library_renewals.library_renewals_id_seq. | ALTER SEQUENCE public."library_renewals_id_seq" OWNED BY public."library_renewals"."id" |
| ownership | ownership:public.library_staff.library_staff_id_seq. | ALTER SEQUENCE public."library_staff_id_seq" OWNED BY public."library_staff"."id" |
| ownership | ownership:public.maintenance_requests.maintenance_requests_id_seq. | ALTER SEQUENCE public."maintenance_requests_id_seq" OWNED BY public."maintenance_requests"."id" |
| ownership | ownership:public.nfc_card_history.nfc_card_history_id_seq. | ALTER SEQUENCE public."nfc_card_history_id_seq" OWNED BY public."nfc_card_history"."id" |
| ownership | ownership:public.nfc_cards.nfc_cards_id_seq. | ALTER SEQUENCE public."nfc_cards_id_seq" OWNED BY public."nfc_cards"."id" |
| ownership | ownership:public.operational_tasks.operational_tasks_id_seq. | ALTER SEQUENCE public."operational_tasks_id_seq" OWNED BY public."operational_tasks"."id" |
| ownership | ownership:public.parent_student_relationships.parent_student_relationships_id_seq. | ALTER SEQUENCE public."parent_student_relationships_id_seq" OWNED BY public."parent_student_relationships"."id" |
| ownership | ownership:public.parents.parents_id_seq. | ALTER SEQUENCE public."parents_id_seq" OWNED BY public."parents"."id" |
| ownership | ownership:public.partner_attribution_conflicts.partner_attribution_conflicts_id_seq. | ALTER SEQUENCE public."partner_attribution_conflicts_id_seq" OWNED BY public."partner_attribution_conflicts"."id" |
| ownership | ownership:public.partner_invitations.partner_invitations_id_seq. | ALTER SEQUENCE public."partner_invitations_id_seq" OWNED BY public."partner_invitations"."id" |
| ownership | ownership:public.partner_payout_information.partner_payout_information_id_seq. | ALTER SEQUENCE public."partner_payout_information_id_seq" OWNED BY public."partner_payout_information"."id" |
| ownership | ownership:public.partner_payouts.partner_payouts_id_seq. | ALTER SEQUENCE public."partner_payouts_id_seq" OWNED BY public."partner_payouts"."id" |
| ownership | ownership:public.partner_referral_links.partner_referral_links_id_seq. | ALTER SEQUENCE public."partner_referral_links_id_seq" OWNED BY public."partner_referral_links"."id" |
| ownership | ownership:public.platform_company_employees.platform_company_employees_id_seq. | ALTER SEQUENCE public."platform_company_employees_id_seq" OWNED BY public."platform_company_employees"."id" |
| ownership | ownership:public.platform_notifications.platform_notifications_id_seq. | ALTER SEQUENCE public."platform_notifications_id_seq" OWNED BY public."platform_notifications"."id" |
| ownership | ownership:public.school_assets.school_assets_id_seq. | ALTER SEQUENCE public."school_assets_id_seq" OWNED BY public."school_assets"."id" |
| ownership | ownership:public.school_classes.school_classes_id_seq. | ALTER SEQUENCE public."school_classes_id_seq" OWNED BY public."school_classes"."id" |
| ownership | ownership:public.school_facilities.school_facilities_id_seq. | ALTER SEQUENCE public."school_facilities_id_seq" OWNED BY public."school_facilities"."id" |
| ownership | ownership:public.school_memberships.school_memberships_id_seq. | ALTER SEQUENCE public."school_memberships_id_seq" OWNED BY public."school_memberships"."id" |
| ownership | ownership:public.schools.schools_id_seq. | ALTER SEQUENCE public."schools_id_seq" OWNED BY public."schools"."id" |
| ownership | ownership:public.student_identification_policies.student_identification_policies_id_seq. | ALTER SEQUENCE public."student_identification_policies_id_seq" OWNED BY public."student_identification_policies"."id" |
| ownership | ownership:public.students.students_id_seq. | ALTER SEQUENCE public."students_id_seq" OWNED BY public."students"."id" |
| ownership | ownership:public.subscriptions.subscriptions_id_seq. | ALTER SEQUENCE public."subscriptions_id_seq" OWNED BY public."subscriptions"."id" |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.academic_assessment_types; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_assessments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_assignments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_grading_rules; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_report_card_lines; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_report_cards; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_sessions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_terms; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_timetable_entries; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.app_users; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_corrections; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_notification_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_settings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.audit_logs; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.biometric_enrollments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.commission_ledger; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.commission_rules; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_campaign_recipients; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_preferences; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.device_assignment_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.device_credentials; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_adjustments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoice_lines; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoice_notification_outbox; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoice_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payment_notification_outbox; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payment_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_provider_webhook_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_receipts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_refunds; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_structure_lines; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_structures; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_authors; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_book_copies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_books; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_categories; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_copy_status_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_loans; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_publishers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_renewals; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.library_staff; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.maintenance_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.nfc_card_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.nfc_cards; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.operational_tasks; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.parent_student_relationships; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.parents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_attribution_conflicts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_invitations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_payout_information; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_payouts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_referral_links; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.platform_company_employees; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.platform_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_assets; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_classes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_facilities; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_memberships; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.schools; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_identification_policies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.students; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.subscriptions; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_assessment_types_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_assessments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_assignments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_grading_rules_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_report_card_lines_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_report_cards_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_sessions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_terms_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_timetable_entries_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.app_users_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.attendance_corrections_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.attendance_notification_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.attendance_settings_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.audit_logs_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.biometric_enrollments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.commission_ledger_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.commission_rules_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_campaign_recipients_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_preferences_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.device_assignment_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.device_credentials_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_adjustments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_invoice_lines_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_invoice_notification_outbox_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_invoice_notifications_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_payment_notification_outbox_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_payment_notifications_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_provider_webhook_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_receipts_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_refunds_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_structure_lines_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_structures_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_authors_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_book_copies_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_books_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_categories_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_copy_status_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_loans_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_publishers_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_renewals_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.library_staff_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.maintenance_requests_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.nfc_card_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.nfc_cards_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.operational_tasks_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.parent_student_relationships_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.parents_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_attribution_conflicts_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_invitations_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_payout_information_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_payouts_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_referral_links_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.platform_company_employees_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.platform_notifications_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_assets_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_classes_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_facilities_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_memberships_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.schools_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_identification_policies_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.students_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.subscriptions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0109_reconcile_sequence_ownership_b_1.sql

- [ ] Hash matches **3128c6812801e8a3eed18bb1ab0f7b591ac048463b1463b0bb9853ded8644141**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0062_reconcile_sequences_b_1.sql, 0087_reconcile_columns_b_1.sql.
- [ ] Required objects verified: sequences:public.partner_profile_users.partner_profile_users_id_seq.; columns:public.partner_profile_users.id.; sequences:public.partner_profiles.partner_profiles_id_seq.; columns:public.partner_profiles.id.; sequences:public.school_branding_logos.school_branding_logos_id_seq.; columns:public.school_branding_logos.id.; sequences:public.school_calendar_events.school_calendar_events_id_seq.; columns:public.school_calendar_events.id.; sequences:public.school_partner_attributions.school_partner_attributions_id_seq.; columns:public.school_partner_attributions.id.; sequences:public.teacher_duty_roster.teacher_duty_roster_id_seq.; columns:public.teacher_duty_roster.id.; sequences:public.teacher_subject_assignments.teacher_subject_assignments_id_seq.; columns:public.teacher_subject_assignments.id..
- [ ] Expected schema: Attach missing sequence OWNED BY only to exact listed existing typed owner column after prerequisites. Matching ownership is unchanged; conflicting ownership fails. No reassignment/reset/reseed.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Ownership metadata only where missing and correct; no value advancement/reset or type/position changes.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| ownership | ownership:public.partner_profile_users.partner_profile_users_id_seq. | ALTER SEQUENCE public."partner_profile_users_id_seq" OWNED BY public."partner_profile_users"."id" |
| ownership | ownership:public.partner_profiles.partner_profiles_id_seq. | ALTER SEQUENCE public."partner_profiles_id_seq" OWNED BY public."partner_profiles"."id" |
| ownership | ownership:public.school_branding_logos.school_branding_logos_id_seq. | ALTER SEQUENCE public."school_branding_logos_id_seq" OWNED BY public."school_branding_logos"."id" |
| ownership | ownership:public.school_calendar_events.school_calendar_events_id_seq. | ALTER SEQUENCE public."school_calendar_events_id_seq" OWNED BY public."school_calendar_events"."id" |
| ownership | ownership:public.school_partner_attributions.school_partner_attributions_id_seq. | ALTER SEQUENCE public."school_partner_attributions_id_seq" OWNED BY public."school_partner_attributions"."id" |
| ownership | ownership:public.teacher_duty_roster.teacher_duty_roster_id_seq. | ALTER SEQUENCE public."teacher_duty_roster_id_seq" OWNED BY public."teacher_duty_roster"."id" |
| ownership | ownership:public.teacher_subject_assignments.teacher_subject_assignments_id_seq. | ALTER SEQUENCE public."teacher_subject_assignments_id_seq" OWNED BY public."teacher_subject_assignments"."id" |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.partner_profile_users; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.partner_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_branding_logos; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_calendar_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_partner_attributions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.teacher_duty_roster; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.teacher_subject_assignments; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_profile_users_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.partner_profiles_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_branding_logos_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_calendar_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_partner_attributions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.teacher_duty_roster_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.teacher_subject_assignments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0110_reconcile_sequence_ownership_c_1.sql

- [ ] Hash matches **99a18916d0195138b9a9e9e653a29acd8b673b6d57a3c1f9b0c5951d8ce3c0ba**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0063_reconcile_sequences_c_1.sql, 0088_reconcile_columns_c_1.sql, 0089_reconcile_columns_c_2.sql, 0090_reconcile_columns_c_3.sql.
- [ ] Required objects verified: sequences:public.admission_application_documents.admission_application_documents_id_seq.; columns:public.admission_application_documents.id.; sequences:public.admission_applications.admission_applications_id_seq.; columns:public.admission_applications.id.; sequences:public.class_subjects.class_subjects_id_seq.; columns:public.class_subjects.id.; sequences:public.employees.employees_id_seq.; columns:public.employees.id.; sequences:public.student_behaviour_records.student_behaviour_records_id_seq.; columns:public.student_behaviour_records.id.; sequences:public.student_care_grants.student_care_grants_id_seq.; columns:public.student_care_grants.id.; sequences:public.student_care_idempotency.student_care_idempotency_id_seq.; columns:public.student_care_idempotency.id.; sequences:public.student_care_record_history.student_care_record_history_id_seq.; columns:public.student_care_record_history.id.; sequences:public.student_class_assignments.student_class_assignments_id_seq.; columns:public.student_class_assignments.id.; sequences:public.student_medical_profiles.student_medical_profiles_id_seq.; columns:public.student_medical_profiles.id.; sequences:public.student_medical_visits.student_medical_visits_id_seq.; columns:public.student_medical_visits.id.; sequences:public.student_welfare_records.student_welfare_records_id_seq.; columns:public.student_welfare_records.id.; sequences:public.subjects.subjects_id_seq.; columns:public.subjects.id.; sequences:public.teacher_class_assignments.teacher_class_assignments_id_seq.; columns:public.teacher_class_assignments.id..
- [ ] Expected schema: Attach missing sequence OWNED BY only to exact listed existing typed owner column after prerequisites. Matching ownership is unchanged; conflicting ownership fails. No reassignment/reset/reseed.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Ownership metadata only where missing and correct; no value advancement/reset or type/position changes.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| ownership | ownership:public.admission_application_documents.admission_application_documents_id_seq. | ALTER SEQUENCE public."admission_application_documents_id_seq" OWNED BY public."admission_application_documents"."id" |
| ownership | ownership:public.admission_applications.admission_applications_id_seq. | ALTER SEQUENCE public."admission_applications_id_seq" OWNED BY public."admission_applications"."id" |
| ownership | ownership:public.class_subjects.class_subjects_id_seq. | ALTER SEQUENCE public."class_subjects_id_seq" OWNED BY public."class_subjects"."id" |
| ownership | ownership:public.employees.employees_id_seq. | ALTER SEQUENCE public."employees_id_seq" OWNED BY public."employees"."id" |
| ownership | ownership:public.student_behaviour_records.student_behaviour_records_id_seq. | ALTER SEQUENCE public."student_behaviour_records_id_seq" OWNED BY public."student_behaviour_records"."id" |
| ownership | ownership:public.student_care_grants.student_care_grants_id_seq. | ALTER SEQUENCE public."student_care_grants_id_seq" OWNED BY public."student_care_grants"."id" |
| ownership | ownership:public.student_care_idempotency.student_care_idempotency_id_seq. | ALTER SEQUENCE public."student_care_idempotency_id_seq" OWNED BY public."student_care_idempotency"."id" |
| ownership | ownership:public.student_care_record_history.student_care_record_history_id_seq. | ALTER SEQUENCE public."student_care_record_history_id_seq" OWNED BY public."student_care_record_history"."id" |
| ownership | ownership:public.student_class_assignments.student_class_assignments_id_seq. | ALTER SEQUENCE public."student_class_assignments_id_seq" OWNED BY public."student_class_assignments"."id" |
| ownership | ownership:public.student_medical_profiles.student_medical_profiles_id_seq. | ALTER SEQUENCE public."student_medical_profiles_id_seq" OWNED BY public."student_medical_profiles"."id" |
| ownership | ownership:public.student_medical_visits.student_medical_visits_id_seq. | ALTER SEQUENCE public."student_medical_visits_id_seq" OWNED BY public."student_medical_visits"."id" |
| ownership | ownership:public.student_welfare_records.student_welfare_records_id_seq. | ALTER SEQUENCE public."student_welfare_records_id_seq" OWNED BY public."student_welfare_records"."id" |
| ownership | ownership:public.subjects.subjects_id_seq. | ALTER SEQUENCE public."subjects_id_seq" OWNED BY public."subjects"."id" |
| ownership | ownership:public.teacher_class_assignments.teacher_class_assignments_id_seq. | ALTER SEQUENCE public."teacher_class_assignments_id_seq" OWNED BY public."teacher_class_assignments"."id" |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.admission_application_documents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.admission_applications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.class_subjects; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employees; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_behaviour_records; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_care_grants; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_care_idempotency; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_care_record_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_class_assignments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_medical_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_medical_visits; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_welfare_records; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.subjects; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.teacher_class_assignments; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.admission_application_documents_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.admission_applications_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.class_subjects_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.employees_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_behaviour_records_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_care_grants_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_care_idempotency_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_care_record_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_class_assignments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_medical_profiles_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_medical_visits_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_welfare_records_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.subjects_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.teacher_class_assignments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0111_reconcile_sequence_ownership_d_1.sql

- [ ] Hash matches **2b553e1dbdadf8dfdfac0e4f9ae809009cf2ad9c016a5e78420e780fd882d044**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0064_reconcile_sequences_d_1.sql, 0091_reconcile_columns_d_1.sql.
- [ ] Required objects verified: sequences:public.attendance_discrepancies.attendance_discrepancies_id_seq.; columns:public.attendance_discrepancies.id.; sequences:public.attendance_events.attendance_events_id_seq.; columns:public.attendance_events.id..
- [ ] Expected schema: Attach missing sequence OWNED BY only to exact listed existing typed owner column after prerequisites. Matching ownership is unchanged; conflicting ownership fails. No reassignment/reset/reseed.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Ownership metadata only where missing and correct; no value advancement/reset or type/position changes.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| ownership | ownership:public.attendance_discrepancies.attendance_discrepancies_id_seq. | ALTER SEQUENCE public."attendance_discrepancies_id_seq" OWNED BY public."attendance_discrepancies"."id" |
| ownership | ownership:public.attendance_events.attendance_events_id_seq. | ALTER SEQUENCE public."attendance_events_id_seq" OWNED BY public."attendance_events"."id" |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_discrepancies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.attendance_events; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.attendance_discrepancies_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.attendance_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0112_reconcile_sequence_ownership_e_1.sql

- [ ] Hash matches **ec6725b3886a6b688df2a779bda8407f0f98a58e8a0436aa437dc402b71739c1**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0065_reconcile_sequences_e_1.sql, 0092_reconcile_columns_e_1.sql, 0093_reconcile_columns_e_2.sql, 0094_reconcile_columns_e_3.sql.
- [ ] Required objects verified: sequences:public.academic_result_batches.academic_result_batches_id_seq.; columns:public.academic_result_batches.id.; sequences:public.academic_results.academic_results_id_seq.; columns:public.academic_results.id.; sequences:public.curriculum_imports.curriculum_imports_id_seq.; columns:public.curriculum_imports.id.; sequences:public.curriculum_progress.curriculum_progress_id_seq.; columns:public.curriculum_progress.id.; sequences:public.curriculum_topics.curriculum_topics_id_seq.; columns:public.curriculum_topics.id.; sequences:public.curriculum_versions.curriculum_versions_id_seq.; columns:public.curriculum_versions.id.; sequences:public.exam_question_papers.exam_question_papers_id_seq.; columns:public.exam_question_papers.id.; sequences:public.exam_question_reviews.exam_question_reviews_id_seq.; columns:public.exam_question_reviews.id.; sequences:public.exam_question_versions.exam_question_versions_id_seq.; columns:public.exam_question_versions.id.; sequences:public.lesson_note_documents.lesson_note_documents_id_seq.; columns:public.lesson_note_documents.id.; sequences:public.lesson_note_reviews.lesson_note_reviews_id_seq.; columns:public.lesson_note_reviews.id.; sequences:public.lesson_notes.lesson_notes_id_seq.; columns:public.lesson_notes.id.; sequences:public.promotion_batch_students.promotion_batch_students_id_seq.; columns:public.promotion_batch_students.id.; sequences:public.promotion_batches.promotion_batches_id_seq.; columns:public.promotion_batches.id.; sequences:public.promotion_history.promotion_history_id_seq.; columns:public.promotion_history.id.; sequences:public.school_curriculum_assignments.school_curriculum_assignments_id_seq.; columns:public.school_curriculum_assignments.id..
- [ ] Expected schema: Attach missing sequence OWNED BY only to exact listed existing typed owner column after prerequisites. Matching ownership is unchanged; conflicting ownership fails. No reassignment/reset/reseed.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Ownership metadata only where missing and correct; no value advancement/reset or type/position changes.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| ownership | ownership:public.academic_result_batches.academic_result_batches_id_seq. | ALTER SEQUENCE public."academic_result_batches_id_seq" OWNED BY public."academic_result_batches"."id" |
| ownership | ownership:public.academic_results.academic_results_id_seq. | ALTER SEQUENCE public."academic_results_id_seq" OWNED BY public."academic_results"."id" |
| ownership | ownership:public.curriculum_imports.curriculum_imports_id_seq. | ALTER SEQUENCE public."curriculum_imports_id_seq" OWNED BY public."curriculum_imports"."id" |
| ownership | ownership:public.curriculum_progress.curriculum_progress_id_seq. | ALTER SEQUENCE public."curriculum_progress_id_seq" OWNED BY public."curriculum_progress"."id" |
| ownership | ownership:public.curriculum_topics.curriculum_topics_id_seq. | ALTER SEQUENCE public."curriculum_topics_id_seq" OWNED BY public."curriculum_topics"."id" |
| ownership | ownership:public.curriculum_versions.curriculum_versions_id_seq. | ALTER SEQUENCE public."curriculum_versions_id_seq" OWNED BY public."curriculum_versions"."id" |
| ownership | ownership:public.exam_question_papers.exam_question_papers_id_seq. | ALTER SEQUENCE public."exam_question_papers_id_seq" OWNED BY public."exam_question_papers"."id" |
| ownership | ownership:public.exam_question_reviews.exam_question_reviews_id_seq. | ALTER SEQUENCE public."exam_question_reviews_id_seq" OWNED BY public."exam_question_reviews"."id" |
| ownership | ownership:public.exam_question_versions.exam_question_versions_id_seq. | ALTER SEQUENCE public."exam_question_versions_id_seq" OWNED BY public."exam_question_versions"."id" |
| ownership | ownership:public.lesson_note_documents.lesson_note_documents_id_seq. | ALTER SEQUENCE public."lesson_note_documents_id_seq" OWNED BY public."lesson_note_documents"."id" |
| ownership | ownership:public.lesson_note_reviews.lesson_note_reviews_id_seq. | ALTER SEQUENCE public."lesson_note_reviews_id_seq" OWNED BY public."lesson_note_reviews"."id" |
| ownership | ownership:public.lesson_notes.lesson_notes_id_seq. | ALTER SEQUENCE public."lesson_notes_id_seq" OWNED BY public."lesson_notes"."id" |
| ownership | ownership:public.promotion_batch_students.promotion_batch_students_id_seq. | ALTER SEQUENCE public."promotion_batch_students_id_seq" OWNED BY public."promotion_batch_students"."id" |
| ownership | ownership:public.promotion_batches.promotion_batches_id_seq. | ALTER SEQUENCE public."promotion_batches_id_seq" OWNED BY public."promotion_batches"."id" |
| ownership | ownership:public.promotion_history.promotion_history_id_seq. | ALTER SEQUENCE public."promotion_history_id_seq" OWNED BY public."promotion_history"."id" |
| ownership | ownership:public.school_curriculum_assignments.school_curriculum_assignments_id_seq. | ALTER SEQUENCE public."school_curriculum_assignments_id_seq" OWNED BY public."school_curriculum_assignments"."id" |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.academic_result_batches; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.academic_results; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_imports; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_progress; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_topics; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.curriculum_versions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.exam_question_papers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.exam_question_reviews; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.exam_question_versions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.lesson_note_documents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.lesson_note_reviews; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.lesson_notes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.promotion_batch_students; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.promotion_batches; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.promotion_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_curriculum_assignments; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_result_batches_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.academic_results_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.curriculum_imports_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.curriculum_progress_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.curriculum_topics_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.curriculum_versions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.exam_question_papers_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.exam_question_reviews_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.exam_question_versions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.lesson_note_documents_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.lesson_note_reviews_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.lesson_notes_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.promotion_batch_students_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.promotion_batches_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.promotion_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_curriculum_assignments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0113_reconcile_sequence_ownership_f_1.sql

- [ ] Hash matches **fc11f561685afb4456d4a7561c341a5c6db4b960c2d16875a7ae332662a06a2a**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0066_reconcile_sequences_f_1.sql, 0095_reconcile_columns_f_1.sql, 0096_reconcile_columns_f_2.sql, 0097_reconcile_columns_f_3.sql, 0098_reconcile_columns_f_4.sql, 0099_reconcile_columns_f_5.sql.
- [ ] Required objects verified: sequences:public.fee_categories.fee_categories_id_seq.; columns:public.fee_categories.id.; sequences:public.fee_invoices.fee_invoices_id_seq.; columns:public.fee_invoices.id.; sequences:public.fee_payment_line_allocations.fee_payment_line_allocations_id_seq.; columns:public.fee_payment_line_allocations.id.; sequences:public.fee_payments.fee_payments_id_seq.; columns:public.fee_payments.id.; sequences:public.payroll_employee_profiles.payroll_employee_profiles_id_seq.; columns:public.payroll_employee_profiles.id.; sequences:public.payroll_items.payroll_items_id_seq.; columns:public.payroll_items.id.; sequences:public.payroll_payslips.payroll_payslips_id_seq.; columns:public.payroll_payslips.id.; sequences:public.payroll_periods.payroll_periods_id_seq.; columns:public.payroll_periods.id.; sequences:public.payroll_transfers.payroll_transfers_id_seq.; columns:public.payroll_transfers.id.; sequences:public.settlement_payroll_audit_events.settlement_payroll_audit_events_id_seq.; columns:public.settlement_payroll_audit_events.id.; sequences:public.settlement_payroll_profiles.settlement_payroll_profiles_id_seq.; columns:public.settlement_payroll_profiles.id.; sequences:public.staff_nfc_allocations.staff_nfc_allocations_id_seq.; columns:public.staff_nfc_allocations.id.; sequences:public.staff_nfc_billing_rules.staff_nfc_billing_rules_id_seq.; columns:public.staff_nfc_billing_rules.id.; sequences:public.staff_nfc_partner_commissions.staff_nfc_partner_commissions_id_seq.; columns:public.staff_nfc_partner_commissions.id.; sequences:public.staff_nfc_payments.staff_nfc_payments_id_seq.; columns:public.staff_nfc_payments.id.; sequences:public.staff_nfc_provider_events.staff_nfc_provider_events_id_seq.; columns:public.staff_nfc_provider_events.id.; sequences:public.staff_nfc_receipts.staff_nfc_receipts_id_seq.; columns:public.staff_nfc_receipts.id.; sequences:public.staff_nfc_refunds.staff_nfc_refunds_id_seq.; columns:public.staff_nfc_refunds.id.; sequences:public.staff_nfc_subscriptions.staff_nfc_subscriptions_id_seq.; columns:public.staff_nfc_subscriptions.id.; sequences:public.student_nfc_replacement_requests.student_nfc_replacement_requests_id_seq.; columns:public.student_nfc_replacement_requests.id..
- [ ] Expected schema: Attach missing sequence OWNED BY only to exact listed existing typed owner column after prerequisites. Matching ownership is unchanged; conflicting ownership fails. No reassignment/reset/reseed.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Ownership metadata only where missing and correct; no value advancement/reset or type/position changes.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| ownership | ownership:public.fee_categories.fee_categories_id_seq. | ALTER SEQUENCE public."fee_categories_id_seq" OWNED BY public."fee_categories"."id" |
| ownership | ownership:public.fee_invoices.fee_invoices_id_seq. | ALTER SEQUENCE public."fee_invoices_id_seq" OWNED BY public."fee_invoices"."id" |
| ownership | ownership:public.fee_payment_line_allocations.fee_payment_line_allocations_id_seq. | ALTER SEQUENCE public."fee_payment_line_allocations_id_seq" OWNED BY public."fee_payment_line_allocations"."id" |
| ownership | ownership:public.fee_payments.fee_payments_id_seq. | ALTER SEQUENCE public."fee_payments_id_seq" OWNED BY public."fee_payments"."id" |
| ownership | ownership:public.payroll_employee_profiles.payroll_employee_profiles_id_seq. | ALTER SEQUENCE public."payroll_employee_profiles_id_seq" OWNED BY public."payroll_employee_profiles"."id" |
| ownership | ownership:public.payroll_items.payroll_items_id_seq. | ALTER SEQUENCE public."payroll_items_id_seq" OWNED BY public."payroll_items"."id" |
| ownership | ownership:public.payroll_payslips.payroll_payslips_id_seq. | ALTER SEQUENCE public."payroll_payslips_id_seq" OWNED BY public."payroll_payslips"."id" |
| ownership | ownership:public.payroll_periods.payroll_periods_id_seq. | ALTER SEQUENCE public."payroll_periods_id_seq" OWNED BY public."payroll_periods"."id" |
| ownership | ownership:public.payroll_transfers.payroll_transfers_id_seq. | ALTER SEQUENCE public."payroll_transfers_id_seq" OWNED BY public."payroll_transfers"."id" |
| ownership | ownership:public.settlement_payroll_audit_events.settlement_payroll_audit_events_id_seq. | ALTER SEQUENCE public."settlement_payroll_audit_events_id_seq" OWNED BY public."settlement_payroll_audit_events"."id" |
| ownership | ownership:public.settlement_payroll_profiles.settlement_payroll_profiles_id_seq. | ALTER SEQUENCE public."settlement_payroll_profiles_id_seq" OWNED BY public."settlement_payroll_profiles"."id" |
| ownership | ownership:public.staff_nfc_allocations.staff_nfc_allocations_id_seq. | ALTER SEQUENCE public."staff_nfc_allocations_id_seq" OWNED BY public."staff_nfc_allocations"."id" |
| ownership | ownership:public.staff_nfc_billing_rules.staff_nfc_billing_rules_id_seq. | ALTER SEQUENCE public."staff_nfc_billing_rules_id_seq" OWNED BY public."staff_nfc_billing_rules"."id" |
| ownership | ownership:public.staff_nfc_partner_commissions.staff_nfc_partner_commissions_id_seq. | ALTER SEQUENCE public."staff_nfc_partner_commissions_id_seq" OWNED BY public."staff_nfc_partner_commissions"."id" |
| ownership | ownership:public.staff_nfc_payments.staff_nfc_payments_id_seq. | ALTER SEQUENCE public."staff_nfc_payments_id_seq" OWNED BY public."staff_nfc_payments"."id" |
| ownership | ownership:public.staff_nfc_provider_events.staff_nfc_provider_events_id_seq. | ALTER SEQUENCE public."staff_nfc_provider_events_id_seq" OWNED BY public."staff_nfc_provider_events"."id" |
| ownership | ownership:public.staff_nfc_receipts.staff_nfc_receipts_id_seq. | ALTER SEQUENCE public."staff_nfc_receipts_id_seq" OWNED BY public."staff_nfc_receipts"."id" |
| ownership | ownership:public.staff_nfc_refunds.staff_nfc_refunds_id_seq. | ALTER SEQUENCE public."staff_nfc_refunds_id_seq" OWNED BY public."staff_nfc_refunds"."id" |
| ownership | ownership:public.staff_nfc_subscriptions.staff_nfc_subscriptions_id_seq. | ALTER SEQUENCE public."staff_nfc_subscriptions_id_seq" OWNED BY public."staff_nfc_subscriptions"."id" |
| ownership | ownership:public.student_nfc_replacement_requests.student_nfc_replacement_requests_id_seq. | ALTER SEQUENCE public."student_nfc_replacement_requests_id_seq" OWNED BY public."student_nfc_replacement_requests"."id" |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.fee_categories; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_invoices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payment_line_allocations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.fee_payments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_employee_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_items; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_payslips; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_periods; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.payroll_transfers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.settlement_payroll_audit_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.settlement_payroll_profiles; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_allocations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_billing_rules; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_partner_commissions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_payments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_provider_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_receipts; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_refunds; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.staff_nfc_subscriptions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.student_nfc_replacement_requests; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_categories_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_invoices_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_payment_line_allocations_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.fee_payments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.payroll_employee_profiles_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.payroll_items_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.payroll_payslips_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.payroll_periods_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.payroll_transfers_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.settlement_payroll_audit_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.settlement_payroll_profiles_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_allocations_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_billing_rules_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_partner_commissions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_payments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_provider_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_receipts_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_refunds_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.staff_nfc_subscriptions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.student_nfc_replacement_requests_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0114_reconcile_sequence_ownership_g_1.sql

- [ ] Hash matches **e6d938d8747ab0882c30b04fac05e0313322fdd4bc9005ebc6692471ef9646a7**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0067_reconcile_sequences_g_1.sql, 0100_reconcile_columns_g_1.sql, 0101_reconcile_columns_g_2.sql, 0102_reconcile_columns_g_3.sql, 0103_reconcile_columns_g_4.sql.
- [ ] Required objects verified: sequences:public.campus_presence.campus_presence_id_seq.; columns:public.campus_presence.id.; sequences:public.employee_nfc_attendance_discrepancies.employee_nfc_attendance_discrepancies_id_seq.; columns:public.employee_nfc_attendance_discrepancies.id.; sequences:public.employee_nfc_card_bindings.employee_nfc_card_bindings_id_seq.; columns:public.employee_nfc_card_bindings.id.; sequences:public.employee_nfc_card_history.employee_nfc_card_history_id_seq.; columns:public.employee_nfc_card_history.id.; sequences:public.employee_nfc_discrepancy_actions.employee_nfc_discrepancy_actions_id_seq.; columns:public.employee_nfc_discrepancy_actions.id.; sequences:public.maintenance_request_status_history.maintenance_request_status_history_id_seq.; columns:public.maintenance_request_status_history.id.; sequences:public.operational_task_status_history.operational_task_status_history_id_seq.; columns:public.operational_task_status_history.id.; sequences:public.platform_devices.platform_devices_id_seq.; columns:public.platform_devices.id.; sequences:public.school_asset_history.school_asset_history_id_seq.; columns:public.school_asset_history.id.; sequences:public.school_authorized_pickup_persons.school_authorized_pickup_persons_id_seq.; columns:public.school_authorized_pickup_persons.id.; sequences:public.school_operation_categories.school_operation_categories_id_seq.; columns:public.school_operation_categories.id.; sequences:public.school_pickup_requests.school_pickup_requests_id_seq.; columns:public.school_pickup_requests.id.; sequences:public.school_security_incident_attachments.school_security_incident_attachments_id_seq.; columns:public.school_security_incident_attachments.id.; sequences:public.school_security_incidents.school_security_incidents_id_seq.; columns:public.school_security_incidents.id.; sequences:public.school_security_operation_history.school_security_operation_history_id_seq.; columns:public.school_security_operation_history.id.; sequences:public.school_security_visitors.school_security_visitors_id_seq.; columns:public.school_security_visitors.id.; sequences:public.security_events.security_events_id_seq.; columns:public.security_events.id.; sequences:public.security_locations.security_locations_id_seq.; columns:public.security_locations.id.; sequences:public.security_readers.security_readers_id_seq.; columns:public.security_readers.id.; sequences:public.security_staff_grants.security_staff_grants_id_seq.; columns:public.security_staff_grants.id.; sequences:public.transport_buses.transport_buses_id_seq.; columns:public.transport_buses.id.; sequences:public.transport_fee_invoices.transport_fee_invoices_id_seq.; columns:public.transport_fee_invoices.id.; sequences:public.transport_history.transport_history_id_seq.; columns:public.transport_history.id.; sequences:public.transport_parent_requests.transport_parent_requests_id_seq.; columns:public.transport_parent_requests.id.; sequences:public.transport_route_staff.transport_route_staff_id_seq.; columns:public.transport_route_staff.id.; sequences:public.transport_route_stops.transport_route_stops_id_seq.; columns:public.transport_route_stops.id.; sequences:public.transport_routes.transport_routes_id_seq.; columns:public.transport_routes.id.; sequences:public.transport_student_assignments.transport_student_assignments_id_seq.; columns:public.transport_student_assignments.id..
- [ ] Expected schema: Attach missing sequence OWNED BY only to exact listed existing typed owner column after prerequisites. Matching ownership is unchanged; conflicting ownership fails. No reassignment/reset/reseed.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Ownership metadata only where missing and correct; no value advancement/reset or type/position changes.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| ownership | ownership:public.campus_presence.campus_presence_id_seq. | ALTER SEQUENCE public."campus_presence_id_seq" OWNED BY public."campus_presence"."id" |
| ownership | ownership:public.employee_nfc_attendance_discrepancies.employee_nfc_attendance_discrepancies_id_seq. | ALTER SEQUENCE public."employee_nfc_attendance_discrepancies_id_seq" OWNED BY public."employee_nfc_attendance_discrepancies"."id" |
| ownership | ownership:public.employee_nfc_card_bindings.employee_nfc_card_bindings_id_seq. | ALTER SEQUENCE public."employee_nfc_card_bindings_id_seq" OWNED BY public."employee_nfc_card_bindings"."id" |
| ownership | ownership:public.employee_nfc_card_history.employee_nfc_card_history_id_seq. | ALTER SEQUENCE public."employee_nfc_card_history_id_seq" OWNED BY public."employee_nfc_card_history"."id" |
| ownership | ownership:public.employee_nfc_discrepancy_actions.employee_nfc_discrepancy_actions_id_seq. | ALTER SEQUENCE public."employee_nfc_discrepancy_actions_id_seq" OWNED BY public."employee_nfc_discrepancy_actions"."id" |
| ownership | ownership:public.maintenance_request_status_history.maintenance_request_status_history_id_seq. | ALTER SEQUENCE public."maintenance_request_status_history_id_seq" OWNED BY public."maintenance_request_status_history"."id" |
| ownership | ownership:public.operational_task_status_history.operational_task_status_history_id_seq. | ALTER SEQUENCE public."operational_task_status_history_id_seq" OWNED BY public."operational_task_status_history"."id" |
| ownership | ownership:public.platform_devices.platform_devices_id_seq. | ALTER SEQUENCE public."platform_devices_id_seq" OWNED BY public."platform_devices"."id" |
| ownership | ownership:public.school_asset_history.school_asset_history_id_seq. | ALTER SEQUENCE public."school_asset_history_id_seq" OWNED BY public."school_asset_history"."id" |
| ownership | ownership:public.school_authorized_pickup_persons.school_authorized_pickup_persons_id_seq. | ALTER SEQUENCE public."school_authorized_pickup_persons_id_seq" OWNED BY public."school_authorized_pickup_persons"."id" |
| ownership | ownership:public.school_operation_categories.school_operation_categories_id_seq. | ALTER SEQUENCE public."school_operation_categories_id_seq" OWNED BY public."school_operation_categories"."id" |
| ownership | ownership:public.school_pickup_requests.school_pickup_requests_id_seq. | ALTER SEQUENCE public."school_pickup_requests_id_seq" OWNED BY public."school_pickup_requests"."id" |
| ownership | ownership:public.school_security_incident_attachments.school_security_incident_attachments_id_seq. | ALTER SEQUENCE public."school_security_incident_attachments_id_seq" OWNED BY public."school_security_incident_attachments"."id" |
| ownership | ownership:public.school_security_incidents.school_security_incidents_id_seq. | ALTER SEQUENCE public."school_security_incidents_id_seq" OWNED BY public."school_security_incidents"."id" |
| ownership | ownership:public.school_security_operation_history.school_security_operation_history_id_seq. | ALTER SEQUENCE public."school_security_operation_history_id_seq" OWNED BY public."school_security_operation_history"."id" |
| ownership | ownership:public.school_security_visitors.school_security_visitors_id_seq. | ALTER SEQUENCE public."school_security_visitors_id_seq" OWNED BY public."school_security_visitors"."id" |
| ownership | ownership:public.security_events.security_events_id_seq. | ALTER SEQUENCE public."security_events_id_seq" OWNED BY public."security_events"."id" |
| ownership | ownership:public.security_locations.security_locations_id_seq. | ALTER SEQUENCE public."security_locations_id_seq" OWNED BY public."security_locations"."id" |
| ownership | ownership:public.security_readers.security_readers_id_seq. | ALTER SEQUENCE public."security_readers_id_seq" OWNED BY public."security_readers"."id" |
| ownership | ownership:public.security_staff_grants.security_staff_grants_id_seq. | ALTER SEQUENCE public."security_staff_grants_id_seq" OWNED BY public."security_staff_grants"."id" |
| ownership | ownership:public.transport_buses.transport_buses_id_seq. | ALTER SEQUENCE public."transport_buses_id_seq" OWNED BY public."transport_buses"."id" |
| ownership | ownership:public.transport_fee_invoices.transport_fee_invoices_id_seq. | ALTER SEQUENCE public."transport_fee_invoices_id_seq" OWNED BY public."transport_fee_invoices"."id" |
| ownership | ownership:public.transport_history.transport_history_id_seq. | ALTER SEQUENCE public."transport_history_id_seq" OWNED BY public."transport_history"."id" |
| ownership | ownership:public.transport_parent_requests.transport_parent_requests_id_seq. | ALTER SEQUENCE public."transport_parent_requests_id_seq" OWNED BY public."transport_parent_requests"."id" |
| ownership | ownership:public.transport_route_staff.transport_route_staff_id_seq. | ALTER SEQUENCE public."transport_route_staff_id_seq" OWNED BY public."transport_route_staff"."id" |
| ownership | ownership:public.transport_route_stops.transport_route_stops_id_seq. | ALTER SEQUENCE public."transport_route_stops_id_seq" OWNED BY public."transport_route_stops"."id" |
| ownership | ownership:public.transport_routes.transport_routes_id_seq. | ALTER SEQUENCE public."transport_routes_id_seq" OWNED BY public."transport_routes"."id" |
| ownership | ownership:public.transport_student_assignments.transport_student_assignments_id_seq. | ALTER SEQUENCE public."transport_student_assignments_id_seq" OWNED BY public."transport_student_assignments"."id" |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.campus_presence; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_attendance_discrepancies; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_card_bindings; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_card_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.employee_nfc_discrepancy_actions; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.maintenance_request_status_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.operational_task_status_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.platform_devices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_asset_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_authorized_pickup_persons; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_operation_categories; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_pickup_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_incident_attachments; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_incidents; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_operation_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.school_security_visitors; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_events; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_locations; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_readers; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.security_staff_grants; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_buses; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_fee_invoices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_history; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_parent_requests; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_route_staff; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_route_stops; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_routes; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.transport_student_assignments; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.campus_presence_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.employee_nfc_attendance_discrepancies_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.employee_nfc_card_bindings_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.employee_nfc_card_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.employee_nfc_discrepancy_actions_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.maintenance_request_status_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.operational_task_status_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.platform_devices_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_asset_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_authorized_pickup_persons_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_operation_categories_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_pickup_requests_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_security_incident_attachments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_security_incidents_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_security_operation_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.school_security_visitors_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.security_events_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.security_locations_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.security_readers_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.security_staff_grants_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_buses_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_fee_invoices_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_history_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_parent_requests_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_route_staff_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_route_stops_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_routes_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.transport_student_assignments_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## 0115_reconcile_sequence_ownership_h_1.sql

- [ ] Hash matches **fa4a5bcb52518db385fe9580f55109a5749b0f8eb4b543bba449d7b6d242d3c7**.
- [ ] Initial authoritative-target/recovery/mechanism/history gates passed; writers quiesced only under separate authorization.
- [ ] Prerequisite migrations: 0068_reconcile_sequences_h_1.sql, 0105_reconcile_columns_h_1.sql, 0106_reconcile_columns_h_2.sql.
- [ ] Required objects verified: sequences:public.communication_campaigns.communication_campaigns_id_seq.; columns:public.communication_campaigns.id.; sequences:public.communication_deliveries.communication_deliveries_id_seq.; columns:public.communication_deliveries.id.; sequences:public.communication_message_threads.communication_message_threads_id_seq.; columns:public.communication_message_threads.id.; sequences:public.communication_messages.communication_messages_id_seq.; columns:public.communication_messages.id.; sequences:public.communication_notifications.communication_notifications_id_seq.; columns:public.communication_notifications.id.; sequences:public.communication_push_devices.communication_push_devices_id_seq.; columns:public.communication_push_devices.id.; sequences:public.communication_templates.communication_templates_id_seq.; columns:public.communication_templates.id..
- [ ] Expected schema: Attach missing sequence OWNED BY only to exact listed existing typed owner column after prerequisites. Matching ownership is unchanged; conflicting ownership fails. No reassignment/reset/reseed.
- [ ] Expected data: No intended existing-row value or count changes. New typed tables remain empty while writers are quiesced; new nullable fields may be NULL. Required fields on previously empty tables remain gated on current emptiness. Any unexpected initialization/change is a STOP.
- [ ] Expected sequences: Ownership metadata only where missing and correct; no value advancement/reset or type/position changes.
- [ ] Newly executable original checks: **0**; IDs none. These are availability predictions, NOT passes.

### Exact directly reconciled objects
| Category | Qualified object | Reviewed creation/add/ownership DDL (guarded) |
|---|---|---|
| ownership | ownership:public.communication_campaigns.communication_campaigns_id_seq. | ALTER SEQUENCE public."communication_campaigns_id_seq" OWNED BY public."communication_campaigns"."id" |
| ownership | ownership:public.communication_deliveries.communication_deliveries_id_seq. | ALTER SEQUENCE public."communication_deliveries_id_seq" OWNED BY public."communication_deliveries"."id" |
| ownership | ownership:public.communication_message_threads.communication_message_threads_id_seq. | ALTER SEQUENCE public."communication_message_threads_id_seq" OWNED BY public."communication_message_threads"."id" |
| ownership | ownership:public.communication_messages.communication_messages_id_seq. | ALTER SEQUENCE public."communication_messages_id_seq" OWNED BY public."communication_messages"."id" |
| ownership | ownership:public.communication_notifications.communication_notifications_id_seq. | ALTER SEQUENCE public."communication_notifications_id_seq" OWNED BY public."communication_notifications"."id" |
| ownership | ownership:public.communication_push_devices.communication_push_devices_id_seq. | ALTER SEQUENCE public."communication_push_devices_id_seq" OWNED BY public."communication_push_devices"."id" |
| ownership | ownership:public.communication_templates.communication_templates_id_seq. | ALTER SEQUENCE public."communication_templates_id_seq" OWNED BY public."communication_templates"."id" |

Every object's complete expected semantic signature and typed column metadata are in the JSON under this filename. Guarded source may reuse equivalent objects or apply separately listed permitted default/nullability reconciliation; DDL here is not an execution command.

### Read-only post-file/post-B1 validation
- [ ] Verify every listed object/column/type/default/nullability and allowed existing identity/ordinal semantics; no unreviewed extras
- [ ] Compare existing rows/count/stable-value preservation for public.communication_campaigns; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_deliveries; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_message_threads; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_messages; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_notifications; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_push_devices; account only explicitly approved new fields/empty new table
- [ ] Compare existing rows/count/stable-value preservation for public.communication_templates; account only explicitly approved new fields/empty new table
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_campaigns_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_deliveries_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_message_threads_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_messages_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_notifications_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_push_devices_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Verify exact sequence metadata and appropriate stage ownership for public.communication_templates_id_seq and authoritative last_value/is_called/cache versus owner key maxima; no test advancement
- [ ] Run original newly executable check IDs (none assigned at this file)
- [ ] All 965 Batch 1-unlocked checks must pass by B1 checkpoint; the 41 F0060-dependent checks remain explicitly unassessed
- [ ] Read-only confirm previous 798 PASS checks do not regress on authoritative target at execution checkpoint; no rerun was performed now
- [ ] Verify committed history/provenance under separately established executor; absence from source journal is not success evidence

### STOP conditions
- Any initial execution gate remains blocked/unverified
- File hash or dependency differs from validated package
- Expected object/type/default/ownership prerequisite is absent or different
- Any unreviewed unexpected schema object/constraint/index appears
- Any unexpected row count or stable existing value/history change
- Sequence metadata/ownership/authoritative position/cache anomaly; any attempted reset or advancement
- Any error, guard failure or lock timeout; do not continue to the next file
- Any newly executable preflight failure or previously passing-check regression
- Unique/CHECK/FK/NOT NULL data gate fails; no repair/deduplication/backfill
- Any destructive operation or unapproved data transformation
- Execution ledger/journal differs unexpectedly or provenance is ambiguous

**Safety/recovery:** No reviewed inverse migration exists. Single source DO is atomic, but intended executor transaction/commit behavior remains unverified; a failed file does not undo earlier committed files. No DROP/DELETE/reset compensation.

## Batch 1 success criteria — ALL required before Batch 2

- [ ] Every one of 0061–0115 completed successfully with matching validated hash and reliable committed result
- [ ] No unexpected schema objects or semantic differences beyond reviewed allowed equivalences
- [ ] No unexpected existing-row/count/value/history changes; only five approved new-field initializations where applicable
- [ ] No sequence metadata/ownership/position/cache anomalies or consumption/reset
- [ ] No constraint/guard failures
- [ ] All 965 newly executable Batch 1 data checks pass; all 41 F0060-dependent checks remain explicitly deferred
- [ ] No previously passing check regresses
- [ ] Migration history/provenance consistent and authoritative; no bulk-stamp or assumed execution
- [ ] Production structurally consistent with validated staged plan; no claim that later constraints/functions/triggers are already installed
- [ ] Read-only B1 checkpoint complete and separate Batch 2 approval path satisfied

Production writes performed by this gate: **0**. No preflight suite/Finance/default tests replayed.
