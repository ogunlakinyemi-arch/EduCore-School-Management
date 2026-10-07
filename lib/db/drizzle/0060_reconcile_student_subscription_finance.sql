-- 0060: Canonical Student Finance reconciliation, not a data repair.
-- Sources: 0036, the checked-in Finance schema, and the Stage 2F-4/2F-5 catalog.
-- Deliberately NOT registered in meta/_journal.json during the source-only build.
-- One atomic top-level statement: an exception rolls back every DDL branch.
-- Reuse qualified keys/indexes by catalog semantics, not by name alone.
-- Never drop tables/indexes/sequences, rewrite columns, or mutate financial rows.
-- The ONLY constraint replacement permitted below is an otherwise identical,
-- immediate MATCH SIMPLE FK with DELETE NO ACTION, strengthened to RESTRICT.
-- Unknown shapes/expressions/functions fail closed; there is no repair fallback.

DO $finance_0060$
DECLARE
  spec record;
  col record;
  existing record;
  candidate record;
  current_table_name text;
  table_oid regclass;
  target_oid regclass;
  index_oid regclass;
  function_oid oid;
  column_numbers smallint[];
  target_numbers smallint[];
  column_names text[];
  key_options integer[];
  parts text[];
  ddl text;
  expected_default text;
  serial_sequence regclass;
  table_definition text;
  parent_contract constant jsonb := $parents$[
    {"table_name":"subscriptions","columns":["id","school_id","student_id"],"name":"subscriptions_id_school_student_uq"},
    {"table_name":"academic_sessions","columns":["id","school_id"],"name":"academic_sessions_id_school_tenant_key"},
    {"table_name":"academic_terms","columns":["id","school_id"],"name":"academic_terms_id_school_tenant_key"},
    {"table_name":"students","columns":["id","school_id"],"name":"students_id_school_tenant_key"},
    {"table_name":"school_partner_attributions","columns":["id","partner_profile_id"],"name":"school_partner_attributions_id_partner_uq"}
  ]$parents$::jsonb;
  column_contract constant jsonb := $columns$[
    {"table_name":"student_subscription_payments","name":"id","type":"integer","not_null":true,"serial":true},
    {"table_name":"student_subscription_payments","name":"subscription_id","type":"integer","not_null":true},
    {"table_name":"student_subscription_payments","name":"school_id","type":"integer","not_null":true},
    {"table_name":"student_subscription_payments","name":"student_id","type":"integer","not_null":true},
    {"table_name":"student_subscription_payments","name":"academic_session_id","type":"integer","not_null":true},
    {"table_name":"student_subscription_payments","name":"academic_term_id","type":"integer","not_null":true},
    {"table_name":"student_subscription_payments","name":"payer_user_id","type":"integer","not_null":true},
    {"table_name":"student_subscription_payments","name":"provider","type":"text","not_null":true,"default":"'FLUTTERWAVE'::text"},
    {"table_name":"student_subscription_payments","name":"provider_mode","type":"text","not_null":true,"default":"'SANDBOX'::text"},
    {"table_name":"student_subscription_payments","name":"reference","type":"text","not_null":true},
    {"table_name":"student_subscription_payments","name":"idempotency_key","type":"text","not_null":true},
    {"table_name":"student_subscription_payments","name":"gross_amount_minor","type":"integer","not_null":true,"default":"500000"},
    {"table_name":"student_subscription_payments","name":"provider_fee_minor","type":"integer","not_null":false},
    {"table_name":"student_subscription_payments","name":"settlement_amount_minor","type":"integer","not_null":false},
    {"table_name":"student_subscription_payments","name":"currency","type":"text","not_null":true,"default":"'NGN'::text"},
    {"table_name":"student_subscription_payments","name":"status","type":"text","not_null":true,"default":"'PENDING'::text"},
    {"table_name":"student_subscription_payments","name":"settlement_status","type":"text","not_null":true,"default":"'PENDING'::text"},
    {"table_name":"student_subscription_payments","name":"reconciliation_status","type":"text","not_null":true,"default":"'PENDING'::text"},
    {"table_name":"student_subscription_payments","name":"checkout_url","type":"text","not_null":false},
    {"table_name":"student_subscription_payments","name":"provider_transaction_id","type":"text","not_null":false},
    {"table_name":"student_subscription_payments","name":"provider_paid_at","type":"timestamp with time zone","not_null":false},
    {"table_name":"student_subscription_payments","name":"paid_at","type":"timestamp with time zone","not_null":false},
    {"table_name":"student_subscription_payments","name":"failure_code","type":"text","not_null":false},
    {"table_name":"student_subscription_payments","name":"receipt_snapshot","type":"jsonb","not_null":false},
    {"table_name":"student_subscription_payments","name":"created_at","type":"timestamp with time zone","not_null":true,"default":"now()"},
    {"table_name":"student_subscription_payments","name":"updated_at","type":"timestamp with time zone","not_null":true,"default":"now()"},
    {"table_name":"student_subscription_allocations","name":"id","type":"integer","not_null":true,"serial":true},
    {"table_name":"student_subscription_allocations","name":"idempotency_key","type":"text","not_null":true},
    {"table_name":"student_subscription_allocations","name":"entry_type","type":"text","not_null":true,"default":"'CREDIT'::text"},
    {"table_name":"student_subscription_allocations","name":"recipient_type","type":"text","not_null":true},
    {"table_name":"student_subscription_allocations","name":"recipient_id","type":"integer","not_null":false},
    {"table_name":"student_subscription_allocations","name":"school_id","type":"integer","not_null":true},
    {"table_name":"student_subscription_allocations","name":"student_id","type":"integer","not_null":true},
    {"table_name":"student_subscription_allocations","name":"payer_user_id","type":"integer","not_null":true},
    {"table_name":"student_subscription_allocations","name":"academic_session_id","type":"integer","not_null":true},
    {"table_name":"student_subscription_allocations","name":"academic_term_id","type":"integer","not_null":true},
    {"table_name":"student_subscription_allocations","name":"subscription_id","type":"integer","not_null":true},
    {"table_name":"student_subscription_allocations","name":"payment_id","type":"integer","not_null":true},
    {"table_name":"student_subscription_allocations","name":"attribution_id","type":"integer","not_null":false},
    {"table_name":"student_subscription_allocations","name":"commission_rule_id","type":"integer","not_null":false},
    {"table_name":"student_subscription_allocations","name":"amount_minor","type":"integer","not_null":true},
    {"table_name":"student_subscription_allocations","name":"currency","type":"text","not_null":true,"default":"'NGN'::text"},
    {"table_name":"student_subscription_allocations","name":"created_at","type":"timestamp with time zone","not_null":true,"default":"now()"}
  ]$columns$::jsonb;
BEGIN
  -- Local search path only; restored automatically at transaction end.
  PERFORM pg_catalog.set_config('search_path', 'pg_catalog, public', true);
  -- Lock existing Finance before its parents, matching the finalizer's order.
  -- An already-running finalizer can finish before we take any parent lock.
  FOREACH current_table_name IN ARRAY ARRAY['student_subscription_payments', 'student_subscription_allocations']
  LOOP
    table_oid := to_regclass(format('public.%I', current_table_name));
    IF table_oid IS NOT NULL THEN
      EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', table_oid);
    END IF;
  END LOOP;

  -- 1. Parent keys first. Key order is immaterial for parent uniqueness:
  -- compare the exact key-column set, ignoring INCLUDE columns but not extra keys.
  FOR spec IN SELECT * FROM jsonb_to_recordset(parent_contract)
    AS p(table_name text, columns text[], name text)
  LOOP
    table_oid := to_regclass(format('public.%I', spec.table_name));
    IF table_oid IS NULL THEN
      RAISE EXCEPTION '0060: missing prerequisite table public.%', spec.table_name;
    END IF;
    EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE', table_oid);
    column_numbers := ARRAY(
      SELECT a.attnum FROM unnest(spec.columns) WITH ORDINALITY AS wanted(name, pos)
      JOIN pg_attribute a ON a.attrelid = table_oid AND a.attname = wanted.name
      WHERE NOT a.attisdropped AND a.attnum > 0 ORDER BY wanted.pos
    );
    IF cardinality(column_numbers) <> cardinality(spec.columns) THEN
      RAISE EXCEPTION '0060: missing prerequisite columns on %', table_oid;
    END IF;
    SELECT i.indexrelid INTO index_oid FROM pg_index i
    WHERE i.indrelid = table_oid AND i.indisunique AND i.indimmediate
      AND i.indisvalid AND i.indisready AND i.indislive
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indnkeyatts = cardinality(column_numbers)
      AND ARRAY(SELECT k FROM unnest(i.indkey) WITH ORDINALITY AS keys(k, pos)
                WHERE pos <= i.indnkeyatts ORDER BY k)
          = ARRAY(SELECT k FROM unnest(column_numbers) AS keys(k) ORDER BY k)
    ORDER BY i.indexrelid LIMIT 1;
    IF NOT FOUND THEN
      IF to_regclass(format('public.%I', spec.name)) IS NOT NULL THEN
        RAISE EXCEPTION '0060: prerequisite index name occupied by a non-qualifying object: %', spec.name;
      END IF;
      SELECT string_agg(format('%I', n), ', ') INTO ddl FROM unnest(spec.columns) AS cols(n);
      EXECUTE format('CREATE UNIQUE INDEX %I ON %s (%s)', spec.name, table_oid, ddl);
    END IF;
  END LOOP;

  -- 2. Complete payment ownership BEFORE creating allocation foreign keys.
  FOREACH current_table_name IN ARRAY ARRAY['student_subscription_payments', 'student_subscription_allocations']
  LOOP
    table_oid := to_regclass(format('public.%I', current_table_name));
    IF table_oid IS NULL THEN
      -- Create columns only. PKs/UNIQUEs, then CHECKs/FKs, then indexes follow.
      SELECT string_agg(
        format('%I %s%s%s', x.name,
          CASE WHEN x.serial THEN 'serial' ELSE x.type END,
          CASE WHEN x.not_null THEN ' NOT NULL' ELSE '' END,
          CASE WHEN x."default" IS NULL THEN '' ELSE ' DEFAULT ' || x."default" END),
        ', ' ORDER BY x.pos
      ) INTO table_definition
      FROM (
        SELECT c.*, j.pos FROM jsonb_array_elements(column_contract) WITH ORDINALITY AS j(value, pos)
        CROSS JOIN LATERAL jsonb_to_record(j.value)
          AS c(table_name text, name text, type text, not_null boolean, serial boolean, "default" text)
      ) x WHERE x.table_name = current_table_name;
      EXECUTE format('CREATE TABLE public.%I (%s)', current_table_name, table_definition);
      table_oid := to_regclass(format('public.%I', current_table_name));
    END IF;
    IF (SELECT relkind FROM pg_class WHERE oid = table_oid) <> 'r'
      OR EXISTS (SELECT FROM pg_inherits WHERE inhrelid = table_oid OR inhparent = table_oid) THEN
      RAISE EXCEPTION '0060: Finance table is not an ordinary, non-inherited table: %', table_oid;
    END IF;
    -- Prevent writer interleaving, including across the narrow FK replacement.
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', table_oid);
    SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO column_names
      FROM pg_attribute a WHERE a.attrelid = table_oid AND a.attnum > 0 AND NOT a.attisdropped;
    IF column_names IS DISTINCT FROM ARRAY(
      SELECT x.name FROM jsonb_array_elements(column_contract) WITH ORDINALITY AS j(value, pos)
      CROSS JOIN LATERAL jsonb_to_record(j.value) AS x(table_name text, name text)
      WHERE x.table_name = current_table_name ORDER BY j.pos
    ) THEN
      RAISE EXCEPTION '0060: unexpected Finance column inventory on %', table_oid;
    END IF;
    FOR col IN SELECT * FROM jsonb_to_recordset(column_contract)
      AS c(table_name text, name text, type text, not_null boolean, serial boolean, "default" text)
      WHERE c.table_name = current_table_name
    LOOP
      SELECT a.*, format_type(a.atttypid, a.atttypmod) AS formatted_type,
        pg_get_expr(d.adbin, d.adrelid) AS default_expression INTO existing
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = table_oid AND a.attname = col.name AND NOT a.attisdropped;
      expected_default := col."default";
      IF col.serial THEN
        serial_sequence := pg_get_serial_sequence(table_oid::text, col.name)::regclass;
        IF serial_sequence IS NULL OR NOT EXISTS (
          SELECT FROM pg_depend d JOIN pg_class seq ON seq.oid = d.objid AND seq.relkind = 'S'
          WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass
            AND d.objid = serial_sequence AND d.refobjid = table_oid
            AND d.refobjsubid = existing.attnum AND d.deptype = 'a'
        ) THEN
          RAISE EXCEPTION '0060: missing serial sequence ownership on %.%', table_oid, col.name;
        END IF;
        expected_default := format('nextval(%L::regclass)', serial_sequence::text);
      END IF;
      IF existing.formatted_type IS DISTINCT FROM col.type
        OR existing.attnotnull IS DISTINCT FROM col.not_null
        OR existing.attidentity <> '' OR existing.attgenerated <> ''
        OR existing.default_expression IS DISTINCT FROM expected_default THEN
        RAISE EXCEPTION '0060: unexpected type/nullability/default/identity on %.%', table_oid, col.name;
      END IF;
    END LOOP;

    -- 3. Constraint definitions are the PostgreSQL-16 canonical catalog from 2F-5.
    -- Compare FK vectors/actions, key vectors/immediacy, and deparsed CHECK trees.
    -- PostgreSQL's deparser normalizes expression formatting; preserve its quoted
    -- literals exactly. Reject other trees rather than guess equivalence.
    FOR spec IN
      SELECT * FROM (VALUES
        ('student_subscription_payments','student_subscription_payments_pkey','p','PRIMARY KEY (id)'),
        ('student_subscription_payments','student_subscription_payments_id_owner_term_uq','u','UNIQUE (id, subscription_id, school_id, student_id, academic_session_id, academic_term_id)'),
        ('student_subscription_payments','student_subscription_payments_provider_ck','c','CHECK ((provider = ''FLUTTERWAVE''::text))'),
        ('student_subscription_payments','student_subscription_payments_provider_mode_ck','c','CHECK ((provider_mode = ''SANDBOX''::text))'),
        ('student_subscription_payments','student_subscription_payments_reference_ck','c','CHECK ((reference ~ ''^[A-Za-z0-9_-]{8,100}$''::text))'),
        ('student_subscription_payments','student_subscription_payments_gross_ck','c','CHECK (((gross_amount_minor = 500000) AND (currency = ''NGN''::text) AND ((provider_fee_minor IS NULL) OR (provider_fee_minor >= 0)) AND ((settlement_amount_minor IS NULL) OR ((settlement_amount_minor >= 0) AND (settlement_amount_minor <= gross_amount_minor)))))'),
        ('student_subscription_payments','student_subscription_payments_status_ck','c','CHECK ((status = ANY (ARRAY[''PENDING''::text, ''PAID''::text, ''FAILED''::text, ''RECONCILIATION_REQUIRED''::text])))'),
        ('student_subscription_payments','student_subscription_payments_settlement_ck','c','CHECK ((settlement_status = ANY (ARRAY[''PENDING''::text, ''RECONCILED''::text, ''RECONCILIATION_REQUIRED''::text, ''NOT_APPLICABLE''::text])))'),
        ('student_subscription_payments','student_subscription_payments_reconciliation_ck','c','CHECK ((reconciliation_status = ANY (ARRAY[''PENDING''::text, ''RECONCILED''::text, ''RECONCILIATION_REQUIRED''::text, ''NOT_APPLICABLE''::text])))'),
        ('student_subscription_payments','student_subscription_payments_payer_user_id_fkey','f','FOREIGN KEY (payer_user_id) REFERENCES app_users(id) ON DELETE RESTRICT'),
        ('student_subscription_payments','student_subscription_payments_subscription_owner_fk','f','FOREIGN KEY (subscription_id, school_id, student_id) REFERENCES subscriptions(id, school_id, student_id) ON DELETE RESTRICT'),
        ('student_subscription_payments','student_subscription_payments_session_school_fk','f','FOREIGN KEY (academic_session_id, school_id) REFERENCES academic_sessions(id, school_id) ON DELETE RESTRICT'),
        ('student_subscription_payments','student_subscription_payments_term_school_fk','f','FOREIGN KEY (academic_term_id, school_id) REFERENCES academic_terms(id, school_id) ON DELETE RESTRICT'),
        ('student_subscription_allocations','student_subscription_allocations_pkey','p','PRIMARY KEY (id)'),
        ('student_subscription_allocations','student_subscription_allocations_id_payment_entry_recipient_uq','u','UNIQUE (id, payment_id, entry_type, recipient_type)'),
        ('student_subscription_allocations','student_subscription_allocations_recipient_ck','c','CHECK ((recipient_type = ANY (ARRAY[''SCHOOL''::text, ''PLATFORM''::text, ''PARTNER''::text, ''PLATFORM_PROVIDER_FEE''::text])))'),
        ('student_subscription_allocations','student_subscription_allocations_entry_ck','c','CHECK ((entry_type = ANY (ARRAY[''CREDIT''::text, ''REVERSAL''::text, ''EXPENSE''::text])))'),
        ('student_subscription_allocations','student_subscription_allocations_amount_ck','c','CHECK (((amount_minor > 0) AND (currency = ''NGN''::text) AND (((entry_type = ''CREDIT''::text) AND (recipient_type = ANY (ARRAY[''SCHOOL''::text, ''PLATFORM''::text, ''PARTNER''::text]))) OR ((entry_type = ''REVERSAL''::text) AND (recipient_type = ANY (ARRAY[''SCHOOL''::text, ''PLATFORM''::text, ''PARTNER''::text]))) OR ((entry_type = ''EXPENSE''::text) AND (recipient_type = ''PLATFORM_PROVIDER_FEE''::text)))))'),
        ('student_subscription_allocations','student_subscription_allocations_partner_ck','c','CHECK ((((recipient_type = ''PARTNER''::text) AND (recipient_id IS NOT NULL) AND (attribution_id IS NOT NULL) AND (commission_rule_id IS NOT NULL)) OR ((recipient_type <> ''PARTNER''::text) AND (recipient_id IS NULL))))'),
        ('student_subscription_allocations','student_subscription_allocations_school_id_fkey','f','FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT'),
        ('student_subscription_allocations','student_subscription_allocations_student_id_fkey','f','FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT'),
        ('student_subscription_allocations','student_subscription_allocations_payer_user_id_fkey','f','FOREIGN KEY (payer_user_id) REFERENCES app_users(id) ON DELETE RESTRICT'),
        ('student_subscription_allocations','student_subscription_allocations_attribution_id_fkey','f','FOREIGN KEY (attribution_id) REFERENCES school_partner_attributions(id) ON DELETE RESTRICT'),
        ('student_subscription_allocations','student_subscription_allocations_commission_rule_id_fkey','f','FOREIGN KEY (commission_rule_id) REFERENCES commission_rules(id) ON DELETE RESTRICT'),
        ('student_subscription_allocations','student_subscription_allocations_payment_owner_term_fk','f','FOREIGN KEY (payment_id, subscription_id, school_id, student_id, academic_session_id, academic_term_id) REFERENCES student_subscription_payments(id, subscription_id, school_id, student_id, academic_session_id, academic_term_id) ON DELETE RESTRICT'),
        ('student_subscription_allocations','student_subscription_allocations_student_school_fk','f','FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT'),
        ('student_subscription_allocations','student_subscription_allocations_session_school_fk','f','FOREIGN KEY (academic_session_id, school_id) REFERENCES academic_sessions(id, school_id) ON DELETE RESTRICT'),
        ('student_subscription_allocations','student_subscription_allocations_term_school_fk','f','FOREIGN KEY (academic_term_id, school_id) REFERENCES academic_terms(id, school_id) ON DELETE RESTRICT'),
        ('student_subscription_allocations','student_subscription_allocations_attribution_partner_fk','f','FOREIGN KEY (attribution_id, recipient_id) REFERENCES school_partner_attributions(id, partner_profile_id) ON DELETE RESTRICT')
      ) AS c(table_name, name, kind, definition)
      WHERE c.table_name = current_table_name
      ORDER BY CASE kind WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'c' THEN 2 ELSE 3 END, name
    LOOP
      column_numbers := NULL;
      target_numbers := NULL;
      target_oid := NULL;
      IF spec.kind = 'f' THEN
        parts := regexp_match(spec.definition, '^FOREIGN KEY \(([^)]+)\) REFERENCES ([^(]+)\(([^)]+)\) ON DELETE RESTRICT$');
        column_names := string_to_array(replace(parts[1], ' ', ''), ',');
        target_oid := to_regclass(format('public.%I', parts[2]));
        IF target_oid IS NULL THEN
          RAISE EXCEPTION '0060: missing FK target for %', spec.name;
        END IF;
        target_numbers := ARRAY(
          SELECT a.attnum FROM unnest(string_to_array(replace(parts[3], ' ', ''), ','))
            WITH ORDINALITY AS names(n, pos)
          JOIN pg_attribute a ON a.attrelid = target_oid AND a.attname = names.n
          WHERE NOT a.attisdropped AND a.attnum > 0 ORDER BY names.pos
        );
        IF cardinality(target_numbers) <> cardinality(column_names) THEN
          RAISE EXCEPTION '0060: unexpected FK target columns for %', spec.name;
        END IF;
      ELSIF spec.kind IN ('p','u') THEN
        parts := regexp_match(spec.definition, '^(?:PRIMARY KEY|UNIQUE) \(([^)]+)\)$');
        column_names := string_to_array(replace(parts[1], ' ', ''), ',');
      END IF;
      IF spec.kind <> 'c' THEN
        column_numbers := ARRAY(
          SELECT a.attnum FROM unnest(column_names) WITH ORDINALITY AS names(n, pos)
          JOIN pg_attribute a ON a.attrelid = table_oid AND a.attname = names.n
          WHERE NOT a.attisdropped AND a.attnum > 0 ORDER BY names.pos
        );
      END IF;
      IF spec.kind = 'f' AND (
        (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = table_oid
          AND c.contype = 'f' AND c.conkey = column_numbers) > 1
        OR EXISTS (SELECT FROM pg_constraint c WHERE c.conrelid = table_oid
          AND c.contype = 'f' AND c.conkey = column_numbers
          AND (c.confrelid <> target_oid OR c.confkey <> target_numbers
            OR c.confmatchtype <> 's' OR c.confupdtype <> 'a'
            OR c.confdeltype NOT IN ('a','r') OR c.condeferrable OR c.condeferred))
      ) THEN
        RAISE EXCEPTION '0060: ambiguous or unsupported predecessor FK for %', spec.name;
      END IF;

      -- Inspect same-name objects as well as all semantic candidates. A wrong
      -- same-name definition must never be hidden by an equivalent differently
      -- named object. NO ACTION is the sole recognized FK-action predecessor.
      SELECT c.*, (
        c.contype::text = spec.kind AND NOT c.condeferrable AND NOT c.condeferred
        AND c.conislocal AND c.coninhcount = 0 AND (spec.kind <> 'c' OR NOT c.connoinherit)
        AND CASE
          WHEN spec.kind = 'f' THEN c.conkey = column_numbers AND c.confrelid = target_oid
            AND c.confkey = target_numbers AND c.confmatchtype = 's'
            AND c.confupdtype = 'a' AND c.confdeltype IN ('a','r')
          WHEN spec.kind IN ('p','u') THEN c.conkey = column_numbers
            AND EXISTS (SELECT FROM pg_index i WHERE i.indexrelid = c.conindid
              AND i.indisunique AND i.indimmediate AND i.indisvalid AND i.indisready AND i.indislive
              AND i.indpred IS NULL AND i.indexprs IS NULL)
          ELSE pg_get_constraintdef(c.oid, false) = spec.definition
        END
      ) AS equivalent INTO existing FROM pg_constraint c
      WHERE c.conrelid = table_oid AND c.conname = spec.name;
      IF FOUND AND existing.equivalent IS DISTINCT FROM true THEN
        RAISE EXCEPTION '0060: unexpected definition for constraint %', spec.name;
      END IF;
      SELECT c.* INTO candidate FROM pg_constraint c
      WHERE c.conrelid = table_oid AND c.contype::text = spec.kind
        AND NOT c.condeferrable AND NOT c.condeferred
        AND c.conislocal AND c.coninhcount = 0 AND (spec.kind <> 'c' OR NOT c.connoinherit)
        AND CASE
          WHEN spec.kind = 'f' THEN c.conkey = column_numbers AND c.confrelid = target_oid
            AND c.confkey = target_numbers AND c.confmatchtype = 's'
            AND c.confupdtype = 'a' AND c.confdeltype IN ('a','r')
          WHEN spec.kind IN ('p','u') THEN c.conkey = column_numbers
            AND EXISTS (SELECT FROM pg_index i WHERE i.indexrelid = c.conindid
              AND i.indisunique AND i.indimmediate AND i.indisvalid AND i.indisready AND i.indislive
              AND i.indpred IS NULL AND i.indexprs IS NULL)
          ELSE pg_get_constraintdef(c.oid, false) = spec.definition
        END
      ORDER BY (c.conname = spec.name) DESC, c.oid LIMIT 1;
      IF FOUND THEN
        IF candidate.conname <> spec.name THEN
          EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', table_oid, candidate.conname, spec.name);
        END IF;
        IF spec.kind = 'f' AND candidate.confdeltype = 'a' THEN
          -- No index is dropped; no UNIQUE key or dependent FK is replaced.
          -- ACCESS EXCLUSIVE lock and the atomic DO statement prevent a gap.
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', table_oid, spec.name);
          ddl := regexp_replace(spec.definition, 'REFERENCES ([^(]+)', 'REFERENCES public.\1');
          ddl := replace(ddl, ' ON DELETE RESTRICT', '')
            || ' MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE INITIALLY IMMEDIATE';
          EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', table_oid, spec.name, ddl);
        ELSIF NOT candidate.convalidated THEN
          EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', table_oid, spec.name);
        END IF;
      ELSIF spec.kind IN ('p','u') THEN
        -- Attach a suitable standalone UNIQUE index without rebuilding it.
        -- Changing constraint/index ownership retains its OID and dependent FKs.
        SELECT i.*, x.relname AS index_name INTO candidate
        FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid
          JOIN pg_am am ON am.oid = x.relam
        WHERE i.indrelid = table_oid AND i.indisunique AND i.indimmediate
          AND i.indisvalid AND i.indisready AND i.indislive
          AND i.indpred IS NULL AND i.indexprs IS NULL
          AND i.indnkeyatts = cardinality(column_numbers) AND i.indnatts = i.indnkeyatts
          AND ARRAY(SELECT k FROM unnest(i.indkey) AS keys(k)) = column_numbers
          AND am.amname = 'btree'
          AND NOT EXISTS (SELECT FROM unnest(i.indoption) AS opts(v) WHERE v <> 0)
          AND NOT EXISTS (SELECT FROM unnest(i.indclass) AS classes(v)
            JOIN pg_opclass op ON op.oid = v WHERE NOT op.opcdefault)
          AND NOT EXISTS (SELECT FROM pg_constraint c WHERE c.conindid = i.indexrelid AND c.contype IN ('p','u'))
        ORDER BY (x.relname = spec.name) DESC, i.indexrelid LIMIT 1;
        IF FOUND THEN
          IF to_regclass(format('public.%I', spec.name)) IS NOT NULL
             AND to_regclass(format('public.%I', spec.name)) <> candidate.indexrelid THEN
            RAISE EXCEPTION '0060: canonical key/index name collision: %', spec.name;
          END IF;
          EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s USING INDEX %I',
            table_oid, spec.name, CASE spec.kind WHEN 'p' THEN 'PRIMARY KEY' ELSE 'UNIQUE' END, candidate.index_name);
        ELSE
          -- A differently ordered/owned/ineligible equivalent key cannot be
          -- silently duplicated or destructively rebuilt: require review.
          IF EXISTS (
            SELECT FROM pg_index i WHERE i.indrelid = table_oid AND i.indisunique
              AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts = cardinality(column_numbers)
              AND ARRAY(SELECT k FROM unnest(i.indkey) WITH ORDINALITY AS keys(k, pos)
                        WHERE pos <= i.indnkeyatts ORDER BY k)
                  = ARRAY(SELECT k FROM unnest(column_numbers) AS keys(k) ORDER BY k)
          ) OR to_regclass(format('public.%I', spec.name)) IS NOT NULL THEN
            RAISE EXCEPTION '0060: existing key cannot safely be attached without duplication: %', spec.name;
          END IF;
          EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', table_oid, spec.name, spec.definition);
        END IF;
      ELSE
        ddl := spec.definition;
        IF spec.kind = 'f' THEN
          ddl := regexp_replace(ddl, 'REFERENCES ([^(]+)', 'REFERENCES public.\1');
          ddl := replace(ddl, ' ON DELETE RESTRICT', '')
            || ' MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE INITIALLY IMMEDIATE';
        END IF;
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', table_oid, spec.name, ddl);
      END IF;
    END LOOP;

    -- 4. Standalone index semantics: table, exact ordered keys, uniqueness,
    -- access method, ordering/null order, collation, default opclasses, predicate,
    -- validity/readiness/immediacy. Constraint-provided equivalents also qualify.
    FOR spec IN SELECT * FROM (VALUES
      ('student_subscription_payments','student_subscription_payments_reference_uq',true,ARRAY['reference'],ARRAY[0],NULL::text),
      ('student_subscription_payments','student_subscription_payments_provider_transaction_uq',true,ARRAY['provider','provider_transaction_id'],ARRAY[0,0],'(provider_transaction_id IS NOT NULL)'),
      ('student_subscription_payments','student_subscription_payments_subscription_idempotency_uq',true,ARRAY['subscription_id','idempotency_key'],ARRAY[0,0],NULL),
      ('student_subscription_payments','student_subscription_payments_one_open_attempt_uq',true,ARRAY['subscription_id'],ARRAY[0],'(status = ANY (ARRAY[''PENDING''::text, ''RECONCILIATION_REQUIRED''::text]))'),
      ('student_subscription_payments','student_subscription_payments_one_business_term_uq',true,ARRAY['school_id','student_id','academic_session_id','academic_term_id'],ARRAY[0,0,0,0],'((status = ANY (ARRAY[''PENDING''::text, ''RECONCILIATION_REQUIRED''::text, ''PAID''::text])) OR (reconciliation_status = ''RECONCILIATION_REQUIRED''::text))'),
      ('student_subscription_payments','student_subscription_payments_school_status_idx',false,ARRAY['school_id','status','created_at'],ARRAY[0,0,3],NULL),
      ('student_subscription_payments','student_subscription_payments_term_idx',false,ARRAY['school_id','academic_session_id','academic_term_id'],ARRAY[0,0,0],NULL),
      ('student_subscription_allocations','student_subscription_allocations_idempotency_uq',true,ARRAY['idempotency_key'],ARRAY[0],NULL),
      ('student_subscription_allocations','student_subscription_allocations_payment_credit_recipient_uq',true,ARRAY['payment_id','recipient_type'],ARRAY[0,0],'(entry_type = ''CREDIT''::text)'),
      ('student_subscription_allocations','student_subscription_allocations_payment_fee_expense_uq',true,ARRAY['payment_id'],ARRAY[0],'((entry_type = ''EXPENSE''::text) AND (recipient_type = ''PLATFORM_PROVIDER_FEE''::text))'),
      ('student_subscription_allocations','student_subscription_allocations_school_term_idx',false,ARRAY['school_id','academic_session_id','academic_term_id','created_at'],ARRAY[0,0,0,3],NULL),
      ('student_subscription_allocations','student_subscription_allocations_partner_idx',false,ARRAY['recipient_id','created_at'],ARRAY[0,3],'(recipient_type = ''PARTNER''::text)')
    ) AS indexes(table_name, name, is_unique, columns, options, predicate)
    WHERE indexes.table_name = current_table_name
    LOOP
      column_numbers := ARRAY(
        SELECT a.attnum FROM unnest(spec.columns) WITH ORDINALITY AS names(n, pos)
        JOIN pg_attribute a ON a.attrelid = table_oid AND a.attname = names.n ORDER BY names.pos
      );
      index_oid := NULL;
      FOR candidate IN
        SELECT i.*, x.relname AS index_name, am.amname FROM pg_index i
        JOIN pg_class x ON x.oid = i.indexrelid JOIN pg_am am ON am.oid = x.relam
        WHERE i.indrelid = table_oid ORDER BY (x.relname = spec.name) DESC, i.indexrelid
      LOOP
        key_options := ARRAY(SELECT v::integer FROM unnest(candidate.indoption) WITH ORDINALITY AS opts(v, pos)
          WHERE pos <= candidate.indnkeyatts ORDER BY pos);
        IF candidate.amname = 'btree' AND candidate.indisunique = spec.is_unique
          AND candidate.indisvalid AND candidate.indisready AND candidate.indislive AND candidate.indimmediate
          AND candidate.indexprs IS NULL AND candidate.indnkeyatts = cardinality(column_numbers)
          AND ARRAY(SELECT k FROM unnest(candidate.indkey) WITH ORDINALITY AS keys(k, pos)
                    WHERE pos <= candidate.indnkeyatts ORDER BY pos) = column_numbers
          AND key_options = spec.options
          AND NOT candidate.indnullsnotdistinct
          AND NOT EXISTS (SELECT FROM unnest(candidate.indclass) AS classes(v)
            JOIN pg_opclass op ON op.oid = v WHERE NOT op.opcdefault)
          AND ARRAY(SELECT v FROM unnest(candidate.indcollation) WITH ORDINALITY AS collations(v, pos)
                    WHERE pos <= candidate.indnkeyatts ORDER BY pos)
              = ARRAY(SELECT a.attcollation FROM unnest(column_numbers) WITH ORDINALITY AS keys(k, pos)
                    JOIN pg_attribute a ON a.attrelid = table_oid AND a.attnum = keys.k ORDER BY pos)
          AND pg_get_expr(candidate.indpred, table_oid, false) IS NOT DISTINCT FROM spec.predicate THEN
          index_oid := candidate.indexrelid;
          EXIT;
        ELSIF candidate.index_name = spec.name THEN
          RAISE EXCEPTION '0060: unexpected definition for index %', spec.name;
        END IF;
      END LOOP;
      IF index_oid IS NULL THEN
        IF to_regclass(format('public.%I', spec.name)) IS NOT NULL THEN
          RAISE EXCEPTION '0060: index name occupied by another object: %', spec.name;
        END IF;
        SELECT string_agg(format('%I%s', n,
          CASE WHEN spec.options[pos] = 3 THEN ' DESC NULLS FIRST' ELSE ' ASC NULLS LAST' END), ', ' ORDER BY pos)
          INTO ddl FROM unnest(spec.columns) WITH ORDINALITY AS names(n, pos);
        EXECUTE format('CREATE %sINDEX %I ON %s USING btree (%s)%s',
          CASE WHEN spec.is_unique THEN 'UNIQUE ' ELSE '' END, spec.name, table_oid, ddl,
          CASE WHEN spec.predicate IS NULL THEN '' ELSE ' WHERE ' || spec.predicate END);
      END IF;
    END LOOP;
  END LOOP;

  -- 5. Restore the historical trigger functions without overwriting unknown code.
  -- Exact body comparison (outer whitespace ignored) preserves quoted messages.
  FOR spec IN SELECT * FROM (VALUES
    ('protect_student_subscription_receipt_snapshot',
      'student_subscription_payments','student_subscription_payment_receipt_immutable',19,
      $receipt$
BEGIN
  IF OLD.receipt_snapshot IS NOT NULL
     AND NEW.receipt_snapshot IS DISTINCT FROM OLD.receipt_snapshot THEN
    RAISE EXCEPTION 'Student subscription receipt snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$receipt$),
    ('protect_student_subscription_allocations',
      'student_subscription_allocations','student_subscription_allocations_immutable',27,
      $allocations$
BEGIN
  RAISE EXCEPTION 'Student subscription allocations are immutable';
END;
$allocations$)
  ) AS protections(name, table_name, trigger_name, trigger_type, body)
  LOOP
    table_oid := to_regclass(format('public.%I', spec.table_name));
    SELECT p.*, l.lanname INTO existing FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public' AND p.proname = spec.name AND p.pronargs = 0;
    IF FOUND THEN
      IF existing.prorettype <> 'trigger'::regtype OR existing.lanname <> 'plpgsql'
        OR existing.prokind <> 'f' OR existing.provolatile <> 'v' OR existing.proparallel <> 'u'
        OR existing.prosecdef OR existing.proisstrict OR existing.proretset OR existing.proleakproof
        OR existing.proconfig IS NOT NULL OR btrim(existing.prosrc) <> btrim(spec.body) THEN
        RAISE EXCEPTION '0060: unexpected protection function definition: %', spec.name;
      END IF;
      function_oid := existing.oid;
    ELSE
      EXECUTE format('CREATE FUNCTION public.%I() RETURNS trigger LANGUAGE plpgsql AS %L', spec.name, spec.body);
      function_oid := to_regprocedure(format('public.%I()', spec.name))::oid;
    END IF;
    IF EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = spec.name AND p.pronargs <> 0) THEN
      RAISE EXCEPTION '0060: unexpected protection function overload: %', spec.name;
    END IF;

    SELECT t.*, (t.tgfoid = function_oid AND t.tgtype = spec.trigger_type
      AND t.tgenabled = 'O' AND NOT t.tgisinternal AND t.tgconstraint = 0
      AND t.tgnargs = 0 AND cardinality(t.tgattr::smallint[]) = 0
      AND t.tgqual IS NULL AND octet_length(t.tgargs) = 0) AS equivalent
      INTO existing FROM pg_trigger t WHERE t.tgrelid = table_oid AND t.tgname = spec.trigger_name;
    IF FOUND AND existing.equivalent IS DISTINCT FROM true THEN
      RAISE EXCEPTION '0060: unexpected protection trigger definition: %', spec.trigger_name;
    END IF;
    SELECT t.* INTO candidate FROM pg_trigger t WHERE t.tgrelid = table_oid
      AND t.tgfoid = function_oid AND t.tgtype = spec.trigger_type AND t.tgenabled = 'O'
      AND NOT t.tgisinternal AND t.tgconstraint = 0 AND t.tgnargs = 0
      AND cardinality(t.tgattr::smallint[]) = 0 AND t.tgqual IS NULL AND octet_length(t.tgargs) = 0
      ORDER BY (t.tgname = spec.trigger_name) DESC, t.oid LIMIT 1;
    IF FOUND THEN
      IF candidate.tgname <> spec.trigger_name THEN
        EXECUTE format('ALTER TRIGGER %I ON %s RENAME TO %I', candidate.tgname, table_oid, spec.trigger_name);
      END IF;
    ELSE
      EXECUTE format('CREATE TRIGGER %I BEFORE %s ON %s FOR EACH ROW EXECUTE FUNCTION public.%I()',
        spec.trigger_name, CASE WHEN spec.trigger_type = 19 THEN 'UPDATE' ELSE 'UPDATE OR DELETE' END,
        table_oid, spec.name);
    END IF;
    IF EXISTS (SELECT FROM pg_trigger t WHERE t.tgrelid = table_oid AND NOT t.tgisinternal
      AND t.tgname <> spec.trigger_name) THEN
      RAISE EXCEPTION '0060: unexpected additional Finance trigger on %', table_oid;
    END IF;
  END LOOP;
END;
$finance_0060$;
