import { describe, expect, it } from 'vitest';
import { operationRecordPayload, staffNextStatuses, adminNextStatuses } from './operations-contract';

describe('operations category request contract', () => {
  it('omits edit-only isActive on POST even if a form supplies false', () => {
    expect(operationRecordPayload('categories', true, {
      categoryType: 'ASSET', name: 'ICT equipment', description: 'Computers', isActive: false,
    })).toEqual({ categoryType: 'ASSET', name: 'ICT equipment', description: 'Computers' });
  });

  it('keeps isActive and omits immutable categoryType on PATCH', () => {
    expect(operationRecordPayload('categories', false, {
      categoryType: 'ASSET', name: 'ICT equipment', description: '', isActive: false,
    })).toEqual({ name: 'ICT equipment', description: null, isActive: false });
  });

  it('offers only assigned-staff transitions supported by the server', () => {
    expect(staffNextStatuses.ASSIGNED).toEqual(['IN_PROGRESS']);
    expect(staffNextStatuses.IN_PROGRESS).toEqual(['ON_HOLD', 'COMPLETED']);
    expect(staffNextStatuses.ON_HOLD).toEqual(['IN_PROGRESS']);
    expect(staffNextStatuses.OPEN).toBeUndefined();
    expect(staffNextStatuses.COMPLETED).toBeUndefined();
    expect(adminNextStatuses.OPEN).toEqual(['ASSIGNED', 'CANCELLED']);
    expect(adminNextStatuses.CANCELLED).toEqual([]);
  });
});