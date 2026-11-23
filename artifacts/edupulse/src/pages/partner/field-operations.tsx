import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListBroFieldLeads,
  useGetBroFieldOptions,
  useGetBroFieldLead,
  useCreateBroFieldLead,
  useUpdateBroFieldLead,
  useRequestBroFieldTransfer,
  useDecideBroFieldTransfer,
  getListBroFieldLeadsQueryKey,
  getGetBroFieldLeadQueryKey,
  getGetBroFieldOptionsQueryKey,
  type BroFieldLead,
  type BroFieldLeadInput,
  type BroFieldOptions,
  type ListBroFieldLeadsParams,
} from '@workspace/api-client-react';
import { MapPin, RefreshCw, Plus } from 'lucide-react';
import { FieldSmsCampaigns } from '@/components/field-sms-campaigns';
import { Button, Field, StatusPill, SkeletonPage, ErrorState, EmptyState, date } from '@/components/shared';

export const FIELD_STATUSES = ['Visited', 'Interested', 'Demo Scheduled', 'Negotiation', 'Adopted', 'Not Interested', 'Follow-up'] as const;
const INTEREST = ['Unknown', 'Low', 'Medium', 'High'] as const;

type Draft = {
  schoolName: string; address: string; contactPerson: string; contactPhone: string;
  visitDate: string; personMet: string; notes: string; interestLevel: string;
  status: string; nextFollowUpDate: string; schoolId: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyDraft = (): Draft => ({ schoolName: '', address: '', contactPerson: '', contactPhone: '', visitDate: today(), personMet: '', notes: '', interestLevel: 'Unknown', status: 'Visited', nextFollowUpDate: '', schoolId: '' });
const toDraft = (l: BroFieldLead): Draft => ({
  schoolName: l.schoolName, address: l.address, contactPerson: l.contactPerson ?? '', contactPhone: l.contactPhone ?? '',
  visitDate: l.visitDate, personMet: l.personMet, notes: l.notes, interestLevel: l.interestLevel, status: l.status,
  nextFollowUpDate: l.nextFollowUpDate ?? '', schoolId: l.schoolId == null ? '' : String(l.schoolId),
});

/** Sanitized error text: server-provided `error` string only, plain text, length capped. */
export function errorText(err: unknown, fallback = 'Request failed.'): string {
  const e = err as { status?: number; data?: { error?: unknown } } | null;
  const raw = typeof e?.data?.error === 'string' ? e.data.error : fallback;
  const text = raw.replace(/[\u0000-\u001f]/g, ' ').slice(0, 300);
  return e?.status === 409 ? `Conflict: ${text} Reload the record before saving again.` : text;
}

/** Client validation mirroring server rules. Returns error message or null. */
export function validateDraft(d: Draft): string | null {
  if (!d.schoolName.trim() || !d.address.trim()) return 'School name and address are required.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.visitDate)) return 'Visit date must be YYYY-MM-DD.';
  if (!d.personMet.trim()) return 'Person met is required.';
  if (d.nextFollowUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(d.nextFollowUpDate)) return 'Follow-up date must be YYYY-MM-DD.';
  if (d.status === 'Adopted' && !d.schoolId) return 'Adopted requires selecting an existing school. New schools are never created here.';
  return null;
}

const is404 = (err: unknown) => (err as { status?: number } | null)?.status === 404;

function Unavailable() {
  return <div className="mx-auto max-w-3xl p-8"><div className="panel p-8 text-center">
    <h1 className="display-font text-2xl font-bold">Field Operations unavailable</h1>
    <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Field Operations could not be found. Refresh or contact the Platform Owner.</p>
  </div></div>;
}

export default function FieldOperationsPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<{ q: string; status: string; ownerId: string; followUp: string }>({ q: '', status: '', ownerId: '', followUp: '' });
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const params: ListBroFieldLeadsParams = {
    ...(filters.q ? { q: filters.q } : {}), ...(filters.status ? { status: filters.status } : {}),
    ...(filters.ownerId && /^\d+$/.test(filters.ownerId) ? { ownerId: Number(filters.ownerId) } : {}),
    ...(filters.followUp ? { followUp: filters.followUp } : {}),
  };
  const options = useGetBroFieldOptions();
  const leads = useListBroFieldLeads(params);

  const refreshAll = () => Promise.all([
    qc.invalidateQueries({ queryKey: getListBroFieldLeadsQueryKey().slice(0, 1) }),
    qc.invalidateQueries({ queryKey: getGetBroFieldOptionsQueryKey() }),
    ...(selected ? [qc.invalidateQueries({ queryKey: getGetBroFieldLeadQueryKey(selected) })] : []),
  ]);

  if (is404(options.error) || is404(leads.error)) return <Unavailable />;
  if (options.isLoading) return <SkeletonPage />;
  if (options.isError || !options.data) return <ErrorState message={errorText(options.error, 'Field options could not be loaded.')} retry={() => { void options.refetch(); }} />;
  const opts = options.data;
  const isOwner = opts.isOwner;
  const list = leads.data ?? [];

  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8" data-testid="field-operations">
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="eyebrow">{isOwner ? 'Owner oversight' : 'BRO field operations'}</div>
          <h1 className="display-font mt-2 text-3xl font-bold">Field Operations & School Leads</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { void refreshAll(); }} testId="field-refresh"><RefreshCw size={15} />Refresh</Button>
          {!isOwner && <Button onClick={() => { setCreating(true); setSelected(null); }} testId="field-new"><Plus size={15} />Log visit</Button>}
        </div>
      </div>

      {isOwner && <FieldSmsCampaigns />}

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <Field label="Search"><input value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} placeholder="School, address, contact" /></Field>
        <Field label="Status"><select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">All statuses</option>{FIELD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select></Field>
        {isOwner && <Field label="Current BRO"><select value={filters.ownerId} onChange={e => setFilters(f => ({ ...f, ownerId: e.target.value }))}>
          <option value="">All BROs</option>{opts.bros.map(b => <option key={b.id} value={b.id}>{b.name} (#{b.id})</option>)}
        </select></Field>}
        <Field label="Follow-up on/before"><input type="date" value={filters.followUp} onChange={e => setFilters(f => ({ ...f, followUp: e.target.value }))} /></Field>
      </div>

      {isOwner && opts.conflicts.length > 0 && <div className="panel mb-5 p-4 text-sm" role="status">
        <div className="mb-2 font-bold">Duplicate school signals ({opts.conflicts.length})</div>
        <ul className="space-y-1 text-xs text-[hsl(var(--muted-foreground))]">
          {opts.conflicts.slice(0, 20).map((c, i) => <li key={i}>{c.schoolName} · BRO #{c.actorUserId} · lead {c.leadId ?? '—'} · {date(c.createdAt)}</li>)}
        </ul>
      </div>}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <div className="panel overflow-hidden">
          {leads.isLoading ? <div className="space-y-3 p-5">{[0, 1, 2].map(i => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
            : leads.isError ? <ErrorState message={errorText(leads.error, 'Leads could not be loaded.')} retry={() => { void leads.refetch(); }} />
              : list.length === 0 ? <EmptyState icon={MapPin} title="No leads" description={isOwner ? 'No field leads match these filters.' : 'Log your first school visit.'} />
                : <ul className="divide-y divide-[hsl(var(--border))]">{list.map(l => (
                  <li key={l.id}><button type="button" onClick={() => { setSelected(l.id); setCreating(false); }} className={`w-full p-4 text-left hover:bg-[hsl(var(--muted)/.3)] ${selected === l.id ? 'bg-[hsl(var(--muted)/.4)]' : ''}`} data-testid={`field-lead-${l.id}`}>
                    <div className="flex items-center justify-between gap-3"><span className="font-bold">{l.schoolName}</span><StatusPill value={l.status} /></div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Visited {l.visitDate} · Next follow-up {l.nextFollowUpDate || '—'} · Owner {l.currentOwnerId == null ? 'Released' : `#${l.currentOwnerId}`}</div>
                  </button></li>))}</ul>}
        </div>
        <div>
          {creating && !isOwner ? <LeadForm key="new" opts={opts} onDone={(id) => { setCreating(false); setSelected(id); void refreshAll(); }} onCancel={() => setCreating(false)} />
            : selected ? <LeadDetail key={selected} id={selected} opts={opts} onChanged={() => { void refreshAll(); }} />
              : <div className="panel p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">Select a lead to view details and history.</div>}
        </div>
      </div>
    </div>
  );
}

function LeadForm({ lead, opts, onDone, onCancel }: { lead?: BroFieldLead; opts: BroFieldOptions; onDone: (id: number) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => lead ? toDraft(lead) : emptyDraft());
  const [error, setError] = useState<string | null>(null);
  // Version captured when editing began; never refreshed silently so a 409 surfaces.
  const versionRef = useRef(lead?.version ?? 0);
  const create = useCreateBroFieldLead();
  const update = useUpdateBroFieldLead();
  const pending = create.isPending || update.isPending;
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft(d => ({ ...d, [k]: e.target.value }));

  const submit = () => {
    const v = validateDraft(draft);
    if (v) { setError(v); return; }
    setError(null);
    const data: BroFieldLeadInput = {
      schoolName: draft.schoolName.trim(), address: draft.address.trim(),
      contactPerson: draft.contactPerson.trim() || null, contactPhone: draft.contactPhone.trim() || null,
      visitDate: draft.visitDate, personMet: draft.personMet.trim(), notes: draft.notes,
      interestLevel: draft.interestLevel as BroFieldLeadInput['interestLevel'], status: draft.status as BroFieldLeadInput['status'],
      nextFollowUpDate: draft.nextFollowUpDate || null, schoolId: draft.schoolId ? Number(draft.schoolId) : null,
      expectedVersion: lead ? versionRef.current : 0,
    };
    const handlers = { onSuccess: (r: BroFieldLead) => onDone(r.id), onError: (e: unknown) => setError(errorText(e, 'Save failed.')) };
    if (lead) update.mutate({ id: lead.id, data }, handlers); else create.mutate({ data }, handlers);
  };

  return (
    <div className="panel space-y-4 p-5" data-testid="field-lead-form">
      <h2 className="display-font text-xl font-bold">{lead ? 'Record visit update' : 'Log school visit'}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="School name *"><input value={draft.schoolName} onChange={set('schoolName')} /></Field>
        <Field label="Address *"><input value={draft.address} onChange={set('address')} /></Field>
        <Field label="Contact person"><input value={draft.contactPerson} onChange={set('contactPerson')} /></Field>
        <Field label="Contact phone"><input value={draft.contactPhone} onChange={set('contactPhone')} /></Field>
        <Field label="Visit date *"><input type="date" value={draft.visitDate} onChange={set('visitDate')} /></Field>
        <Field label="Person met *"><input value={draft.personMet} onChange={set('personMet')} /></Field>
        <Field label="Interest level"><select value={draft.interestLevel} onChange={set('interestLevel')}>{INTEREST.map(i => <option key={i}>{i}</option>)}</select></Field>
        <Field label="Status"><select value={draft.status} onChange={set('status')}>{FIELD_STATUSES.map(s => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Next follow-up date"><input type="date" value={draft.nextFollowUpDate} onChange={set('nextFollowUpDate')} /></Field>
        <Field label={draft.status === 'Adopted' ? 'Existing school (required)' : 'Existing school (optional)'}>
          <select value={draft.schoolId} onChange={set('schoolId')}><option value="">None</option>{opts.schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </Field>
      </div>
      <Field label="Notes"><textarea rows={3} value={draft.notes} onChange={set('notes')} /></Field>
      {error && <div role="alert" className="rounded-xl border border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--destructive)/.06)] p-3 text-sm">{error}</div>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={pending} testId="field-save">{pending ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  );
}

function LeadDetail({ id, opts, onChanged }: { id: number; opts: BroFieldOptions; onChanged: () => void }) {
  const detail = useGetBroFieldLead(id);
  const [editing, setEditing] = useState(false);
  if (detail.isLoading) return <div className="panel space-y-3 p-5"><div className="skeleton h-8 w-48 rounded" /><div className="skeleton h-40 rounded-xl" /></div>;
  if (detail.isError || !detail.data) return <ErrorState message={errorText(detail.error, 'Lead could not be loaded.')} retry={() => { void detail.refetch(); }} />;
  const { lead, history, transfers } = detail.data;
  const brName = (uid: number | null) => uid == null ? 'Released' : (opts.bros.find(b => b.id === uid)?.name ?? `BRO #${uid}`);
  const school = lead.schoolId == null ? '—' : (opts.schools.find(s => s.id === lead.schoolId)?.name ?? `#${lead.schoolId}`);
  const pendingTransfer = transfers.find(t => t.status === 'PENDING');

  return (
    <div className="space-y-4">
      {editing && !opts.isOwner ? <LeadForm lead={lead} opts={opts} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); onChanged(); }} /> : (
        <div className="panel p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="display-font text-xl font-bold">{lead.schoolName}</h2><div className="text-xs text-[hsl(var(--muted-foreground))]">{lead.address}</div></div>
            <StatusPill value={lead.status} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-[hsl(var(--muted-foreground))]">Contact</dt><dd>{lead.contactPerson || '—'} {lead.contactPhone ? `· ${lead.contactPhone}` : ''}</dd>
            <dt className="text-[hsl(var(--muted-foreground))]">Visit date</dt><dd>{lead.visitDate}</dd>
            <dt className="text-[hsl(var(--muted-foreground))]">Person met</dt><dd>{lead.personMet}</dd>
            <dt className="text-[hsl(var(--muted-foreground))]">Interest</dt><dd>{lead.interestLevel}</dd>
            <dt className="text-[hsl(var(--muted-foreground))]">Next follow-up</dt><dd>{lead.nextFollowUpDate || '—'}</dd>
            <dt className="text-[hsl(var(--muted-foreground))]">Existing school</dt><dd>{school}</dd>
            <dt className="text-[hsl(var(--muted-foreground))]">Original owner</dt><dd>{brName(lead.originalOwnerId)}</dd>
            <dt className="text-[hsl(var(--muted-foreground))]">Current owner</dt><dd>{brName(lead.currentOwnerId)}</dd>
            <dt className="text-[hsl(var(--muted-foreground))]">Version</dt><dd>{lead.version}</dd>
          </dl>
          {lead.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{lead.notes}</p>}
          {!opts.isOwner && <div className="mt-4 flex justify-end"><Button variant="outline" onClick={() => setEditing(true)} testId="field-edit">Record update</Button></div>}
        </div>)}

      <TransferPanel leadId={lead.id} opts={opts} pending={pendingTransfer} onChanged={onChanged} />

      <div className="panel p-5">
        <h3 className="mb-3 font-bold">Transfers</h3>
        {transfers.length === 0 ? <p className="text-sm text-[hsl(var(--muted-foreground))]">No transfer requests.</p> : <ul className="space-y-2 text-sm">
          {transfers.map(t => <li key={t.id} className="rounded-xl border border-[hsl(var(--border))] p-3">
            <div className="flex justify-between gap-2"><span>{brName(t.fromOwnerId)} → {brName(t.targetOwnerId)}</span><StatusPill value={t.status} /></div>
            <div className="mt-1 text-xs">Reason: {t.reason}</div>
            {t.decisionReason && <div className="mt-1 text-xs">Decision: {t.decisionReason}{t.decidedBy != null ? ` (by #${t.decidedBy})` : ''}</div>}
            <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{date(t.createdAt)}</div>
          </li>)}
        </ul>}
      </div>

      <div className="panel p-5">
        <h3 className="mb-3 font-bold">Audit history</h3>
        {history.length === 0 ? <p className="text-sm text-[hsl(var(--muted-foreground))]">No history.</p> : <ul className="space-y-2 text-xs">
          {history.map((h, i) => <li key={i} className="rounded-xl border border-[hsl(var(--border))] p-3">
            <div className="font-bold">{h.action} · user #{h.actorUserId} · {date(h.createdAt)}</div>
            <div className="mt-1 break-words text-[hsl(var(--muted-foreground))]">
              {Object.entries(h.snapshot ?? {}).map(([k, v]) => `${k}: ${v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}
            </div>
          </li>)}
        </ul>}
      </div>
    </div>
  );
}

function TransferPanel({ leadId, opts, pending, onChanged }: { leadId: number; opts: BroFieldOptions; pending?: { id: number }; onChanged: () => void }) {
  const request = useRequestBroFieldTransfer();
  const decide = useDecideBroFieldTransfer();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setMsg(null); }, [leadId]);
  const reasonOk = reason.trim().length >= 5 && reason.trim().length <= 500;
  const targetOk = target === '' || /^\d+$/.test(target);
  const busy = request.isPending || decide.isPending;
  const done = (text: string) => () => { setReason(''); setTarget(''); setMsg(text); onChanged(); };
  const fail = (e: unknown) => setMsg(errorText(e, 'Transfer action failed.'));

  return (
    <div className="panel space-y-3 p-5" data-testid="field-transfer">
      <h3 className="font-bold">Ownership transfer</h3>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Current ownership changes only after Owner approval. Original ownership never changes.</p>
      {opts.isOwner ? <Field label="Proposed target"><select value={target} onChange={e => setTarget(e.target.value)}>
        <option value="">Release (no owner)</option>{opts.bros.map(b => <option key={b.id} value={b.id}>{b.name} (#{b.id})</option>)}
      </select></Field> : <Field label="Target BRO reference (blank = release)"><input inputMode="numeric" value={target} onChange={e => setTarget(e.target.value)} placeholder="e.g. 42" /></Field>}
      <Field label="Reason (5–500 characters)"><textarea rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {msg && <div role="status" className="rounded-xl bg-[hsl(var(--muted)/.5)] p-3 text-sm">{msg}</div>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy || !reasonOk || !targetOk || !!pending} onClick={() => request.mutate({ id: leadId, data: { targetOwnerId: target ? Number(target) : null, reason: reason.trim() } }, { onSuccess: done('Transfer requested; pending Owner decision.'), onError: fail })}>Request transfer</Button>
        {opts.isOwner && pending && <>
          <Button variant="danger" disabled={busy || !reasonOk} onClick={() => decide.mutate({ id: pending.id, data: { decision: 'REJECTED', reason: reason.trim() } }, { onSuccess: done('Transfer rejected.'), onError: fail })}>Reject pending</Button>
          <Button disabled={busy || !reasonOk} onClick={() => decide.mutate({ id: pending.id, data: { decision: 'APPROVED', reason: reason.trim() } }, { onSuccess: done('Transfer approved.'), onError: fail })}>Approve pending</Button>
        </>}
      </div>
      {pending && !opts.isOwner && <p className="text-xs text-[hsl(var(--muted-foreground))]">A transfer request is pending Owner decision.</p>}
    </div>
  );
}
