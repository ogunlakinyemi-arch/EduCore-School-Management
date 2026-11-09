import type {CommunicationProviderOptions, ProviderFailureCategory, ProviderSendResult, SmsMessage, SmsProvider} from "./communication-providers";
import {normalizeTermiiRecipient} from "./communication-providers";
import {developmentPaymentNotificationsSuppressed} from "../lib/development-payment-notification-policy";
import {smsEventAllowed} from "./sms-event-policy";
import {notificationTransportSuppressed} from "../lib/owner-notification-transport";

export function bulkSmsConfigurationReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COMMUNICATION_SMS_PROVIDER?.trim().toLowerCase() === "bulksmsnigeria"
    && !!env.BULKSMSNIGERIA_API_TOKEN?.trim()
    && /^[A-Za-z0-9 ]{1,11}$/.test(env.BULKSMSNIGERIA_SENDER_ID ?? "");
}

/** v2 acceptance is not a delivery report. Never log response bodies or credentials. */
export class BulkSmsNigeriaProvider implements SmsProvider {
  readonly provider = "bulksmsnigeria";
  readonly channel = "sms" as const;
  constructor(private readonly token: string, private readonly sender: string,
    private readonly options: CommunicationProviderOptions = {}) {}
  async send(message: SmsMessage): Promise<ProviderSendResult> {
    const failure = (category: ProviderFailureCategory, retryable = false, retryAfterSeconds?: number): ProviderSendResult =>
      ({provider:this.provider,channel:this.channel,status:"FAILED",accepted:false,delivered:false,
        failure:{category,retryable,...(retryAfterSeconds ? {retryAfterSeconds} : {})}});
    if (notificationTransportSuppressed("SMS")) return failure("CONFIGURATION");
    if (!smsEventAllowed(message.event ?? "")) return failure("INVALID_REQUEST");
    const phone = normalizeTermiiRecipient(message.to);
    if (!phone || !/^\+234\d{10}$/.test(phone) || !message.body.trim() || message.body.length > 1530)
      return failure("INVALID_REQUEST");
    if (!this.token.trim() || !/^[A-Za-z0-9 ]{1,11}$/.test(this.sender)) return failure("CONFIGURATION");
    try {
      const response = await (this.options.fetch ?? fetch)("https://www.bulksmsnigeria.com/api/v2/sms", {
        method:"POST",redirect:"error",signal:AbortSignal.timeout(this.options.timeoutMs ?? 8000),
        headers:{"Authorization":`Bearer ${this.token}`,"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({from:this.sender,to:phone.slice(1),body:message.body,gateway:"direct-refund"}),
      });
      if (response.status === 429) {
        const delay = Number(response.headers.get("retry-after"));
        return failure("RATE_LIMITED",true,Number.isSafeInteger(delay) && delay > 0 ? Math.min(delay,21600) : undefined);
      }
      if (response.status === 401 || response.status === 403) return failure("AUTHENTICATION");
      if (response.status >= 500 || response.status === 408) return failure("UNKNOWN");
      if (!response.ok) return failure("PROVIDER_REJECTED");
      const result = await response.json() as {status?:unknown;code?:unknown;data?:{message_id?:unknown}} | null;
      const id = result?.data?.message_id;
      if (result?.status !== "success" || result?.code !== "BSNG-0000")
        return failure(result?.status === "error" ? "PROVIDER_REJECTED" : "UNKNOWN");
      if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) return failure("UNKNOWN");
      return {provider:this.provider,channel:this.channel,status:"ACCEPTED",accepted:true,delivered:false,providerMessageId:id};
    } catch {
      // Acceptance may have occurred: existing dispatcher holds this for reconciliation.
      return failure("UNKNOWN");
    }
  }
}
