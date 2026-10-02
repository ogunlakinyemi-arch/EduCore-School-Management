import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button, ErrorState, SkeletonPage, cx } from '@/components/shared';
import { isForbidden } from './security-contract';

export const inputClass = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-sm outline-none focus:border-[hsl(var(--primary))]';

export function Forbidden() {
  return <div className="panel p-8 text-center" role="alert" data-testid="state-forbidden"><ShieldAlert className="mx-auto text-[hsl(var(--muted-foreground))]" size={28} /><h3 className="display-font mt-3 text-lg font-bold">You do not have access to this area</h3><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Ask a School Admin to grant the required security permission.</p></div>;
}

export function QueryBoundary({ query, children }: { query: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }; children: ReactNode }) {
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return isForbidden(query.error) ? <Forbidden /> : <ErrorState retry={() => void query.refetch()} />;
  return <>{children}</>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return <div className="mb-6 flex gap-1 overflow-x-auto border-b border-[hsl(var(--border))]" role="tablist">{tabs.map(t => <button key={t.id} role="tab" aria-selected={value === t.id} data-testid={`tab-${t.id}`} onClick={() => onChange(t.id)} className={cx('whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-bold', value === t.id ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]' : 'border-transparent text-[hsl(var(--muted-foreground))]')}>{t.label}</button>)}</div>;
}

export function Pager({ page, onPage, hasMore }: { page: number; onPage: (p: number) => void; hasMore: boolean }) {
  return <div className="flex items-center justify-between border-t border-[hsl(var(--border))] p-3 text-xs"><Button variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button><span className="font-bold">Page {page + 1}</span><Button variant="outline" disabled={!hasMore} onClick={() => onPage(page + 1)}>Next</Button></div>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) {
  return <p role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-xl px-3 py-2 text-sm', tone === 'error' ? 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]' : 'bg-[hsl(var(--secondary))]')}>{children}</p>;
}
