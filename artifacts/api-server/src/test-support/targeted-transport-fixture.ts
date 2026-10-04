import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { clerkClient } from "@clerk/express";

// Development-only labelled fixtures. No real records are updated or deleted.
export async function prepareTransportFixture() {
  const identity = (await pool.query("SELECT current_database() AS name,pg_postmaster_start_time() AS started")).rows[0];
  if (identity.name !== "heliumdb" || new Date(identity.started).toISOString() !== "2026-10-03T20:25:42.106Z" ||
      !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("Verified Development database and Clerk test environment required");
  }
  let nonce = randomBytes(8).toString("hex");
  let label = `TRANSPORT-QA-${nonce.toUpperCase()}`;
  const actors: Record<string, any> = {};
  const definitions = {
    admin: "SCHOOL_ADMIN", student1: "STUDENT", student2: "STUDENT",
    parent: "PARENT", otherParent: "PARENT", driverA: "DRIVER", driverB: "DRIVER",
  } as const;
  // Recover known test-provider creations after a rolled-back SQL attempt.
  // Only a complete positively labelled group with no database bindings qualifies.
  const recent = await clerkClient.users.getUserList({ limit: 100, orderBy: "-created_at" });
  const groups = new Map<string, typeof recent.data>();
  for (const user of recent.data) {
    const marker = user.publicMetadata.transportQaFixture;
    if (typeof marker === "string" && /^TRANSPORT-QA-[A-F0-9]{16}$/.test(marker)) {
      groups.set(marker, [...(groups.get(marker) ?? []), user]);
    }
  }
  for (const [marker, users] of groups) {
    if (users.length !== Object.keys(definitions).length) continue;
    const bound = await pool.query("SELECT id FROM app_users WHERE clerk_user_id=ANY($1::text[])", [users.map(u => u.id)]);
    if (bound.rows.length) continue;
    const groupNonce = marker.slice("TRANSPORT-QA-".length).toLowerCase();
    const recovered: Record<string, any> = {};
    for (const [key, role] of Object.entries(definitions)) {
      const email = `transport-qa-${key.toLowerCase()}-${groupNonce}@example.com`;
      const matches = users.filter(u => u.emailAddresses.some(e => e.emailAddress.toLowerCase() === email));
      if (matches.length === 1) recovered[key] = { role, email, clerkUserId: matches[0].id };
    }
    if (Object.keys(recovered).length === Object.keys(definitions).length) {
      nonce = groupNonce; label = marker; Object.assign(actors, recovered); break;
    }
  }
  await mkdir(".local/test-fixtures", { recursive: true });
  const savePending = () => writeFile(".local/test-fixtures/targeted-transport-pending.json",
    JSON.stringify({ label, actors }, null, 2));
  await savePending();
  // Provider accounts are test-only; no invitation/email or password journey is claimed.
  for (const [key, role] of Object.entries(definitions)) {
    if (actors[key]) continue;
    const email = `transport-qa-${key.toLowerCase()}-${nonce}@example.com`;
    const user = await clerkClient.users.createUser({
      emailAddress: [email], firstName: "Transport QA", lastName: key,
      skipPasswordRequirement: true, publicMetadata: { transportQaFixture: label },
    });
    actors[key] = { role, email, clerkUserId: user.id };
    await savePending();
  }
  const client = await pool.connect();
  const before: Record<string, { max: number; digest: string }> = {};
  const tables = ["schools", "students", "parents", "employees", "school_memberships",
    "transport_buses", "transport_routes", "transport_route_stops", "transport_student_assignments", "transport_history"];
  try {
    await client.query("BEGIN");
    for (const table of tables) {
      before[table] = (await client.query(
        `SELECT COALESCE(max(id),0)::int AS max,
           md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) AS digest FROM ${table} t`,
      )).rows[0];
    }
    const school = (await client.query(
      `INSERT INTO schools(code,name,city,state,status,email,address,school_type)
       VALUES($1,$1,'QA','QA','ACTIVE',$2,'Development transport verification','PRIVATE') RETURNING id`,
      [label, `transport-qa-school-${nonce}@example.com`],
    )).rows[0];
    const schoolId = Number(school.id);
    const otherSchoolId = Number((await client.query(
      `INSERT INTO schools(code,name,city,state,status,school_type)
       VALUES($1,$1,'QA','QA','ACTIVE','PRIVATE') RETURNING id`, [`${label}-OTHER`],
    )).rows[0].id);
    const schoolClassId = Number((await client.query(
      `INSERT INTO school_classes(school_id,name,section,capacity) VALUES($1,'Primary 1','A',30) RETURNING id`,
      [schoolId],
    )).rows[0].id);
    const sessionId = Number((await client.query(
      `INSERT INTO academic_sessions(school_id,name,start_date,end_date,status,is_current)
       VALUES($1,$2,CURRENT_DATE,CURRENT_DATE+90,'ACTIVE',true) RETURNING id`, [schoolId, label],
    )).rows[0].id);
    await client.query(
      `INSERT INTO academic_terms(school_id,academic_session_id,name,start_date,end_date,status,is_current)
       VALUES($1,$2,'Term 1',CURRENT_DATE,CURRENT_DATE+90,'ACTIVE',true)`, [schoolId, sessionId],
    );
    for (const [key, actor] of Object.entries(actors)) {
      actor.userId = Number((await client.query(
        `INSERT INTO app_users(clerk_user_id,email,first_name,last_name,status)
         VALUES($1,$2,'Transport QA',$3,'ACTIVE') RETURNING id`,
        [actor.clerkUserId, actor.email, key],
      )).rows[0].id);
      actor.membershipId = Number((await client.query(
        `INSERT INTO school_memberships(user_id,school_id,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id`,
        [actor.userId, schoolId, actor.role],
      )).rows[0].id);
    }
    for (const key of ["student1", "student2"]) {
      actors[key].studentId = Number((await client.query(
        `INSERT INTO students(school_id,user_id,admission_no,first_name,last_name,gender,date_of_birth,
          class_name,section,status)
         VALUES($1,$2,$3,'Transport QA',$4,'female','2017-01-01','Primary 1','A','ACTIVE') RETURNING id`,
        [schoolId, actors[key].userId, `${label}-${key}`, key],
      )).rows[0].id);
    }
    for (const key of ["parent", "otherParent"]) {
      actors[key].parentId = Number((await client.query(
        `INSERT INTO parents(school_id,user_id,name,email,phone,status)
         VALUES($1,$2,$3,$4,'08000000000','ACTIVE') RETURNING id`,
        [schoolId, actors[key].userId, `Transport QA ${key}`, actors[key].email],
      )).rows[0].id);
    }
    for (const key of ["student1", "student2"]) {
      await client.query(
        `INSERT INTO parent_student_relationships(parent_id,student_id,relationship_type,status)
         VALUES($1,$2,'Mother','ACTIVE')`, [actors.parent.parentId, actors[key].studentId],
      );
    }
    for (const key of ["driverA", "driverB"]) {
      actors[key].employeeId = Number((await client.query(
        `INSERT INTO employees(school_id,user_id,employee_no,first_name,last_name,email,phone,
          employee_type,employment_status)
         VALUES($1,$2,$3,'Transport QA',$4,$5,'08000000000','DRIVER','ACTIVE') RETURNING id`,
        [schoolId, actors[key].userId, `${label}-${key}`, key, actors[key].email],
      )).rows[0].id);
    }
    const buses: Record<string, number> = {};
    const routes: Record<string, number> = {};
    const stops: Record<string, { pickup: number; dropoff: number }> = {};
    for (const [key, capacity] of [["A", 1], ["B", 2]] as const) {
      buses[key] = Number((await client.query(
        `INSERT INTO transport_buses(school_id,name,registration_number,make,capacity,status,created_by)
         VALUES($1,$2,$3,'School Bus',$4,'ACTIVE',$5) RETURNING id`,
        [schoolId, `${label}-Bus-${key}`, `QA-${nonce}-${key}`, capacity, actors.admin.userId],
      )).rows[0].id);
      routes[key] = Number((await client.query(
        `INSERT INTO transport_routes(school_id,bus_id,driver_employee_id,name,weekdays,
          departure_time,arrival_time,fare_minor,status,created_by)
         VALUES($1,$2,$3,$4,ARRAY['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'],
          '07:00:00','08:00:00',0,'ACTIVE',$5) RETURNING id`,
        [schoolId, buses[key], actors[`driver${key}`].employeeId, `${label}-Route-${key}`, actors.admin.userId],
      )).rows[0].id);
      stops[key] = { pickup: 0, dropoff: 0 };
      for (const [kind, sequence] of [["pickup", 1], ["dropoff", 2]] as const) {
        stops[key][kind] = Number((await client.query(
          `INSERT INTO transport_route_stops(school_id,route_id,name,stop_type,sequence,created_by)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
          [schoolId, routes[key], `${label}-${key}-${kind}`, kind.toUpperCase(), sequence, actors.admin.userId],
        )).rows[0].id);
      }
    }
    for (const table of tables) {
      const check = (await client.query(
        `SELECT md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) AS digest
         FROM ${table} t WHERE id<=$1`, [before[table].max],
      )).rows[0];
      if (check.digest !== before[table].digest) throw new Error(`Original ${table} records changed`);
    }
    await client.query("COMMIT");
    const fixture = { label, schoolId, otherSchoolId, actors, buses, routes, stops, before };
    await mkdir(".local/test-fixtures", { recursive: true });
    await writeFile(".local/test-fixtures/targeted-transport.json", JSON.stringify(fixture, null, 2));
    return fixture;
  } catch (error) {
    await client.query("ROLLBACK");
    // Accepted provider identities are deliberately retained for reconciliation.
    // Never delete an identity after an ambiguous database commit.
    throw error;
  } finally { client.release(); }
}