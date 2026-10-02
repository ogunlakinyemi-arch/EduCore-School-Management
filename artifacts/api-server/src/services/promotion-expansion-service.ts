import { z } from "zod";
import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";

export const promotionStatusSchema = z.enum([
  "Pending",
  "Eligible",
  "Promoted",
  "Repeat",
  "Graduated",
  "Withdrawn",
  "Transferred",
]);

export const preparePromotionBatchInputSchema = z.object({
  sourceSessionId: z.number().int().positive(),
  targetSessionId: z.number().int().positive(),
}).strict();

export const promotionReviewInputSchema = z.object({
  status: promotionStatusSchema,
  reason: z.string().trim().min(1).max(1000),
  targetTermId: z.number().int().positive().nullable().optional(),
  targetClassId: z.number().int().positive().nullable().optional(),
  targetSection: z.string().trim().min(1).max(100).nullable().optional(),
}).strict().superRefine((value, context) => {
  const hasTarget = [value.targetTermId, value.targetClassId, value.targetSection]
    .some((part) => part !== undefined && part !== null);
  if (value.status === "Promoted" || value.status === "Repeat") {
    for (const field of ["targetTermId", "targetClassId", "targetSection"] as const) {
      if (value[field] === undefined || value[field] === null) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Promoted and Repeat decisions require a complete target placement",
        });
      }
    }
  } else if (hasTarget) {
    context.addIssue({
      code: "custom",
      path: ["targetClassId"],
      message: "Only Promoted and Repeat decisions may specify a target placement",
    });
  }
});

const placementSchema = z.object({
  sessionId: z.number().int(),
  classId: z.number().int(),
  className: z.string(),
  section: z.string(),
  termId: z.number().int().nullable(),
});

const studentSchema = z.object({
  studentId: z.number().int(),
  studentName: z.string(),
  admissionNumber: z.string(),
  sourcePlacement: placementSchema,
  targetPlacement: placementSchema.nullable(),
  status: promotionStatusSchema,
  recommendation: z.enum(["Pending", "Eligible"]),
  reason: z.string().nullable(),
  academicPerformance: z.object({
    resultCount: z.number().int(),
    scoredCount: z.number().int(),
    averageScore: z.number().nullable(),
  }),
  attendanceSummary: z.object({
    presentCount: z.number().int(),
    absentCount: z.number().int(),
    lateCount: z.number().int(),
    recordedCount: z.number().int(),
    attendanceRate: z.number().nullable(),
  }),
}).superRefine((value, context) => {
  const requiresTarget = value.status === "Promoted" || value.status === "Repeat";
  if (requiresTarget !== (value.targetPlacement !== null)) {
    context.addIssue({
      code: "custom",
      path: ["targetPlacement"],
      message: "Only Promoted and Repeat decisions have a target placement",
    });
  }
});

export const promotionBatchSchema = z.object({
  id: z.number().int(),
  schoolId: z.number().int(),
  sourceSessionId: z.number().int(),
  targetSessionId: z.number().int(),
  status: z.enum(["Prepared", "Finalized"]),
  createdAt: z.string().datetime(),
  finalizedAt: z.string().datetime().nullable(),
  studentCount: z.number().int(),
});

export const promotionBatchDetailSchema = promotionBatchSchema.extend({
  students: z.array(studentSchema),
});
export const promotionHistoryEntrySchema = z.object({
  id: z.number().int(),
  batchId: z.number().int(),
  batchStudentId: z.number().int().nullable(),
  studentId: z.number().int().nullable(),
  actorUserId: z.number().int().nullable(),
  eventType: z.enum([
    "BATCH_PREPARED",
    "STUDENT_SNAPSHOTTED",
    "STUDENT_REVIEWED",
    "STUDENT_FINALIZED",
    "BATCH_FINALIZED",
    "FINALIZATION_REJECTED",
  ]),
  result: z.enum(["SUCCESS", "REJECTED"]),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export type PreparePromotionBatchInput = z.infer<typeof preparePromotionBatchInputSchema>;
export type PromotionReviewInput = z.infer<typeof promotionReviewInputSchema>;
export type PromotionBatchDetail = z.infer<typeof promotionBatchDetailSchema>;
export type PreparePromotionBatchResult = { batch: PromotionBatchDetail; replayed: boolean };

type Actor = {
  userId: number;
  clerkUserId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

function asDateTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metrics<T>(value: unknown, schema: z.ZodType<T>): T {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new AuthError(500, "Stored promotion summary is invalid");
    }
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new AuthError(500, "Stored promotion summary is invalid");
  return result.data;
}

const academicSummarySchema = z.object({
  resultCount: z.number().int(),
  scoredCount: z.number().int(),
  averageScore: z.number().nullable(),
});
const attendanceSummarySchema = z.object({
  presentCount: z.number().int(),
  absentCount: z.number().int(),
  lateCount: z.number().int(),
  recordedCount: z.number().int(),
  attendanceRate: z.number().nullable(),
});

function mapStudent(row: any) {
  const sourcePlacement = {
    sessionId: num(row.sourceSessionId),
    classId: num(row.sourceClassId),
    className: String(row.sourceClassName),
    section: String(row.sourceSection),
    termId: row.sourceTermId === null || row.sourceTermId === undefined ? null : num(row.sourceTermId),
  };
  const targetPlacement = row.targetClassId === null || row.targetClassId === undefined
    ? null
    : {
        sessionId: num(row.targetSessionId),
        classId: num(row.targetClassId),
        className: String(row.targetClassName),
        section: String(row.targetSection),
        termId: num(row.targetTermId),
      };
  return studentSchema.parse({
    studentId: num(row.studentId),
    studentName: String(row.studentName),
    admissionNumber: String(row.admissionNumber),
    sourcePlacement,
    targetPlacement,
    status: row.status,
    recommendation: row.recommendation,
    reason: row.reason ?? null,
    academicPerformance: metrics(row.academicPerformance, academicSummarySchema),
    attendanceSummary: metrics(row.attendanceSummary, attendanceSummarySchema),
  });
}

async function selectBatch(client: any, schoolId: number, batchId: number, lock = false) {
  const batchResult = await client.query(
    `SELECT b.id,b.school_id AS "schoolId",b.source_session_id AS "sourceSessionId",
            b.target_session_id AS "targetSessionId",b.status,b.created_at AS "createdAt",
            b.finalized_at AS "finalizedAt"
       FROM promotion_batches b
      WHERE b.id=$1 AND b.school_id=$2 ${lock ? "FOR UPDATE" : ""}`,
    [batchId, schoolId],
  );
  const batch = batchResult.rows[0];
  if (!batch) throw new AuthError(404, "Promotion batch not found");
  const result = await client.query(
    `SELECT item.student_id AS "studentId",
            item.student_name_snapshot AS "studentName",
            item.admission_no_snapshot AS "admissionNumber",
            item.source_session_id AS "sourceSessionId",
            item.source_class_id AS "sourceClassId",item.source_class_name AS "sourceClassName",
            item.source_section AS "sourceSection",item.source_term_id AS "sourceTermId",
            item.status,item.recommendation,item.reason,
            item.academic_performance AS "academicPerformance",
            item.attendance_summary AS "attendanceSummary",
            item.target_class_id AS "targetClassId",target_class.name AS "targetClassName",
            item.target_section AS "targetSection",item.target_term_id AS "targetTermId",
            b.target_session_id AS "targetSessionId"
       FROM promotion_batch_students item
       JOIN students st ON st.id=item.student_id AND st.school_id=item.school_id
       JOIN promotion_batches b ON b.id=item.batch_id AND b.school_id=item.school_id
       LEFT JOIN school_classes target_class
         ON target_class.id=item.target_class_id AND target_class.school_id=item.school_id
      WHERE item.batch_id=$1 AND item.school_id=$2
      ORDER BY item.student_id`,
    [batchId, schoolId],
  );
  const output = {
    id: num(batch.id),
    schoolId: num(batch.schoolId),
    sourceSessionId: num(batch.sourceSessionId),
    targetSessionId: num(batch.targetSessionId),
    status: batch.status === "FINALIZED" ? "Finalized" : "Prepared",
    createdAt: asDateTime(batch.createdAt),
    finalizedAt: asDateTime(batch.finalizedAt),
    studentCount: result.rows.length,
    students: result.rows.map(mapStudent),
  };
  return promotionBatchDetailSchema.parse(output);
}

async function withTransaction<T>(fn: (client: any) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const output = await fn(client);
    await client.query("COMMIT");
    return output;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the business/database failure that caused rollback.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function addHistory(
  client: any,
  values: {
    schoolId: number;
    batchId?: number | null;
    batchStudentId?: number | null;
    studentId?: number | null;
    actorUserId?: number | null;
    eventType: string;
    result?: "SUCCESS" | "REJECTED";
    metadata?: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO promotion_history
       (school_id,batch_id,batch_student_id,student_id,actor_user_id,event_type,result,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      values.schoolId, values.batchId ?? null, values.batchStudentId ?? null,
      values.studentId ?? null, values.actorUserId ?? null, values.eventType,
      values.result ?? "SUCCESS", JSON.stringify(values.metadata ?? {}),
    ],
  );
}

async function addAuditLog(
  client: any,
  schoolId: number,
  actor: Actor,
  action: string,
  recordId: number,
  metadata: Record<string, unknown>,
) {
  const name = [actor.firstName, actor.lastName].filter(Boolean).join(" ") || actor.email;
  await client.query(
    `INSERT INTO audit_logs
       ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
        severity,event_type,result,metadata)
     VALUES($1,'SCHOOL_ADMIN',$2,$3,$4,$5,'Academics',$6,'info','STUDENT_PROMOTION','SUCCESS',$7::jsonb)`,
    [name, actor.userId, actor.clerkUserId, schoolId, action, recordId, JSON.stringify(metadata)],
  );
}

export async function preparePromotionBatch(
  schoolId: number,
  input: PreparePromotionBatchInput,
  idempotencyKey: string,
  actor: Actor,
) : Promise<PreparePromotionBatchResult> {
  try {
    return await withTransaction(async (client) => {
    const sessions = await client.query(
      `SELECT id,name,start_date AS "startDate",status,is_current AS "isCurrent"
         FROM academic_sessions
        WHERE school_id=$1 AND id=ANY($2::int[])
        ORDER BY id FOR UPDATE`,
      [schoolId, [input.sourceSessionId, input.targetSessionId]],
    );
    if (sessions.rows.length !== 2) throw new AuthError(404, "Academic session not found in this school");
    const source = sessions.rows.find((session: any) => Number(session.id) === input.sourceSessionId);
    const target = sessions.rows.find((session: any) => Number(session.id) === input.targetSessionId);
    if (!source || !target || input.sourceSessionId === input.targetSessionId) {
      throw new AuthError(400, "Source and target sessions must be different sessions in this school");
    }
    if (String(target.startDate) <= String(source.startDate)) {
      throw new AuthError(400, "Target session must start after the source session");
    }
    const priorKey = await client.query(
      `SELECT id,source_session_id AS "sourceSessionId",target_session_id AS "targetSessionId"
         FROM promotion_batches
        WHERE school_id=$1 AND idempotency_actor_user_id=$2 AND idempotency_key=$3`,
      [schoolId, actor.userId, idempotencyKey],
    );
    if (priorKey.rows[0]) {
      const existing = priorKey.rows[0];
      if (Number(existing.sourceSessionId) !== input.sourceSessionId ||
          Number(existing.targetSessionId) !== input.targetSessionId) {
        throw new AuthError(409, "Idempotency-Key was already used for a different preparation");
      }
      return { batch: await selectBatch(client, schoolId, Number(existing.id)), replayed: true };
    }
    const priorPair = await client.query(
      `SELECT id FROM promotion_batches
        WHERE school_id=$1 AND source_session_id=$2 AND target_session_id=$3`,
      [schoolId, input.sourceSessionId, input.targetSessionId],
    );
    if (priorPair.rows[0]) {
      throw new AuthError(409, "A promotion batch already exists for this session pair");
    }
    if (source.status !== "ACTIVE" || source.isCurrent !== true) {
      throw new AuthError(409, "The source session is no longer the current active school session");
    }

    const placements = await client.query(
      `SELECT st.id AS "studentId",st.admission_no AS "admissionNumber",
              trim(concat_ws(' ',st.first_name,st.middle_name,st.last_name)) AS "studentName",
              a.id AS "assignmentId",a.academic_session_id AS "sessionId",
              a.academic_term_id AS "termId",a.school_class_id AS "classId",
              cl.name AS "className",a.section,
              source_term.academic_session_id AS "sourceTermSessionId"
         FROM students st
         JOIN student_class_assignments a
           ON a.student_id=st.id AND a.school_id=st.school_id
         JOIN school_classes cl ON cl.id=a.school_class_id AND cl.school_id=a.school_id
         LEFT JOIN academic_terms source_term
           ON source_term.id=a.academic_term_id AND source_term.school_id=a.school_id
        WHERE st.school_id=$1 AND a.academic_session_id=$2
          AND a.status='ACTIVE' AND a.is_current=true
          AND lower(st.status)='active'
        ORDER BY st.id
        FOR UPDATE OF st,a`,
      [schoolId, input.sourceSessionId],
    );
    const studentIds = placements.rows.map((row: any) => Number(row.studentId));
    if (new Set(studentIds).size !== studentIds.length) {
      throw new AuthError(409, "A student has multiple current placements; resolve the placement conflict before preparing a batch");
    }
    if (placements.rows.some((row: any) => row.termId !== null &&
        Number(row.sourceTermSessionId) !== input.sourceSessionId)) {
      throw new AuthError(409, "A source placement uses a term outside its academic session");
    }
    const resultRows = studentIds.length
      ? await client.query(
          `SELECT student_id AS "studentId",COUNT(*)::int AS "resultCount",
                  COUNT(score)::int AS "scoredCount",
                  AVG((score / NULLIF(max_score,0)) * 100)::float8 AS "averageScore"
             FROM academic_results
            WHERE school_id=$1 AND academic_session_id=$2 AND student_id=ANY($3::int[])
              AND status='PUBLISHED'
            GROUP BY student_id`,
          [schoolId, input.sourceSessionId, studentIds],
        )
      : { rows: [] };
    const attendanceRows = studentIds.length
      ? await client.query(
          `WITH daily AS (
             SELECT DISTINCT ON (student_id,event_date)
                    student_id,event_date,attendance_status
               FROM attendance_events
              WHERE school_id=$1 AND academic_session_id=$2 AND student_id=ANY($3::int[])
                AND result IN ('SUCCESS','ACCEPTED') AND event_type='SCHOOL_ENTRY'
              ORDER BY student_id,event_date,occurred_at DESC,id DESC
           )
           SELECT student_id AS "studentId",
                  COUNT(*) FILTER(WHERE attendance_status IN ('PRESENT','LEFT_EARLY'))::int AS "presentCount",
                  COUNT(*) FILTER(WHERE attendance_status='ABSENT')::int AS "absentCount",
                  COUNT(*) FILTER(WHERE attendance_status='LATE')::int AS "lateCount",
                  COUNT(*) FILTER(WHERE attendance_status IN ('PRESENT','ABSENT','LATE','LEFT_EARLY'))::int AS "recordedCount"
             FROM daily GROUP BY student_id`,
          [schoolId, input.sourceSessionId, studentIds],
        )
      : { rows: [] };
    const resultsByStudent = new Map<number, any>(
      resultRows.rows.map((row: any): [number, any] => [Number(row.studentId), row]),
    );
    const attendanceByStudent = new Map<number, any>(
      attendanceRows.rows.map((row: any): [number, any] => [Number(row.studentId), row]),
    );

    const batchResult = await client.query(
      `INSERT INTO promotion_batches
         (school_id,source_session_id,target_session_id,idempotency_actor_user_id,idempotency_key,prepared_by)
       VALUES($1,$2,$3,$4,$5,$4)
       RETURNING id`,
      [schoolId, input.sourceSessionId, input.targetSessionId, actor.userId, idempotencyKey],
    );
    const batchId = Number(batchResult.rows[0].id);

    for (const placement of placements.rows) {
      const result = resultsByStudent.get(Number(placement.studentId)) as any | undefined;
      const attendance = attendanceByStudent.get(Number(placement.studentId)) as any | undefined;
      const performance = {
        resultCount: num(result?.resultCount),
        scoredCount: num(result?.scoredCount),
        averageScore: result?.averageScore === null || result?.averageScore === undefined
          ? null
          : Number(Number(result.averageScore).toFixed(2)),
      };
      const attendanceSummary = {
        presentCount: num(attendance?.presentCount),
        absentCount: num(attendance?.absentCount),
        lateCount: num(attendance?.lateCount),
        recordedCount: num(attendance?.recordedCount),
        attendanceRate: num(attendance?.recordedCount) === 0
          ? null
          : Number(((num(attendance?.presentCount) + num(attendance?.lateCount)) /
            num(attendance?.recordedCount) * 100).toFixed(2)),
      };
      const recommended = performance.resultCount > 0 &&
        performance.averageScore !== null && performance.averageScore >= 50 &&
        attendanceSummary.attendanceRate !== null && attendanceSummary.attendanceRate >= 75
        ? "Eligible"
        : "Pending";
      const itemResult = await client.query(
        `INSERT INTO promotion_batch_students
           (school_id,batch_id,student_id,student_name_snapshot,admission_no_snapshot,
            source_assignment_id,source_session_id,source_term_id,
            source_class_id,source_class_name,source_section,recommendation,status,
            academic_performance,attendance_summary)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13::jsonb,$14::jsonb)
         RETURNING id`,
        [
          schoolId, batchId, placement.studentId, placement.studentName, placement.admissionNumber,
          placement.assignmentId, placement.sessionId, placement.termId, placement.classId,
          placement.className, placement.section, recommended,
          JSON.stringify(performance), JSON.stringify(attendanceSummary),
        ],
      );
      await addHistory(client, {
        schoolId,
        batchId,
        batchStudentId: Number(itemResult.rows[0].id),
        studentId: Number(placement.studentId),
        actorUserId: actor.userId,
        eventType: "STUDENT_SNAPSHOTTED",
        metadata: { phase: "SNAPSHOT_CREATED", recommendation: recommended },
      });
    }
    await addHistory(client, {
      schoolId,
      batchId,
      actorUserId: actor.userId,
      eventType: "BATCH_PREPARED",
      metadata: {
        sourceSessionId: input.sourceSessionId,
        targetSessionId: input.targetSessionId,
        studentCount: placements.rows.length,
        placementOnly: true,
      },
    });
    await addAuditLog(client, schoolId, actor, "Prepared student promotion batch", batchId, {
      sourceSessionId: input.sourceSessionId,
      targetSessionId: input.targetSessionId,
      studentCount: placements.rows.length,
    });
    return { batch: await selectBatch(client, schoolId, batchId), replayed: false };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error &&
        (error as { code?: string }).code === "23505") {
      const prior = await pool.query(
        `SELECT id,source_session_id AS "sourceSessionId",target_session_id AS "targetSessionId"
           FROM promotion_batches
          WHERE school_id=$1 AND idempotency_actor_user_id=$2 AND idempotency_key=$3`,
        [schoolId, actor.userId, idempotencyKey],
      );
      if (prior.rows[0] &&
          Number(prior.rows[0].sourceSessionId) === input.sourceSessionId &&
          Number(prior.rows[0].targetSessionId) === input.targetSessionId) {
        return { batch: await selectBatch(pool, schoolId, Number(prior.rows[0].id)), replayed: true };
      }
      throw new AuthError(409, "A promotion batch already exists or the idempotency key conflicts");
    }
    throw error;
  }
}

export async function listPromotionBatches(schoolId: number, limit: number) {
  const result = await pool.query(
    `SELECT b.id,b.school_id AS "schoolId",b.source_session_id AS "sourceSessionId",
            b.target_session_id AS "targetSessionId",b.status,b.created_at AS "createdAt",
            b.finalized_at AS "finalizedAt",COUNT(item.id)::int AS "studentCount"
       FROM promotion_batches b
       LEFT JOIN promotion_batch_students item
         ON item.batch_id=b.id AND item.school_id=b.school_id
      WHERE b.school_id=$1
      GROUP BY b.id
      ORDER BY b.created_at DESC,b.id DESC LIMIT $2`,
    [schoolId, limit],
  );
  return result.rows.map((row: any) => promotionBatchSchema.parse({
    id: num(row.id),
    schoolId: num(row.schoolId),
    sourceSessionId: num(row.sourceSessionId),
    targetSessionId: num(row.targetSessionId),
    status: row.status === "FINALIZED" ? "Finalized" : "Prepared",
    createdAt: asDateTime(row.createdAt),
    finalizedAt: asDateTime(row.finalizedAt),
    studentCount: num(row.studentCount),
  }));
}

export async function getPromotionBatch(schoolId: number, batchId: number) {
  return selectBatch(pool, schoolId, batchId);
}

async function assertSourcePlacementUnchanged(
  client: any,
  schoolId: number,
  batchId: number,
  studentId: number,
) {
  const student = await client.query(
    `SELECT lower(status) AS status FROM students
      WHERE id=$1 AND school_id=$2 FOR UPDATE`,
    [studentId, schoolId],
  );
  if (student.rows[0]?.status !== "active") {
    throw new AuthError(409, "Student lifecycle changed after batch preparation");
  }
  const result = await client.query(
    `SELECT item.id AS "batchStudentId",item.source_assignment_id AS "sourceAssignmentId",
            item.source_session_id AS "sourceSessionId",item.source_term_id AS "sourceTermId",
            item.source_class_id AS "sourceClassId",item.source_section AS "sourceSection"
       FROM promotion_batch_students item
      WHERE item.batch_id=$1 AND item.school_id=$2 AND item.student_id=$3
      FOR UPDATE`,
    [batchId, schoolId, studentId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthError(404, "Student is not part of this promotion batch");
  const placement = await client.query(
    `SELECT academic_session_id AS "liveSessionId",academic_term_id AS "liveTermId",
            school_class_id AS "liveClassId",section AS "liveSection"
       FROM student_class_assignments
      WHERE id=$1 AND school_id=$2 AND student_id=$3 AND is_current=true AND status='ACTIVE'
      FOR UPDATE`,
    [row.sourceAssignmentId, schoolId, studentId],
  );
  const live = placement.rows[0];
  if (!live || Number(row.sourceSessionId) !== Number(live.liveSessionId) ||
      Number(row.sourceClassId) !== Number(live.liveClassId) ||
      String(row.sourceSection) !== String(live.liveSection) ||
      (row.sourceTermId === null
        ? live.liveTermId !== null
        : Number(row.sourceTermId) !== Number(live.liveTermId))) {
    throw new AuthError(409, "Student placement changed after batch preparation; prepare a new batch");
  }
  return row;
}

async function validateTarget(
  client: any,
  schoolId: number,
  targetSessionId: number,
  targetTermId: number | null,
  targetClassId: number | null,
  targetSection: string | null,
) {
  if (!targetTermId || !targetClassId || !targetSection) {
    throw new AuthError(400, "Promoted and Repeat decisions require target term, class, and section");
  }
  const target = await client.query(
    `SELECT c.id AS "classId",c.name AS "className",c.section,
            t.id AS "termId",t.academic_session_id AS "sessionId"
       FROM school_classes c
       JOIN academic_terms t ON t.id=$4 AND t.school_id=c.school_id
      WHERE c.school_id=$1 AND c.id=$2 AND c.section=$3
        AND t.academic_session_id=$5`,
    [schoolId, targetClassId, targetSection, targetTermId, targetSessionId],
  );
  if (!target.rows[0]) {
    throw new AuthError(400, "Target class, section, and term must exist in the target session and school");
  }
  return target.rows[0];
}

export async function reviewPromotionDecision(
  schoolId: number,
  batchId: number,
  studentId: number,
  input: PromotionReviewInput,
  actor: Actor,
) {
  return withTransaction(async (client) => {
    const batch = await client.query(
      `SELECT status,target_session_id AS "targetSessionId"
         FROM promotion_batches WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [batchId, schoolId],
    );
    if (!batch.rows[0]) throw new AuthError(404, "Promotion batch not found");
    if (batch.rows[0].status !== "PREPARED") throw new AuthError(409, "Finalized promotion batches cannot be changed");
    const snapshot = await assertSourcePlacementUnchanged(client, schoolId, batchId, studentId);

    let target: any = null;
    const targetTermId = input.targetTermId ?? null;
    const targetClassId = input.targetClassId ?? null;
    const targetSection = input.targetSection ?? null;
    if (input.status === "Promoted" || input.status === "Repeat") {
      target = await validateTarget(
        client, schoolId, Number(batch.rows[0].targetSessionId),
        targetTermId, targetClassId, targetSection,
      );
    } else if (targetTermId !== null || targetClassId !== null || targetSection !== null) {
      throw new AuthError(400, "Only Promoted and Repeat decisions may specify a target placement");
    }
    const updated = await client.query(
      `UPDATE promotion_batch_students
          SET status=$1,reason=$2,target_term_id=$3,target_class_id=$4,target_section=$5,
              reviewed_by=$6,reviewed_at=now()
        WHERE id=$7 AND school_id=$8
        RETURNING id`,
      [
        input.status, input.reason, targetTermId, targetClassId, targetSection,
        actor.userId, snapshot.batchStudentId, schoolId,
      ],
    );
    if (!updated.rows[0]) throw new AuthError(404, "Student is not part of this promotion batch");
    await addHistory(client, {
      schoolId,
      batchId,
      batchStudentId: Number(snapshot.batchStudentId),
      studentId,
      actorUserId: actor.userId,
      eventType: "STUDENT_REVIEWED",
      metadata: {
        status: input.status,
        reason: input.reason,
        targetPlacement: target ? {
          sessionId: Number(target.sessionId),
          termId: Number(target.termId),
          classId: Number(target.classId),
          className: target.className,
          section: target.section,
        } : null,
      },
    });
    await addAuditLog(client, schoolId, actor, "Reviewed student promotion decision", Number(snapshot.batchStudentId), {
      batchId, studentId, status: input.status, reason: input.reason,
      targetPlacement: target ? {
        sessionId: Number(target.sessionId), termId: Number(target.termId),
        classId: Number(target.classId), section: target.section,
      } : null,
    });
    const detail = await selectBatch(client, schoolId, batchId);
    const student = detail.students.find((candidate) => candidate.studentId === studentId);
    if (!student) throw new AuthError(500, "Reviewed student was not returned");
    return student;
  });
}

async function logFinalizationRejection(
  schoolId: number,
  batchId: number,
  actor: Actor,
  error: unknown,
) {
  if (!(error instanceof AuthError) || error.statusCode !== 409) return;
  try {
    await addHistory(pool, {
      schoolId,
      batchId,
      actorUserId: actor.userId,
      eventType: "FINALIZATION_REJECTED",
      result: "REJECTED",
      metadata: { reason: error.message },
    });
  } catch {
    // The rejection response remains authoritative if history storage is temporarily unavailable.
  }
}

export async function finalizePromotionBatch(
  schoolId: number,
  batchId: number,
  idempotencyKey: string,
  actor: Actor,
) {
  try {
    return await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT id,status,source_session_id AS "sourceSessionId",
                target_session_id AS "targetSessionId",
                finalization_actor_user_id AS "finalizationActorUserId",
                finalization_idempotency_key AS "finalizationIdempotencyKey"
           FROM promotion_batches WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [batchId, schoolId],
      );
      const batch = result.rows[0];
      if (!batch) throw new AuthError(404, "Promotion batch not found");
      if (batch.status === "FINALIZED") {
        if (Number(batch.finalizationActorUserId) === actor.userId &&
            batch.finalizationIdempotencyKey === idempotencyKey) {
          return selectBatch(client, schoolId, batchId);
        }
        throw new AuthError(409, "Promotion batch has already been finalized");
      }

      const target = await client.query(
        `SELECT id FROM academic_sessions
          WHERE id=$1 AND school_id=$2 AND status='ACTIVE' AND is_current=true
          FOR UPDATE`,
        [batch.targetSessionId, schoolId],
      );
      if (!target.rows[0]) {
        throw new AuthError(409, "Target session is not the current active school calendar; activate it through the reviewed school calendar workflow before finalizing");
      }
      const itemsResult = await client.query(
        `SELECT id,student_id AS "studentId",status,reviewed_at AS "reviewedAt",
                target_term_id AS "targetTermId",target_class_id AS "targetClassId",
                target_section AS "targetSection",reason
           FROM promotion_batch_students
          WHERE batch_id=$1 AND school_id=$2 ORDER BY student_id FOR UPDATE`,
        [batchId, schoolId],
      );
      const items = itemsResult.rows;
      if (!items.length || items.some((item: any) =>
        !item.reviewedAt || !["Promoted", "Repeat", "Graduated", "Withdrawn", "Transferred"].includes(item.status),
      )) {
        throw new AuthError(409, "Every student must have a reviewed final outcome before batch finalization");
      }

      const studentIds = items.map((item: any) => Number(item.studentId));
      const studentLocks = await client.query(
        `SELECT id FROM students WHERE school_id=$1 AND id=ANY($2::int[])
          ORDER BY id FOR UPDATE`,
        [schoolId, studentIds],
      );
      if (studentLocks.rows.length !== studentIds.length) {
        throw new AuthError(409, "A student in this batch no longer exists in the source school");
      }
      for (const item of items) {
        await assertSourcePlacementUnchanged(client, schoolId, batchId, Number(item.studentId));
        if (item.status === "Promoted" || item.status === "Repeat") {
          await validateTarget(
            client, schoolId, Number(batch.targetSessionId), Number(item.targetTermId),
            Number(item.targetClassId), String(item.targetSection),
          );
        }
      }
      const keyConflict = await client.query(
        `SELECT id FROM promotion_batches
          WHERE school_id=$1 AND finalization_actor_user_id=$2
            AND finalization_idempotency_key=$3 AND id<>$4`,
        [schoolId, actor.userId, idempotencyKey, batchId],
      );
      if (keyConflict.rows[0]) throw new AuthError(409, "Idempotency-Key was already used for another promotion finalization");

      const outcomes: Array<Record<string, unknown>> = [];
      for (const item of items) {
        const studentId = Number(item.studentId);
        let newAssignmentId: number | null = null;
        if (item.status === "Promoted" || item.status === "Repeat") {
          await client.query(
            `UPDATE student_class_assignments
                SET is_current=false,status='INACTIVE',
                    end_date=COALESCE(end_date,CURRENT_DATE),updated_at=now()
              WHERE student_id=$1 AND school_id=$2 AND is_current=true AND status='ACTIVE'`,
            [studentId, schoolId],
          );
          const placement = await client.query(
            `INSERT INTO student_class_assignments
               (school_id,student_id,academic_session_id,academic_term_id,
                school_class_id,section,status,is_current,start_date)
             VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',true,CURRENT_DATE)
             RETURNING id`,
            [schoolId, studentId, batch.targetSessionId, item.targetTermId, item.targetClassId, item.targetSection],
          );
          newAssignmentId = Number(placement.rows[0].id);
          const targetClass = await client.query(
            `SELECT name FROM school_classes WHERE id=$1 AND school_id=$2`,
            [item.targetClassId, schoolId],
          );
          await client.query(
            `UPDATE students SET class_name=$1,section=$2,updated_at=now()
              WHERE id=$3 AND school_id=$4`,
            [targetClass.rows[0].name, item.targetSection, studentId, schoolId],
          );
        } else {
          await client.query(
            `UPDATE student_class_assignments
                SET is_current=false,status='INACTIVE',
                    end_date=COALESCE(end_date,CURRENT_DATE),updated_at=now()
              WHERE student_id=$1 AND school_id=$2 AND is_current=true AND status='ACTIVE'`,
            [studentId, schoolId],
          );
        }
        if (["Graduated", "Withdrawn", "Transferred"].includes(item.status)) {
          await client.query(
            `UPDATE students SET status=lower($1),updated_at=now()
              WHERE id=$2 AND school_id=$3`,
            [item.status, studentId, schoolId],
          );
        }
        await client.query(
          `UPDATE promotion_batch_students SET finalized_at=now() WHERE id=$1 AND school_id=$2`,
          [item.id, schoolId],
        );
        const outcome = {
          studentId,
          status: item.status,
          reason: item.reason,
          sourceSessionId: Number(batch.sourceSessionId),
          targetSessionId: Number(batch.targetSessionId),
          newAssignmentId,
          permanentIdentityPreserved: true,
          nfcIdentityChanged: false,
        };
        outcomes.push(outcome);
        await addHistory(client, {
          schoolId,
          batchId,
          batchStudentId: Number(item.id),
          studentId,
          actorUserId: actor.userId,
          eventType: "STUDENT_FINALIZED",
          metadata: outcome,
        });
        await addAuditLog(client, schoolId, actor, "Finalized student promotion outcome", Number(item.id), outcome);
      }
      await client.query(
        `UPDATE promotion_batches
            SET status='FINALIZED',finalized_by=$1,finalized_at=now(),
                finalization_actor_user_id=$1,finalization_idempotency_key=$2
          WHERE id=$3 AND school_id=$4`,
        [actor.userId, idempotencyKey, batchId, schoolId],
      );
      await addHistory(client, {
        schoolId,
        batchId,
        actorUserId: actor.userId,
        eventType: "BATCH_FINALIZED",
        metadata: { outcomeCount: outcomes.length, outcomes },
      });
      await addAuditLog(client, schoolId, actor, "Finalized student promotion batch", batchId, {
        outcomeCount: outcomes.length,
        outcomes,
      });
      return selectBatch(client, schoolId, batchId);
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error &&
        (error as { code?: string }).code === "23505") {
      const conflict = new AuthError(409, "Idempotency-Key was already used for another promotion finalization");
      await logFinalizationRejection(schoolId, batchId, actor, conflict);
      throw conflict;
    }
    await logFinalizationRejection(schoolId, batchId, actor, error);
    throw error;
  }
}

export async function getPromotionHistory(schoolId: number, batchId: number) {
  const result = await pool.query(
    `SELECT id,batch_id AS "batchId",batch_student_id AS "batchStudentId",
            student_id AS "studentId",actor_user_id AS "actorUserId",
            event_type AS "eventType",result,metadata,created_at AS "createdAt"
       FROM promotion_history
      WHERE school_id=$1 AND batch_id=$2
      ORDER BY created_at,id`,
    [schoolId, batchId],
  );
  return result.rows.map((row: any) => promotionHistoryEntrySchema.parse({
    id: num(row.id),
    batchId: num(row.batchId),
    batchStudentId: row.batchStudentId === null ? null : num(row.batchStudentId),
    studentId: row.studentId === null ? null : num(row.studentId),
    actorUserId: row.actorUserId === null ? null : num(row.actorUserId),
    eventType: row.eventType,
    result: row.result,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
    createdAt: asDateTime(row.createdAt),
  }));
}