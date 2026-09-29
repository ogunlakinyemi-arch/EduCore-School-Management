import { useState, type FormEvent, type ReactNode } from 'react';
import { BookOpen, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { Button, EmptyState, ErrorState, Field, Modal, SkeletonPage, StatusPill, cx } from '@/components/shared';

export const phase9Input = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3.5 py-2.5 text-sm text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))]';
export const phase9Label = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/^./, letter => letter.toUpperCase());

export function WorkspaceTabs<T extends string>({ items, active, onChange }: { items: { id: T; label: string; count?: number }[]; active: T; onChange: (id: T) => void }) {
  return <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto rounded-2xl bg-[hsl(var(--secondary)/.7)] p-1.5" aria-label="Workspace sections">
    {items.map(item => <button key={item.id} type="button" role="tab" aria-selected={active === item.id} data-testid={`tab-${item.id}`} onClick={() => onChange(item.id)} className={cx('shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors', active === item.id ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]')}>{item.label}{item.count !== undefined && <span className="ml-2 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px]">{item.count}</span>}</button>)}
  </div>;
}

export function WorkspaceIntro({ index, title, description, action }: { index: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[hsl(var(--border))] px-5 py-5 md:px-7">
    <div><div className="eyebrow">{index}</div><h2 className="display-font mt-1 text-xl font-bold">{title}</h2>{description && <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{description}</p>}</div>{action}
  </div>;
}

export function WorkspaceList<T extends { id: number }>({ rows, loading, error, retry, title, empty, render, action, index, filter, onFilter, status, onStatus, statuses = [] }: {
  rows: T[] | undefined; loading: boolean; error: boolean; retry: () => void; title: string; empty: string; render: (row: T) => ReactNode;
  action?: ReactNode; index: string; filter?: string; onFilter?: (value: string) => void; status?: string; onStatus?: (value: string) => void; statuses?: string[];
}) {
  return <section className="panel overflow-hidden">
    <WorkspaceIntro index={index} title={title} action={action} />
    {(onFilter || onStatus) && <div className="flex flex-wrap gap-3 border-b border-[hsl(var(--border)/.7)] bg-[hsl(var(--secondary)/.22)] p-4 md:px-7">
      {onFilter && <label className="relative min-w-[220px] flex-1"><Search size={17} className="absolute left-3 top-3 text-[hsl(var(--muted-foreground))]" /><span className="sr-only">Search {title}</span><input data-testid={`input-search-${index}`} className={`${phase9Input} pl-10`} placeholder={`Search ${title.toLowerCase()}...`} value={filter ?? ''} onChange={event => onFilter(event.target.value)} /></label>}
      {onStatus && <label className="relative min-w-40"><SlidersHorizontal size={16} className="absolute left-3 top-3 text-[hsl(var(--muted-foreground))]" /><span className="sr-only">Filter status</span><select data-testid={`select-status-${index}`} className={`${phase9Input} pl-10`} value={status ?? ''} onChange={event => onStatus(event.target.value)}><option value="">All statuses</option>{statuses.map(value => <option key={value} value={value}>{phase9Label(value)}</option>)}</select></label>}
    </div>}
    {loading ? <div className="p-6"><SkeletonPage /></div> : error ? <ErrorState retry={retry} /> : !rows?.length ? <EmptyState icon={BookOpen} title={`No ${title.toLowerCase()} here yet`} description={empty} action={action} /> : <div className="divide-y divide-[hsl(var(--border)/.7)]">{rows.map(row => <div key={row.id} data-testid={`row-${index}-${row.id}`} className="p-4 transition-colors hover:bg-[hsl(var(--secondary)/.25)] md:px-7">{render(row)}</div>)}</div>}
  </section>;
}

export type FormField = { key: string; label: string; type?: 'text' | 'number' | 'date' | 'textarea' | 'select' | 'checkbox'; required?: boolean; options?: { value: string; label: string }[]; placeholder?: string; min?: number; max?: number };
export function RecordDialog({ title, fields, values, onClose, onSave, pending, error, footer }: { title: string; fields: FormField[]; values: Record<string, string | number | boolean | null | undefined>; onClose: () => void; onSave: (values: Record<string, string | number | boolean | null>) => Promise<void>; pending: boolean; error: string; footer?: ReactNode }) {
  const [form, setForm] = useState<Record<string, string | number | boolean | null>>(() => Object.fromEntries(fields.map(field => [field.key, values[field.key] ?? (field.type === 'checkbox' ? false : '')])));
  const submit = (event: FormEvent) => { event.preventDefault(); void onSave(form); };
  return <Modal title={title} eyebrow="School workspace" onClose={onClose}><form className="space-y-4" onSubmit={submit}>
    {fields.map(field => <Field key={field.key} label={field.label}>
      {field.type === 'textarea' ? <textarea data-testid={`input-${field.key}`} className={`${phase9Input} min-h-24 resize-y`} required={field.required} value={String(form[field.key] ?? '')} placeholder={field.placeholder} onChange={event => setForm({ ...form, [field.key]: event.target.value })} /> :
      field.type === 'select' ? <select data-testid={`select-${field.key}`} className={phase9Input} required={field.required} value={String(form[field.key] ?? '')} onChange={event => setForm({ ...form, [field.key]: event.target.value })}><option value="">Select {field.label.toLowerCase()}</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> :
      field.type === 'checkbox' ? <input data-testid={`checkbox-${field.key}`} type="checkbox" checked={Boolean(form[field.key])} onChange={event => setForm({ ...form, [field.key]: event.target.checked })} className="h-5 w-5 accent-[hsl(var(--primary))]" /> :
      <input data-testid={`input-${field.key}`} type={field.type || 'text'} className={phase9Input} min={field.min} max={field.max} required={field.required} value={String(form[field.key] ?? '')} placeholder={field.placeholder} onChange={event => setForm({ ...form, [field.key]: event.target.value })} />}
    </Field>)}
    {footer}
    {error && <p role="alert" className="text-sm font-semibold text-[hsl(var(--destructive))]">{error}</p>}
    <div className="flex justify-end gap-2 pt-3"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? 'Saving...' : 'Save changes'}</Button></div>
  </form></Modal>;
}

export function StatusLine({ value, detail }: { value: string; detail?: string | number | null }) {
  return <div className="flex flex-wrap items-center gap-2">{value === 'OVERDUE' ? <span className="rounded-full bg-[hsl(var(--destructive)/.12)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--destructive))]">Overdue</span> : <StatusPill value={phase9Label(value)} />}{detail !== null && detail !== undefined && detail !== '' && <span className="text-xs text-[hsl(var(--muted-foreground))]">{detail}</span>}</div>;
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button onClick={onClick}><Plus size={16} />{label}</Button>;
}