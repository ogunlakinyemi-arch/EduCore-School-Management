import {Router} from "express";
import {z} from "zod";
import {pool} from "@workspace/db";
import {AuthError,getUserContext,isPlatformOwner,requireAuthentication} from "../middlewares/auth";
import {changeFreeTermGrant,freeTermStorageReady,readFreeTermGrant} from "../services/owner-free-academic-terms";
import {lagosDate,studentRolloutDecision} from "../services/student-platform-rollout";
import {readManualSchoolState} from "../services/school-subscription-lock";
import {readSchoolSubscription} from "../services/subscription-enforcement";

export function createOwnerFreeAcademicTermsRouter(db:typeof pool=pool){
  const router=Router();
  router.use("/owner/free-academic-terms",requireAuthentication(),(req,_res,next)=>{
    try{if(!isPlatformOwner(getUserContext(req)))throw new AuthError(403,"Platform Owner permission required");next();}
    catch(e){next(e);}
  });
  router.get("/owner/free-academic-terms",async(req,res,next)=>{
    try{
      const schoolId=z.coerce.number().int().positive().parse(req.query.schoolId);
      if(!(await db.query("SELECT id FROM schools WHERE id=$1",[schoolId])).rows.length)throw new AuthError(404,"School not found");
      const ready=await freeTermStorageReady(db),today=lagosDate();
      const rows=(await db.query(`SELECT t.id,t.academic_session_id AS "sessionId",t.school_id AS "schoolId",t.name,
        s.name AS "sessionName",t.start_date::text AS "startDate",t.end_date::text AS "endDate",
        t.status,s.status AS "sessionStatus",t.is_current AS "isCurrent"
        FROM academic_terms t JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
        WHERE t.school_id=$1 ORDER BY t.start_date DESC,t.id DESC`,[schoolId])).rows;
      const manual=await readManualSchoolState(db,schoolId);
      // The existing summary supplies verified paid coverage; never infer PAID
      // from the existence of a grant, an upload, an invoice or a zero balance.
      const summary=await readSchoolSubscription(db,schoolId);
      const terms=[];
      for(const t of rows){
        const grant=ready?await readFreeTermGrant(db,schoolId,t.id,today):null;
        const launch=studentRolloutDecision(rows,schoolId,t.id,today);
        const paid=!!summary&&summary.termId===t.id&&(summary.studentsTotal??0)>0
          &&summary.studentsPaid===summary.studentsTotal;
        const status=manual.schoolLocked?"SUSPENDED":grant?.status??(paid?"PAID":
          today>t.endDate?"COMPLETED":launch.chargeable?"PAYMENT_REQUIRED":launch.periodEligible?"PAYMENT_REQUIRED":"ACTIVE");
        terms.push({id:t.id,sessionId:t.sessionId,name:t.name,sessionName:t.sessionName,
          startDate:t.startDate,endDate:t.endDate,status,grantId:grant?.id??null,calendarChanged:grant?.calendarChanged??false});
      }
      const history=ready?(await db.query(`SELECT e.id,e.grant_id AS "grantId",e.actor_user_id AS "actorUserId",
        concat_ws(' ',u.first_name,u.last_name) AS "actorName",g.school_id AS "schoolId",
        g.academic_session_id AS "sessionId",g.academic_term_id AS "termId",e.status,e.reason,e.created_at::text AS "createdAt",
        g.start_date::text AS "startDate",g.end_date::text AS "endDate"
        FROM owner_free_academic_term_events e JOIN owner_free_academic_terms g ON g.id=e.grant_id
        JOIN app_users u ON u.id=e.actor_user_id WHERE g.school_id=$1 ORDER BY e.id DESC`,[schoolId])).rows:[];
      res.json({schoolId,ready,terms,history});
    }catch(e){next(e);}
  });
  router.post("/owner/free-academic-terms/:action",async(req,res,next)=>{
    try{
      const action=z.enum(["grant","suspend"]).parse(req.params.action);
      res.json(await changeFreeTermGrant(db,getUserContext(req).user.id,req.body,action));
    }catch(e){next(e);}
  });
  return router;
}
