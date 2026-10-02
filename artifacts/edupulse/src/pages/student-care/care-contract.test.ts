import { describe, expect, it } from 'vitest';
import {
  idempotencyHeaders, versionHeaders, newIdempotencyKey, sanitizeParentSummary, welfarePayload, emptyWelfare,
  medicalPayload, emptyMedical, validateVisit, emptyVisit, behaviourProgressPayload, grantPayload, errorInfo,
} from './care-contract';

describe('student care contract', () => {
  it('builds required headers', () => {
    expect(idempotencyHeaders('abc12345')).toEqual({ 'Idempotency-Key': 'abc12345' });
    expect(versionHeaders(4)).toEqual({ 'If-Match-Version': '4' });
    expect(newIdempotencyKey()).not.toEqual(newIdempotencyKey());
    expect(newIdempotencyKey().length).toBeGreaterThanOrEqual(8);
  });
  it('never exposes internal notes to families', () => {
    const out = sanitizeParentSummary({ studentId: 3, welfare: [{ id: 1, category: 'X', concern: 'c', status: 's', updatedAt: 'u', internalNotes: 'secret', resolution: 'r' }], behaviour: [{ id: 2, category: 'C', description: 'd', status: 's', occurredAt: 'o', internalNotes: 'secret', action: 'a' }] });
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(Object.keys(out.welfare[0])).toEqual(['id', 'category', 'concern', 'status', 'updatedAt']);
  });
  it('forces safeguarding to stay hidden from parents', () => {
    expect(welfarePayload({ ...emptyWelfare(), category: 'SAFEGUARDING', concern: 'x', parentVisible: true }).parentVisible).toBe(false);
  });
  it('sends expected version and trimmed lists for medical', () => {
    const p = medicalPayload({ ...emptyMedical(), allergies: 'Peanuts\n\n Dust ' }, 2);
    expect(p.expectedVersion).toBe(2);
    expect(p.allergies).toEqual(['Peanuts', 'Dust']);
  });
  it('validates visits', () => {
    expect(validateVisit({ ...emptyVisit(), reason: '' }).reason).toBeTruthy();
  });
  it('requests parent notification only through status patch', () => {
    const p = behaviourProgressPayload({ category: 'INCIDENT', severity: 'HIGH', description: 'd', occurredAt: '2025-01-01T10:00:00Z' }, 'PARENT_NOTIFICATION', 5, true);
    expect(p.expectedVersion).toBe(5);
    expect(p.parentNotificationRequested).toBe(true);
  });
  it('limits grants to known permissions', () => {
    expect(grantPayload(9, true, ['MEDICAL_READ', 'OWNER_ALL']).permissions).toEqual(['MEDICAL_READ']);
  });
  it('classifies conflicts and denials', () => {
    expect(errorInfo({ status: 409 }).conflict).toBe(true);
    expect(errorInfo({ status: 403 }).denied).toBe(true);
  });
});
