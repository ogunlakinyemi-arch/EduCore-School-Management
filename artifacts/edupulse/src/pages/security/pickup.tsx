import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useListSchoolSecurityEvents, getListSchoolSecurityEventsQueryKey, useListStudents, getListStudentsQueryKey, useListSchoolPickupPersons, getListSchoolPickupPersonsQueryKey, useDecideAuthorizedPickupPerson, useListSchoolPickupRequests, getListSchoolPickupRequestsQueryKey, useDecideStudentPickupRequest, useRefuseStudentPickupAtExit, useCompleteStudentPickup, useGetStudentPickupRequestHistory, getGetStudentPickupRequestHistoryQueryKey } from '@workspace/api-client-react';
import type { StudentPickupRequest, ListSchoolPickupRequestsStatus } from '@workspace/api-client-react';
import { Button, EmptyState, Field, Modal, StatusPill } from '@/components/shared';
import { Car } from 'lucide-react';
import { checkPickupCompletion, createKeyStore, exitEventsForStudent, fmtDateTime, safeMessage } from './security-contract';
import { HistoryModal } from './history';
import { inputClass, Notice, Pager, QueryBoundary } from './ui';

const LIMIT = 15;
function ReqHistory({ schoolId, studentId, r, onClose }: { schoolId: number; studentId: number; r: StudentPickupRequest; onClose: () => void }) {
  const q = useGetStudentPickupRequestHistory(schoolId, studentId, r.id, { query: { queryKey: getGetStudentPickupRequestHistoryQueryKey(schoolId, studentId, r.id) } });
  return <HistoryModal title={`Request #${r.id} history`} query={q} onClose={onClose} />;
}

type Action = { kind: 'approve' | 'reject' | 'refuse' | 'complete'; r: StudentPickupRequest };
function ActionModal({ schoolId, studentId, action, onClose }: { schoolId: number; studentId: number; action: Action; onClose: () => void }) {
  const qc = useQueryClient(); const decide = useDecideStudentPickupRequest(); const refuse = useRefuseStudentPickupAtExit(); const keys = useRef(createKeyStore()).current; const complete = useCompleteStudentPickup({ request: { headers: keys.headers } });
  const [reason, setReason] = useState(''); const [eventId, setEventId] = useState(''); const [msg, setMsg] = useState('');
  const { r, kind } = action;
  const evParams = { limit: 100, studentId: r.studentId, eventType: 'EXIT' as const, result: 'CONFIRMED' as const, from: r.validFrom, to: r.validUntil };
  const evQ = useListSchoolSecurityEvents(schoolId, evParams, { query: { enabled: kind === 'complete', queryKey: getListSchoolSecurityEventsQueryKey(schoolId, evParams), staleTime: 10000 } });
  const exits = exitEventsForStudent(evQ.data?.items ?? [], studentId);
  const check = kind === 'complete' ? checkPickupCompletion(r, eventId) : null;
  const submit = async () => {
    try {
      if (kind === 'complete') { if (!check?.ok) { setMsg(check?.reason ?? ''); return; } keys.use(`${r.id}:${r.version}:${r.pickupPersonId}:${check.eventId}`); await complete.mutateAsync({ schoolId, studentId, requestId: r.id, data: { expectedVersion: r.version, pickupPersonId: r.pickupPersonId, recordedSecurityEventId: check.eventId } }); }
      else if (kind === 'refuse') await refuse.mutateAsync({ schoolId, studentId, requestId: r.id, data: { expectedVersion: r.version, reason: reason.trim() || undefined } });
      else { if (!reason.trim()) { setMsg('A reason is required.'); return; } await decide.mutateAsync({ schoolId, studentId, requestId: r.id, data: { expectedVersion: r.version, decision: kind === 'approve' ? 'APPROVE' : 'REJECT', reason: reason.trim() } }); }
      await qc.invalidateQueries({ queryKey: getListSchoolPickupRequestsQueryKey(schoolId, studentId) }); onClose();
    } catch (e) { setMsg(safeMessage(e)); }
  };
  return <Modal title={`${kind[0].toUpperCase()}${kind.slice(1)} request #${r.id}`} eyebrow="Pickup" onClose={onClose}><form className="space-y-3" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <p className="text-xs text-[hsl(var(--muted-foreground))]">Window {fmtDateTime(r.validFrom)} to {fmtDateTime(r.validUntil)}. Version {r.version}.</p>
    {kind === 'complete' ? <Field label="Confirmed EXIT event (this student, pickup window)">{evQ.isLoading ? <p className="text-xs">Loading exit events...</p> : evQ.isError ? <Notice tone="error">Exit events could not be loaded. Try again.</Notice> : exits.length ? <select className={inputClass} value={eventId} onChange={e => setEventId(e.target.value)} data-testid="select-exit-event"><option value="">Select the recorded exit</option>{exits.map(e => <option key={e.id} value={e.id}>{fmtDateTime(e.occurredAt)} - {e.readerName ?? e.locationName ?? 'reader'}</option>)}</select> : <Notice>No confirmed exit has been recorded for this student in the pickup window. Completion stays disabled until the student taps out.</Notice>}</Field> : <Field label={kind === 'refuse' ? 'Reason (optional)' : 'Reason'}><textarea className={`${inputClass} min-h-20`} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-pickup-reason" /></Field>}
    {kind === 'complete' && <p className="text-xs">Find the EXIT event in Entry/Exit Events. The server verifies it is confirmed, is an exit, and falls inside the window.</p>}
    {msg && <Notice tone="error">{msg}</Notice>}
    <Button type="submit" disabled={decide.isPending || refuse.isPending || complete.isPending ||
      (kind === 'complete' && (!check?.ok || evQ.isLoading || evQ.isError ||
        !exits.some(event => event.id === Number(eventId))))} testId="button-confirm-pickup-action">Confirm</Button></form></Modal>;
}

export function Pickup({ schoolId, canMutate }: { schoolId: number; canMutate: boolean }) {
  const qc = useQueryClient(); const personDecide = useDecideAuthorizedPickupPerson();
  const [search, setSearch] = useState(''); const [studentId, setStudentId] = useState(0);
  const [status, setStatus] = useState<'' | ListSchoolPickupRequestsStatus>(''); const [page, setPage] = useState(0);
  const [action, setAction] = useState<Action | null>(null); const [hist, setHist] = useState<StudentPickupRequest | null>(null); const [msg, setMsg] = useState('');
  const sp = { schoolId, ...(search.trim() ? { search: search.trim() } : {}) };
  const students = useListStudents(sp, { query: { enabled: !!schoolId && search.trim().length > 1, queryKey: getListStudentsQueryKey(sp), staleTime: 30000 } });
  const persons = useListSchoolPickupPersons(schoolId, studentId, { query: { enabled: !!schoolId && !!studentId, queryKey: getListSchoolPickupPersonsQueryKey(schoolId, studentId), staleTime: 15000 } });
  const params = { limit: LIMIT, offset: page * LIMIT, ...(status ? { status } : {}) };
  const reqs = useListSchoolPickupRequests(schoolId, studentId, params, { query: { enabled: !!schoolId && !!studentId, queryKey: getListSchoolPickupRequestsQueryKey(schoolId, studentId, params), staleTime: 15000 } });
  const decidePerson = async (id: number, version: number, decision: 'APPROVE' | 'REJECT' | 'REVOKE') => {
    const reason = decision === 'APPROVE' ? null : window.prompt('Reason for this decision?'); if (decision !== 'APPROVE' && !reason) return;
    try { await personDecide.mutateAsync({ schoolId, studentId, personId: id, data: { expectedVersion: version, decision, reason } }); setMsg(''); await qc.invalidateQueries({ queryKey: getListSchoolPickupPersonsQueryKey(schoolId, studentId) }); } catch (e) { setMsg(safeMessage(e)); }
  };
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 md:max-w-xl"><label className="text-xs font-bold">Find student<input className={inputClass} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or admission no." data-testid="input-pickup-student-search" /></label>
      <label className="text-xs font-bold">Student<select className={inputClass} value={studentId} onChange={e => { setStudentId(Number(e.target.value)); setPage(0); }} data-testid="select-pickup-student"><option value={0}>Select a student</option>{(students.data ?? []).map(s => <option key={s.id} value={s.id}>{s.admissionNo}</option>)}</select></label></div>
    {msg && <Notice tone="error">{msg}</Notice>}
    {!studentId ? <EmptyState icon={Car} title="Choose a student" description="Search for a student to see approved pickup people and requests." /> : <div className="grid gap-5 lg:grid-cols-2">
      <section className="panel p-5"><div className="eyebrow">Approved persons</div><QueryBoundary query={persons}><ul className="mt-3 divide-y divide-[hsl(var(--border)/.7)]">{(persons.data ?? []).map(p => <li key={p.id} className="py-3" data-testid={`row-person-${p.id}`}><div className="flex items-center justify-between gap-2"><div><div className="font-bold">{p.fullName}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{p.relationship ?? 'Relationship not given'} · {p.phone}</div></div><StatusPill value={p.status} /></div>
        {canMutate && <div className="mt-2 flex gap-2">{p.status === 'PENDING' && <><Button variant="outline" onClick={() => void decidePerson(p.id, p.version, 'APPROVE')}>Approve</Button><Button variant="danger" onClick={() => void decidePerson(p.id, p.version, 'REJECT')}>Reject</Button></>}{p.status === 'APPROVED' && <Button variant="danger" onClick={() => void decidePerson(p.id, p.version, 'REVOKE')}>Revoke</Button>}</div>}</li>)}{!persons.data?.length && <li className="py-6 text-sm text-[hsl(var(--muted-foreground))]">No nominations.</li>}</ul></QueryBoundary></section>
      <section className="panel overflow-hidden"><div className="flex items-center justify-between p-5"><div className="eyebrow">Requests</div><select className={`${inputClass} w-36`} value={status} onChange={e => { setStatus(e.target.value as '' | ListSchoolPickupRequestsStatus); setPage(0); }}><option value="">All</option>{['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REFUSED', 'COMPLETED'].map(s => <option key={s}>{s}</option>)}</select></div>
        <QueryBoundary query={reqs}><div className="divide-y divide-[hsl(var(--border)/.7)]">{(reqs.data ?? []).map(r => <div key={r.id} className="p-4" data-testid={`row-pickup-${r.id}`}><div className="flex items-center justify-between"><div className="font-bold">#{r.id} · {fmtDateTime(r.requestedPickupAt)}</div><StatusPill value={r.status} /></div><div className="text-xs text-[hsl(var(--muted-foreground))]">Window {fmtDateTime(r.validFrom)} to {fmtDateTime(r.validUntil)}{r.reason ? ` · ${r.reason}` : ''}{r.recordedSecurityEventId ? ` · exit event #${r.recordedSecurityEventId}` : ''}</div>
          <div className="mt-2 flex flex-wrap gap-2"><Button variant="quiet" onClick={() => setHist(r)}>History</Button>{canMutate && r.status === 'PENDING' && <><Button onClick={() => setAction({ kind: 'approve', r })}>Approve</Button><Button variant="danger" onClick={() => setAction({ kind: 'reject', r })}>Reject</Button></>}{canMutate && r.status === 'APPROVED' && <><Button onClick={() => setAction({ kind: 'complete', r })} testId={`button-complete-${r.id}`}>Complete</Button><Button variant="danger" onClick={() => setAction({ kind: 'refuse', r })}>Refuse at exit</Button></>}</div></div>)}{!reqs.data?.length && <p className="p-5 text-sm text-[hsl(var(--muted-foreground))]">No requests.</p>}</div>
          <Pager page={page} onPage={setPage} hasMore={(reqs.data?.length ?? 0) === LIMIT} /></QueryBoundary></section></div>}
    {action && <ActionModal schoolId={schoolId} studentId={studentId} action={action} onClose={() => setAction(null)} />}
    {hist && <ReqHistory schoolId={schoolId} studentId={studentId} r={hist} onClose={() => setHist(null)} />}
  </div>;
}
