import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Copy, Download, ExternalLink, Paperclip, Plus, Search, Settings2, ShieldCheck } from 'lucide-react';
import {
  useListAdmissionApplications, getListAdmissionApplicationsQueryKey,
  useGetAdmissionApplication, getGetAdmissionApplicationQueryKey,
  useCreateStaffAdmissionApplication, useReviewAdmissionApplication, useTransitionAdmissionApplication,
  useRequestAdmissionDocumentUpload, useConfirmAdmissionDocumentUpload, useDownloadAdmissionDocument,
  useConvertAcceptedAdmissionApplication, useGetAdmissionPortalSettings, getGetAdmissionPortalSettingsQueryKey,
  useUpdateAdmissionPortalSettings,
  useListClasses, getListClassesQueryKey, useListStudents, getListStudentsQueryKey, useListParents, getListParentsQueryKey,
  useListAcademicSessions, getListAcademicSessionsQueryKey, useListAcademicTerms, getListAcademicTermsQueryKey,
  type AdmissionApplicationStatus, type AdmissionApplicationResponse, type AdmissionPortalSettingsInput,
} from '@workspace/api-client-react';
import {
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Modal, Field, Info, useTenant, useSchoolAdminAccess, cx, date,
} from '@/components/shared';
import { useStageStaffAdmissionDocument, useUpdateAdmissionApplicationFields } from './admissions-staff-api';
import { ApplicationForm, type SubmitPayload, type UploadFn } from './application-form';
import {
  STATUS_VALUES, TRANSITION_VALUES, apiMessage, canConvert, liveKeyRequest, resolveRequestKey, portalUrlFor,
  uploadInput, putToSignedUrl, checkFile, resolvePortalUrl, formFromApplication, buildPayload, type KeyHolder,
} from './admissions-lib';

type Tab = 'applications' | 'new' | 'settings';

export function AdmissionsPage() {
  const { schoolId } = useTenant();
  const { canManageSchool } = useSchoolAdminAccess();
  const [tab, setTab] = useState<Tab>('applications');
  return (
    <div className="fade-up">
      <PageHeading eyebrow="Admissions" title="Admissions." description="Receive applications, review them, and bring accepted applicants into your student records." />
      {!canManageSchool || !schoolId ? (
        <EmptyState icon={ShieldCheck} title="School Admin access required" description="Admissions are managed by an active School Admin of the school they belong to." />
      ) : (
        <>
          <div className="mb-6 flex gap-2 overflow-auto" role="tablist">
            {([['applications', 'Applications', ClipboardList], ['new', 'New application', Plus], ['settings', 'Portal settings', Settings2]] as const).map(([k, label, Icon]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`tab-admissions-${k}`}
                className={cx('inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-bold', tab === k ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-md' : 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]')}>
                <Icon size={15} />{label}
              </button>
            ))}
          </div>
          {tab === 'applications' && <ApplicationsList schoolId={schoolId} />}
          {tab === 'new' && <StaffNewApplication schoolId={schoolId} onDone={() => setTab('applications')} />}
          {tab === 'settings' && <PortalSettings schoolId={schoolId} />}
        </>
      )}
    </div>
  );
}

function ApplicationsList({ schoolId }: { schoolId: number }) {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState<AdmissionApplicationStatus | ''>('');
  const [openId, setOpenId] = useState<number | null>(null);
  const params = { schoolId, ...(status ? { status } : {}), ...(search.trim() ? { search: search.trim() } : {}) };
  const q = useListAdmissionApplications(params, { query: { queryKey: getListAdmissionApplicationsQueryKey(params) } });
  const apps = q.data?.applications ?? [];
  return (
    <>
      <div className="panel mb-6 flex flex-col gap-4 p-4 md:flex-row">
        <label className="relative flex-1">
          <Search className="absolute left-4 top-3 text-[hsl(var(--muted-foreground))]" size={18} />
          <input className="pl-11" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by applicant, guardian or application number" aria-label="Search applications" data-testid="input-search-applications" />
        </label>
        <select value={status} onChange={e => setStatus(e.target.value as AdmissionApplicationStatus | '')} aria-label="Filter by status" data-testid="select-status-filter">
          <option value="">All statuses</option>
          {STATUS_VALUES.map(s => <option key={s} value={s}>{s.replace(/([a-z])([A-Z])/g, '$1 $2')}</option>)}
        </select>
      </div>
      {q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => q.refetch()} message="Applications could not be loaded." /> : (
        <div className="panel overflow-hidden">
          {apps.length ? apps.map(a => (
            <button key={a.id} onClick={() => setOpenId(a.id)} className="grid w-full gap-2 border-b border-[hsl(var(--border)/.6)] px-5 py-4 text-left transition-colors last:border-0 hover:bg-[hsl(var(--muted)/.2)] md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center md:px-6" data-testid={`row-application-${a.id}`}>
              <div><div className="text-sm font-bold">{a.applicant.firstName} {a.applicant.lastName}</div><div className="mt-1 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">{a.applicationNumber}</div></div>
              <div className="text-sm">{a.guardian.fullName}<div className="text-[11px] text-[hsl(var(--muted-foreground))]">{a.guardian.phone}</div></div>
              <div className="text-[11px] text-[hsl(var(--muted-foreground))]">Updated {date(a.updatedAt)}</div>
              <StatusPill value={a.status} />
            </button>
          )) : <EmptyState icon={ClipboardList} title="No applications found" description="Applications from your public portal and staff entries appear here. Adjust the filters or share your portal link." />}
        </div>
      )}
      {openId !== null && (
        <Modal title="Application" eyebrow="Admissions review" onClose={() => setOpenId(null)}>
          <ApplicationDetail schoolId={schoolId} applicationId={openId} />
        </Modal>
      )}
    </>
  );
}

function ApplicationDetail({ schoolId, applicationId }: { schoolId: number; applicationId: number }) {
  const qc = useQueryClient();
  const params = { schoolId };
  const key = getGetAdmissionApplicationQueryKey(applicationId, params);
  const q = useGetAdmissionApplication(applicationId, params, { query: { queryKey: key } });
  const review = useReviewAdmissionApplication();
  const transition = useTransitionAdmissionApplication();
  const requestUpload = useRequestAdmissionDocumentUpload();
  const confirm = useConfirmAdmissionDocumentUpload();
  const download = useDownloadAdmissionDocument();
  const [internalNotes, setInternalNotes] = useState(''); const [publicMessage, setPublicMessage] = useState('');
  const [assessResult, setAssessResult] = useState(''); const [assessScore, setAssessScore] = useState('');
  const [interviewAt, setInterviewAt] = useState(''); const [interviewResult, setInterviewResult] = useState('');
  const [nextStatus, setNextStatus] = useState<AdmissionApplicationStatus | ''>(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [docType, setDocType] = useState('');
  const [editing, setEditing] = useState(false);
  const patch = useUpdateAdmissionApplicationFields();
  const initFor = useRef<string>('');
  const app = q.data;

  useEffect(() => {
    if (!app) return;
    const marker = `${app.id}:${app.version}`;
    if (initFor.current === marker) return;
    initFor.current = marker;
    setInternalNotes(app.internalNotes ?? ''); setPublicMessage(app.publicMessage ?? '');
    const a = (app.assessment ?? {}) as Record<string, unknown>; const i = (app.interview ?? {}) as Record<string, unknown>;
    setAssessResult(String(a.result ?? '')); setAssessScore(a.score == null ? '' : String(a.score));
    setInterviewAt(typeof i.scheduledAt === 'string' ? i.scheduledAt.slice(0, 16) : ''); setInterviewResult(String(i.result ?? ''));
    setNextStatus('');
  }, [app]);

  const refresh = (updated?: AdmissionApplicationResponse) => {
    if (updated) qc.setQueryData(key, updated);
    void qc.invalidateQueries({ queryKey: getListAdmissionApplicationsQueryKey() });
    void qc.invalidateQueries({ queryKey: key });
  };
  if (q.isLoading) return <SkeletonPage />;
  if (q.isError || !app) return <ErrorState retry={() => q.refetch()} message="This application could not be loaded." />;
  const fail = (e: unknown) => { setMsg(''); setErr(apiMessage(e)); };
  const ok = (m: string) => { setErr(''); setMsg(m); };

  const saveReview = (e: FormEvent) => {
    e.preventDefault();
    review.mutate({ applicationId: app.id, params, data: {
      expectedVersion: app.version, internalNotes, publicMessage,
      ...(assessResult || assessScore ? { assessment: { ...(assessResult ? { result: assessResult } : {}), ...(assessScore !== '' ? { score: Number(assessScore) } : {}) } } : {}),
      ...(interviewAt || interviewResult ? { interview: { ...(interviewAt ? { scheduledAt: new Date(interviewAt).toISOString() } : {}), ...(interviewResult ? { result: interviewResult } : {}) } } : {}),
    } }, { onSuccess: r => { refresh(r); ok('Review saved.'); }, onError: fail });
  };
  const doTransition = () => {
    if (!nextStatus) return;
    transition.mutate({ applicationId: app.id, params, data: { status: nextStatus, expectedVersion: app.version, publicMessage: publicMessage || null, internalNotes: internalNotes || null } },
      { onSuccess: r => { refresh(r); ok(`Status changed to ${r.status}.`); setNextStatus(''); }, onError: fail });
  };
  const open = (docId: number) => download.mutate({ applicationId: app.id, documentId: docId }, {
    onSuccess: r => { const a = document.createElement('a'); a.href = r.downloadUrl; a.rel = 'noopener'; a.target = '_blank'; a.click(); }, onError: fail,
  });
  const attach = async (file?: File) => {
    if (!file) return;
    const bad = checkFile(file, 'document'); if (bad) return setErr(bad);
    try {
      const type = docType.trim() || 'other';
      const t = await requestUpload.mutateAsync({ applicationId: app.id, params, data: uploadInput(file, type) });
      await putToSignedUrl(t.uploadUrl, file);
      await confirm.mutateAsync({ applicationId: app.id, params, data: { documentType: type, fileName: file.name, contentType: file.type as never, byteSize: file.size, objectPath: t.objectPath } });
      refresh(); ok('Document attached.'); setDocType('');
    } catch (e) { fail(e); }
  };
  const locked = app.status === 'Enrolled';
  const editable = app.status === 'Draft' || app.status === 'Submitted';
  const saveFields = (payload: ReturnType<typeof buildPayload>) => {
    patch.mutate({ applicationId: app.id, schoolId, data: {
      expectedVersion: app.version,
      applicant: { ...payload.applicant, middleName: payload.applicant.middleName ?? null },
      guardian: { ...payload.guardian, email: payload.guardian.email ?? undefined },
      emergencyContact: payload.emergencyContact ?? null,
    } }, { onSuccess: r => { refresh(r); ok('Application details updated.'); setEditing(false); }, onError: fail });
  };

  return (
    <div className="space-y-6" data-testid="application-detail">
      <div className="flex flex-wrap items-center gap-3"><span className="font-mono text-sm font-bold">{app.applicationNumber}</span><StatusPill value={app.status} /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Info label="Applicant" value={`${app.applicant.firstName} ${app.applicant.middleName ?? ''} ${app.applicant.lastName}`} />
        <Info label="Date of birth / gender" value={`${date(app.applicant.dateOfBirth)} / ${app.applicant.gender}`} />
        <Info label="Previous school" value={[app.applicant.previousSchool, app.applicant.previousClass].filter(Boolean).join(', ')} />
        <Info label="Address" value={app.applicant.address} />
        <Info label="Guardian" value={`${app.guardian.fullName} (${app.guardian.relationship ?? 'guardian'})`} />
        <Info label="Guardian contact" value={[app.guardian.phone, app.guardian.email].filter(Boolean).join(' / ')} />
        {app.emergencyContact && <Info className="sm:col-span-2" label="Emergency contact" value={`${app.emergencyContact.fullName}, ${app.emergencyContact.phone}`} />}
      </div>

      {editable && !editing && <Button variant="outline" onClick={() => setEditing(true)} testId="button-edit-application">Edit details</Button>}
      {editing && <EditFields schoolId={schoolId} app={app} pending={patch.isPending} onSave={saveFields} onCancel={() => setEditing(false)} error={err} />}

      <section>
        <div className="eyebrow mb-2">Documents</div>
        {app.documents?.length ? (
          <ul className="space-y-2">{app.documents.map(d => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-[hsl(var(--muted)/.5)] px-3 py-2 text-xs">
              <span><strong>{d.documentType}</strong> · {d.fileName}</span>
              <Button variant="quiet" disabled={download.isPending} onClick={() => open(d.id)} testId={`button-download-doc-${d.id}`}><Download size={14} />Download</Button>
            </li>))}</ul>
        ) : <p className="text-xs text-[hsl(var(--muted-foreground))]">No documents on file.</p>}
        {!locked && <div className="mt-3 flex flex-wrap items-center gap-3">
          <input className="max-w-[200px]" value={docType} onChange={e => setDocType(e.target.value)} placeholder="Document type" aria-label="Document type" />
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-bold"><Paperclip size={15} />Attach
            <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={requestUpload.isPending || confirm.isPending} onChange={e => { void attach(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>}
      </section>

      <form onSubmit={saveReview} className="space-y-4 border-t border-[hsl(var(--border))] pt-5">
        <div className="eyebrow">Review, assessment and interview</div>
        <Field label="Internal notes (staff only)"><textarea rows={3} value={internalNotes} onChange={e => setInternalNotes(e.target.value)} /></Field>
        <Field label="Public message (visible to the parent when tracking)"><textarea rows={2} value={publicMessage} onChange={e => setPublicMessage(e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assessment result"><input value={assessResult} onChange={e => setAssessResult(e.target.value)} /></Field>
          <Field label="Assessment score"><input type="number" min={0} value={assessScore} onChange={e => setAssessScore(e.target.value)} /></Field>
          <Field label="Interview date and time"><input type="datetime-local" value={interviewAt} onChange={e => setInterviewAt(e.target.value)} /></Field>
          <Field label="Interview result"><input value={interviewResult} onChange={e => setInterviewResult(e.target.value)} /></Field>
        </div>
        <Button type="submit" disabled={review.isPending || locked} testId="button-save-review">{review.isPending ? 'Saving…' : 'Save review'}</Button>
      </form>

      <div className="space-y-3 border-t border-[hsl(var(--border))] pt-5">
        <div className="eyebrow">Status</div>
        <div className="flex flex-wrap gap-3">
          <select value={nextStatus} onChange={e => setNextStatus(e.target.value as AdmissionApplicationStatus | '')} aria-label="New status" disabled={locked} data-testid="select-next-status">
            <option value="">Choose new status</option>
            {TRANSITION_VALUES.filter(s => s !== app.status).map(s => <option key={s} value={s}>{s.replace(/([a-z])([A-Z])/g, '$1 $2')}</option>)}
          </select>
          <Button disabled={!nextStatus || transition.isPending || locked} onClick={doTransition} testId="button-apply-status">{transition.isPending ? 'Updating…' : 'Apply status'}</Button>
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Drafts are completed by moving them to Submitted. The API has no field-level draft edit, so correct a draft by saving a new one.</p>
      </div>

      {canConvert(app) && <ConvertPanel schoolId={schoolId} app={app} onDone={refresh} />}
      {app.studentId && <p className="text-sm">Enrolled as student record <strong>#{app.studentId}</strong>.</p>}
      {msg && <p role="status" className="text-sm font-medium text-[hsl(var(--primary))]">{msg}</p>}
      {err && <p role="alert" className="text-sm font-medium text-[hsl(var(--destructive))]">{err}</p>}
    </div>
  );
}

function ConvertPanel({ schoolId, app, onDone }: { schoolId: number; app: AdmissionApplicationResponse; onDone: () => void }) {
  const students = useListStudents({ schoolId }, { query: { queryKey: getListStudentsQueryKey({ schoolId }) } });
  const parents = useListParents({ schoolId }, { query: { queryKey: getListParentsQueryKey({ schoolId }) } });
  const [studentId, setStudentId] = useState(''); const [parentId, setParentId] = useState('');
  const [createParent, setCreateParent] = useState(true); const [relationship, setRelationship] = useState(app.guardian.relationship ?? ''); const [section, setSection] = useState('');
  const [err, setErr] = useState(''); const [done, setDone] = useState<string>('');
  const keyRef = useRef(''); const holder = useRef<KeyHolder['current']>(null) as KeyHolder;
  const conv = useConvertAcceptedAdmissionApplication({ request: liveKeyRequest(keyRef) });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr('');
    const data = {
      expectedVersion: app.version,
      ...(studentId ? { existingStudentId: Number(studentId) } : {}),
      ...(parentId ? { existingParentId: Number(parentId) } : { createParentRecord: createParent }),
      ...(relationship.trim() ? { parentRelationship: relationship.trim() } : {}),
      ...(section.trim() ? { section: section.trim() } : {}),
    };
    keyRef.current = resolveRequestKey(holder, { id: app.id, ...data });
    conv.mutate({ applicationId: app.id, params: { schoolId }, data }, {
      onSuccess: r => { holder.current = null; setDone(`Student #${r.studentId}, admission number ${r.admissionNumber}${r.idempotent ? ' (already converted)' : ''}.`); setStudentId(''); setParentId(''); onDone(); },
      onError: x => setErr(apiMessage(x)),
    });
  };
  const sel = (rows: Array<{ id: number; label: string }>, v: string, set: (s: string) => void, none: string, label: string) => (
    <Field label={label}><select value={v} onChange={e => set(e.target.value)}><option value="">{none}</option>{rows.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
  );
  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-[hsl(var(--primary)/.3)] p-5" data-testid="form-convert">
      <div className="eyebrow">Convert to student</div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Link to an existing record to avoid re-entering details, or leave blank to create new ones.</p>
      {sel((students.data ?? []).map((s: { id: number; firstName: string; lastName: string; admissionNo?: string }) => ({ id: s.id, label: `${s.firstName} ${s.lastName} ${s.admissionNo ?? ''}` })), studentId, setStudentId, 'Create a new student', 'Existing student')}
      {sel((parents.data ?? []).map((p: { id: number; name: string; phone: string }) => ({ id: p.id, label: `${p.name} ${p.phone}` })), parentId, setParentId, 'No existing parent', 'Existing parent')}
      {!parentId && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={createParent} onChange={e => setCreateParent(e.target.checked)} />Create a parent record from the guardian details</label>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Parent relationship"><input value={relationship} onChange={e => setRelationship(e.target.value)} /></Field>
        <Field label="Section"><input value={section} onChange={e => setSection(e.target.value)} placeholder="e.g. A" /></Field>
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Conversion does not create a login. To activate an existing person, open <Link href="/users" className="font-bold underline">Users &amp; Roles</Link>; no new identity is created in the sign-in provider from here.</p>
      {err && <p role="alert" className="text-sm font-medium text-[hsl(var(--destructive))]">{err}</p>}
      {done && <p role="status" className="text-sm font-medium text-[hsl(var(--primary))]">{done}</p>}
      <Button type="submit" disabled={conv.isPending} testId="button-convert">{conv.isPending ? 'Converting…' : 'Convert accepted applicant'}</Button>
    </form>
  );
}

function StaffNewApplication({ schoolId, onDone }: { schoolId: number; onDone: () => void }) {
  const qc = useQueryClient();
  const classes = useListClasses({ schoolId }, { query: { queryKey: getListClassesQueryKey({ schoolId }) } });
  const sessions = useListAcademicSessions({ schoolId }, { query: { queryKey: getListAcademicSessionsQueryKey({ schoolId }) } });
  const [sessionId, setSessionId] = useState<number | null>(null);
  const terms = useListAcademicTerms(sessionId ?? 0, { schoolId }, { query: { enabled: !!sessionId, queryKey: getListAcademicTermsQueryKey(sessionId ?? 0, { schoolId }) } });
  const stage = useStageStaffAdmissionDocument();
  const keyRef = useRef(''); const holder = useRef<KeyHolder['current']>(null) as KeyHolder;
  const create = useCreateStaffAdmissionApplication({ request: liveKeyRequest(keyRef) });
  const [error, setError] = useState(''); const [reset, setReset] = useState(0); const [done, setDone] = useState('');
  const upload: UploadFn = async (file, documentType) => {
    const t = await stage.mutateAsync({ schoolId, data: uploadInput(file, documentType) });
    await putToSignedUrl(t.uploadUrl, file);
    return { documentType, fileName: file.name, contentType: file.type as never, byteSize: file.size, objectPath: t.objectPath };
  };
  const submit = (payload: SubmitPayload, draft: boolean) => {
    setError(''); setDone('');
    const data = { schoolId, ...payload, saveAsDraft: draft };
    keyRef.current = resolveRequestKey(holder, data);
    create.mutate({ data }, {
      onSuccess: r => { holder.current = null; setReset(n => n + 1); setDone(`${draft ? 'Draft saved' : 'Application submitted'}: ${r.applicationNumber}`); void qc.invalidateQueries({ queryKey: getListAdmissionApplicationsQueryKey() }); },
      onError: e => setError(apiMessage(e)),
    });
  };
  if (classes.isLoading) return <SkeletonPage />;
  if (classes.isError) return <ErrorState retry={() => { void classes.refetch(); }} />;
  return (
    <div className="panel p-6 md:p-8">
      {done && <div role="status" className="mb-6 flex items-center justify-between rounded-xl bg-[hsl(var(--primary)/.08)] p-3 text-sm font-bold" data-testid="text-staff-created">{done}<Button variant="quiet" onClick={onDone}>View applications</Button></div>}
      <p className="mb-6 text-xs text-[hsl(var(--muted-foreground))]">Walk-in applications can be entered while the public portal is closed.</p>
      <ApplicationForm mode="staff" classes={classes.data ?? []} sessions={sessions.data} terms={terms.data} onSessionChange={setSessionId} upload={upload} pending={create.isPending} error={error} onSubmit={submit} resetSignal={reset} />
    </div>
  );
}

const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);

function PortalSettings({ schoolId }: { schoolId: number }) {
  const qc = useQueryClient();
  const key = getGetAdmissionPortalSettingsQueryKey({ schoolId });
  const q = useGetAdmissionPortalSettings({ schoolId }, { query: { queryKey: key } });
  const classes = useListClasses({ schoolId }, { query: { queryKey: getListClassesQueryKey({ schoolId }) } });
  const sessions = useListAcademicSessions({ schoolId }, { query: { queryKey: getListAcademicSessionsQueryKey({ schoolId }) } });
  const save = useUpdateAdmissionPortalSettings();
  const [shareLogo, setShareLogo] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const sid = Number(f.academicSessionId || 0);
  const terms = useListAcademicTerms(sid, { schoolId }, { query: { enabled: sid > 0, queryKey: getListAcademicTermsQueryKey(sid, { schoolId }) } }); const [open, setOpen] = useState(false); const [ids, setIds] = useState<number[]>([]);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [copied, setCopied] = useState('');
  const init = useRef(0);
  const s = q.data;
  const candidate = s?.availableSchoolLogoObjectPath ?? null;
  useEffect(() => {
    if (!s || init.current === schoolId) return;
    init.current = schoolId;
    setOpen(s.open); setShareLogo(!!s.logoObjectPath); setIds(s.availableClassIds);
    setF({
      academicSessionId: s.academicSessionId?.toString() ?? '', academicTermId: s.academicTermId?.toString() ?? '', deadline: s.deadline?.slice(0, 10) ?? '',
      feeInfo: s.feeInfo ?? '', requirements: s.requirements.join('\n'), requiredDocuments: s.requiredDocuments.join('\n'), instructions: s.instructions ?? '',
      entranceExamination: s.entranceExamination ?? '', interviewInformation: s.interviewInformation ?? '', publicDescription: s.publicDescription ?? '',
      publicAddress: s.publicAddress ?? '', publicPhone: s.publicPhone ?? '', publicEmail: s.publicEmail ?? '',
    });
  }, [s, schoolId]);
  const set = (k: string) => (e: { target: { value: string } }) => setF(v => ({ ...v, [k]: e.target.value }));
  const link = useMemo(() => (s ? resolvePortalUrl(s.portalUrl, s.portalKey) : ''), [s]);
  if (q.isLoading) return <SkeletonPage />;
  if (q.isError || !s) return <ErrorState retry={() => q.refetch()} message="Portal settings could not be loaded." />;
  const n = (v?: string) => (v ? Number(v) : null);
  const t = (v?: string) => (v?.trim() ? v.trim() : null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setMsg(''); setErr('');
    const data: AdmissionPortalSettingsInput = {
      open, availableClassIds: ids, academicSessionId: n(f.academicSessionId), academicTermId: n(f.academicTermId), deadline: t(f.deadline),
      feeInfo: t(f.feeInfo), requirements: lines(f.requirements ?? ''), requiredDocuments: lines(f.requiredDocuments ?? ''), instructions: t(f.instructions),
      entranceExamination: t(f.entranceExamination), interviewInformation: t(f.interviewInformation), publicDescription: t(f.publicDescription),
      publicAddress: t(f.publicAddress), publicPhone: t(f.publicPhone), publicEmail: t(f.publicEmail), logoObjectPath: shareLogo ? (s.logoObjectPath ?? candidate) : null,
    };
    save.mutate({ data, params: { schoolId } }, {
      onSuccess: r => { qc.setQueryData(key, r); void qc.invalidateQueries({ queryKey: key }); setMsg('Portal settings saved.'); },
      onError: x => setErr(apiMessage(x)),
    });
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied('Link copied.'); } catch { setCopied('Copy was blocked; select the link manually.'); } };
  const termsFor = sid ? (terms.data ?? []) : [];
  const area = (k: string, label: string, rows = 3) => <Field label={label}><textarea rows={rows} value={f[k] ?? ''} onChange={set(k)} /></Field>;
  return (
    <form onSubmit={submit} className="panel space-y-6 p-6 md:p-8" data-testid="form-portal-settings">
      <div className="rounded-2xl bg-[hsl(var(--muted)/.5)] p-4">
        <div className="eyebrow mb-1">Public admissions link</div>
        <div className="break-all font-mono text-xs" data-testid="text-portal-url">{link}</div>
        <div className="mt-3 flex flex-wrap gap-3"><Button variant="outline" onClick={copy}><Copy size={15} />Copy link</Button>
          <Link href={`/admissions/portal/${s.portalKey}`} className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-bold"><ExternalLink size={15} />Preview</Link></div>
        {copied && <p role="status" className="mt-2 text-xs">{copied}</p>}
      </div>
      <label className="flex items-center gap-3 text-sm font-bold"><input type="checkbox" className="h-4 w-4" checked={open} onChange={e => setOpen(e.target.checked)} data-testid="checkbox-portal-open" />Accept public applications</label>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Session"><select value={f.academicSessionId ?? ''} onChange={e => setF(v => ({ ...v, academicSessionId: e.target.value, academicTermId: '' }))}><option value="">None</option>{(sessions.data ?? []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Term"><select value={f.academicTermId ?? ''} onChange={set('academicTermId')}><option value="">None</option>{termsFor.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Deadline"><input type="date" value={f.deadline ?? ''} onChange={set('deadline')} /></Field>
      </div>
      <fieldset><legend className="eyebrow mb-2">Classes open to applicants</legend>
        <div className="flex flex-wrap gap-2">{(classes.data ?? []).map(c => (
          <label key={c.id} className={cx('cursor-pointer rounded-xl px-3 py-2 text-xs font-bold', ids.includes(c.id) ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--secondary))]')}>
            <input type="checkbox" className="sr-only" checked={ids.includes(c.id)} onChange={() => setIds(l => l.includes(c.id) ? l.filter(x => x !== c.id) : [...l, c.id])} />{c.name} {c.section}</label>))}</div>
      </fieldset>
      <div className="grid gap-5 sm:grid-cols-2">{area('requirements', 'Requirements (one per line)')}{area('requiredDocuments', 'Required documents (one per line)')}
        {area('feeInfo', 'Fee information')}{area('instructions', 'Instructions')}{area('entranceExamination', 'Entrance examination')}{area('interviewInformation', 'Interview information')}</div>
      <div className="border-t border-[hsl(var(--border))] pt-5">
        <div className="eyebrow mb-3">Public contact details (opt-in: only what you fill in is shown)</div>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Public phone"><input value={f.publicPhone ?? ''} onChange={set('publicPhone')} /></Field>
          <Field label="Public email"><input type="email" value={f.publicEmail ?? ''} onChange={set('publicEmail')} /></Field>
          <Field label="Public address"><input value={f.publicAddress ?? ''} onChange={set('publicAddress')} /></Field>
        </div>
        <div className="mt-5">{area('publicDescription', 'About the school')}</div>
        <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={shareLogo} disabled={!s.logoObjectPath && !candidate} onChange={e => setShareLogo(e.target.checked)} data-testid="checkbox-share-logo" />Show the school logo on the public admissions page</label>
        <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{s.logoObjectPath || candidate ? 'The logo is public only while this is ticked.' : 'No school logo is available yet.'} Manage the logo in <Link href="/school-branding" className="font-bold underline">School Branding</Link>.</p>
      </div>
      {msg && <p role="status" className="text-sm font-medium text-[hsl(var(--primary))]">{msg}</p>}
      {err && <p role="alert" className="text-sm font-medium text-[hsl(var(--destructive))]">{err}</p>}
      <Button type="submit" disabled={save.isPending} testId="button-save-settings">{save.isPending ? 'Saving…' : 'Save portal settings'}</Button>
    </form>
  );
}

function EditFields({ schoolId, app, pending, onSave, onCancel, error }: {
  schoolId: number; app: AdmissionApplicationResponse; pending: boolean; error: string;
  onSave: (p: ReturnType<typeof buildPayload>) => void; onCancel: () => void;
}) {
  const classes = useListClasses({ schoolId }, { query: { queryKey: getListClassesQueryKey({ schoolId }) } });
  const sessions = useListAcademicSessions({ schoolId }, { query: { queryKey: getListAcademicSessionsQueryKey({ schoolId }) } });
  const [sid, setSid] = useState<number | null>(app.applicant.academicSessionId);
  const terms = useListAcademicTerms(sid ?? 0, { schoolId }, { query: { enabled: !!sid, queryKey: getListAcademicTermsQueryKey(sid ?? 0, { schoolId }) } });
  const initial = useMemo(() => formFromApplication(app), [app.id, app.version]); // captured at open; version pinned by parent
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] p-5">
      <ApplicationForm mode="staff" editing classes={classes.data ?? []} sessions={sessions.data} terms={terms.data} onSessionChange={setSid}
        initial={initial} upload={async () => { throw new Error('Attach documents from the Documents section.'); }} pending={pending} error={error} onSubmit={p => onSave(p)} onCancel={onCancel} />
    </div>
  );
}
