import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Calendar, Plus, Pencil, Check } from 'lucide-react';
import { 
  useListAcademicSessions, useCreateAcademicSession, useUpdateAcademicSession, getListAcademicSessionsQueryKey,
  useListAcademicTerms, useCreateAcademicTerm, useUpdateAcademicTerm, getListAcademicTermsQueryKey
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, TenantPicker, useTenant, cx, date
} from '@/components/shared';

export function AcademicsPage() {
  const { schoolId, setSchoolId } = useTenant();
  const [sessionModal, setSessionModal] = useState<any>(null); 
  const [termModal, setTermModal] = useState<any>(null); 
  
  const qc = useQueryClient();
  
  const sessionsQuery = useListAcademicSessions({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListAcademicSessionsQueryKey({ schoolId }) } }); 
  const sessions: any[] = sessionsQuery.data ?? [];
  const activeSession = sessions.find(s => s.isCurrent);

  const termsQuery = useListAcademicTerms(activeSession?.id as number, { schoolId }, { query: { enabled: !!(schoolId && activeSession?.id), queryKey: getListAcademicTermsQueryKey(activeSession?.id as number, { schoolId }) } }); 
  const terms: any[] = termsQuery.data ?? [];

  const doneSession = () => { 
    setSessionModal(null); 
    qc.invalidateQueries({ queryKey: getListAcademicSessionsQueryKey() }); 
  };

  const doneTerm = () => { 
    setTermModal(null); 
    if (activeSession?.id) {
      qc.invalidateQueries({ queryKey: getListAcademicTermsQueryKey(activeSession.id, { schoolId }) }); 
    }
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
            <Button onClick={() => setSessionModal({ create: true })} disabled={!schoolId}>
              <Plus size={16} />New Session
            </Button>
          </div>
        } 
      />
      
      {!schoolId ? (
        <EmptyState 
          icon={Calendar} 
          title="Select a school context" 
          description="You must select a school to manage its academic structure." 
        />
      ) : sessionsQuery.isLoading || termsQuery.isLoading ? (
        <SkeletonPage />
      ) : sessionsQuery.isError || termsQuery.isError ? (
        <ErrorState retry={() => { sessionsQuery.refetch(); termsQuery.refetch(); }} />
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
                      <button onClick={() => setSessionModal(session)} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors p-2">
                        <Pencil size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Calendar} title="No sessions defined" description="Create an academic session to begin operations." />
            )}
          </div>

          {/* Terms Panel */}
          <div className={cx("panel overflow-hidden transition-opacity", !activeSession && "opacity-50 pointer-events-none")}>
            <div className="border-b border-[hsl(var(--border))] px-6 py-5 flex items-center justify-between">
              <div>
                <h3 className="display-font text-xl font-bold">Terms & Periods</h3>
                <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
                  {activeSession ? `For ${activeSession.name}` : 'Requires an active session'}
                </p>
              </div>
              <Button variant="outline" onClick={() => setTermModal({ create: true })} disabled={!activeSession}>
                <Plus size={14} />Add term
              </Button>
            </div>
            
            {terms.length && activeSession ? (
              <div className="divide-y divide-[hsl(var(--border)/.6)] p-2">
                {terms.map((term: any) => (
                  <div key={term.id} className="flex items-center justify-between rounded-xl px-4 py-3.5 hover:bg-[hsl(var(--muted)/.3)] transition-colors">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-sm capitalize">{term.name} Term</span>
                        {term.isCurrent && <span className="bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider"><Check size={10} /> Active</span>}
                      </div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1.5 font-medium">
                        {date(term.startDate)} — {date(term.endDate)}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <StatusPill value={term.status} />
                      <button onClick={() => setTermModal(term)} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors p-2">
                        <Pencil size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
                No terms configured for this session.
              </div>
            )}
          </div>

          {sessionModal && (
            <Modal title={sessionModal.create ? 'Create Session' : 'Edit Session'} eyebrow="Academic Calendar" onClose={() => setSessionModal(null)}>
              <SessionForm schoolId={schoolId} initial={sessionModal.create ? undefined : sessionModal} onDone={doneSession} onCancel={() => setSessionModal(null)} />
            </Modal>
          )}

          {termModal && (
            <Modal title={termModal.create ? 'Create Term' : 'Edit Term'} eyebrow={`For ${activeSession?.name}`} onClose={() => setTermModal(null)}>
              <TermForm schoolId={schoolId} sessionId={activeSession?.id} initial={termModal.create ? undefined : termModal} onDone={doneTerm} onCancel={() => setTermModal(null)} />
            </Modal>
          )}
        </div>
      )}
    </div>
  );
}

function SessionForm({ schoolId, initial, onDone, onCancel }: { schoolId: number; initial?: any; onDone: () => void; onCancel: () => void }) {
  const create = useCreateAcademicSession(); 
  const update = useUpdateAcademicSession(); 
  
  const [form, setForm] = useState({ 
    name: initial?.name ?? '', 
    startDate: initial?.startDate ? new Date(initial.startDate).toISOString().split('T')[0] : '', 
    endDate: initial?.endDate ? new Date(initial.endDate).toISOString().split('T')[0] : '', 
    status: initial?.status ?? 'ACTIVE',
    isCurrent: initial?.isCurrent ?? false
  });
  
  const save = (e: FormEvent) => { 
    e.preventDefault(); 
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
      <Field label="Session Name">
        <input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. 2023/2024 Academic Session" />
      </Field>
      
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
      {(create.isError || update.isError) && <p className="text-sm font-medium text-[hsl(var(--destructive))]">Could not save this record.</p>}
    </form>
  );
}

function TermForm({ schoolId, sessionId, initial, onDone, onCancel }: { schoolId: number; sessionId: number; initial?: any; onDone: () => void; onCancel: () => void }) {
  const create = useCreateAcademicTerm(); 
  const update = useUpdateAcademicTerm(); 
  
  const [form, setForm] = useState({ 
    name: initial?.name ?? 'FIRST', 
    startDate: initial?.startDate ? new Date(initial.startDate).toISOString().split('T')[0] : '', 
    endDate: initial?.endDate ? new Date(initial.endDate).toISOString().split('T')[0] : '', 
    status: initial?.status ?? 'ACTIVE',
    isCurrent: initial?.isCurrent ?? false
  });
  
  const save = (e: FormEvent) => { 
    e.preventDefault(); 
    const data: any = { ...form, startDate: new Date(form.startDate).toISOString(), endDate: new Date(form.endDate).toISOString() };
    if (initial) {
      update.mutate({ termId: initial.id, params: { schoolId }, data }, { onSuccess: onDone }); 
    } else {
      create.mutate({ sessionId, params: { schoolId }, data }, { onSuccess: onDone }); 
    }
  };
  
  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={save} className="space-y-5">
      <Field label="Term Name">
        <select required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}>
          <option value="FIRST">First Term</option>
          <option value="SECOND">Second Term</option>
          <option value="THIRD">Third Term</option>
        </select>
      </Field>
      
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
          <span className="text-sm font-bold">Mark as Current Term</span>
        </label>
      </div>

      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save changes' : 'Create term'}</Button>
      </div>
      {(create.isError || update.isError) && <p className="text-sm font-medium text-[hsl(var(--destructive))]">Could not save this record.</p>}
    </form>
  );
}