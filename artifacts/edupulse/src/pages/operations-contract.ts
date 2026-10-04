import { toPayload } from '@/hooks/use-phase9-api';

// Mirrors the assigned-staff-only transition table in operations.ts.
export const staffNextStatuses: Record<string, string[]> = {
  ASSIGNED: ['IN_PROGRESS'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED'],
  ON_HOLD: ['IN_PROGRESS'],
};
export const adminNextStatuses: Record<string, string[]> = {
  OPEN: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['OPEN', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['ASSIGNED', 'ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['ASSIGNED', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: [],
};

export function operationRecordPayload(
  area: 'assets' | 'maintenance' | 'facilities' | 'tasks' | 'categories',
  isNew: boolean,
  values: Record<string, string | number | boolean | null>,
): Record<string, unknown> {
  const payload = toPayload(values, ['quantity', 'capacity', 'assignedToUserId', 'assetId', 'categoryId'], !isNew);
  delete payload.staffType;
  if (area === 'categories') {
    // POST accepts categoryType, name, description; PATCH accepts name,
    // description, isActive. Never send edit-only fields in a create request.
    if (isNew) delete payload.isActive;
    else delete payload.categoryType;
  }
  return payload;
}
export const STANDARD_ASSET_CATEGORIES = [
  'Furniture', 'Classroom Equipment', 'ICT & Computers', 'Printers & Scanners', 'Networking Equipment', 'Laboratory Equipment',
  'Library Equipment', 'Sports Equipment', 'Musical Equipment', 'Audio/Visual Equipment', 'Security Equipment', 'CCTV & Surveillance',
  'Access Control & NFC Devices', 'School Transport/Vehicles', 'Kitchen & Catering Equipment', 'Electrical Equipment',
  'Generator & Power Equipment', 'Air Conditioning & Ventilation', 'Cleaning Equipment', 'Office Equipment',
  'Medical/First Aid Equipment', 'Playground Equipment', 'Building & Facility Equipment', 'Teaching Aids',
  'School Uniforms & Protective Equipment', 'Other',
];

/** Standard names not yet present (case-insensitive); existing categories are never touched. */
export function missingStandardCategories(existing: Array<{ name: string; categoryType: string }> | undefined) {
  const have = new Set((existing ?? []).filter(c => c.categoryType === 'ASSET').map(c => c.name.trim().toLowerCase()));
  return STANDARD_ASSET_CATEGORIES.filter(n => !have.has(n.toLowerCase()));
}

type StaffLike = { userId?: number | null; firstName: string; lastName: string; type: string; status: string };
/** Active employees that already have a login account, optionally narrowed by staff type. */
export function assigneeOptions(staff: StaffLike[] | undefined, staffType: string) {
  return (staff ?? [])
    .filter(e => e.status === 'ACTIVE' && !!e.userId && (!staffType || e.type === staffType))
    .map(e => ({ value: String(e.userId), label: `${e.firstName} ${e.lastName} (${e.type.toLowerCase()})` }));
}
