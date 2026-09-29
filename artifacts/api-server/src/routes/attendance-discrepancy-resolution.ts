import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  AuthError,
  getUserContext,
  requireAuthentication,
} from "../middlewares/auth";

const router = Router();
const run = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch(next);

router.post(
  "/school/attendance/discrepancies/:discrepancyId/resolve",
  requireAuthentication(),
  run(async (req, res) => {
    const discrepancyId = Number(req.params.discrepancyId);
    const schoolId = Number(req.body?.schoolId);
    const status = String(req.body?.status ?? "").toUpperCase();
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!Number.isInteger(discrepancyId) || discrepancyId < 1) {
      throw new AuthError(404, "Attendance discrepancy not found");
    }
    if (!Number.isInteger(schoolId) || schoolId < 1 ||
        !["RESOLVED", "DISMISSED"].includes(status) || reason.length < 3 || reason.length > 500) {
      throw new AuthError(400, "A valid schoolId, terminal status, and reason are required");
    }

    const context = getUserContext(req);
    if (!context.roles.some(
      (assignment) => assignment.role === "SCHOOL_ADMIN" && assignment.status === "ACTIVE",
    )) {
      throw new AuthError(403, "Only school administrators may resolve discrepancies");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        `SELECT id,school_id,status,created_at,attendance_event_id
           FROM attendance_discrepancies
          WHERE id=$1
          FOR UPDATE`,
        [discrepancyId],
      );
      const discrepancy = selected.rows[0];
      if (!discrepancy) throw new AuthError(404, "Attendance discrepancy not found");

      // Deliberately check the persisted school before trusting the request's schoolId.
      // A discrepancy from another tenant is indistinguishable from a missing record.
      const actualSchoolId = Number(discrepancy.school_id);
      if (Number(schoolId) !== actualSchoolId) {
        throw new AuthError(404, "Attendance discrepancy not found", "CROSS_TENANT_ACCESS_ATTEMPT");
      }
      if (!context.roles.some(
        (assignment) => assignment.role === "SCHOOL_ADMIN" &&
          assignment.status === "ACTIVE" && assignment.schoolId === actualSchoolId,
      )) {
        throw new AuthError(404, "Attendance discrepancy not found", "CROSS_TENANT_ACCESS_ATTEMPT");
      }
      if (discrepancy.status !== "OPEN") {
        throw new AuthError(409, "Only open attendance discrepancies can be resolved");
      }

      const updatedResult = await client.query(
        `UPDATE attendance_discrepancies
            SET status=$1,
                resolved_by=$2,
                resolved_at=NOW(),
                details=(CASE
                           WHEN details IS NULL THEN '{}'::jsonb
                           WHEN jsonb_typeof(details)='object' THEN details
                           ELSE jsonb_build_object('originalDetails',details)
                         END)
                  || jsonb_build_object(
                       'reason',$3::text,
                       'previousStatus',$4::text,
                       'newStatus',$1::text,
                       'resolutionHistory',
                       CASE WHEN jsonb_typeof(details->'resolutionHistory')='array'
                            THEN details->'resolutionHistory' ELSE '[]'::jsonb END
                         || jsonb_build_array(jsonb_build_object(
                              'reason',$3::text,
                              'previousStatus',$4::text,
                              'newStatus',$1::text,
                              'resolvedBy',$2::integer,
                              'resolvedAt',NOW()
                            ))
                     )
          WHERE id=$5
          RETURNING id,school_id AS "schoolId",student_id AS "studentId",
                    attendance_event_id AS "attendanceEventId",
                    discrepancy_type AS "discrepancyType",status,details,
                    resolved_by AS "resolvedBy",resolved_at AS "resolvedAt",
                    created_at AS "createdAt"`,
        [status, context.user.id, reason, discrepancy.status, discrepancyId],
      );
      const updated = updatedResult.rows[0];
      await client.query(
        `INSERT INTO audit_logs
          ("user",role,actor_user_id,clerk_user_id,school_id,action,module,
           record_id,event_type,result,metadata)
         VALUES($1,$2,$3,$4,$5,$6,'Attendance',$7,
                'ATTENDANCE_DISCREPANCY_RESOLVED','SUCCESS',$8::jsonb)`,
        [
          context.user.email,
          "SCHOOL_ADMIN",
          context.user.id,
          context.user.clerkUserId,
          actualSchoolId,
          status === "RESOLVED" ? "Resolved attendance discrepancy" : "Dismissed attendance discrepancy",
          discrepancyId,
          JSON.stringify({ reason, previousStatus: discrepancy.status, newStatus: status }),
        ],
      );
      await client.query("COMMIT");

      const history = updated.details?.resolutionHistory ?? [];
      res.json({
        ...updated,
        kind: updated.discrepancyType,
        detectedAt: updated.createdAt,
        resolutionReason: reason,
        resolver: {
          id: context.user.id,
          name: [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email,
          email: context.user.email,
        },
        resolutionHistory: history,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

export default router;