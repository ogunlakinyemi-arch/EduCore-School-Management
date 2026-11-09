import {Router} from "express";
import {pool,type DatabasePoolClient} from "@workspace/db";
import {z} from "zod";
import {assertRoles,getUserContext,requireAuthentication} from "../middlewares/auth";
import {assertTestArchiveAccess} from "../services/test-account-archive-access";
import {broLeadInput,broTransferInput,broDecisionInput,broLeadView,broLeadAccess,broTransferView,broCalendarDay,
  BroFieldError,type BroActor,developmentBroField,eligibleBro,saveBroLead,requestBroTransfer,decideBroTransfer} from "../services/bro-field-operations";
const router=Router();
router.use("/bro-field",requireAuthentication(),async(req,res,next)=>{
  try{
    if(!developmentBroField())throw new BroFieldError(404,"BRO field operations are available in Development only");
    const ctx=assertRoles(req,["PARTNER","PLATFORM_OWNER"]);
    const owner=ctx.roles.some(r=>r.role==="PLATFORM_OWNER"&&r.status==="ACTIVE");
    if(!owner){
      if(!await eligibleBro(pool,ctx.user.id))throw new BroFieldError(403,"Active BRO account required");
      const p=(await pool.query(`SELECT p.id FROM partner_profiles p WHERE p.status='ACTIVE'
        AND (p.user_id=$1 OR EXISTS(SELECT 1 FROM partner_profile_users u
          WHERE u.partner_profile_id=p.id AND u.user_id=$1 AND u.status='ACTIVE')) LIMIT 1`,[ctx.user.id])).rows[0];
      await assertTestArchiveAccess({partnerId:p.id});
    }
    res.locals.broActor={id:ctx.user.id,owner,email:ctx.user.email} satisfies BroActor;next();
  }catch(e){fail(res,e);}
});
function fail(res:any,e:any){
  res.status(e instanceof BroFieldError?e.status:e.statusCode??(e instanceof z.ZodError?400:
    e.code==="23505"?409:e.code==="42P01"?503:500)).json({error:e instanceof BroFieldError?e.message:
      e instanceof z.ZodError?"Check the required fields, valid dates and existing-school link for Adopted":
      e.code==="23505"?"Duplicate claim or pending transfer; ask the Owner to review":
      e.code==="42P01"?"Development field-operations migration has not been applied":
      e.statusCode===403?"Access denied":"Field operation was not confirmed; refresh before retrying"});
}
const actor=(res:any)=>res.locals.broActor as BroActor;
const id=(v:unknown)=>z.coerce.number().int().positive().parse(v);
const read=(fn:(req:any,res:any)=>Promise<void>)=>async(req:any,res:any)=>{try{await fn(req,res);}catch(e){fail(res,e);}};
const write=(fn:(db:DatabasePoolClient,req:any,res:any)=>Promise<any>)=>read(async(req,res)=>{
  const db=await pool.connect();
  try{
    await db.query("BEGIN");
    const result=await fn(db,req,res);
    await db.query("COMMIT");
    if(result?.conflict)res.status(409).json({error:"Likely duplicate: this school already exists or is claimed. Ask the Platform Owner to review."});
    else res.json(result?.lead??result);
  }catch(e){await db.query("ROLLBACK").catch(()=>undefined);throw e;}
  finally{db.release();}
});
router.get("/bro-field/leads",read(async(req,res)=>{
  const a=actor(res),q=z.string().max(100).parse(req.query.q??"").trim();
  const followUp=z.union([z.literal(""),z.literal("overdue"),z.literal("upcoming"),broCalendarDay]).parse(req.query.followUp??"");
  const rows=await pool.query(`SELECT * FROM bro_field_leads l WHERE ($1::boolean OR current_owner_id=$2)
    AND ($3='' OR concat_ws(' ',school_name,address,contact_person,person_met,notes,contact_phone) ILIKE '%'||$3||'%'
      OR EXISTS(SELECT 1 FROM audit_logs h WHERE h.module='BROFieldOperations'
        AND h.metadata->>'leadId'=l.id::text AND concat_ws(' ',h.metadata->'snapshot'->>'schoolName',
          h.metadata->'snapshot'->>'address',h.metadata->'snapshot'->>'contactPerson',
          h.metadata->'snapshot'->>'personMet',h.metadata->'snapshot'->>'notes') ILIKE '%'||$3||'%'))
    AND ($4='' OR status=$4) AND ($5::int IS NULL OR current_owner_id=$5)
    AND ($6='' OR ($6='overdue' AND next_follow_up_date<(now() AT TIME ZONE 'Africa/Lagos')::date)
      OR ($6='upcoming' AND next_follow_up_date>=(now() AT TIME ZONE 'Africa/Lagos')::date)
      OR ($7::date IS NOT NULL AND next_follow_up_date<=$7::date))
    ORDER BY next_follow_up_date ASC NULLS LAST,id DESC`,
    [a.owner,a.id,q,String(req.query.status??""),a.owner&&req.query.ownerId?id(req.query.ownerId):null,followUp,
      /^\d{4}-\d{2}-\d{2}$/.test(followUp)?followUp:null]);
  res.json(rows.rows.map(broLeadView));
}));
router.get("/bro-field/options",read(async(_req,res)=>{
  const a=actor(res);
  const schools=await pool.query(`SELECT s.id,s.name FROM schools s WHERE $1::boolean OR NOT EXISTS(
    SELECT 1 FROM school_partner_attributions t WHERE t.school_id=s.id AND t.status='ACTIVE')
    OR EXISTS(SELECT 1 FROM school_partner_attributions t JOIN partner_profiles p ON p.id=t.partner_profile_id
      WHERE t.school_id=s.id AND t.status='ACTIVE' AND p.user_id=$2)
    OR EXISTS(SELECT 1 FROM bro_field_leads l WHERE l.school_id=s.id AND l.current_owner_id=$2)
    ORDER BY s.name`,[a.owner,a.id]);
  const bros=a.owner?(await pool.query(`SELECT DISTINCT u.id,'BRO #'||u.id::text AS name FROM app_users u
    JOIN school_memberships m ON m.user_id=u.id AND m.role='PARTNER' AND m.status='ACTIVE'
    WHERE u.status='ACTIVE' AND EXISTS(SELECT 1 FROM partner_profiles p WHERE p.status='ACTIVE'
      AND (p.user_id=u.id OR EXISTS(SELECT 1 FROM partner_profile_users pu
        WHERE pu.partner_profile_id=p.id AND pu.user_id=u.id AND pu.status='ACTIVE'))) ORDER BY u.id`)).rows:[];
  const conflicts=a.owner?(await pool.query(`SELECT actor_user_id AS "actorUserId","timestamp" AS "createdAt",
    metadata->'snapshot'->>'schoolName' AS "schoolName",
    (metadata->'snapshot'->>'leadId')::int AS "leadId",(metadata->'snapshot'->>'schoolId')::int AS "schoolId"
    FROM audit_logs WHERE module='BROFieldOperations' AND event_type='DUPLICATE_CONFLICT' ORDER BY id DESC LIMIT 100`)).rows:[];
  res.json({isOwner:a.owner,schools:schools.rows,bros,conflicts});
}));
router.get("/bro-field/leads/:id",read(async(req,res)=>{
  const lead=await broLeadAccess(pool,id(req.params.id),actor(res));
  const history=(await pool.query(`SELECT actor_user_id AS "actorUserId",action,"timestamp" AS "createdAt",
    metadata->'snapshot' AS snapshot FROM audit_logs WHERE module='BROFieldOperations'
    AND metadata->>'leadId'=$1::int::text ORDER BY id DESC`,[lead.id])).rows;
  const transfers=(await pool.query("SELECT * FROM bro_field_transfers WHERE lead_id=$1 ORDER BY id DESC",[lead.id])).rows.map(broTransferView);
  res.json({lead:broLeadView(lead),history,transfers});
}));
router.post("/bro-field/leads",write((db,req,res)=>saveBroLead(db,actor(res),broLeadInput.parse(req.body))));
router.put("/bro-field/leads/:id",write((db,req,res)=>saveBroLead(db,actor(res),broLeadInput.parse(req.body),id(req.params.id))));
router.post("/bro-field/leads/:id/transfers",write((db,req,res)=>requestBroTransfer(db,actor(res),id(req.params.id),broTransferInput.parse(req.body))));
router.post("/bro-field/transfers/:id/decision",write((db,req,res)=>decideBroTransfer(db,actor(res),id(req.params.id),broDecisionInput.parse(req.body))));
export default router;
