import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AcademicTerm, CalendarDateItem, CalendarTermConfiguration, GenerateSchoolCalendarBody } from '@workspace/api-client-react';
import { Button, Field } from '@/components/shared';
import { Notice, isValidRange } from '@/components/school-ops-kit';

type ListKey = 'midTermBreaks' | 'holidays' | 'examinations' | 'resultPublicationDates';
const LISTS: Array<{ key: ListKey; label: string }> = [
  { key: 'midTermBreaks', label: 'Mid-term break' },
  { key: 'holidays', label: 'Holidays' },
  { key: 'examinations', label: 'Examinations' },
  { key: 'resultPublicationDates', label: 'Results publication' },
];
type Draft = { resumptionDate: string } & Record<ListKey, Array<{ title: string; startDate: string; endDate: string }>>;
const empty = (): Draft => ({ resumptionDate: '', midTermBreaks: [], holidays: [], examinations: [], resultPublicationDates: [] });

export function buildGenerateBody(sessionId: number, terms: AcademicTerm[], drafts: Record<number, Draft>): { body?: GenerateSchoolCalendarBody; error?: string } {
  const out: CalendarTermConfiguration[] = [];
  for (const t of terms) {
    const d = drafts[t.id] ?? empty();
    const cfg: CalendarTermConfiguration = { termId: t.id, resumptionDate: d.resumptionDate || null };
    if (d.resumptionDate && !isValidRange(d.resumptionDate)) return { error: 'Enter a valid resumption date.' };
    for (const { key, label } of LISTS) {
      const items: CalendarDateItem[] = [];
      for (const it of d[key]) {
        if (!it.title.trim() || !isValidRange(it.startDate, it.endDate || null)) return { error: `${label}: every row needs a title and a valid date range.` };
        items.push({ title: it.title.trim(), startDate: it.startDate, endDate: it.endDate || null });
      }
      cfg[key] = items;
    }
    out.push(cfg);
  }
  return { body: { sessionId, terms: out } };
}

export function CalendarGenerator({ sessionId, terms, pending, error, onSubmit, onCancel }: {
  sessionId: number; terms: AcademicTerm[]; pending: boolean; error?: string; onSubmit: (b: GenerateSchoolCalendarBody) => void; onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [localError, setLocalError] = useState('');
  const get = (id: number) => drafts[id] ?? empty();
  const patch = (id: number, fn: (d: Draft) => Draft) => setDrafts(s => ({ ...s, [id]: fn(s[id] ?? empty()) }));
  const submit = () => {
    const r = buildGenerateBody(sessionId, terms, drafts);
    if (r.error) return setLocalError(r.error);
    setLocalError(''); onSubmit(r.body!);
  };
  return (
    <div className="space-y-6">
      <Notice>Regenerating updates this session&apos;s generated entries in place. It never duplicates them, and custom events you created are untouched.</Notice>
      {terms.map(t => (
        <fieldset key={t.id} className="rounded-2xl border border-[hsl(var(--border))] p-4">
          <legend className="px-2 text-sm font-bold">{t.name[0] + t.name.slice(1).toLowerCase()} term</legend>
          <Field label="Resumption date">
            <input type="date" value={get(t.id).resumptionDate} onChange={e => patch(t.id, d => ({ ...d, resumptionDate: e.target.value }))} data-testid={`input-resumption-${t.id}`} />
          </Field>
          {LISTS.map(({ key, label }) => (
            <div key={key} className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="eyebrow">{label}</span>
                <Button variant="quiet" className="!px-2 !py-1" onClick={() => patch(t.id, d => ({ ...d, [key]: [...d[key], { title: '', startDate: '', endDate: '' }] }))}><Plus size={13} />Add</Button>
              </div>
              {get(t.id)[key].map((it, i) => (
                <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
                  <input aria-label={`${label} title`} placeholder="Title" value={it.title} onChange={e => patch(t.id, d => ({ ...d, [key]: d[key].map((x, j) => j === i ? { ...x, title: e.target.value } : x) }))} />
                  <input aria-label={`${label} start`} type="date" value={it.startDate} onChange={e => patch(t.id, d => ({ ...d, [key]: d[key].map((x, j) => j === i ? { ...x, startDate: e.target.value } : x) }))} />
                  <input aria-label={`${label} end`} type="date" value={it.endDate} onChange={e => patch(t.id, d => ({ ...d, [key]: d[key].map((x, j) => j === i ? { ...x, endDate: e.target.value } : x) }))} />
                  <Button variant="quiet" onClick={() => patch(t.id, d => ({ ...d, [key]: d[key].filter((_, j) => j !== i) }))}><Trash2 size={14} /><span className="sr-only">Remove row</span></Button>
                </div>
              ))}
            </div>
          ))}
        </fieldset>
      ))}
      {(localError || error) && <Notice tone="error">{localError || error}</Notice>}
      <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-5">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={pending || terms.length === 0} testId="button-generate-submit">{pending ? 'Generating…' : 'Generate calendar'}</Button>
      </div>
    </div>
  );
}
