import type { DeferredCommission } from '@workspace/api-client-react';

export const APPROVAL_DRAFT_KEY = 'educore:partner-term-approval';
export type ApprovalDraft = { idempotencyKey: string; commissionIds: number[] };

export const isEligible = (r: DeferredCommission) => r.eligible === true && r.termEnded === true && r.status === 'PENDING';
export const currentLiability = (r: DeferredCommission) =>
  ['PENDING','APPROVED','PAYABLE'].includes(r.status) ? r.amountMinor : 0;

export type Sum = { known: number; unknown: boolean };
export type CommissionGroup = {
  key: string; sessionName: string; term: string; partnerId: number; partnerName: string;
  rows: DeferredCommission[]; schoolIds: number[]; termIds: number[];
  gross: number; school: number; partner: number;
  providerFee: Sum; additionalFee: Sum; vat: Sum; remainder: Sum; ownerNet: Sum;
};

function sum(rows: DeferredCommission[], pick: (r: DeferredCommission) => number | null): Sum {
  let known = 0; let unknown = false;
  for (const r of rows) { const v = pick(r); if (v === null || v === undefined) unknown = true; else known += v; }
  return { known, unknown };
}

export function groupCommissions(rows: DeferredCommission[]): CommissionGroup[] {
  const map = new Map<string, DeferredCommission[]>();
  for (const r of rows) {
    const k = `${r.sessionName}|${r.term}|${r.partnerId}`;
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()].map(([key, rs]) => ({
    key, sessionName: rs[0].sessionName, term: rs[0].term, partnerId: rs[0].partnerId, partnerName: rs[0].partnerName,
    rows: rs,
    schoolIds: [...new Set(rs.map(r => r.schoolId))],
    termIds: [...new Set(rs.map(r => r.termId))],
    gross: rs.reduce((a, r) => a + r.grossMinor, 0),
    school: rs.reduce((a, r) => a + r.schoolMinor, 0),
    partner: rs.reduce((a, r) => a + currentLiability(r), 0),
    providerFee: sum(rs, r => r.providerFeeMinor),
    additionalFee: sum(rs, r => r.providerAdditionalFeeMinor),
    vat: sum(rs, r => r.vatMinor),
    remainder: sum(rs, r => r.merchantRemainderMinor),
    ownerNet: sum(rs, r => r.ownerNetMinor),
  })).sort((a, b) => b.sessionName.localeCompare(a.sessionName) || a.term.localeCompare(b.term) || a.partnerName.localeCompare(b.partnerName));
}

export function formatMinor(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Unknown';
  return `NGN ${(v / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function formatSum(s: Sum): string {
  return s.unknown ? (s.known ? `${formatMinor(s.known)} + unknown` : 'Unknown') : formatMinor(s.known);
}

export function newKey(): string {
  return globalThis.crypto.randomUUID();
}
export function readApprovalDraft(storage: Storage): ApprovalDraft | null {
  const raw = storage.getItem(APPROVAL_DRAFT_KEY);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as ApprovalDraft;
    if (typeof d.idempotencyKey === 'string' && d.idempotencyKey.length >= 16 && Array.isArray(d.commissionIds) && d.commissionIds.length > 0) return d;
  } catch { /* fallthrough */ }
  return null;
}
export function saveApprovalDraft(storage: Storage, d: ApprovalDraft) { storage.setItem(APPROVAL_DRAFT_KEY, JSON.stringify(d)); }
export function clearApprovalDraft(storage: Storage) { storage.removeItem(APPROVAL_DRAFT_KEY); }

/** Returns the stored draft if present, else persists a new key+payload BEFORE any POST. */
export function prepareApproval(storage: Storage, ids: number[]): ApprovalDraft {
  const existing = readApprovalDraft(storage);
  if (existing) return existing;
  const d = { idempotencyKey: newKey(), commissionIds: [...ids].sort((a, b) => a - b) };
  saveApprovalDraft(storage, d);
  return d;
}
/** Transport/ambiguous failures keep the key; definitive 4xx rejections release it. */
export function isAmbiguousFailure(e: unknown): boolean {
  const s = (e as { status?: number })?.status;
  return typeof s !== 'number' || s >= 500 || s === 408;
}
