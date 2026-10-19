-- Only for a disposable local PostgreSQL cluster, never an application target.
DO $$
BEGIN
  IF current_setting('data_directory') NOT LIKE '/tmp/educore-person-title.%/data' THEN
    RAISE EXCEPTION 'This rehearsal requires its own disposable local cluster';
  END IF;
END $$;
CREATE TABLE parents (id serial PRIMARY KEY, school_id integer, name text);
CREATE TABLE employees (id serial PRIMARY KEY, school_id integer, first_name text);
INSERT INTO parents (school_id,name) VALUES (1,'Legacy Parent');
INSERT INTO employees (school_id,first_name) VALUES (1,'Legacy Teacher');
DO $$
BEGIN
  IF (SELECT to_jsonb(p)->>'person_title' FROM parents p WHERE id=1) IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy read must return no title without the new column';
  END IF;
END $$;

\ir ../../lib/db/drizzle/0168_person_titles.sql

INSERT INTO parents (school_id,name,person_title) VALUES (1,'Example Parent','Dr')
RETURNING to_jsonb(parents)->>'person_title' AS "personTitle";
INSERT INTO employees (school_id,first_name,person_title) VALUES (1,'Example Teacher','Prof')
RETURNING to_jsonb(employees)->>'person_title' AS "personTitle";
UPDATE parents SET person_title=NULL WHERE id=2
RETURNING to_jsonb(parents)->>'person_title' AS "personTitle";
DO $$
BEGIN
  IF (SELECT name FROM parents WHERE id=1)<>'Legacy Parent'
     OR (SELECT person_title FROM parents WHERE id=1) IS NOT NULL
     OR (SELECT person_title FROM parents WHERE id=2) IS NOT NULL
     OR (SELECT person_title FROM employees WHERE id=2)<>'Prof' THEN
    RAISE EXCEPTION 'Legacy preservation, saved title or explicit clear failed';
  END IF;
  BEGIN
    INSERT INTO parents (school_id,name,person_title) VALUES (1,'Invalid Parent','invented');
    RAISE EXCEPTION 'Parent title CHECK did not reject an invalid value';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO employees (school_id,first_name,person_title) VALUES (1,'Invalid Teacher','invented');
    RAISE EXCEPTION 'Employee title CHECK did not reject an invalid value';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
