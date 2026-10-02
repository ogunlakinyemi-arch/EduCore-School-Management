import { describe, expect, it } from 'vitest';
import {
  normalizePhone, resolveRequestKey, validateForm, emptyForm, buildPayload, canConvert, receiptText, TRANSITION_VALUES, STATUS_VALUES,
  liveKeyRequest, portalUrlFor, type KeyHolder,
} from './admissions-lib';

const valid = { ...emptyForm, firstName: 'Ada', lastName: 'Eze', dateOfBirth: '2016-03-01', gender: 'Female' as const, intendedClassId: '4',
  guardianName: 'Ngozi Eze', guardianPhone: '08031234567', emergencyName: 'Obi', emergencyPhone: '+2348021234567' };

describe('public application fields', () => {
  it('normalises phones and requires all contact fields without email', () => {
    expect(normalizePhone('08031234567')).toBe('+2348031234567');
    expect(normalizePhone('123')).toBeNull();
    expect(validateForm(valid)).toEqual({});
    const errs = validateForm(emptyForm);
    expect(Object.keys(errs)).toEqual(expect.arrayContaining(['firstName', 'dateOfBirth', 'gender', 'intendedClassId', 'guardianPhone', 'emergencyPhone']));
  });
  it('builds payload with photo and documents', () => {
    const p = buildPayload(valid, '/objects/x', [{ documentType: 'birth', fileName: 'a.pdf', contentType: 'application/pdf', byteSize: 1, objectPath: '/objects/y' }]);
    expect(p.guardian.phone).toBe('+2348031234567');
    expect(p.applicant.photoObjectPath).toBe('/objects/x');
    expect(p.applicant.intendedClassId).toBe(4);
    expect(p.documents).toHaveLength(1);
  });
  it('flags missing required documents', () => {
    expect(validateForm(valid, { requiredDocuments: ['Birth certificate'], documents: [] }).documents).toMatch(/Birth certificate/);
  });
});

describe('idempotency', () => {
  it('keeps the key on retry and rotates when payload changes', () => {
    const h: KeyHolder = { current: null };
    const a = resolveRequestKey(h, { x: 1 });
    expect(resolveRequestKey(h, { x: 1 })).toBe(a);
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(resolveRequestKey(h, { x: 2 })).not.toBe(a);
  });
  it('live header reads the latest key at call time', () => {
    const ref = { current: 'a' }; const req = liveKeyRequest(ref);
    ref.current = 'b';
    expect(Object.fromEntries(Object.entries(req.headers))['Idempotency-Key']).toBe('b');
  });
});

describe('receipt and conversion', () => {
  it('receipt text includes number and code', () => {
    const t = receiptText({ applicationNumber: 'APP-1', receiptSecret: 'S'.repeat(32) }, 'Greenfield');
    expect(t).toContain('APP-1'); expect(t).toContain('S'.repeat(32));
  });
  it('only accepted unconverted applications convert', () => {
    expect(canConvert({ status: 'Accepted', studentId: null })).toBe(true);
    expect(canConvert({ status: 'Accepted', studentId: 3 })).toBe(false);
    expect(canConvert({ status: 'Waitlisted' })).toBe(false);
  });
  it('transitions cover every status except Enrolled', () => {
    expect(STATUS_VALUES).toContain('Waitlisted');
    expect(TRANSITION_VALUES).not.toContain('Enrolled');
    expect(TRANSITION_VALUES).toEqual(expect.arrayContaining(['Accepted', 'Waitlisted', 'Rejected', 'Withdrawn', 'AssessmentCompleted']));
  });
  it('portal link uses current origin', () => {
    expect(portalUrlFor('k1', 'https://x.test')).toMatch(/^https:\/\/x\.test.*\/admissions\/portal\/k1$/);
  });
});

import { resolvePortalUrl } from './admissions-lib';
describe('portalUrl validation', () => {
  it('anchors relative, accepts same origin, rejects foreign origin', () => {
    expect(resolvePortalUrl('/admissions/portal/k', 'k', 'https://a.test')).toMatch(/^https:\/\/a\.test.*\/admissions\/portal\/k$/);
    expect(resolvePortalUrl('https://a.test/x/y', 'k', 'https://a.test')).toBe('https://a.test/x/y');
    expect(resolvePortalUrl('https://evil.test/p', 'k', 'https://a.test')).toMatch(/^https:\/\/a\.test.*\/admissions\/portal\/k$/);
  });
});
