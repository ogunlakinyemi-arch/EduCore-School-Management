import type { PromotionStudent, PromotionReviewInput } from '@workspace/api-client-react';

export const OUTCOMES = ['Promoted', 'Repeat', 'Graduated', 'Withdrawn', 'Transferred'] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const NEEDS_PLACEMENT: Outcome[] = ['Promoted', 'Repeat'];

export type Draft = { status: Outcome | ''; reason: string; targetClassId: number | null; targetSection: string; targetTermId: number | null };
export const emptyDraft = (): Draft => ({ status: '', reason: '', targetClassId: null, targetSection: '', targetTermId: null });

export function validateDraft(d: Draft): string | null {
  if (!d.status) return 'Choose an outcome.';
  if (!d.reason.trim()) return 'A reason is required.';
  if (d.reason.trim().length > 1000) return 'Reason must be 1000 characters or fewer.';
  if (NEEDS_PLACEMENT.includes(d.status)) {
    if (!d.targetClassId) return 'Choose a target class.';
    if (!d.targetSection.trim()) return 'Choose a target section.';
    if (!d.targetTermId) return 'Choose a target term.';
  }
  return null;
}

export function toReviewInput(d: Draft): PromotionReviewInput {
  const placed = !!d.status && NEEDS_PLACEMENT.includes(d.status);
  return {
    status: d.status as Outcome,
    reason: d.reason.trim(),
    targetClassId: placed ? d.targetClassId : null,
    targetSection: placed ? d.targetSection.trim() : null,
    targetTermId: placed ? d.targetTermId : null,
  };
}

export const isReviewed = (s: Pick<PromotionStudent, 'status'>) => s.status !== 'Pending' && s.status !== 'Eligible';
export const unreviewedCount = (list: PromotionStudent[]) => list.filter(s => !isReviewed(s)).length;
export const canFinalize = (status: string, list: PromotionStudent[]) => status === 'Prepared' && list.length > 0 && unreviewedCount(list) === 0;

export type Failure = { kind: 'network' | 'server' | 'conflict' | 'forbidden' | 'validation' | 'other'; message: string };
export function classifyError(err: unknown): Failure {
  const status = (err as { status?: number })?.status;
  const data = (err as { data?: { error?: string; message?: string } })?.data;
  const msg = data?.error ?? data?.message ?? (err instanceof Error ? err.message : 'Request failed.');
  if (typeof status !== 'number') return { kind: 'network', message: 'Connection lost. The request may or may not have reached the server; retrying is safe and will not create a duplicate.' };
  if (status >= 500 || status === 408 || status === 504) return { kind: 'server', message: 'The server did not confirm the outcome. The same request key is kept; retry to resolve it without duplicating anything.' };
  if (status === 409) return { kind: 'conflict', message: `${msg} The data was reloaded; review the latest state before trying again.` };
  if (status === 403 || status === 401) return { kind: 'forbidden', message: 'Your role cannot perform this action.' };
  if (status === 400 || status === 422) return { kind: 'validation', message: msg };
  return { kind: 'other', message: msg };
}

/** Stable per-attempt idempotency keys, persisted so a refresh reuses the same key. */
export function attemptKey(scope: string, store: Pick<Storage, 'getItem' | 'setItem'> = window.sessionStorage): string {
  const k = `promo-key:${scope}`;
  let v = store.getItem(k);
  if (!v) { v = `promo-${scope.replace(/[^a-z0-9]/gi, '')}-${crypto.randomUUID()}`; store.setItem(k, v); }
  return v;
}
export function clearAttemptKey(scope: string, store: Pick<Storage, 'removeItem'> = window.sessionStorage) { store.removeItem(`promo-key:${scope}`); }
