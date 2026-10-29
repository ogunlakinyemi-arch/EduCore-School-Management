// Explicitly authorized fictional Development fixture. No existing actor or
// school is modified. No messages, provider payments, or bank requests are made.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const dbRequire = createRequire(new URL('../../../lib/db/package.json', import.meta.url));
const apiRequire = createRequire(new URL('../../../artifacts/api-server/package.json', import.meta.url));
const { Client } = dbRequire('pg');
const { clerkClient } = apiRequire('@clerk/express');
const out = 'generated-artifacts/educore-product-demo';
await mkdir(out, { recursive: true });
if (process.env.REPLIT_DEPLOYMENT || !process.env.REPLIT_DEV_DOMAIN ||
    !process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')) throw Error('Development identity provider required');
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const identity = (await db.query(`SELECT current_database() db,
    pg_postmaster_start_time() started,inet_server_addr() IS NULL socket_target`)).rows[0];
  if (identity.db !== 'heliumdb' || !identity.socket_target ||
      new Date(identity.started).toISOString() !== '2026-10-29T20:42:18.161Z') {
    throw Error('Development database identity differs from independently checked target');
  }
  let fixture;
  try { fixture = JSON.parse(await readFile(`${out}/private-fixture.json`, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (fixture?.complete) { console.log('Authorized demo fixture already prepared'); process.exitCode = 0; }
  else {
    fixture ??= { label: `VIDEO-DEMO-${Date.now()}`, actors: {} };
    const save = () => writeFile(`${out}/private-fixture.json`, JSON.stringify(fixture, null, 2), { mode: 0o600 });
    for (const [key, firstName, lastName, role] of [
      ['admin', 'Demo', 'Administrator', 'SCHOOL_ADMIN'],
      ['teacher', 'Demo', 'Teacher', 'TEACHER'],
      ['parent', 'Demo', 'Guardian', 'PARENT'],
      ['student', 'Demo', 'Learner', 'STUDENT'],
    ]) {
      if (fixture.actors[key]) continue;
      const email = `${fixture.label.toLowerCase()}-${key}@example.com`;
      // Reconcile exact fixture-owned external identity before any create retry.
      const found = await clerkClient.users.getUserList({ emailAddress: [email] });
      let external = found.data[0];
      if (external && external.privateMetadata?.educoreVideoDemo !== fixture.label) {
        throw Error('Demo email collision; refusing unrelated identity');
      }
      external ??= await clerkClient.users.createUser({
        emailAddress: [email], firstName, lastName, skipPasswordRequirement: true,
        privateMetadata: { educoreVideoDemo: fixture.label, fixtureRole: role },
      });
      fixture.actors[key] = { clerkUserId: external.id, email, firstName, lastName, role };
      await save();
    }
    await db.query('BEGIN');
    for (const actor of Object.values(fixture.actors)) {
      actor.userId = (await db.query(`INSERT INTO app_users(clerk_user_id,email,first_name,last_name,status)
        VALUES($1,$2,$3,$4,'ACTIVE') RETURNING id`,
      [actor.clerkUserId, actor.email, actor.firstName, actor.lastName])).rows[0].id;
    }
    const school = (await db.query(`INSERT INTO schools(code,name,city,state,status,communication_defaults)
      VALUES($1,'Yetenia Demo Academy · FICTIONAL','Demo Campus','Lagos','active',$2::jsonb) RETURNING id`,
    [fixture.label, JSON.stringify({})])).rows[0];
    fixture.schoolId = school.id;
    for (const actor of Object.values(fixture.actors)) {
      await db.query(`INSERT INTO school_memberships(user_id,school_id,role,status)
        VALUES($1,$2,$3,'ACTIVE')`, [actor.userId, school.id, actor.role]);
    }
    fixture.sessionId = (await db.query(`INSERT INTO academic_sessions
      (school_id,name,start_date,end_date,status,is_current,created_by)
      VALUES($1,'2026/2027 Demo Session','2026-09-01','2027-07-31','ACTIVE',true,$2) RETURNING id`,
    [school.id, fixture.actors.admin.userId])).rows[0].id;
    fixture.termId = (await db.query(`INSERT INTO academic_terms
      (school_id,academic_session_id,name,start_date,end_date,status,is_current,created_by)
      VALUES($1,$2,'First Term · Demo','2026-09-01','2026-12-18','ACTIVE',true,$3) RETURNING id`,
    [school.id, fixture.sessionId, fixture.actors.admin.userId])).rows[0].id;
    fixture.classId = (await db.query(`INSERT INTO school_classes(school_id,name,section,class_teacher)
      VALUES($1,'JSS1','A','Demo Teacher') RETURNING id`, [school.id])).rows[0].id;
    fixture.employeeId = (await db.query(`INSERT INTO employees
      (school_id,user_id,employee_no,first_name,last_name,employee_type,email)
      VALUES($1,$2,'DEMO-TEACHER','Demo','Teacher','TEACHER',$3) RETURNING id`,
    [school.id, fixture.actors.teacher.userId, fixture.actors.teacher.email])).rows[0].id;
    fixture.parentId = (await db.query(`INSERT INTO parents(school_id,user_id,name,email,phone)
      VALUES($1,$2,'Demo Guardian',$3,'00000000000') RETURNING id`,
    [school.id, fixture.actors.parent.userId, fixture.actors.parent.email])).rows[0].id;
    fixture.students = [];
    for (const [i, name] of ['Learner', 'Scholar', 'Explorer'].entries()) {
      const student = (await db.query(`INSERT INTO students
        (school_id,user_id,admission_no,first_name,last_name,gender,class_name,section,status,admission_date)
        VALUES($1,$2,$3,'Demo',$4,'female','JSS1','A','active','2026-09-01') RETURNING id`,
      [school.id, i === 0 ? fixture.actors.student.userId : null, `DEMO-${i + 1}`, name])).rows[0];
      student.assignmentId = (await db.query(`INSERT INTO student_class_assignments
        (school_id,student_id,academic_session_id,academic_term_id,school_class_id,section,is_current,start_date)
        VALUES($1,$2,$3,$4,$5,'A',true,'2026-09-01') RETURNING id`,
      [school.id, student.id, fixture.sessionId, fixture.termId, fixture.classId])).rows[0].id;
      fixture.students.push(student);
      if (i === 0) await db.query(`INSERT INTO parent_student_relationships(parent_id,student_id,status)
        VALUES($1,$2,'ACTIVE')`, [fixture.parentId, student.id]);
      await db.query(`INSERT INTO attendance_events
        (school_id,student_id,identification_method,event_type,result,event_date,occurred_at,
         academic_session_id,academic_term_id,school_class_id,class_name_snapshot,section_snapshot,
         reason,actor_user_id,dedupe_key)
        VALUES($1,$2,'MANUAL','SCHOOL_ENTRY','SUCCESS',CURRENT_DATE,CURRENT_DATE+interval '7 hours 30 minutes',
        $3,$4,$5,'JSS1','A','Fictional product demonstration',$6,$7)`,
      [school.id, student.id, fixture.sessionId, fixture.termId, fixture.classId,
        fixture.actors.teacher.userId, `${fixture.label}-${student.id}`]);
    }
    await db.query(`INSERT INTO teacher_class_assignments
      (school_id,employee_id,academic_session_id,school_class_id,section,assignment_type,start_date)
      VALUES($1,$2,$3,$4,'A','CLASS_TEACHER','2026-09-01')`,
    [school.id, fixture.employeeId, fixture.sessionId, fixture.classId]);
    fixture.subjects = [];
    const typeId = (await db.query(`INSERT INTO academic_assessment_types(school_id,name,code)
      VALUES($1,'Demo Examination','DEMO-EXAM') RETURNING id`, [school.id])).rows[0].id;
    for (const [i, name] of ['English Language', 'Mathematics'].entries()) {
      const subject = (await db.query(`INSERT INTO subjects(school_id,name,code)
        VALUES($1,$2,$3) RETURNING id`, [school.id, name, `DEMO-${i}`])).rows[0];
      fixture.subjects.push(subject);
      await db.query(`INSERT INTO teacher_class_assignments
        (school_id,employee_id,academic_session_id,school_class_id,subject_id,section,assignment_type,start_date)
        VALUES($1,$2,$3,$4,$5,'A','SUBJECT_TEACHER','2026-09-01')`,
      [school.id, fixture.employeeId, fixture.sessionId, fixture.classId, subject.id]);
      const assessment = (await db.query(`INSERT INTO academic_assessments
        (school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,
        assessment_type_id,teacher_employee_id,created_by,title,description,assessment_date,max_score,status)
        VALUES($1,$2,$3,$4,'A',$5,$6,$7,$8,'Fictional term demonstration','Fictional demo scores only',
        CURRENT_DATE,100,'PUBLISHED') RETURNING id`,
      [school.id, fixture.sessionId, fixture.termId, fixture.classId, subject.id, typeId,
        fixture.employeeId, fixture.actors.teacher.userId])).rows[0];
      for (const [j, student] of fixture.students.entries()) {
        const result = (await db.query(`INSERT INTO academic_results
          (school_id,assessment_id,student_id,student_class_assignment_id,teacher_employee_id,
          academic_session_id,academic_term_id,school_class_id,section_snapshot,subject_id,
          score,max_score,grade,grade_point,remark,status,created_by,published_by,published_at,review_status,reviewed_by,reviewed_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'A',$9,$10,100,'A',4,'Excellent demo progress',
          'PUBLISHED',$11,$12,now(),'APPROVED',$12,now()) RETURNING id`,
        [school.id, assessment.id, student.id, student.assignmentId, fixture.employeeId,
          fixture.sessionId, fixture.termId, fixture.classId, subject.id, 86 - i * 4 - j * 3,
          fixture.actors.teacher.userId, fixture.actors.admin.userId])).rows[0];
        student.results ??= []; student.results.push({ id: result.id, subjectId: subject.id, name, score: 86 - i * 4 - j * 3 });
      }
    }
    for (const student of fixture.students) {
      student.reportCardId = (await db.query(`INSERT INTO academic_report_cards
        (school_id,student_id,academic_session_id,academic_term_id,student_class_assignment_id,
        school_class_id,class_name_snapshot,section_snapshot,status,teacher_remark,school_remark,published_by,published_at)
        VALUES($1,$2,$3,$4,$5,$6,'JSS1','A','PUBLISHED',
        'Consistent effort and strong progress. Fictional demo only.',
        'Keep learning with confidence. Fictional demo only.',$7,now()) RETURNING id`,
      [school.id, student.id, fixture.sessionId, fixture.termId, student.assignmentId, fixture.classId,
        fixture.actors.admin.userId])).rows[0].id;
      for (const result of student.results) await db.query(`INSERT INTO academic_report_card_lines
        (school_id,report_card_id,result_id,subject_id,subject_name_snapshot,assessment_name_snapshot,
        score,max_score,grade,grade_point,remark) VALUES($1,$2,$3,$4,$5,'Fictional term demonstration',$6,100,'A',4,'Excellent')`,
      [school.id, student.reportCardId, result.id, result.subjectId, result.name, result.score]);
    }
    await db.query(`INSERT INTO fee_school_settings(school_id) VALUES($1)`, [school.id]);
    fixture.invoiceId = (await db.query(`INSERT INTO fee_invoices
      (school_id,student_id,parent_id,academic_session_id,academic_term_id,invoice_number,student_name_snapshot,
       admission_no_snapshot,class_name_snapshot,section_snapshot,issue_date,due_date,
       subtotal_minor,total_minor,outstanding_minor,created_by)
      VALUES($1,$2,$3,$4,$5,$6,'Demo Learner','DEMO-1','JSS1','A',CURRENT_DATE,'2026-12-01',
      1250000,1250000,1250000,$7) RETURNING id`,
    [school.id, fixture.students[0].id, fixture.parentId, fixture.sessionId, fixture.termId,
      `DEMO-INVOICE-${school.id}`, fixture.actors.admin.userId])).rows[0].id;
    await db.query(`INSERT INTO fee_invoice_lines(school_id,invoice_id,category_name_snapshot,description_snapshot,amount_minor)
      VALUES($1,$2,'Demo tuition','Fictional school-issued invoice; no payment processed',1250000)`,
    [school.id, fixture.invoiceId]);
    await db.query('COMMIT');
    fixture.complete = true; await save();
    console.log(JSON.stringify({ fictionalSchoolCreated: true, actorCount: 4, studentCount: 3,
      existingRecordsModified: false, externalMessagesSent: false, financialActionsInitiated: false }));
  }
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  // Provider error bodies may include account identifiers; report no raw body.
  console.error(`Demo preparation stopped safely: ${e.code || e.status || e.message?.slice(0, 130) || 'unknown error'}`);
  process.exitCode = 1;
} finally { await db.end(); }
