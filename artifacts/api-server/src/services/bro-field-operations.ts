import {createHash} from "node:crypto";
import {z} from "zod";
export const broStatuses=["Visited","Interested","Demo Scheduled","Negotiation","Adopted","Not Interested","Follow-up"] as const;
export const broCalendarDay=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{
  const date=new Date(`${v}T00:00:00Z`);return Number.isFinite(+date)&&date.toISOString().slice(0,10)===v;
},"Invalid calendar date");
const optionalText=(max:number)=>z.string().trim().max(max).nullable().optional().transform(v=>v||null);
export const broLeadInput=z.object({
  schoolName:z.string().trim().min(2).max(200),address:z.string().trim().min(3).max(500),
  contactPerson:optionalText(150),contactPhone:optionalText(40),visitDate:broCalendarDay,
  personMet:z.string().trim().max(150),notes:z.string().trim().max(5000),
  interestLevel:z.enum(["Unknown","Low","Medium","High"]),status:z.enum(broStatuses),
  nextFollowUpDate:broCalendarDay.nullable().optional().transform(v=>v??null),
  schoolId:z.number().int().positive().nullable().optional().transform(v=>v??null),
  expectedVersion:z.number().int().nonnegative(),
}).strict().refine(v=>v.status!=="Adopted"||v.schoolId!==null,"Adopted requires an existing school link");
export const broTransferInput=z.object({targetOwnerId:z.number().int().positive().nullable(),reason:z.string().trim().min(5).max(500)}).strict();
export const broDecisionInput=z.object({decision:z.enum(["APPROVED","REJECTED"]),reason:z.string().trim().min(5).max(500)}).strict();
export type BroActor={id:number;owner:boolean;email?:string};
export class BroFieldError extends Error{constructor(readonly status:number,message:string){super(message);}}
export const developmentBroField=()=>process.env.NODE_ENV==="development"&&!process.env.REPLIT_DEPLOYMENT;
export const normalizeBroName=(v:string)=>v.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
export const normalizeBroPhone=(v:string|null|undefined)=>{
  const n=(v??"").replace(/\D/g,"");return n.startsWith("234")?`0${n.slice(3)}`:n;
};
export function broClaimKeys(input:{schoolName:string;address:string;contactPhone?:string|null}){
  return [["name",normalizeBroName(input.schoolName)],["address",normalizeBroName(input.address)],
    ["phone",normalizeBroPhone(input.contactPhone)]].filter(([,v])=>v).map(([kind,v])=>`${kind}:${createHash("sha256").update(v!).digest("hex")}`);
}
export const broLeadView=(r:any)=>({
  id:r.id,originalOwnerId:r.original_owner_id,currentOwnerId:r.current_owner_id,schoolId:r.school_id,
  schoolName:r.school_name,address:r.address,contactPerson:r.contact_person,contactPhone:r.contact_phone,
  visitDate:typeof r.visit_date==="string"?r.visit_date.slice(0,10):r.visit_date.toISOString().slice(0,10),
  personMet:r.person_met,notes:r.notes,interestLevel:r.interest_level,status:r.status,
  nextFollowUpDate:r.next_follow_up_date?(typeof r.next_follow_up_date==="string"?r.next_follow_up_date.slice(0,10):r.next_follow_up_date.toISOString().slice(0,10)):null,
  version:r.version,expectedVersion:r.version,createdAt:r.created_at,updatedAt:r.updated_at,
});
export const broTransferView=(r:any)=>({id:r.id,leadId:r.lead_id,fromOwnerId:r.from_owner_id,targetOwnerId:r.target_owner_id,
  status:r.status,reason:r.reason,decisionReason:r.decision_reason,decidedBy:r.decided_by,createdAt:r.created_at});
type Db={query:(sql:string,values?:any[])=>Promise<{rows:any[]}>};
export async function broAudit(db:Db,actor:BroActor,action:string,leadId:number|null,snapshot:any){
  await db.query(`INSERT INTO audit_logs(actor_user_id,role,action,module,event_type,result,metadata,"user")
    VALUES($1,$2,$3,'BROFieldOperations',$3,'SUCCESS',$4::jsonb,$5)`,
    [actor.id,actor.owner?"PLATFORM_OWNER":"PARTNER",action,JSON.stringify({leadId,snapshot}),actor.email??`User #${actor.id}`]);
}
export async function broLeadAccess(db:Db,id:number,actor:BroActor,lock=false){
  const row=(await db.query(`SELECT * FROM bro_field_leads WHERE id=$1
    AND ($2::boolean OR current_owner_id=$3) ${lock?"FOR UPDATE":""}`,[id,actor.owner,actor.id])).rows[0];
  if(!row)throw new BroFieldError(404,"Lead not found");return row;
}
export async function eligibleBro(db:Db,id:number){
  return !!(await db.query(`SELECT p.id FROM partner_profiles p JOIN app_users u ON u.id=$1
    WHERE u.status='ACTIVE' AND p.status='ACTIVE' AND (p.user_id=$1 OR EXISTS(
      SELECT 1 FROM partner_profile_users pu WHERE pu.partner_profile_id=p.id AND pu.user_id=$1 AND pu.status='ACTIVE'))
    AND EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=$1 AND m.role='PARTNER' AND m.status='ACTIVE')
    LIMIT 1`,[id])).rows[0];
}
export async function saveBroLead(db:Db,actor:BroActor,input:z.infer<typeof broLeadInput>,id?:number){
  if(actor.owner)throw new BroFieldError(403,"Owner oversight does not edit BRO visit records");
  await db.query("SELECT pg_advisory_xact_lock(31976,1)");
  const previous=id?await broLeadAccess(db,id,actor,true):null;
  if(previous&&previous.version!==input.expectedVersion)throw new BroFieldError(409,"Lead changed; reload before saving");
  if(!previous&&input.expectedVersion!==0)throw new BroFieldError(409,"New lead must start at version zero");
  const claims=[...broClaimKeys(input),...(input.schoolId?[`school:${input.schoolId}`]:[])];
  if(!normalizeBroName(input.schoolName)||!normalizeBroName(input.address))throw new BroFieldError(400,"School name and address need letters or numbers");
  const claimed=(await db.query(`SELECT l.id FROM bro_field_claims c JOIN bro_field_leads l ON l.id=c.lead_id
    WHERE c.claim_key=ANY($1::text[]) AND ($2::int IS NULL OR l.id<>$2) LIMIT 1`,[claims,id??null])).rows[0];
  // Compare existing registry without exposing school collections, finance or other BRO notes.
  const schools=(await db.query("SELECT id,name,address,phone FROM schools")).rows;
  const matches=schools.filter(s=>normalizeBroName(s.name)===normalizeBroName(input.schoolName)
    ||(normalizeBroPhone(input.contactPhone)&&normalizeBroPhone(s.phone)===normalizeBroPhone(input.contactPhone))
    ||(s.address&&normalizeBroName(s.address)===normalizeBroName(input.address)));
  if(input.schoolId&&!schools.some(s=>s.id===input.schoolId))throw new BroFieldError(400,"Existing school not found");
  if(input.schoolId){
    const other=(await db.query(`SELECT 1 FROM school_partner_attributions a JOIN partner_profiles p ON p.id=a.partner_profile_id
      WHERE a.school_id=$1 AND p.user_id IS DISTINCT FROM $2 AND a.status='ACTIVE' LIMIT 1`,[input.schoolId,actor.id])).rows[0];
    if(other&&previous?.school_id!==input.schoolId)throw new BroFieldError(403,"School belongs to another BRO; ask the Owner to review");
    if(!matches.some(s=>s.id===input.schoolId))throw new BroFieldError(400,"The selected school does not match this lead");
  }
  const schoolConflict=matches.find(s=>s.id!==input.schoolId);
  if(claimed||schoolConflict){
    await broAudit(db,actor,"DUPLICATE_CONFLICT",null,{schoolName:input.schoolName,leadId:claimed?.id??null,schoolId:schoolConflict?.id??null});
    return {conflict:true as const};
  }
  const values=[input.schoolName,input.address,input.contactPerson,input.contactPhone,input.visitDate,input.personMet,
    input.notes,input.interestLevel,input.status,input.nextFollowUpDate,input.schoolId];
  const row=previous?(await db.query(`UPDATE bro_field_leads SET school_name=$1,address=$2,contact_person=$3,
    contact_phone=$4,visit_date=$5,person_met=$6,notes=$7,interest_level=$8,status=$9,next_follow_up_date=$10,
    school_id=$11,version=version+1,updated_at=now() WHERE id=$12 RETURNING *`,[...values,id])).rows[0]
    :(await db.query(`INSERT INTO bro_field_leads(school_name,address,contact_person,contact_phone,visit_date,person_met,
      notes,interest_level,status,next_follow_up_date,school_id,original_owner_id,current_owner_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,[...values,actor.id])).rows[0];
  for(const key of claims){
    await db.query("INSERT INTO bro_field_claims(claim_key,lead_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[key,row.id]);
    const winner=(await db.query("SELECT lead_id FROM bro_field_claims WHERE claim_key=$1",[key])).rows[0];
    if(winner?.lead_id!==row.id)throw new BroFieldError(409,"Duplicate ownership claim; ask the Owner to review");
  }
  await broAudit(db,actor,previous?"VISIT_UPDATED":"LEAD_CREATED",row.id,broLeadView(row));
  return {lead:broLeadView(row)};
}
export async function requestBroTransfer(db:Db,actor:BroActor,leadId:number,input:z.infer<typeof broTransferInput>){
  const lead=await broLeadAccess(db,leadId,actor,true);
  if(input.targetOwnerId===lead.current_owner_id)throw new BroFieldError(400,"Choose another BRO or request release");
  if(input.targetOwnerId&&!await eligibleBro(db,input.targetOwnerId))throw new BroFieldError(400,"Target BRO is not active");
  const row=(await db.query(`INSERT INTO bro_field_transfers(lead_id,from_owner_id,target_owner_id,lead_version,requested_by,reason)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[lead.id,lead.current_owner_id,input.targetOwnerId,lead.version,actor.id,input.reason])).rows[0];
  await broAudit(db,actor,"TRANSFER_REQUESTED",lead.id,broTransferView(row));return broTransferView(row);
}
export async function decideBroTransfer(db:Db,actor:BroActor,id:number,input:z.infer<typeof broDecisionInput>){
  if(!actor.owner)throw new BroFieldError(403,"Owner approval required");
  // Same lock order as request/update: lead first, transfer second.
  const ref=(await db.query("SELECT lead_id FROM bro_field_transfers WHERE id=$1",[id])).rows[0];
  if(!ref)throw new BroFieldError(404,"Transfer not found");
  const lead=await broLeadAccess(db,ref.lead_id,actor,true);
  const t=(await db.query("SELECT * FROM bro_field_transfers WHERE id=$1 FOR UPDATE",[id])).rows[0];
  if(t.status!=="PENDING")throw new BroFieldError(409,"Transfer already decided");
  if(input.decision==="APPROVED"){
    if(lead.current_owner_id!==t.from_owner_id||lead.version!==t.lead_version)
      throw new BroFieldError(409,"Lead changed after the request; reject this request and request a fresh transfer");
    if(t.target_owner_id&&!await eligibleBro(db,t.target_owner_id))throw new BroFieldError(400,"Target BRO is no longer active");
  }
  const row=(await db.query(`UPDATE bro_field_transfers SET status=$2,decided_by=$3,decision_reason=$4,decided_at=now()
    WHERE id=$1 RETURNING *`,[id,input.decision,actor.id,input.reason])).rows[0];
  if(input.decision==="APPROVED")await db.query(`UPDATE bro_field_leads SET current_owner_id=$2,version=version+1,updated_at=now()
    WHERE id=$1`,[lead.id,t.target_owner_id]);
  await broAudit(db,actor,`TRANSFER_${input.decision}`,lead.id,{...broTransferView(row),originalOwnerId:lead.original_owner_id});
  return broTransferView(row);
}
