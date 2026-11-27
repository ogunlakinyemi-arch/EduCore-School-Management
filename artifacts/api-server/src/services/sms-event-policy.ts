/** SMS is a narrowly scoped opt-in, never a general notification transport. */
import {AsyncLocalStorage} from "node:async_hooks";
import {parseFinancialReminder} from "./financial-reminder-policy";
const fieldCampaign=new AsyncLocalStorage<boolean>();
/** Only the fresh Owner-authorized, confirmed campaign dispatcher enters this scope. */
export const withFieldSmsCampaignScope=<T>(fn:()=>Promise<T>)=>fieldCampaign.run(true,fn);
export const smsEventAllowed = (event: string) =>
  event === "EMERGENCY" || event === "ATTENDANCE_ABSENCE"
    || event==="FINANCIAL_WEEKLY"
    || (event==="BRO_FIELD_FOLLOWUP"&&fieldCampaign.getStore()===true);

export function smsNotificationAllowed(category: string, eventKey: string | null, studentId: unknown): boolean {
  const key = (eventKey ?? "").toUpperCase();
  const scheduled=parseFinancialReminder(eventKey);
  return (scheduled?.kind==="GUARDIAN_NFC"&&category==="SUBSCRIPTION"&&Number(studentId)===scheduled.entity)
    ||(category==="FINANCE"&&!!scheduled&&scheduled.kind!=="GUARDIAN_NFC")
    || /(?:^|:)EMERGENCY(?:$|:)/.test(key)
    || (category === "ATTENDANCE" && /ABSEN/.test(key)
      && Number.isSafeInteger(Number(studentId)) && Number(studentId) > 0);
}
