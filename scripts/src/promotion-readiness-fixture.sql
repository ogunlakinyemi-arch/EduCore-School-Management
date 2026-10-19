-- Disposable cluster only; this is not an application migration.
DO $$ BEGIN
  IF current_setting('data_directory') NOT LIKE '/tmp/educore-promotion-preview.%/data' THEN
    RAISE EXCEPTION 'Disposable promotion-preview cluster required';
  END IF;
END $$;
CREATE TABLE students(id integer,school_id integer,status text);
CREATE TABLE student_class_assignments(
  id integer,student_id integer,school_id integer,academic_session_id integer,
  academic_term_id integer,school_class_id integer,section text,status text,is_current boolean
);
CREATE TABLE academic_results(
  id integer,school_id integer,student_id integer,student_class_assignment_id integer,
  academic_session_id integer,academic_term_id integer,school_class_id integer,
  section_snapshot text,status text,published_at timestamptz,score numeric,max_score numeric
);
INSERT INTO students VALUES
 (1,1,'ACTIVE'),(2,1,'ACTIVE'),(3,1,'ACTIVE'),(4,2,'ACTIVE'),(5,1,'INACTIVE'),(6,1,'ACTIVE');
INSERT INTO student_class_assignments VALUES
 (11,1,1,10,102,7,'A','ACTIVE',true),
 (21,2,1,10,102,7,'A','ACTIVE',true),
 (31,3,1,10,NULL,7,'A','ACTIVE',true),
 (32,3,1,10,NULL,8,'B','ACTIVE',true),
 (41,4,2,10,102,7,'A','ACTIVE',true),
 (51,5,1,10,102,7,'A','ACTIVE',true),
 (61,6,1,11,102,7,'A','ACTIVE',true);
INSERT INTO academic_results VALUES
 (1,1,1,11,10,102,7,'A','PUBLISHED','2026-07-20',70,100),
 (2,1,1,11,10,101,7,'A','PUBLISHED','2026-07-20',90,100),
 (3,1,1,11,10,102,7,'A','DRAFT',NULL,90,100),
 (4,1,1,11,10,102,7,'A','PUBLISHED',NULL,90,100),
 (5,1,1,11,10,102,7,'A','PUBLISHED','2026-07-20',0,0),
 (6,2,1,11,10,102,7,'A','PUBLISHED','2026-07-20',90,100),
 (7,1,1,11,11,102,7,'A','PUBLISHED','2026-07-20',90,100),
 (8,1,1,11,10,102,8,'A','PUBLISHED','2026-07-20',90,100),
 (9,1,1,11,10,102,7,'Z','PUBLISHED','2026-07-20',90,100),
 (10,1,1,999,10,102,7,'A','PUBLISHED','2026-07-20',90,100),
 (11,1,2,22,10,102,7,'A','PUBLISHED','2026-07-20',90,100),
 (12,1,3,31,10,102,7,'A','PUBLISHED','2026-07-20',60,100),
 (13,1,2,21,10,101,7,'A','PUBLISHED','2026-07-20',90,100),
 (14,1,5,51,10,102,7,'A','PUBLISHED','2026-07-20',90,100),
 (15,2,4,41,10,102,7,'A','PUBLISHED','2026-07-20',90,100),
 (16,1,6,61,11,102,7,'A','PUBLISHED','2026-07-20',90,100);
