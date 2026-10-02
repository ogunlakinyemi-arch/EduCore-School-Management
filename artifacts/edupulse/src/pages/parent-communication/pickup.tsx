import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useListParentPickupPersonNominations, getListParentPickupPersonNominationsQueryKey, useNominatePickupPerson, useListParentPickupRequests, getListParentPickupRequestsQueryKey, useRequestStudentPickup, useCancelParentPickupRequest } from '@workspace/api-client-react';
import type { AuthorizedPickupPerson } from '@workspace/api-client-react';
import { Button, Field, StatusPill } from '@/components/shared';
import { inputClass, Notice, QueryBoundary } from '../security/ui';
import { fmtDateTime, safeMessage } from '../security/security-contract';
import { toLocalIso, validPickupWindow } from './comm-contract';

export function ChildPickup({ studentId }: { studentId: number }) {
  const qc = useQueryClient();
  const pq = useListParentPickupPersonNominations(studentId, { query: { queryKey: getListParentPickupPersonNominationsQueryKey(studentId), staleTime: 20000 } });
  const rparams = { limit: 20 };
  const rq = useListParentPickupRequests(studentId, rparams, { query: { queryKey: getListParentPickupRequestsQueryKey(studentId, rparams), staleTime: 20000 } });
  const nominate = useNominatePickupPerson(); const request = useRequestStudentPickup(); const cancel = useCancelParentPickupRequest();
  const [n, setN] = useState({ fullName: '', phone: '', relationship: '', identityReference: '', validFrom: '', validUntil: '' }); const [r, setR] = useState({ personId: 0, at: '', reason: '' }); const [msg, setMsg] = useState('');
  const approved = (pq.data ?? []).filter((p: AuthorizedPickupPerson) => p.status === 'APPROVED');
  const refresh = async () => { await qc.invalidateQueries({ queryKey: getListParentPickupPersonNominationsQueryKey(studentId) }); await qc.invalidateQueries({ queryKey: getListParentPickupRequestsQueryKey(studentId) }); };
  const doNominate = async () => {
    if (!n.fullName.trim() || n.phone.trim().length < 6) { setMsg('Name and phone are required.'); return; }
    if (n.validFrom || n.validUntil) { const bad = validPickupWindow(n.validFrom, n.validUntil); if (bad) { setMsg(bad); return; } }
    try { await nominate.mutateAsync({ studentId, data: { fullName: n.fullName.trim(), phone: n.phone.trim(), relationship: n.relationship.trim() || null, identityReference: n.identityReference.trim() || null, validFrom: toLocalIso(n.validFrom), validUntil: toLocalIso(n.validUntil) } }); setN({ fullName: '', phone: '', relationship: '', identityReference: '', validFrom: '', validUntil: '' }); setMsg('Nomination sent. The school must approve before this person can collect.'); await refresh(); } catch (e) { setMsg(safeMessage(e)); }
  };
  const doRequest = async () => { if (!r.personId || !r.at) { setMsg('Choose an approved person and a pickup time.'); return; } try { await request.mutateAsync({ studentId, data: { pickupPersonId: r.personId, requestedPickupAt: new Date(r.at).toISOString(), reason: r.reason.trim() || null } }); setR({ personId: 0, at: '', reason: '' }); setMsg('Request sent for school approval.'); await refresh(); } catch (e) { setMsg(safeMessage(e)); } };
  return <div className="grid gap-5 lg:grid-cols-2">
    {msg && <div className="lg:col-span-2"><Notice>{msg}</Notice></div>}
    <section className="panel p-5"><div className="eyebrow">Authorized pickup people</div><QueryBoundary query={pq}><ul className="mt-3 divide-y divide-[hsl(var(--border)/.7)]">{(pq.data ?? []).map(p => <li key={p.id} className="flex items-center justify-between gap-2 py-3" data-testid={`row-nomination-${p.id}`}><div><div className="font-bold">{p.fullName}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{p.relationship ?? ''} {p.decisionReason ? `· ${p.decisionReason}` : ''}</div></div><StatusPill value={p.status} /></li>)}{!pq.data?.length && <li className="py-4 text-sm text-[hsl(var(--muted-foreground))]">No one nominated yet.</li>}</ul></QueryBoundary>
      <form className="mt-4 space-y-3 border-t border-[hsl(var(--border))] pt-4" onSubmit={e => { e.preventDefault(); void doNominate(); }}>
        <Field label="Full name"><input className={inputClass} value={n.fullName} onChange={e => setN({ ...n, fullName: e.target.value })} data-testid="input-nominee-name" /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Phone"><input className={inputClass} value={n.phone} onChange={e => setN({ ...n, phone: e.target.value })} data-testid="input-nominee-phone" /></Field><Field label="Relationship"><input className={inputClass} value={n.relationship} onChange={e => setN({ ...n, relationship: e.target.value })} /></Field></div>
        <Field label="ID reference (optional)"><input className={inputClass} value={n.identityReference} onChange={e => setN({ ...n, identityReference: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Valid from (optional)"><input type="datetime-local" className={inputClass} value={n.validFrom} onChange={e => setN({ ...n, validFrom: e.target.value })} /></Field><Field label="Valid until (optional)"><input type="datetime-local" className={inputClass} value={n.validUntil} onChange={e => setN({ ...n, validUntil: e.target.value })} /></Field></div>
        <Button type="submit" disabled={nominate.isPending} testId="button-nominate">Nominate person</Button></form></section>
    <section className="panel p-5"><div className="eyebrow">Pickup requests</div>
      <QueryBoundary query={rq}><ul className="mt-3 divide-y divide-[hsl(var(--border)/.7)]">{(rq.data ?? []).map(x => <li key={x.id} className="py-3" data-testid={`row-request-${x.id}`}><div className="flex items-center justify-between"><div className="font-bold">{fmtDateTime(x.requestedPickupAt)}</div><StatusPill value={x.status} /></div><div className="text-xs text-[hsl(var(--muted-foreground))]">Window {fmtDateTime(x.validFrom)} to {fmtDateTime(x.validUntil)}{x.decisionReason ? ` · ${x.decisionReason}` : ''}</div>{(x.status === 'PENDING' || x.status === 'APPROVED') && <Button variant="danger" className="mt-2" disabled={cancel.isPending} onClick={() => void cancel.mutateAsync({ studentId, requestId: x.id, data: { expectedVersion: x.version } }).then(refresh).catch(e => setMsg(safeMessage(e)))}>Cancel request</Button>}</li>)}{!rq.data?.length && <li className="py-4 text-sm text-[hsl(var(--muted-foreground))]">No requests.</li>}</ul></QueryBoundary>
      <form className="mt-4 space-y-3 border-t border-[hsl(var(--border))] pt-4" onSubmit={e => { e.preventDefault(); void doRequest(); }}>
        <Field label="Approved person"><select className={inputClass} value={r.personId} onChange={e => setR({ ...r, personId: Number(e.target.value) })} data-testid="select-request-person"><option value={0}>{approved.length ? 'Select' : 'No approved people yet'}</option>{approved.map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></Field>
        <Field label="Pickup time"><input type="datetime-local" className={inputClass} value={r.at} onChange={e => setR({ ...r, at: e.target.value })} data-testid="input-request-time" /></Field>
        <Field label="Reason (optional)"><input className={inputClass} value={r.reason} onChange={e => setR({ ...r, reason: e.target.value })} /></Field>
        <Button type="submit" disabled={request.isPending || !approved.length} testId="button-request-pickup">Request pickup</Button></form></section></div>;
}
