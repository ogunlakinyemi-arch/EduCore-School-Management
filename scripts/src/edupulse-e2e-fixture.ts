import { pool } from "@workspace/db";

// This CLI prepares *records*, not accounts. Every account must still be
// invited and activated through the existing Clerk-backed application.
const fixtures = [
  {
    code: "E2E-VERIFY-A",
    name: "E2E Verification School A",
    students: [
      { admissionNo: "E2E-VERIFY-A1", firstName: "E2E", lastName: "Student A1", gender: "Female" },
      { admissionNo: "E2E-VERIFY-A2", firstName: "E2E", lastName: "Student A2", gender: "Male" },
    ],
  },
  {
    code: "E2E-VERIFY-B",
    name: "E2E Verification School B",
    students: [
      { admissionNo: "E2E-VERIFY-B1", firstName: "E2E", lastName: "Student B1", gender: "Female" },
      { admissionNo: "E2E-VERIFY-B2", firstName: "E2E", lastName: "Student B2", gender: "Male" },
    ],
  },
] as const;

type Client = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

async function assertDevelopment() {
  if (
    process.env.NODE_ENV !== "development" ||
    !process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DEPLOYMENT
  ) {
    throw new Error("E2E fixtures are restricted to an explicit Replit development workspace");
  }
  // The shell in this workspace reports REPLIT_ENVIRONMENT=production even
  // when DATABASE_URL targets development. Fail closed against the observed
  // production database name instead of trusting that environment flag.
  const target = await pool.query(`SELECT current_database() AS name`);
  if (target.rows[0]?.name !== "heliumdb") {
    throw new Error("E2E fixtures refuse this database: the development database target has changed");
  }
}

async function schoolForFixture(client: Client, fixture: (typeof fixtures)[number]) {
  const existing = await client.query(
    `SELECT id,name,city,state FROM schools WHERE code=$1 FOR UPDATE`,
    [fixture.code],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (row.name !== fixture.name || row.city !== "E2E Test" || row.state !== "E2E Test") {
      throw new Error(`Code ${fixture.code} is already used by a non-fixture school`);
    }
    return Number(row.id);
  }
  const sameName = await client.query(
    `SELECT id FROM schools WHERE lower(name)=lower($1) LIMIT 1`,
    [fixture.name],
  );
  if (sameName.rows[0]) throw new Error(`Name ${fixture.name} is already used by another school`);
  const created = await client.query(
    `INSERT INTO schools(code,name,city,state,status)
     VALUES($1,$2,'E2E Test','E2E Test','active') RETURNING id`,
    [fixture.code, fixture.name],
  );
  return Number(created.rows[0].id);
}

async function prepare() {
  if (process.env.EDUCORE_E2E_CONFIRM !== "create-development-test-records") {
    throw new Error("Explicit EDUCORE_E2E_CONFIRM is required to create development fixtures");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('edupulse:e2e-fixture'))");
    for (const fixture of fixtures) {
      const schoolId = await schoolForFixture(client, fixture);
      await client.query(
        `INSERT INTO school_classes(school_id,name,section,capacity)
         VALUES($1,'Primary 1','A',30)
         ON CONFLICT (school_id,name,section) DO NOTHING`,
        [schoolId],
      );
      for (const student of fixture.students) {
        const current = await client.query(
          `SELECT first_name AS "firstName",last_name AS "lastName",gender,class_name AS "className",
                  section FROM students WHERE school_id=$1 AND admission_no=$2 FOR UPDATE`,
          [schoolId, student.admissionNo],
        );
        if (current.rows[0]) {
          const row = current.rows[0];
          if (
            row.firstName !== student.firstName || row.lastName !== student.lastName ||
            row.gender !== student.gender || row.className !== "Primary 1" || row.section !== "A"
          ) {
            throw new Error(`Admission number ${student.admissionNo} belongs to a different record`);
          }
          continue;
        }
        await client.query(
          `INSERT INTO students
             (school_id,admission_no,first_name,last_name,gender,class_name,section,status)
           VALUES($1,$2,$3,$4,$5,'Primary 1','A','active')`,
          [schoolId, student.admissionNo, student.firstName, student.lastName, student.gender],
        );
      }
    }
    await client.query("COMMIT");
    console.info("Development-only school/class/student fixtures prepared. No accounts or invitations were created.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function linkParents() {
  if (process.env.EDUCORE_E2E_CONFIRM !== "link-development-test-parents") {
    throw new Error("Explicit EDUCORE_E2E_CONFIRM is required to link development parents");
  }
  const parentA = process.env.EDUCORE_E2E_PARENT_A_EMAIL?.trim().toLowerCase();
  const parentB = process.env.EDUCORE_E2E_PARENT_B_EMAIL?.trim().toLowerCase();
  if (!parentA || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentA)) {
    throw new Error("A valid, already-activated EDUCORE_E2E_PARENT_A_EMAIL is required");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('edupulse:e2e-fixture'))");
    for (const fixture of fixtures) {
      const email = fixture.code === "E2E-VERIFY-A" ? parentA : parentB;
      if (!email) continue;
      const school = await client.query(`SELECT id FROM schools WHERE code=$1 AND name=$2`, [fixture.code, fixture.name]);
      if (!school.rows[0]) throw new Error(`Prepare ${fixture.code} before linking parents`);
      const schoolId = school.rows[0].id;
      const parent = await client.query(
        `SELECT p.id FROM parents p
         JOIN app_users u ON u.id=p.user_id AND lower(u.email)=lower($2)
         JOIN school_memberships m ON m.user_id=u.id AND m.school_id=p.school_id
           AND m.role='PARENT' AND m.status='ACTIVE'
         WHERE p.school_id=$1 AND lower(p.email)=lower($2) AND p.status='ACTIVE' FOR UPDATE OF p`,
        [schoolId, email],
      );
      if (parent.rows.length !== 1) {
        throw new Error(`One activated parent profile in ${fixture.code} is required; no link was created`);
      }
      for (const student of fixture.students) {
        const match = await client.query(
          `SELECT id FROM students WHERE school_id=$1 AND admission_no=$2
           AND first_name=$3 AND last_name=$4`,
          [schoolId, student.admissionNo, student.firstName, student.lastName],
        );
        if (!match.rows[0]) throw new Error(`Fixture student ${student.admissionNo} was not found`);
        const relationship = await client.query(
          `SELECT status FROM parent_student_relationships WHERE parent_id=$1 AND student_id=$2 FOR UPDATE`,
          [parent.rows[0].id, match.rows[0].id],
        );
        if (relationship.rows[0]) {
          if (relationship.rows[0].status !== "ACTIVE") {
            throw new Error(`An inactive relationship already exists for ${student.admissionNo}`);
          }
          continue;
        }
        await client.query(
          `INSERT INTO parent_student_relationships
             (parent_id,student_id,relationship_type,is_primary_guardian,status)
           VALUES($1,$2,'Guardian',true,'ACTIVE')`,
          [parent.rows[0].id, match.rows[0].id],
        );
      }
    }
    await client.query("COMMIT");
    console.info("Activated parents linked to fixture children; existing relationships were preserved.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function inspect() {
  const result = await pool.query(
    `SELECT s.code,
       (SELECT count(*)::int FROM students st WHERE st.school_id=s.id
         AND st.admission_no LIKE 'E2E-VERIFY-%') AS students,
       (SELECT count(*)::int FROM school_memberships m WHERE m.school_id=s.id
         AND m.role='SCHOOL_ADMIN' AND m.status='ACTIVE') AS administrators,
       (SELECT count(*)::int FROM parents p WHERE p.school_id=s.id AND p.user_id IS NOT NULL) AS activated_parents
     FROM schools s WHERE s.code=ANY($1::text[]) ORDER BY s.code`,
    [fixtures.map((fixture) => fixture.code)],
  );
  const partners = await pool.query(`SELECT count(*)::int AS total FROM partner_profiles WHERE status='ACTIVE'`);
  console.info(JSON.stringify({ schools: result.rows, activePartnerProfiles: partners.rows[0].total }));
}

async function main() {
  await assertDevelopment();
  const command = process.argv[2];
  if (command === "prepare") await prepare();
  else if (command === "link-parents") await linkParents();
  else if (command === "inspect") await inspect();
  else throw new Error("Choose inspect, prepare, or link-parents");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Fixture command failed");
  process.exitCode = 1;
}).finally(() => pool.end());