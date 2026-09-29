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
  if (area === 'categories') {
    // POST accepts categoryType, name, description; PATCH accepts name,
    // description, isActive. Never send edit-only fields in a create request.
    if (isNew) delete payload.isActive;
    else delete payload.categoryType;
  }
  return payload;
}