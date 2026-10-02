import express from "express";
import type { NextFunction, Request, Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
import { z } from "zod";
import { currentNfcStudentRecordQuery } from "./attendance";
import { AuthError } from "../middlewares/auth";
import type { Server } from "node:http";

vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: Request, _res: Response, next: NextFunction) => {
      const userId = Number(req.header("x-test-user"));
      const schoolId = Number(req.header("x-test-school"));
      const owner = req.header("x-test-role") === "PLATFORM_OWNER";
      (req as Request & { edupulseUser?: unknown }).edupulseUser = {
        user: {
          id: userId,
          clerkUserId: `promotion-test-${userId}`,
          email: `promotion-test-${userId}@example.invalid`,
          firstName: "Promotion",
          lastName: "Tester",
          phone: null,
          status: "ACTIVE",
        },
        roles: owner
          ? [
              { id: 1, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" },
              { id: 2, role: "SCHOOL_ADMIN", schoolId, status: "ACTIVE" },
            ]
          : [{ id: 2, role: "SCHOOL_ADMIN", schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import promotionRouter from "./promotion-expansion";
import {
  promotionBatchDetailSchema,
  promotionHistoryEntrySchema,
} from "../services/promotion-expansion-service";

const enabled = process.env.PROMOTION_EXPANSION_INTEGRATION === "1";
const expectedDatabaseUrl = "postgres://postgres@127.0.0.1:55433/educore_expansion_test";
const fixtureIds: number[] = [];
const ownedObjects: Array<{
  schoolId: number;
  userId: number;
  sessionIds: number[];
  classIds: number[];
  studentIds: number[];
  termIds: number[];
  subjectIds: number[];
  employeeIds: number[];
  assessmentTypeIds: number[];
  assessmentIds: number[];
}> = [];
let server: Server;
let baseUrl = "";

async function jsonRequest(
  path: string,
  options: {
    method?: string;
    role?: string;
    userId: number;
    schoolId: number;
    body?: unknown;
    idempotencyKey?: string;
  },
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-test-role": options.role ?? "SCHOOL_ADMIN",
      "x-test-user": String(options.userId),
      "x-test-school": String(options.schoolId),
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function createFixture(studentCount = 1) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const user = await pool.query(
    `INSERT INTO app_users(clerk_user_id,email,first_name,last_name)
     VALUES($1,$2,'Promotion','Tester') RETURNING id`,
    [`promotion-fixture-${suffix}`, `promotion-${suffix}@example.invalid`],
  );
  const userId = Number(user.rows[0].id);
  fixtureIds.push(userId);
  const school = await pool.query(
    `INSERT INTO schools(code,name,city,state,status)
     VALUES($1,'Promotion integration fixture','Test City','Test State','active') RETURNING id`,
    [`PROMO-${suffix}`],
  );
  const schoolId = Number(school.rows[0].id);
  const sessions = await pool.query(
    `INSERT INTO academic_sessions(school_id,name,start_date,end_date,status,is_current)
     VALUES($1,$2,DATE '2025-09-01',DATE '2026-07-31','ACTIVE',true),
           ($1,$3,DATE '2026-09-01',DATE '2027-07-31','PLANNED',false)
     RETURNING id`,
    [schoolId, `2025-${suffix}`, `2026-${suffix}`],
  );
  const sourceSessionId = Number(sessions.rows[0].id);
  const targetSessionId = Number(sessions.rows[1].id);
  const classes = await pool.query(
    `INSERT INTO school_classes(school_id,name,section)
     VALUES($1,'JSS1','A'),($1,'JSS2','B') RETURNING id`,
    [schoolId],
  );
  const sourceClassId = Number(classes.rows[0].id);
  const targetClassId = Number(classes.rows[1].id);
  const terms = await pool.query(
    `INSERT INTO academic_terms(school_id,academic_session_id,name,start_date,end_date,status,is_current)
     VALUES($1,$2,'First Term',DATE '2025-09-01',DATE '2025-12-31','ACTIVE',true),
           ($1,$3,'First Term',DATE '2026-09-01',DATE '2026-12-31','PLANNED',false)
     RETURNING id`,
    [schoolId, sourceSessionId, targetSessionId],
  );
  const sourceTermId = Number(terms.rows[0].id);
  const targetTermId = Number(terms.rows[1].id);
  const subject = await pool.query(
    `INSERT INTO subjects(school_id,name,code)
     VALUES($1,'Promotion Test Subject',$2) RETURNING id`,
    [schoolId, `SUB-${suffix}`],
  );
  const subjectId = Number(subject.rows[0].id);
  const assessmentType = await pool.query(
    `INSERT INTO academic_assessment_types(school_id,name,code)
     VALUES($1,'Promotion Test Assessment',$2) RETURNING id`,
    [schoolId, `ASSESS-${suffix}`],
  );
  const assessmentTypeId = Number(assessmentType.rows[0].id);
  const employee = await pool.query(
    `INSERT INTO employees(school_id,employee_no,first_name,last_name)
     VALUES($1,$2,'Promotion','Teacher') RETURNING id`,
    [schoolId, `EMP-${suffix}`],
  );
  const employeeId = Number(employee.rows[0].id);
  const assessment = await pool.query(
    `INSERT INTO academic_assessments
       (school_id,academic_session_id,academic_term_id,school_class_id,subject_id,
        assessment_type_id,teacher_employee_id,created_by,title,description,assessment_date,
        max_score,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Promotion test','Promotion test summary',
        DATE '2025-10-02',100,'PUBLISHED')
     RETURNING id`,
    [schoolId, sourceSessionId, sourceTermId, sourceClassId, subjectId, assessmentTypeId, employeeId, userId],
  );
  const assessmentId = Number(assessment.rows[0].id);
  const studentIds: number[] = [];
  for (let index = 0; index < studentCount; index++) {
    const student = await pool.query(
      `INSERT INTO students(school_id,admission_no,first_name,last_name,gender,class_name,section,status)
       VALUES($1,$2,$3,'Student','OTHER','JSS1','A','active') RETURNING id`,
      [schoolId, `ADM-${suffix}-${index}`, `Test${index}`],
    );
    const studentId = Number(student.rows[0].id);
    studentIds.push(studentId);
    const assignment = await pool.query(
      `INSERT INTO student_class_assignments
         (school_id,student_id,academic_session_id,academic_term_id,school_class_id,section,status,is_current,start_date)
       VALUES($1,$2,$3,$4,$5,'A','ACTIVE',true,DATE '2025-09-01') RETURNING id`,
      [schoolId, studentId, sourceSessionId, sourceTermId, sourceClassId],
    );
    await pool.query(
      `INSERT INTO academic_results
         (school_id,assessment_id,student_id,student_class_assignment_id,teacher_employee_id,
          academic_session_id,academic_term_id,school_class_id,section_snapshot,subject_id,
          score,max_score,status,created_by,published_by,published_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'A',$9,80,100,'PUBLISHED',$10,$10,now())`,
      [
        schoolId, assessmentId, studentId, assignment.rows[0].id, employeeId,
        sourceSessionId, sourceTermId, sourceClassId, subjectId, userId,
      ],
    );
    await pool.query(
      `INSERT INTO nfc_cards(school_id,uid,student_id,status,issued_at)
       VALUES($1,$2,$3,'active',now())`,
      [schoolId, `UID-${suffix}-${index}`, studentId],
    );
    await pool.query(
      `INSERT INTO attendance_events
         (school_id,student_id,identification_method,event_type,result,attendance_status,
          event_date,occurred_at,academic_session_id,academic_term_id,school_class_id,
          class_name_snapshot,section_snapshot,dedupe_key)
       VALUES($1,$2,'NFC','SCHOOL_ENTRY','SUCCESS','PRESENT',DATE '2025-10-01',
          TIMESTAMPTZ '2025-10-01 08:00:00+00',$3,$4,$5,'JSS1','A',$6)`,
      [schoolId, studentId, sourceSessionId, sourceTermId, sourceClassId, `promo-event-${suffix}-${index}`],
    );
    // Keep the original assignment id for the historical-record assertion.
    void assignment;
  }
  ownedObjects.push({
    schoolId,
    userId,
    sessionIds: [sourceSessionId, targetSessionId],
    classIds: [sourceClassId, targetClassId],
    studentIds,
    termIds: [sourceTermId, targetTermId],
    subjectIds: [subjectId],
    employeeIds: [employeeId],
    assessmentTypeIds: [assessmentTypeId],
    assessmentIds: [assessmentId],
  });
  return { schoolId, userId, sourceSessionId, targetSessionId, sourceClassId, targetClassId, sourceTermId, targetTermId, studentIds };
}

async function prepare(fixture: Awaited<ReturnType<typeof createFixture>>, key: string) {
  return jsonRequest(`/school/academics/promotions/batches?schoolId=${fixture.schoolId}`, {
    method: "POST",
    userId: fixture.userId,
    schoolId: fixture.schoolId,
    idempotencyKey: key,
    body: { sourceSessionId: fixture.sourceSessionId, targetSessionId: fixture.targetSessionId },
  });
}

async function assertDisposableDatabase() {
  if (process.env.DATABASE_URL !== expectedDatabaseUrl) {
    throw new Error("Refusing promotion integration writes: DATABASE_URL must target the designated localhost:55433 disposable clone");
  }
  const identity = await pool.query(
    `SELECT current_database() AS database_name,inet_server_addr()::text AS address,
            inet_server_port() AS port,current_setting('data_directory') AS data_directory`,
  );
  const address = String(identity.rows[0]?.address);
  if (identity.rows[0]?.database_name !== "educore_expansion_test" ||
      !(address === "127.0.0.1" || address.startsWith("127.0.0.1/")) ||
      Number(identity.rows[0]?.port) !== 55433 ||
      !String(identity.rows[0]?.data_directory).startsWith("/tmp/educore-expansion-postgres")) {
    throw new Error("Refusing promotion integration writes outside the designated local clone");
  }
}

describe.skipIf(!enabled)("Promotion expansion against disposable PostgreSQL", () => {
  beforeAll(async () => {
    await assertDisposableDatabase();
    const migration = await pool.query(`SELECT to_regclass('promotion_batches') AS table_name`);
    if (!migration.rows[0]?.table_name) {
      throw new Error("Apply 0044_promotion_expansion.sql to the local disposable database before opt-in integration tests");
    }
    const app = express();
    app.use(express.json());
    app.use(promotionRouter);
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof AuthError) {
        res.status(error.statusCode).json({ error: error.message, code: error.eventType });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    });
    server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not start promotion integration test server");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (enabled) await assertDisposableDatabase();
    for (const owned of ownedObjects) {
      await pool.query(`ALTER TABLE promotion_history DISABLE TRIGGER promotion_history_immutable`);
      try {
        await pool.query(`DELETE FROM promotion_history WHERE school_id=$1`, [owned.schoolId]);
        await pool.query(`DELETE FROM audit_logs WHERE school_id=$1`, [owned.schoolId]);
        await pool.query(`DELETE FROM promotion_batch_students WHERE school_id=$1`, [owned.schoolId]);
        await pool.query(`DELETE FROM promotion_batches WHERE school_id=$1`, [owned.schoolId]);
      } finally {
        await pool.query(`ALTER TABLE promotion_history ENABLE TRIGGER promotion_history_immutable`);
      }
      await pool.query(`DELETE FROM academic_results WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM academic_assessments WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM attendance_events WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM nfc_cards WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM student_class_assignments WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM students WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM academic_assessment_types WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM subjects WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM employees WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM admission_portal_classes WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM admission_application_counters WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM admission_portal_settings WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM academic_terms WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM academic_sessions WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM school_classes WHERE school_id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM schools WHERE id=$1`, [owned.schoolId]);
      await pool.query(`DELETE FROM app_users WHERE id=$1`, [owned.userId]);
    }
    if (fixtureIds.length) {
      await pool.query(`DELETE FROM app_users WHERE id=ANY($1::int[])`, [fixtureIds]);
    }
  });

  it("keeps preparation review-only, excludes dual-role owners, and idempotently snapshots real SQL summaries", async () => {
    const fixture = await createFixture();
    const denied = await jsonRequest(`/school/academics/promotions/batches?schoolId=${fixture.schoolId}`, {
      method: "POST",
      role: "PLATFORM_OWNER",
      userId: fixture.userId,
      schoolId: fixture.schoolId,
      idempotencyKey: "owner-denied-key",
      body: { sourceSessionId: fixture.sourceSessionId, targetSessionId: fixture.targetSessionId },
    });
    expect(denied.status).toBe(404);
    const firstResponse = await prepare(fixture, "prepare-promotion-key-01");
    const replayResponse = await prepare(fixture, "prepare-promotion-key-01");
    expect(firstResponse.status).toBe(201);
    expect(replayResponse.status).toBe(200);
    const first = promotionBatchDetailSchema.parse(firstResponse.body);
    const replay = promotionBatchDetailSchema.parse(replayResponse.body);
    expect(replay.id).toBe(first.id);
    expect(first.students[0].status).toBe("Eligible");
    expect(first.students[0].academicPerformance).toMatchObject({
      resultCount: 1,
      scoredCount: 1,
      averageScore: 80,
    });
    expect(first.students[0].attendanceSummary).toMatchObject({
      presentCount: 1,
      recordedCount: 1,
      attendanceRate: 100,
    });
    const movedBeforeReview = await pool.query(
      `SELECT is_current FROM student_class_assignments WHERE student_id=$1 AND school_id=$2`,
      [fixture.studentIds[0], fixture.schoolId],
    );
    expect(movedBeforeReview.rows[0].is_current).toBe(true);
    const pairDuplicate = await prepare(fixture, "prepare-promotion-key-02");
    expect(pairDuplicate.status).toBe(409);

    await pool.query(
      `UPDATE student_class_assignments SET is_current=false,status='INACTIVE'
        WHERE student_id=$1 AND school_id=$2`,
      [fixture.studentIds[0], fixture.schoolId],
    );
    const stale = await jsonRequest(
      `/school/academics/promotions/batches/${first.id}/students/${fixture.studentIds[0]}?schoolId=${fixture.schoolId}`,
      {
        method: "PATCH",
        userId: fixture.userId,
        schoolId: fixture.schoolId,
        body: {
          status: "Promoted",
          reason: "Reviewed academic progress",
          targetTermId: fixture.targetTermId,
          targetClassId: fixture.targetClassId,
          targetSection: "B",
        },
      },
    );
    expect(stale.status).toBe(409);
  });

  it("serializes concurrent finalization, preserves NFC identity and historical placement/event snapshots", async () => {
    const fixture = await createFixture();
    const cardBefore = await pool.query(
      `SELECT id,uid,status FROM nfc_cards WHERE student_id=$1 AND school_id=$2`,
      [fixture.studentIds[0], fixture.schoolId],
    );
    const sourceAssignment = await pool.query(
      `SELECT id FROM student_class_assignments WHERE student_id=$1 AND school_id=$2`,
      [fixture.studentIds[0], fixture.schoolId],
    );
    const preparedResponse = await prepare(fixture, "prepare-promotion-key-03");
    const prepared = promotionBatchDetailSchema.parse(preparedResponse.body);
    const batchId = prepared.id;
    const review = await jsonRequest(
      `/school/academics/promotions/batches/${batchId}/students/${fixture.studentIds[0]}?schoolId=${fixture.schoolId}`,
      {
        method: "PATCH",
        userId: fixture.userId,
        schoolId: fixture.schoolId,
        body: {
          status: "Promoted",
          reason: "Admin reviewed results and attendance",
          targetTermId: fixture.targetTermId,
          targetClassId: fixture.targetClassId,
          targetSection: "B",
        },
      },
    );
    expect(review.status).toBe(200);
    await pool.query(
      `UPDATE academic_sessions SET status='ACTIVE',is_current=true WHERE id=$1 AND school_id=$2`,
      [fixture.targetSessionId, fixture.schoolId],
    );
    await pool.query(
      `UPDATE academic_sessions SET is_current=false WHERE id=$1 AND school_id=$2`,
      [fixture.sourceSessionId, fixture.schoolId],
    );
    const path = `/school/academics/promotions/batches/${batchId}/finalize?schoolId=${fixture.schoolId}`;
    const [one, two] = await Promise.all([
      jsonRequest(path, {
        method: "POST",
        userId: fixture.userId,
        schoolId: fixture.schoolId,
        idempotencyKey: "promotion-finalize-key-001",
      }),
      jsonRequest(path, {
        method: "POST",
        userId: fixture.userId,
        schoolId: fixture.schoolId,
        idempotencyKey: "promotion-finalize-key-001",
      }),
    ]);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    const duplicateFinalize = await jsonRequest(path, {
      method: "POST",
      userId: fixture.userId,
      schoolId: fixture.schoolId,
      idempotencyKey: "promotion-finalize-key-002",
    });
    expect(duplicateFinalize.status).toBe(409);
    const live = await pool.query(
      `SELECT id,academic_session_id AS "sessionId",school_class_id AS "classId",section,is_current AS "isCurrent"
         FROM student_class_assignments
        WHERE student_id=$1 AND school_id=$2 ORDER BY id`,
      [fixture.studentIds[0], fixture.schoolId],
    );
    expect(live.rows).toHaveLength(2);
    expect(live.rows[0]).toMatchObject({
      id: sourceAssignment.rows[0].id,
      sessionId: fixture.sourceSessionId,
      isCurrent: false,
    });
    expect(live.rows[1]).toMatchObject({
      sessionId: fixture.targetSessionId,
      classId: fixture.targetClassId,
      section: "B",
      isCurrent: true,
    });
    const cardAfter = await pool.query(
      `SELECT id,uid,status FROM nfc_cards WHERE student_id=$1 AND school_id=$2`,
      [fixture.studentIds[0], fixture.schoolId],
    );
    expect(cardAfter.rows).toEqual(cardBefore.rows);
    const legacyStudent = await pool.query(
      `SELECT class_name AS "className",section FROM students WHERE id=$1 AND school_id=$2`,
      [fixture.studentIds[0], fixture.schoolId],
    );
    expect(legacyStudent.rows[0]).toEqual({ className: "JSS2", section: "B" });
    const historicalEvent = await pool.query(
      `SELECT class_name_snapshot AS "className",section_snapshot AS section
         FROM attendance_events WHERE student_id=$1 AND school_id=$2`,
      [fixture.studentIds[0], fixture.schoolId],
    );
    expect(historicalEvent.rows[0]).toEqual({ className: "JSS1", section: "A" });
    const historicalResult = await pool.query(
      `SELECT student_class_assignment_id AS "assignmentId",
              school_class_id AS "classId",section_snapshot AS section,score::float8 AS score
         FROM academic_results WHERE student_id=$1 AND school_id=$2`,
      [fixture.studentIds[0], fixture.schoolId],
    );
    expect(historicalResult.rows[0]).toEqual({
      assignmentId: sourceAssignment.rows[0].id,
      classId: fixture.sourceClassId,
      section: "A",
      score: 80,
    });
    const history = await jsonRequest(
      `/school/academics/promotions/batches/${batchId}/history?schoolId=${fixture.schoolId}`,
      { userId: fixture.userId, schoolId: fixture.schoolId },
    );
    expect(history.status).toBe(200);
    const historyEntries = z.array(promotionHistoryEntrySchema).parse(history.body);
    expect(historyEntries.map((entry) => entry.eventType)).toEqual(
      expect.arrayContaining(["BATCH_PREPARED", "STUDENT_SNAPSHOTTED", "STUDENT_REVIEWED", "STUDENT_FINALIZED", "BATCH_FINALIZED"]),
    );
    const nfcRecord = await pool.query(
      currentNfcStudentRecordQuery,
      [fixture.schoolId, fixture.studentIds[0]],
    );
    expect(nfcRecord.rows[0]).toMatchObject({
      studentId: fixture.studentIds[0],
      className: "JSS2",
      section: "B",
    });
  });

  it("rolls back every placement mutation when a later student update fails", async () => {
    const fixture = await createFixture(2);
    const preparedResponse = await prepare(fixture, "prepare-promotion-key-04");
    const prepared = promotionBatchDetailSchema.parse(preparedResponse.body);
    for (const studentId of fixture.studentIds) {
      const decision = await jsonRequest(
        `/school/academics/promotions/batches/${prepared.id}/students/${studentId}?schoolId=${fixture.schoolId}`,
        {
          method: "PATCH",
          userId: fixture.userId,
          schoolId: fixture.schoolId,
          body: {
            status: "Promoted",
            reason: "Reviewed before final confirmation",
            targetTermId: fixture.targetTermId,
            targetClassId: fixture.targetClassId,
            targetSection: "B",
          },
        },
      );
      expect(decision.status).toBe(200);
    }
    await pool.query(`UPDATE academic_sessions SET status='ACTIVE',is_current=true WHERE id=$1`, [fixture.targetSessionId]);
    await pool.query(`UPDATE academic_sessions SET is_current=false WHERE id=$1`, [fixture.sourceSessionId]);
    const functionName = `promotion_rollback_${fixture.schoolId}`;
    const triggerName = `promotion_rollback_${fixture.schoolId}`;
    await pool.query(
      `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.id=${fixture.studentIds[1]} AND NEW.class_name='JSS2' THEN
           RAISE EXCEPTION 'promotion integration rollback sentinel';
         END IF;
         RETURN NEW;
       END;
       $$`,
    );
    await pool.query(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    try {
      const failed = await jsonRequest(
        `/school/academics/promotions/batches/${prepared.id}/finalize?schoolId=${fixture.schoolId}`,
        {
          method: "POST",
          userId: fixture.userId,
          schoolId: fixture.schoolId,
          idempotencyKey: "promotion-finalize-key-rollback",
        },
      );
      expect(failed.status).toBe(500);
      const assignments = await pool.query(
        `SELECT count(*)::int AS count FROM student_class_assignments
          WHERE student_id=ANY($1::int[]) AND school_id=$2 AND is_current=true`,
        [fixture.studentIds, fixture.schoolId],
      );
      expect(assignments.rows[0].count).toBe(2);
      const student = await pool.query(
        `SELECT count(*)::int AS count FROM students
          WHERE id=ANY($1::int[]) AND school_id=$2 AND class_name='JSS1' AND section='A'`,
        [fixture.studentIds, fixture.schoolId],
      );
      expect(student.rows[0].count).toBe(2);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON students`);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
  });
});