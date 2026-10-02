import { describe, expect, it } from 'vitest';
import { attemptKey, canFinalize, classifyError, clearAttemptKey, emptyDraft, toReviewInput, validateDraft } from './promotion-logic';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const stu = (status: string) => ({ status }) as never;

describe('outcome validation', () => {
  it('requires outcome and reason', () => {
    expect(validateDraft(emptyDraft())).toMatch(/outcome/);
    expect(validateDraft({ ...emptyDraft(), status: 'Withdrawn' })).toMatch(/reason/);
    expect(validateDraft({ ...emptyDraft(), status: 'Withdrawn', reason: 'Relocated' })).toBeNull();
  });
  it('requires class, section and term for Promoted/Repeat', () => {
    const d = { ...emptyDraft(), status: 'Promoted' as const, reason: 'Passed' };
    expect(validateDraft(d)).toMatch(/class/);
    expect(validateDraft({ ...d, targetClassId: 2 })).toMatch(/section/);
    expect(validateDraft({ ...d, targetClassId: 2, targetSection: 'A' })).toMatch(/term/);
    expect(validateDraft({ ...d, targetClassId: 2, targetSection: 'A', targetTermId: 3 })).toBeNull();
  });
  it('drops placement for terminal outcomes', () => {
    const i = toReviewInput({ status: 'Graduated', reason: ' done ', targetClassId: 4, targetSection: 'B', targetTermId: 1 });
    expect(i).toEqual({ status: 'Graduated', reason: 'done', targetClassId: null, targetSection: null, targetTermId: null });
  });
  it('finalizes only when all reviewed', () => {
    expect(canFinalize('Prepared', [stu('Promoted'), stu('Pending')])).toBe(false);
    expect(canFinalize('Prepared', [stu('Promoted'), stu('Repeat')])).toBe(true);
    expect(canFinalize('Finalized', [stu('Promoted')])).toBe(false);
  });
});

describe('concurrency semantics', () => {
  it('classifies 409 as conflict and missing status as network', () => {
    expect(classifyError({ status: 409, data: { error: 'Target session is not current' } }).kind).toBe('conflict');
    expect(classifyError(new TypeError('Failed to fetch')).kind).toBe('network');
    expect(classifyError({ status: 502 }).kind).toBe('server');
    expect(classifyError({ status: 403 }).kind).toBe('forbidden');
  });
  it('keeps the same key across retries and refresh until cleared', () => {
    const s = mem();
    const a = attemptKey('prepare:1:2:3', s);
    expect(attemptKey('prepare:1:2:3', s)).toBe(a);
    expect(a.length).toBeGreaterThanOrEqual(8);
    clearAttemptKey('prepare:1:2:3', s);
    expect(attemptKey('prepare:1:2:3', s)).not.toBe(a);
  });
});
