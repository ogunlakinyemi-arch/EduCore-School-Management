import { useState, type ReactNode } from 'react';
import { Lock, Search, History } from 'lucide-react';
import { Button, Modal, StatusPill, cx, date, time } from '@/components/shared';
import { useListStudents, useGetAuthorizedContext } from '@workspace/api-client-react';
import { newIdempotencyKey, errorInfo, label } from './care-contract';

export const inputCls = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-sm outline-none focus:border-[hsl(var(--primary))]';

export function FieldRow({ label: l, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">{l}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-[hsl(var(--muted-foreground))]">{hint}</span>}
      {error && <span role="alert" className="mt-1 block text-xs font-medium text-[hsl(var(--destructive))]">{error}</span>}
    </label>
  );
}

export function Select({ value, onChange, options, blank }: { value: string; onChange: (v: string) => void; options: Array<string | { value: string; label: string }>; blank?: string }) {
  return (
    <select className={inputCls} value={value} onChange={e => onChange(e.target.value)}>
      {blank !== undefined && <option value="">{blank}</option>}
      {options.map(o => { const v = typeof o === 'string' ? o : o.value; return <option key={v} value={v}>{typeof o === 'string' ? label(o) : o.label}</option>; })}
    </select>
  );
}

export function DeniedState({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[hsl(var(--border))] p-10 text-center" data-testid="care-denied">
      <Lock size={22} className="text-[hsl(var(--muted-foreground))]" />
      <div className="font-bold">{what} is restricted</div>
      <p className="max-w-sm text-xs text-[hsl(var(--muted-foreground))]">Your account has not been granted this permission for this school. Ask a School Admin to update student-care access.</p>
    </div>
  );
}

export function Banner({ tone, children }: { tone: 'error' | 'ok' | 'warn'; children: ReactNode }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-xl px-4 py-3 text-sm font-medium', tone === 'error' && 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]', tone === 'ok' && 'bg-[hsl(157_37%_43%/.15)] text-[hsl(157_37%_28%)]', tone === 'warn' && 'bg-[hsl(35_83%_53%/.15)] text-[hsl(28_73%_36%)]')}>{children}</div>;
}

export function SkeletonRows({ n = 3 }: { n?: number }) {
  return <div className="space-y-3">{Array.from({ length: n }).map((_, i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div>;
}

/** One idempotency key per submit attempt; rotate after success or when the form is reopened. */
export function useAttemptKey() {
  const [key, setKey] = useState(newIdempotencyKey);
  return [key, () => setKey(newIdempotencyKey())] as const;
}

export function ConfirmArchive({ title, body, busy, error, onConfirm, onClose }: { title: string; body: string; busy: boolean; error?: unknown; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal title={title} eyebrow="Archive record" onClose={onClose}>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">{body}</p>
      {error ? <div className="mt-4"><Banner tone="error">{errorInfo(error).message}</Banner></div> : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm} testId="button-confirm-archive">{busy ? 'Archiving…' : 'Archive'}</Button>
      </div>
    </Modal>
  );
}

export function HistoryList({ rows, loading, error }: { rows?: Array<{ revision: number; changedAt: string; changedByUserId: number; snapshot?: any }>; loading: boolean; error?: unknown }) {
  if (loading) return <SkeletonRows n={2} />;
  if (error) return <Banner tone="error">{errorInfo(error).message}</Banner>;
  if (!rows?.length) return <p className="text-sm text-[hsl(var(--muted-foreground))]">No revisions yet.</p>;
  return (
    <ol className="space-y-2">
      {[...rows].reverse().map(r => (
        <li key={r.revision} className="rounded-xl border border-[hsl(var(--border))] p-3 text-xs">
          <div className="flex items-center gap-2 font-bold"><History size={13} /> Revision {r.revision}<span className="font-medium text-[hsl(var(--muted-foreground))]">{date(r.changedAt)} {time(r.changedAt)} · user #{r.changedByUserId}</span></div>
          {r.snapshot && <div className="mt-1.5 text-[hsl(var(--muted-foreground))]">{[r.snapshot.status, r.snapshot.followUpStatus, r.snapshot.severity].filter(Boolean).map(label).join(' · ') || 'Content updated'}</div>}
        </li>
      ))}
    </ol>
  );
}

export function useCareRoles(schoolId: number) {
  const ctx = useGetAuthorizedContext();
  const roles = (ctx.data?.roles ?? []).filter(r => r.status === 'ACTIVE' && (r.schoolId === schoolId || r.schoolId === null)).map(r => r.role as string);
  return { roles, isAdmin: roles.includes('SCHOOL_ADMIN'), isTeacher: roles.includes('TEACHER'), isOwner: !!ctx.data?.isPlatformOwner, loading: ctx.isLoading, userId: ctx.data?.user?.id as number | undefined };
}

/** Real, school-scoped student selector. Selection is lifted so callers can reset child state by key. */
export function StudentPicker({ schoolId, value, onChange }: { schoolId: number; value: number | null; onChange: (id: number | null) => void }) {
  const [q, setQ] = useState('');
  const query = useListStudents({ schoolId, search: q || undefined }, { query: { enabled: schoolId > 0, queryKey: ['care-students', schoolId, q] } });
  const list = query.data ?? [];
  return (
    <div className="panel p-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-3 text-[hsl(var(--muted-foreground))]" />
          <input aria-label="Search students" className={cx(inputCls, 'pl-9')} placeholder="Search by name or admission number" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select aria-label="Student" className={cx(inputCls, 'sm:max-w-sm')} value={value ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)} data-testid="select-care-student">
          <option value="">{query.isLoading ? 'Loading students…' : `Select a student (${list.length})`}</option>
          {list.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} — {s.admissionNo}</option>)}
        </select>
      </div>
      {query.isError && <div className="mt-3"><Banner tone="error">Could not load students. {errorInfo(query.error).message}</Banner></div>}
    </div>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 text-[11px] font-bold">{children}</span>;
}
export { StatusPill };
