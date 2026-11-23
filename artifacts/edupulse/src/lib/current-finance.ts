import { useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useActOnCurrentFinance,
  useGetCurrentFinanceOverview,
  getGetCurrentFinanceOverviewQueryKey,
  type ActOnCurrentFinanceBodyAction,
} from '@workspace/api-client-react';

/* Local DTOs matching the backend current-finance contract. */
export type Source = 'DIRECT' | 'BULK';
export type FinanceSummary = { studentCount: number; earnedMinor: number; pendingMinor: number; approvedMinor: number; availableMinor: number; paidMinor: number };
export type Entitlement = { key: string; studentId: number; studentName: string; schoolId: number; schoolName: string; termId: number; termName: string; amountMinor: number; state: string; requestId: number | null; available: boolean };
export type RequestLine = { entitlementKey: string; studentName: string; state: string; reason: string | null };
export type WithdrawalRequest = { id: number; partnerId: number; broName: string; totalMinor: number; createdAt: string; lines: RequestLine[] };
export type Payment = { id: number; source: Source; studentName: string; studentId: number; schoolId: number; termId: number; reference: string; state: string; amountMinor: number; refundedMinor: number; netPaidMinor: number };
export type Refund = { id: number; studentName: string; amountMinor: number; state: string; source: Source; sourceId: number };
export type Payout = { id: number; entitlementKey: string; amountMinor: number; state: string; reference: string | null; maskedAccountNumber: string | null };
export type BatchItem = { id: number; studentId: number; studentName: string; state: string; error: string | null };
export type Batch = { id: number; reference: string; state: string; amountMinor: number; checkoutUrl: string | null; items: BatchItem[] };
export type EligibleStudent = { id: number; name: string; eligible: boolean; reason: string | null };
export type FinanceOverview = {
  owner: boolean; bro: boolean;
  schools: { id: number; name: string }[];
  terms: { id: number; schoolId: number; name: string }[];
  summary: FinanceSummary;
  entitlements: Entitlement[]; requests: WithdrawalRequest[]; payments: Payment[]; refunds: Refund[];
  payouts: Payout[]; batches: Batch[]; eligibleStudents: EligibleStudent[]; blockers: string[];
};
export type FinanceReceipt = {
  id: number; reference: string; schoolName: string; termName: string; currency: 'NGN';
  amountMinor: number; refundedMinor: number; netPaidMinor: number; verifiedAt: string | null;
  items: { id: number; studentId: number; studentName: string; amountMinor: number; refundedMinor: number; netPaidMinor: number; receiptNumber: string }[];
};
export type ActionResult = { [key: string]: unknown; checkoutUrl?: string | null };

export const naira = (minor: number) => `₦${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Converts a positive NGN amount typed by a person into integer kobo. Returns null when invalid. */
export function toMinor(input: string): number | null {
  const t = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  const minor = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

export function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

export function safeHttpsUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try { const u = new URL(url); return u.protocol === 'https:' ? u.toString() : null; } catch { return null; }
}

type ErrLike = { status?: number; data?: { error?: unknown; code?: unknown } | null; message?: string } | null;
export function apiErrorText(err: unknown, fallback = 'The request failed.'): string {
  const e = err as ErrLike;
  const raw = typeof e?.data?.error === 'string' ? e.data.error : fallback;
  return raw.replace(/[\u0000-\u001f]/g, ' ').slice(0, 300);
}
/** A response the server definitively rejected (4xx other than timeout/conflict-in-progress). Otherwise the outcome is uncertain. */
export function isDefinitiveRejection(err: unknown): boolean {
  const s = (err as ErrLike)?.status;
  return typeof s === 'number' && s >= 400 && s < 500 && s !== 408 && s !== 409 && s !== 429;
}
export function isUnavailable(err: unknown): boolean {
  const s = (err as ErrLike)?.status;
  return s === 404 || s === 410 || s === 501 || s === 503;
}

export function isOverview(d: unknown): d is FinanceOverview {
  const o = d as FinanceOverview | null;
  return !!o && typeof o === 'object' && !!o.summary && typeof o.summary.earnedMinor === 'number'
    && Array.isArray(o.entitlements) && Array.isArray(o.requests) && Array.isArray(o.payments)
    && Array.isArray(o.refunds) && Array.isArray(o.payouts) && Array.isArray(o.batches)
    && Array.isArray(o.schools) && Array.isArray(o.terms) && Array.isArray(o.eligibleStudents) && Array.isArray(o.blockers);
}

export function useCurrentFinance(params: { schoolId?: number; termId?: number }, enabled = true) {
  const { user } = useUser();
  const clean = { ...(params.schoolId ? { schoolId: params.schoolId } : {}), ...(params.termId ? { termId: params.termId } : {}) };
  return useGetCurrentFinanceOverview(clean, { query: {
    queryKey: [...getGetCurrentFinanceOverviewQueryKey(clean), user?.id ?? 'anonymous'],
    enabled: enabled && !!user?.id, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true,
    refetchInterval: 15_000, retry: false,
  } });
}

const storeKey = (uid: string, slot: string) => `educore:current-finance:${uid}:${slot}`;

/**
 * Runs finance actions. Money-changing requests carry a UUID key. When the outcome is uncertain
 * (network error, 5xx, 409/429) the same key is retained for that slot so a deliberate resubmit
 * is the same request identity, never a new one.
 */
export function useFinanceAction() {
  const { user } = useUser();
  const uid = user?.id ?? 'anonymous';
  const qc = useQueryClient();
  const act = useActOnCurrentFinance();
  const mutateRef = useRef(act.mutateAsync);
  mutateRef.current = act.mutateAsync;
  const [busy, setBusy] = useState<string | null>(null);
  const [, force] = useState(0);
  const inFlight = useRef(new Set<string>());

  const pendingKey = (slot: string): string | null => {
    try { return sessionStorage.getItem(storeKey(uid, slot)); } catch { return null; }
  };
  const run = async (slot: string, action: ActOnCurrentFinanceBodyAction, payload: Record<string, unknown>, withKey: boolean):
    Promise<{ ok: true; result: ActionResult } | { ok: false; uncertain: boolean; message: string }> => {
    if (inFlight.current.has(slot)) return { ok: false, uncertain: true, message: 'This request is already in progress.' };
    inFlight.current.add(slot);
    setBusy(slot);
    let key: string | undefined;
    if (withKey) {
      key = pendingKey(slot) ?? newKey();
      try { sessionStorage.setItem(storeKey(uid, slot), key); } catch { /* memory only */ }
    }
    try {
      const result = await mutateRef.current({ data: { action, payload: withKey ? { ...payload, key } : payload } }) as unknown as ActionResult;
      try { sessionStorage.removeItem(storeKey(uid, slot)); } catch { /* ignore */ }
      return { ok: true, result: result ?? {} };
    } catch (err) {
      const definitive = isDefinitiveRejection(err);
      if (definitive) { try { sessionStorage.removeItem(storeKey(uid, slot)); } catch { /* ignore */ } }
      return { ok: false, uncertain: !definitive, message: apiErrorText(err, definitive ? 'The server rejected this request.' : 'The outcome could not be confirmed.') };
    } finally {
      inFlight.current.delete(slot);
      setBusy(null);
      force(n => n + 1);
      await qc.invalidateQueries({ queryKey: getGetCurrentFinanceOverviewQueryKey() });
    }
  };
  return { run, busy, pendingKey, isPending: act.isPending };
}
