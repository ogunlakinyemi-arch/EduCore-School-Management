import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from "node:crypto";
import {AuthError} from "../middlewares/auth";
import {familyChildSchoolScope} from "../lib/family-child-school-scope";
import {loadNotificationPolicy,allowedNotificationChannels,policyEvents} from "./notification-channel-policy";
import {getTelegramHealth,refreshTelegramHealth} from "./telegram-provider";
type Db={query:(sql:string,values?:any[])=>Promise<{rows:any[]}>};
const key=(env:NodeJS.ProcessEnv)=> {
  if(!env.SESSION_SECRET||env.SESSION_SECRET.length<32)throw new Error("Telegram encryption unavailable");
  return createHash("sha256").update("educore/telegram-chat/v1:").update(env.SESSION_SECRET).digest();
};
export const telegramTokenHash=(token:string)=>createHash("sha256").update(token).digest("hex");
export const telegramChatHash=(chat:string,env:NodeJS.ProcessEnv=process.env)=>createHmac("sha256",key(env)).update(chat).digest("hex");
export function sealTelegramChat(parentId:number,payload:{chatId:string;label:string},env:NodeJS.ProcessEnv=process.env){
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(env),iv);
  cipher.setAAD(Buffer.from(String(parentId)));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(payload),"utf8"),cipher.final()]);
  return ["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),encrypted.toString("base64url")].join(".");
}
export function openTelegramChat(parentId:number,sealed:string,env:NodeJS.ProcessEnv=process.env):{chatId:string;label:string}{
  const [version,iv,tag,data]=sealed.split(".");
  if(version!=="v1")throw new Error("Telegram binding unavailable");
  const decipher=createDecipheriv("aes-256-gcm",key(env),Buffer.from(iv,"base64url"));
  decipher.setAAD(Buffer.from(String(parentId)));decipher.setAuthTag(Buffer.from(tag,"base64url"));
  const parsed=JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8"));
  if(!/^[1-9]\d{0,15}$/.test(parsed.chatId)||typeof parsed.label!=="string")throw new Error("Telegram binding unavailable");
  return parsed;
}
export async function eligibleTelegramParent(db:Db,userId:number,schoolId:number,studentId?:number|null){
  return (await db.query(`SELECT DISTINCT p.id,p.user_id AS "userId" FROM parents p
    JOIN app_users u ON u.id=p.user_id AND upper(u.status)='ACTIVE'
    JOIN parent_student_relationships r ON r.parent_id=p.id AND upper(r.status)='ACTIVE'
    JOIN students s ON s.id=r.student_id AND s.school_id=$2 AND upper(s.status)='ACTIVE'
    JOIN schools school ON school.id=s.school_id AND lower(school.status)='active'
    WHERE p.user_id=$1 AND upper(p.status)='ACTIVE' AND ${familyChildSchoolScope("p","s")}
      AND ($3::int IS NULL OR s.id=$3)
      AND NOT EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=p.user_id AND m.school_id IS NULL
        AND m.role='PLATFORM_OWNER' AND upper(m.status)='ACTIVE')`,[userId,schoolId,studentId??null])).rows[0]??null;
}
export async function telegramSchoolAllowed(db:Db,schoolId:number){
  const policy=await loadNotificationPolicy(db);
  return policyEvents.some(event=>allowedNotificationChannels(policy,event,schoolId).includes("TELEGRAM"));
}
export async function checkTelegramRuntimeHealth(db:Db){
  const row=(await db.query(`SELECT to_regclass('parent_telegram_links') IS NOT NULL
    AND to_regclass('telegram_link_challenges') IS NOT NULL AND to_regclass('telegram_poll_state') IS NOT NULL AS ready`)).rows[0];
  return refreshTelegramHealth(row?.ready===true);
}
export async function createParentTelegramChallenge(db:Db,userId:number,schoolId:number){
  const health=getTelegramHealth();
  if(!health.ready)throw new AuthError(503,`Telegram unavailable (${health.reason})`);
  const parent=await eligibleTelegramParent(db,userId,schoolId);
  if(!parent)throw new AuthError(403,"A verified parent-child relationship in this school is required");
  if(!await telegramSchoolAllowed(db,schoolId))throw new AuthError(403,"Telegram is not permitted by Owner/school policy");
  // Caller holds a transaction and parent-scoped advisory lock.
  const count=(await db.query(`SELECT count(*)::int AS count FROM telegram_link_challenges
    WHERE parent_id=$1 AND created_at>now()-INTERVAL '10 minutes'`,[parent.id])).rows[0]?.count??0;
  if(count>=5)throw new AuthError(409,"Too many link requests. Wait ten minutes.");
  await db.query(`UPDATE telegram_link_challenges SET revoked_at=now(),pending_ciphertext=NULL,chat_hash=NULL
    WHERE parent_id=$1 AND confirmed_at IS NULL AND revoked_at IS NULL`,[parent.id]);
  const token=randomBytes(32).toString("base64url");
  const row=(await db.query(`INSERT INTO telegram_link_challenges(parent_id,school_id,bot_id,token_hash,expires_at)
    VALUES($1,$2,$3,$4,now()+INTERVAL '10 minutes') RETURNING expires_at AS "expiresAt"`,
    [parent.id,schoolId,health.botId,telegramTokenHash(token)])).rows[0];
  return {url:`https://t.me/${health.botUsername}?start=${token}`,expiresAt:new Date(row.expiresAt).toISOString()};
}
/** Only HTTPS getUpdates calls this; browser input can never supply a chat ID. */
export async function acceptTelegramUpdate(db:Db,update:any,env:NodeJS.ProcessEnv=process.env){
  const message=update?.message,health=getTelegramHealth(env);
  if(!health.ready||message?.chat?.type!=="private"||!Number.isSafeInteger(message.chat.id)||message.chat.id<=0
    ||message.from?.id!==message.chat.id||message.from?.is_bot===true||typeof message.text!=="string")return false;
  const chat=String(message.chat.id),hash=telegramChatHash(chat,env);
  if(/^\/(stop|unlink)$/.test(message.text)){
    const owners=(await db.query(`SELECT DISTINCT p.user_id FROM parents p WHERE p.id IN (
      SELECT parent_id FROM parent_telegram_links WHERE chat_hash=$1 AND bot_id=$2
      UNION SELECT parent_id FROM telegram_link_challenges WHERE chat_hash=$1 AND bot_id=$2 AND revoked_at IS NULL)`,
      [hash,health.botId])).rows;
    for(const owner of owners){
      await db.query("SELECT pg_advisory_xact_lock(31972,$1)",[owner.user_id]);
      await revokeParentTelegramLink(db,owner.user_id);
      await db.query(`INSERT INTO audit_logs(actor_user_id,"user",role,action,module,event_type,result,metadata)
        SELECT id,email,'PARENT','Telegram bot consent withdrawal','Communication','TELEGRAM_CONSENT_WITHDRAWN','SUCCESS','{}'::jsonb
        FROM app_users WHERE id=$1`,[owner.user_id]);
    }
    return owners.length>0;
  }
  const token=/^\/(?:start|link) ([A-Za-z0-9_-]{43})$/.exec(message.text)?.[1];if(!token)return false;
  const row=(await db.query(`SELECT id,parent_id AS "parentId",school_id AS "schoolId" FROM telegram_link_challenges
    WHERE token_hash=$1 AND bot_id=$2 AND expires_at>now() AND claimed_at IS NULL
      AND revoked_at IS NULL AND confirmed_at IS NULL`,[telegramTokenHash(token),health.botId])).rows[0];
  if(!row)return false;
  const owner=(await db.query("SELECT user_id FROM parents WHERE id=$1",[row.parentId])).rows[0];
  if(owner)await db.query("SELECT pg_advisory_xact_lock(31972,$1)",[owner.user_id]);
  if(!owner||!await eligibleTelegramParent(db,owner.user_id,row.schoolId))return false;
  const label=typeof message.from.username==="string"&&/^[A-Za-z0-9_]{1,32}$/.test(message.from.username)
    ?`@${message.from.username}`:"Private Telegram account";
  const claimed=await db.query(`UPDATE telegram_link_challenges SET claimed_at=now(),pending_ciphertext=$2,chat_hash=$3
    WHERE id=$1 AND claimed_at IS NULL AND revoked_at IS NULL AND confirmed_at IS NULL AND expires_at>now() RETURNING id`,
    [row.id,sealTelegramChat(row.parentId,{chatId:chat,label},env),hash]);
  return claimed.rows.length>0;
}
export async function confirmParentTelegramLink(db:Db,userId:number,schoolId:number){
  const health=getTelegramHealth(),parent=await eligibleTelegramParent(db,userId,schoolId);
  if(!health.ready)throw new AuthError(503,"Telegram is unavailable");
  if(!parent||!await telegramSchoolAllowed(db,schoolId))throw new AuthError(403,"Parent relationship or Telegram policy unavailable");
  const row=(await db.query(`SELECT * FROM telegram_link_challenges WHERE parent_id=$1 AND school_id=$2
    AND bot_id=$3 AND expires_at>now() AND claimed_at IS NOT NULL AND confirmed_at IS NULL
    AND revoked_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`,[parent.id,schoolId,health.botId])).rows[0];
  if(!row)throw new AuthError(409,"Start the bot using your current link before confirming");
  openTelegramChat(parent.id,row.pending_ciphertext);
  await db.query(`INSERT INTO parent_telegram_links(parent_id,bot_id,chat_ciphertext,chat_hash,consented_at)
    VALUES($1,$2,$3,$4,now()) ON CONFLICT(parent_id) DO UPDATE SET bot_id=excluded.bot_id,
    chat_ciphertext=excluded.chat_ciphertext,chat_hash=excluded.chat_hash,consented_at=now(),revoked_at=NULL,updated_at=now()`,
    [parent.id,health.botId,row.pending_ciphertext,row.chat_hash]);
  await db.query(`UPDATE telegram_link_challenges SET confirmed_at=now(),pending_ciphertext=NULL,chat_hash=NULL WHERE id=$1`,[row.id]);
}
export async function revokeParentTelegramLink(db:Db,userId:number){
  const parent=(await db.query("SELECT id FROM parents WHERE user_id=$1",[userId])).rows[0];if(!parent)return;
  await db.query(`UPDATE parent_telegram_links SET consented_at=NULL,revoked_at=now(),chat_ciphertext=NULL,
    chat_hash=NULL,updated_at=now() WHERE parent_id=$1`,[parent.id]);
  await db.query(`UPDATE telegram_link_challenges SET revoked_at=now(),pending_ciphertext=NULL,chat_hash=NULL
    WHERE parent_id=$1 AND confirmed_at IS NULL`,[parent.id]);
  await db.query(`UPDATE communication_deliveries d SET status='CANCELLED',error_code='TELEGRAM_CONSENT_WITHDRAWN',
    last_error='Telegram consent withdrawn',updated_at=now() FROM communication_notifications n
    WHERE n.id=d.notification_id AND n.recipient_user_id=$1 AND d.channel='TELEGRAM' AND d.status IN ('QUEUED','FAILED')`,[userId]);
}
export async function telegramRecipient(db:Db,userId:number,schoolId:number|null,studentId:number|null,category:string){
  if(!getTelegramHealth().ready||schoolId===null)return null;
  const parent=await eligibleTelegramParent(db,userId,schoolId,studentId);if(!parent)return null;
  const preference=(await db.query(`SELECT enabled FROM communication_preferences WHERE user_id=$1 AND channel='TELEGRAM'
    AND category=$3 AND (school_id=$2 OR school_id IS NULL) ORDER BY school_id NULLS LAST LIMIT 1`,
    [userId,schoolId,category])).rows[0];
  if(preference?.enabled===false)return null;
  const link=(await db.query(`SELECT chat_ciphertext FROM parent_telegram_links WHERE parent_id=$1 AND bot_id=$2
    AND consented_at IS NOT NULL AND revoked_at IS NULL`,[parent.id,getTelegramHealth().botId])).rows[0];
  if(!link)return null;
  try{return openTelegramChat(parent.id,link.chat_ciphertext).chatId;}catch{return null;}
}
