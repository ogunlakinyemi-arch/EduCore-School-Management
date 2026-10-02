import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Plus, Pencil, Archive, History, Eye, EyeOff, LifeBuoy } from 'lucide-react';
import {
  useListStudentWelfareRecords, useCreateStudentWelfareRecord, useUpdateStudentWelfareRecord, useArchiveStudentWelfareRecord,
  useListStudentWelfareHistory, useListSchoolUsers,
} from '@workspace/api-client-react';
import { Button, Modal, EmptyState, StatusPill, date, time } from '@/components/shared';
import {
  WELFARE_CATEGORIES, WELFARE_FOLLOW_UP, WELFARE_STATUS, emptyWelfare, welfareFromRecord, welfarePayload, validateWelfare,
  type WelfareForm, idempotencyHeaders, versionHeaders, errorInfo, label,
} from './care-contract';
import { Banner, ConfirmArchive, DeniedState, FieldRow, HistoryList, SkeletonRows, Select, inputCls, useAttemptKey, Chip } from './care-ui';
import { invalidateCare } from './medical-panel';

function WelfareDialog({ schoolId, studentId, record, onClose }: { schoolId: number; studentId: number; record: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<WelfareForm>(() => (record ? welfareFromRecord(record) : emptyWelfare()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, rotate] = useAttemptKey();
  const create = useCreateStudentWelfareRecord({ request: { headers: idempotencyHeaders(key) } });
  const update = useUpdateStudentWelfareRecord();
  const m = record ? update : create;
  const users = useListSchoolUsers({ schoolId }, { query: { retry: false, queryKey: [`/api/school-users`, schoolId] } });
  const staff = (users.data ?? []).filter(u => u.membershipStatus?.toUpperCase() === 'ACTIVE' && u.role !== 'PARENT' && u.role !== 'STUDENT');
  const set = (k: keyof WelfareForm, v: any) => setForm(f => ({ ...f, [k]: v }));
  const safeguarding = form.category === 'SAFEGUARDING';
  const done = async () => { rotate(); await invalidateCare(qc, schoolId, studentId); onClose(); };
  const submit = () => {
    const e = validateWelfare(form); setErrors(e);
    if (Object.keys(e).length || m.isPending) return;
    const data = welfarePayload(form);
    if (record) update.mutate({ schoolId, studentId, recordId: record.id, data: { ...data, expectedVersion: record.version } as any }, { onSuccess: done });
    else create.mutate({ schoolId, studentId, data: data as any }, { onSuccess: done });
  };
  const err = m.error ? errorInfo(m.error) : null;
  return (
    <Modal title={record ? 'Update welfare record' : 'Open welfare record'} eyebrow={safeguarding ? 'Safeguarding — restricted' : 'Student welfare'} onClose={onClose}>
      <div className="space-y-4">
        {err && <Banner tone="error">{err.conflict ? 'This record was changed by someone else. Close and reopen to load the latest.' : err.denied ? 'You do not have permission for this category.' : err.message}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Category"><Select value={form.category} onChange={v => set('category', v)} options={[...WELFARE_CATEGORIES]} /></FieldRow>
          <FieldRow label="Status"><Select value={form.status} onChange={v => set('status', v)} options={[...WELFARE_STATUS]} /></FieldRow>
        </div>
        <FieldRow label="Concern" error={errors.concern}><textarea rows={3} className={inputCls} value={form.concern} onChange={e => set('concern', e.target.value)} /></FieldRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Assigned staff">
            {staff.length ? <Select value={form.assignedStaffUserId} onChange={v => set('assignedStaffUserId', v)} blank="Unassigned" options={staff.map(u => ({ value: String(u.id), label: `${u.firstName ?? ''} ${u.lastName ?? ''} (${label(u.role)})`.trim() }))} /> : <input className={inputCls} inputMode="numeric" placeholder="Staff user ID (optional)" value={form.assignedStaffUserId} onChange={e => set('assignedStaffUserId', e.target.value.replace(/\D/g, ''))} />}
          </FieldRow>
          <FieldRow label="Follow-up status"><Select value={form.followUpStatus} onChange={v => set('followUpStatus', v)} options={[...WELFARE_FOLLOW_UP]} /></FieldRow>
        </div>
        <FieldRow label="Follow-up date" error={errors.followUpAt}><input type="datetime-local" className={inputCls} value={form.followUpAt} onChange={e => set('followUpAt', e.target.value)} /></FieldRow>
        <FieldRow label="Resolution" error={errors.resolution}><textarea rows={2} className={inputCls} value={form.resolution} onChange={e => set('resolution', e.target.value)} /></FieldRow>
        <FieldRow label="Confidential internal notes" hint="Never shown to families."><textarea rows={3} className={inputCls} value={form.internalNotes} onChange={e => set('internalNotes', e.target.value)} /></FieldRow>
        <label className="flex items-start gap-3 rounded-xl bg-[hsl(var(--muted)/.5)] p-3 text-sm">
          <input type="checkbox" className="mt-1" disabled={safeguarding} checked={safeguarding ? false : form.parentVisible} onChange={e => set('parentVisible', e.target.checked)} />
          <span><strong>Share a summary with the family.</strong><span className="block text-xs text-[hsl(var(--muted-foreground))]">{safeguarding ? 'Safeguarding records are never shared with families.' : 'Families see only the category, concern, status and update date. Notes and resolution stay private.'}</span></span>
        </label>
        <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button disabled={m.isPending} onClick={submit} testId="button-save-welfare">{m.isPending ? 'Saving…' : record ? 'Save changes' : 'Open record'}</Button></div>
      </div>
    </Modal>
  );
}

function History_({ schoolId, studentId, recordId, onClose }: { schoolId: number; studentId: number; recordId: number; onClose: () => void }) {
  const q = useListStudentWelfareHistory(schoolId, studentId, recordId);
  return <Modal title="Record history" eyebrow="Revisions" onClose={onClose}><HistoryList rows={q.data as any} loading={q.isLoading} error={q.error} /></Modal>;
}

export function WelfarePanel({ schoolId, studentId }: { schoolId: number; studentId: number }) {
  const qc = useQueryClient();
  const q = useListStudentWelfareRecords(schoolId, studentId, { query: { retry: false, queryKey: [`/api/schools/${schoolId}/students/${studentId}/welfare`] } });
  const [dlg, setDlg] = useState<{ record: any | null } | null>(null);
  const [hist, setHist] = useState<number | null>(null);
  const [arch, setArch] = useState<any | null>(null);
  const archive = useArchiveStudentWelfareRecord({ request: { headers: versionHeaders(arch?.version ?? 1) } });
  if (errorInfo(q.error).denied) return <DeniedState what="Welfare and safeguarding records" />;
  const list = ((q.data as any[]) ?? []).filter(r => !r.archivedAt);
  return (
    <section className="panel p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><LifeBuoy size={18} className="text-[hsl(var(--primary))]" /><h3 className="display-font text-xl font-bold">Welfare and safeguarding</h3></div>
        <Button onClick={() => setDlg({ record: null })} testId="button-new-welfare"><Plus size={14} />New record</Button>
      </div>
      <p className="mb-4 text-xs text-[hsl(var(--muted-foreground))]">Safeguarding records only appear if your account holds the safeguarding grant.</p>
      {q.isLoading ? <SkeletonRows /> : q.isError ? <Banner tone="error">{errorInfo(q.error).message} <button className="ml-2 underline" onClick={() => q.refetch()}>Retry</button></Banner> : !list.length ? (
        <EmptyState icon={LifeBuoy} title="No welfare records" description="Concerns, referrals and support plans for this student will appear here." />
      ) : (
        <ul className="space-y-3">
          {list.map(r => (
            <li key={r.id} className="rounded-2xl border border-[hsl(var(--border))] p-4" data-testid={`welfare-${r.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.category === 'SAFEGUARDING' && <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--destructive)/.12)] px-2.5 py-1 text-[11px] font-bold text-[hsl(var(--destructive))]"><ShieldAlert size={12} />Restricted</span>}
                    <Chip>{label(r.category)}</Chip><StatusPill value={label(r.status)} /><Chip>Follow-up: {label(r.followUpStatus)}</Chip>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[hsl(var(--muted-foreground))]">{r.parentVisible ? <><Eye size={12} />Summary shared</> : <><EyeOff size={12} />Staff only</>}</span>
                  </div>
                  <p className="text-sm font-semibold">{r.concern}</p>
                </div>
                <div className="flex gap-1"><Button variant="quiet" onClick={() => setHist(r.id)}><History size={14} /></Button><Button variant="quiet" onClick={() => setDlg({ record: r })}><Pencil size={14} /></Button><Button variant="quiet" onClick={() => setArch(r)}><Archive size={14} /></Button></div>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {([['Assigned staff', r.assignedStaffUserId ? `User #${r.assignedStaffUserId}` : null], ['Follow-up due', r.followUpAt ? `${date(r.followUpAt)} ${time(r.followUpAt)}` : null], ['Resolution', r.resolution], ['Internal notes', r.internalNotes]] as const).filter(([, x]) => x).map(([l, x]) => <div key={l}><dt className="eyebrow">{l}</dt><dd className="whitespace-pre-wrap">{x}</dd></div>)}
              </dl>
            </li>
          ))}
        </ul>
      )}
      {dlg && <WelfareDialog schoolId={schoolId} studentId={studentId} record={dlg.record} onClose={() => setDlg(null)} />}
      {hist && <History_ schoolId={schoolId} studentId={studentId} recordId={hist} onClose={() => setHist(null)} />}
      {arch && <ConfirmArchive title="Archive this record?" body="It leaves the active list; revision history is preserved." busy={archive.isPending} error={archive.error} onClose={() => setArch(null)} onConfirm={() => archive.mutate({ schoolId, studentId, recordId: arch.id }, { onSuccess: async () => { await invalidateCare(qc, schoolId, studentId); setArch(null); } })} />}
    </section>
  );
}
