import { describe, expect, it } from 'vitest';
import { checkEmergency, checkPickupCompletion, dayRange, EMERGENCY_CONFIRMATION, isForbidden, securityAccess } from './security-contract';

const win = { status: 'APPROVED' as const, validFrom: '2025-01-01T08:00:00Z', validUntil: '2025-01-01T10:00:00Z' };
describe('security contract', () => {
  it('owner is read-only', () => {
    const a = securityAccess('OWNER');
    expect([a.mutate, a.incidents, a.grants]).toEqual([false, false, false]);
    expect(securityAccess('STAFF').delegated).toBe(true);
    expect(securityAccess('STAFF').grants).toBe(false);
  });
  it('pickup completion requires window and event id', () => {
    expect(checkPickupCompletion(win, '12', new Date('2025-01-01T09:00:00Z'))).toEqual({ ok: true, eventId: 12 });
    expect(checkPickupCompletion(win, '12', new Date('2025-01-01T11:00:00Z')).ok).toBe(false);
    expect(checkPickupCompletion(win, 'abc', new Date('2025-01-01T09:00:00Z')).ok).toBe(false);
    expect(checkPickupCompletion({ ...win, status: 'PENDING' }, '1', new Date('2025-01-01T09:00:00Z')).ok).toBe(false);
  });
  it('emergency needs in-app, fresh preview, exact text', () => {
    const base = { confirmation: EMERGENCY_CONFIRMATION, previewCount: 5, previewFresh: true, channels: ['IN_APP'] };
    expect(checkEmergency(base).ok).toBe(true);
    expect(checkEmergency({ ...base, channels: ['SMS'] }).ok).toBe(false);
    expect(checkEmergency({ ...base, previewFresh: false }).ok).toBe(false);
    expect(checkEmergency({ ...base, confirmation: 'i confirm' }).ok).toBe(false);
  });
  it('helpers', () => {
    expect(isForbidden({ status: 403 })).toBe(true);
    expect(dayRange('', '')).toEqual({});
    expect(dayRange('2025-01-01', '').from).toBeTruthy();
  });
});

import { liveAccess, exitEventsForStudent } from './security-contract';
describe('live access', () => {
  const base = { actorRole: 'STAFF' as const, canView: true, readOnly: false };
  it('hides everything without view and mutation tabs when read-only', () => {
    expect(liveAccess({ ...base, canView: false, permissions: ['SECURITY_MANAGE'] }).view).toBe(false);
    const ro = liveAccess({ ...base, actorRole: 'PLATFORM_OWNER', readOnly: true, permissions: ['SECURITY_READ', 'SECURITY_MANAGE'] });
    expect(ro.view).toBe(true); expect(ro.readers || ro.visitors || ro.incidents || ro.settings || ro.grants).toBe(false);
  });
  it('maps exact privileges to tabs', () => {
    const a = liveAccess({ ...base, permissions: ['VISITOR_MANAGE'] });
    expect(a.read).toBe(false); expect(liveAccess({ ...base, permissions: ['SECURITY_MANAGE'] }).visitors).toBe(false); expect(liveAccess({ ...base, permissions: ['SECURITY_MANAGE'] }).pickup).toBe(false);
    expect(a.visitors).toBe(true); expect(a.readers).toBe(false); expect(a.incidents).toBe(false); expect(a.grants).toBe(false);
    expect(liveAccess({ ...base, actorRole: 'SCHOOL_ADMIN', permissions: ['SECURITY_MANAGE'] }).grants).toBe(true);
  });
  it('selects only confirmed exits of the student', () => {
    const ev = [{ id: 1, eventType: 'EXIT', identityResult: 'CONFIRMED', studentId: 5 }, { id: 2, eventType: 'ENTRY', identityResult: 'CONFIRMED', studentId: 5 }, { id: 3, eventType: 'EXIT', identityResult: 'CONFIRMED', studentId: 6 }, { id: 4, eventType: 'EXIT', identityResult: 'REJECTED', studentId: 5 }];
    expect(exitEventsForStudent(ev, 5).map(e => e.id)).toEqual([1]);
  });
});
