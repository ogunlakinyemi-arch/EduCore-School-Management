import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useListSchoolSecurityVisitors, getListSchoolSecurityVisitorsQueryKey, useRegisterSecurityVisitor, useUpdateSecurityVisitor, useCheckoutSecurityVisitor, useGetSecurityVisitorHistory, getGetSecurityVisitorHistoryQueryKey } from '@workspace/api-client-react';
import type { SecurityVisitor, ListSchoolSecurityVisitorsStatus } from '@workspace/api-client-react';
import { Button, EmptyState, Field, Modal, StatusPill } from '@/components/shared';
import { UserRound } from 'lucide-react';
import { createKeyStore, fmtDateTime, safeMessage } from './security-contract';
import { HistoryModal } from './history';
import { inputClass, Notice, Pager, QueryBoundary } from './ui';

const LIMIT = 15;
function VisitorHistory({ schoolId, id, onClose }: { schoolId: number; id: number; onClose: () => void }) {
  const q = useGetSecurityVisitorHistory(schoolId, id, { query: { queryKey: getGetSecurityVisitorHistoryQueryKey(schoolId, id) } });
  return <HistoryModal title="Visitor history" query={q} onClose={onClose} />;
}

function VisitorForm({ schoolId, visitor, onClose }: { schoolId: number; visitor?: SecurityVisitor; onClose: () => void }) {
  const qc = useQueryClient(); const reg = useRegisterSecurityVisitor(); const upd = useUpdateSecurityVisitor();
  const [f, setF] = useState({ visitorName: visitor?.visitorName ?? '', phone: visitor?.phone ?? '', idReference: visitor?.idReference ?? '', purpose: visitor?.purpose ?? '', hostName: visitor?.hostName ?? '', notes: visitor?.notes ?? '' });
  const [msg, setMsg] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }));
  const submit = async () => {
    const body = { visitorName: f.visitorName.trim(), purpose: f.purpose.trim(), phone: f.phone.trim() || null, idReference: f.idReference.trim() || null, hostName: f.hostName.trim() || null, notes: f.notes.trim() || null };
    try { if (visitor) await upd.mutateAsync({ schoolId, visitorId: visitor.id, data: { ...body, expectedVersion: visitor.version } }); else await reg.mutateAsync({ schoolId, data: body }); await qc.invalidateQueries({ queryKey: getListSchoolSecurityVisitorsQueryKey(schoolId) }); onClose(); } catch (e) { setMsg(safeMessage(e)); }
  };
  return <Modal title={visitor ? 'Edit visitor' : 'Register visitor'} eyebrow="Visitors" onClose={onClose}><form className="space-y-3" onSubmit={e => { e.preventDefault(); if (f.visitorName.trim() && f.purpose.trim()) void submit(); }}>
    <Field label="Visitor name"><input className={inputClass} required value={f.visitorName} onChange={set('visitorName')} data-testid="input-visitor-name" /></Field>
    <Field label="Purpose of visit"><input className={inputClass} required value={f.purpose} onChange={set('purpose')} data-testid="input-visitor-purpose" /></Field>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Phone"><input className={inputClass} value={f.phone} onChange={set('phone')} /></Field><Field label="ID reference"><input className={inputClass} value={f.idReference} onChange={set('idReference')} /></Field></div>
    <Field label="Host"><input className={inputClass} value={f.hostName} onChange={set('hostName')} /></Field>
    <Field label="Notes"><textarea className={`${inputClass} min-h-20`} value={f.notes} onChange={set('notes')} /></Field>
    {msg && <Notice tone="error">{msg}</Notice>}
    <Button type="submit" disabled={reg.isPending || upd.isPending} testId="button-save-visitor">{visitor ? 'Save changes' : 'Check in visitor'}</Button></form></Modal>;
}

export function Visitors({ schoolId, canMutate }: { schoolId: number; canMutate: boolean }) {
  const qc = useQueryClient(); const keys = useRef(createKeyStore()).current; const checkout = useCheckoutSecurityVisitor({ request: { headers: keys.headers } });
  const [status, setStatus] = useState<'' | ListSchoolSecurityVisitorsStatus>(''); const [page, setPage] = useState(0); const [search, setSearch] = useState('');
  const [form, setForm] = useState<SecurityVisitor | 'new' | null>(null); const [hist, setHist] = useState<number | null>(null); const [msg, setMsg] = useState('');
  const params = { limit: LIMIT, offset: page * LIMIT, ...(status ? { status } : {}) };
  const q = useListSchoolSecurityVisitors(schoolId, params, { query: { enabled: !!schoolId, queryKey: getListSchoolSecurityVisitorsQueryKey(schoolId, params), staleTime: 15000 } });
  const s = search.trim().toLowerCase(); const rows = (q.data ?? []).filter(v => !s || [v.visitorName, v.hostName, v.purpose].some(x => x?.toLowerCase().includes(s)));
  const out = async (v: SecurityVisitor) => { try { keys.use(`${v.id}:${v.version}`); await checkout.mutateAsync({ schoolId, visitorId: v.id, data: { expectedVersion: v.version } }); setMsg(''); await qc.invalidateQueries({ queryKey: getListSchoolSecurityVisitorsQueryKey(schoolId) }); } catch (e) { setMsg(safeMessage(e)); } };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3"><label className="text-xs font-bold">Status<select className={inputClass} value={status} onChange={e => { setStatus(e.target.value as '' | ListSchoolSecurityVisitorsStatus); setPage(0); }}><option value="">All</option><option value="ON_SITE">On site</option><option value="CHECKED_OUT">Checked out</option></select></label><label className="text-xs font-bold">Search<input className={inputClass} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or host" /></label>{canMutate && <Button onClick={() => setForm('new')} testId="button-register-visitor">Register visitor</Button>}</div>
    {msg && <Notice tone="error">{msg}</Notice>}
    <div className="panel overflow-hidden"><QueryBoundary query={q}>{!rows.length ? <EmptyState icon={UserRound} title="No visitors" description="Registered visitors will be listed here." /> : <div className="divide-y divide-[hsl(var(--border)/.7)]">{rows.map(v => <div key={v.id} className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between" data-testid={`row-visitor-${v.id}`}><div><div className="font-bold">{v.visitorName}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{v.purpose}{v.hostName ? ` · host ${v.hostName}` : ''} · in {fmtDateTime(v.checkedInAt)}{v.checkedOutAt ? ` · out ${fmtDateTime(v.checkedOutAt)}` : ''}</div></div><div className="flex flex-wrap items-center gap-2"><StatusPill value={v.status.replaceAll('_', ' ')} /><Button variant="quiet" onClick={() => setHist(v.id)}>History</Button>{canMutate && <Button variant="outline" onClick={() => setForm(v)}>Edit</Button>}{canMutate && v.status === 'ON_SITE' && <Button disabled={checkout.isPending} onClick={() => void out(v)} testId={`button-checkout-${v.id}`}>Check out</Button>}</div></div>)}</div>}
      <Pager page={page} onPage={setPage} hasMore={(q.data?.length ?? 0) === LIMIT} /></QueryBoundary></div>
    {form && <VisitorForm schoolId={schoolId} visitor={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
    {hist !== null && <VisitorHistory schoolId={schoolId} id={hist} onClose={() => setHist(null)} />}
  </div>;
}
