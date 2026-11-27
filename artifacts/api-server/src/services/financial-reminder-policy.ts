import {createHash} from "node:crypto";
import {lagosDate} from "./nfc-term-grace";
export const financialReminderPrefix="FINANCIAL_WEEKLY:v1:";
export const guardianNfcReminderPrefix="GUARDIAN_NFC_WEEKLY:v1:";
export type FinancialReminderKind="FEE"|"STUDENT_NFC"|"STAFF_NFC"|"GUARDIAN_NFC";
/** Public content is intentionally fixed: no financial evidence, interpolation,
 * payment instructions or link may be copied into this guardian notice. */
export const guardianNfcReminderContent=Object.freeze({
 category:"SUBSCRIPTION" as const,subject:"Required NFC card/subscription",
 body:"Your child's required NFC card/subscription remains outstanding. Please contact the school.",
 link:null,
});
export const scheduledReminderKey=(key:string|null|undefined)=>
 !!key&&(key.startsWith(financialReminderPrefix)||key.startsWith(guardianNfcReminderPrefix));
export function financialScheduleDay(now=new Date()){
 const day=lagosDate(now),weekday=new Date(`${day}T12:00:00Z`).getUTCDay();
 return weekday===1||weekday===5?day:null;
}
export function financialSnapshot(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
export function financialReminderScope(day:string,kind:FinancialReminderKind,entity:number,term:number){
 if(kind==="GUARDIAN_NFC")return `${guardianNfcReminderPrefix}${day}:${entity}:${term}:`;
 return `${financialReminderPrefix}${day}:${kind}:${entity}:${term}:`;
}
export function parseFinancialReminder(key:string|null|undefined){
 const guardian=key?.match(/^GUARDIAN_NFC_WEEKLY:v1:(\d{4}-\d{2}-\d{2}):([1-9]\d*):([1-9]\d*):([a-f0-9]{64})$/);
 const m=guardian?[guardian[0],guardian[1],"GUARDIAN_NFC",guardian[2],guardian[3],guardian[4]]:
  key?.match(/^FINANCIAL_WEEKLY:v1:(\d{4}-\d{2}-\d{2}):(FEE|STUDENT_NFC|STAFF_NFC):([1-9]\d*):([1-9]\d*):([a-f0-9]{64})$/);
 if(!m||financialScheduleDay(new Date(`${m[1]}T12:00:00Z`))!==m[1])return null;
 const entity=Number(m[3]),term=Number(m[4]);
 return Number.isSafeInteger(entity)&&Number.isSafeInteger(term)?
  {day:m[1],kind:m[2] as FinancialReminderKind,entity,term,digest:m[5]}:null;
}
/** Fixed platform selection, not a school campaign/default. Existing launch,
 * delivery pauses, transport configuration and recipient consent still apply. */
export const financialReminderChannels=["IN_APP","TELEGRAM","PUSH","SMS","EMAIL"] as const;
export const staffFinancialReminder=(key:string|null|undefined)=>parseFinancialReminder(key)?.kind==="STAFF_NFC";
