import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Pencil, Plus } from 'lucide-react';
import {
  useListSchoolTeacherDuty, getListSchoolTeacherDutyQueryKey, useCreateSchoolTeacherDuty, useUpdateSchoolTeacherDuty,
  useListEmployees, type TeacherDuty,
} from '@workspace/api-client-react';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Modal, Field, TenantPicker } from '@/components/shared';
import { FRESH, Notice, SearchSelect, errMsg, fmtDay, isValidRange, rangesOverlap, todayIso, useSchoolRole } from '@/components/school-ops-kit';

type Filter = 'ACTIVE' | 'INACTIVE' | 'all';
export type DutyView = 'current' | 'upcoming' | 'history' | 'all';
type DutyLike = { startDate: string; endDate: string; status: string };

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
/** Exact classification: history = ended before today OR inactive. */
export function classifyDuty(d: DutyLike, today: string): Exclude<DutyView, 'all'> {
  if (d.status !== 'ACTIVE' || d.endDate.slice(0, 10) < today) return 'history';
  if (d.startDate.slice(0, 10) > today) return 'upcoming';
  return 'current';
}
/** API param sets per view. History needs two queries so inactive rows with later end dates are not lost. */
export function dutyViewParams(view: DutyView, today: string, filter: Filter = 'ACTIVE') {
  if (view === 'current') return [{ status: 'ACTIVE' as Filter }];
  if (view === 'upcoming') return [{ status: 'ACTIVE' as Filter, startsOnOrAfter: addDays(today, 1) }];
  if (view === 'history') return [{ status: 'all' as Filter, endsOnOrBefore: addDays(today, -1) }, { status: 'INACTIVE' as Filter }];
  return [{ status: filter }];
}

export function TeacherDutyPage() {
  const role = useSchoolRole();
  const { schoolId, canManage, canRead } = role;
  const qc = useQueryClient();
  const [status, setStatus] = useState<Filter>('ACTIVE');
  const [view, setView] = useState<DutyView>(canManage ? 'all' : 'current');
  const today = todayIso();
  const [modal, setModal] = useState<null | { duty?: TeacherDuty }>(null);
  const [done, setDone] = useState('');
  const [p1, p2] = dutyViewParams(view, today, status);
  const q1 = useListSchoolTeacherDuty(schoolId, p1, { query: { enabled: canRead, queryKey: getListSchoolTeacherDutyQueryKey(schoolId, p1), ...FRESH } });
  const q2 = useListSchoolTeacherDuty(schoolId, p2 ?? p1, { query: { enabled: canRead && !!p2, queryKey: getListSchoolTeacherDutyQueryKey(schoolId, p2 ?? p1), ...FRESH } });
  const q = { isLoading: q1.isLoading || (!!p2 && q2.isLoading), isError: q1.isError || (!!p2 && q2.isError), error: q1.error ?? q2.error, refetch: () => { q1.refetch(); if (p2) q2.refetch(); } };
  const merged = new Map<number, TeacherDuty>();
  [...(q1.data ?? []), ...(p2 ? q2.data ?? [] : [])].forEach(d => merged.set(d.id, d));
  const all = [...merged.values()];
  const rows = all.filter(d => view === 'all' || classifyDuty(d, today) === view).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const update = useUpdateSchoolTeacherDuty();
  const refresh = () => qc.invalidateQueries({ queryKey: getListSchoolTeacherDutyQueryKey(schoolId) });
  const toggle = (d: TeacherDuty) => {
    setDone('');
    const next = d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    update.mutate({ schoolId, dutyId: d.id, data: { status: next } }, { onSuccess: () => { setDone(`Duty ${next === 'ACTIVE' ? 'reactivated' : 'deactivated'}.`); refresh(); } });
  };

  return (
    <div className="fade-up">
      <PageHeading eyebrow="Academics / Roster" title="Teacher duty." description={canManage ? 'Weekly duty roster: who covers what, and when.' : 'Your own duty roster.'}
        action={<div className="flex items-center gap-3"><TenantPicker />{canManage && <Button onClick={() => setModal({})} testId="button-add-duty"><Plus size={16} />Add duty</Button>}</div>} />
      {done && <div className="mb-5"><Notice tone="success">{done}</Notice></div>}
      {update.isError && <div className="mb-5"><Notice tone="error">{errMsg(update.error)}</Notice></div>}
      {role.loading ? <SkeletonPage /> : !canRead ? (
        <EmptyState icon={ClipboardList} title="Select a school" description="Pick a school you are authorised for to see its duty roster." />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Duty view">
            {(['current', 'upcoming', 'history', 'all'] as DutyView[]).map(v => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v} data-testid={`tab-duty-${v}`}
                className={`rounded-xl px-4 py-2 text-xs font-bold capitalize ${view === v ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--secondary))]'}`}>{v}</button>
            ))}
            {view === 'all' && (['ACTIVE', 'INACTIVE', 'all'] as Filter[]).map(s2 => (
              <button key={s2} onClick={() => setStatus(s2)} aria-pressed={status === s2} className={`ml-2 rounded-xl px-3 py-2 text-xs font-bold capitalize ${status === s2 ? 'underline' : 'opacity-70'}`}>{s2.toLowerCase()}</button>
            ))}
          </div>
          {q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error, 'The roster could not be loaded.')} /> : (
            <div className="panel overflow-hidden">
              {rows.length === 0 ? <EmptyState icon={ClipboardList} title="No duty entries" description={canManage ? 'Add a weekly duty to start the roster.' : 'You have no duty in this view.'} /> : rows.map(d => (
                <div key={d.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-4 last:border-0 md:grid-cols-[1.2fr_1.2fr_1.2fr_auto_auto] md:items-center">
                  <div><div className="text-sm font-bold">{d.employeeName}</div><div className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">{d.employeeNo}</div></div>
                  <div><div className="text-sm font-bold">{d.dutyRole}</div>{d.notes && <div className="text-xs text-[hsl(var(--muted-foreground))]">{d.notes}</div>}</div>
                  <div className="font-mono text-xs">{fmtDay(d.startDate)} – {fmtDay(d.endDate)}</div>
                  <StatusPill value={d.status} />
                  {canManage ? (
                    <div className="flex gap-1">
                      <Button variant="quiet" onClick={() => setModal({ duty: d })} testId={`button-edit-duty-${d.id}`}><Pencil size={14} />Edit</Button>
                      <Button variant="outline" disabled={update.isPending} onClick={() => toggle(d)} testId={`button-toggle-duty-${d.id}`}>{d.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button>
                    </div>
                  ) : <span />}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {canManage && modal && (
        <Modal title={modal.duty ? 'Edit duty' : 'Add duty'} eyebrow="Roster" onClose={() => setModal(null)}>
          <DutyForm schoolId={schoolId} initial={modal.duty} existing={all} onCancel={() => setModal(null)} onDone={m => { setModal(null); setDone(m); refresh(); }} />
        </Modal>
      )}
    </div>
  );
}

function DutyForm({ schoolId, initial, existing, onDone, onCancel }: { schoolId: number; initial?: TeacherDuty; existing: TeacherDuty[]; onDone: (m: string) => void; onCancel: () => void }) {
  const teachersQ = useListEmployees({ schoolId, role: 'TEACHER', status: 'ACTIVE' }, { query: { queryKey: ['duty-teachers', schoolId], ...FRESH } });
  const create = useCreateSchoolTeacherDuty();
  const update = useUpdateSchoolTeacherDuty();
  const [employeeId, setEmployeeId] = useState<number | null>(initial?.employeeId ?? null);
  const [dutyRole, setDutyRole] = useState(initial?.dutyRole ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(initial?.status ?? 'ACTIVE');
  const [err, setErr] = useState('');
  const options = useMemo(() => {
    const list = (teachersQ.data ?? []).map(t => ({ value: t.id, label: `${t.firstName} ${t.lastName}`, hint: t.employeeId }));
    if (initial && !list.some(o => o.value === initial.employeeId)) list.push({ value: initial.employeeId, label: initial.employeeName, hint: initial.employeeNo });
    return list;
  }, [teachersQ.data, initial]);
  const conflict = employeeId && isValidRange(startDate, endDate) ? existing.find(d => d.id !== initial?.id && d.status === 'ACTIVE' && d.employeeId === employeeId && rangesOverlap(d, { startDate, endDate })) : undefined;
  const pending = create.isPending || update.isPending;
  const serverErr = create.isError ? errMsg(create.error) : update.isError ? errMsg(update.error) : '';

  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (!employeeId) return setErr('Choose a teacher.');
    if (!endDate || !isValidRange(startDate, endDate)) return setErr('Enter valid start and end dates; the end cannot precede the start.');
    const base = { employeeId, dutyRole: dutyRole.trim(), startDate, endDate, notes: notes.trim() || null };
    if (initial) update.mutate({ schoolId, dutyId: initial.id, data: { ...base, status } }, { onSuccess: () => onDone('Duty updated.') });
    else create.mutate({ schoolId, data: base }, { onSuccess: () => onDone('Duty added.') });
  };
  if (teachersQ.isError) return <ErrorState retry={() => teachersQ.refetch()} />;
  return (
    <form onSubmit={submit} className="space-y-5">
      <SearchSelect label="Teacher" options={options} value={employeeId} onChange={setEmployeeId} placeholder="Search teachers" testId="select-duty-teacher" />
      <Field label="Duty role"><input required maxLength={120} value={dutyRole} onChange={e => setDutyRole(e.target.value)} placeholder="e.g. Assembly supervisor" /></Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Week starts"><input required type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></Field>
        <Field label="Week ends"><input required type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></Field>
      </div>
      <Field label="Notes"><textarea rows={3} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      {initial && <Field label="Status"><select value={status} onChange={e => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></Field>}
      {conflict && <Notice>This teacher already has active duty ({conflict.dutyRole}) from {fmtDay(conflict.startDate)} to {fmtDay(conflict.endDate)}. The server will reject a true conflict.</Notice>}
      {(err || serverErr) && <Notice tone="error">{err || serverErr}</Notice>}
      <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-5">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending} testId="button-save-duty">{pending ? 'Saving…' : initial ? 'Save changes' : 'Add duty'}</Button>
      </div>
    </form>
  );
}
