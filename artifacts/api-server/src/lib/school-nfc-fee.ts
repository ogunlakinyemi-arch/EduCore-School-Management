import { AuthError } from "../middlewares/auth";

export const SCHOOL_NFC_FEE_NAME = "School NFC Subscription Fee";
export const isBuiltInSchoolNfcFee = (name: string) => name.trim().toLowerCase() === SCHOOL_NFC_FEE_NAME.toLowerCase();
type Line = { categoryId?: number; builtInCategory?: "SCHOOL_NFC"; amountMinor: number; description?: string };
type Sql = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };

/** Called only inside the explicit draft-save transaction. No GET-time provisioning. */
export async function resolveSchoolNfcFeeLines(db: Sql, schoolId: number, actorId: number, lines: Line[]) {
  for (const l of lines) {
    if ((l.categoryId !== undefined) === (l.builtInCategory !== undefined))
      throw new AuthError(400, "Choose one fee category per charge line");
    if (!Number.isSafeInteger(l.amountMinor) || l.amountMinor <= 0 || l.amountMinor > 2147483647)
      throw new AuthError(400, "A school charge amount is required and must be greater than zero");
  }
  const keys = lines.map(l => l.builtInCategory ?? l.categoryId);
  if (new Set(keys).size !== keys.length) throw new AuthError(400, "Do not duplicate a category in one fee schedule");
  let categoryId: number | undefined;
  if (lines.some(l => l.builtInCategory === "SCHOOL_NFC")) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`school-nfc-category:${schoolId}`]);
    let row = (await db.query(`SELECT id,status FROM fee_categories
      WHERE school_id=$1 AND lower(btrim(name))=lower($2) ORDER BY id LIMIT 1`, [schoolId, SCHOOL_NFC_FEE_NAME])).rows[0];
    if (!row) row = (await db.query(`INSERT INTO fee_categories(school_id,name,description,compulsory,created_by,transport_only)
      VALUES($1,$2,$3,true,$4,false) RETURNING id,status`,
    [schoolId, SCHOOL_NFC_FEE_NAME, "School-defined parent-facing charge, collected by the school. Not a Yetenia platform subscription.", actorId])).rows[0];
    if (row?.status !== "ACTIVE") throw new AuthError(409, "The saved school NFC category is inactive; review it before saving a new charge");
    categoryId = Number(row.id);
  }
  const resolved = lines.map(l => l.builtInCategory === "SCHOOL_NFC"
    ? { categoryId: categoryId!, amountMinor: l.amountMinor, description: SCHOOL_NFC_FEE_NAME }
    : { categoryId: l.categoryId!, amountMinor: l.amountMinor, description: l.description });
  if (new Set(resolved.map(l => l.categoryId)).size !== resolved.length)
    throw new AuthError(400, "Do not duplicate a category in one fee schedule");
  return resolved;
}

/** Publishing a school NFC schedule never issues invoices or verifies platform access. */
export async function schoolNfcPublicationAssignments<T>(
  lines: { categoryName: string; amountMinor: number }[], assignOrdinaryFees: () => Promise<T>,
) {
  const schoolLines = lines.filter(l => isBuiltInSchoolNfcFee(l.categoryName));
  if (!schoolLines.length) return assignOrdinaryFees();
  if (schoolLines.some(l => !Number.isSafeInteger(l.amountMinor) || l.amountMinor <= 0))
    throw new AuthError(400, "The school NFC amount is required and must be greater than zero before publishing");
  return { assignedCount: 0 };
}
