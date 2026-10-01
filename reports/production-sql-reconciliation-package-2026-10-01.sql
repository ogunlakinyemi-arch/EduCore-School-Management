-- PRODUCTION SQL RECONCILIATION PACKAGE — 2026-10-01
-- MACHINE-READABLE PACKAGE; PREPARATION ONLY. NOTHING HERE HAS BEEN EXECUTED.
-- PACKAGE-MODE: MANUAL_SECTION_SELECTION_ONLY; NEVER RUN THIS FILE AS A WHOLE.
-- OPERATOR-GATE-PROTOCOL: verify the live target out-of-band, obtain approval,
-- then set the matching session GUC app.production_reconciliation_gate in the
-- SAME SQL-runner session before selecting exactly one gated mutation section.
-- GUC values are section-specific below. A gate is an operator confirmation,
-- not proof of database identity or authorization. Do not set it until approved.
-- Every mutation is transactional and has its own explicit COMMIT. Stop on ANY
-- failed preflight, gate, prerequisite, conflict, unexpected count, or postflight.
-- No migration ledger/journal edits, destructive statements, or data-copy logic.

-- ============================================================================
-- SECTION: PREFLIGHT READ ONLY
-- Execute only SELECT statements in this section before any approval.
-- The baseline is a 29-table Production predecessor; absent relations are
-- guarded with to_regclass and dynamic SELECT via query_to_xml. No table/column
-- reference to an optional relation is parsed until its existence is checked.
-- ============================================================================

-- A1. Connection context. This records identity fields; it does NOT establish
-- that the published app uses this same database (see report section B).
SELECT current_database() AS database_name,
       current_schema() AS current_schema,
       current_user AS runner_role,
       version() AS postgres_version,
       current_setting('search_path') AS session_search_path;

-- A2. Current public ordinary-table count and exact expected-name coverage.
WITH expected(table_name) AS (
  VALUES
    ('academic_assessment_types'),
    ('academic_assessments'),
    ('academic_assignments'),
    ('academic_grading_rules'),
    ('academic_report_card_lines'),
    ('academic_report_cards'),
    ('academic_results'),
    ('academic_sessions'),
    ('academic_terms'),
    ('academic_timetable_entries'),
    ('app_users'),
    ('attendance_corrections'),
    ('attendance_discrepancies'),
    ('attendance_events'),
    ('attendance_notification_events'),
    ('attendance_settings'),
    ('audit_logs'),
    ('biometric_enrollments'),
    ('class_subjects'),
    ('commission_ledger'),
    ('commission_rules'),
    ('communication_campaign_recipients'),
    ('communication_campaigns'),
    ('communication_deliveries'),
    ('communication_notifications'),
    ('communication_preferences'),
    ('communication_push_devices'),
    ('communication_templates'),
    ('device_assignment_history'),
    ('device_credentials'),
    ('device_school_bindings'),
    ('employees'),
    ('fee_adjustments'),
    ('fee_categories'),
    ('fee_invoice_lines'),
    ('fee_invoice_notification_outbox'),
    ('fee_invoice_notifications'),
    ('fee_invoices'),
    ('fee_payment_notification_outbox'),
    ('fee_payment_notifications'),
    ('fee_payments'),
    ('fee_provider_checkout_sessions'),
    ('fee_provider_webhook_events'),
    ('fee_receipts'),
    ('fee_refunds'),
    ('fee_school_settings'),
    ('fee_structure_lines'),
    ('fee_structures'),
    ('library_authors'),
    ('library_book_copies'),
    ('library_books'),
    ('library_categories'),
    ('library_copy_status_history'),
    ('library_loans'),
    ('library_publishers'),
    ('library_renewals'),
    ('library_settings'),
    ('library_staff'),
    ('maintenance_request_status_history'),
    ('maintenance_requests'),
    ('nfc_card_history'),
    ('nfc_cards'),
    ('operational_task_status_history'),
    ('operational_tasks'),
    ('parent_student_relationships'),
    ('parents'),
    ('partner_attribution_conflicts'),
    ('partner_invitations'),
    ('partner_payout_information'),
    ('partner_payouts'),
    ('partner_profile_users'),
    ('partner_profiles'),
    ('partner_referral_links'),
    ('platform_company_employees'),
    ('platform_devices'),
    ('platform_notifications'),
    ('school_asset_history'),
    ('school_assets'),
    ('school_classes'),
    ('school_facilities'),
    ('school_memberships'),
    ('school_operation_categories'),
    ('school_operations_settings'),
    ('school_partner_attributions'),
    ('schools'),
    ('student_class_assignments'),
    ('student_identification_policies'),
    ('students'),
    ('subjects'),
    ('subscriptions'),
    ('teacher_class_assignments')
), actual AS (
  SELECT c.relname AS table_name
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
)
SELECT (SELECT count(*) FROM actual) AS current_public_table_count,
       (SELECT count(*) FROM expected) AS expected_post_publish_application_tables,
       (SELECT count(*) FROM expected e JOIN actual a USING (table_name)) AS expected_names_present_now,
       (SELECT array_agg(e.table_name ORDER BY e.table_name)
          FROM expected e LEFT JOIN actual a USING (table_name)
         WHERE a.table_name IS NULL) AS expected_names_missing_now,
       (SELECT array_agg(a.table_name ORDER BY a.table_name)
          FROM actual a LEFT JOIN expected e USING (table_name)
         WHERE e.table_name IS NULL) AS public_tables_not_in_expected_application_set;

-- A3. Exact live row counts for each expected table that currently exists.
-- query_to_xml receives only fixed identifiers from the embedded allowlist.
-- A NULL exact_row_count is not zero: absent source, unavailable count, or
-- malformed XML must be reviewed rather than interpreted as an empty table.
WITH expected(table_name) AS (
  VALUES
    ('academic_assessment_types'),
    ('academic_assessments'),
    ('academic_assignments'),
    ('academic_grading_rules'),
    ('academic_report_card_lines'),
    ('academic_report_cards'),
    ('academic_results'),
    ('academic_sessions'),
    ('academic_terms'),
    ('academic_timetable_entries'),
    ('app_users'),
    ('attendance_corrections'),
    ('attendance_discrepancies'),
    ('attendance_events'),
    ('attendance_notification_events'),
    ('attendance_settings'),
    ('audit_logs'),
    ('biometric_enrollments'),
    ('class_subjects'),
    ('commission_ledger'),
    ('commission_rules'),
    ('communication_campaign_recipients'),
    ('communication_campaigns'),
    ('communication_deliveries'),
    ('communication_notifications'),
    ('communication_preferences'),
    ('communication_push_devices'),
    ('communication_templates'),
    ('device_assignment_history'),
    ('device_credentials'),
    ('device_school_bindings'),
    ('employees'),
    ('fee_adjustments'),
    ('fee_categories'),
    ('fee_invoice_lines'),
    ('fee_invoice_notification_outbox'),
    ('fee_invoice_notifications'),
    ('fee_invoices'),
    ('fee_payment_notification_outbox'),
    ('fee_payment_notifications'),
    ('fee_payments'),
    ('fee_provider_checkout_sessions'),
    ('fee_provider_webhook_events'),
    ('fee_receipts'),
    ('fee_refunds'),
    ('fee_school_settings'),
    ('fee_structure_lines'),
    ('fee_structures'),
    ('library_authors'),
    ('library_book_copies'),
    ('library_books'),
    ('library_categories'),
    ('library_copy_status_history'),
    ('library_loans'),
    ('library_publishers'),
    ('library_renewals'),
    ('library_settings'),
    ('library_staff'),
    ('maintenance_request_status_history'),
    ('maintenance_requests'),
    ('nfc_card_history'),
    ('nfc_cards'),
    ('operational_task_status_history'),
    ('operational_tasks'),
    ('parent_student_relationships'),
    ('parents'),
    ('partner_attribution_conflicts'),
    ('partner_invitations'),
    ('partner_payout_information'),
    ('partner_payouts'),
    ('partner_profile_users'),
    ('partner_profiles'),
    ('partner_referral_links'),
    ('platform_company_employees'),
    ('platform_devices'),
    ('platform_notifications'),
    ('school_asset_history'),
    ('school_assets'),
    ('school_classes'),
    ('school_facilities'),
    ('school_memberships'),
    ('school_operation_categories'),
    ('school_operations_settings'),
    ('school_partner_attributions'),
    ('schools'),
    ('student_class_assignments'),
    ('student_identification_policies'),
    ('students'),
    ('subjects'),
    ('subscriptions'),
    ('teacher_class_assignments')
)
SELECT e.table_name,
       CASE WHEN pg_catalog.to_regclass(format('%I.%I','public',e.table_name)) IS NULL
            THEN NULL
            ELSE ((pg_catalog.xpath('/table/row/n/text()',
                   pg_catalog.query_to_xml(format('SELECT count(*) AS n FROM %I.%I','public',e.table_name),false,false,'')))[1]::text)::bigint
       END AS exact_row_count
FROM expected e
ORDER BY e.table_name;

-- A4. Required pre-existing parent keys. A valid exact unique index/constraint
-- must have precisely the named ordered columns, no predicate, and no INCLUDE.
WITH wanted(table_name, key_columns) AS (
  VALUES ('nfc_cards',ARRAY['id','school_id']::text[]),
         ('academic_sessions',ARRAY['id','school_id']::text[]),
         ('academic_terms',ARRAY['id','school_id']::text[]),
         ('employees',ARRAY['id','school_id']::text[]),
         ('school_classes',ARRAY['id','school_id']::text[]),
         ('students',ARRAY['id','school_id']::text[]),
         ('subjects',ARRAY['id','school_id']::text[])
)
SELECT w.table_name, w.key_columns,
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_index i
         JOIN pg_catalog.pg_class t ON t.oid=i.indrelid
         JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
         WHERE n.nspname='public' AND t.relname=w.table_name
           AND i.indisunique AND i.indisvalid AND i.indimmediate
           AND i.indpred IS NULL AND i.indexprs IS NULL
           AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
                  FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,ord)
                  JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
                 WHERE k.ord <= i.indnkeyatts) = w.key_columns
       ) AS exact_valid_unique_parent_key_exists
FROM wanted w ORDER BY w.table_name;

-- A5. Device status constraint/value check, safe if platform_devices is absent.
SELECT CASE WHEN pg_catalog.to_regclass('public.platform_devices') IS NULL
            THEN 'TABLE_ABSENT_BEFORE_STRUCTURAL_PUBLISH'
            WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                             WHERE table_schema='public' AND table_name='platform_devices' AND column_name='status')
            THEN 'STATUS_COLUMN_ABSENT'
            ELSE 'STATUS_COLUMN_PRESENT'
       END AS device_status_schema_state,
       CASE WHEN pg_catalog.to_regclass('public.platform_devices') IS NULL
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                             WHERE table_schema='public' AND table_name='platform_devices' AND column_name='status')
            THEN NULL
            ELSE ((pg_catalog.xpath('/table/row/n/text()',
                   pg_catalog.query_to_xml($q$SELECT count(*) AS n FROM public.platform_devices WHERE status NOT IN ('ACTIVE','INACTIVE','MAINTENANCE','SUSPENDED','UNASSIGNED')$q$,false,false,'')))[1]::text)::bigint
       END AS unsupported_device_status_count;

SELECT CASE WHEN pg_catalog.to_regclass('public.platform_devices') IS NULL THEN NULL
            ELSE pg_catalog.query_to_xml(
              'SELECT conname,pg_get_constraintdef(oid) AS definition,convalidated
                 FROM pg_catalog.pg_constraint
                WHERE conrelid=to_regclass(''public.platform_devices'')
                  AND contype=''c'' AND (conname=''platform_devices_status_supported_check'' OR pg_get_constraintdef(oid) ILIKE ''%status%'')',
              false,false,'')
       END AS device_status_check_constraints;

-- A6. Orphan counts for constraints that already exist in this predecessor.
-- This is catalog-driven, SELECT-only, and dynamically counts only existing FK
-- relations; new FK data validation remains a required structural gate. A NULL
-- orphan count is unavailable, not zero, and is a stop-and-review signal.
WITH fk_parts AS (
  SELECT c.oid, c.conname,
         cn.nspname AS child_schema, ct.relname AS child_table,
         pn.nspname AS parent_schema, pt.relname AS parent_table,
         string_agg(format('c.%I = p.%I',ca.attname,pa.attname),' AND ' ORDER BY k.i) AS match_sql,
         string_agg(format('c.%I IS NOT NULL',ca.attname),' AND ' ORDER BY k.i) AS not_null_sql
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class ct ON ct.oid=c.conrelid
  JOIN pg_catalog.pg_namespace cn ON cn.oid=ct.relnamespace
  JOIN pg_catalog.pg_class pt ON pt.oid=c.confrelid
  JOIN pg_catalog.pg_namespace pn ON pn.oid=pt.relnamespace
  CROSS JOIN LATERAL generate_subscripts(c.conkey,1) AS k(i)
  JOIN pg_catalog.pg_attribute ca ON ca.attrelid=ct.oid AND ca.attnum=c.conkey[k.i]
  JOIN pg_catalog.pg_attribute pa ON pa.attrelid=pt.oid AND pa.attnum=c.confkey[k.i]
  WHERE c.contype='f' AND cn.nspname='public' AND pn.nspname='public'
    AND ct.relkind IN ('r','p') AND pt.relkind IN ('r','p')
  GROUP BY c.oid,c.conname,cn.nspname,ct.relname,pn.nspname,pt.relname
)
SELECT conname, child_table, parent_table,
       ((pg_catalog.xpath('/table/row/n/text()',
          pg_catalog.query_to_xml(format(
            'SELECT count(*) AS n FROM %I.%I AS c WHERE %s AND NOT EXISTS (SELECT 1 FROM %I.%I AS p WHERE %s)',
             child_schema,child_table,not_null_sql,parent_schema,parent_table,match_sql),false,false,'')))[1]::text)::bigint AS orphan_count
FROM fk_parts ORDER BY child_table,conname;

-- A7. Existing duplicate counts relevant to backfills/protected writes.
-- These are aggregates only; no saved Production names, phones, or row samples.
-- A NULL duplicate count means the source relation/count is unavailable, not zero.
SELECT
  CASE WHEN pg_catalog.to_regclass('public.parent_student_relationships') IS NULL THEN NULL
       ELSE ((pg_catalog.xpath('/table/row/n/text()',pg_catalog.query_to_xml(
         'SELECT count(*) AS n FROM (SELECT parent_id,student_id FROM public.parent_student_relationships GROUP BY parent_id,student_id HAVING count(*)>1) d',false,false,'')))[1]::text)::bigint END AS duplicate_guardian_pairs,
  CASE WHEN pg_catalog.to_regclass('public.academic_sessions') IS NULL THEN NULL
       ELSE ((pg_catalog.xpath('/table/row/n/text()',pg_catalog.query_to_xml(
         'SELECT count(*) AS n FROM (SELECT school_id,name FROM public.academic_sessions GROUP BY school_id,name HAVING count(*)>1) d',false,false,'')))[1]::text)::bigint END AS duplicate_school_session_names,
  CASE WHEN pg_catalog.to_regclass('public.school_classes') IS NULL THEN NULL
       ELSE ((pg_catalog.xpath('/table/row/n/text()',pg_catalog.query_to_xml(
         'SELECT count(*) AS n FROM (SELECT school_id,name,section FROM public.school_classes GROUP BY school_id,name,section HAVING count(*)>1) d',false,false,'')))[1]::text)::bigint END AS duplicate_school_class_keys;

-- A8. Guardian-link candidates. Exact same-school normalized meaningful name
-- and phone, exactly one parent candidate per student, and no existing target
-- pair. Returned identifiers only; do not export PII.
SELECT CASE WHEN pg_catalog.to_regclass('public.students') IS NULL
              OR pg_catalog.to_regclass('public.parents') IS NULL
              OR pg_catalog.to_regclass('public.parent_student_relationships') IS NULL
            THEN NULL
            ELSE pg_catalog.query_to_xml($q$
WITH candidates AS (
 SELECT st.id AS student_id, st.school_id, p.id AS parent_id,
        count(*) OVER (PARTITION BY st.id) AS candidate_count
 FROM public.students st
 JOIN public.parents p ON p.school_id=st.school_id
   AND lower(btrim(p.name))=lower(btrim(st.parent_name))
   AND regexp_replace(p.phone,'\D','','g')=regexp_replace(st.parent_phone,'\D','','g')
 WHERE nullif(btrim(st.parent_name),'') IS NOT NULL
   AND nullif(btrim(p.name),'') IS NOT NULL
    AND nullif(regexp_replace(st.parent_phone,'\D','','g'),'') IS NOT NULL
    AND nullif(regexp_replace(p.phone,'\D','','g'),'') IS NOT NULL
)
SELECT student_id,school_id,parent_id,candidate_count
FROM candidates c
WHERE candidate_count=1
  AND NOT EXISTS (SELECT 1 FROM public.parent_student_relationships r
                  WHERE r.parent_id=c.parent_id AND r.student_id=c.student_id)
ORDER BY school_id,student_id
$q$,false,false,'')
       END AS uniquely_matched_missing_guardian_link_ids;

-- Aggregate guardian match quality, including ambiguous and unmatched counts.
SELECT CASE WHEN pg_catalog.to_regclass('public.students') IS NULL OR pg_catalog.to_regclass('public.parents') IS NULL THEN NULL
            ELSE pg_catalog.query_to_xml($q$
WITH counts AS (
 SELECT st.id, count(p.id) AS candidate_count
 FROM public.students st
 LEFT JOIN public.parents p ON p.school_id=st.school_id
   AND lower(btrim(p.name))=lower(btrim(st.parent_name))
   AND regexp_replace(p.phone,'\D','','g')=regexp_replace(st.parent_phone,'\D','','g')
   AND nullif(btrim(p.name),'') IS NOT NULL
    AND nullif(regexp_replace(p.phone,'\D','','g'),'') IS NOT NULL
 WHERE nullif(btrim(st.parent_name),'') IS NOT NULL
    AND nullif(regexp_replace(st.parent_phone,'\D','','g'),'') IS NOT NULL
 GROUP BY st.id
)
SELECT count(*) FILTER (WHERE candidate_count=1) AS exactly_one_candidate_students,
       count(*) FILTER (WHERE candidate_count>1) AS ambiguous_students,
       count(*) FILTER (WHERE candidate_count=0) AS unmatched_students
FROM counts
$q$,false,false,'') END AS guardian_candidate_aggregate;

-- A9. LEGACY-session candidates. Source migration 0001 uses CURRENT_DATE for
-- BOTH start_date and end_date at execution time (not historical dates).
SELECT CASE WHEN pg_catalog.to_regclass('public.schools') IS NULL OR pg_catalog.to_regclass('public.academic_sessions') IS NULL THEN NULL
            ELSE pg_catalog.query_to_xml($q$
SELECT sc.id AS school_id, 'LEGACY'::text AS proposed_name,
       CURRENT_DATE AS proposed_start_date, CURRENT_DATE AS proposed_end_date,
       'COMPLETED'::text AS proposed_status, false AS proposed_is_current
FROM public.schools sc
WHERE NOT EXISTS (SELECT 1 FROM public.academic_sessions a WHERE a.school_id=sc.id AND a.name='LEGACY')
ORDER BY sc.id
$q$,false,false,'') END AS missing_legacy_session_proposals;

-- A10. Exact same-school class-source matches missing LEGACY class history.
SELECT CASE WHEN pg_catalog.to_regclass('public.students') IS NULL
              OR pg_catalog.to_regclass('public.school_classes') IS NULL
              OR pg_catalog.to_regclass('public.academic_sessions') IS NULL
              OR pg_catalog.to_regclass('public.student_class_assignments') IS NULL
            THEN NULL
            ELSE pg_catalog.query_to_xml($q$
WITH class_matches AS (
 SELECT st.id AS student_id,st.school_id,st.joined_at::date AS source_start_date,
        upper(st.status) AS source_status,sc.id AS school_class_id,
        s.id AS academic_session_id,
        count(*) OVER (PARTITION BY st.id) AS class_candidate_count
 FROM public.students st
 JOIN public.school_classes sc ON sc.school_id=st.school_id
   AND sc.name=st.class_name AND sc.section=st.section
 JOIN public.academic_sessions s ON s.school_id=st.school_id AND s.name='LEGACY'
)
SELECT student_id,school_id,academic_session_id,school_class_id,source_start_date,source_status
FROM class_matches cm
WHERE class_candidate_count=1
  AND NOT EXISTS (SELECT 1 FROM public.student_class_assignments a
                  WHERE a.student_id=cm.student_id AND a.academic_session_id=cm.academic_session_id)
ORDER BY school_id,student_id
$q$,false,false,'') END AS exact_class_assignment_proposals;

-- A11. Commission-rule candidate (global by authoritative source; no school_id
-- is part of commission_rules). Does not expose or modify payout/ledger rows.
SELECT CASE WHEN pg_catalog.to_regclass('public.commission_rules') IS NULL THEN NULL
            ELSE pg_catalog.query_to_xml($q$
SELECT count(*) AS active_null_term_rules,
       count(*) FILTER (WHERE name='Default partner referral' AND currency='NGN'
         AND calculation_basis='PER_ELIGIBLE_STUDENT_PER_TERM'
         AND partner_rate=100 AND allocation_total=5000 AND partner_amount=100
         AND school_amount=2000 AND edupulse_amount=2900) AS exact_seed_rules
FROM public.commission_rules WHERE status='ACTIVE' AND term IS NULL
$q$,false,false,'') END AS commission_rule_preflight;

SELECT CASE WHEN pg_catalog.to_regclass('public.commission_rules') IS NULL THEN NULL
            ELSE pg_catalog.query_to_xml($q$
SELECT 'Default partner referral'::text AS name,'ACTIVE'::text AS status,
       NULL::text AS term,'NGN'::text AS currency,
       'PER_ELIGIBLE_STUDENT_PER_TERM'::text AS calculation_basis,
       100::numeric AS partner_rate,5000::numeric AS allocation_total,
       100::numeric AS partner_amount,2000::numeric AS school_amount,
       2900::numeric AS edupulse_amount
WHERE NOT EXISTS (SELECT 1 FROM public.commission_rules WHERE status='ACTIVE' AND term IS NULL)
$q$,false,false,'')
       END AS proposed_commission_seed;

-- A12. Device/history and finance applicability. Safe catalog/column checks;
-- missing relations are never referenced in a static SQL statement.
SELECT table_name,
       (pg_catalog.to_regclass(format('%I.%I','public',table_name)) IS NOT NULL) AS table_exists,
       (SELECT count(*) FROM information_schema.columns c
         WHERE c.table_schema='public' AND c.table_name=t.table_name) AS visible_column_count
FROM (VALUES ('platform_devices'),('device_school_bindings'),('attendance_events'),
             ('device_credentials'),('device_assignment_history'),('biometric_enrollments'),
             ('nfc_cards'),('fee_payments'),('fee_receipts')) AS t(table_name)
ORDER BY table_name;

SELECT CASE WHEN pg_catalog.to_regclass('public.platform_devices') IS NULL THEN NULL
            ELSE pg_catalog.query_to_xml('SELECT count(*) AS device_count, count(*) FILTER (WHERE school_id IS NOT NULL) AS current_device_school_pairs FROM public.platform_devices',false,false,'')
       END AS device_history_applicability,
       CASE WHEN pg_catalog.to_regclass('public.fee_payments') IS NULL OR pg_catalog.to_regclass('public.fee_receipts') IS NULL THEN NULL
            ELSE pg_catalog.query_to_xml('SELECT (SELECT count(*) FROM public.fee_payments) AS payment_rows,(SELECT count(*) FROM public.fee_receipts) AS receipt_rows',false,false,'')
       END AS finance_metadata_applicability;

-- A13. Source function/trigger catalog state before installation (definitions
-- are installed only after structural publish and explicit approval).
SELECT p.proname, n.nspname AS function_schema, p.prosrc,
       p.proconfig
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('prevent_device_school_binding_mutation','protect_fee_payment_verification_metadata','prevent_operations_history_mutation')
ORDER BY p.proname;

SELECT t.tgname, n.nspname AS table_schema, c.relname AS table_name,
       t.tgtype, t.tgattr::text AS update_columns, t.tgqual,
       t.tgenabled, p.proname AS function_name, pn.nspname AS function_schema
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
WHERE n.nspname='public' AND t.tgname IN
 ('device_school_bindings_append_only','device_school_bindings_no_truncate',
  'fee_payments_verification_metadata_immutable','school_asset_history_append_only',
  'maintenance_request_status_history_append_only','operational_task_status_history_append_only')
ORDER BY t.tgname;

-- A14. Structural-release stop condition (read-only result): populated sources
-- that may need repair BEFORE Publish constraints must be separately reviewed.
-- Current cached evidence: zero platform devices; finance and biometric/history
-- sources absent. Re-run this query against live state; any unexpected presence
-- or rows means STOP, not a silently queued post-Publish repair.
SELECT CASE
  WHEN pg_catalog.to_regclass('public.platform_devices') IS NULL THEN 'REVIEW_SOURCE_STATE'
  WHEN ((pg_catalog.xpath('/table/row/n/text()',pg_catalog.query_to_xml('SELECT count(*) AS n FROM public.platform_devices',false,false,'')))[1]::text)::bigint IS NULL
       THEN 'STOP_AND_REVIEW_DEVICE_COUNT_UNAVAILABLE'
  WHEN ((pg_catalog.xpath('/table/row/n/text()',pg_catalog.query_to_xml('SELECT count(*) AS n FROM public.platform_devices',false,false,'')))[1]::text)::bigint > 0
       THEN 'STOP_AND_REVIEW_DEVICE_BINDINGS_BEFORE_STRUCTURAL_PUBLISH'
  ELSE 'NO_CURRENT_DEVICE_ROWS_REPORTED; RECHECK_ALL_HISTORICAL_SOURCES'
END AS device_publish_gate,
CASE WHEN pg_catalog.to_regclass('public.fee_payments') IS NOT NULL OR pg_catalog.to_regclass('public.fee_receipts') IS NOT NULL
     THEN 'STOP_AND_REVIEW_FINANCE_ROWS_BEFORE_STRUCTURAL_PUBLISH'
     ELSE 'FINANCE_TABLES_ABSENT_IN_CACHED_PREDECESSOR; RECHECK'
END AS finance_publish_gate;

-- A14b. Candidate-pair counts for all device/history sources that can require
-- bindings before dependent Publish constraints. ABSENT/NULL means no source
-- query was parsed because its relation or required column is absent. Any
-- positive count is a STOP and must be separately reviewed before Publish.
SELECT 'platform_devices current school pairs' AS source,
       CASE WHEN pg_catalog.to_regclass('public.platform_devices') IS NULL
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_devices' AND column_name='school_id')
            THEN NULL ELSE pg_catalog.query_to_xml('SELECT count(*) AS n FROM public.platform_devices WHERE school_id IS NOT NULL',false,false,'') END AS candidate_pair_count
UNION ALL
SELECT 'attendance_events device-school pairs',
       CASE WHEN pg_catalog.to_regclass('public.attendance_events') IS NULL
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='attendance_events' AND column_name='device_id')
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='attendance_events' AND column_name='school_id')
            THEN NULL ELSE pg_catalog.query_to_xml('SELECT count(*) AS n FROM public.attendance_events WHERE device_id IS NOT NULL AND school_id IS NOT NULL',false,false,'') END
UNION ALL
SELECT 'device_credentials device-school pairs',
       CASE WHEN pg_catalog.to_regclass('public.device_credentials') IS NULL
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_credentials' AND column_name='device_id')
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_credentials' AND column_name='school_id')
            THEN NULL ELSE pg_catalog.query_to_xml('SELECT count(*) AS n FROM public.device_credentials WHERE device_id IS NOT NULL AND school_id IS NOT NULL',false,false,'') END
UNION ALL
SELECT 'device_assignment_history current pairs',
       CASE WHEN pg_catalog.to_regclass('public.device_assignment_history') IS NULL
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_assignment_history' AND column_name='device_id')
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_assignment_history' AND column_name='school_id')
            THEN NULL ELSE pg_catalog.query_to_xml('SELECT count(*) AS n FROM public.device_assignment_history WHERE school_id IS NOT NULL',false,false,'') END
UNION ALL
SELECT 'device_assignment_history previous-school pairs',
       CASE WHEN pg_catalog.to_regclass('public.device_assignment_history') IS NULL
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_assignment_history' AND column_name='device_id')
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_assignment_history' AND column_name='previous_school_id')
            THEN NULL ELSE pg_catalog.query_to_xml('SELECT count(*) AS n FROM public.device_assignment_history WHERE previous_school_id IS NOT NULL',false,false,'') END
UNION ALL
SELECT 'device_assignment_history new-school pairs',
       CASE WHEN pg_catalog.to_regclass('public.device_assignment_history') IS NULL
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_assignment_history' AND column_name='device_id')
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_assignment_history' AND column_name='new_school_id')
            THEN NULL ELSE pg_catalog.query_to_xml('SELECT count(*) AS n FROM public.device_assignment_history WHERE new_school_id IS NOT NULL',false,false,'') END
UNION ALL
SELECT 'biometric_enrollments device-school pairs',
       CASE WHEN pg_catalog.to_regclass('public.biometric_enrollments') IS NULL
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='biometric_enrollments' AND column_name='device_id')
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='biometric_enrollments' AND column_name='school_id')
            THEN NULL ELSE pg_catalog.query_to_xml('SELECT count(*) AS n FROM public.biometric_enrollments WHERE device_id IS NOT NULL AND school_id IS NOT NULL',false,false,'') END
UNION ALL
SELECT 'nfc_cards last-device school pairs',
       CASE WHEN pg_catalog.to_regclass('public.nfc_cards') IS NULL
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='nfc_cards' AND column_name='last_device_id')
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='nfc_cards' AND column_name='school_id')
            THEN NULL ELSE pg_catalog.query_to_xml('SELECT count(*) AS n FROM public.nfc_cards WHERE last_device_id IS NOT NULL',false,false,'') END;

-- A14c. Distinguish truly absent sources from present-but-unexpected shapes.
-- Missing required columns in a present source are a STOP, never a no-op.
SELECT s.table_name,
       pg_catalog.to_regclass(format('%I.%I','public',s.table_name)) IS NOT NULL AS source_table_exists,
       s.required_columns,
       ARRAY(SELECT u.required_column
             FROM unnest(s.required_columns) AS u(required_column)
             WHERE pg_catalog.to_regclass(format('%I.%I','public',s.table_name)) IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                               WHERE c.table_schema='public' AND c.table_name=s.table_name
                                 AND c.column_name=u.required_column)
             ORDER BY u.required_column) AS missing_required_columns
FROM (VALUES
  ('platform_devices',ARRAY['id','school_id']::text[]),
  ('attendance_events',ARRAY['device_id','school_id']::text[]),
  ('device_credentials',ARRAY['device_id','school_id']::text[]),
  ('device_assignment_history',ARRAY['device_id','school_id','previous_school_id']::text[]),
  ('biometric_enrollments',ARRAY['device_id','school_id']::text[]),
  ('nfc_cards',ARRAY['school_id']::text[])
) AS s(table_name,required_columns)
ORDER BY s.table_name;

-- ============================================================================
-- SECTION: STRUCTURAL DO NOT EXECUTE HERE (REFERENCE ONLY)
-- ============================================================================
-- HUMAN ACTION #2 ONLY: Replit Publish, after independent production identity,
-- backup/recovery and preview review. Reference the saved fresh preview:
-- reports/development-production-preview-2026-10-01.json (410 statements).
-- This package intentionally does NOT reproduce those statements. No schema
-- diff/publish operation is invoked by this package. Verify the human Publish
-- result before proceeding. The exact 410-statement rehearsal evidence is in
-- docs/development-production-reconciliation-2026-10-01.md and
-- reports/reconciliation-rehearsal-result-2026-10-01.txt.
-- STOP before Publish if populated source rows require repairs that cannot
-- safely be done after new constraints. In particular inspect historical
-- device-school pairs and finance receipts/payments before the 410 constraints;
-- cached preflight reported zero devices and those source tables absent.

-- ============================================================================
-- SECTION: FUNCTIONS
-- Source migrations: 0010_historical_device_school_bindings.sql,
-- 0013_phase7_finance.sql, 0029_operations_history.sql.
-- Required AFTER all referenced tables exist (thus after structural Publish),
-- BEFORE protected-table application writes resume.
-- Read-only preflight: inspect A13. Postflight: query in POSTFLIGHT section.
-- OPERATOR-GATE: set app.production_reconciliation_gate to
-- 'PRODUCTION-2026-10-01-FUNCTIONS-APPROVED' in the same session only after
-- independent target verification and explicit human approval.
-- ============================================================================
BEGIN;
DO $install_functions$
DECLARE
  spec record;
  actual record;
  same_name_count integer;
BEGIN
  IF current_setting('app.production_reconciliation_gate',true)
       IS DISTINCT FROM 'PRODUCTION-2026-10-01-FUNCTIONS-APPROVED' THEN
    RAISE EXCEPTION 'operator gate closed: functions section not approved';
  END IF;
  IF to_regclass('public.device_school_bindings') IS NULL
     OR to_regclass('public.fee_payments') IS NULL
     OR to_regclass('public.school_asset_history') IS NULL
     OR to_regclass('public.maintenance_request_status_history') IS NULL
     OR to_regclass('public.operational_task_status_history') IS NULL THEN
    RAISE EXCEPTION 'required protected tables missing; structural Publish prerequisite not met';
  END IF;
  -- Validate every existing same-name object before creating any absent one.
  -- Matching is based on source prosrc after trimming delimiter newlines only;
  -- literals and all internal body text remain exact. No existing function is
  -- replaced or altered by this installer.
  FOR spec IN
    SELECT * FROM (VALUES
      ('prevent_device_school_binding_mutation',
       $expected$BEGIN
  RAISE EXCEPTION 'device_school_bindings is append-only';
END;$expected$),
      ('protect_fee_payment_verification_metadata',
       $expected$BEGIN
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
END;$expected$),
      ('prevent_operations_history_mutation',
       $expected$BEGIN
  RAISE EXCEPTION 'Operations history is append-only' USING ERRCODE = '55000';
END;$expected$)
    ) AS v(function_name,expected_body)
  LOOP
    SELECT count(*) INTO same_name_count
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=spec.function_name;

    SELECT p.oid,p.pronargs,p.prorettype,p.proretset,p.prokind,p.proisstrict,
           p.prosecdef,p.provolatile,p.proparallel,p.proconfig,p.prosrc,
           p.proleakproof,l.lanname
      INTO actual
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang
     WHERE n.nspname='public' AND p.proname=spec.function_name AND p.pronargs=0;

    IF FOUND THEN
      IF same_name_count<>1
         OR actual.pronargs<>0
         OR actual.prorettype<>pg_catalog.to_regtype('pg_catalog.trigger')::oid
         OR actual.proretset
         OR actual.prokind<>'f'
         OR actual.lanname<>'plpgsql'
         OR pg_catalog.btrim(actual.prosrc,E'\r\n') IS DISTINCT FROM spec.expected_body
         OR actual.prosecdef
         OR actual.provolatile<>'v'
         OR actual.proparallel<>'u'
         OR actual.proisstrict
         OR actual.proleakproof
         OR actual.proconfig IS NOT NULL THEN
        RAISE EXCEPTION 'conflicting or unsafe existing function definition: public.%()',spec.function_name;
      END IF;
    ELSIF same_name_count<>0 THEN
      RAISE EXCEPTION 'unexpected overloaded function exists: public.%',spec.function_name;
    END IF;
  END LOOP;

  -- The CREATE OR REPLACE templates below execute only when the exact public
  -- zero-argument signature is absent. Matching functions remain a no-op;
  -- signature/body/attribute drift already raised before any template executes.
  FOR spec IN
    SELECT * FROM (VALUES
      ('prevent_device_school_binding_mutation',
       $expected$BEGIN
  RAISE EXCEPTION 'device_school_bindings is append-only';
END;$expected$,
       $ddl$CREATE OR REPLACE FUNCTION public.prevent_device_school_binding_mutation()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  RAISE EXCEPTION 'device_school_bindings is append-only';
END;
$body$;$ddl$),
      ('protect_fee_payment_verification_metadata',
       $expected$BEGIN
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
END;$expected$,
       $ddl$CREATE OR REPLACE FUNCTION public.protect_fee_payment_verification_metadata()
RETURNS trigger LANGUAGE plpgsql AS $body$
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
$body$;$ddl$),
      ('prevent_operations_history_mutation',
       $expected$BEGIN
  RAISE EXCEPTION 'Operations history is append-only' USING ERRCODE = '55000';
END;$expected$,
       $ddl$CREATE OR REPLACE FUNCTION public.prevent_operations_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  RAISE EXCEPTION 'Operations history is append-only' USING ERRCODE = '55000';
END;
$body$;$ddl$)
    ) AS v(function_name,expected_body,create_sql)
  LOOP
    IF pg_catalog.to_regprocedure('public.' || pg_catalog.quote_ident(spec.function_name) || '()') IS NULL THEN
      EXECUTE spec.create_sql;
    END IF;
  END LOOP;

  -- Immediate post-install verification of signature, source body, security,
  -- language, volatility, parallel and configuration attributes.
  FOR spec IN
    SELECT * FROM (VALUES
      ('prevent_device_school_binding_mutation',
       $expected$BEGIN
  RAISE EXCEPTION 'device_school_bindings is append-only';
END;$expected$),
      ('protect_fee_payment_verification_metadata',
       $expected$BEGIN
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
END;$expected$),
      ('prevent_operations_history_mutation',
       $expected$BEGIN
  RAISE EXCEPTION 'Operations history is append-only' USING ERRCODE = '55000';
END;$expected$)
    ) AS v(function_name,expected_body)
  LOOP
    SELECT p.pronargs,p.prorettype,p.proretset,p.prokind,p.proisstrict,
           p.prosecdef,p.provolatile,p.proparallel,p.proconfig,p.prosrc,
           p.proleakproof,l.lanname
      INTO actual
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang
     WHERE n.nspname='public' AND p.proname=spec.function_name AND p.pronargs=0;
    IF NOT FOUND OR actual.pronargs<>0
       OR actual.prorettype<>pg_catalog.to_regtype('pg_catalog.trigger')::oid
       OR actual.proretset OR actual.prokind<>'f'
       OR actual.lanname<>'plpgsql'
       OR pg_catalog.btrim(actual.prosrc,E'\r\n') IS DISTINCT FROM spec.expected_body
       OR actual.prosecdef OR actual.provolatile<>'v'
       OR actual.proparallel<>'u' OR actual.proisstrict
       OR actual.proleakproof OR actual.proconfig IS NOT NULL THEN
      RAISE EXCEPTION 'immediate function protection verification failed: public.%()',spec.function_name;
    END IF;
  END LOOP;
END;
$install_functions$;
COMMIT;

-- ============================================================================
-- SECTION: TRIGGERS
-- Six source triggers, exact source events/granularity/columns/WHEN (none).
-- Trigger install is idempotent WITHOUT DROP: existing same-name trigger is a
-- no-op only if catalog definition matches table, event bits, columns, function,
-- WHEN, enabled state and trigger arguments; any conflict fails closed.
-- Sources: 0010, 0013, 0029. AFTER structural tables/functions; before writes.
-- The following are literal source-review references only. They are comments,
-- not a second install path; the gated catalog-checked installer below is the
-- only executable trigger creation path in this section.
--
-- CREATE TRIGGER "device_school_bindings_append_only"
--   BEFORE UPDATE OR DELETE ON "device_school_bindings"
--   FOR EACH ROW EXECUTE FUNCTION "prevent_device_school_binding_mutation"();
--
-- CREATE TRIGGER "device_school_bindings_no_truncate"
--   BEFORE TRUNCATE ON "device_school_bindings"
--   FOR EACH STATEMENT EXECUTE FUNCTION "prevent_device_school_binding_mutation"();
--
-- CREATE TRIGGER "fee_payments_verification_metadata_immutable"
--   BEFORE UPDATE ON "fee_payments"
--   FOR EACH ROW EXECUTE FUNCTION "protect_fee_payment_verification_metadata"();
--
-- CREATE TRIGGER "school_asset_history_append_only"
--   BEFORE UPDATE OR DELETE ON "school_asset_history"
--   FOR EACH ROW EXECUTE FUNCTION "prevent_operations_history_mutation"();
--
-- CREATE TRIGGER "maintenance_request_status_history_append_only"
--   BEFORE UPDATE OR DELETE ON "maintenance_request_status_history"
--   FOR EACH ROW EXECUTE FUNCTION "prevent_operations_history_mutation"();
--
-- CREATE TRIGGER "operational_task_status_history_append_only"
--   BEFORE UPDATE OR DELETE ON "operational_task_status_history"
--   FOR EACH ROW EXECUTE FUNCTION "prevent_operations_history_mutation"();
--
-- Read-only preflight: A13. Postflight: POSTFLIGHT exact catalog check.
-- OPERATOR-GATE: app.production_reconciliation_gate must equal
-- 'PRODUCTION-2026-10-01-TRIGGERS-APPROVED' in this same session.
-- ============================================================================
BEGIN;
DO $install_triggers$
DECLARE
  spec record;
  relid oid;
  actual_type smallint;
  actual_attr_count integer;
  actual_has_when boolean;
  actual_func oid;
  actual_enabled "char";
  actual_nargs smallint;
  actual_internal boolean;
  actual_found boolean;
  expected_func oid;
BEGIN
  IF current_setting('app.production_reconciliation_gate',true)
       IS DISTINCT FROM 'PRODUCTION-2026-10-01-TRIGGERS-APPROVED' THEN
    RAISE EXCEPTION 'operator gate closed: triggers section not approved';
  END IF;
  FOR spec IN
    SELECT * FROM (VALUES
      ('device_school_bindings_append_only','device_school_bindings',27,'prevent_device_school_binding_mutation','ROW_UPDATE_DELETE'),
      ('device_school_bindings_no_truncate','device_school_bindings',34,'prevent_device_school_binding_mutation','STATEMENT_TRUNCATE'),
      ('fee_payments_verification_metadata_immutable','fee_payments',19,'protect_fee_payment_verification_metadata','ROW_UPDATE'),
      ('school_asset_history_append_only','school_asset_history',27,'prevent_operations_history_mutation','ROW_UPDATE_DELETE'),
      ('maintenance_request_status_history_append_only','maintenance_request_status_history',27,'prevent_operations_history_mutation','ROW_UPDATE_DELETE'),
      ('operational_task_status_history_append_only','operational_task_status_history',27,'prevent_operations_history_mutation','ROW_UPDATE_DELETE')
    ) AS v(trigger_name,table_name,event_bits,function_name,create_kind)
  LOOP
    relid := to_regclass(format('%I.%I','public',spec.table_name));
    IF relid IS NULL THEN
      RAISE EXCEPTION 'required trigger table public.% is absent', spec.table_name;
    END IF;
    expected_func := to_regprocedure('public.' || quote_ident(spec.function_name) || '()');
    IF expected_func IS NULL THEN
      RAISE EXCEPTION 'required function public.%() is absent', spec.function_name;
    END IF;
    SELECT t.tgtype,cardinality(t.tgattr::smallint[]),t.tgqual IS NOT NULL,
           t.tgfoid,t.tgenabled,t.tgnargs,t.tgisinternal
      INTO actual_type,actual_attr_count,actual_has_when,actual_func,actual_enabled,actual_nargs,actual_internal
      FROM pg_catalog.pg_trigger t
     WHERE t.tgrelid=relid AND t.tgname=spec.trigger_name;
    actual_found := FOUND;
    IF actual_found THEN
       IF actual_type::integer IS DISTINCT FROM spec.event_bits
          OR actual_attr_count IS DISTINCT FROM 0
          OR actual_func IS DISTINCT FROM expected_func
          OR actual_has_when IS DISTINCT FROM false
          OR actual_enabled IS DISTINCT FROM 'O'
          OR actual_nargs IS DISTINCT FROM 0
          OR actual_internal IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'conflicting existing trigger definition: public.%.%',spec.table_name,spec.trigger_name;
      END IF;
      CONTINUE;
    END IF;
    IF spec.create_kind='STATEMENT_TRUNCATE' THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.%I()',spec.trigger_name,spec.table_name,spec.function_name);
    ELSIF spec.create_kind='ROW_UPDATE' THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.%I()',spec.trigger_name,spec.table_name,spec.function_name);
    ELSE
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.%I()',spec.trigger_name,spec.table_name,spec.function_name);
    END IF;
    -- Immediate catalog verification of each just-created protection trigger.
    SELECT t.tgtype,cardinality(t.tgattr::smallint[]),t.tgqual IS NOT NULL,
           t.tgfoid,t.tgenabled,t.tgnargs,t.tgisinternal
      INTO actual_type,actual_attr_count,actual_has_when,actual_func,actual_enabled,actual_nargs,actual_internal
      FROM pg_catalog.pg_trigger t
     WHERE t.tgrelid=relid AND t.tgname=spec.trigger_name;
    IF NOT FOUND
       OR actual_type::integer IS DISTINCT FROM spec.event_bits
       OR actual_attr_count IS DISTINCT FROM 0
       OR actual_func IS DISTINCT FROM expected_func
       OR actual_has_when IS DISTINCT FROM false
       OR actual_enabled IS DISTINCT FROM 'O'
       OR actual_nargs IS DISTINCT FROM 0
       OR actual_internal IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'immediate trigger protection verification failed: public.%.%',spec.table_name,spec.trigger_name;
    END IF;
  END LOOP;
END;
$install_triggers$;
COMMIT;

-- ============================================================================
-- SECTION: BACKFILLS
-- Each block has its own read-only preflight above/nearby, explicit transaction,
-- fail-closed prerequisites and explicit COMMIT. Run only one gated block at a
-- time after structural parent-key/FK checks. Never execute whole package.
-- ============================================================================

-- F. Guardian/student links. Source mapping: 0000_brainy_moon_knight.sql lines
-- 160-172. Exactly-one same-school candidate, meaningful normalized names and
-- phones, no existing target pair; ambiguous/unmatched records remain unchanged.
-- Preflight: A8. Postflight: POSTFLIGHT F. No raw PII is selected.
-- OPERATOR-GATE: set app.production_reconciliation_gate to
-- 'PRODUCTION-2026-10-01-GUARDIAN-BACKFILL-APPROVED'.
BEGIN;
DO $guardian_backfill$
DECLARE inserted_count integer;
BEGIN
  IF current_setting('app.production_reconciliation_gate',true) IS DISTINCT FROM 'PRODUCTION-2026-10-01-GUARDIAN-BACKFILL-APPROVED' THEN
    RAISE EXCEPTION 'operator gate closed: guardian backfill not approved';
  END IF;
  IF to_regclass('public.students') IS NULL OR to_regclass('public.parents') IS NULL OR to_regclass('public.parent_student_relationships') IS NULL THEN
    RAISE EXCEPTION 'guardian backfill prerequisite table absent';
  END IF;
  IF EXISTS (
    WITH c AS (
      SELECT st.id,count(p.id) AS n
      FROM public.students st LEFT JOIN public.parents p
        ON p.school_id=st.school_id
       AND lower(btrim(p.name))=lower(btrim(st.parent_name))
       AND regexp_replace(p.phone,'\D','','g')=regexp_replace(st.parent_phone,'\D','','g')
       AND nullif(btrim(p.name),'') IS NOT NULL
        AND nullif(regexp_replace(p.phone,'\D','','g'),'') IS NOT NULL
      WHERE nullif(btrim(st.parent_name),'') IS NOT NULL
         AND nullif(regexp_replace(st.parent_phone,'\D','','g'),'') IS NOT NULL
      GROUP BY st.id
    ) SELECT 1 FROM c WHERE n>1
  ) THEN RAISE EXCEPTION 'ambiguous guardian candidates exist; review before proceeding'; END IF;
  INSERT INTO public.parent_student_relationships
    (parent_id,student_id,relationship_type,is_primary_guardian,is_emergency_contact,contact_priority,status)
  WITH candidates AS (
    SELECT st.id AS student_id,st.school_id,p.id AS parent_id,
           count(*) OVER (PARTITION BY st.id) AS candidate_count
    FROM public.students st JOIN public.parents p ON p.school_id=st.school_id
      AND lower(btrim(p.name))=lower(btrim(st.parent_name))
      AND regexp_replace(p.phone,'\D','','g')=regexp_replace(st.parent_phone,'\D','','g')
    WHERE nullif(btrim(st.parent_name),'') IS NOT NULL
      AND nullif(btrim(p.name),'') IS NOT NULL
      AND nullif(regexp_replace(st.parent_phone,'\D','','g'),'') IS NOT NULL
      AND nullif(regexp_replace(p.phone,'\D','','g'),'') IS NOT NULL
  )
  SELECT parent_id,student_id,'Guardian',true,true,1,'ACTIVE'
  FROM candidates c
  WHERE candidate_count=1
    AND NOT EXISTS (SELECT 1 FROM public.parent_student_relationships r
                    WHERE r.parent_id=c.parent_id AND r.student_id=c.student_id)
  ON CONFLICT (parent_id,student_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'guardian links inserted: %; ambiguous/unmatched records were not changed',inserted_count;
END;
$guardian_backfill$;
COMMIT;

-- G. LEGACY academic sessions. Source mapping: 0001_phase3_meta.sql lines
-- 189-192. Exact date semantics: CURRENT_DATE at execution for BOTH dates;
-- no historical date is fabricated. Duplicate guard is (school_id,name).
-- Preflight: A9. Postflight: M6.
-- OPERATOR-GATE: app.production_reconciliation_gate =
-- 'PRODUCTION-2026-10-01-LEGACY-SESSION-BACKFILL-APPROVED'.
BEGIN;
DO $legacy_sessions$
DECLARE inserted_count integer;
BEGIN
  IF current_setting('app.production_reconciliation_gate',true) IS DISTINCT FROM 'PRODUCTION-2026-10-01-LEGACY-SESSION-BACKFILL-APPROVED' THEN
    RAISE EXCEPTION 'operator gate closed: LEGACY session backfill not approved';
  END IF;
  IF to_regclass('public.schools') IS NULL OR to_regclass('public.academic_sessions') IS NULL THEN
    RAISE EXCEPTION 'LEGACY session prerequisites absent';
  END IF;
  INSERT INTO public.academic_sessions(school_id,name,start_date,end_date,status,is_current)
  SELECT sc.id,'LEGACY',CURRENT_DATE,CURRENT_DATE,'COMPLETED',false
  FROM public.schools sc
  WHERE NOT EXISTS (SELECT 1 FROM public.academic_sessions a WHERE a.school_id=sc.id AND a.name='LEGACY')
  ON CONFLICT (school_id,name) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'LEGACY sessions inserted: %; source date was execution CURRENT_DATE',inserted_count;
END;
$legacy_sessions$;
COMMIT;

-- H. Historical class assignments. Source mapping: 0001_phase3_meta.sql lines
-- 193-206: student.school_id/id -> assignment school_id/student_id; unique
-- same-school class name+section -> school_class_id; school LEGACY session ->
-- academic_session_id; section copied; status upper(student.status) with ACTIVE
-- retained as ACTIVE; is_current iff ACTIVE; start_date=student.joined_at::date;
-- academic_term_id/end_date use defaults (NULL). Exactly-one class source and
-- no existing student/session history. Unmatched/ambiguous students unchanged.
-- Preflight: A10. Postflight: M7.
-- OPERATOR-GATE: app.production_reconciliation_gate =
-- 'PRODUCTION-2026-10-01-CLASS-HISTORY-BACKFILL-APPROVED'.
BEGIN;
DO $class_history$
DECLARE inserted_count integer;
BEGIN
  IF current_setting('app.production_reconciliation_gate',true) IS DISTINCT FROM 'PRODUCTION-2026-10-01-CLASS-HISTORY-BACKFILL-APPROVED' THEN
    RAISE EXCEPTION 'operator gate closed: class history backfill not approved';
  END IF;
  IF to_regclass('public.students') IS NULL OR to_regclass('public.school_classes') IS NULL
     OR to_regclass('public.academic_sessions') IS NULL OR to_regclass('public.student_class_assignments') IS NULL THEN
    RAISE EXCEPTION 'class history prerequisites absent';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.students st
    JOIN public.school_classes sc ON sc.school_id=st.school_id AND sc.name=st.class_name AND sc.section=st.section
    JOIN public.academic_sessions s ON s.school_id=st.school_id AND s.name='LEGACY'
    WHERE NOT EXISTS (SELECT 1 FROM public.student_class_assignments a WHERE a.student_id=st.id AND a.academic_session_id=s.id)
    GROUP BY st.id HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'ambiguous same-school class candidates exist; review before proceeding'; END IF;
  INSERT INTO public.student_class_assignments
    (school_id,student_id,academic_session_id,school_class_id,section,status,is_current,start_date)
  SELECT st.school_id,st.id,s.id,sc.id,st.section,
         CASE WHEN upper(st.status)='ACTIVE' THEN 'ACTIVE' ELSE upper(st.status) END,
         upper(st.status)='ACTIVE',st.joined_at::date
  FROM public.students st
  JOIN public.school_classes sc ON sc.school_id=st.school_id
    AND sc.name=st.class_name AND sc.section=st.section
  JOIN public.academic_sessions s ON s.school_id=st.school_id AND s.name='LEGACY'
  WHERE (SELECT count(*) FROM public.school_classes sc2
         WHERE sc2.school_id=st.school_id AND sc2.name=st.class_name AND sc2.section=st.section)=1
    AND NOT EXISTS (SELECT 1 FROM public.student_class_assignments a
                    WHERE a.student_id=st.id AND a.academic_session_id=s.id);
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'class-history rows inserted: %; unmatched/ambiguous students unchanged',inserted_count;
END;
$class_history$;
COMMIT;

-- I. Commission seed. Source: 0003_phase4_integrity.sql lines 1-10; schema
-- behavior: lib/db/src/schema/edupulse.ts commissionRules and application
-- lookup artifacts/api-server/src/routes/edupulse.ts. Global rule by source
-- design (no school_id); the application picks active matching term or NULL,
-- with effective-time and allocation checks. Lock makes concurrent reruns
-- serialize; NOT EXISTS preserves any active NULL-term rule without overwriting.
-- Preflight: A11. Postflight: M8.
-- OPERATOR-GATE: app.production_reconciliation_gate =
-- 'PRODUCTION-2026-10-01-COMMISSION-SEED-APPROVED'.
BEGIN;
DO $commission_seed$
DECLARE inserted_count integer;
BEGIN
  IF current_setting('app.production_reconciliation_gate',true) IS DISTINCT FROM 'PRODUCTION-2026-10-01-COMMISSION-SEED-APPROVED' THEN
    RAISE EXCEPTION 'operator gate closed: commission seed not approved';
  END IF;
  IF to_regclass('public.commission_rules') IS NULL THEN RAISE EXCEPTION 'commission_rules absent'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-reconciliation:commission-default-rule',0));
  INSERT INTO public.commission_rules
    (name,status,term,currency,calculation_basis,effective_at,partner_rate,allocation_total,partner_amount,school_amount,edupulse_amount)
  SELECT 'Default partner referral','ACTIVE',NULL,'NGN','PER_ELIGIBLE_STUDENT_PER_TERM',NOW(),
         100,5000,100,2000,2900
  WHERE NOT EXISTS (SELECT 1 FROM public.commission_rules WHERE status='ACTIVE' AND term IS NULL);
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'commission rules inserted: %; pre-existing active NULL-term rule preserved',inserted_count;
END;
$commission_seed$;
COMMIT;

-- J. Device-school binding history. Source behavior: 0010_historical_device_school_bindings.sql
-- lines 15-31 plus 0011_historical_device_references.sql lines 1-7. Inserts only
-- evidence from attendance_events, device_credentials, device_assignment_history
-- (device/school, previous_school_id, and new_school_id where present), current
-- platform_devices ownership, biometric_enrollments, and nfc_cards.last_device_id.
-- Absent relations/columns are tested before dynamic SQL is parsed. Never infer
-- old school from current ownership and never invent historical events.
-- Cached preflight: zero devices and all listed history/biometric/card-reference
-- sources absent, so current expected outcome is a no-op. Future source rows
-- make this applicable only when explicit historical pairs exist.
-- Preflight: A12. Postflight: M9.
-- OPERATOR-GATE: app.production_reconciliation_gate =
-- 'PRODUCTION-2026-10-01-DEVICE-BINDINGS-APPROVED'.
BEGIN;
DO $device_binding_backfill$
DECLARE src text;
BEGIN
  IF current_setting('app.production_reconciliation_gate',true) IS DISTINCT FROM 'PRODUCTION-2026-10-01-DEVICE-BINDINGS-APPROVED' THEN
    RAISE EXCEPTION 'operator gate closed: device binding backfill not approved';
  END IF;
  IF to_regclass('public.device_school_bindings') IS NULL THEN RAISE EXCEPTION 'device_school_bindings absent; structural Publish prerequisite not met'; END IF;
  IF to_regclass('public.platform_devices') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_devices' AND column_name='id')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_devices' AND column_name='school_id') THEN
      RAISE EXCEPTION 'platform_devices exists with unexpected columns; fail closed';
    END IF;
    EXECUTE 'INSERT INTO public.device_school_bindings(device_id,school_id) SELECT id,school_id FROM public.platform_devices WHERE school_id IS NOT NULL ON CONFLICT(device_id,school_id) DO NOTHING';
  END IF;
  FOR src IN SELECT unnest(ARRAY['attendance_events','device_credentials']) LOOP
    IF to_regclass(format('%I.%I','public',src)) IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=src AND column_name='device_id')
         OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=src AND column_name='school_id') THEN
        RAISE EXCEPTION 'source public.% has unexpected columns; fail closed',src;
      END IF;
      EXECUTE format('INSERT INTO public.device_school_bindings(device_id,school_id) SELECT device_id,school_id FROM public.%I WHERE device_id IS NOT NULL AND school_id IS NOT NULL ON CONFLICT(device_id,school_id) DO NOTHING',src);
    END IF;
  END LOOP;
  src := 'device_assignment_history';
  IF to_regclass('public.device_assignment_history') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=src AND column_name='device_id')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=src AND column_name='school_id') THEN
      RAISE EXCEPTION 'device_assignment_history has unexpected mandatory columns; fail closed';
    END IF;
    EXECUTE 'INSERT INTO public.device_school_bindings(device_id,school_id) SELECT device_id,school_id FROM public.device_assignment_history WHERE school_id IS NOT NULL ON CONFLICT(device_id,school_id) DO NOTHING';
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=src AND column_name='previous_school_id') THEN
      EXECUTE 'INSERT INTO public.device_school_bindings(device_id,school_id) SELECT device_id,previous_school_id FROM public.device_assignment_history WHERE previous_school_id IS NOT NULL ON CONFLICT(device_id,school_id) DO NOTHING';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=src AND column_name='new_school_id') THEN
      EXECUTE 'INSERT INTO public.device_school_bindings(device_id,school_id) SELECT device_id,new_school_id FROM public.device_assignment_history WHERE new_school_id IS NOT NULL ON CONFLICT(device_id,school_id) DO NOTHING';
    END IF;
  END IF;
  src := 'biometric_enrollments';
  IF to_regclass('public.biometric_enrollments') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=src AND column_name='device_id')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=src AND column_name='school_id') THEN
      RAISE EXCEPTION 'biometric_enrollments has unexpected columns; fail closed';
    END IF;
    EXECUTE 'INSERT INTO public.device_school_bindings(device_id,school_id) SELECT device_id,school_id FROM public.biometric_enrollments WHERE device_id IS NOT NULL AND school_id IS NOT NULL ON CONFLICT(device_id,school_id) DO NOTHING';
  END IF;
  src := 'nfc_cards';
  IF to_regclass('public.nfc_cards') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=src AND column_name='last_device_id') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=src AND column_name='school_id') THEN
      RAISE EXCEPTION 'nfc_cards last-device column exists without school_id; fail closed';
    END IF;
    EXECUTE 'INSERT INTO public.device_school_bindings(device_id,school_id) SELECT last_device_id,school_id FROM public.nfc_cards WHERE last_device_id IS NOT NULL ON CONFLICT(device_id,school_id) DO NOTHING';
  END IF;
END;
$device_binding_backfill$;
COMMIT;

-- K. Receipt metadata. Source: 0014_finance_payment_integrity.sql lines 37-48.
-- Exact metadata keys are snapshot.invoiceId and snapshot.schoolId, derived
-- from the matching same-school fee_payments row. This guarded repair only fills
-- a NULL invoice_id/missing snapshot key and never changes a correct value.
-- Any conflicting existing invoice_id/snapshot key or unmatched receipt raises
-- before mutation. It does not alter fee_payments or verified-payment evidence.
-- Source tables were absent in inspected Production. Dynamic SQL is parsed only
-- after catalog/column checks. If populated receipts/payments exist BEFORE
-- structural Publish, STOP for separate prerequisite review: the 410 preview
-- may create invoice_id NOT NULL/dependent constraints before a repair can run.
-- Current empty/new tables are a safe no-op. Preflight K1/A12; postflight M10.
-- OPERATOR-GATE: app.production_reconciliation_gate =
-- 'PRODUCTION-2026-10-01-FINANCE-METADATA-APPROVED'.
-- K1 read-only preflight; counts only, no absent-table parsing.
SELECT CASE WHEN pg_catalog.to_regclass('public.fee_receipts') IS NULL
              OR pg_catalog.to_regclass('public.fee_payments') IS NULL
            THEN 'SOURCE_OR_TARGET_TABLE_ABSENT; NO DATA QUERY PARSED'
            WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_receipts' AND column_name='invoice_id')
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_receipts' AND column_name='snapshot')
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_receipts' AND column_name='payment_id')
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_receipts' AND column_name='school_id')
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_payments' AND column_name='id')
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_payments' AND column_name='invoice_id')
              OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_payments' AND column_name='school_id')
            THEN 'RECEIPT_METADATA_COLUMNS_ABSENT; STOP_AND_REVIEW'
            ELSE pg_catalog.query_to_xml($q$
SELECT count(*) AS receipt_rows,
        count(*) FILTER (WHERE r.snapshot IS NULL OR jsonb_typeof(r.snapshot) IS DISTINCT FROM 'object') AS invalid_snapshot_shapes,
       count(*) FILTER (WHERE p.id IS NULL OR p.school_id IS DISTINCT FROM r.school_id) AS unmatched_or_cross_school,
       count(*) FILTER (WHERE p.id IS NOT NULL AND r.invoice_id IS NOT NULL AND r.invoice_id IS DISTINCT FROM p.invoice_id) AS invoice_id_conflicts,
       count(*) FILTER (WHERE p.id IS NOT NULL AND r.snapshot ? 'invoiceId'
          AND (jsonb_typeof(r.snapshot->'invoiceId') IS DISTINCT FROM 'number' OR r.snapshot->>'invoiceId' IS DISTINCT FROM p.invoice_id::text)) AS snapshot_invoice_conflicts,
       count(*) FILTER (WHERE p.id IS NOT NULL AND r.snapshot ? 'schoolId'
          AND (jsonb_typeof(r.snapshot->'schoolId') IS DISTINCT FROM 'number' OR r.snapshot->>'schoolId' IS DISTINCT FROM r.school_id::text)) AS snapshot_school_conflicts,
       count(*) FILTER (WHERE p.id IS NOT NULL AND r.invoice_id IS NULL) AS invoice_id_fill_candidates,
       count(*) FILTER (WHERE p.id IS NOT NULL AND (NOT (r.snapshot ? 'invoiceId') OR NOT (r.snapshot ? 'schoolId'))) AS snapshot_key_fill_candidates
FROM public.fee_receipts r LEFT JOIN public.fee_payments p ON p.id=r.payment_id
$q$,false,false,'')
       END::text AS finance_receipt_preflight;
BEGIN;
DO $finance_receipt_backfill$
DECLARE receipts_exists boolean; payments_exists boolean; row_count bigint; conflicts bigint;
BEGIN
  IF current_setting('app.production_reconciliation_gate',true) IS DISTINCT FROM 'PRODUCTION-2026-10-01-FINANCE-METADATA-APPROVED' THEN
    RAISE EXCEPTION 'operator gate closed: finance metadata backfill not approved';
  END IF;
  receipts_exists := to_regclass('public.fee_receipts') IS NOT NULL;
  payments_exists := to_regclass('public.fee_payments') IS NOT NULL;
  IF NOT receipts_exists OR NOT payments_exists THEN
    IF receipts_exists THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_receipts' AND column_name='payment_id') THEN
        RAISE EXCEPTION 'fee_receipts exists with unknown shape; fail closed';
      END IF;
      EXECUTE 'SELECT count(*) FROM public.fee_receipts' INTO row_count;
      IF row_count>0 THEN RAISE EXCEPTION 'populated fee_receipts without fee_payments; manual evidence review required'; END IF;
    END IF;
    IF payments_exists AND NOT receipts_exists THEN
      EXECUTE 'SELECT count(*) FROM public.fee_payments' INTO row_count;
      IF row_count>0 THEN RAISE EXCEPTION 'populated fee_payments without fee_receipts; manual evidence review required'; END IF;
    END IF;
    RAISE NOTICE 'finance source/target absent or empty; safe no-op';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_receipts' AND column_name='payment_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_receipts' AND column_name='school_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_receipts' AND column_name='invoice_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_receipts' AND column_name='snapshot')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_payments' AND column_name='id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_payments' AND column_name='invoice_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_payments' AND column_name='school_id') THEN
    RAISE EXCEPTION 'finance metadata source/target columns do not match reviewed schema; fail closed';
  END IF;
  EXECUTE $query$
    SELECT count(*) FROM public.fee_receipts r
    LEFT JOIN public.fee_payments p ON p.id=r.payment_id
     WHERE r.snapshot IS NULL
        OR jsonb_typeof(r.snapshot) IS DISTINCT FROM 'object'
        OR p.id IS NULL OR p.school_id IS DISTINCT FROM r.school_id
       OR (r.invoice_id IS NOT NULL AND r.invoice_id IS DISTINCT FROM p.invoice_id)
       OR (r.snapshot ? 'invoiceId' AND (jsonb_typeof(r.snapshot->'invoiceId') IS DISTINCT FROM 'number' OR r.snapshot->>'invoiceId' IS DISTINCT FROM p.invoice_id::text))
       OR (r.snapshot ? 'schoolId' AND (jsonb_typeof(r.snapshot->'schoolId') IS DISTINCT FROM 'number' OR r.snapshot->>'schoolId' IS DISTINCT FROM r.school_id::text))
  $query$ INTO conflicts;
  IF conflicts>0 THEN RAISE EXCEPTION 'conflicting/orphan finance receipt metadata rows (%); no rows changed',conflicts; END IF;
  EXECUTE 'UPDATE public.fee_receipts r SET invoice_id=p.invoice_id FROM public.fee_payments p WHERE p.id=r.payment_id AND p.school_id=r.school_id AND r.invoice_id IS NULL';
  EXECUTE 'UPDATE public.fee_receipts r SET snapshot=r.snapshot || jsonb_build_object(''invoiceId'',r.invoice_id,''schoolId'',r.school_id) WHERE NOT (r.snapshot ? ''invoiceId'') OR NOT (r.snapshot ? ''schoolId'')';
   EXECUTE $query$
     SELECT count(*) FROM public.fee_receipts r
     LEFT JOIN public.fee_payments p ON p.id=r.payment_id
     WHERE r.snapshot IS NULL
        OR jsonb_typeof(r.snapshot) IS DISTINCT FROM 'object'
        OR p.id IS NULL
        OR p.school_id IS DISTINCT FROM r.school_id
        OR p.invoice_id IS DISTINCT FROM r.invoice_id
        OR jsonb_typeof(r.snapshot->'invoiceId') IS DISTINCT FROM 'number'
        OR r.snapshot->>'invoiceId' IS DISTINCT FROM r.invoice_id::text
        OR jsonb_typeof(r.snapshot->'schoolId') IS DISTINCT FROM 'number'
        OR r.snapshot->>'schoolId' IS DISTINCT FROM r.school_id::text
   $query$ INTO conflicts;
   IF conflicts>0 THEN RAISE EXCEPTION 'post-update receipt metadata invariant failed (%); transaction will roll back',conflicts; END IF;
  RAISE NOTICE 'receipt invoice_id/snapshot keys filled only where missing; matching existing values preserved';
END;
$finance_receipt_backfill$;
COMMIT;

-- ============================================================================
-- SECTION: POSTFLIGHT READ ONLY
-- Run only after manual Publish and each approved section. Targeted package
-- verification only, NOT a repeat 410-statement schema audit.
-- ============================================================================

-- M1. Exact presence check for all expected application table names.
WITH expected(table_name) AS (
  VALUES
    ('academic_assessment_types'),
    ('academic_assessments'),
    ('academic_assignments'),
    ('academic_grading_rules'),
    ('academic_report_card_lines'),
    ('academic_report_cards'),
    ('academic_results'),
    ('academic_sessions'),
    ('academic_terms'),
    ('academic_timetable_entries'),
    ('app_users'),
    ('attendance_corrections'),
    ('attendance_discrepancies'),
    ('attendance_events'),
    ('attendance_notification_events'),
    ('attendance_settings'),
    ('audit_logs'),
    ('biometric_enrollments'),
    ('class_subjects'),
    ('commission_ledger'),
    ('commission_rules'),
    ('communication_campaign_recipients'),
    ('communication_campaigns'),
    ('communication_deliveries'),
    ('communication_notifications'),
    ('communication_preferences'),
    ('communication_push_devices'),
    ('communication_templates'),
    ('device_assignment_history'),
    ('device_credentials'),
    ('device_school_bindings'),
    ('employees'),
    ('fee_adjustments'),
    ('fee_categories'),
    ('fee_invoice_lines'),
    ('fee_invoice_notification_outbox'),
    ('fee_invoice_notifications'),
    ('fee_invoices'),
    ('fee_payment_notification_outbox'),
    ('fee_payment_notifications'),
    ('fee_payments'),
    ('fee_provider_checkout_sessions'),
    ('fee_provider_webhook_events'),
    ('fee_receipts'),
    ('fee_refunds'),
    ('fee_school_settings'),
    ('fee_structure_lines'),
    ('fee_structures'),
    ('library_authors'),
    ('library_book_copies'),
    ('library_books'),
    ('library_categories'),
    ('library_copy_status_history'),
    ('library_loans'),
    ('library_publishers'),
    ('library_renewals'),
    ('library_settings'),
    ('library_staff'),
    ('maintenance_request_status_history'),
    ('maintenance_requests'),
    ('nfc_card_history'),
    ('nfc_cards'),
    ('operational_task_status_history'),
    ('operational_tasks'),
    ('parent_student_relationships'),
    ('parents'),
    ('partner_attribution_conflicts'),
    ('partner_invitations'),
    ('partner_payout_information'),
    ('partner_payouts'),
    ('partner_profile_users'),
    ('partner_profiles'),
    ('partner_referral_links'),
    ('platform_company_employees'),
    ('platform_devices'),
    ('platform_notifications'),
    ('school_asset_history'),
    ('school_assets'),
    ('school_classes'),
    ('school_facilities'),
    ('school_memberships'),
    ('school_operation_categories'),
    ('school_operations_settings'),
    ('school_partner_attributions'),
    ('schools'),
    ('student_class_assignments'),
    ('student_identification_policies'),
    ('students'),
    ('subjects'),
    ('subscriptions'),
    ('teacher_class_assignments')
), actual AS (
  SELECT c.relname AS table_name
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
)
SELECT (SELECT count(*) FROM expected) AS expected_table_count,
       (SELECT count(*) FROM expected e JOIN actual a USING(table_name)) AS expected_tables_present,
       (SELECT array_agg(e.table_name ORDER BY e.table_name) FROM expected e LEFT JOIN actual a USING(table_name) WHERE a.table_name IS NULL) AS missing_expected_tables,
       (SELECT array_agg(a.table_name ORDER BY a.table_name) FROM actual a LEFT JOIN expected e USING(table_name) WHERE e.table_name IS NULL) AS unexpected_public_tables;

-- M2. Parent keys plus new school-operation-category key must be valid.
WITH wanted(table_name,key_columns) AS (
 VALUES ('nfc_cards',ARRAY['id','school_id']::text[]),
        ('academic_sessions',ARRAY['id','school_id']::text[]),
        ('academic_terms',ARRAY['id','school_id']::text[]),
        ('employees',ARRAY['id','school_id']::text[]),
        ('school_classes',ARRAY['id','school_id']::text[]),
        ('students',ARRAY['id','school_id']::text[]),
        ('subjects',ARRAY['id','school_id']::text[]),
        ('school_operation_categories',ARRAY['id','school_id','category_type']::text[])
)
SELECT w.table_name,w.key_columns,
       EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class t ON t.oid=i.indrelid
               JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
               WHERE n.nspname='public' AND t.relname=w.table_name
                 AND i.indisunique AND i.indisvalid AND i.indimmediate
                 AND i.indpred IS NULL AND i.indexprs IS NULL
                 AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
                        FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,ord)
                        JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
                       WHERE k.ord<=i.indnkeyatts)=w.key_columns) AS exact_valid_unique_key_exists
FROM wanted w ORDER BY w.table_name;

-- M3. Verify every one of the 236 expected new FK names exists on a public
-- table and is validated. This does not reconstruct/re-audit the 410 DDL.
WITH expected_fk(constraint_name) AS (
  VALUES
    ('academic_assessment_types_school_id_fkey'),
    ('academic_assessments_class_school_fk'),
    ('academic_assessments_created_by_fkey'),
    ('academic_assessments_school_id_fkey'),
    ('academic_assessments_session_school_fk'),
    ('academic_assessments_subject_school_fk'),
    ('academic_assessments_teacher_school_fk'),
    ('academic_assessments_term_school_fk'),
    ('academic_assessments_type_school_fk'),
    ('academic_assignments_class_school_fk'),
    ('academic_assignments_created_by_fkey'),
    ('academic_assignments_school_id_fkey'),
    ('academic_assignments_session_school_fk'),
    ('academic_assignments_subject_school_fk'),
    ('academic_assignments_teacher_school_fk'),
    ('academic_assignments_term_school_fk'),
    ('academic_grading_rules_school_id_fkey'),
    ('academic_report_card_lines_report_card_school_fk'),
    ('academic_report_card_lines_result_school_fk'),
    ('academic_report_card_lines_school_id_fkey'),
    ('academic_report_card_lines_subject_school_fk'),
    ('academic_report_cards_class_assignment_school_fk'),
    ('academic_report_cards_class_school_fk'),
    ('academic_report_cards_published_by_fkey'),
    ('academic_report_cards_school_id_fkey'),
    ('academic_report_cards_session_school_fk'),
    ('academic_report_cards_student_school_fk'),
    ('academic_report_cards_term_school_fk'),
    ('academic_results_assessment_school_fk'),
    ('academic_results_class_assignment_school_fk'),
    ('academic_results_class_school_fk'),
    ('academic_results_created_by_fkey'),
    ('academic_results_published_by_fkey'),
    ('academic_results_school_id_fkey'),
    ('academic_results_session_school_fk'),
    ('academic_results_student_school_fk'),
    ('academic_results_subject_school_fk'),
    ('academic_results_teacher_school_fk'),
    ('academic_results_term_school_fk'),
    ('academic_timetable_entries_class_school_fk'),
    ('academic_timetable_entries_created_by_fkey'),
    ('academic_timetable_entries_school_id_fkey'),
    ('academic_timetable_entries_session_school_fk'),
    ('academic_timetable_entries_subject_school_fk'),
    ('academic_timetable_entries_teacher_school_fk'),
    ('academic_timetable_entries_term_school_fk'),
    ('attendance_corrections_actor_user_id_fkey'),
    ('attendance_corrections_attendance_event_id_fkey'),
    ('attendance_corrections_event_school_fk'),
    ('attendance_corrections_school_id_fkey'),
    ('attendance_discrepancies_attendance_event_id_fkey'),
    ('attendance_discrepancies_event_school_fk'),
    ('attendance_discrepancies_resolved_by_fkey'),
    ('attendance_discrepancies_school_id_fkey'),
    ('attendance_discrepancies_student_id_fkey'),
    ('attendance_discrepancies_student_school_fk'),
    ('attendance_events_academic_session_id_fkey'),
    ('attendance_events_academic_term_id_fkey'),
    ('attendance_events_actor_user_id_fkey'),
    ('attendance_events_class_school_fk'),
    ('attendance_events_device_id_fkey'),
    ('attendance_events_device_school_fk'),
    ('attendance_events_employee_id_fkey'),
    ('attendance_events_employee_school_fk'),
    ('attendance_events_nfc_card_id_fkey'),
    ('attendance_events_school_class_id_fkey'),
    ('attendance_events_school_id_fkey'),
    ('attendance_events_session_school_fk'),
    ('attendance_events_student_id_fkey'),
    ('attendance_events_student_school_fk'),
    ('attendance_events_term_school_fk'),
    ('attendance_notification_events_attendance_event_id_fkey'),
    ('attendance_notification_events_discrepancy_id_fkey'),
    ('attendance_notification_events_discrepancy_school_fk'),
    ('attendance_notification_events_event_school_fk'),
    ('attendance_notification_events_recipient_user_id_fkey'),
    ('attendance_notification_events_school_id_fkey'),
    ('attendance_settings_school_id_fkey'),
    ('biometric_enrollments_device_id_fkey'),
    ('biometric_enrollments_device_school_fk'),
    ('biometric_enrollments_employee_id_fkey'),
    ('biometric_enrollments_employee_school_fk'),
    ('biometric_enrollments_school_id_fkey'),
    ('biometric_enrollments_student_id_fkey'),
    ('biometric_enrollments_student_school_fk'),
    ('communication_campaign_recipients_campaign_school_fk'),
    ('communication_campaign_recipients_notification_school_user_fk'),
    ('communication_campaign_recipients_recipient_user_id_fkey'),
    ('communication_campaigns_created_by_user_id_fkey'),
    ('communication_campaigns_school_id_fkey'),
    ('communication_campaigns_template_school_fk'),
    ('communication_deliveries_notification_id_fkey'),
    ('communication_notifications_recipient_user_id_fkey'),
    ('communication_notifications_school_id_fkey'),
    ('communication_notifications_sender_user_id_fkey'),
    ('communication_notifications_subject_class_school_fk'),
    ('communication_notifications_subject_student_school_fk'),
    ('communication_preferences_school_id_fkey'),
    ('communication_preferences_user_id_fkey'),
    ('communication_push_devices_school_id_fkey'),
    ('communication_push_devices_user_id_fkey'),
    ('communication_templates_created_by_user_id_fkey'),
    ('communication_templates_school_id_fkey'),
    ('device_assignment_history_actor_user_id_fkey'),
    ('device_assignment_history_device_id_fkey'),
    ('device_assignment_history_new_school_id_fkey'),
    ('device_assignment_history_previous_school_id_fkey'),
    ('device_assignment_history_school_id_fkey'),
    ('device_credentials_device_id_fkey'),
    ('device_credentials_school_id_fkey'),
    ('device_school_bindings_device_id_fkey'),
    ('device_school_bindings_school_id_fkey'),
    ('fee_adjustments_approved_by_fkey'),
    ('fee_adjustments_invoice_school_fk'),
    ('fee_adjustments_requested_by_fkey'),
    ('fee_adjustments_school_id_fkey'),
    ('fee_categories_created_by_fkey'),
    ('fee_categories_school_id_fkey'),
    ('fee_invoice_lines_category_school_fk'),
    ('fee_invoice_lines_invoice_school_fk'),
    ('fee_invoice_lines_school_id_fkey'),
    ('fee_invoice_notification_outbox_invoice_school_fk'),
    ('fee_invoice_notification_outbox_school_id_fkey'),
    ('fee_invoice_notifications_invoice_school_fk'),
    ('fee_invoice_notifications_recipient_user_id_fkey'),
    ('fee_invoice_notifications_school_id_fkey'),
    ('fee_invoices_created_by_fkey'),
    ('fee_invoices_school_id_fkey'),
    ('fee_invoices_session_school_fk'),
    ('fee_invoices_structure_school_fk'),
    ('fee_invoices_student_school_fk'),
    ('fee_invoices_term_school_fk'),
    ('fee_payment_notification_outbox_payment_invoice_school_fk'),
    ('fee_payment_notification_outbox_school_id_fkey'),
    ('fee_payment_notifications_payment_invoice_school_fk'),
    ('fee_payment_notifications_recipient_user_id_fkey'),
    ('fee_payment_notifications_school_id_fkey'),
    ('fee_payments_invoice_school_fk'),
    ('fee_payments_school_id_fkey'),
    ('fee_payments_student_school_fk'),
    ('fee_payments_submitted_by_fkey'),
    ('fee_payments_verified_by_fkey'),
    ('fee_provider_checkout_sessions_invoice_school_fk'),
    ('fee_provider_checkout_sessions_payment_school_fk'),
    ('fee_provider_webhook_events_payment_school_fk'),
    ('fee_provider_webhook_events_school_fk'),
    ('fee_receipts_payment_invoice_school_fk'),
    ('fee_receipts_payment_school_fk'),
    ('fee_receipts_school_id_fkey'),
    ('fee_refunds_approved_by_fkey'),
    ('fee_refunds_payment_invoice_school_fk'),
    ('fee_refunds_requested_by_fkey'),
    ('fee_refunds_school_id_fkey'),
    ('fee_school_settings_school_id_fkey'),
    ('fee_school_settings_updated_by_fkey'),
    ('fee_structure_lines_category_school_fk'),
    ('fee_structure_lines_school_id_fkey'),
    ('fee_structure_lines_structure_school_fk'),
    ('fee_structures_class_school_fk'),
    ('fee_structures_created_by_fkey'),
    ('fee_structures_published_by_fkey'),
    ('fee_structures_school_id_fkey'),
    ('fee_structures_session_school_fk'),
    ('fee_structures_term_school_fk'),
    ('library_authors_created_by_user_id_fkey'),
    ('library_authors_school_id_fkey'),
    ('library_book_copies_book_school_fk'),
    ('library_book_copies_created_by_user_id_fkey'),
    ('library_books_author_school_fk'),
    ('library_books_category_school_fk'),
    ('library_books_created_by_user_id_fkey'),
    ('library_books_publisher_school_fk'),
    ('library_books_school_id_fkey'),
    ('library_categories_created_by_user_id_fkey'),
    ('library_categories_school_id_fkey'),
    ('library_copy_status_history_changed_by_user_id_fkey'),
    ('library_copy_status_history_copy_school_fk'),
    ('library_copy_status_history_loan_school_fk'),
    ('library_loans_book_school_fk'),
    ('library_loans_borrower_user_id_fkey'),
    ('library_loans_copy_book_school_fk'),
    ('library_loans_issued_by_user_id_fkey'),
    ('library_loans_returned_by_user_id_fkey'),
    ('library_loans_student_school_fk'),
    ('library_publishers_created_by_user_id_fkey'),
    ('library_publishers_school_id_fkey'),
    ('library_renewals_loan_school_fk'),
    ('library_renewals_renewed_by_user_id_fkey'),
    ('library_settings_school_id_fkey'),
    ('library_settings_updated_by_user_id_fkey'),
    ('library_staff_assigned_by_user_id_fkey'),
    ('library_staff_school_id_fkey'),
    ('library_staff_user_id_fkey'),
    ('maintenance_request_status_history_actor_user_id_fkey'),
    ('maintenance_request_status_history_request_school_fk'),
    ('maintenance_requests_asset_school_fk'),
    ('maintenance_requests_assigned_to_user_id_fkey'),
    ('maintenance_requests_category_school_fk'),
    ('maintenance_requests_reported_by_user_id_fkey'),
    ('maintenance_requests_school_id_fkey'),
    ('nfc_card_history_actor_user_id_fkey'),
    ('nfc_card_history_card_school_fk'),
    ('nfc_card_history_nfc_card_id_fkey'),
    ('nfc_card_history_replaced_by_card_id_fkey'),
    ('nfc_card_history_school_id_fkey'),
    ('nfc_card_history_student_id_fkey'),
    ('nfc_card_history_student_school_fk'),
    ('nfc_cards_last_device_school_fk'),
    ('nfc_cards_replaced_by_id_fk'),
    ('nfc_cards_replaced_by_school_fk'),
    ('nfc_cards_student_school_fk'),
    ('operational_task_status_history_actor_user_id_fkey'),
    ('operational_task_status_history_task_school_fk'),
    ('operational_tasks_assigned_to_user_id_fkey'),
    ('operational_tasks_category_school_fk'),
    ('operational_tasks_created_by_user_id_fkey'),
    ('operational_tasks_school_id_fkey'),
    ('platform_devices_class_school_fk'),
    ('school_asset_history_actor_user_id_fkey'),
    ('school_asset_history_asset_school_fk'),
    ('school_asset_history_assigned_to_after_user_id_fkey'),
    ('school_asset_history_assigned_to_before_user_id_fkey'),
    ('school_assets_assigned_to_user_id_fkey'),
    ('school_assets_category_school_fk'),
    ('school_assets_created_by_user_id_fkey'),
    ('school_assets_school_id_fkey'),
    ('school_facilities_created_by_user_id_fkey'),
    ('school_facilities_school_id_fkey'),
    ('school_operation_categories_created_by_user_id_fkey'),
    ('school_operation_categories_school_id_fkey'),
    ('school_operations_settings_school_id_fkey'),
    ('school_operations_settings_updated_by_user_id_fkey'),
    ('student_identification_policies_created_by_fkey'),
    ('student_identification_policies_school_id_fkey'),
    ('student_identification_policies_student_id_fkey'),
    ('student_identification_policies_student_school_fk')
), found AS (
 SELECT c.conname,c.convalidated,c.conrelid
 FROM pg_catalog.pg_constraint c
 JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
 WHERE c.contype='f' AND n.nspname='public'
)
SELECT (SELECT count(*) FROM expected_fk) AS expected_new_fk_count,
       (SELECT count(*) FROM expected_fk e JOIN found f ON f.conname=e.constraint_name) AS expected_new_fks_present,
       (SELECT count(*) FROM expected_fk e JOIN found f ON f.conname=e.constraint_name WHERE f.convalidated) AS expected_new_fks_validated,
       (SELECT array_agg(e.constraint_name ORDER BY e.constraint_name)
          FROM expected_fk e LEFT JOIN found f ON f.conname=e.constraint_name WHERE f.conname IS NULL) AS missing_fk_names,
       (SELECT array_agg(e.constraint_name ORDER BY e.constraint_name)
          FROM expected_fk e JOIN found f ON f.conname=e.constraint_name WHERE NOT f.convalidated) AS unvalidated_fk_names;

-- M4. Full protection-definition attributes and trigger definition details.
SELECT p.proname,n.nspname AS function_schema,p.pronargs,
       p.prorettype::regtype AS return_type,l.lanname AS language,
       p.prokind,p.prosrc,p.prosecdef,p.provolatile,p.proparallel,
       p.proisstrict,p.proleakproof,p.proconfig
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
JOIN pg_catalog.pg_language l ON l.oid=p.prolang
WHERE n.nspname='public' AND p.proname IN
 ('prevent_device_school_binding_mutation','protect_fee_payment_verification_metadata','prevent_operations_history_mutation')
ORDER BY p.proname;
SELECT n.nspname AS table_schema,c.relname AS table_name,t.tgname,t.tgtype,
       cardinality(t.tgattr::smallint[]) AS update_column_count,t.tgqual,t.tgenabled,
       t.tgnargs,t.tgargs,t.tgisinternal,
       pn.nspname AS function_schema,p.proname AS function_name
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
WHERE n.nspname='public' AND t.tgname IN
 ('device_school_bindings_append_only','device_school_bindings_no_truncate',
  'fee_payments_verification_metadata_immutable','school_asset_history_append_only',
  'maintenance_request_status_history_append_only','operational_task_status_history_append_only')
ORDER BY t.tgname;

-- M5. Guardian link postflight, ID-only; repeatable run leaves no eligible
-- missing pair. The saved initial preflight had four unique candidates.
SELECT pg_catalog.query_to_xml($q$
WITH c AS (
 SELECT st.id AS student_id,st.school_id,p.id AS parent_id,count(*) OVER(PARTITION BY st.id) AS n
 FROM public.students st JOIN public.parents p ON p.school_id=st.school_id
  AND lower(btrim(p.name))=lower(btrim(st.parent_name))
  AND regexp_replace(p.phone,'\D','','g')=regexp_replace(st.parent_phone,'\D','','g')
 WHERE nullif(btrim(st.parent_name),'') IS NOT NULL AND nullif(btrim(p.name),'') IS NOT NULL
  AND nullif(regexp_replace(st.parent_phone,'\D','','g'),'') IS NOT NULL AND nullif(regexp_replace(p.phone,'\D','','g'),'') IS NOT NULL
)
SELECT r.parent_id,r.student_id,p.school_id,r.relationship_type,r.is_primary_guardian,r.is_emergency_contact,r.contact_priority,r.status
FROM public.parent_student_relationships r JOIN public.parents p ON p.id=r.parent_id
JOIN c ON c.parent_id=r.parent_id AND c.student_id=r.student_id AND c.school_id=p.school_id AND c.n=1
ORDER BY p.school_id,r.student_id
$q$,false,false,'') AS uniquely_matched_guardian_relationships;

SELECT pg_catalog.query_to_xml($q$
WITH c AS (
 SELECT st.id AS student_id,st.school_id,p.id AS parent_id,count(*) OVER(PARTITION BY st.id) AS n
 FROM public.students st JOIN public.parents p ON p.school_id=st.school_id
  AND lower(btrim(p.name))=lower(btrim(st.parent_name))
  AND regexp_replace(p.phone,'\D','','g')=regexp_replace(st.parent_phone,'\D','','g')
 WHERE nullif(btrim(st.parent_name),'') IS NOT NULL AND nullif(btrim(p.name),'') IS NOT NULL
   AND nullif(regexp_replace(st.parent_phone,'\D','','g'),'') IS NOT NULL AND nullif(regexp_replace(p.phone,'\D','','g'),'') IS NOT NULL
)
SELECT count(*) AS remaining_uniquely_matched_missing_links
FROM c
WHERE c.n=1 AND NOT EXISTS (
 SELECT 1 FROM public.parent_student_relationships r
 WHERE r.parent_id=c.parent_id AND r.student_id=c.student_id
)
$q$,false,false,'') AS remaining_guardian_backfill_candidates;

-- M6. LEGACY session resulting relationships and exact source date contract.
SELECT school_id,id AS academic_session_id,name,start_date,end_date,status,is_current
FROM public.academic_sessions WHERE name='LEGACY' ORDER BY school_id;

-- M7. Student class-history results (IDs and exact mapped fields only).
SELECT a.school_id,a.student_id,a.academic_session_id,a.school_class_id,a.section,
       a.status,a.is_current,a.start_date,a.academic_term_id,a.end_date
FROM public.student_class_assignments a
JOIN public.academic_sessions s ON s.id=a.academic_session_id AND s.school_id=a.school_id AND s.name='LEGACY'
ORDER BY a.school_id,a.student_id;

-- M8. Commission seed integrity; no mutation.
SELECT count(*) FILTER (WHERE status='ACTIVE' AND term IS NULL) AS active_null_term_rules,
       count(*) FILTER (WHERE status='ACTIVE' AND term IS NULL AND name='Default partner referral'
         AND currency='NGN' AND calculation_basis='PER_ELIGIBLE_STUDENT_PER_TERM'
         AND partner_rate=100 AND allocation_total=5000 AND partner_amount=100
         AND school_amount=2000 AND edupulse_amount=2900) AS exact_default_seed_rules
FROM public.commission_rules;

-- M9. Device-school binding integrity: no current-owner pair missing.
SELECT (SELECT count(*) FROM public.platform_devices) AS device_count,
       (SELECT count(*) FROM public.device_school_bindings) AS binding_count,
       (SELECT count(*) FROM public.platform_devices d WHERE d.school_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.device_school_bindings b WHERE b.device_id=d.id AND b.school_id=d.school_id)) AS current_owner_pairs_missing;

-- M10. Finance receipt metadata integrity; absent source/target is a safe no-op.
SELECT CASE WHEN pg_catalog.to_regclass('public.fee_receipts') IS NULL OR pg_catalog.to_regclass('public.fee_payments') IS NULL
            THEN 'FINANCE_SOURCE_ABSENT_OR_NOOP'
            ELSE pg_catalog.query_to_xml($q$
SELECT count(*) AS receipt_rows,
       count(*) FILTER (WHERE r.snapshot IS NULL OR jsonb_typeof(r.snapshot) IS DISTINCT FROM 'object') AS invalid_snapshot_shapes,
       count(*) FILTER (WHERE p.id IS NULL OR p.school_id IS DISTINCT FROM r.school_id OR p.invoice_id IS DISTINCT FROM r.invoice_id) AS receipt_payment_mismatches,
       count(*) FILTER (WHERE jsonb_typeof(r.snapshot->'invoiceId') IS DISTINCT FROM 'number'
          OR r.snapshot->>'invoiceId' IS DISTINCT FROM r.invoice_id::text
          OR jsonb_typeof(r.snapshot->'schoolId') IS DISTINCT FROM 'number'
          OR r.snapshot->>'schoolId' IS DISTINCT FROM r.school_id::text) AS snapshot_metadata_mismatches
FROM public.fee_receipts r LEFT JOIN public.fee_payments p ON p.id=r.payment_id
$q$,false,false,'')::text
       END AS finance_receipt_postflight;

-- M11. Final device-status supported CHECK and unsupported value count.
SELECT c.conname,pg_catalog.pg_get_constraintdef(c.oid) AS definition,c.convalidated
FROM pg_catalog.pg_constraint c
WHERE c.conrelid=pg_catalog.to_regclass('public.platform_devices')
  AND c.contype='c'
  AND (c.conname='platform_devices_status_supported_check' OR pg_catalog.pg_get_constraintdef(c.oid) ILIKE '%status%')
ORDER BY c.conname;
SELECT pg_catalog.query_to_xml($q$
SELECT count(*) AS unsupported_device_status_count
FROM public.platform_devices
WHERE status NOT IN ('ACTIVE','INACTIVE','MAINTENANCE','SUSPENDED','UNASSIGNED')
$q$,false,false,'') AS unsupported_device_statuses;
