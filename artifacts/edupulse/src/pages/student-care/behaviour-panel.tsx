import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Archive, History, Send, BellRing, Gavel } from 'lucide-react';
import {
  useListStudentBehaviourRecords, useCreateStudentBehaviourRecord, useProgressStudentBehaviourRecord, useArchiveStudentBehaviourRecord,
  useListStudentBehaviourHistory, useListBehaviourConfiguration, useUpdateBehaviourConfiguration, useListClasses, useListSubjects,
  getListBehaviourConfigurationQueryKey,
} from '@workspace/api-client-react';
import { Button, Modal, EmptyState, StatusPill, date, time } from '@/components/shared';
import {
  BEHAVIOUR_TYPES, BEHAVIOUR_STATUS, SEVERITIES, emptyBehaviour, behaviourFromRecord, behaviourPayload, validateBehaviour, behaviourProgressPayload,
  type BehaviourForm, idempotencyHeaders, versionHeaders, errorInfo, label, notificationTruth, splitLines, joinLines,
} from './care-contract';
import { Banner, ConfirmArchive, DeniedState, FieldRow, HistoryList, SkeletonRows, Select, inputCls, useAttemptKey, Chip } from './care-ui';
import { invalidateCare } from './medical-panel';

function BehaviourDialog({ schoolId, studentId, record, onClose }: { schoolId: number; studentId: number; record: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<BehaviourForm>(() => (record ? behaviourFromRecord(record) : emptyBehaviour()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, rotate] = useAttemptKey();
  const create = useCreateStudentBehaviourRecord({ request: { headers: idempotencyHeaders(key) } });
  const update = useProgressStudentBehaviourRecord();
  const m = record ? update : create;
  const config = useListBehaviourConfiguration(schoolId, { query: { retry: false, queryKey: getListBehaviourConfigurationQueryKey(schoolId) } });
  const classes = useListClasses({ schoolId }, { query: { retry: false, queryKey: ['care-classes', schoolId] } });
  const subjects = useListSubjects({ schoolId }, { query: { retry: false, queryKey: ['care-subjects', schoolId] } });
  const categories = (config.data?.categories?.length ? config.data.categories : [...BEHAVIOUR_TYPES]) as string[];
  const actions = config.data?.actions ?? [];
  const set = (k: keyof BehaviourForm, v: any) => setForm(f => ({ ...f, [k]: v }));
  const done = async () => { rotate(); await invalidateCare(qc, schoolId, studentId); onClose(); };
  const submit = () => {
    const e = validateBehaviour(form); setErrors(e);
    if (Object.keys(e).length || m.isPending) return;
    const data = behaviourPayload(form) as any;
    if (record) update.mutate({ schoolId, studentId, recordId: record.id, data: { ...data, expectedVersion: record.version } }, { onSuccess: done });
    else create.mutate({ schoolId, studentId, data }, { onSuccess: done });
  };
  const err = m.error ? errorInfo(m.error) : null;
  return (
    <Modal title={record ? 'Edit behaviour record' : 'Log behaviour'} eyebrow="Behaviour" onClose={onClose}>
      <div className="space-y-4">
        {err && <Banner tone="error">{err.conflict ? 'This record changed since you opened it. Close and reopen to load the latest.' : err.message}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Type"><Select value={form.category} onChange={v => set('category', v)} options={categories} /></FieldRow>
          <FieldRow label="Severity"><Select value={form.severity} onChange={v => set('severity', v)} options={[...SEVERITIES]} /></FieldRow>
          <FieldRow label="When" error={errors.occurredAt}><input type="datetime-local" className={inputCls} value={form.occurredAt} onChange={e => set('occurredAt', e.target.value)} /></FieldRow>
          <FieldRow label="Location"><input className={inputCls} value={form.location} onChange={e => set('location', e.target.value)} placeholder="Assembly hall, Class 4B…" /></FieldRow>
          <FieldRow label="Class"><Select value={form.schoolClassId} onChange={v => set('schoolClassId', v)} blank="Not class specific" options={(classes.data ?? []).map(c => ({ value: String(c.id), label: `${c.name} ${c.section}` }))} /></FieldRow>
          <FieldRow label="Subject"><Select value={form.subjectId} onChange={v => set('subjectId', v)} blank="No subject" options={(subjects.data ?? []).map(s => ({ value: String(s.id), label: s.name }))} /></FieldRow>
        </div>
        <FieldRow label="What happened (family-safe wording)" error={errors.description} hint="This text can be shown to the family when parent-visible."><textarea rows={3} className={inputCls} value={form.description} onChange={e => set('description', e.target.value)} /></FieldRow>
        <FieldRow label="Action taken">
          <input className={inputCls} list="care-actions" value={form.action} onChange={e => set('action', e.target.value)} />
          <datalist id="care-actions">{actions.map(a => <option key={a} value={a} />)}</datalist>
        </FieldRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Follow-up date"><input type="datetime-local" className={inputCls} value={form.followUpAt} onChange={e => set('followUpAt', e.target.value)} /></FieldRow>
          <FieldRow label="Follow-up notes"><input className={inputCls} value={form.followUpNotes} onChange={e => set('followUpNotes', e.target.value)} /></FieldRow>
        </div>
        <FieldRow label="Resolution"><textarea rows={2} className={inputCls} value={form.resolution} onChange={e => set('resolution', e.target.value)} /></FieldRow>
        <FieldRow label="Internal notes" hint="Staff only. Never shown to families."><textarea rows={3} className={inputCls} value={form.internalNotes} onChange={e => set('internalNotes', e.target.value)} /></FieldRow>
        <label className="flex items-start gap-3 rounded-xl bg-[hsl(var(--muted)/.5)] p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={form.parentVisible} onChange={e => set('parentVisible', e.target.checked)} />
          <span><strong>Show a summary to the family.</strong><span className="block text-xs text-[hsl(var(--muted-foreground))]">Families see the type, description, status and date only.</span></span>
        </label>
        <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button disabled={m.isPending} onClick={submit} testId="button-save-behaviour">{m.isPending ? 'Saving…' : record ? 'Save changes' : 'Log behaviour'}</Button></div>
      </div>
    </Modal>
  );
}

function BehaviourHistory({ schoolId, studentId, recordId, onClose }: { schoolId: number; studentId: number; recordId: number; onClose: () => void }) {
  const q = useListStudentBehaviourHistory(schoolId, studentId, recordId);
  return <Modal title="Behaviour history" eyebrow="Revisions" onClose={onClose}><HistoryList rows={q.data as any} loading={q.isLoading} error={q.error} /></Modal>;
}

export function BehaviourPanel({ schoolId, studentId }: { schoolId: number; studentId: number }) {
  const qc = useQueryClient();
  const q = useListStudentBehaviourRecords(schoolId, studentId, { query: { retry: false, queryKey: [`/api/schools/${schoolId}/students/${studentId}/behaviour`] } });
  const [dlg, setDlg] = useState<{ record: any | null } | null>(null);
  const [hist, setHist] = useState<number | null>(null);
  const [arch, setArch] = useState<any | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const archive = useArchiveStudentBehaviourRecord({ request: { headers: versionHeaders(arch?.version ?? 1) } });
  const progress = useProgressStudentBehaviourRecord();
  if (errorInfo(q.error).denied) return <DeniedState what="Behaviour records" />;
  const list = ((q.data as any[]) ?? []).filter(r => !r.archivedAt);

  const move = (r: any, status: string, notify = false) => {
    if (progress.isPending) return;
    setNotice(null);
    progress.mutate({ schoolId, studentId, recordId: r.id, data: behaviourProgressPayload(r, status, r.version, notify) }, {
      onSuccess: async (res: any) => { await invalidateCare(qc, schoolId, studentId); if (notify) setNotice(notificationTruth[res.parentNotificationStatus] ?? 'Updated.'); },
    });
  };
  const next = (s: string) => { const i = BEHAVIOUR_STATUS.indexOf(s as any); return i >= 0 && i < BEHAVIOUR_STATUS.length - 1 ? BEHAVIOUR_STATUS[i + 1] : null; };

  return (
    <section className="panel p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Gavel size={18} className="text-[hsl(var(--primary))]" /><h3 className="display-font text-xl font-bold">Behaviour log</h3></div>
        <Button onClick={() => setDlg({ record: null })} testId="button-new-behaviour"><Plus size={14} />Log behaviour</Button>
      </div>
      {notice && <div className="mb-4"><Banner tone="warn">{notice}</Banner></div>}
      {progress.error ? <div className="mb-4"><Banner tone="error">{errorInfo(progress.error).conflict ? 'Another staff member updated this record. Data has been refreshed.' : errorInfo(progress.error).message}</Banner></div> : null}
      {q.isLoading ? <SkeletonRows /> : q.isError ? <Banner tone="error">{errorInfo(q.error).message} <button className="ml-2 underline" onClick={() => q.refetch()}>Retry</button></Banner> : !list.length ? (
        <EmptyState icon={Gavel} title="No behaviour records" description="Recognition, concerns and incidents for this student appear here." />
      ) : (
        <ul className="space-y-3">
          {list.map(r => (
            <li key={r.id} className="rounded-2xl border border-[hsl(var(--border))] p-4" data-testid={`behaviour-${r.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2"><Chip>{label(r.category)}</Chip><Chip>{label(r.severity)}</Chip><StatusPill value={label(r.status)} /></div>
                  <p className="text-sm font-semibold">{r.description}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">{date(r.occurredAt)} {time(r.occurredAt)}{r.location ? ` · ${r.location}` : ''} · reported by staff #{r.reporterUserId}</p>
                </div>
                <div className="flex gap-1"><Button variant="quiet" onClick={() => setHist(r.id)}><History size={14} /></Button><Button variant="quiet" onClick={() => setDlg({ record: r })}><Pencil size={14} /></Button><Button variant="quiet" onClick={() => setArch(r)}><Archive size={14} /></Button></div>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {([['Action', r.action], ['Follow-up', r.followUpAt ? `${date(r.followUpAt)} ${r.followUpNotes ?? ''}` : r.followUpNotes], ['Resolution', r.resolution], ['Internal notes', r.internalNotes]] as const).filter(([, x]) => x).map(([l, x]) => <div key={l}><dt className="eyebrow">{l}</dt><dd className="whitespace-pre-wrap">{x}</dd></div>)}
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border)/.7)] pt-3">
                <span className="inline-flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]"><BellRing size={13} />{notificationTruth[r.parentNotificationStatus] ?? label(r.parentNotificationStatus)}</span>
                <span className="text-xs font-bold text-[hsl(var(--muted-foreground))]">{r.parentVisible ? 'Summary shared with family' : 'Staff only'}</span>
                <span className="ml-auto flex gap-2">
                  {r.status !== 'RESOLVED' && next(r.status) && <Button variant="outline" disabled={progress.isPending} onClick={() => move(r, next(r.status)!)}>Move to {label(next(r.status))}</Button>}
                  {r.status !== 'RESOLVED' && r.parentVisible && r.parentNotificationStatus === 'NOT_REQUESTED' && <Button variant="outline" disabled={progress.isPending} onClick={() => move(r, 'PARENT_NOTIFICATION', true)}><Send size={13} />Notify family</Button>}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {dlg && <BehaviourDialog schoolId={schoolId} studentId={studentId} record={dlg.record} onClose={() => setDlg(null)} />}
      {hist && <BehaviourHistory schoolId={schoolId} studentId={studentId} recordId={hist} onClose={() => setHist(null)} />}
      {arch && <ConfirmArchive title="Archive this behaviour record?" body="It leaves the active list; revision history is preserved." busy={archive.isPending} error={archive.error} onClose={() => setArch(null)} onConfirm={() => archive.mutate({ schoolId, studentId, recordId: arch.id }, { onSuccess: async () => { await invalidateCare(qc, schoolId, studentId); setArch(null); } })} />}
    </section>
  );
}

export function BehaviourConfigPanel({ schoolId }: { schoolId: number }) {
  const qc = useQueryClient();
  const q = useListBehaviourConfiguration(schoolId, { query: { retry: false, queryKey: getListBehaviourConfigurationQueryKey(schoolId) } });
  const save = useUpdateBehaviourConfiguration();
  const [cats, setCats] = useState<string | null>(null);
  const [acts, setActs] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  if (q.isLoading) return <SkeletonRows n={1} />;
  if (q.isError) return <Banner tone="error">{errorInfo(q.error).message}</Banner>;
  const version = Number(q.data?.version ?? 0);
  const catText = cats ?? joinLines(q.data?.categories);
  const actText = acts ?? joinLines(q.data?.actions);
  const submit = () => {
    if (save.isPending) return;
    setOk(false);
    save.mutate({ schoolId, data: { expectedVersion: version, categories: splitLines(catText), actions: splitLines(actText) } }, {
      onSuccess: async () => { setCats(null); setActs(null); setOk(true); await qc.invalidateQueries({ queryKey: getListBehaviourConfigurationQueryKey(schoolId) }); },
    });
  };
  const bad = !splitLines(catText).length;
  return (
    <section className="panel p-5 md:p-6">
      <h3 className="display-font text-xl font-bold">School behaviour options</h3>
      <p className="mb-4 mt-1 text-xs text-[hsl(var(--muted-foreground))]">Categories and actions staff choose from when logging behaviour. One per line.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <FieldRow label="Categories" error={bad ? 'At least one category is required.' : undefined}><textarea rows={6} className={inputCls} value={catText} onChange={e => setCats(e.target.value)} /></FieldRow>
        <FieldRow label="Actions"><textarea rows={6} className={inputCls} value={actText} onChange={e => setActs(e.target.value)} /></FieldRow>
      </div>
      <div className="mt-4 space-y-3">
        {save.error ? <Banner tone="error">{errorInfo(save.error).conflict ? 'Options were changed elsewhere. Reload to continue.' : errorInfo(save.error).message}</Banner> : null}
        {ok && <Banner tone="ok">Behaviour options saved.</Banner>}
        <Button disabled={save.isPending || bad} onClick={submit} testId="button-save-behaviour-config">{save.isPending ? 'Saving…' : 'Save options'}</Button>
      </div>
    </section>
  );
}

export { DeniedState };
