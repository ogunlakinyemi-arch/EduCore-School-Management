import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useListSchoolSecurityIncidents, getListSchoolSecurityIncidentsQueryKey, useCreateSchoolSecurityIncident, useUpdateSchoolSecurityIncident, useListSchoolSecurityIncidentAttachments, getListSchoolSecurityIncidentAttachmentsQueryKey, useCreateSchoolSecurityIncidentAttachmentUploadIntent, useConfirmSchoolSecurityIncidentAttachment, createSchoolSecurityIncidentAttachmentDownload, useGetSchoolSecurityIncidentHistory, getGetSchoolSecurityIncidentHistoryQueryKey } from '@workspace/api-client-react';
import type { SecurityIncident, SecurityIncidentInputSeverity, SecurityIncidentIncidentType, SecurityIncidentPatchStatus, SecurityIncidentAttachmentUploadInputContentType } from '@workspace/api-client-react';
import { Button, EmptyState, Field, Modal, StatusPill } from '@/components/shared';
import { Siren } from 'lucide-react';
import { fmtDateTime, safeMessage } from './security-contract';
import { HistoryModal } from './history';
import { inputClass, Notice, Pager, QueryBoundary } from './ui';

const TYPES: SecurityIncidentIncidentType[] = ['UNAUTHORIZED_ACCESS', 'LOST_CARD', 'VISITOR_ISSUE', 'STUDENT_RELEASE', 'GATE_INCIDENT', 'SECURITY_CONCERN', 'OTHER'];
const SEV: SecurityIncidentInputSeverity[] = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
const LIMIT = 15;
const TYPES_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

function Create({ schoolId, onClose }: { schoolId: number; onClose: () => void }) {
  const qc = useQueryClient(); const create = useCreateSchoolSecurityIncident();
  const [type, setType] = useState<SecurityIncidentIncidentType>('GATE_INCIDENT'); const [sev, setSev] = useState<SecurityIncidentInputSeverity>('MODERATE'); const [desc, setDesc] = useState(''); const [at, setAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)); const [msg, setMsg] = useState('');
  return <Modal title="Log incident" eyebrow="Private incident" onClose={onClose}><form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!desc.trim()) return; void (async () => { try { await create.mutateAsync({ schoolId, data: { incidentType: type, severity: sev, description: desc.trim(), occurredAt: new Date(at).toISOString() } }); await qc.invalidateQueries({ queryKey: getListSchoolSecurityIncidentsQueryKey(schoolId) }); onClose(); } catch (er) { setMsg(safeMessage(er)); } })(); }}>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Type"><select className={inputClass} value={type} onChange={e => setType(e.target.value as SecurityIncidentIncidentType)}>{TYPES.map(t => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}</select></Field><Field label="Severity"><select className={inputClass} value={sev} onChange={e => setSev(e.target.value as SecurityIncidentInputSeverity)}>{SEV.map(t => <option key={t}>{t}</option>)}</select></Field></div>
    <Field label="Occurred at"><input type="datetime-local" className={inputClass} value={at} onChange={e => setAt(e.target.value)} /></Field>
    <Field label="Description"><textarea className={`${inputClass} min-h-28`} required value={desc} onChange={e => setDesc(e.target.value)} data-testid="input-incident-description" /></Field>
    {msg && <Notice tone="error">{msg}</Notice>}<Button type="submit" disabled={create.isPending} testId="button-save-incident">Log incident</Button></form></Modal>;
}

function Detail({ schoolId, inc, canMutate, onClose }: { schoolId: number; inc: SecurityIncident; canMutate: boolean; onClose: () => void }) {
  const qc = useQueryClient(); const update = useUpdateSchoolSecurityIncident();
  const atts = useListSchoolSecurityIncidentAttachments(schoolId, inc.id, { query: { queryKey: getListSchoolSecurityIncidentAttachmentsQueryKey(schoolId, inc.id), staleTime: 15000 } });
  const hist = useGetSchoolSecurityIncidentHistory(schoolId, inc.id, { query: { queryKey: getGetSchoolSecurityIncidentHistoryQueryKey(schoolId, inc.id) } });
  const intent = useCreateSchoolSecurityIncidentAttachmentUploadIntent(); const confirm = useConfirmSchoolSecurityIncidentAttachment();
  const [resolution, setResolution] = useState(inc.resolution ?? ''); const [msg, setMsg] = useState(''); const [showHist, setShowHist] = useState(false); const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!(atts.data ?? []).some(a => a.status === 'PENDING_UPLOAD')) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [atts.data]);
  const confirmUpload = async (attachmentId: number) => {
    setBusy(true);
    try {
      await confirm.mutateAsync({ schoolId, incidentId: inc.id, attachmentId });
      setMsg('Attachment confirmed.');
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListSchoolSecurityIncidentAttachmentsQueryKey(schoolId, inc.id) }),
        qc.invalidateQueries({ queryKey: getListSchoolSecurityIncidentsQueryKey(schoolId) }),
      ]);
    } catch (e) { setMsg(safeMessage(e, 'Attachment confirmation failed.')); }
    finally { setBusy(false); }
  };
  const patch = async (status: SecurityIncidentPatchStatus) => { try { await update.mutateAsync({ schoolId, incidentId: inc.id, data: { expectedVersion: inc.version, status, resolution: status === 'RESOLVED' ? resolution.trim() || null : undefined } }); await qc.invalidateQueries({ queryKey: getListSchoolSecurityIncidentsQueryKey(schoolId) }); onClose(); } catch (e) { setMsg(safeMessage(e)); } };
  const upload = async (file: File | undefined) => {
    if (!file) return; if (!(TYPES_OK as readonly string[]).includes(file.type)) { setMsg('Only PDF, JPEG, PNG or WebP files are allowed.'); return; }
    setBusy(true);
    try {
      const i = await intent.mutateAsync({ schoolId, incidentId: inc.id, data: { fileName: file.name, contentType: file.type as SecurityIncidentAttachmentUploadInputContentType, byteSize: file.size } });
      const put = await fetch(i.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file }); if (!put.ok) throw new Error('Upload failed.');
      setMsg('File uploaded. Confirmation becomes available when the secure upload URL expires (up to two minutes). This prevents the file from being overwritten after verification.');
      setNow(Date.now());
      await qc.invalidateQueries({ queryKey: getListSchoolSecurityIncidentAttachmentsQueryKey(schoolId, inc.id) });
    } catch (e) { setMsg(safeMessage(e, 'Attachment upload failed.')); } finally { setBusy(false); }
  };
  const open = async (id: number) => { try { const d = await createSchoolSecurityIncidentAttachmentDownload(schoolId, inc.id, id); window.open(d.downloadUrl, '_blank', 'noopener,noreferrer'); } catch (e) { setMsg(safeMessage(e)); } };
  return <Modal title={`Incident #${inc.id}`} eyebrow={inc.incidentType.replaceAll('_', ' ')} onClose={onClose}><div className="space-y-4">
    <p className="whitespace-pre-wrap text-sm">{inc.description}</p><div className="flex gap-2"><StatusPill value={inc.status} /><span className="text-xs">{inc.severity} · {fmtDateTime(inc.occurredAt)}</span></div>
    <div><div className="eyebrow mb-1">Attachments</div><QueryBoundary query={atts}><ul className="space-y-1 text-sm">{(atts.data ?? []).map(a => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2"><span>{a.fileName} <span className="text-xs text-[hsl(var(--muted-foreground))]">({a.status.toLowerCase()})</span></span>{a.status === 'CONFIRMED' && <Button variant="quiet" onClick={() => void open(a.id)}>Open</Button>}{a.status === 'PENDING_UPLOAD' && canMutate && <Button variant="quiet" disabled={busy || new Date(a.uploadExpiresAt).getTime() > now} onClick={() => void confirmUpload(a.id)}>{new Date(a.uploadExpiresAt).getTime() > now ? `Confirm in ${Math.ceil((new Date(a.uploadExpiresAt).getTime() - now) / 1000)}s` : 'Confirm upload'}</Button>}</li>)}{!atts.data?.length && <li className="text-xs text-[hsl(var(--muted-foreground))]">None attached.</li>}</ul></QueryBoundary>
      {canMutate && <input type="file" accept=".pdf,image/jpeg,image/png,image/webp" disabled={busy} className="mt-2 text-xs" onChange={e => void upload(e.target.files?.[0])} data-testid="input-incident-attachment" />}</div>
    {canMutate && inc.status !== 'RESOLVED' && <><Field label="Resolution"><textarea className={`${inputClass} min-h-16`} value={resolution} onChange={e => setResolution(e.target.value)} /></Field><div className="flex gap-2">{inc.status === 'OPEN' && <Button variant="outline" onClick={() => void patch('INVESTIGATING')}>Start investigating</Button>}<Button disabled={!resolution.trim()} onClick={() => void patch('RESOLVED')}>Resolve</Button></div></>}
    {msg && <Notice tone="error">{msg}</Notice>}<Button variant="quiet" onClick={() => setShowHist(true)}>View history</Button></div>
    {showHist && <HistoryModal title="Incident history" query={hist} onClose={() => setShowHist(false)} />}</Modal>;
}

export function Incidents({ schoolId, canMutate }: { schoolId: number; canMutate: boolean }) {
  const [page, setPage] = useState(0); const [status, setStatus] = useState(''); const [creating, setCreating] = useState(false); const [sel, setSel] = useState<SecurityIncident | null>(null);
  const params = { limit: LIMIT, offset: page * LIMIT, ...(status ? { status: status as 'OPEN' } : {}) };
  const q = useListSchoolSecurityIncidents(schoolId, params, { query: { enabled: !!schoolId, queryKey: getListSchoolSecurityIncidentsQueryKey(schoolId, params), staleTime: 15000 } });
  return <div className="space-y-4"><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-bold">Status<select className={inputClass} value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="">All</option><option>OPEN</option><option>INVESTIGATING</option><option>RESOLVED</option></select></label>{canMutate && <Button onClick={() => setCreating(true)} testId="button-log-incident">Log incident</Button>}</div>
    <p className="text-xs text-[hsl(var(--muted-foreground))]">Incidents are private to authorised security staff and are never shown to parents.</p>
    <div className="panel overflow-hidden"><QueryBoundary query={q}>{!q.data?.length ? <EmptyState icon={Siren} title="No incidents" description="Logged incidents appear here." /> : <div className="divide-y divide-[hsl(var(--border)/.7)]">{q.data.map(i => <button key={i.id} onClick={() => setSel(i)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-[hsl(var(--secondary)/.4)]" data-testid={`row-incident-${i.id}`}><div><div className="font-bold">#{i.id} · {i.incidentType.replaceAll('_', ' ')}</div><div className="line-clamp-1 text-xs text-[hsl(var(--muted-foreground))]">{i.description}</div></div><div className="text-right"><StatusPill value={i.status} /><div className="text-xs">{i.severity}</div></div></button>)}</div>}
      <Pager page={page} onPage={setPage} hasMore={(q.data?.length ?? 0) === LIMIT} /></QueryBoundary></div>
    {creating && <Create schoolId={schoolId} onClose={() => setCreating(false)} />}{sel && <Detail schoolId={schoolId} inc={sel} canMutate={canMutate} onClose={() => setSel(null)} />}</div>;
}
