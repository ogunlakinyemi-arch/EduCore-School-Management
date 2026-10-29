import { createHash } from "node:crypto";
import { AuthError } from "../middlewares/auth";
import { encryptPayrollBankValue, decryptPayrollBankValue } from "../lib/payroll-bank-encryption";
import { requireVerifiedPaymentAccountProvider } from "../lib/payment-account-provider-validation";
import { FlutterwavePayrollV3Client } from "../lib/flutterwave-payroll-v3";
import { requireOwnerLookupLive } from "./owner-receiving-account-lookup";
import { validateBroSelection } from "./bro-bank-verification";

export const SCHOOL_FEE_BANK_POLICY = "SCHOOL_OFFICIAL_NAME_LIVE_V1";
const AAD = "school-fee-bank-lookup";
const TTL = 300_000;
type Sql = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };
type Selection = { bankName: string; bankCode: string; accountNumber: string };
type Identity = { id: number; name: string };
type Evidence = Selection & { accountName: string; actorId: number; schoolId: number;
  identity: string; revision: string; issuedAt: number; expiresAt: number; policy: string };

/** Exact ordered ASCII alphanumeric words; punctuation separators only, no aliases,
 * fuzzy matching, abbreviations, legal-suffix stripping or missing/extra words. */
export function normalizedSchoolBeneficiary(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9\s.,'-]+$/.test(value)) return null;
  const words = value.toUpperCase().replace(/[.,'-]/g, " ").trim().split(/\s+/);
  return words.length >= 2 && words.every(Boolean) ? words.join(" ") : null;
}
export function schoolBeneficiaryMatches(official: unknown, resolved: unknown) {
  const name = normalizedSchoolBeneficiary(official);
  return name !== null && name === normalizedSchoolBeneficiary(resolved);
}
export function schoolBankFingerprint(row: any): string {
  return createHash("sha256").update(JSON.stringify([
    row?.bankName ?? null, row?.accountName ?? null, row?.accountNumber ?? null,
  ])).digest("hex");
}
function revision(row: any) {
  return JSON.stringify([schoolBankFingerprint(row), row?.bankTransferEnabled ?? false, row?.bankRevision ?? null]);
}
export async function schoolFeeBankIdentity(c: Sql, schoolId: number, lock = false): Promise<Identity> {
  const school = (await c.query(`SELECT id,name FROM schools WHERE id=$1${lock ? " FOR SHARE" : ""}`, [schoolId])).rows[0];
  if (!school) throw new AuthError(404, "School not found");
  return school;
}
export async function schoolFeeBankRow(c: Sql, schoolId: number) {
  return (await c.query(`SELECT bank_name AS "bankName",bank_account_name AS "accountName",
    bank_account_number AS "accountNumber",bank_transfer_enabled AS "bankTransferEnabled",
    updated_at::text AS "bankRevision" FROM fee_school_settings WHERE school_id=$1`, [schoolId])).rows[0];
}
export async function lookupSchoolFeeBank(c: Sql, actorId: number, schoolId: number, raw: unknown,
  provider = new FlutterwavePayrollV3Client()) {
  requireOwnerLookupLive();
  const input = validateBroSelection(raw);
  const identity = await schoolFeeBankIdentity(c, schoolId);
  const row = await schoolFeeBankRow(c, schoolId);
  await requireVerifiedPaymentAccountProvider(input, provider);
  let resolved;
  try { resolved = await provider.resolveNigerianAccount(input, { requireOwnerLive: true }); }
  catch { throw new AuthError(503, "Account-name lookup was not confirmed. No school bank details were saved or verified."); }
  if (resolved.resolvedAccountNumber !== input.accountNumber ||
    !schoolBeneficiaryMatches(identity.name, resolved.resolvedAccountName))
    throw new AuthError(409, "The beneficiary must exactly match the school's registered official name. Nothing was saved.");
  const issuedAt = Date.now();
  const evidence: Evidence = { ...input, actorId, schoolId, identity: identity.name,
    accountName: resolved.resolvedAccountName, revision: revision(row),
    issuedAt, expiresAt: issuedAt + TTL, policy: SCHOOL_FEE_BANK_POLICY };
  return { accountName: evidence.accountName, accountLast4: input.accountNumber.slice(-4),
    lookupToken: JSON.stringify(encryptPayrollBankValue(JSON.stringify(evidence), AAD)),
    expiresAt: new Date(evidence.expiresAt).toISOString() };
}
export function acceptSchoolFeeBankProof(actorId: number, identity: Identity, row: any, input: any): Evidence {
  requireOwnerLookupLive();
  validateBroSelection(input);
  try {
    const sealed = JSON.parse(input.lookupToken);
    const p: Evidence = JSON.parse(decryptPayrollBankValue(sealed.ciphertext, sealed.keyVersion, AAD));
    if (p.policy !== SCHOOL_FEE_BANK_POLICY || p.actorId !== actorId || p.schoolId !== identity.id
      || p.identity !== identity.name || p.revision !== revision(row)
      || p.bankName !== input.bankName || p.bankCode !== input.bankCode || p.accountNumber !== input.accountNumber
      || p.accountName !== input.accountName || !schoolBeneficiaryMatches(identity.name, p.accountName)
      || !Number.isSafeInteger(p.issuedAt) || !Number.isSafeInteger(p.expiresAt)
      || p.issuedAt > Date.now() || p.expiresAt <= Date.now() || p.expiresAt - p.issuedAt !== TTL) throw Error();
    return p;
  } catch { throw new AuthError(409, "A fresh matching school account lookup is required. Identity, settings or evidence may have changed; nothing was saved."); }
}
export async function schoolFeeBankVerified(c: Sql, schoolId: number, row: any, knownIdentity?: Identity) {
  if (!row?.bankName || !row?.accountName || !/^[0-9]{10}$/.test(row?.accountNumber ?? "")) return false;
  const identity = knownIdentity ?? await schoolFeeBankIdentity(c, schoolId);
  if (!schoolBeneficiaryMatches(identity.name, row.accountName)) return false;
  const proof = await c.query(`SELECT id FROM audit_logs WHERE school_id=$1 AND record_id=$1
    AND module='Finance' AND action='finance settings: verified school bank'
    AND metadata->>'policy'=$2 AND metadata->>'identity'=$3 AND metadata->>'fingerprint'=$4
    ORDER BY id DESC LIMIT 1`, [schoolId, SCHOOL_FEE_BANK_POLICY, identity.name, schoolBankFingerprint(row)]);
  return !!proof.rows[0];
}
