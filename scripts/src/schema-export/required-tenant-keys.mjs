// Match CURRENT source ownership strictly; preserve historical ownership metadata
// for review. This check neither converts keys nor certifies target migrations.
export const requiredTenantKeys = [
  { table: "public.subscriptions", name: "subscriptions_id_school_student_uq",
    kind: "unique_constraint", historicalKind: "unique_index", columns: ["id", "school_id", "student_id"] },
  { table: "public.school_partner_attributions", name: "school_partner_attributions_id_partner_uq",
    kind: "unique_constraint", historicalKind: "unique_index", columns: ["id", "partner_profile_id"] },
  { table: "public.parents", name: "parents_id_school_unique",
    kind: "unique_constraint", historicalKind: "unique_index", columns: ["id", "school_id"] },
  { table: "public.academic_terms", name: "academic_terms_nfc_session_key",
    kind: "unique_constraint", columns: ["id", "school_id", "academic_session_id"] },
];
export function verifyRequiredTenantKeys(model) {
  for (const required of requiredTenantKeys) {
    const table = model.tables.find(t => t.id === required.table);
    const key = table?.keys.find(k => k.name === required.name);
    if (!key || key.kind !== required.kind ||
        JSON.stringify([...key.columns].sort()) !== JSON.stringify([...required.columns].sort())) {
      throw new Error(`Missing or changed required source uniqueness: ${required.table}.${required.name}`);
    }
  }
  return requiredTenantKeys;
}
