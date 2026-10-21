import {AuthError} from "../middlewares/auth";
import {getTelegramHealth} from "./telegram-provider";
import {createParentTelegramChallenge,eligibleTelegramParent,openTelegramChat,telegramSchoolAllowed,telegramTokenHash} from "./telegram-links";
import {notificationChannelAvailability,allowedNotificationChannels,loadNotificationPolicy} from "./notification-channel-policy";
import {queueCommunicationNotification,type CommunicationQueryClient} from "./communication-service";
import {createECDH} from "node:crypto";
import {pushSubscriptionSchema} from "./web-push-provider";

function validPushConfiguration(){
  try{
    const key=createECDH("prime256v1");
    key.setPrivateKey(Buffer.from(process.env.VAPID_PRIVATE_KEY??"","base64url"));
    return key.getPublicKey().equals(Buffer.from(process.env.VAPID_PUBLIC_KEY??"","base64url"));
  }catch{return false;}
}
async function invitationChannels(db:CommunicationQueryClient,schoolId:number){
  const defaults=(await db.query<{defaults:Record<string,string[]>}>(`SELECT communication_defaults AS defaults FROM schools WHERE id=$1`,[schoolId])).rows[0]?.defaults;
  return allowedNotificationChannels(await loadNotificationPolicy(db),"SYSTEM",schoolId)
    .filter(channel=>!defaults?.SYSTEM||defaults.SYSTEM.includes(channel));
}

/** Only a live, scoped relationship authorizes directory visibility/invitations. */
export async function telegramDirectoryParent(db:CommunicationQueryClient,parentId:number,schoolId:number){
  const row=(await db.query<{userId:number}>(`SELECT user_id AS "userId" FROM parents WHERE id=$1`,[parentId])).rows[0];
  if(!row||!await eligibleTelegramParent(db,row.userId,schoolId))throw new AuthError(404,"Parent not found in this school");
  return row;
}
export async function parentTelegramInvitationStatus(db:CommunicationQueryClient,parentId:number,schoolId:number){
  const parent=await telegramDirectoryParent(db,parentId,schoolId);
  const link=(await db.query<any>(`SELECT consented_at,revoked_at,bot_id,chat_ciphertext FROM parent_telegram_links WHERE parent_id=$1`,[parentId])).rows[0];
  const pending=(await db.query<any>(`SELECT expires_at FROM telegram_link_challenges
    WHERE parent_id=$1 AND school_id=$2 AND expires_at>now() AND revoked_at IS NULL AND confirmed_at IS NULL
    AND bot_id=$3 ORDER BY id DESC LIMIT 1`,[parentId,schoolId,getTelegramHealth().botId])).rows[0];
  const permitted=await telegramSchoolAllowed(db,schoolId),h=getTelegramHealth();
  let linked=false;
  try{if(link?.consented_at&&link.bot_id===h.botId){openTelegramChat(parentId,link.chat_ciphertext);linked=true;}}catch{}
  // A withdrawal is not reversed by an administrator. Parent may initiate anew.
  const withdrawn=!!link?.revoked_at&&!link?.consented_at;
  const available=permitted&&h.ready;
  const failure=linked?(await db.query<any>(`SELECT d.error_code,d.status FROM communication_deliveries d
    JOIN communication_notifications n ON n.id=d.notification_id WHERE n.recipient_user_id=$1 AND n.school_id=$2
    AND d.channel='TELEGRAM' ORDER BY d.updated_at DESC,d.id DESC LIMIT 1`,[parent.userId,schoolId])).rows[0]:null;
  const failed=!!failure&&["FAILED","CANCELLED"].includes(failure.status);
  const status=withdrawn?"Disabled/consent withdrawn":!available||failed?"Delivery unavailable"
    :linked?"Linked":pending?"Invitation pending":"Not invited";
  const noticeChannels=await invitationChannels(db,schoolId);
  const pushPermitted=notificationChannelAvailability().PUSH&&validPushConfiguration()
    &&noticeChannels.includes("IN_APP")&&noticeChannels.includes("PUSH");
  const devices=pushPermitted?(await db.query<any>(`SELECT subscription FROM communication_push_devices WHERE user_id=$1 AND school_id=$2
    AND status='ACTIVE' AND subscription IS NOT NULL AND session_id IS NOT NULL LIMIT 10`,[parent.userId,schoolId])).rows:[];
  const pushAvailable=devices.some(device=>{
    const parsed=pushSubscriptionSchema.safeParse(device.subscription);
    return parsed.success&&(!parsed.data.expirationTime||parsed.data.expirationTime>Date.now());
  });
  return {status,canInvite:available&&!withdrawn&&!linked,expiresAt:pending?new Date(pending.expires_at).toISOString():null,pushAvailable};
}
export async function createTelegramDirectoryInvitation(db:CommunicationQueryClient,parentId:number,schoolId:number,actorUserId:number){
  const parent=await telegramDirectoryParent(db,parentId,schoolId);
  const status=await parentTelegramInvitationStatus(db,parentId,schoolId);
  if(!status.canInvite)throw new AuthError(409,"Telegram invitation unavailable; a parent must reconnect after withdrawal");
  const recent=(await db.query<any>(`SELECT count(*)::int AS count FROM telegram_link_challenges
    WHERE parent_id=$1 AND created_at>now()-INTERVAL '10 minutes'`,[parentId])).rows[0];
  if(Number(recent?.count??0)>=3)throw new AuthError(409,"Invitation refresh limit reached. The parent can still create a personal link.");
  const invitation=await createParentTelegramChallenge(db,parent.userId,schoolId);
  // Admin-known links are invitations, never final chat-binding credentials.
  // Immutable audit metadata stores only the same opaque-token HASH.
  const hash=telegramTokenHash(new URL(invitation.url).searchParams.get("start")!);
  const audited=await db.query(`INSERT INTO audit_logs(actor_user_id,"user",role,school_id,action,module,event_type,result,metadata)
    SELECT id,email,'SCHOOL_ADMIN',$2,'Telegram parent invitation','Communication','TELEGRAM_PARENT_INVITED','SUCCESS',$3::jsonb
    FROM app_users WHERE id=$1 RETURNING id`,[actorUserId,schoolId,JSON.stringify({telegramInvitationHash:hash})]);
  if(!audited.rows.length)throw new AuthError(403,"Invitation actor is unavailable");
  // No opaque token or chat identifier ever goes into a notification or push.
  const notice=(await invitationChannels(db,schoolId)).includes("IN_APP")?await queueCommunicationNotification(db,{recipientUserId:parent.userId,schoolId,
    category:"SYSTEM",eventKey:`TELEGRAM_INVITATION:${parentId}:${Math.floor(Date.now()/600000)}`,
    subject:"Connect Telegram",body:"Your school invited you to connect Telegram. Open your Parent Portal notification preferences, review your linked children and choose whether to consent. No SMS fallback is sent.",
    link:"/parent/communication?tab=preferences",channels:status.pushAvailable?["IN_APP","PUSH"]:["IN_APP"],useSchoolDefaults:false}):null;
  return {...status,...invitation,status:"Invitation pending",noticeId:notice};
}
