import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HeartPulse, Plus, Pencil, Archive, History, Stethoscope, Phone } from 'lucide-react';
import {
  useGetStudentMedicalProfile, useUpsertStudentMedicalProfile, useListStudentMedicalProfileHistory,
  useListStudentMedicalVisits, useCreateStudentMedicalVisit, useUpdateStudentMedicalVisit, useArchiveStudentMedicalVisit,
  useListStudentMedicalVisitHistory, useArchiveStudentMedicalProfile,
} from '@workspace/api-client-react';
import { Button, Modal, EmptyState, date, time } from '@/components/shared';
import {
  type MedicalForm, medicalFromRecord, medicalPayload, validateMedical, emptyVisit, visitFromRecord, visitPayload, validateVisit,
  type VisitForm, idempotencyHeaders, versionHeaders, errorInfo, label,
} from './care-contract';
import { Banner, ConfirmArchive, DeniedState, FieldRow, HistoryList, SkeletonRows, inputCls, useAttemptKey, Chip } from './care-ui';

export function invalidateCare(qc: ReturnType<typeof useQueryClient>, schoolId: number, studentId: number) {
  return qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(`/api/schools/${schoolId}/students/${studentId}/`) });
}

function ProfileDialog({ schoolId, studentId, profile, onClose }: { schoolId: number; studentId: number; profile: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<MedicalForm>(() => medicalFromRecord(profile));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, rotate] = useAttemptKey();
  const save = useUpsertStudentMedicalProfile({ request: { headers: idempotencyHeaders(key) } });
  const set = (k: keyof MedicalForm, v: any) => setForm(f => ({ ...f, [k]: v }));
  const submit = () => {
    const e = validateMedical(form); setErrors(e);
    if (Object.keys(e).length || save.isPending) return;
    save.mutate({ schoolId, studentId, data: medicalPayload(form, profile?.version ?? 0) }, {
      onSuccess: async () => { rotate(); await invalidateCare(qc, schoolId, studentId); onClose(); },
    });
  };
  const err = save.error ? errorInfo(save.error) : null;
  const text = (k: 'bloodGroup' | 'genotype', l: string) => <FieldRow label={l}><input className={inputCls} value={form[k]} onChange={e => set(k, e.target.value)} /></FieldRow>;
  const lines = (k: 'allergies' | 'conditions' | 'supportNeeds' | 'medications', l: string) => <FieldRow label={l} hint="One per line"><textarea rows={3} className={inputCls} value={form[k]} onChange={e => set(k, e.target.value)} /></FieldRow>;
  return (
    <Modal title={profile ? 'Edit medical profile' : 'Create medical profile'} eyebrow="Confidential" onClose={onClose}>
      <div className="space-y-4">
        {err && <Banner tone="error">{err.conflict ? 'Another staff member updated this profile. Close and reopen to load their changes.' : err.message}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">{text('bloodGroup', 'Blood group')}{text('genotype', 'Genotype')}</div>
        <div className="grid gap-4 sm:grid-cols-2">{lines('allergies', 'Allergies')}{lines('conditions', 'Conditions')}{lines('medications', 'Medication')}{lines('supportNeeds', 'Support needs')}</div>
        <FieldRow label="Emergency medical notes"><textarea rows={3} className={inputCls} value={form.emergencyMedicalNotes} onChange={e => set('emergencyMedicalNotes', e.target.value)} /></FieldRow>
        <div>
          <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Emergency contacts</span><Button variant="quiet" onClick={() => set('emergencyContacts', [...form.emergencyContacts, { name: '', phone: '', relationship: '' }])}><Plus size={14} />Add</Button></div>
          {form.emergencyContacts.map((c, i) => (
            <div key={i} className="mb-3 space-y-2 rounded-xl border border-[hsl(var(--border))] p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                {(['name', 'phone', 'relationship'] as const).map(f => <input key={f} aria-label={`Emergency contact ${f}`} placeholder={label(f)} className={inputCls} value={c[f]} onChange={e => set('emergencyContacts', form.emergencyContacts.map((x, j) => j === i ? { ...x, [f]: e.target.value } : x))} />)}
              </div>
              {errors[`ec${i}`] && <span role="alert" className="text-xs text-[hsl(var(--destructive))]">{errors[`ec${i}`]}</span>}
              <Button variant="quiet" onClick={() => set('emergencyContacts', form.emergencyContacts.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Healthcare providers</span><Button variant="quiet" onClick={() => set('providerContacts', [...form.providerContacts, { name: '', role: '', phone: '', email: '' }])}><Plus size={14} />Add</Button></div>
          {form.providerContacts.map((c, i) => (
            <div key={i} className="mb-3 space-y-2 rounded-xl border border-[hsl(var(--border))] p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {(['name', 'role', 'phone', 'email'] as const).map(f => <input key={f} aria-label={`Provider ${f}`} placeholder={label(f)} className={inputCls} value={c[f]} onChange={e => set('providerContacts', form.providerContacts.map((x, j) => j === i ? { ...x, [f]: e.target.value } : x))} />)}
              </div>
              {errors[`pc${i}`] && <span role="alert" className="text-xs text-[hsl(var(--destructive))]">{errors[`pc${i}`]}</span>}
              <Button variant="quiet" onClick={() => set('providerContacts', form.providerContacts.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button disabled={save.isPending} onClick={submit} testId="button-save-medical-profile">{save.isPending ? 'Saving…' : 'Save profile'}</Button></div>
      </div>
    </Modal>
  );
}

function VisitDialog({ schoolId, studentId, visit, onClose }: { schoolId: number; studentId: number; visit: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<VisitForm>(() => (visit ? visitFromRecord(visit) : emptyVisit()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, rotate] = useAttemptKey();
  const create = useCreateStudentMedicalVisit({ request: { headers: idempotencyHeaders(key) } });
  const update = useUpdateStudentMedicalVisit();
  const m = visit ? update : create;
  const set = (k: keyof VisitForm, v: string) => setForm(f => ({ ...f, [k]: v }));
  const done = async () => { rotate(); await invalidateCare(qc, schoolId, studentId); onClose(); };
  const submit = () => {
    const e = validateVisit(form); setErrors(e);
    if (Object.keys(e).length || m.isPending) return;
    if (visit) update.mutate({ schoolId, studentId, visitId: visit.id, data: { ...visitPayload(form), expectedVersion: visit.version } }, { onSuccess: done });
    else create.mutate({ schoolId, studentId, data: visitPayload(form) }, { onSuccess: done });
  };
  const err = m.error ? errorInfo(m.error) : null;
  const area = (k: keyof VisitForm, l: string) => <FieldRow label={l}><textarea rows={2} className={inputCls} value={form[k]} onChange={e => set(k, e.target.value)} /></FieldRow>;
  return (
    <Modal title={visit ? 'Edit sickbay visit' : 'Record sickbay visit'} eyebrow="Medical visit" onClose={onClose}>
      <div className="space-y-4">
        {err && <Banner tone="error">{err.conflict ? 'This visit was changed by someone else. Close and reopen to load the latest.' : err.message}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Date and time" error={errors.occurredAt}><input type="datetime-local" className={inputCls} value={form.occurredAt} onChange={e => set('occurredAt', e.target.value)} /></FieldRow>
          <FieldRow label="Reason" error={errors.reason}><input className={inputCls} value={form.reason} onChange={e => set('reason', e.target.value)} /></FieldRow>
        </div>
        {area('symptoms', 'Symptoms')}{area('observations', 'Observations')}{area('actionTaken', 'Action taken')}{area('treatment', 'Treatment')}{area('referral', 'Referral')}
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Follow-up date"><input type="datetime-local" className={inputCls} value={form.followUpAt} onChange={e => set('followUpAt', e.target.value)} /></FieldRow>
          {area('followUpNotes', 'Follow-up notes')}
        </div>
        {area('notes', 'Staff notes')}
        <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button disabled={m.isPending} onClick={submit} testId="button-save-visit">{m.isPending ? 'Saving…' : visit ? 'Save changes' : 'Record visit'}</Button></div>
      </div>
    </Modal>
  );
}

function VisitHistory({ schoolId, studentId, visitId, onClose }: { schoolId: number; studentId: number; visitId: number; onClose: () => void }) {
  const q = useListStudentMedicalVisitHistory(schoolId, studentId, visitId);
  return <Modal title="Visit history" eyebrow="Revisions" onClose={onClose}><HistoryList rows={q.data as any} loading={q.isLoading} error={q.error} /></Modal>;
}

export function MedicalPanel({ schoolId, studentId, canWriteHint = true }: { schoolId: number; studentId: number; canWriteHint?: boolean }) {
  const qc = useQueryClient();
  const profileQ = useGetStudentMedicalProfile(schoolId, studentId, { query: { retry: false, queryKey: [`/api/schools/${schoolId}/students/${studentId}/medical-profile`] } });
  const visitsQ = useListStudentMedicalVisits(schoolId, studentId, { query: { retry: false, queryKey: [`/api/schools/${schoolId}/students/${studentId}/medical-visits`] } });
  const [profileOpen, setProfileOpen] = useState(false);
  const [showProfileHistory, setShowProfileHistory] = useState(false);
  const [visitDlg, setVisitDlg] = useState<{ visit: any | null } | null>(null);
  const [histVisit, setHistVisit] = useState<number | null>(null);
  const [archVisit, setArchVisit] = useState<any | null>(null);
  const [archProfile, setArchProfile] = useState(false);
  const profile: any = profileQ.data;
  const archiveVisit = useArchiveStudentMedicalVisit({ request: { headers: versionHeaders(archVisit?.version ?? 1) } });
  const [rkey, rotateR] = useAttemptKey();
  const restore = useUpsertStudentMedicalProfile({ request: { headers: idempotencyHeaders(rkey) } });
  const archiveProfile = useArchiveStudentMedicalProfile({ request: { headers: versionHeaders(profile?.version ?? 1) } });
  const profileHist = useListStudentMedicalProfileHistory(schoolId, studentId, { query: { enabled: showProfileHistory, queryKey: [`/api/schools/${schoolId}/students/${studentId}/medical-profile/history`] } });

  const denied = errorInfo(profileQ.error).denied || errorInfo(visitsQ.error).denied;
  if (denied) return <DeniedState what="Medical information" />;
  const noProfile = errorInfo(profileQ.error).status === 404;
  const isArchived = !!profile?.archivedAt;
  const doRestore = () => {
    if (!profile || restore.isPending) return;
    restore.mutate({ schoolId, studentId, data: medicalPayload(medicalFromRecord(profile), profile.version) }, { onSuccess: async () => { rotateR(); await invalidateCare(qc, schoolId, studentId); } });
  };
  const list = ((visitsQ.data as any[]) ?? []).filter(v => !v.archivedAt);

  return (
    <div className="space-y-6">
      <section className="panel p-5 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><HeartPulse size={18} className="text-[hsl(var(--primary))]" /><h3 className="display-font text-xl font-bold">Medical profile</h3>{profile && <Chip>v{profile.version}</Chip>}</div>
          {canWriteHint && <div className="flex gap-2">
            {profile && <Button variant="quiet" onClick={() => setShowProfileHistory(s => !s)}><History size={14} />History</Button>}
            {profile && !isArchived && <Button variant="danger" onClick={() => setArchProfile(true)}><Archive size={14} />Archive</Button>}
            <Button onClick={() => setProfileOpen(true)} disabled={profileQ.isLoading} testId="button-edit-medical-profile"><Pencil size={14} />{profile ? 'Edit' : 'Create profile'}</Button>
            {isArchived && <Button variant="outline" disabled={restore.isPending} onClick={doRestore} testId="button-restore-medical-profile">{restore.isPending ? 'Restoring…' : 'Restore profile'}</Button>}
          </div>}
        </div>
        {isArchived && <div className="mb-4"><Banner tone="warn">This profile is archived and hidden from active use. Restore it to make it current again.</Banner></div>}
        {restore.error ? <div className="mb-4"><Banner tone="error">{errorInfo(restore.error).conflict ? 'The profile changed elsewhere. Refresh and try again.' : errorInfo(restore.error).message}</Banner></div> : null}
        {profileQ.isLoading ? <SkeletonRows n={2} /> : profileQ.isError && !noProfile ? <Banner tone="error">{errorInfo(profileQ.error).message} <button className="ml-2 underline" onClick={() => profileQ.refetch()}>Retry</button></Banner> : noProfile || !profile ? (
          <EmptyState icon={HeartPulse} title="No medical profile yet" description="Record allergies, conditions, medication and emergency contacts so staff can act quickly." />
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2"><Chip>Blood group: {profile.bloodGroup || '—'}</Chip><Chip>Genotype: {profile.genotype || '—'}</Chip></div>
            <div className="grid gap-4 sm:grid-cols-2">
              {([['Allergies', 'allergies'], ['Conditions', 'conditions'], ['Medication', 'medications'], ['Support needs', 'supportNeeds']] as const).map(([l, k]) => (
                <div key={k}><div className="eyebrow mb-1.5">{l}</div>{profile[k]?.length ? <div className="flex flex-wrap gap-1.5">{profile[k].map((x: string) => <Chip key={x}>{x}</Chip>)}</div> : <span className="text-[hsl(var(--muted-foreground))]">None recorded</span>}</div>
              ))}
            </div>
            {profile.emergencyMedicalNotes && <div><div className="eyebrow mb-1">Emergency notes</div><p className="whitespace-pre-wrap">{profile.emergencyMedicalNotes}</p></div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div><div className="eyebrow mb-1.5">Emergency contacts</div>{profile.emergencyContacts?.length ? profile.emergencyContacts.map((c: any, i: number) => <div key={i} className="flex items-center gap-2 py-1"><Phone size={13} /><span className="font-bold">{c.name}</span><span className="text-[hsl(var(--muted-foreground))]">{c.relationship} · {c.phone}</span></div>) : <span className="text-[hsl(var(--muted-foreground))]">None</span>}</div>
              <div><div className="eyebrow mb-1.5">Providers</div>{profile.providerContacts?.length ? profile.providerContacts.map((c: any, i: number) => <div key={i} className="py-1"><span className="font-bold">{c.name}</span> <span className="text-[hsl(var(--muted-foreground))]">{[c.role, c.phone, c.email].filter(Boolean).join(' · ')}</span></div>) : <span className="text-[hsl(var(--muted-foreground))]">None</span>}</div>
            </div>
            <div className="text-xs text-[hsl(var(--muted-foreground))]">Updated {date(profile.updatedAt)} {time(profile.updatedAt)}</div>
          </div>
        )}
        {showProfileHistory && <div className="mt-5 border-t border-[hsl(var(--border))] pt-4"><HistoryList rows={profileHist.data as any} loading={profileHist.isLoading} error={profileHist.error} /></div>}
      </section>

      <section className="panel p-5 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><Stethoscope size={18} className="text-[hsl(var(--primary))]" /><h3 className="display-font text-xl font-bold">Sickbay visits</h3></div>
          {canWriteHint && <Button onClick={() => setVisitDlg({ visit: null })} testId="button-new-visit"><Plus size={14} />New visit</Button>}
        </div>
        {visitsQ.isLoading ? <SkeletonRows /> : visitsQ.isError ? <Banner tone="error">{errorInfo(visitsQ.error).message} <button className="ml-2 underline" onClick={() => visitsQ.refetch()}>Retry</button></Banner> : !list.length ? (
          <EmptyState icon={Stethoscope} title="No visits recorded" description="Sickbay visits, treatment and follow-ups will be listed here." />
        ) : (
          <ul className="space-y-3">
            {list.map(v => (
              <li key={v.id} className="rounded-2xl border border-[hsl(var(--border))] p-4" data-testid={`visit-${v.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><div className="font-bold">{v.reason}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{date(v.occurredAt)} {time(v.occurredAt)} · staff #{v.recordedByUserId}</div></div>
                  <div className="flex gap-1"><Button variant="quiet" onClick={() => setHistVisit(v.id)}><History size={14} /></Button>{canWriteHint && <><Button variant="quiet" onClick={() => setVisitDlg({ visit: v })}><Pencil size={14} /></Button><Button variant="quiet" onClick={() => setArchVisit(v)}><Archive size={14} /></Button></>}</div>
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {([['Symptoms', v.symptoms], ['Observations', v.observations], ['Action taken', v.actionTaken], ['Treatment', v.treatment], ['Referral', v.referral], ['Follow-up', v.followUpAt ? `${date(v.followUpAt)} ${v.followUpNotes ?? ''}` : v.followUpNotes], ['Notes', v.notes]] as const).filter(([, x]) => x).map(([l, x]) => <div key={l}><dt className="eyebrow">{l}</dt><dd>{x}</dd></div>)}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      {profileOpen && <ProfileDialog schoolId={schoolId} studentId={studentId} profile={profile ?? null} onClose={() => setProfileOpen(false)} />}
      {visitDlg && <VisitDialog schoolId={schoolId} studentId={studentId} visit={visitDlg.visit} onClose={() => setVisitDlg(null)} />}
      {histVisit && <VisitHistory schoolId={schoolId} studentId={studentId} visitId={histVisit} onClose={() => setHistVisit(null)} />}
      {archVisit && <ConfirmArchive title="Archive this visit?" body="The visit leaves the active list. Its revision history is preserved." busy={archiveVisit.isPending} error={archiveVisit.error} onClose={() => setArchVisit(null)} onConfirm={() => archiveVisit.mutate({ schoolId, studentId, visitId: archVisit.id }, { onSuccess: async () => { await invalidateCare(qc, schoolId, studentId); setArchVisit(null); } })} />}
      {archProfile && <ConfirmArchive title="Archive medical profile?" body="The profile is hidden from staff until a new one is created." busy={archiveProfile.isPending} error={archiveProfile.error} onClose={() => setArchProfile(false)} onConfirm={() => archiveProfile.mutate({ schoolId, studentId }, { onSuccess: async () => { await invalidateCare(qc, schoolId, studentId); setArchProfile(false); } })} />}
    </div>
  );
}
