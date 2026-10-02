export type AdmissionNumberClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, any>> }>;
};

/**
 * Generate a school-scoped admission number while the caller holds the school
 * row lock in its transaction. Existing supplied identifiers are never changed.
 */
export async function generateAdmissionNumber(
  client: AdmissionNumberClient,
  schoolId: number,
  reservedNumbers: readonly string[] = [],
): Promise<string> {
  const prefix = `ADM-${schoolId}-`;
  const result = await client.query(
    `SELECT COALESCE(MAX((substring(admission_no FROM $2))::bigint), 0)::bigint AS sequence
       FROM students
      WHERE school_id=$1 AND admission_no ~ $3`,
    [schoolId, `^ADM-${schoolId}-([0-9]+)$`, `^ADM-${schoolId}-[0-9]+$`],
  );
  let sequence = Number(result.rows[0]?.sequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Could not generate a safe admission number");
  const reserved = new Set(reservedNumbers.map((number) => number.trim().toLocaleLowerCase()));
  while (reserved.has(`${prefix}${String(sequence).padStart(6, "0")}`.toLocaleLowerCase())) sequence += 1;
  if (!Number.isSafeInteger(sequence)) throw new Error("Could not generate a safe admission number");
  return `${prefix}${String(sequence).padStart(6, "0")}`;
}