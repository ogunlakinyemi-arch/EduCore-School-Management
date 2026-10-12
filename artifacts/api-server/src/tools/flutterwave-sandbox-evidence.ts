/** Public projection only: never include credentials, checkout URLs, customers or card tokens. */
export const sandboxBank = {
  bankCode:"044",accountNumber:"0690000031",contactPhone:"090890382",
  entityName:"Yetenia EduCore TEST ONLY Split Verification",
};
export function safeMessage(value:unknown) {
  return typeof value === "string" ? value
    .replace(/FLW[A-Za-z0-9_-]+/g,"[CREDENTIAL OMITTED]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,"[EMAIL OMITTED]")
    .replace(/\b\d{9,20}\b/g,"[LONG NUMBER OMITTED]").slice(0,350) : null;
}
function splitFields(value:any):any {
  if (Array.isArray(value)) return value.map(splitFields);
  if (!value || typeof value !== "object") return null;
  const out:Record<string,unknown>={};
  for (const k of ["id","subaccount_id","transaction_charge_type","transaction_charge","transaction_split_ratio",
    "amount","currency","split_type","split_value","settlement_amount","commission","fee","status"]) {
    if (typeof value[k] === "number" || typeof value[k] === "boolean") out[k]=value[k];
    else if (typeof value[k] === "string" && /^(RS_[A-Za-z0-9]+|flat_subaccount|flat|percentage|NGN|successful|pending|failed|\d+(?:\.\d+)?)$/.test(value[k])) out[k]=value[k];
  }
  return out;
}
export function safeData(d:any):Record<string,unknown>|null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const out:Record<string,unknown>={};
  for (const k of ["id","amount","charged_amount","app_fee","merchant_fee","amount_settled","split_value","is_active","is_disabled"]) {
    if (typeof d[k] === "number" || typeof d[k] === "boolean") out[k]=d[k];
  }
  for (const k of ["status","currency","split_type","bank_name","created_at"]) {
    if (typeof d[k] === "string") out[k]=safeMessage(d[k]);
  }
  if (/^RS_[A-Za-z0-9]{12,80}$/.test(d.subaccount_id ?? "")) out.subaccount_id=d.subaccount_id;
  if (/^fw_split_probe_[a-f0-9]{32}$/.test(d.tx_ref ?? "")) out.tx_ref=d.tx_ref;
  if (d.account_bank !== undefined) out.account_bank=String(d.account_bank);
  if (d.account_number !== undefined) out.account_number=d.account_number === sandboxBank.accountNumber
    ? sandboxBank.accountNumber : "[UNEXPECTED ACCOUNT OMITTED]";
  if (d.business_name !== undefined) out.business_name=d.business_name === sandboxBank.entityName
    ? d.business_name : "[NON-FIXTURE NAME OMITTED]";
  if (d.full_name !== undefined) out.full_name=d.full_name === sandboxBank.entityName
    ? d.full_name : "[BANK-HOLDER NAME OMITTED]";
  for (const k of Object.keys(d).filter(k=>/subaccount|split/i.test(k) && !["subaccount_id","split_type","split_value"].includes(k))) {
    out[k]=splitFields(d[k]);
  }
  // Key names can show missing/available split evidence without exposing customer/card values.
  out.returnedKeys=Object.keys(d);
  return out;
}
export function safeEnvelope(payload:any) {
  return {
    status:payload?.status === "success" || payload?.status === "error" ? payload.status : null,
    message:safeMessage(payload?.message),
    data:Array.isArray(payload?.data) ? {
      shape:"array",count:payload.data.length,
      fixtureRecords:payload.data.filter((d:any)=>d.account_number === sandboxBank.accountNumber
        && String(d.account_bank) === sandboxBank.bankCode).map(safeData),
    } : safeData(payload?.data),
  };
}
