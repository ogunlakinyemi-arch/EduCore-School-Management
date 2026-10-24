import { fileURLToPath } from "node:url";
import path from "node:path";
import { CANDIDATE_TABLES } from "./manifest.mjs";
import { preflightSql } from "./sql.mjs";

// SQL printer only: no environment reads, pg import, subprocess, connection or
// execution flag. Execution is a separate, explicitly approved local procedure.
export function rehearsalSql() {
  const candidates = CANDIDATE_TABLES.filter(name => name !== "schools").sort()
    .map(name => `CREATE TABLE public."${name}" (id integer PRIMARY KEY,
 school_id integer NOT NULL REFERENCES public.schools(id));`).join("\n");
  const capture = name => `CREATE TEMP TABLE ${name} AS\n${preflightSql("9,77,88,89,91,93,94,95")}`;
  return `-- FICTIONAL RELATIONSHIP/ROLLBACK REHEARSAL, NOT A PRODUCTION RESET.
-- psql variables must identify the private cluster CREATED by REHEARSAL.md.
\\set ON_ERROR_STOP on
SELECT current_database()='reset_rehearsal' AND current_user='rehearsal_admin'
 AND inet_server_addr() IS NULL AND current_setting('listen_addresses')=''
 AND current_setting('data_directory')=:'fixture_data'
 AND current_setting('unix_socket_directories')=:'fixture_socket'
 AND current_setting('port')='55483' AS isolated_target
\\gset
\\if :isolated_target
\\else
\\echo ISOLATION_GUARD_FAILED_NO_FIXTURE_CREATED
\\quit 3
\\endif
DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','_system') AND c.relkind IN ('r','p','S')) THEN
   RAISE EXCEPTION 'EMPTY_FRESH_DISPOSABLE_DATABASE_REQUIRED';
 END IF;
END $guard$;
CREATE SCHEMA _system;
CREATE TABLE _system.replit_database_migrations_v1 (id integer PRIMARY KEY, label text NOT NULL);
INSERT INTO _system.replit_database_migrations_v1 VALUES(1,'fictional fixture only; not an application migration');
CREATE TABLE public.schools(id serial PRIMARY KEY, status text NOT NULL DEFAULT 'active');
${candidates}
ALTER TABLE public.school_classes ADD UNIQUE(id,school_id);
CREATE TABLE public.app_users(id integer PRIMARY KEY, status text NOT NULL, clerk_user_id text NOT NULL);
CREATE TABLE public.school_memberships(id integer PRIMARY KEY,
 user_id integer NOT NULL REFERENCES public.app_users(id),
 school_id integer REFERENCES public.schools(id),role text NOT NULL,status text NOT NULL);
CREATE UNIQUE INDEX fixture_platform_membership_unique ON public.school_memberships(user_id,role)
 WHERE school_id IS NULL;
CREATE TABLE public.audit_logs(id integer PRIMARY KEY,school_id integer REFERENCES public.schools(id),event text);
CREATE TABLE public.subscriptions(id integer PRIMARY KEY,school_id integer NOT NULL REFERENCES public.schools(id));
CREATE TABLE public.fee_payments(id integer PRIMARY KEY,school_id integer NOT NULL REFERENCES public.schools(id));
CREATE TABLE public.fee_provider_webhook_events(id integer PRIMARY KEY,school_id integer REFERENCES public.schools(id));
CREATE TABLE public.platform_devices(id integer PRIMARY KEY,
 school_id integer REFERENCES public.schools(id),school_class_id integer REFERENCES public.school_classes(id),
 status text NOT NULL CHECK(status IN ('ACTIVE','UNASSIGNED','SUSPENDED')),
 configuration_status text NOT NULL,location text,
 FOREIGN KEY(school_class_id,school_id) REFERENCES public.school_classes(id,school_id));
CREATE TABLE public.device_credentials(id integer PRIMARY KEY,
 device_id integer NOT NULL REFERENCES public.platform_devices(id),
 school_id integer NOT NULL REFERENCES public.schools(id));
CREATE TABLE public.device_assignment_history(id integer PRIMARY KEY,
 device_id integer NOT NULL REFERENCES public.platform_devices(id),
 school_id integer NOT NULL REFERENCES public.schools(id));
CREATE TABLE public.device_school_bindings(
 device_id integer NOT NULL REFERENCES public.platform_devices(id),
 school_id integer NOT NULL REFERENCES public.schools(id),PRIMARY KEY(device_id,school_id));
INSERT INTO public.schools(id) VALUES(9),(77),(88),(89),(91),(93),(94),(95);
INSERT INTO public.app_users VALUES(1,'ACTIVE','fictional-owner-subject'),(2,'ACTIVE','fictional-admin-subject');
INSERT INTO public.school_memberships VALUES(1,1,NULL,'PLATFORM_OWNER','ACTIVE'),
 (2,2,9,'SCHOOL_ADMIN','ACTIVE'),(3,2,91,'SCHOOL_ADMIN','INACTIVE');
INSERT INTO public.school_classes VALUES(90,9),(770,77);
INSERT INTO public.students VALUES(1,9),(2,77);
INSERT INTO public.audit_logs VALUES(1,9,'fictional event'),(2,88,'fictional audit-only parent');
INSERT INTO public.subscriptions VALUES(1,9);
INSERT INTO public.fee_payments VALUES(1,89);
INSERT INTO public.fee_provider_webhook_events VALUES(1,9);
INSERT INTO public.platform_devices VALUES(1,9,90,'ACTIVE','CONFIGURED','fictional gate'),
 (2,77,770,'ACTIVE','CONFIGURED','fictional unused reader');
-- Historical school differs from current assignment intentionally.
INSERT INTO public.device_credentials VALUES(1,1,93);
INSERT INTO public.device_assignment_history VALUES(1,1,94);
INSERT INTO public.device_school_bindings VALUES(1,95);
${capture("fixture_before")}
CREATE TEMP TABLE sequence_before AS SELECT last_value,is_called FROM public.schools_id_seq;

-- Candidate deletion must roll back along with the refused tenant-root removal.
BEGIN;
DELETE FROM public.students WHERE school_id=9;
DO $blocked$
DECLARE target_id integer; expected_name text; observed_name text; refused boolean;
BEGIN
 FOR target_id,expected_name IN SELECT * FROM (VALUES
   (88,'audit_logs_school_id_fkey'),
   (89,'fee_payments_school_id_fkey'),
   (91,'school_memberships_school_id_fkey'),
   (93,'device_credentials_school_id_fkey'),
   (94,'device_assignment_history_school_id_fkey'),
   (95,'device_school_bindings_school_id_fkey')
 ) cases(id,constraint_name) LOOP
   refused:=false;
   BEGIN
     DELETE FROM public.schools WHERE id=target_id;
   EXCEPTION WHEN foreign_key_violation THEN
     GET STACKED DIAGNOSTICS observed_name=CONSTRAINT_NAME;
     IF observed_name<>expected_name THEN RAISE EXCEPTION 'UNEXPECTED_BLOCKING_CONSTRAINT'; END IF;
     refused:=true;
   END;
   IF NOT refused THEN RAISE EXCEPTION 'PROTECTED_PARENT_WAS_NOT_BLOCKED'; END IF;
 END LOOP;
END $blocked$;
ROLLBACK;

-- Demonstrate one schema-supported CURRENT binding transition on a fictional,
-- unused reader only. This is NOT an approved Production unassignment policy.
BEGIN;
UPDATE public.platform_devices d SET school_id=NULL,school_class_id=NULL,
 status='UNASSIGNED',configuration_status='PENDING',location=NULL
 WHERE d.id=2 AND NOT EXISTS(SELECT 1 FROM public.device_credentials c WHERE c.device_id=d.id)
 AND NOT EXISTS(SELECT 1 FROM public.device_assignment_history h WHERE h.device_id=d.id)
 AND NOT EXISTS(SELECT 1 FROM public.device_school_bindings b WHERE b.device_id=d.id);
DO $unassigned$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_devices WHERE id=2 AND school_id IS NULL
   AND school_class_id IS NULL AND status='UNASSIGNED' AND configuration_status='PENDING') THEN
   RAISE EXCEPTION 'NULLABLE_CURRENT_BINDING_TRANSITION_FAILED';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.platform_devices WHERE id=1 AND school_id=9)
   OR NOT EXISTS(SELECT 1 FROM public.device_credentials WHERE id=1 AND school_id=93)
   OR NOT EXISTS(SELECT 1 FROM public.device_assignment_history WHERE id=1 AND school_id=94) THEN
   RAISE EXCEPTION 'HISTORICAL_BINDING_CHANGED';
 END IF;
END $unassigned$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- INACTIVE is a representable label, not a verified authorization barrier.
BEGIN;
UPDATE public.schools SET status='inactive' WHERE id=9;
DO $label$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.school_memberships
   WHERE id=1 AND school_id IS NULL AND role='PLATFORM_OWNER' AND status='ACTIVE') THEN
   RAISE EXCEPTION 'PLATFORM_OWNER_CHANGED';
 END IF;
END $label$;
ROLLBACK;
${capture("fixture_after")}
DO $preservation$
DECLARE b jsonb; a jsonb;
BEGIN
 SELECT production_reset_preflight INTO b FROM fixture_before;
 SELECT production_reset_preflight INTO a FROM fixture_after;
 IF b->'tables' IS DISTINCT FROM a->'tables'
   OR b->'foreignKeys' IS DISTINCT FROM a->'foreignKeys'
   OR b->'schemaFingerprint' IS DISTINCT FROM a->'schemaFingerprint'
   OR b->'migrationFingerprint' IS DISTINCT FROM a->'migrationFingerprint'
   OR (a->'ownerAccess'->>'activeOwners')::integer<>1 THEN
   RAISE EXCEPTION 'ROLLBACK_OR_PROTECTED_STATE_CHANGED';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(a->'foreignKeys') f
   WHERE (f->>'orphanRows')::bigint<>0 OR (f->>'validated')::boolean IS NOT TRUE) THEN
   RAISE EXCEPTION 'POST_REHEARSAL_FK_INTEGRITY_FAILED';
 END IF;
 IF EXISTS(SELECT last_value,is_called FROM public.schools_id_seq
   EXCEPT SELECT last_value,is_called FROM sequence_before) THEN
   RAISE EXCEPTION 'SEQUENCE_STATE_CHANGED';
 END IF;
END $preservation$;
SELECT 'FICTIONAL_RELATIONSHIP_REHEARSAL_PASS_NOT_PRODUCTION_OR_EXECUTOR_CERTIFICATION' AS result;
`;
}

export function rehearsalMain(args, output = console.log) {
  if (args.length === 1 && args[0] === "--print-sql") { output(rehearsalSql()); return 0; }
  if (args.length === 0 || args.length === 1 && args[0] === "--help") {
    output("Offline SQL printer: node scripts/src/production-reset/rehearsal.mjs --print-sql. See REHEARSAL.md for separately approved disposable execution.");
    return 0;
  }
  output("REHEARSAL_SQL_PRINTER_HAS_NO_EXECUTION_OR_CONNECTION_OPTIONS");
  return 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = rehearsalMain(process.argv.slice(2));
}
