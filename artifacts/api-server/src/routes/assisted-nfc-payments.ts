import { Router } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { AuthError, assertSchoolOperationalAccess, handleAuthError, requireAuthentication } from "../middlewares/auth";
import { ensureStudentNfcSubscription } from "../lib/student-nfc-obligations";
import { nfcPayableTermPredicate } from "../lib/nfc-payable-term";
import { requireNfcLinkDevelopment } from "../services/nfc-payment-links";
import { createBoundNfcPaymentLink } from "./nfc-payment-links";

const router = Router();
router.use(requireAuthentication());
const schoolQuery = z.object({ schoolId: z.coerce.number().int().positive() }).strict();
const requestBody = z.object({ studentId: z.number().int().positive(), termId: z.number().int().positive() }).strict();

const termsSql = `SELECT t.id,t.academic_session_id AS "sessionId",t.name,
  ses.name AS "sessionName",t.start_date AS "startDate",t.end_date AS "endDate",t.is_current AS "isCurrent"
  FROM academic_terms t JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
  WHERE t.school_id=$1 AND ${nfcPayableTermPredicate}`;

router.get("/student-nfc/assisted-options", async (req, res, next) => {
  try {
    requireNfcLinkDevelopment();
    const { schoolId } = schoolQuery.parse(req.query);
    assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    const [students, terms] = await Promise.all([
      pool.query(
        `SELECT st.id,st.first_name AS "firstName",st.last_name AS "lastName",
          st.admission_no AS "admissionNo",st.class_name AS "className",st.section,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,
            'email',p.email,'phone',p.phone,'relationshipType',rel.relationship_type)
            ORDER BY rel.is_primary_guardian DESC,rel.contact_priority,p.id)
            FROM parent_student_relationships rel JOIN parents p ON p.id=rel.parent_id AND p.school_id=st.school_id
            WHERE rel.student_id=st.id AND rel.status='ACTIVE' AND UPPER(p.status)='ACTIVE'),'[]'::jsonb) AS parents
          FROM students st WHERE st.school_id=$1 AND UPPER(st.status)='ACTIVE'
            AND UPPER(st.admission_status)='ADMITTED' ORDER BY st.first_name,st.last_name,st.id`,
        [schoolId],
      ),
      pool.query(`${termsSql} ORDER BY t.start_date,t.id`, [schoolId]),
    ]);
    res.set("Cache-Control", "no-store").json({ students: students.rows, terms: terms.rows, amountMinor: 500000 });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid assisted NFC request parameters" }); return; }
    handleAuthError(error, req, res, next);
  }
});

router.post("/student-nfc/assisted-requests", async (req, res, next) => {
  try {
    requireNfcLinkDevelopment();
    const { schoolId } = schoolQuery.parse(req.query);
    assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    const input = requestBody.parse(req.body); // No client amount, parent, session, or verification flags.
    const client = await pool.connect();
    let subscriptionId: number;
    let expected: {schoolId:number;studentId:number;sessionId:number;termId:number};
    try {
      await client.query("BEGIN");
      const term = (await client.query(`${termsSql} AND t.id=$2 FOR SHARE OF t,ses`, [schoolId, input.termId])).rows[0];
      if (!term) throw new AuthError(409, "Select the current term or an eligible future term in this school's current session.");
      const student = (await client.query(
        `SELECT id FROM students WHERE id=$1 AND school_id=$2
           AND UPPER(status)='ACTIVE' AND UPPER(admission_status)='ADMITTED' FOR UPDATE`,
        [input.studentId, schoolId],
      )).rows[0];
      if (!student) throw new AuthError(404, "Eligible student not found");
      const subscription = await ensureStudentNfcSubscription(client, schoolId, student.id, term.sessionId, term.id);
      if (!subscription) throw new AuthError(409, "The student's NFC obligation requires review.");
      subscriptionId = Number(subscription.subscriptionId);
      expected={schoolId,studentId:student.id,sessionId:term.sessionId,termId:term.id};
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    // Reuse the guarded reservation/link path. No provider success or receipt is synthesized.
    const link = await createBoundNfcPaymentLink(req, subscriptionId, { termId: input.termId, mode: "FLUTTERWAVE_SANDBOX" },expected);
    res.set("Cache-Control", "no-store").json(link);
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Only valid student and term IDs are accepted; the NFC fee is fixed." }); return; }
    handleAuthError(error, req, res, next);
  }
});

export default router;
