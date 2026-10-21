import { z } from "zod";
import { createEmailProvider, createSmsProvider } from "./communication-providers";
import { developmentPaymentNotificationsSuppressed } from "../lib/development-payment-notification-policy";
import {getTelegramHealth} from "./telegram-provider";
export const policyEvents = ["ATTENDANCE_ENTRY","ATTENDANCE_EXIT","ATTENDANCE_ABSENCE","NFC_REMINDER","SUBSCRIPTION",
  "EMERGENCY","ATTENDANCE","ACADEMIC","ASSIGNMENT","FINANCE","PAYMENT","ANNOUNCEMENT","ACCOUNT","SYSTEM","PARTNER","SECURITY"] as const;
export const policyChannels = ["IN_APP","PUSH","SMS","EMAIL","TELEGRAM"] as const;
export type PolicyChannel = typeof policyChannels[number];
const channel = z.enum(policyChannels);
const rule = z.object({ allowed:z.array(channel).max(5), defaults:z.array(channel).max(5) })
  .refine(r=>r.defaults.every(c=>r.allowed.includes(c)), "Defaults must be allowed channels");
export const notificationPolicySchema = z.object({
  events:z.record(z.enum(policyEvents),rule),
  schools:z.record(z.string().regex(/^[1-9]\d*$/),z.object({enabled:z.boolean(),allowed:z.array(channel).max(5)})),
});
export type NotificationChannelPolicy = z.infer<typeof notificationPolicySchema>;
type Db = {query:(sql:string,values?:unknown[])=>Promise<{rows:any[]}>};
export function defaultNotificationPolicy():NotificationChannelPolicy {
  return {events:Object.fromEntries(policyEvents.map(event=>[event,{
    allowed:["IN_APP","EMAIL","PUSH",...(["ATTENDANCE_ENTRY","ATTENDANCE_EXIT","ATTENDANCE_ABSENCE","ATTENDANCE","EMERGENCY"].includes(event)?["SMS"]:[])],
    defaults:["IN_APP"],
  }])),schools:{}} as NotificationChannelPolicy;
}
/** Append-only existing audit storage avoids a migration; absent policy is conservative. */
export async function loadNotificationPolicy(db:Db):Promise<NotificationChannelPolicy> {
  const r=await db.query(`SELECT metadata->'policy' AS policy FROM audit_logs WHERE module='NotificationPolicy'
    AND event_type='GLOBAL_CHANNEL_POLICY_UPDATED' AND role='PLATFORM_OWNER' AND school_id IS NULL
    AND result='SUCCESS'
    ORDER BY id DESC LIMIT 1`);
  if(!r.rows[0])return defaultNotificationPolicy();
  // Malformed stored policy fails closed rather than reverting to permissive defaults.
  return notificationPolicySchema.parse(r.rows[0].policy);
}
export function notificationEvent(category:string,eventKey:string|null):typeof policyEvents[number] {
  const key=(eventKey??"").toUpperCase();
  if(key.includes("EMERGENCY"))return "EMERGENCY";
  if(category==="ATTENDANCE" || category==="SECURITY"){
    if(key.includes("SCHOOL_EXIT")||key.includes("SECURITY_EXIT")||key.includes(":EXIT"))return "ATTENDANCE_EXIT";
    if(key.includes("SCHOOL_ENTRY")||key.includes("SECURITY_ENTRY")||key.includes(":ENTRY"))return "ATTENDANCE_ENTRY";
    if(category==="ATTENDANCE"&&(key.includes("ABSEN")||key.includes("DISCREP")))return "ATTENDANCE_ABSENCE";
  }
  if(key.includes("NFC")||key.includes("CARD_REMINDER"))return "NFC_REMINDER";
  return policyEvents.includes(category as any)?category as typeof policyEvents[number]:"SYSTEM";
}
export function allowedNotificationChannels(policy:NotificationChannelPolicy,event:string,schoolId:number|null):PolicyChannel[]{
  const configured=policy.events[event as keyof typeof policy.events];
  if(!configured)return [];
  const school=schoolId===null?undefined:policy.schools[String(schoolId)];
  if(school?.enabled===false)return [];
  return configured.allowed.filter(c=>!school||school.allowed.includes(c));
}
export function notificationChannelAvailability(env:NodeJS.ProcessEnv=process.env):Record<PolicyChannel,boolean>{
  const ready=(kind:"SMS"|"EMAIL")=>{
    if(developmentPaymentNotificationsSuppressed(env))return false;
    const selected=env[kind==="SMS"?"COMMUNICATION_SMS_PROVIDER":"COMMUNICATION_EMAIL_PROVIDER"];
    if(!selected||["mock","dev","development","test"].includes(selected.toLowerCase()))return false;
    try { const p=kind==="SMS"?createSmsProvider(env):createEmailProvider(env);return !p.provider.startsWith("mock"); }
    catch{return false;}
  };
  return {IN_APP:true,SMS:ready("SMS"),EMAIL:ready("EMAIL"),
    PUSH:!developmentPaymentNotificationsSuppressed(env)&&!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&/^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT??"")),
    TELEGRAM:getTelegramHealth(env).ready};
}
