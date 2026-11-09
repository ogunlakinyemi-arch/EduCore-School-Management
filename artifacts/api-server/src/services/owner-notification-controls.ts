import {AsyncLocalStorage} from "node:async_hooks";
import {z} from "zod";
type Db={query:(sql:string,values?:any[])=>Promise<{rows:any[]}>};
export const deliveryControlInput=z.object({
  paused:z.boolean(),smsEnabled:z.boolean(),pushEnabled:z.boolean(),telegramEnabled:z.boolean(),
  pushParentIds:z.array(z.number().int().positive()).max(20),
  expectedVersion:z.number().int().nonnegative(),reason:z.string().trim().min(5).max(500),
}).strict();
export type DeliveryControls={paused:boolean;smsEnabled:boolean;pushEnabled:boolean;telegramEnabled:boolean;
  pushParentIds:number[];version:number;activatedAt:string|null};
export const disabledDeliveryControls=():DeliveryControls=>({paused:true,smsEnabled:false,pushEnabled:false,
  telegramEnabled:false,pushParentIds:[],version:0,activatedAt:null});
export const ownerNotificationDevelopment=(env:NodeJS.ProcessEnv=process.env)=>env.NODE_ENV==="development"&&!env.REPLIT_DEPLOYMENT;
const scope=new AsyncLocalStorage<DeliveryControls>();
export const ownerNotificationScope=()=>ownerNotificationDevelopment()?scope.getStore():undefined;
/** Only the isolated delivery worker enters this scope. Never used by financial jobs. */
export const withOwnerNotificationScope=<T,>(state:DeliveryControls,fn:()=>Promise<T>)=>scope.run(state,fn);
export function ownerTransportAllowed(channel:"SMS"|"PUSH"|"TELEGRAM",userId?:number|string):boolean{
  const state=ownerNotificationScope();
  return !!state&&!state.paused&&!!state.activatedAt&&(channel==="SMS"?state.smsEnabled:
    channel==="TELEGRAM"?state.telegramEnabled:state.pushEnabled&&(userId===undefined||state.pushParentIds.includes(Number(userId))));
}
export async function loadOwnerDeliveryControls(db:Db):Promise<DeliveryControls>{
  const row=(await db.query(`SELECT id,metadata,"timestamp" AS created_at FROM audit_logs
    WHERE module='OwnerNotificationDelivery' AND event_type='DEVELOPMENT_DELIVERY_CONTROLS_UPDATED'
      AND role='PLATFORM_OWNER' AND school_id IS NULL AND result='SUCCESS' ORDER BY id DESC LIMIT 1`)).rows[0];
  if(!row)return disabledDeliveryControls();
  const parsed=deliveryControlInput.omit({expectedVersion:true,reason:true}).safeParse(row.metadata?.controls);
  if(!parsed.success)return disabledDeliveryControls();
  return {...parsed.data,version:Number(row.id),activatedAt:row.metadata?.activatedAt??null};
}
export const financialNotification=(category:string,key:string|null)=>["FINANCE","PAYMENT","SUBSCRIPTION","PARTNER"].includes(category)
  ||/(PAYMENT|FINANCE|SUBSCRIPTION|INVOICE|NFC|CARD_REMINDER|COMMISSION|PAYOUT|SETTLEMENT|FEE)/i.test(key??"");
/** Fixed identifiers only. Bound dates and recipient IDs prevent backlog release. */
export function ownerDeliveryClaimSql(dateParam:string,idsParam:string){
  return `d.created_at>=${dateParam}::timestamptz AND EXISTS (
    SELECT 1 FROM communication_notifications owner_n WHERE owner_n.id=d.notification_id
      AND owner_n.created_at>=${dateParam}::timestamptz
      AND owner_n.category NOT IN ('FINANCE','PAYMENT','SUBSCRIPTION','PARTNER')
      AND upper(coalesce(owner_n.event_key,'')) !~ '(PAYMENT|FINANCE|SUBSCRIPTION|INVOICE|NFC|CARD_REMINDER|COMMISSION|PAYOUT|SETTLEMENT|FEE)'
      AND (d.channel<>'PUSH' OR owner_n.recipient_user_id=ANY(${idsParam}::int[])))`;
}
export async function pushTestCandidates(db:Db){
  const {pushSubscriptionSchema}=await import("./web-push-provider");
  const rows=(await db.query(`SELECT DISTINCT u.id AS "userId",p.school_id AS "schoolId",
    d.subscription,d.session_id AS "sessionId"
    FROM parents p JOIN app_users u ON u.id=p.user_id JOIN schools s ON s.id=p.school_id
    JOIN communication_push_devices d ON d.user_id=u.id AND d.school_id=p.school_id AND d.status='ACTIVE'
    WHERE upper(p.status)='ACTIVE' AND upper(u.status)='ACTIVE' AND upper(s.status)='ACTIVE'
      AND d.subscription IS NOT NULL AND d.session_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM parent_student_relationships r JOIN students child ON child.id=r.student_id
        WHERE r.parent_id=p.id AND upper(r.status)='ACTIVE' AND child.school_id=p.school_id AND upper(child.status)='ACTIVE')
      AND EXISTS (SELECT 1 FROM communication_preferences pref WHERE pref.user_id=u.id AND pref.channel='PUSH'
        AND pref.enabled=true AND pref.school_id=p.school_id
        AND pref.category NOT IN ('FINANCE','PAYMENT','SUBSCRIPTION','PARTNER'))
    ORDER BY u.id,p.school_id LIMIT 100`)).rows;
  const teachers=(await db.query(`SELECT DISTINCT u.id AS "userId",e.school_id AS "schoolId",
    d.subscription,d.session_id AS "sessionId"
    FROM employees e JOIN app_users u ON u.id=e.user_id
    JOIN schools s ON s.id=e.school_id
    JOIN communication_push_devices d ON d.user_id=u.id AND d.school_id=e.school_id AND d.status='ACTIVE'
    WHERE upper(e.employee_type)='TEACHER' AND upper(e.employment_status)='ACTIVE'
      AND upper(u.status)='ACTIVE' AND upper(s.status)='ACTIVE'
      AND d.subscription IS NOT NULL AND d.session_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=u.id AND m.school_id=e.school_id
        AND m.role='TEACHER' AND upper(m.status)='ACTIVE')
      AND EXISTS(SELECT 1 FROM communication_preferences pref WHERE pref.user_id=u.id
        AND pref.school_id=e.school_id AND pref.channel='PUSH' AND pref.category='ACADEMIC' AND pref.enabled=true)
    ORDER BY u.id,e.school_id LIMIT 100`)).rows;
  const candidates=[...new Map([...rows,...teachers].map(row=>[`${row.userId}:${row.schoolId}`,row])).values()];
  return candidates.map(row=>{
    const eligible=pushSubscriptionSchema.safeParse(row.subscription).success
      && !(Number(row.subscription?.expirationTime)>0&&Number(row.subscription.expirationTime)<=Date.now());
    return {userId:Number(row.userId),schoolId:Number(row.schoolId),eligible,
      reason:eligible?"Stored registration and explicit opt-in; live session and event consent are rechecked before sending."
        :"Stored subscription is invalid or expired; the recipient must re-register before selection."};
  });
}
