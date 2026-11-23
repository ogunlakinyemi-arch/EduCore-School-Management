import {eligibleTelegramParent} from "./telegram-links";
import {eligibleTelegramTeacher} from "./teacher-telegram";
type Db={query:(sql:string,values?:any[])=>Promise<{rows:any[]}>};
type Recipient={recipientUserId:number|string;schoolId:number|string|null;subjectStudentId:number|string|null;category:string};
/** A missing destination is not evidence of opt-out. Never recover old CANCELLED work. */
export async function missingTelegramDestination(db:Db,r:Recipient,teacher:boolean){
  if(r.schoolId===null)return "RECIPIENT_UNAUTHORIZED" as const;
  const userId=Number(r.recipientUserId),schoolId=Number(r.schoolId);
  const parent=teacher?null:await eligibleTelegramParent(db,userId,schoolId,r.subjectStudentId===null?null:Number(r.subjectStudentId));
  if(teacher?!await eligibleTelegramTeacher(db,userId,schoolId):!parent)return "RECIPIENT_UNAUTHORIZED" as const;
  const preference=(await db.query(`SELECT enabled FROM communication_preferences
    WHERE user_id=$1 AND category=$2 AND channel='TELEGRAM' AND (school_id=$3 OR school_id IS NULL)
    ORDER BY school_id NULLS LAST LIMIT 1`,[userId,r.category,schoolId])).rows[0];
  if(preference?.enabled===false)return "RECIPIENT_PREFERENCE" as const;
  const link=(await db.query(teacher
    ?`SELECT consented_at,revoked_at FROM teacher_telegram_links WHERE user_id=$1`
    :`SELECT consented_at,revoked_at FROM parent_telegram_links WHERE parent_id=$1`,[teacher?userId:parent.id])).rows[0];
  if(link&&(link.revoked_at||!link.consented_at))return "TELEGRAM_CONSENT_WITHDRAWN" as const;
  // First connection, a changed bot/account, or unreadable binding requires the
  // existing personal challenge and explicit confirmation, never a supplied chat ID.
  return "TELEGRAM_WAITING_FOR_LINK" as const;
}

/** Campaigns have explicit expiry; do not invent a new retention policy for other notices. */
export async function communicationCampaignCurrent(db:Db,eventKey:string|null,schoolId:number|string|null,now:Date){
  const id=eventKey?.match(/^COMMUNICATION_CAMPAIGN:([1-9]\d*):/)?.[1];
  if(!id)return true;
  const c=(await db.query(`SELECT status,expires_at FROM communication_campaigns WHERE id=$1 AND school_id=$2`,
    [id,schoolId])).rows[0];
  return !!c&&!["CANCELLED","EXPIRED"].includes(c.status)&&(!c.expires_at||new Date(c.expires_at).getTime()>now.getTime());
}
