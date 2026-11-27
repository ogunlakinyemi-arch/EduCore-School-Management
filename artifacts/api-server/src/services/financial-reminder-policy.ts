import {createHash} from "node:crypto";
import {lagosDate} from "./nfc-term-grace";
export const financialReminderPrefix="FINANCIAL_WEEKLY:v1:";
export type FinancialReminderKind="FEE"|"STUDENT_NFC"|"STAFF_NFC";
export function financialScheduleDay(now=new Date()){
 const day=lagosDate(now),weekday=new Date(`${day}T12:00:00Z`).getUTCDay();
 return weekday===1||weekday===5?day:null;
}
export function financialSnapshot(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
export function financialReminderScope(day:string,kind:FinancialReminderKind,entity:number,term:number){
 return `${financialReminderPrefix}${day}:${kind}:${entity}:${term}:`;
}
export function parseFinancialReminder(key:string|null|undefined){
 const m=key?.match(/^FINANCIAL_WEEKLY:v1:(\d{4}-\d{2}-\d{2}):(FEE|STUDENT_NFC|STAFF_NFC):([1-9]\d*):([1-9]\d*):([a-f0-9]{64})$/);
 if(!m||financialScheduleDay(new Date(`${m[1]}T12:00:00Z`))!==m[1])return null;
 const entity=Number(m[3]),term=Number(m[4]);
 return Number.isSafeInteger(entity)&&Number.isSafeInteger(term)?
  {day:m[1],kind:m[2] as FinancialReminderKind,entity,term,digest:m[5]}:null;
}
/** Fixed platform selection, not a school campaign/default. Existing launch,
 * delivery pauses, transport configuration and recipient consent still apply. */
export const financialReminderChannels=["IN_APP","TELEGRAM","PUSH","SMS","EMAIL"] as const;
export const staffFinancialReminder=(key:string|null|undefined)=>parseFinancialReminder(key)?.kind==="STAFF_NFC";
