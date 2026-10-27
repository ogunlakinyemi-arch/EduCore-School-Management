import { timingSafeEqual } from "node:crypto";
import { HostedPaymentError, type HostedMode } from "./hosted-manual-policy";

export type HostedVerification = {
  reference: string; transactionId: string; currency: string; amountMinor: number;
  status: "successful" | "pending" | "failed"; feeMinor: number | null;
};
export interface HostedCheckoutAdapter {
  initialize(input: { reference: string; email: string; returnUrl: string; mode: HostedMode }): Promise<string>;
  verify(reference: string): Promise<HostedVerification>;
  authenticate(hash: string | undefined): boolean;
}
function minor(value: unknown): number {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Invalid provider amount");
  const n = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(n)) throw new Error("Invalid provider amount");
  return n;
}
export function normalizeHostedVerification(raw: any): HostedVerification {
  if (raw?.status !== "success" || !raw.data || !/^\d+$/.test(String(raw.data.id))) {
    throw new HostedPaymentError(503, "VERIFICATION_UNAVAILABLE", "Payment verification is unavailable; do not pay again.");
  }
  const d = raw.data;
  const status = d.status === "successful" ? "successful"
    : ["failed", "cancelled"].includes(d.status) ? "failed" : "pending";
  return { reference: String(d.tx_ref ?? ""), transactionId: String(d.id),
    currency: String(d.currency ?? ""), amountMinor: minor(d.amount), status,
    feeMinor: d.app_fee === undefined || d.app_fee === null ? null : minor(d.app_fee) };
}
export function safeHostedUrl(value: unknown): string {
  const u = new URL(String(value));
  if (u.protocol !== "https:" || u.username || u.password ||
      !["checkout.flutterwave.com", "checkout-v2.flutterwave.com"].includes(u.hostname)) {
    throw new Error("Untrusted checkout URL");
  }
  return u.href;
}
/** One adapter, deliberately no subaccount, split, payout or refund API methods. */
export class FlutterwaveHostedAdapter implements HostedCheckoutAdapter {
  constructor(private secret: string, private webhookHash: string, private http: typeof fetch = fetch) {}
  authenticate(hash: string | undefined) {
    const a = Buffer.from(hash ?? ""), b = Buffer.from(this.webhookHash);
    return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  }
  private async request(path: string, body?: unknown) {
    const response = await this.http(`https://api.flutterwave.com/v3/${path}`, {
      method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${this.secret}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error("Provider request unresolved");
    return response.json() as Promise<any>;
  }
  async initialize(input: { reference: string; email: string; returnUrl: string; mode: HostedMode }) {
    const result = await this.request("payments", { tx_ref: input.reference, amount: "5000.00", currency: "NGN",
      redirect_url: input.returnUrl, customer: { email: input.email },
      meta: { educore_policy: "HOSTED_MANUAL_V1", environment: input.mode },
      customizations: { title: "EduCore student term subscription" } });
    if (result?.status !== "success") throw new Error("Checkout unresolved");
    return safeHostedUrl(result.data?.link);
  }
  async verify(reference: string) {
    return normalizeHostedVerification(await this.request(`transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`));
  }
}
