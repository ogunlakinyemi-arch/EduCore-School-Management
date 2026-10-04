import { useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, FlaskConical, ShieldCheck, Printer } from 'lucide-react';
import type { SettlementProviderCapability, SettlementHistoryEntry } from '@workspace/api-client-react';
import { EmptyState, StatusPill, cx, date, time } from '@/components/shared';
import { Landmark } from 'lucide-react';
import { nigerianBankOptions } from '@/lib/nigerian-bank-options';

export const entry = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-sm font-medium outline-none focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.12)]';
export const note = 'text-xs leading-5 text-[hsl(var(--muted-foreground))]';
export const FRESH_MS = 30_000;

export const ngn = (minor = 0) => {
  const neg = minor < 0;
  const abs = BigInt(Math.abs(Math.trunc(minor)));
  return `${neg ? '-' : ''}₦${(abs / 100n).toLocaleString('en-NG')}.${String(abs % 100n).padStart(2, '0')}`;
};
export const minorToInput = (minor = 0) => {
  const neg = minor < 0; const abs = BigInt(Math.abs(Math.trunc(minor)));
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};
export function toMinor(value: string, signed = false): number {
  const m = value.trim().match(signed ? /^(-?)([0-9]+)(?:\.([0-9]{0,2}))?$/ : /^()([0-9]+)(?:\.([0-9]{0,2}))?$/);
  if (!m) return Number.NaN;
  const v = BigInt(m[2]) * 100n + BigInt((m[3] ?? '').padEnd(2, '0') || '0');
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) return Number.NaN;
  return m[1] === '-' ? -Number(v) : Number(v);
}
export const netOf = (base: number, allowance: number, bonus: number, deduction: number, adjustment: number) => base + allowance + bonus - deduction + adjustment;
export const errMsg = (e: unknown) => e instanceof Error ? e.message : 'The request could not be completed. Please try again.';
export const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, (mo || 1) - 1, 1).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' }); };
export const currentMonth = () => new Date().toISOString().slice(0, 7);

/** Treat a transfer/item as settled only when the server says PAID and (for transfers) provider-verified. */
export function transferOutcome(status: string, verified?: boolean) {
  if (status === 'PAID') return verified === false ? { label: 'Paid - awaiting verification', tone: 'PENDING' } : { label: 'Paid - provider verified', tone: 'VERIFIED' };
  if (status === 'MOCK_PENDING') return { label: 'Mock pending - no funds moved', tone: 'PENDING' };
  if (status === 'FAILED') return { label: 'Failed - provider verified', tone: 'FAILED' };
  if (status === 'UNCERTAIN' || status === 'RECONCILIATION_REQUIRED') return { label: 'Outcome unknown - reconcile', tone: 'FAILED' };
  if (status === 'UNPAID') return { label: 'Not sent', tone: 'NEUTRAL' };
  if (status === 'CANCELLED') return { label: 'Cancelled', tone: 'NEUTRAL' };
  return { label: 'Pending - awaiting provider', tone: 'PENDING' };
}
export function OutcomeBadge({ status, verified }: { status: string; verified?: boolean }) {
  const o = transferOutcome(status, verified);
  return <span className={cx('inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider',
    o.tone === 'VERIFIED' && 'bg-[hsl(157_37%_43%/.15)] text-[hsl(157_37%_30%)]',
    o.tone === 'PENDING' && 'bg-[hsl(35_83%_53%/.15)] text-[hsl(28_73%_40%)]',
    o.tone === 'FAILED' && 'bg-[hsl(var(--destructive)/.15)] text-[hsl(var(--destructive))]',
    o.tone === 'NEUTRAL' && 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]')} data-testid={`outcome-${status.toLowerCase()}`}>{o.label}</span>;
}

export function ProviderBanner({ capability, mode }: { capability?: SettlementProviderCapability | null; mode?: string }) {
  const m = mode ?? capability?.mode ?? 'NOT_CONFIGURED';
  const cap = capability?.transferCapability;
  const blocked = m === 'NOT_CONFIGURED' || cap === 'NOT_CONFIGURED' || cap === 'BLOCKED_IN_DEVELOPMENT';
  const text = m === 'MOCK' || cap === 'MOCK_ONLY'
    ? 'Mock mode. No actual funds are moved. Mock-pending transfers are simulations and never count as paid.'
    : m === 'TEST' ? 'Provider test mode. Test transfers do not move real funds and are not live settlement.'
    : blocked ? (cap === 'BLOCKED_IN_DEVELOPMENT' ? 'Provider transfers are blocked in this environment. This capability is unsupported here, not simulated.' : 'Provider is not configured. Transfers and subaccount verification are unavailable.')
    : 'Live provider. Only server-verified provider outcomes are shown as paid.';
  return <div role="status" data-testid="banner-provider-mode" className={cx('mb-5 flex gap-3 rounded-2xl border p-4 text-sm', blocked ? 'border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.06)]' : 'border-[hsl(35_83%_53%/.4)] bg-[hsl(35_83%_53%/.1)]')}>
    {blocked ? <CircleAlert size={18} className="mt-0.5 shrink-0" /> : <FlaskConical size={18} className="mt-0.5 shrink-0" />}
    <div><div className="font-bold">Provider {capability?.provider ?? 'FLUTTERWAVE'} / mode {m.replace('_', ' ')}</div><p className={note}>{text}</p>
      {capability && <p className={note}>Credentials: {capability.credentialsConfigured ? 'available on server' : 'not available'} (values never shown). Bank subaccounts: {capability.bankSubaccountsSupported ? 'supported' : 'unsupported by provider API'}. Live settlement verified: no.</p>}</div>
  </div>;
}

export function IdentityBoundary({ scope }: { scope: 'COMPANY' | 'SCHOOL' }) {
  return <div className="mb-5 flex items-center gap-3 rounded-2xl bg-[hsl(var(--secondary))] px-4 py-3 text-sm" data-testid={`boundary-${scope.toLowerCase()}`}>
    <ShieldCheck size={18} className="shrink-0 text-[hsl(var(--primary))]" />
    <span className="font-bold">{scope === 'COMPANY' ? 'Yemait company funds' : 'School funds'}</span>
    <span className={note}>{scope === 'COMPANY' ? 'Company payroll and settlement are kept separate from every school account.' : 'This school account is separate from Yemait company money and other schools.'}</span>
  </div>;
}

/** Re-renders the freshness label every 15s. */
export function Freshness({ updatedAt, fetching, onRefresh }: { updatedAt: number; fetching: boolean; onRefresh: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 15000); return () => clearInterval(t); }, []);
  const secs = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;
  return <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]" data-testid="freshness">
    <span>{fetching ? 'Refreshing...' : secs === null ? 'Not loaded' : `Updated ${secs < 5 ? 'just now' : `${secs}s ago`}; auto-refresh every 30s`}</span>
    <button type="button" className="font-bold underline" onClick={onRefresh}>Refresh</button>
  </div>;
}

export function Notice({ kind, children, onClose }: { kind: 'ok' | 'error'; children: ReactNode; onClose?: () => void }) {
  return <div role={kind === 'error' ? 'alert' : 'status'} className={cx('mb-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-semibold', kind === 'ok' ? 'border border-[hsl(157_37%_43%/.3)] bg-[hsl(157_37%_43%/.08)]' : 'bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]')}>
    <div className="flex-1">{children}</div>{onClose && <button type="button" onClick={onClose} aria-label="Dismiss">x</button>}</div>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Tabs({ tabs, value, onChange }: { tabs: ReadonlyArray<readonly [string, string]>; value: string; onChange: (t: any) => void }) {
  return <div className="mb-6 flex gap-1 overflow-x-auto border-b border-[hsl(var(--border))]" role="tablist">
    {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)} data-testid={`tab-${id}`}
      className={cx('whitespace-nowrap border-b-2 px-4 py-3 text-sm font-bold', value === id ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]' : 'border-transparent text-[hsl(var(--muted-foreground))]')}>{label}</button>)}
  </div>;
}

/** Bank input group. Account number is write-only: never prefilled, never logged. */
export function BankFields({ v, set, maskedCurrent }: { v: { bankName: string; bankCode: string; accountName: string; accountNumber: string }; set: (p: Partial<{ bankName: string; bankCode: string; accountName: string; accountNumber: string }>) => void; maskedCurrent?: string | null }) {
  const legacyBank = !!v.bankCode && !nigerianBankOptions.some(bank => bank.code === v.bankCode);
  return <div className="grid gap-3 sm:grid-cols-2">
    <label className="block"><span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">Bank name</span>
      <select required className={entry} value={v.bankCode} onChange={e => {
        const bank = nigerianBankOptions.find(option => option.code === e.target.value);
        if (bank) set({ bankName: bank.name, bankCode: bank.code });
      }} data-testid="input-bank-name">
        <option value="">Select a bank</option>
        {legacyBank && <option value={v.bankCode}>{v.bankName} (current saved bank)</option>}
        {nigerianBankOptions.map(bank => <option key={bank.code} value={bank.code}>{bank.name}</option>)}
      </select>
    </label>
    <label className="block"><span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">Bank code (automatic)</span><input readOnly required inputMode="numeric" pattern="[0-9]{3,6}" maxLength={6} className={`${entry} font-mono`} value={v.bankCode} data-testid="input-bank-code" /></label>
    <label className="block"><span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">Account name</span><input required minLength={2} maxLength={150} className={entry} value={v.accountName} onChange={e => set({ accountName: e.target.value })} autoComplete="off" data-testid="input-account-name" /></label>
    <label className="block"><span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">New account number (10 digits)</span>
      <input required type="password" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} className={`${entry} font-mono tracking-widest`} value={v.accountNumber} onChange={e => set({ accountNumber: e.target.value.replace(/\D/g, '') })} autoComplete="off" placeholder={maskedCurrent ?? ''} data-testid="input-account-number" />
      <span className={`mt-1 block ${note}`}>Current: {maskedCurrent ? <span className="font-mono">{maskedCurrent}</span> : 'none on file'}. Re-enter the full number to change it; it is never shown again.</span></label>
  </div>;
}

export function csvDownload(name: string, rows: Array<Array<string | number>>) {
  const esc = (c: string | number) => { let s = String(c); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const blob = new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export const PrintStyles = () => <style>{`@media print{body *{visibility:hidden}.print-area,.print-area *{visibility:visible}.print-area{position:absolute;left:0;top:0;width:100%;box-shadow:none}.no-print{display:none!important}}`}</style>;
export const PrintButton = ({ label = 'Print' }: { label?: string }) => <button type="button" onClick={() => window.print()} className="no-print inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-bold" data-testid="button-print"><Printer size={15} />{label}</button>;

export function SettlementHistoryTable({ rows, showSchool }: { rows: SettlementHistoryEntry[]; showSchool?: boolean }) {
  if (!rows.length) return <EmptyState icon={Landmark} title="No settlement records" description="Nothing has been settled yet. Entries appear only from provider records, never from bank details entered here." />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
    <thead className="eyebrow"><tr><th className="p-3">Date</th>{showSchool && <th className="p-3">School</th>}<th className="p-3">Reference</th><th className="p-3 text-right">Gross</th><th className="p-3 text-right">Fee</th><th className="p-3 text-right">Settled</th><th className="p-3">Outcome</th></tr></thead>
    <tbody className="divide-y divide-[hsl(var(--border))]">{rows.map(r => <tr key={r.id} data-testid={`row-settlement-${r.id}`}>
      <td className="p-3">{date(r.occurredAt)} {time(r.occurredAt)}</td>{showSchool && <td className="p-3">{r.schoolName ?? (r.scope === 'YEMAIT_COMPANY' ? 'Yemait company' : '-')}</td>}
      <td className="p-3 font-mono text-xs">{r.providerReference ?? r.sourceTransactionReference ?? '-'}</td>
      <td className="p-3 text-right tabular-nums">{ngn(r.grossAmountMinor)}</td><td className="p-3 text-right tabular-nums">{ngn(r.providerFeeMinor ?? 0)}</td>
      <td className="p-3 text-right font-bold tabular-nums">{r.status === 'SUCCESS' && r.externalSettlementVerified ? ngn(r.amountSettledMinor) : 'Not verified'}</td>
      <td className="p-3">{r.status === 'SUCCESS' && r.externalSettlementVerified ? <StatusPill value="verified" /> : <span className="text-xs font-bold">{r.status === 'SUCCESS' ? 'Unverified' : r.status.replaceAll('_', ' ')} / {r.reconciliationStatus.toString().replaceAll('_', ' ')}</span>}</td>
    </tr>)}</tbody></table></div>;
}
