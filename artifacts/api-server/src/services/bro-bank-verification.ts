import { createHash } from "node:crypto";
import { AuthError } from "../middlewares/auth";
import { pool } from "@workspace/db";
import { encryptPayrollBankValue, decryptPayrollBankValue } from "../lib/payroll-bank-encryption";
import { FlutterwavePayrollV3Client } from "../lib/flutterwave-payroll-v3";
import { requireVerifiedPaymentAccountProvider } from "../lib/payment-account-provider-validation";
import { requireOwnerLookupLive } from "./owner-receiving-account-lookup";

export const BRO_BANK_POLICY = "BRO_REGISTERED_IDENTITY_LIVE_V1";
const AAD = "bro-bank-lookup-evidence";
const TTL = 300_000;
type Sql = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };
type Selection = { bankName: string; bankCode: string; accountNumber: string };
type Identity = { id: number; full_name: string; user_id: number; status: string };
type Proof = Selection & { partnerId: number; actorId: number; identity: string;
  ownerId: number; accountName: string; revision: string; issuedAt: number; expiresAt: number; policy: string };

/** No fuzzy matching, title removal, suffix aliases, initial expansion, missing/reordered tokens
 * or transliteration. Only ASCII case, whitespace and . , - ' separators. */
export function normalizedBroName(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z\s.,'-]+$/.test(value)) return null;
  const words = value.toUpperCase().replace(/[.,'-]/g, " ").trim().split(/\s+/);
  return words.length >= 2 && words.every(w => w.length > 0) ? words.join(" ") : null;
}
export function broNameMatches(registered: unknown, resolved: unknown) {
  const name = normalizedBroName(registered);
  return name !== null && name === normalizedBroName(resolved);
}
export function validateBroSelection(input: unknown): Selection {
  const b = input as Record<string, unknown> | null;
  if (!b || typeof b.bankName !== "string" || !b.bankName.trim() || b.bankName.length > 200
    || typeof b.bankCode !== "string" || !/^[0-9]{1,20}$/.test(b.bankCode)
    || typeof b.accountNumber !== "string" || !/^[0-9]{10}$/.test(b.accountNumber)) {
    throw new AuthError(400, "Select a supported bank and enter a valid 10-digit account number.");
  }
  return { bankName: b.bankName, bankCode: b.bankCode, accountNumber: b.accountNumber };
}
export function bankFingerprint(row: any): string {
  return createHash("sha256").update(JSON.stringify(row ? [
    row.bank_name_encrypted, row.bank_code_encrypted, row.account_name_encrypted,
    row.account_number_encrypted, row.encryption_key_version, row.status,
  ] : null)).digest("hex");
}
export async function broBankRow(c: Sql, partnerId: number) {
  return (await c.query("SELECT * FROM partner_payout_information WHERE partner_profile_id=$1", [partnerId])).rows[0];
}
export async function lookupBroBank(actorId: number, identity: Identity, input: Selection,
  c: Sql = pool, client = new FlutterwavePayrollV3Client()) {
  requireOwnerLookupLive();
  if (identity.status !== "ACTIVE" || !normalizedBroName(identity.full_name))
    throw new AuthError(409, "The registered BRO identity cannot be verified.");
  const revision = bankFingerprint(await broBankRow(c, identity.id));
  await requireVerifiedPaymentAccountProvider(input, client);
  let resolved;
  try {
    resolved = await client.resolveNigerianAccount(input, { requireOwnerLive: true });
  } catch {
    throw new AuthError(503, "Account-name lookup was not confirmed by the provider. Nothing was saved or verified.");
  }
  if (resolved.resolvedAccountNumber !== input.accountNumber ||
    !broNameMatches(identity.full_name, resolved.resolvedAccountName))
    throw new AuthError(409, "The beneficiary must exactly match your registered BRO full name. Nothing was saved.");
  const issuedAt = Date.now();
  const evidence: Proof = { ...input, partnerId: identity.id, actorId, ownerId: identity.user_id,
    identity: identity.full_name, accountName: resolved.resolvedAccountName, revision,
    issuedAt, expiresAt: issuedAt + TTL, policy: BRO_BANK_POLICY };
  return { accountName: evidence.accountName, accountLast4: input.accountNumber.slice(-4),
    lookupToken: JSON.stringify(encryptPayrollBankValue(JSON.stringify(evidence), AAD)),
    expiresAt: new Date(evidence.expiresAt).toISOString() };
}
export function acceptBroBankProof(actorId: number, identity: Identity, row: any, input: any): Proof {
  requireOwnerLookupLive();
  validateBroSelection(input);
  try {
    const sealed = JSON.parse(input.lookupToken);
    const p: Proof = JSON.parse(decryptPayrollBankValue(sealed.ciphertext, sealed.keyVersion, AAD));
    if (p.policy !== BRO_BANK_POLICY || p.actorId !== actorId || p.partnerId !== identity.id
      || p.ownerId !== identity.user_id || p.identity !== identity.full_name || identity.status !== "ACTIVE"
      || p.revision !== bankFingerprint(row) || !Number.isSafeInteger(p.issuedAt) || !Number.isSafeInteger(p.expiresAt)
      || p.issuedAt > Date.now() || p.expiresAt <= Date.now() || p.expiresAt - p.issuedAt !== TTL
      || p.bankName !== input.bankName || p.bankCode !== input.bankCode || p.accountNumber !== input.accountNumber
      || p.accountName !== input.accountName || !broNameMatches(identity.full_name, p.accountName)) throw Error();
    return p;
  } catch {
    throw new AuthError(409, "A fresh identity-matched LIVE lookup is required. Details or identity may have changed; nothing was saved.");
  }
}
export async function verifiedBroBank(c: Sql, identity: Identity,
  decrypt: (value: string, version: string) => string) {
  const row = await broBankRow(c, identity.id);
  if (!row || row.status !== "ACTIVE" || row.method !== "BANK_TRANSFER") return null;
  const proof = (await c.query(`SELECT id FROM audit_logs
    WHERE module='Partner Payout Information' AND record_id=$1
      AND action='Verified BRO bank account' AND metadata->>'policy'=$2
      AND metadata->>'fingerprint'=$3 AND metadata->>'identity'=$4
      AND metadata->>'ownerId'=$5
    LIMIT 1`, [row.id, BRO_BANK_POLICY, bankFingerprint(row), identity.full_name, String(identity.user_id)])).rows[0];
  if (!proof) return null;
  const version = row.encryption_key_version;
  const accountName = decrypt(row.account_name_encrypted, version);
  const accountNumber = decrypt(row.account_number_encrypted, version);
  if (!broNameMatches(identity.full_name, accountName) || !/^[0-9]{10}$/.test(accountNumber)) return null;
  return { id: row.id, partnerId: identity.id, payoutMethod: "BANK_TRANSFER" as const,
    bankName: decrypt(row.bank_name_encrypted, version), bankCode: decrypt(row.bank_code_encrypted, version),
    accountName, accountNumber, maskedAccountNumber: `****${accountNumber.slice(-4)}`,
    verified: true, updatedAt: new Date(row.updated_at).toISOString() };
}
export function maskedBroBank(bank: Awaited<ReturnType<typeof verifiedBroBank>>) {
  if (!bank) return null;
  const { accountNumber: _number, ...masked } = bank;
  return masked;
}
export function sealBroPayoutBank(bank: object) {
  return encryptPayrollBankValue(JSON.stringify(bank), "bro-payout-bank-snapshot");
}
export function openBroPayoutBank(sealed: { ciphertext: string; keyVersion: string }) {
  return JSON.parse(decryptPayrollBankValue(sealed.ciphertext, sealed.keyVersion, "bro-payout-bank-snapshot"));
}
