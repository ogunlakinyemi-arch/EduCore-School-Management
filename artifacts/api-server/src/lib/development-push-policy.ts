import { developmentPaymentNotificationsSuppressed } from "./development-payment-notification-policy";
import {ownerTransportAllowed} from "../services/owner-notification-controls";

/** A known hold must defer queue claims, not consume failed delivery attempts. */
export function developmentPushDispatchEnabled(env: NodeJS.ProcessEnv = process.env) {
  if(ownerTransportAllowed("PUSH"))return true;
  return env.NODE_ENV !== "development" || !!env.REPLIT_DEPLOYMENT
    || (!developmentPaymentNotificationsSuppressed(env)
      && env.EDUCORE_DEVELOPMENT_PUSH_ENABLED === "true"
      && (env.EDUCORE_DEVELOPMENT_PUSH_USER_IDS ?? "").split(",").some(v=>/^[1-9]\d*$/.test(v.trim())));
}

/** Credentials are configuration, not consent to send to Development users. */
export function developmentPushAllowed(userId: number | string, env: NodeJS.ProcessEnv = process.env) {
  if(ownerTransportAllowed("PUSH",userId))return true;
  if (env.NODE_ENV !== "development" || env.REPLIT_DEPLOYMENT) return true;
  return !developmentPaymentNotificationsSuppressed(env)
    && env.EDUCORE_DEVELOPMENT_PUSH_ENABLED === "true"
    && (env.EDUCORE_DEVELOPMENT_PUSH_USER_IDS ?? "").split(",").map(v => v.trim()).includes(String(userId));
}
