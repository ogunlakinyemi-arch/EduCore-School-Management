import {financialTransaction} from "./financial-transaction";
import {requireFinancialActor} from "./financial-history-writes";
import {requireCurrentExtensions} from "./current-finance-access";
import {demand,requestKey,type CurrentPool,type CurrentSql} from "./current-financial-contract";
import {digest} from "./current-financial-store";
import {normalizeBroName,normalizeBroPhone,broAudit} from "./bro-field-operations";
import {createSmsProvider,normalizeTermiiRecipient,type SmsProvider} from "./communication-providers";
import {withFieldSmsCampaignScope} from "./sms-event-policy";
import {notificationTransportSuppressed} from "../lib/owner-notification-transport";
import {loadOwnerDeliveryControls,withOwnerNotificationScope} from "./owner-notification-controls";
export type FieldSmsDependencies={
 provider?:SmsProvider;
 transportAllowed?:(c:CurrentSql)=>Promise<boolean>;
};
async function transportAllowed(c:CurrentSql,deps:FieldSmsDependencies){
 if(deps.transportAllowed)return deps.transportAllowed(c);
 const state=await loadOwnerDeliveryControls(c);
 return withOwnerNotificationScope(state,async()=>!notificationTransportSuppressed("SMS"));
}
async function owner(c:CurrentSql,actorId:number){
 await requireFinancialActor(c,actorId);await requireCurrentExtensions(c);
}
export async function fieldSmsLeads(c:CurrentSql){
 const leads=(await c.query(`SELECT l.*,p.allowed,p.phone AS permitted_phone FROM bro_field_leads l
   LEFT JOIN LATERAL(SELECT allowed,phone FROM bro_field_sms_permissions WHERE lead_id=l.id ORDER BY id DESC LIMIT 1)p ON true
   ORDER BY l.id`)).rows;
 const schools=(await c.query("SELECT id,name,address,phone FROM schools")).rows;
 const permissions=(await c.query(`SELECT DISTINCT ON(phone) phone,allowed FROM bro_field_sms_permissions ORDER BY phone,id DESC`)).rows;
 return leads.map(l=>{
   const phone=normalizeTermiiRecipient(l.contact_phone??"");
   const registered=l.school_id!==null||l.status==="Adopted"||schools.some(s=>
     normalizeBroName(s.name)===normalizeBroName(l.school_name)
     ||(normalizeBroPhone(l.contact_phone)&&normalizeBroPhone(s.phone)===normalizeBroPhone(l.contact_phone))
     ||(s.address&&normalizeBroName(s.address)===normalizeBroName(l.address)));
   const allowed=l.allowed===true&&l.permitted_phone===phone
     &&permissions.find(p=>p.phone===phone)?.allowed===true
     &&!leads.some(other=>other.status==="Not Interested"&&normalizeTermiiRecipient(other.contact_phone??"")===phone);
   const reason=registered?"SCHOOL_ALREADY_REGISTERED":!l.visit_date?"VISIT_REQUIRED":
     l.status==="Not Interested"?"CONTACT_DECLINED":!phone?"VALID_PHONE_REQUIRED":!allowed?"CONTACT_PERMISSION_REQUIRED":null;
   return {id:Number(l.id),schoolName:l.school_name,contactPhone:l.contact_phone,phone,allowed,eligible:reason===null,reason};
 });
}
export async function recordFieldPermission(pool:CurrentPool,actorId:number,leadId:number,allowed:boolean,reason:string){
 demand(reason.trim().length>=5&&reason.trim().length<=500,"PERMISSION_REASON_REQUIRED");
 return financialTransaction(pool,async c=>{
   await owner(c,actorId);
   const lead=(await fieldSmsLeads(c)).find(l=>l.id===leadId);demand(lead,"LEAD_NOT_FOUND");
   demand(!allowed||lead.phone,"VALID_PHONE_REQUIRED");
   await c.query(`INSERT INTO bro_field_sms_permissions(lead_id,allowed,phone,reason,actor_user_id) VALUES($1,$2,$3,$4,$5)`,
     [leadId,allowed,lead.phone??"",reason.trim(),actorId]);
   await broAudit(c,{id:actorId,owner:true},"SMS_CONTACT_PERMISSION_RECORDED",leadId,{allowed,reason:reason.trim()});
   return {leadId,allowed};
 });
}
async function campaignView(c:CurrentSql,id:number){
 const campaign=(await c.query("SELECT * FROM bro_field_sms_campaigns WHERE id=$1",[id])).rows[0];
 demand(campaign,"CAMPAIGN_NOT_FOUND");
 const recipients=(await c.query(`SELECT r.*,COALESCE(e.state,'REQUESTED') AS state,e.details,e.created_at AS last_attempt_at
   FROM bro_field_sms_recipients r LEFT JOIN LATERAL(SELECT state,details,created_at FROM bro_field_sms_events
     WHERE recipient_id=r.id ORDER BY id DESC LIMIT 1)e ON true WHERE r.campaign_id=$1 ORDER BY r.id`,[id])).rows;
 return {id:Number(campaign.id),digest:campaign.digest,message:campaign.message,createdBy:Number(campaign.created_by),
   createdAt:new Date(campaign.created_at).toISOString(),recipients:recipients.map(r=>({
     id:Number(r.id),leadId:Number(r.lead_id),schoolName:r.school_name,phone:r.phone,state:r.state,
     providerReference:r.details?.providerReference??null,error:r.details?.error??null,
     retryable:r.state==="FAILED"&&r.details?.retryable===true,lastAttemptAt:r.last_attempt_at,
     retryAfterSeconds:r.details?.retryAfterSeconds??0,
   }))};
}
export async function readFieldSms(pool:CurrentPool,actorId:number,deps:FieldSmsDependencies={}){
 return financialTransaction(pool,async c=>{
   await owner(c,actorId);
   const campaigns=[];
   for(const r of (await c.query("SELECT id FROM bro_field_sms_campaigns ORDER BY id DESC LIMIT 50")).rows)
     campaigns.push(await campaignView(c,Number(r.id)));
   let blockedReason=await transportAllowed(c,deps)?null:"SMS_TRANSPORT_PAUSED_OR_NOT_ENABLED";
   if(blockedReason&&!deps.transportAllowed){
     const controls=await loadOwnerDeliveryControls(c);
     blockedReason=controls.paused?"SMS_DELIVERY_PAUSED_BY_OWNER":!controls.smsEnabled?"SMS_NOT_AUTHORIZED_BY_OWNER":
       !controls.activatedAt?"SMS_ACTIVATION_REVIEW_REQUIRED":blockedReason;
   }
   if(!blockedReason&&!deps.provider)try{
     const controls=await loadOwnerDeliveryControls(c);
     await withOwnerNotificationScope(controls,async()=>createSmsProvider());
   }catch{blockedReason="SMS_PROVIDER_NOT_CONFIGURED";}
   return {leads:await fieldSmsLeads(c),campaigns,blockedReason};
 });
}
export async function previewFieldSms(pool:CurrentPool,actorId:number,input:{
 message:string;key:string;all:boolean;leadIds?:number[]}){
 requestKey(input.key);demand(input.message.trim().length>0&&input.message.trim().length<=1000,"SMS_MESSAGE_REQUIRED");
 demand(input.all||!!input.leadIds?.length,"SELECT_RECIPIENTS");
 return financialTransaction(pool,async c=>{
   await owner(c,actorId);
   const old=(await c.query("SELECT * FROM bro_field_sms_campaigns WHERE request_key=$1",[input.key])).rows[0];
   const selection={all:input.all,leadIds:[...new Set(input.leadIds??[])].sort((a,b)=>a-b)};
   if(old){
     demand(Number(old.created_by)===actorId&&old.message===input.message.trim()
       &&digest(old.snapshot.selection)===digest(selection),"CAMPAIGN_KEY_CONTENT_CONFLICT");
     return campaignView(c,Number(old.id));
   }
   const leads=await fieldSmsLeads(c),selected=leads.filter(l=>l.eligible&&(input.all||selection.leadIds.includes(l.id)));
   if(!input.all)demand(selection.leadIds.every(id=>selected.some(l=>l.id===id)),"SELECTED_CONTACT_NO_LONGER_ELIGIBLE");
   const unique=[...new Map(selected.map(l=>[l.phone,l])).values()];
   demand(unique.length>0&&unique.length<=500,"ELIGIBLE_RECIPIENTS_REQUIRED_MAX_500");
   const snapshot={selection,recipients:unique.map(l=>({leadId:l.id,phone:l.phone,schoolName:l.schoolName}))};
   const commitment=digest({message:input.message.trim(),...snapshot});
   const r=(await c.query(`INSERT INTO bro_field_sms_campaigns(request_key,message,digest,snapshot,created_by)
     VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id`,[input.key,input.message.trim(),commitment,JSON.stringify(snapshot),actorId])).rows[0];
   for(const lead of unique)await c.query(`INSERT INTO bro_field_sms_recipients(campaign_id,lead_id,phone,school_name)
     VALUES($1,$2,$3,$4)`,[r.id,lead.id,lead.phone,lead.schoolName]);
   await broAudit(c,{id:actorId,owner:true},"SMS_CAMPAIGN_PREVIEWED",null,{campaignId:Number(r.id),count:unique.length,digest:commitment});
   return campaignView(c,Number(r.id));
 });
}
async function smsEvent(c:CurrentSql,recipientId:number,actorId:number,state:string,details:object){
 await c.query(`INSERT INTO bro_field_sms_events(recipient_id,actor_user_id,state,details) VALUES($1,$2,$3,$4::jsonb)`,
   [recipientId,actorId,state,JSON.stringify(details)]);
}
export async function dispatchFieldSms(pool:CurrentPool,actorId:number,id:number,commitment:string,confirm:boolean,deps:FieldSmsDependencies={}){
 demand(confirm===true,"EXPLICIT_OWNER_CONFIRMATION_REQUIRED");
 const campaign=await financialTransaction(pool,async c=>{
   await owner(c,actorId);demand(await transportAllowed(c,deps),"SMS_TRANSPORT_PAUSED_OR_NOT_ENABLED");
   const p=await campaignView(c,id);demand(p.digest===commitment,"CAMPAIGN_PREVIEW_CHANGED");
   await broAudit(c,{id:actorId,owner:true},"SMS_CAMPAIGN_CONFIRMED",null,{campaignId:id,digest:commitment});
   return p;
 });
 // Bounded synchronous dispatch: every continuation needs another explicit
 // Owner confirmation. Unclaimed recipients survive process/request interruption.
 const deadline=Date.now()+20_000;
 let processed=0;
 for(const original of campaign.recipients){
   if(processed>=20||Date.now()>deadline)break;
   const claimed=await financialTransaction(pool,async c=>{
     await owner(c,actorId);
     demand(await transportAllowed(c,deps),"SMS_TRANSPORT_PAUSED_OR_NOT_ENABLED");
     const fresh=(await campaignView(c,id)).recipients.find(r=>r.id===original.id)!;
     if(fresh.state!=="REQUESTED"&&!fresh.retryable)return false;
     if(fresh.lastAttemptAt&&Date.now()<new Date(fresh.lastAttemptAt).getTime()+fresh.retryAfterSeconds*1000)return false;
     const lead=(await fieldSmsLeads(c)).find(l=>l.id===fresh.leadId);
     if(!lead?.eligible||lead.phone!==fresh.phone){
       await smsEvent(c,fresh.id,actorId,"EXCLUDED",{error:lead?.reason??"CONTACT_CHANGED_AFTER_PREVIEW",retryable:false});
       return false;
     }
     await smsEvent(c,fresh.id,actorId,"PROCESSING",{moneyMoved:false,retryable:false,confirmationDigest:commitment});
     return true;
   });
   if(!claimed)continue;
   processed++;
   try{
     // Reload controls after claiming; never unpause delivery to make a campaign work.
     const c=await pool.connect();let controls;
     try{controls=await loadOwnerDeliveryControls(c);}finally{c.release();}
     const result=await withOwnerNotificationScope(controls,()=>withFieldSmsCampaignScope(async()=>{
       const provider=deps.provider??createSmsProvider();
       return provider.send({to:original.phone,body:campaign.message,event:"BRO_FIELD_FOLLOWUP",
         idempotencyKey:`field-sms-${id}-${original.id}`});
     }));
     const knownRejection=result.status==="FAILED"&&!result.accepted
       &&["RATE_LIMITED","INVALID_REQUEST","PROVIDER_REJECTED","AUTHENTICATION","CONFIGURATION"].includes(result.failure?.category??"");
     // No unauthenticated send response establishes physical delivery.
     const next=result.accepted?"ACCEPTED":knownRejection?"FAILED":"UNKNOWN";
     await financialTransaction(pool,c=>smsEvent(c,original.id,actorId,next,{
       provider:result.provider,providerReference:result.providerMessageId??null,delivered:false,
       error:result.failure?.category??(next==="UNKNOWN"?"PROVIDER_ACCEPTANCE_UNCERTAIN":null),
       retryable:knownRejection&&result.failure?.retryable===true,
       retryAfterSeconds:Math.max(0,result.failure?.retryAfterSeconds??0),
     }));
   }catch{
     await financialTransaction(pool,c=>smsEvent(c,original.id,actorId,"UNKNOWN",
       {error:"PROVIDER_ACCEPTANCE_UNCERTAIN",retryable:false}));
   }
 }
 return financialTransaction(pool,async c=>{await owner(c,actorId);return campaignView(c,id);});
}
