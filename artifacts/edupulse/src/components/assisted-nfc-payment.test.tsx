import { describe, expect, it, vi } from 'vitest';
vi.mock('@clerk/react', () => ({ useAuth: () => ({ userId: 'development-fixture' }) }));
import { canCreateAssistedNfcPayment, assistedOptionsKey } from './assisted-nfc-payment';

describe('assisted NFC authorization and cache boundaries', () => {
  const roles = [{ role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 1 }];
  it('allows only an active School Admin of the selected school', () => {
    expect(canCreateAssistedNfcPayment({ roles }, 1)).toBe(true);
    expect(canCreateAssistedNfcPayment({ roles }, 2)).toBe(false);
    expect(canCreateAssistedNfcPayment({ roles: [{ ...roles[0], status: 'INACTIVE' }] }, 1)).toBe(false);
  });
  it('denies an Owner even with an Admin role and denies family/accountant roles', () => {
    expect(canCreateAssistedNfcPayment({ isPlatformOwner: true, roles }, 1)).toBe(false);
    for (const role of ['PARENT', 'STUDENT', 'ACCOUNTANT', 'TEACHER'])
      expect(canCreateAssistedNfcPayment({ roles: [{ ...roles[0], role }] }, 1)).toBe(false);
  });
  it('does not share guardian options between signed-in identities or schools', () => {
    expect(assistedOptionsKey('first', 1)).not.toEqual(assistedOptionsKey('second', 1));
    expect(assistedOptionsKey('first', 1)).not.toEqual(assistedOptionsKey('first', 2));
  });
});
