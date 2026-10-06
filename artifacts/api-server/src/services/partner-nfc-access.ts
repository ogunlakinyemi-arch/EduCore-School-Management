import type {Request} from "express";
import {pool} from "@workspace/db";
import {AuthError,getUserContext,assertRoles} from "../middlewares/auth";
import {activeSchoolNfcDevicesSql} from "../lib/nfc-device-first";
type Db={query(sql:string,values?:any[]):Promise<{rows:any[]}>};

export async function partnerNfcIdentity(req:Request,db:Db=pool,lock=false,enforcePermission=true){
  const c=assertRoles(req,["PARTNER"]);
  const candidates=await db.query(`SELECT p.id,p.user_id AS "ownerUserId" FROM partner_profiles p
    WHERE p.user_id=$1 OR EXISTS(SELECT 1 FROM partner_profile_users pu WHERE pu.partner_profile_id=p.id AND pu.user_id=$1 AND pu.status='ACTIVE') ORDER BY p.id`,[c.user.id]);
  if(candidates.rows.length!==1)throw new AuthError(403,"One active Partner profile is required");
  const profile=await db.query(`SELECT id,user_id AS "ownerUserId",status,nfc_activation_enabled AS enabled FROM partner_profiles WHERE id=$1${lock?" FOR SHARE":""}`,[candidates.rows[0].id]);
  const p=profile.rows[0];
  if(!p || p.status!=="ACTIVE")throw new AuthError(403,"Partner account is inactive");
  if(enforcePermission&&!p.enabled)throw new AuthError(403,"NFC Card Activation permission is not enabled by the Platform Owner");
  const user=await db.query(`SELECT id FROM app_users WHERE id=$1 AND status='ACTIVE'${lock?" FOR SHARE":""}`,[c.user.id]);
  if(!user.rows[0])throw new AuthError(403,"Partner account is inactive");
  const isOwner=Number(p.ownerUserId)===c.user.id;
  let staffEnabled=false;
  if(!isOwner){
    const staff=await db.query(`SELECT id,nfc_activation_enabled AS enabled FROM partner_profile_users WHERE partner_profile_id=$1 AND user_id=$2
      AND status='ACTIVE' AND role IN ('PARTNER_STAFF','PARTNER_ADMIN','PARTNER_FINANCE')
      ${lock?" FOR SHARE":""}`,[p.id,c.user.id]);
    if(staff.rows.length!==1)throw new AuthError(403,"Active Partner staff membership is required");
    staffEnabled=staff.rows[0].enabled===true;
    if(enforcePermission&&!staffEnabled)throw new AuthError(403,"Partner staff NFC activation permission is required");
  }
  return{partnerId:Number(p.id),actorType:isOwner?"Partner":"Partner Staff",context:c,isOwner,
    partnerEnabled:p.enabled===true,enabled:p.enabled===true&&(isOwner||staffEnabled)};
}
export async function partnerNfcSchool(req:Request,schoolId:number,db:Db=pool,lock=false){
  const actor=await partnerNfcIdentity(req,db,lock);
  const referral=await db.query(`SELECT id FROM school_partner_attributions WHERE partner_profile_id=$1
    AND school_id=$2 AND is_current=true AND status IN ('ACTIVE','CONFIRMED')${lock?" FOR SHARE":""}`,[actor.partnerId,schoolId]);
  if(referral.rows.length!==1)throw new AuthError(404,"School not found in your referred-school scope","CROSS_TENANT_ACCESS_ATTEMPT");
  const school=await db.query(`SELECT id,name,code FROM schools WHERE id=$1 AND upper(status)='ACTIVE'${lock?" FOR SHARE":""}`,[schoolId]);
  if(!school.rows[0])throw new AuthError(404,"Active referred school not found");
  const devices=await db.query(`${activeSchoolNfcDevicesSql}${lock?" FOR SHARE OF d":""}`,[schoolId]);
  if(!devices.rows.length)throw new AuthError(409,"NFC card activation is unavailable because no active NFC device has been linked to this school by the Platform Owner.","NFC_DEVICE_REQUIRED");
  return{...actor,school:school.rows[0],activeDeviceIds:devices.rows.map(d=>d.id)};
}
export async function nfcAudit(req:Request,db:Db,action:string,recordId:number,metadata:any,schoolId:number|null=null){
  const c=getUserContext(req);
  await db.query(`INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,event_type,result,metadata)
    VALUES($1,$2,$3,$4,$5,$6,'Partner NFC Activation',$7,$8,'SUCCESS',$9::jsonb)`,
    [c.user.email,c.roles[0]?.role??"AUTHENTICATED",c.user.id,c.user.clerkUserId,schoolId,action,recordId,action,JSON.stringify(metadata)]);
}
