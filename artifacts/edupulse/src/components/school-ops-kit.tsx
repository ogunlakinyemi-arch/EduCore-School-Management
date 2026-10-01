import { useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useGetAuthorizedContext } from '@workspace/api-client-react';
import { useTenant, cx } from '@/components/shared';

export const FRESH = { staleTime: 30_000, refetchOnWindowFocus: true, refetchOnMount: true } as const;

export type RoleInput = {
  schoolId: number;
  context?: { isPlatformOwner?: boolean; roles?: Array<{ schoolId?: number | null; role: string; status: string }> } | null;
};

/** Pure derivation so it can be tested without React. */
export function deriveSchoolRole({ schoolId, context }: RoleInput) {
  const isPlatformOwner = context?.isPlatformOwner === true;
  const active = (context?.roles ?? []).filter(r => !!schoolId && r.schoolId === schoolId && r.status === 'ACTIVE').map(r => r.role);
  const roles = new Set(active);
  const isAdmin = roles.has('SCHOOL_ADMIN');
  return {
    isPlatformOwner,
    roles,
    isAdmin,
    isTeacher: roles.has('TEACHER'),
    canManage: isAdmin && !isPlatformOwner,
    canRead: !!schoolId && (isPlatformOwner || roles.size > 0),
  };
}

export function useSchoolRole() {
  const { schoolId } = useTenant();
  const q = useGetAuthorizedContext();
  const derived = useMemo(() => deriveSchoolRole({ schoolId, context: q.data as RoleInput['context'] }), [schoolId, q.data]);
  return { schoolId, loading: q.isLoading, contextError: q.isError, ...derived };
}

export function errMsg(err: unknown, fallback = 'Something went wrong. Check the details and try again.') {
  const e = err as { data?: { error?: string } | null; status?: number; message?: string } | null;
  if (e?.data && typeof e.data === 'object' && typeof e.data.error === 'string') return e.data.error;
  if (e?.status === 409) return 'This conflicts with an existing record.';
  if (e?.status === 403) return 'You do not have permission to do this in the selected school.';
  return fallback;
}

/** Strict YYYY-MM-DD parser: rejects impossible dates such as 2025-02-31. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}
export const isValidRange = (start: string, end?: string | null) => {
  const s = parseIsoDate(start);
  if (!s) return false;
  if (!end) return true;
  const e = parseIsoDate(end);
  return !!e && e.getTime() >= s.getTime();
};
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const fmtDay = (v?: string | null) => {
  const d = parseIsoDate(v?.slice(0, 10));
  return d ? d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
};
export const rangesOverlap = (a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }) =>
  a.startDate <= b.endDate && b.startDate <= a.endDate;

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-xl border px-4 py-3 text-sm font-medium',
      tone === 'error' && 'border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]',
      tone === 'success' && 'border-[hsl(157_37%_43%/.35)] bg-[hsl(157_37%_43%/.12)] text-[hsl(157_37%_28%)]',
      tone === 'info' && 'border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)] text-[hsl(var(--muted-foreground))]')}>
      {children}
    </div>
  );
}

export type Option = { value: number; label: string; hint?: string };

export function SearchSelect({ label, options, value, onChange, placeholder = 'Search…', disabled, testId }: {
  label: string; options: Option[]; value: number | null; onChange: (v: number | null) => void; placeholder?: string; disabled?: boolean; testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const selected = options.find(o => o.value === value);
  const shown = options.filter(o => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(term.trim().toLowerCase())).slice(0, 50);
  return (
    <div className="relative">
      <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">{label}</span>
      <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open} data-testid={testId}
        className="flex w-full items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-left text-sm disabled:opacity-50">
        <span className={selected ? 'font-semibold' : 'text-[hsl(var(--muted-foreground))]'}>{selected ? selected.label : 'Select…'}</span>
        <ChevronDown size={16} className="opacity-60" />
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-xl">
          <label className="relative mb-2 block">
            <Search size={15} className="absolute left-3 top-3 text-[hsl(var(--muted-foreground))]" />
            <input autoFocus className="pl-9" value={term} onChange={e => setTerm(e.target.value)} placeholder={placeholder} aria-label={`Search ${label}`} />
          </label>
          <ul role="listbox" className="max-h-56 overflow-auto">
            {shown.length === 0 && <li className="px-3 py-3 text-xs text-[hsl(var(--muted-foreground))]">No matches</li>}
            {shown.map(o => (
              <li key={o.value}>
                <button type="button" role="option" aria-selected={o.value === value} onClick={() => { onChange(o.value); setOpen(false); setTerm(''); }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[hsl(var(--muted))]">
                  <span><span className="font-semibold">{o.label}</span>{o.hint && <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">{o.hint}</span>}</span>
                  {o.value === value && <Check size={14} />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
