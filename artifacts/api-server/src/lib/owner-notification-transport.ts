import {ownerTransportAllowed,ownerNotificationDevelopment} from "../services/owner-notification-controls";
import {developmentPaymentNotificationsSuppressed} from "./development-payment-notification-policy";
/** Broad/payment pauses remain untouched. Only non-financial, Owner-scoped delivery can use this exception. */
export const notificationTransportSuppressed=(channel:"SMS"|"PUSH"|"TELEGRAM",env:NodeJS.ProcessEnv=process.env)=>
  ownerNotificationDevelopment(env)?!ownerTransportAllowed(channel):
    developmentPaymentNotificationsSuppressed(env);
