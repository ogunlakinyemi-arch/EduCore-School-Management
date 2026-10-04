import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Pencil, Plus, Wand2 } from 'lucide-react';
import {
  useListSchoolAcademicCalendar, getListSchoolAcademicCalendarQueryKey, useCreateSchoolCalendarEvent,
  useGenerateSchoolAcademicCalendar, useUpdateSchoolCalendarEvent, useListAcademicSessions, useListAcademicTerms,
  type SchoolCalendarEntry, type CreateSchoolCalendarEventBody,
} from '@workspace/api-client-react';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Modal, Field, TenantPicker } from '@/components/shared';
import { FRESH, Notice, errMsg, fmtDay, isValidRange, useSchoolRole } from '@/components/school-ops-kit';
import { TermsManager, invalidatePeriodQueries } from '@/pages/academics';
import { CalendarGenerator } from '@/components/calendar-generator';

type Category = CreateSchoolCalendarEventBody['category'];
type Audience = CreateSchoolCalendarEventBody['audience'][number];
const CATEGORIES: Category[] = ['RESUMPTION', 'MID_TERM_BREAK', 'HOLIDAY', 'EXAMINATION', 'RESULT_PUBLICATION', 'SCHOOL_EVENT', 'OTHER'];
const AUDIENCES: Audience[] = ['TEACHER', 'STUDENT', 'PARENT', 'STAFF'];
const pretty = (v: string) => v.replaceAll('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());

export function AcademicCalendarPage() {
  const role = useSchoolRole();
  const { schoolId, canManage, canRead } = role;
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState(0);
  const [modal, setModal] = useState<null | 'generate' | { entry?: SchoolCalendarEntry }>(null);
  const [done, setDone] = useState('');

  const sessionsQ = useListAcademicSessions({ schoolId }, { query: { enabled: canManage, queryKey: ['sessions-cal', schoolId], ...FRESH } });
  const sessions = sessionsQ.data ?? [];
  const activeSession = sessionId || sessions.find(s => s.isCurrent)?.id || 0;
  const termsQ = useListAcademicTerms(activeSession, { schoolId }, { query: { enabled: canManage && !!activeSession, queryKey: ['terms-cal', schoolId, activeSession], ...FRESH } });
  const params = activeSession ? { sessionId: activeSession } : undefined;
  const q = useListSchoolAcademicCalendar(schoolId, params, { query: { enabled: canRead, queryKey: getListSchoolAcademicCalendarQueryKey(schoolId, params), ...FRESH } });
  const entries = q.data ?? [];
  const readerSessions = useMemo(() => {
    const m = new Map<number, string>();
    entries.forEach(e => { if (e.sessionId && e.sessionName) m.set(e.sessionId, e.sessionName); });
    return [...m.entries()].map(([id, name]) => ({ id, name, isCurrent: false }));
  }, [entries]);
  const sessionChoices = canManage ? sessions : readerSessions;

  const grouped = useMemo(() => {
    const m = new Map<string, SchoolCalendarEntry[]>();
    [...entries].sort((a, b) => a.startDate.localeCompare(b.startDate)).forEach(e => {
      const k = e.startDate.slice(0, 7); m.set(k, [...(m.get(k) ?? []), e]);
    });
    return [...m.entries()];
  }, [entries]);

  const finish = (msg: string) => {
    setModal(null); setDone(msg);
    qc.invalidateQueries({ queryKey: getListSchoolAcademicCalendarQueryKey(schoolId) });
    invalidatePeriodQueries(qc);
  };

  const create = useCreateSchoolCalendarEvent();
  const update = useUpdateSchoolCalendarEvent();
  const generate = useGenerateSchoolAcademicCalendar();
  const sessionTerms = (termsQ.data ?? []);

  return (
    <div className="fade-up">
      <PageHeading eyebrow="Academics / Calendar" title="Academic calendar." description="Terms, breaks, examinations and school events for the selected school."
        action={<div className="flex flex-wrap items-center gap-3"><TenantPicker />
          {canManage && <>
            <Button variant="outline" disabled={!activeSession} onClick={() => { generate.reset(); setModal('generate'); }} testId="button-generate-calendar"><Wand2 size={15} />Generate</Button>
            <Button onClick={() => { create.reset(); update.reset(); setModal({}); }} testId="button-add-event"><Plus size={16} />Add event</Button>
          </>}
        </div>} />
      {done && <div className="mb-5"><Notice tone="success">{done}</Notice></div>}
      {role.loading ? <SkeletonPage /> : !schoolId || !canRead ? (
        <EmptyState icon={CalendarDays} title="No school calendar available" description="Select a school you belong to in order to see its calendar." />
      ) : q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error, 'The calendar could not be loaded.')} /> : (
        <>
          {canManage && sessionsQ.isError && <div className="mb-4"><Notice tone="error">Session list could not be loaded; showing the full calendar.</Notice></div>}
          {sessionChoices.length > 0 && (
            <div className="panel mb-6 flex items-center gap-3 p-4">
              <label className="text-xs font-bold text-[hsl(var(--muted-foreground))]" htmlFor="cal-session">Session</label>
              <select id="cal-session" className="max-w-xs" value={sessionId} onChange={e => setSessionId(Number(e.target.value))}>
                <option value={0}>{canManage ? 'Current session' : 'All sessions'}</option>
                {sessionChoices.map(s => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? ' (current)' : ''}</option>)}
              </select>
            </div>
          )}
          {canManage && <div className="mb-6"><TermsManager schoolId={schoolId} sessions={sessions} sessionId={activeSession || undefined} onPick={setSessionId} canManage={canManage} /></div>}
          {grouped.length === 0 ? (
            <div className="panel"><EmptyState icon={CalendarDays} title="Nothing scheduled" description="No calendar entries exist for this session yet."
              action={canManage && activeSession ? <Button onClick={() => setModal('generate')}><Wand2 size={15} />Generate calendar</Button> : undefined} /></div>
          ) : grouped.map(([month, list]) => (
            <section key={month} className="mb-6">
              <h2 className="eyebrow mb-3">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2>
              <div className="panel divide-y divide-[hsl(var(--border)/.6)] overflow-hidden">
                {list.map(e => (
                  <div key={e.id} className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-center">
                    <div className="w-48 shrink-0 font-mono text-xs">{fmtDay(e.startDate)}{e.endDate && e.endDate !== e.startDate ? ` – ${fmtDay(e.endDate)}` : ''}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold">{e.title}</div>
                      <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{pretty(e.category)}{e.termName ? ` · ${pretty(e.termName)} term` : ''} · {e.academic ? 'Academic' : 'Non-academic'} · {e.audience.map(pretty).join(', ')}</div>
                      {e.notes && <div className="mt-1 text-xs">{e.notes}</div>}
                    </div>
                    <StatusPill value={e.status} />
                    {canManage && e.source === 'SCHOOL_EVENT' && (
                      <Button variant="quiet" onClick={() => { update.reset(); setModal({ entry: e }); }} testId={`button-edit-event-${e.id}`}><Pencil size={14} />Edit</Button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
      {canManage && modal === 'generate' && (
        <Modal title="Generate calendar" eyebrow="Session terms" onClose={() => setModal(null)}>
          {termsQ.isLoading ? <SkeletonPage /> : termsQ.isError ? <ErrorState retry={() => termsQ.refetch()} /> : (
            <CalendarGenerator sessionId={activeSession} terms={sessionTerms} pending={generate.isPending} error={generate.isError ? errMsg(generate.error) : undefined}
              onCancel={() => setModal(null)} onSubmit={body => generate.mutate({ schoolId, data: body }, { onSuccess: () => finish('Calendar generated without duplicates.') })} />
          )}
        </Modal>
      )}
      {canManage && modal && typeof modal === 'object' && (
        <Modal title={modal.entry ? 'Edit event' : 'Add event'} eyebrow="Custom event" onClose={() => setModal(null)}>
          <EventForm key={modal.entry?.id ?? 'new'} initial={modal.entry} pending={create.isPending || update.isPending}
            error={create.isError ? errMsg(create.error) : update.isError ? errMsg(update.error) : undefined}
            terms={sessionTerms.map(t => ({ id: t.id, label: pretty(t.name) }))} onCancel={() => setModal(null)}
            onSubmit={(data, status) => modal.entry
              ? update.mutate({ schoolId, eventId: Number(modal.entry.id), data: { ...data, status } }, { onSuccess: () => finish('Event updated.') })
              : create.mutate({ schoolId, data }, { onSuccess: () => finish('Event added.') })} />
        </Modal>
      )}
    </div>
  );
}

function EventForm({ initial, terms, pending, error, onSubmit, onCancel }: {
  initial?: SchoolCalendarEntry; terms: Array<{ id: number; label: string }>; pending: boolean; error?: string;
  onSubmit: (d: CreateSchoolCalendarEventBody, status: 'ACTIVE' | 'INACTIVE') => void; onCancel: () => void;
}) {
  const [f, setF] = useState({
    title: initial?.title ?? '', category: (initial?.category && initial.category !== 'TERM_START' && initial.category !== 'TERM_END' ? initial.category : 'SCHOOL_EVENT') as Category,
    startDate: initial?.startDate.slice(0, 10) ?? '', endDate: initial?.endDate?.slice(0, 10) ?? '', academic: initial?.academic ?? false,
    audience: (initial?.audience ?? ['TEACHER', 'STUDENT', 'PARENT', 'STAFF']) as Audience[], notes: initial?.notes ?? '',
    termId: initial?.termId ?? null as number | null, status: (initial?.status ?? 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
  });
  const [err, setErr] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isValidRange(f.startDate, f.endDate || null)) return setErr('Enter valid dates; the end date cannot precede the start.');
    if (f.audience.length === 0) return setErr('Choose at least one audience.');
    setErr('');
    onSubmit({ title: f.title.trim(), category: f.category, startDate: f.startDate, endDate: f.endDate || null, academic: f.academic, audience: f.audience, notes: f.notes.trim() || null, termId: f.termId }, f.status);
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Title"><input required maxLength={180} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Category"><select value={f.category} onChange={e => setF({ ...f, category: e.target.value as Category })}>{CATEGORIES.map(c => <option key={c} value={c}>{pretty(c)}</option>)}</select></Field>
        <Field label="Term"><select value={f.termId ?? ''} onChange={e => setF({ ...f, termId: e.target.value ? Number(e.target.value) : null })}><option value="">No term</option>{terms.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        <Field label="Starts"><input required type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="Ends (optional)"><input type="date" value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.academic} onChange={e => setF({ ...f, academic: e.target.checked })} className="!w-auto" />Academic day (classes affected)</label>
      <fieldset><legend className="mb-1.5 text-xs font-bold text-[hsl(var(--muted-foreground))]">Audience</legend>
        <div className="flex flex-wrap gap-4">{AUDIENCES.map(a => (
          <label key={a} className="flex items-center gap-2 text-sm"><input type="checkbox" className="!w-auto" checked={f.audience.includes(a)} onChange={e => setF({ ...f, audience: e.target.checked ? [...f.audience, a] : f.audience.filter(x => x !== a) })} />{pretty(a)}</label>
        ))}</div></fieldset>
      <Field label="Notes"><textarea maxLength={2000} rows={3} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      {initial && <Field label="Status"><select value={f.status} onChange={e => setF({ ...f, status: e.target.value as 'ACTIVE' | 'INACTIVE' })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></Field>}
      {(err || error) && <Notice tone="error">{err || error}</Notice>}
      <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-5">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending} testId="button-save-event">{pending ? 'Saving…' : initial ? 'Save changes' : 'Add event'}</Button>
      </div>
    </form>
  );
}
