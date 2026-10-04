import { describe, expect, it } from 'vitest';
import { assigneeOptions, missingStandardCategories, operationRecordPayload, STANDARD_ASSET_CATEGORIES } from './operations-contract';
describe('operations staff and categories', () => {
  const staff = [
    { userId: 5, firstName: 'Ada', lastName: 'Obi', type: 'TEACHER', status: 'ACTIVE' },
    { userId: null, firstName: 'No', lastName: 'Login', type: 'TEACHER', status: 'ACTIVE' },
    { userId: 7, firstName: 'Ben', lastName: 'Eze', type: 'CLEANER', status: 'ACTIVE' },
    { userId: 8, firstName: 'Old', lastName: 'Hand', type: 'CLEANER', status: 'INACTIVE' },
  ];
  it('filters staff members by type and requires an account', () => {
    expect(assigneeOptions(staff, 'TEACHER').map(o => o.value)).toEqual(['5']);
    expect(assigneeOptions(staff, '').map(o => o.value)).toEqual(['5', '7']);
  });
  it('only adds missing standard categories and keeps custom ones', () => {
    const m = missingStandardCategories([{ name: 'furniture', categoryType: 'ASSET' }, { name: 'Our Custom', categoryType: 'ASSET' }]);
    expect(m).not.toContain('Furniture');
    expect(m).toHaveLength(STANDARD_ASSET_CATEGORIES.length - 1);
  });
  it('does not send the helper staffType field', () => {
    expect(operationRecordPayload('tasks', true, { title: 'x', staffType: 'TEACHER', assignedToUserId: '5' })).not.toHaveProperty('staffType');
  });
});
