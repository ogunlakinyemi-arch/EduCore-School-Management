import {Router} from "express";
import {pool} from "@workspace/db";
import {AuthError,getUserContext,requireAuthentication} from "../middlewares/auth";
import {communityAccess,communityClosing,busDutySchema,dutyStatus} from "../services/school-community";
import {schoolClock} from "../services/attendance-schedule";

const router=Router();
router.get("/schools/:schoolId/community-dashboard",requireAuthentication(),(req,res,next)=>{
  void (async()=>{
    const schoolId=Number(req.params.schoolId);
    if(!Number.isSafeInteger(schoolId)||schoolId<1)throw new AuthError(400,"Invalid schoolId");
    const ctx=getUserContext(req);
    const access=communityAccess(ctx.roles,schoolId,typeof req.query.view==="string"?req.query.view:"SCHOOL");
    const school=await pool.query("SELECT name FROM schools WHERE id=$1",[schoolId]);
    if(!school.rows[0])throw new AuthError(404,"Resource not found");
    const now=new Date();
    const closing=await communityClosing(pool,schoolId,now);
    const notices=await pool.query(`SELECT ce.id,ce.title,ce.category,
      ce.start_date::text AS "startDate",ce.end_date::text AS "endDate",ce.status,
      COALESCE(notice.created_at,ce.updated_at) AS "changedAt",
      COALESCE(notice.metadata->>'change','CURRENT') AS change
      FROM school_calendar_events ce
      LEFT JOIN LATERAL(SELECT a."timestamp" AS created_at,a.metadata FROM audit_logs a
        WHERE a.school_id=ce.school_id AND a.record_id=ce.id AND a.action='School calendar notice'
          AND a.module='Calendar' ORDER BY a.id DESC LIMIT 1) notice ON true
      WHERE ce.school_id=$1 AND ($2::boolean OR ce.audience && $3::text[])
        AND (COALESCE(ce.end_date,ce.start_date)>=$4::date-30 OR notice.created_at>=$5::timestamptz-interval '14 days')
        AND (ce.status='ACTIVE' OR notice.metadata->>'change'='CANCELLED')
      ORDER BY COALESCE(notice.created_at,ce.updated_at) DESC,ce.id DESC LIMIT 60`,
      [schoolId,access.manager,access.audience,closing.date,now.toISOString()]);
    const rows=await pool.query(`SELECT rs.id,rs.route_id AS "routeId",r.name AS "routeName",
      b.registration_number AS "busIdentifier",rs.role,r.weekdays,h.after_state->'duty' AS duty
      FROM transport_route_staff rs
      JOIN employees e ON e.id=rs.employee_id AND e.school_id=rs.school_id AND UPPER(e.employment_status)='ACTIVE'
      JOIN transport_routes r ON r.id=rs.route_id AND r.school_id=rs.school_id AND r.status='ACTIVE'
      LEFT JOIN transport_buses b ON b.id=r.bus_id AND b.school_id=r.school_id
      LEFT JOIN LATERAL(SELECT th.after_state FROM transport_history th
        WHERE th.school_id=rs.school_id AND th.route_staff_id=rs.id AND th.after_state ? 'duty'
        ORDER BY th.id DESC LIMIT 1) h ON true
      WHERE rs.school_id=$1 AND rs.is_active AND ($2::boolean OR e.user_id=$3)
        AND ($4::boolean) ORDER BY rs.id DESC LIMIT 100`,
      [schoolId,access.manager,ctx.user.id,access.manager||req.query.view===undefined||req.query.view==="SCHOOL"]);
    const at=schoolClock(now,closing.timezone);
    const busDuties=rows.rows.flatMap(row=>{
      const parsed=row.duty?busDutySchema.safeParse(row.duty):null;
      if(parsed&&!parsed.success)throw new AuthError(503,"Saved bus duty period requires administrator review");
      const duty=parsed?.success?parsed.data:null;
      const status=dutyStatus(duty,at.date,at.time,row.weekdays,at.weekday);
      const {weekdays,...safe}=row;
      return status==="EXPIRED"?[]:[{...safe,duty,status}];
    });
    res.set("Cache-Control","private, no-store").json({schoolId,schoolName:school.rows[0].name,asOf:now.toISOString(),closing,
      notices:notices.rows,busDuties});
  })().catch(next);
});
export default router;
