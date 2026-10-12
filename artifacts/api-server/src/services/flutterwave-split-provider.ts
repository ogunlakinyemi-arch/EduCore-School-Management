import { FlutterwaveTestAdapter, PaymentProviderError, type AdapterHttpOptions } from "../lib/fee-providers";
import { developmentFlutterwaveCredential } from "../lib/flutterwave-development-config";
import { requireSplitDevelopment, ngnMinor } from "../lib/flutterwave-split-policy";

export type BankDetails = { bankCode: string; accountNumber: string; accountName: string; contactPhone: string; entityName: string; businessEmail?: string };
export type SplitReadEvidence = {
  request:{method:"GET";url:string;authorization:"Bearer [REDACTED TEST credential]";body:null};
  httpStatus:number|null;
  response:{status:string|null;message:string;dataShape:string;recordCount:number|null};
  interpretation:"NO_RECORDS_REPORTED"|"EMPTY_LIST_REPORTED"|"LIST_READ_CONFIRMED"|"UNVERIFIED_ERROR";
  creationPermission:"NOT_TESTED";
};
const safeDiagnosticMessages = new Set([
  "Subaccounts not found","Subaccounts fetched","Settlements fetched","No settlements found",
  "Invalid authorization","Unauthorized","Forbidden","Invalid secret key","Permission denied","Access denied",
]);
function readEvidence(url:string,httpStatus:number,payload:any): SplitReadEvidence {
  const status = ["success","error"].includes(payload?.status) ? payload.status : null;
  const message = typeof payload?.message === "string" && safeDiagnosticMessages.has(payload.message)
    ? payload.message : "[Non-allowlisted provider message omitted]";
  const dataShape = payload?.data === null ? "null" : Array.isArray(payload?.data) ? "array" : "other";
  const recordCount = Array.isArray(payload?.data) ? payload.data.length : null;
  return {
    request:{method:"GET",url,authorization:"Bearer [REDACTED TEST credential]",body:null},
    httpStatus,response:{status,message,dataShape,recordCount},
    interpretation:httpStatus === 400 && status === "error" && message === "Subaccounts not found" && dataShape === "null"
      ? "NO_RECORDS_REPORTED" : httpStatus === 200 && status === "success" && recordCount !== null
        ? recordCount === 0 ? "EMPTY_LIST_REPORTED" : "LIST_READ_CONFIRMED" : "UNVERIFIED_ERROR",
    creationPermission:"NOT_TESTED",
  };
}
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
      ...(bank.businessEmail ? { business_email: bank.businessEmail } : {}),
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
    const meta = r.meta as any;
    if (meta?.page_info?.total_pages > 1) throw new PaymentProviderError("Subaccount recovery requires dashboard pagination review");
    const candidates = r.data.filter((d: any) => d.account_number === bank.accountNumber
      && String(d.account_bank) === bank.bankCode && (d.business_name ?? d.full_name) === bank.entityName);
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
  async settlement(id: number): Promise<Record<string,any>> {
    const r = await this.api(`settlements/${id}?page=1`);
    const data = r.data as Record<string, any>;
    return { ...data,meta:r.meta ?? data.meta };
  }
  /** Safe capability read: no bank details, IDs or provider payloads are logged. */
  async inspectReadCapabilities() {
    const result: Record<string,string> = {};
    const evidence = await this.inspectReadEvidence();
    for (const [name,row] of Object.entries(evidence)) {
      result[name] = `${row.interpretation} (HTTP ${row.httpStatus ?? "unknown"}): ${row.response.message}`;
    }
    return result;
  }
  /** Fixed GET allowlist only; no bank filters, IDs, POSTs or permission claims. */
  async inspectReadEvidence(): Promise<Record<string,SplitReadEvidence>> {
    requireSplitDevelopment();
    const result: Record<string,SplitReadEvidence> = {};
    for (const [name,path] of [["subaccountListing","subaccounts"],["subaccountListingPageOne","subaccounts?page=1"],["settlementListing","settlements?page=1"]]) {
      const url = new URL(path,this.baseUrl).href;
      try {
        requireSplitDevelopment();
        const response = await this.fetchImpl(url,{
          method:"GET",headers:{...this.authHeaders(),Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(this.timeoutMs),
        });
        result[name] = readEvidence(url,response.status,await response.json());
      } catch {
        result[name] = {
          request:{method:"GET",url,authorization:"Bearer [REDACTED TEST credential]",body:null},
          httpStatus:null,response:{status:null,message:"Transport or response parsing failed; details omitted",dataShape:"unknown",recordCount:null},
          interpretation:"UNVERIFIED_ERROR",creationPermission:"NOT_TESTED",
        };
      }
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
