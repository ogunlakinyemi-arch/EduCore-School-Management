import { AuthError } from "../middlewares/auth";
import { decryptPayrollBankValue, encryptPayrollBankValue } from "../lib/payroll-bank-encryption";
import { liveOwnerResolutionConfigured, officialOwnerAccountName, OWNER_RECEIVING_ACCOUNT_POLICY } from "../lib/owner-receiving-account-policy";
import { FlutterwavePayrollV3Client } from "../lib/flutterwave-payroll-v3";
import { requireVerifiedPaymentAccountProvider } from "../lib/payment-account-provider-validation";

const AAD = "owner-receiving-account:lookup-evidence";
const TTL_MS = 5 * 60_000;
type Selection = { bankName: string; bankCode: string; accountNumber: string };
type Evidence = Selection & { actorId: number; accountName: string; issuedAt: number; expiresAt: number; policy: string };

export function requireOwnerLookupLive() {
  if (!liveOwnerResolutionConfigured()) throw new AuthError(409,
    "LIVE account-name lookup is unavailable in this environment. Development or sandbox results cannot verify the receiving account. Details were not saved.",
    "OWNER_ACCOUNT_LIVE_REQUIRED");
}

/** Read-only provider lookup: no profile write, transfer, checkout or settlement. */
export async function lookupOwnerReceivingAccount(actorId: number, input: Selection,
  client = new FlutterwavePayrollV3Client()) {
  requireOwnerLookupLive();
  await requireVerifiedPaymentAccountProvider(input, client);
  const result = await client.resolveNigerianAccount(
    { bankCode: input.bankCode, accountNumber: input.accountNumber }, { requireOwnerLive: true });
  if (result.resolvedAccountNumber !== input.accountNumber || !officialOwnerAccountName(result.resolvedAccountName)) {
    throw new AuthError(409,
      "The bank account number or returned beneficiary does not match the official YETENIA TECHNOLOGIES LIMITED account. Check the selected bank and number. Details remain unverified.",
      "OWNER_ACCOUNT_NAME_MISMATCH");
  }
  const issuedAt = Date.now();
  const evidence: Evidence = { ...input, actorId, accountName: result.resolvedAccountName,
    issuedAt, expiresAt: issuedAt + TTL_MS, policy: OWNER_RECEIVING_ACCOUNT_POLICY };
  // AEAD encrypted, actor-bound proof; no full number in browser-visible response fields.
  const lookupToken = JSON.stringify(encryptPayrollBankValue(JSON.stringify(evidence), AAD));
  return { accountName: result.resolvedAccountName, accountNumberMatched: true as const,
    accountLast4: input.accountNumber.slice(-4), lookupToken, expiresAt: new Date(evidence.expiresAt).toISOString() };
}

/** Save cannot manufacture proof or trigger resolution. Bind every relevant field,
 * actor, LIVE runtime and expiration to the earlier successful provider lookup. */
export function acceptOwnerLookupEvidence(actorId: number, input: Selection & {
  accountName: string; businessName: string; lookupToken: string;
}): Evidence {
  requireOwnerLookupLive();
  try {
    const sealed = JSON.parse(input.lookupToken);
    const evidence: Evidence = JSON.parse(decryptPayrollBankValue(sealed.ciphertext, sealed.keyVersion, AAD));
    const now = Date.now();
    if (evidence.actorId !== actorId || evidence.policy !== OWNER_RECEIVING_ACCOUNT_POLICY
      || !Number.isSafeInteger(evidence.issuedAt) || !Number.isSafeInteger(evidence.expiresAt)
      || evidence.issuedAt > now || evidence.expiresAt <= now
      || evidence.expiresAt - evidence.issuedAt !== TTL_MS
      || evidence.bankName !== input.bankName || evidence.bankCode !== input.bankCode
      || evidence.accountNumber !== input.accountNumber || evidence.accountName !== input.accountName
      || !officialOwnerAccountName(evidence.accountName) || !officialOwnerAccountName(input.businessName)) throw Error();
    return evidence;
  } catch {
    throw new AuthError(409, "A fresh matching account-name lookup is required before saving. Re-enter the bank and account number; no details were saved.",
      "OWNER_ACCOUNT_LOOKUP_REQUIRED");
  }
}
