import { useState, type FormEvent } from 'react';
import { Notice, isValidRange, rangesOverlap } from '@/components/school-ops-kit';
import { academicSaveError } from '@/components/academic-save-error';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Calendar, Plus, Pencil, Check } from 'lucide-react';
import { 
  useListAcademicSessions, useCreateAcademicSession, useUpdateAcademicSession, getListAcademicSessionsQueryKey,
  useListAcademicTerms, useCreateAcademicTerm, useUpdateAcademicTerm, getListAcademicTermsQueryKey
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, TenantPicker, useTenant, cx, date, useSchoolAdminAccess
} from '@/components/shared';

export const invalidatePeriodQueries = (qc: QueryClient) => qc.invalidateQueries({
  predicate: q => /session|term|calendar/i.test(String(q.queryKey[0])),
});

/** Returns an error message when the term is not contained within its session. */
export function termContainmentError(term: { startDate: string; endDate: string }, session?: { startDate?: string; endDate?: string } | null) {
  if (!session?.startDate || !session?.endDate) return '';
  const day = (v: string) => String(v).slice(0, 10);
  if (day(term.startDate) < day(session.startDate) || day(term.endDate) > day(session.endDate)) {
    return `Term dates must fall within the session (${day(session.startDate)} to ${day(session.endDate)}).`;
  }
  return '';
}

export function AcademicsPage() {
  const { schoolId, setSchoolId } = useTenant();
  const { canManageSchool } = useSchoolAdminAccess();
  const [sessionModal, setSessionModal] = useState<any>(null); 
  
  const qc = useQueryClient();
  
  const sessionsQuery = useListAcademicSessions({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListAcademicSessionsQueryKey({ schoolId }) } }); 
  const sessions: any[] = sessionsQuery.data ?? [];
  const [pickedSession, setPickedSession] = useState(0);
  const activeSession = sessions.find(s => s.id === pickedSession) ?? sessions.find(s => s.isCurrent) ?? sessions[0];


  const doneSession = () => { 
    setSessionModal(null); 
    invalidatePeriodQueries(qc); 
  };

  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Structure / Academics" 
        title="Academic Calendar." 
        description="Configure sessions, terms, and the current active academic period." 
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
            {canManageSchool && <Button onClick={() => setSessionModal({ create: true })} disabled={!schoolId}>
              <Plus size={16} />New Session
            </Button>}
          </div>
        } 
      />
      
      {!schoolId ? (
        <EmptyState 
          icon={Calendar} 
          title="Select a school context" 
          description="You must select a school to manage its academic structure." 
        />
      ) : sessionsQuery.isLoading ? (
        <SkeletonPage />
      ) : sessionsQuery.isError ? (
        <ErrorState retry={() => { sessionsQuery.refetch(); }} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Sessions Panel */}
          <div className="panel overflow-hidden">
            <div className="border-b border-[hsl(var(--border))] px-6 py-5 flex items-center justify-between">
              <div>
                <h3 className="display-font text-xl font-bold">Academic Sessions</h3>
                <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Manage institutional years</p>
              </div>
            </div>
            
            {sessions.length ? (
              <div className="divide-y divide-[hsl(var(--border)/.6)] p-2">
                {sessions.map((session: any) => (
                  <div key={session.id} className="flex items-center justify-between rounded-xl px-4 py-3.5 hover:bg-[hsl(var(--muted)/.3)] transition-colors">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-sm">{session.name}</span>
                        {session.isCurrent && <span className="bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider"><Check size={10} /> Active</span>}
                      </div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1.5 font-medium">
                        {date(session.startDate)} — {date(session.endDate)}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <StatusPill value={session.status} />
                       {canManageSchool && <Button variant="quiet" onClick={()=>setPickedSession(session.id)}>Manage terms</Button>}
                       {canManageSchool && <button onClick={() => setSessionModal(session)} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors p-2">
                        <Pencil size={15} />
                      </button>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Calendar} title="No sessions defined" description="Create an academic session to begin operations." />
            )}
          </div>

          <TermsManager schoolId={schoolId} sessions={sessions} sessionId={activeSession?.id} onPick={setPickedSession} canManage={canManageSchool} />

          {canManageSchool && sessionModal && (
            <Modal title={sessionModal.create ? 'Create Session' : 'Edit Session'} eyebrow="Academic Calendar" onClose={() => setSessionModal(null)}>
              <SessionForm schoolId={schoolId} initial={sessionModal.create ? undefined : sessionModal} existingSessions={sessions} onUseExisting={id=>{setPickedSession(id);setSessionModal(null);}} onDone={doneSession} onCancel={() => setSessionModal(null)} />
            </Modal>
          )}

        </div>
      )}
    </div>
  );
}

export function SessionForm({ schoolId, initial, existingSessions = [], onUseExisting, onDone, onCancel }: { schoolId: number; initial?: any; existingSessions?: any[]; onUseExisting?: (id:number)=>void; onDone: () => void; onCancel: () => void }) {
  const create = useCreateAcademicSession(); 
  const update = useUpdateAcademicSession(); 
  
  const [form, setForm] = useState({ 
    name: initial?.name ?? '', 
    startDate: initial?.startDate ? new Date(initial.startDate).toISOString().split('T')[0] : '', 
    endDate: initial?.endDate ? new Date(initial.endDate).toISOString().split('T')[0] : '', 
    status: initial?.status ?? 'ACTIVE',
    isCurrent: initial?.isCurrent ?? false
  });
  
  const matchingSession = !initial ? existingSessions.find(s=>String(s.name).trim().toLowerCase()===form.name.trim().toLowerCase()) : undefined;
  const save = (e: FormEvent) => { 
    e.preventDefault(); 
    if (pending) return;
    if (matchingSession) { onUseExisting?.(matchingSession.id); return; }
    const data: any = { ...form, startDate: new Date(form.startDate).toISOString(), endDate: new Date(form.endDate).toISOString() };
    if (initial) {
      update.mutate({ sessionId: initial.id, params: { schoolId }, data }, { onSuccess: onDone }); 
    } else {
      create.mutate({ params: { schoolId }, data }, { onSuccess: onDone }); 
    }
  };
  
  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={save} className="space-y-5">
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Session dates cover the full academic year, not just First Term. A 2026/2027 session may start in 2026 and end in 2027. Add First, Second and Third Terms inside that full range; do not create another session for a later term.</p>
      <Field label="Session Name">
        <input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. 2023/2024 Academic Session" />
      </Field>
      {matchingSession && <div role="status" className="rounded-xl border border-[hsl(var(--border))] p-3 text-sm">
        {matchingSession.name} already exists. Its terms share the same session; do not recreate it.
        {onUseExisting && <Button type="button" variant="outline" onClick={()=>onUseExisting(matchingSession.id)} testId="button-use-existing-session">Use existing session and manage terms</Button>}
      </div>}
      
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Start Date">
          <input type="date" required value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <Field label="End Date">
          <input type="date" required value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Status">
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </Field>
        <label className="flex items-center gap-3 cursor-pointer mt-7">
          <input type="checkbox" checked={form.isCurrent} onChange={e => setForm({ ...form, isCurrent: e.target.checked })} className="w-5 h-5 rounded text-[hsl(var(--primary))]" />
          <span className="text-sm font-bold">Mark as Current Session</span>
        </label>
      </div>

      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save changes' : 'Create session'}</Button>
      </div>
      {(create.isError || update.isError) && <p role="alert" className="text-sm font-medium text-[hsl(var(--destructive))]">{academicSaveError(create.error || update.error)}</p>}
    </form>
  );
}

export function TermsManager({ schoolId, sessions, sessionId, onPick, canManage }: { schoolId: number; sessions: any[]; sessionId?: number; onPick: (id: number) => void; canManage: boolean }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState<any>(null);
  const q = useListAcademicTerms(sessionId as number, { schoolId }, { query: { enabled: !!(schoolId && sessionId), queryKey: getListAcademicTermsQueryKey(sessionId as number, { schoolId }) } });
  const terms: any[] = q.data ?? [];
  const session = sessions.find(s => s.id === sessionId);
  const [sessionModal, setSessionModal] = useState<'create'|'edit'|null>(null);
  const done = () => { setModal(null); invalidatePeriodQueries(qc); };
  return (
    <div className="panel overflow-hidden" data-testid="panel-terms">
      <div className="border-b border-[hsl(var(--border))] px-6 py-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="display-font text-xl font-bold">Terms & Periods</h3>
          <select aria-label="Term session" className="mt-2 max-w-xs" value={sessionId ?? ''} onChange={e => onPick(Number(e.target.value))} disabled={!sessions.length}>
            {sessions.map(s => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? ' (current)' : ''}</option>)}
          </select>
           {session && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]" data-testid="text-full-session-range">Full academic session: {date(session.startDate)} — {date(session.endDate)}. All term dates must fit inside this range.</p>}
        </div>
        {canManage && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!session} onClick={() => setSessionModal('edit')} testId="button-edit-session-dates"><Pencil size={14} />Edit session dates</Button>
        <Button variant="outline" onClick={() => setSessionModal('create')} testId="button-new-session"><Plus size={14} />New session</Button>
        <Button variant="outline" onClick={() => setModal({ create: true })} disabled={!sessionId}><Plus size={14} />Add term</Button></div>}
      </div>
      {!sessionId ? <div className="p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">Create a session first.</div>
        : q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => q.refetch()} /> : terms.length ? (
        <div className="divide-y divide-[hsl(var(--border)/.6)] p-2">
          {terms.map((term: any) => (
            <div key={term.id} className="flex items-center justify-between rounded-xl px-4 py-3.5 hover:bg-[hsl(var(--muted)/.3)]">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="font-bold text-sm capitalize">{String(term.name).toLowerCase()} Term</span>
                  {term.isCurrent && <span className="bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">Current</span>}
                </div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1.5 font-medium">{date(term.startDate)} — {date(term.endDate)}</div>
                {(term.createdByName || term.createdAt) && <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">Created{term.createdByName ? ` by ${term.createdByName}` : ''}{term.createdAt ? ` on ${date(term.createdAt)}` : ''}</div>}
                {term.overlapReason && <div className="text-[11px] mt-1">Overlap reason: {term.overlapReason}</div>}
              </div>
              <div className="flex items-center gap-4">
                <StatusPill value={term.status} />
                {canManage && <button aria-label={`Edit ${term.name} term`} onClick={() => setModal(term)} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] p-2"><Pencil size={15} /></button>}
              </div>
            </div>
          ))}
        </div>
      ) : <div className="p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">No terms configured for this session.</div>}
      {canManage && sessionModal && (
        <Modal title={sessionModal==='edit'?'Edit Session':'Create Session'} eyebrow="Academic Calendar" onClose={() => setSessionModal(null)}>
          <SessionForm key={`${sessionModal}:${schoolId}:${session?.id??0}`} schoolId={schoolId} initial={sessionModal==='edit'?session:undefined} existingSessions={sessions} onDone={() => { setSessionModal(null); invalidatePeriodQueries(qc); }} onCancel={() => setSessionModal(null)} />
        </Modal>
      )}
      {canManage && modal && sessionId && (
        <Modal title={modal.create ? 'Create Term' : 'Edit Term'} eyebrow={`For ${session?.name ?? ''}`} onClose={() => setModal(null)}>
          <TermForm schoolId={schoolId} sessionId={sessionId} existing={terms} session={session} initial={modal.create ? undefined : modal} onDone={done} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </div>
  );
}

export function TermForm({ schoolId, sessionId, existing = [], session, initial, onDone, onCancel }: { schoolId: number; sessionId: number; existing?: any[]; session?: any; initial?: any; onDone: () => void; onCancel: () => void }) {
  const create = useCreateAcademicTerm();
  const update = useUpdateAcademicTerm();
  const day = (v?: string) => v ? String(v).slice(0, 10) : '';
  const [form, setForm] = useState({
    name: initial?.name ?? ['FIRST','SECOND','THIRD'].find(name=>!existing.some(t=>t.name===name)) ?? 'FIRST',
    startDate: day(initial?.startDate), endDate: day(initial?.endDate),
    status: initial?.status ?? 'ACTIVE', isCurrent: initial?.isCurrent ?? false,
  });
  const [allowOverlap, setAllowOverlap] = useState(false);
  const [overlapReason, setOverlapReason] = useState('');
  const [err, setErr] = useState('');
  const validRange = isValidRange(form.startDate, form.endDate);
  const overlaps = validRange ? existing.filter(t => t.id !== initial?.id && rangesOverlap({ startDate: day(t.startDate), endDate: day(t.endDate) }, form)) : [];
  const save = (e: FormEvent) => {
    e.preventDefault();
    if(existing.some(t=>t.id!==initial?.id&&t.name===form.name)) return setErr('This term already exists in this academic session. Edit the existing term instead.');
    if (!validRange) return setErr('Enter valid dates; the end date cannot precede the start date.');
    const contain = termContainmentError(form, session);
    if (contain) return setErr(contain);
    if (overlaps.length && (!allowOverlap || !overlapReason.trim())) return setErr('These dates overlap another term. Tick the confirmation and give a reason, or change the dates.');
    setErr('');
    const confirmed = overlaps.length > 0 && allowOverlap;
    const data: any = { ...form, startDate: new Date(form.startDate).toISOString(), endDate: new Date(form.endDate).toISOString(), allowOverlap: confirmed, overlapReason: confirmed ? overlapReason.trim() : null };
    if (initial) update.mutate({ termId: initial.id, params: { schoolId }, data }, { onSuccess: onDone });
    else create.mutate({ sessionId, params: { schoolId }, data }, { onSuccess: onDone });
  };
  const pending = create.isPending || update.isPending;
  const apiErr = create.isError ? academicSaveError(create.error) : update.isError ? academicSaveError(update.error) : '';
  return (
    <form onSubmit={save} className="space-y-5">
      <Field label="Term Name">
        <select required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}>
          {(['FIRST','SECOND','THIRD'] as const).map(name=><option key={name} value={name} disabled={existing.some(t=>t.id!==initial?.id&&t.name===name)}>{name==='FIRST'?'First Term':name==='SECOND'?'Second Term':'Third Term'}</option>)}
        </select>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Start Date"><input type="date" required value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></Field>
        <Field label="End Date"><input type="date" required value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Status">
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="COMPLETED">Completed</option>
          </select>
        </Field>
        <label className="flex items-center gap-3 cursor-pointer mt-7">
          <input type="checkbox" checked={form.isCurrent} onChange={e => setForm({ ...form, isCurrent: e.target.checked })} className="w-5 h-5 rounded" />
          <span className="text-sm font-bold">Mark as Current Term</span>
        </label>
      </div>
      {overlaps.length > 0 && (
        <div className="space-y-3 rounded-xl border border-[hsl(var(--destructive)/.3)] p-4">
          <p className="text-sm font-semibold">Overlaps: {overlaps.map(t => `${String(t.name).toLowerCase()} term`).join(', ')}.</p>
          <label className="flex items-center gap-3 text-sm font-bold">
            <input type="checkbox" aria-label="Allow overlapping term dates" checked={allowOverlap} onChange={e => setAllowOverlap(e.target.checked)} className="w-5 h-5" />
            I confirm these term dates may overlap
          </label>
          <Field label="Overlap reason"><input aria-label="Overlap reason" value={overlapReason} onChange={e => setOverlapReason(e.target.value)} disabled={!allowOverlap} /></Field>
        </div>
      )}
      {(err || apiErr) && <Notice tone="error">{err || apiErr}</Notice>}
      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save changes' : 'Create term'}</Button>
      </div>
    </form>
  );
}
