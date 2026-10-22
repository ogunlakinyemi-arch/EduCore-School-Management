import { developmentPaymentNotificationsSuppressed } from "./development-payment-notification-policy";

/** Credentials are configuration, not consent to send to Development users. */
export function developmentPushAllowed(userId: number | string, env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "development" || env.REPLIT_DEPLOYMENT) return true;
  return !developmentPaymentNotificationsSuppressed(env)
    && env.EDUCORE_DEVELOPMENT_PUSH_ENABLED === "true"
    && (env.EDUCORE_DEVELOPMENT_PUSH_USER_IDS ?? "").split(",").map(v => v.trim()).includes(String(userId));
}
