import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import { requireSplitDevelopment } from "../lib/flutterwave-split-policy";
import { decryptSplitBank, encryptSplitBank, splitBankFingerprint } from "./flutterwave-split-crypto";
import { splitProvider, type BankDetails } from "./flutterwave-split-provider";

export function recipientView(row: any) {
  return {
    id: row.id, kind: row.kind, entityId: row.school_id ?? row.partner_profile_id,
    entityName: row.entity_name, status: row.status, maskedAccount: `••••${row.account_last4}`,
    accountName: decryptSplitBank(row.bank_ciphertext).accountName, bankName: row.bank_name,
    mode: "TEST" as const, providerSubaccountId: row.provider_subaccount_id ?? null,
    reviewNote: row.review_note ?? null, lastError: row.last_error ?? null,
  };
}
export async function submitSplitRecipient(
  actorId: number, scope: { kind: string; id: number; name: string },
  input: { bankCode: string; accountNumber: string; contactPhone: string },
) {
  requireSplitDevelopment();
  const resolved = await splitProvider().resolveBank(input.bankCode, input.accountNumber);
  const bank: BankDetails = { ...input, accountName: resolved.accountName, entityName: scope.name };
  try {
    const row = (await pool.query(
      `INSERT INTO flutterwave_split_recipients(kind,school_id,partner_profile_id,entity_name,
       bank_ciphertext,bank_fingerprint,account_last4,bank_name,submitted_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [scope.kind,scope.kind === "SCHOOL" ? scope.id : null,scope.kind === "PARTNER" ? scope.id : null,
        scope.name,encryptSplitBank(bank),splitBankFingerprint(input.bankCode,input.accountNumber),
        input.accountNumber.slice(-4),`Bank code ${input.bankCode}`,actorId],
    )).rows[0];
    return recipientView(row);
  } catch (error: any) {
    if (error.code === "23505") throw new AuthError(409, "This entity or bank already has an active recipient. Owner review is required before replacement.");
    throw error;
  }
}
export async function reviewSplitRecipient(
  id: number, actorId: number,
  input: { action: string; note: string; ownershipConfirmed?: boolean; distinctFromPlatformAccountConfirmed?: boolean },
) {
  requireSplitDevelopment();
  const db = await pool.connect();
  let row: any;
  try {
    await db.query("BEGIN");
    row = (await db.query("SELECT * FROM flutterwave_split_recipients WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) throw new AuthError(404, "Recipient not found");
    if (input.action === "SUSPEND" || input.action === "RETIRE") {
      if (row.status === "CREATING" || row.status === "CREATION_UNKNOWN") {
        throw new AuthError(409, "Recover the uncertain provider creation before suspending or retiring");
      }
      if (input.action === "RETIRE") {
        const unsettled = (await db.query(
          `SELECT 1 FROM flutterwave_split_payments WHERE (school_recipient_id=$1 OR partner_recipient_id=$1)
            AND status NOT IN ('COLLECTION_FAILED','TEST_PROVIDER_REPORTED_COMPLETE','REFUNDED') LIMIT 1`, [id],
        )).rows[0];
        if (unsettled) throw new AuthError(409, "Recipient has unresolved split history; suspend and reconcile instead");
      }
      row = (await db.query(
        "UPDATE flutterwave_split_recipients SET status=$1,reviewed_by=$2,review_note=$3,updated_at=NOW() WHERE id=$4 RETURNING *",
        [input.action === "SUSPEND" ? "SUSPENDED" : "RETIRED",actorId,input.note,id],
      )).rows[0];
      await db.query("COMMIT");
      return recipientView(row);
    }
    if (input.action === "APPROVE_AND_CREATE_TEST") {
      if (row.status !== "BANK_RESOLVED") throw new AuthError(409, "Creation is permitted once, from a resolved and reviewed bank account");
      if (!input.ownershipConfirmed || !input.distinctFromPlatformAccountConfirmed) {
        throw new AuthError(400, "Owner must confirm recipient ownership and that this is not Yetenia's bank account");
      }
      await db.query(
        "UPDATE flutterwave_split_recipients SET status='CREATING',reviewed_by=$1,review_note=$2,updated_at=NOW() WHERE id=$3",
        [actorId,input.note,id],
      );
    } else if (input.action === "RECOVER") {
      if (!["CREATING","CREATION_UNKNOWN","TEST_READY","SUSPENDED"].includes(row.status) || !row.reviewed_by) {
        throw new AuthError(409, "No reviewed provider creation is available for read-only recovery");
      }
      if (row.status === "CREATING" && Date.now() - new Date(row.updated_at).getTime() < 120000) {
        throw new AuthError(409, "Provider creation is still in progress; wait before recovery");
      }
    } else throw new AuthError(400, "Invalid recipient review");
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
  // Only after persisted intent/ownership review; ambiguous outcomes never cause a second POST.
  try {
    const provider = splitProvider(), bank = decryptSplitBank(row.bank_ciphertext);
    const result = input.action === "APPROVE_AND_CREATE_TEST" ? await provider.createRecipient(bank, row.kind)
      : row.provider_id ? await provider.verifyRecipient(row.provider_id, bank) : await provider.recoverRecipient(bank);
    const saved = (await pool.query(
      `UPDATE flutterwave_split_recipients SET status=CASE WHEN status='SUSPENDED' THEN status ELSE 'TEST_READY' END,provider_id=$1,provider_subaccount_id=$2,
       bank_name=$3,last_error=NULL,updated_at=NOW() WHERE id=$4 AND status<>'RETIRED' RETURNING *`,
      [result.providerId,result.subaccountId,result.bankName,id],
    )).rows[0];
    if (!saved) throw new AuthError(409, "Recipient changed during provider verification");
    return recipientView(saved);
  } catch {
    const failed = (await pool.query(
      `UPDATE flutterwave_split_recipients SET
       status=CASE WHEN status='CREATING' THEN 'CREATION_UNKNOWN' ELSE status END,
       last_error='Provider creation/read-back not confirmed. Inspect TEST dashboard permissions and use read-only recovery; do not repeat creation.',
       updated_at=NOW() WHERE id=$1 RETURNING *`, [id],
    )).rows[0];
    return recipientView(failed);
  }
}
