import { z } from "zod";
import { createEmailProvider } from "./communication-providers";
import { validVapidConfiguration, vapidConfiguration, vapidConfigurationProblem } from "./web-push-configuration";
import { developmentPaymentNotificationsSuppressed } from "../lib/development-payment-notification-policy";
import {getTelegramHealth} from "./telegram-provider";
import { notificationLaunchBoundary } from "./notification-launch-boundary";
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
    allowed:["IN_APP","EMAIL","PUSH","TELEGRAM"],
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
export function globallyAllowedChannels(policy:NotificationChannelPolicy):Set<PolicyChannel>{
  return new Set(Object.values(policy.events).flatMap(rule=>rule?.allowed??[]));
}
export type PolicyValidationIssue = "UNAVAILABLE_DEFAULT" | "OVERRIDE_NOT_GLOBALLY_ALLOWED";
/**
 * The only savable policy states: a channel may be Allowed while its delivery is
 * unavailable (permission never activates delivery), but it may not newly become
 * a Default; a school override may only opt into globally allowed channels.
 * Entries already saved in the current policy are retained (and removable) so a
 * changed environment never blocks saving unrelated edits.
 */
export function policyValidationIssue(next:NotificationChannelPolicy,current:NotificationChannelPolicy,
  availability:Record<PolicyChannel,boolean>):PolicyValidationIssue|null{
  for(const [event,rule] of Object.entries(next.events)){
    const previous=current.events[event as keyof typeof current.events]?.defaults??[];
    if(rule?.defaults.some(c=>!availability[c]&&!previous.includes(c)))return "UNAVAILABLE_DEFAULT";
  }
  const global=globallyAllowedChannels(next);
  for(const [id,override] of Object.entries(next.schools)){
    const previous=current.schools[id]?.allowed??[];
    if(override.allowed.some(c=>!global.has(c)&&!previous.includes(c)))return "OVERRIDE_NOT_GLOBALLY_ALLOWED";
  }
  return null;
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
  // SMS is not operationally available. Retain saved policy/history, but never
  // queue or dispatch it until a separately approved SMS implementation release.
  return configured.allowed.filter(c=>c!=="SMS"&&(!school||school.allowed.includes(c)));
}
/** Allowed is a ceiling, never a selection. An absent event override inherits
 * the Owner default; an explicit empty override selects no channels. */
export function effectiveNotificationChannels(
  policy: NotificationChannelPolicy, event: string, schoolId: number | null,
  schoolDefaults?: Record<string, readonly string[]>,
): PolicyChannel[] {
  const override = schoolDefaults?.[event];
  const selected = override === undefined
    ? policy.events[event as keyof typeof policy.events]?.defaults ?? []
    : Array.isArray(override) ? override : [];
  const allowed = allowedNotificationChannels(policy, event, schoolId);
  return [...new Set(selected)].filter((c): c is PolicyChannel => allowed.includes(c as PolicyChannel));
}
export function notificationChannelAvailability(env:NodeJS.ProcessEnv=process.env):Record<PolicyChannel,boolean>{
  if (!notificationLaunchBoundary(env).allowed) {
    return { IN_APP: true, SMS: false, EMAIL: false, PUSH: false, TELEGRAM: false };
  }
  return notificationChannelConfiguration(env);
}
/** Setup/consent may be prepared without permitting a dispatcher claim. */
export function notificationChannelConfiguration(env:NodeJS.ProcessEnv=process.env):Record<PolicyChannel,boolean>{
  const emailReady=()=>{
    if(developmentPaymentNotificationsSuppressed(env))return false;
    const selected=env.COMMUNICATION_EMAIL_PROVIDER?.trim().toLowerCase();
    if(!selected||["mock","dev","development","test"].includes(selected.toLowerCase()))return false;
    try { const p=createEmailProvider(env);return ["resend","http-email"].includes(p.provider); }
    catch{return false;}
  };
  return {IN_APP:true,SMS:false,EMAIL:emailReady(),
    PUSH:!developmentPaymentNotificationsSuppressed(env)&&validVapidConfiguration(vapidConfiguration(env)),
    TELEGRAM:getTelegramHealth(env).ready};
}

/** Fixed, non-secret diagnostics; no provider calls and no sender/key disclosure. */
export function emailSetupDetail(env: NodeJS.ProcessEnv = process.env): string {
  const selected = env.COMMUNICATION_EMAIL_PROVIDER?.trim().toLowerCase();
  if (!selected) return "Owner setup required: confirm the saved COMMUNICATION_EMAIL_PROVIDER setting selects Resend. Do not add a duplicate setting.";
  if (["mock","dev","development","test"].includes(selected)) return "COMMUNICATION_EMAIL_PROVIDER selects a non-delivering mock/test provider.";
  if (!["resend","http"].includes(selected)) return "COMMUNICATION_EMAIL_PROVIDER must select a supported provider: resend or http.";
  if (selected === "resend") {
    if (!env.EMAIL_FROM) return "Owner setup required: confirm the saved EMAIL_FROM setting uses the approved verified sender. Do not invent or overwrite the sender.";
    if (!env.RESEND_API_KEY) return "Owner setup required: the Resend credential is unavailable to this runtime. Configure it securely, never in chat.";
  }
  if (selected === "http") {
    if (!env.COMMUNICATION_EMAIL_ENDPOINT) return "COMMUNICATION_EMAIL_ENDPOINT is missing for the selected HTTP Email provider.";
    if (!env.COMMUNICATION_EMAIL_API_KEY) return "COMMUNICATION_EMAIL_API_KEY is missing for the selected HTTP Email provider.";
  }
  if (developmentPaymentNotificationsSuppressed(env)) return "Email sending is restricted by the Development notification safety lock.";
  if (!notificationChannelConfiguration(env).EMAIL) return selected === "resend"
    ? "EMAIL_FROM must be a valid sender on a Resend-verified domain, not a Gmail/Googlemail address. The company contact can be used as Reply-To, not as a Resend From address."
    : "COMMUNICATION_EMAIL_ENDPOINT is invalid for the selected HTTP Email provider; it must be a valid HTTPS endpoint.";
  return "Email is configured for preference setup. Provider/domain authorization and recipient delivery are not verified by this local check.";
}

/** Owner-facing explanation only. No provider requests, DB reads or readiness mutation. */
export function notificationChannelReadiness(env: NodeJS.ProcessEnv = process.env) {
  const configured=notificationChannelConfiguration(env);
  const launch=notificationLaunchBoundary(env);
  const telegram=getTelegramHealth(env);
  const delivery=notificationChannelAvailability(env);
  const held=!env.EDUCORE_NOTIFICATION_LIVE_FROM
    ?"External delivery is held: EDUCORE_NOTIFICATION_LIVE_FROM is not set. Existing TEST history remains isolated."
    :"External delivery is held: the notification launch cutoff is invalid, in the future or before the retained TEST boundary. Existing TEST history remains isolated.";
  const pushMissing=["VAPID_PUBLIC_KEY","VAPID_PRIVATE_KEY","VAPID_SUBJECT"].filter(key=>!env[key]);
  const pushProblem=vapidConfigurationProblem(vapidConfiguration(env));
  const details:Record<PolicyChannel,string>={
    IN_APP:"In-App is available under existing user and school permissions.",
    SMS:"SMS is disabled.",
    EMAIL:emailSetupDetail(env),
    PUSH:pushMissing.length
      ?`Push configuration is incomplete: ${pushMissing.join(", ")}.`
      :configured.PUSH
        ?"Push configuration passes local validation. A recipient still needs a supported browser, permission and an active subscription; receipt is not verified."
        :developmentPaymentNotificationsSuppressed(env)
          ?"Push sending is restricted by the Development notification safety lock."
          :`Push configuration validation failed: ${pushProblem}`,
    TELEGRAM:`Telegram runtime health: ${telegram.reason}. Bot readiness does not override the launch hold, parent consent or school permissions.`,
  };
  return Object.fromEntries(policyChannels.map(channel=>[channel,{
    configurationReady:configured[channel],
    deliveryReady:delivery[channel],
    configurationDetail:details[channel],
    deliveryHold:channel!=="IN_APP"&&channel!=="SMS"&&!launch.allowed?held:null,
  }])) as Record<PolicyChannel,{
    configurationReady:boolean;deliveryReady:boolean;configurationDetail:string;deliveryHold:string|null;
  }>;
}
