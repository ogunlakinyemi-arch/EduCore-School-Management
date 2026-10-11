import { FlutterwaveTestAdapter, PaymentProviderError, type AdapterHttpOptions } from "../lib/fee-providers";
import { developmentFlutterwaveCredential } from "../lib/flutterwave-development-config";
import { requireSplitDevelopment, ngnMinor } from "../lib/flutterwave-split-policy";

export type BankDetails = { bankCode: string; accountNumber: string; accountName: string; contactPhone: string; entityName: string };
/** Dedicated TEST credential only; no legacy/generic credential fallback and no transfer methods. */
export class FlutterwaveSplitProvider extends FlutterwaveTestAdapter {
  constructor(secret: string, options: AdapterHttpOptions = {}) {
    requireSplitDevelopment();
    super({ secretKey: secret }, options);
  }
  private async api(path: string, body?: object) {
    requireSplitDevelopment();
    const r = await this.request(path, {
      method: body ? "POST" : "GET", headers: this.authHeaders(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, !body);
    if (r.status !== "success" || !r.data) throw new PaymentProviderError("Flutterwave TEST operation could not be confirmed");
    return r;
  }
  async resolveBank(bankCode: string, accountNumber: string) {
    const r = await this.api("accounts/resolve", { account_bank: bankCode, account_number: accountNumber });
    const d = r.data as Record<string, unknown>;
    if (d.account_number !== accountNumber || typeof d.account_name !== "string" || !d.account_name.trim()) {
      throw new PaymentProviderError("Bank account resolution did not match the requested account");
    }
    return { accountName: d.account_name.trim() };
  }
  async createRecipient(bank: BankDetails, kind: string) {
    // Default main-account commission is overridden by every bound checkout.
    const r = await this.api("subaccounts", {
      account_bank: bank.bankCode, account_number: bank.accountNumber, country: "NG",
      business_name: bank.entityName, business_mobile: bank.contactPhone,
      split_type: "flat", split_value: kind === "SCHOOL" ? 3000 : 4900,
    });
    const d = r.data as Record<string, unknown>;
    if (!Number.isSafeInteger(d.id) || Number(d.id) < 1) throw new PaymentProviderError("Subaccount creation response is incomplete");
    return this.verifyRecipient(Number(d.id), bank);
  }
  async verifyRecipient(id: number, bank: BankDetails) {
    const r = await this.api(`subaccounts/${id}`);
    const d = r.data as Record<string, unknown>;
    if (Number(d.id) !== id || d.account_number !== bank.accountNumber || String(d.account_bank) !== bank.bankCode
        || typeof d.subaccount_id !== "string" || !/^RS_[A-Za-z0-9]{12,80}$/.test(d.subaccount_id)) {
      throw new PaymentProviderError("Subaccount read-back did not match the owned bank account");
    }
    return { providerId: id, subaccountId: d.subaccount_id, bankName: typeof d.bank_name === "string" ? d.bank_name : bank.bankCode };
  }
  async recoverRecipient(bank: BankDetails) {
    // Bounded read only. Never repeat a possibly accepted creation POST.
    const r = await this.api("subaccounts");
    if (!Array.isArray(r.data)) throw new PaymentProviderError("Subaccount recovery list is unavailable");
    const candidates = r.data.filter((d: any) => d.account_number === bank.accountNumber
      && String(d.account_bank) === bank.bankCode && d.full_name === bank.entityName);
    if (candidates.length !== 1) throw new PaymentProviderError("Review the Flutterwave TEST dashboard: no unique owned subaccount was found");
    return this.verifyRecipient(Number(candidates[0].id), bank);
  }
  async transactionCosts(transactionId: string, reference: string) {
    const r = await this.api(`transactions/${encodeURIComponent(transactionId)}/verify`);
    const d = r.data as Record<string, unknown>;
    if (String(d.id) !== transactionId || d.tx_ref !== reference || d.currency !== "NGN" || ngnMinor(d.amount) !== 500000) {
      throw new PaymentProviderError("Split transaction evidence does not match the payment");
    }
    return {
      appFeeMinor: d.app_fee == null ? null : ngnMinor(d.app_fee),
      additionalFeeMinor: d.merchant_fee == null ? null : ngnMinor(d.merchant_fee),
    };
  }
  async settlementCandidates(subaccountId: string, from: string) {
    const r = await this.api(`settlements?subaccount_id=${encodeURIComponent(subaccountId)}&from=${from}&page=1`);
    if (!Array.isArray(r.data)) throw new PaymentProviderError("Subaccount settlement reporting is unavailable");
    const meta = r.meta as any;
    if (meta?.page_info?.total_pages > 1 || r.data.length >= 30) throw new PaymentProviderError("Settlement report requires dashboard pagination review");
    return r.data as Record<string, unknown>[];
  }
  async settlement(id: number) {
    const r = await this.api(`settlements/${id}?page=1`);
    const data = r.data as Record<string, any>;
    return { ...data,meta:r.meta ?? data.meta };
  }
  /** Safe capability read: no bank details, IDs or provider payloads are logged. */
  async inspectReadCapabilities() {
    const result: Record<string,string> = {};
    for (const [name,path] of [["subaccountListing","subaccounts"],["settlementListing","settlements?page=1"]]) {
      try {
        requireSplitDevelopment();
        const response = await this.fetchImpl(new URL(path,this.baseUrl),{
          method:"GET",headers:this.authHeaders(),redirect:"error",signal:AbortSignal.timeout(this.timeoutMs),
        });
        const payload = await response.json() as any;
        const message = typeof payload.message === "string" ? payload.message
          .replace(/FLW[A-Za-z0-9_-]+/g,"[REDACTED]")
          .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,"[REDACTED]")
          .replace(/\b\d{10,}\b/g,"[REDACTED]").slice(0,240) : "No diagnostic message";
        result[name] = response.ok && payload.status === "success" && Array.isArray(payload.data)
          ? `AVAILABLE (${payload.data.length} records on first page)`
          : `UNAVAILABLE (HTTP ${response.status}): ${message}`;
      } catch { result[name] = "UNAVAILABLE_OR_PERMISSION_DENIED"; }
    }
    return result;
  }
}
export function splitProvider() {
  requireSplitDevelopment();
  const credential = developmentFlutterwaveCredential();
  if (credential.state !== "CONFIGURED") {
    throw new PaymentProviderError("Dedicated Flutterwave TEST credentials are unavailable");
  }
  return new FlutterwaveSplitProvider(credential.secret!);
}
