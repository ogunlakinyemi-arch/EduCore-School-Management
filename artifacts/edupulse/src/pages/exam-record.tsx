import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useGetAuthorizedContext } from '@workspace/api-client-react';
import { BarChart3, ClipboardList, FileText } from 'lucide-react';
import { Button, EmptyState, ErrorState, Field, Modal, PageHeading, SkeletonPage, StatusPill, TenantPicker, cx, useTenant } from '@/components/shared';
import { examApi, errMsg, statusLabel, type Assignment, type ClassStudent, type ClassView, type ErContext, type Scope } from '@/lib/exam-record-api';
import { SheetEditor } from '@/components/exam-record-sheet';
import { QuestionsSurface } from '@/components/exam-record-questions';
import { StudentExamRecord } from '@/components/exam-record-family';
import { SchoolDocumentHeader, SchoolDocumentPrintButton, useSchoolDocumentBranding } from '@/components/school-document';

export type SurfaceRole = 'OWNER' | 'FAMILY' | 'STAFF';
/** Owner is decided first, so an owner who also holds a secondary role stays read-only. */
export function resolveSurfaceRole(auth: { isPlatformOwner?: boolean; roles?: { role: string; status?: string }[] } | undefined): SurfaceRole {
  if (auth?.isPlatformOwner === true) return 'OWNER';
  const roles = (auth?.roles ?? []).filter(r => r.status === undefined || r.status === 'ACTIVE').map(r => r.role);
  if (roles.includes('STUDENT') && !roles.some(r => ['TEACHER', 'SCHOOL_ADMIN'].includes(r))) return 'FAMILY';
  return 'STAFF';
}

export function ExamRecordPage({ initialSurface = 'results' }: { initialSurface?: 'results' | 'questions' }) {
  const { schoolId } = useTenant();
  const auth = useGetAuthorizedContext().data;
  const surfaceRole = resolveSurfaceRole(auth as never);
  const isOwner = surfaceRole === 'OWNER';
  const roles = (auth?.roles ?? []).filter(r => r.status === 'ACTIVE').map(r => r.role as string);
  const familyOnly = surfaceRole === 'FAMILY';
  if (familyOnly) return <div className="fade-up"><PageHeading eyebrow="Student" title="Exam/Record." description="Your published term results." action={<TenantPicker />} />
    {schoolId ? <StudentExamRecord schoolId={schoolId} /> : <EmptyState icon={BarChart3} title="Select a school" description="Choose a school to see your results." />}</div>;
  return <div className="fade-up"><PageHeading eyebrow="Academics" title="Exam/Record." description={isOwner ? 'Read-only view of result submission, report cards and exam papers.' : roles.includes('SCHOOL_ADMIN') ? 'Review submitted subjects, preview report cards and publish.' : 'Enter and submit results for the classes and subjects you teach.'} action={<TenantPicker />} />
    {!schoolId ? <EmptyState icon={BarChart3} title="Select a school context" description="Select a school to open Exam/Record." /> : <Workspace key={schoolId} schoolId={schoolId} initialSurface={initialSurface} />}</div>;
}

function Workspace({ schoolId, initialSurface }: { schoolId: number; initialSurface: 'results' | 'questions' }) {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [termId, setTermId] = useState<number | null>(null);
  const [surface, setSurface] = useState(initialSurface);
  const q = useQuery({ queryKey: ['er-context', schoolId, sessionId, termId], queryFn: () => examApi.context({ schoolId, sessionId, termId }), staleTime: 0 });
  if (q.isLoading) return <SkeletonPage />;
  if (q.isError || !q.data) return <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} />;
  const ctx = q.data;
  const sid = sessionId ?? ctx.sessionId, tid = termId ?? ctx.termId;
  const terms = ctx.terms.filter(t => t.sessionId === sid);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[hsl(var(--border))]">
      <div className="flex gap-2">{([['results', 'Results', ClipboardList], ['questions', 'Exam Questions', FileText]] as const).map(([id, label, Icon]) => <button key={id} onClick={() => setSurface(id)} data-testid={`tab-er-${id}`} className={cx('flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-bold', surface === id ? 'border-[hsl(var(--primary))]' : 'border-transparent text-[hsl(var(--muted-foreground))]')}><Icon size={15} />{label}</button>)}</div>
      <div className="flex flex-wrap gap-3 pb-2">
        <Field label="Session"><select aria-label="Session" value={sid ?? ''} onChange={e => { setSessionId(Number(e.target.value)); setTermId(null); }}>{ctx.sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Term"><select aria-label="Term" value={tid ?? ''} onChange={e => setTermId(Number(e.target.value))}>{terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      </div>
    </div>
    {!sid || !tid ? <EmptyState icon={BarChart3} title="No academic term" description="Create an academic session and term first." /> :
      surface === 'questions' ? <QuestionsSurface schoolId={schoolId} ctx={ctx} sessionId={sid} termId={tid} /> :
      ctx.role === 'TEACHER' ? <TeacherResults schoolId={schoolId} ctx={ctx} sessionId={sid} termId={tid} termName={terms.find(t => t.id === tid)?.name ?? ''} sessionName={ctx.sessions.find(s => s.id === sid)?.name ?? ''} /> :
      <ClassReview schoolId={schoolId} ctx={ctx} sessionId={sid} termId={tid} />}
  </div>;
}

function TeacherResults({ schoolId, ctx, sessionId, termId, termName, sessionName }: { schoolId: number; ctx: ErContext; sessionId: number; termId: number; termName: string; sessionName: string }) {
  const [open, setOpen] = useState<Assignment | null>(null);
  const [comments, setComments] = useState<Assignment | null>(null);
  if (open) {
    const scope: Scope = { schoolId, sessionId, termId, classId: open.classId, section: open.section, subjectId: open.subjectId };
    return <SheetEditor scope={scope} title={`${sessionName} - ${termName} | ${open.className}${open.section ? `/${open.section}` : ''} - ${open.subjectName}`} onBack={() => setOpen(null)} />;
  }
  const subjectRows = ctx.assignments.filter(a => !a.commentOnly);
  const dutyRows = ctx.assignments.filter(a => a.commentOnly);
  if (comments) return <ClassComments schoolId={schoolId} sessionId={sessionId} termId={termId} duty={comments} onBack={() => setComments(null)} />;
  if (!subjectRows.length && !dutyRows.length) return <div className="panel"><EmptyState icon={ClipboardList} title="No classes assigned" description="Ask your School Admin to assign you a class and subject in Teacher Assignments." /></div>;
  return <div className="space-y-6">{dutyRows.length > 0 && <div className="panel p-5"><h2 className="display-font text-xl font-bold">Class Teacher comments</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Comments only. This appointment does not give access to subject scores.</p><div className="mt-3 flex flex-wrap gap-2">{dutyRows.map(d => <Button key={`${d.classId}-${d.section}`} variant="outline" onClick={() => setComments(d)} testId={`button-er-comments-${d.classId}`}>{d.className}{d.section ? `/${d.section}` : ''}</Button>)}</div></div>}
    {subjectRows.length > 0 && <div className="panel overflow-x-auto"><div className="border-b border-[hsl(var(--border))] p-5"><h2 className="display-font text-xl font-bold">My Results</h2></div>
    <table className="w-full min-w-[640px] text-sm" data-testid="table-er-assignments"><thead className="bg-[hsl(var(--muted)/.4)] text-left text-xs uppercase tracking-wider"><tr><th className="p-3">Class</th><th className="p-3">Subject</th><th className="p-3">Term</th><th className="p-3">Status</th><th className="p-3 text-right">Action</th></tr></thead>
      <tbody className="divide-y divide-[hsl(var(--border)/.6)]">{subjectRows.map(a => {
        const locked = ['SUBMITTED', 'RESUBMITTED', 'PUBLISHED', 'LOCKED'].includes((a.status ?? '').toUpperCase());
        return <tr key={`${a.classId}-${a.section}-${a.subjectId}`}><td className="p-3 font-bold">{a.className}{a.section ? `/${a.section}` : ''}</td><td className="p-3">{a.subjectName}</td><td className="p-3">{termName}</td><td className="p-3"><StatusPill value={statusLabel(a.status)} /></td>
          <td className="p-3 text-right"><Button variant={locked ? 'outline' : 'primary'} className="py-1.5" onClick={() => setOpen(a)} testId={`button-er-open-${a.classId}-${a.subjectId}`}>{locked ? 'View' : 'Enter Result'}</Button></td></tr>;
      })}</tbody></table></div>}</div>;
}

function ClassComments({ schoolId, sessionId, termId, duty, onBack }: { schoolId: number; sessionId: number; termId: number; duty: Assignment; onBack: () => void }) {
  const params = { schoolId, sessionId, termId, classId: duty.classId, section: duty.section };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['er-class-comments', params], queryFn: () => examApi.classComments(params), staleTime: 0 });
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<Record<number, { ok: boolean; t: string }>>({});
  const save = async (studentId: number) => {
    try { await examApi.saveClassComment({ ...params, studentId, teacherRemark: (drafts[studentId] ?? '').trim() }); setMsg(m => ({ ...m, [studentId]: { ok: true, t: 'Saved.' } })); qc.invalidateQueries({ queryKey: ['er-class-comments'] }); }
    catch (e) { setMsg(m => ({ ...m, [studentId]: { ok: false, t: errMsg(e) } })); }
  };
  return <div className="space-y-4"><Button variant="quiet" onClick={onBack}>My results</Button>
    <div className="panel overflow-x-auto"><div className="border-b border-[hsl(var(--border))] p-5"><h2 className="display-font text-xl font-bold">Class comments - {duty.className}{duty.section ? `/${duty.section}` : ''}</h2></div>
    {q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} /> : !q.data?.length ? <p className="p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">No students in this class.</p> :
      <ul className="divide-y divide-[hsl(var(--border)/.6)]">{q.data.map(r => { const can = r.reportCardId != null && r.status !== 'PUBLISHED'; return <li key={r.studentId} className="grid gap-2 p-4 md:grid-cols-[14rem_1fr_auto] md:items-start"><div><div className="font-bold">{r.studentName}</div><StatusPill value={r.reportCardId == null ? 'No draft card yet' : statusLabel(r.status)} /></div>
        <textarea rows={2} aria-label={`Comment for ${r.studentName}`} disabled={!can} value={drafts[r.studentId] ?? r.teacherRemark ?? ''} onChange={e => setDrafts(d => ({ ...d, [r.studentId]: e.target.value }))} />
        <div><Button variant="outline" disabled={!can} onClick={() => save(r.studentId)}>Save comment</Button>{msg[r.studentId] && <p role={msg[r.studentId].ok ? 'status' : 'alert'} className="mt-1 text-xs font-bold">{msg[r.studentId].t}</p>}</div></li>; })}</ul>}</div></div>;
}

function ClassReview({ schoolId, ctx, sessionId, termId }: { schoolId: number; ctx: ErContext; sessionId: number; termId: number }) {
  const readOnly = ctx.role !== 'ADMIN';
  const classes = [...new Map(ctx.assignments.filter(a => !a.commentOnly).map(a => [a.classId, a.className])).entries()];
  const [classId, setClassId] = useState('');
  const sections = [...new Set(ctx.assignments.filter(a => String(a.classId) === classId).map(a => a.section))];
  const [section, setSection] = useState('');
  const ready = !!classId && (section !== '' || sections.every(s => !s));
  const qc = useQueryClient();
  const params = { schoolId, sessionId, termId, classId, section };
  const q = useQuery({ queryKey: ['er-class', params], queryFn: () => examApi.classView(params), enabled: ready, staleTime: 0 });
  const [preview, setPreview] = useState<ClassStudent | null>(null);
  const [ret, setRet] = useState<ClassView['subjects'][number] | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['er-class'] });
  return <div className="space-y-6">
    <div className="panel flex flex-wrap gap-4 p-5">
      <Field label="Class"><select aria-label="Class" value={classId} onChange={e => { setClassId(e.target.value); setSection(''); }}><option value="">Choose class</option>{classes.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></Field>
      <Field label="Section"><select aria-label="Section" value={section} onChange={e => setSection(e.target.value)} disabled={!classId}><option value="">{sections.length ? 'Choose section' : 'None'}</option>{sections.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
    </div>
    {!ready ? <div className="panel"><EmptyState icon={ClipboardList} title="Choose a class" description="Select a class and section to see which subjects have been submitted." /></div> :
    q.isLoading ? <SkeletonPage /> : q.isError || !q.data ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} /> : <>
      <div className="panel overflow-x-auto"><div className="flex items-center justify-between border-b border-[hsl(var(--border))] p-5"><h2 className="display-font text-xl font-bold">Submission status</h2><span className="text-sm font-bold" data-testid="text-er-submitted-count">{q.data.submittedCount} of {q.data.requiredCount} subjects submitted</span></div>
        <table className="w-full min-w-[560px] text-sm"><thead className="bg-[hsl(var(--muted)/.4)] text-left text-xs uppercase tracking-wider"><tr><th className="p-3">Subject</th><th className="p-3">Teacher</th><th className="p-3">Status</th>{!readOnly && <th className="p-3 text-right">Action</th>}</tr></thead>
          <tbody className="divide-y divide-[hsl(var(--border)/.6)]">{q.data.subjects.map(s => <tr key={s.subjectId}><td className="p-3 font-bold">{s.subjectName}</td><td className="p-3">{s.teacherName}</td><td className="p-3"><StatusPill value={statusLabel(s.status)} /></td>
            {!readOnly && <td className="p-3 text-right">{s.batchId && ['SUBMITTED', 'RESUBMITTED'].includes(s.status.toUpperCase()) && <Button variant="outline" className="py-1.5" onClick={() => setRet(s)}>Return</Button>}</td>}</tr>)}</tbody></table></div>
      <div className="panel overflow-x-auto"><div className="border-b border-[hsl(var(--border))] p-5"><h2 className="display-font text-xl font-bold">Students</h2></div>
        {!q.data.students.length ? <p className="p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">No students in this class.</p> :
        <table className="w-full min-w-[640px] text-sm" data-testid="table-er-students"><thead className="bg-[hsl(var(--muted)/.4)] text-left text-xs uppercase tracking-wider"><tr><th className="p-3">Student</th><th className="p-3">Result status</th><th className="p-3">Average</th><th className="p-3 text-right">Action</th></tr></thead>
          <tbody className="divide-y divide-[hsl(var(--border)/.6)]">{q.data.students.map(s => <tr key={s.studentId}><td className="p-3"><div className="font-bold">{s.studentName}</div><div className="text-[11px] text-[hsl(var(--muted-foreground))]">{s.admissionNo}</div></td><td className="p-3"><StatusPill value={statusLabel(s.status)} /></td><td className="p-3 tabular-nums">{s.average != null ? `${s.average}%` : '-'}</td>
            <td className="p-3 text-right"><Button variant="outline" className="py-1.5" onClick={() => setPreview(s)} testId={`button-er-preview-${s.studentId}`}>Preview</Button></td></tr>)}</tbody></table>}</div>
    </>}
    {preview && <StudentPreview schoolId={schoolId} params={params} student={preview} readOnly={readOnly} onClose={() => setPreview(null)} onPublished={() => { refresh(); setPreview(null); }} />}
    {ret && <ReturnDialog schoolId={schoolId} subject={ret} onClose={() => setRet(null)} onDone={() => { setRet(null); refresh(); }} />}
  </div>;
}

function ReturnDialog({ schoolId, subject, onClose, onDone }: { schoolId: number; subject: ClassView['subjects'][number]; onClose: () => void; onDone: () => void }) {
  const [c, setC] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { if (!c.trim()) { setErr('A reason is required.'); return; } setBusy(true); try { await examApi.returnBatch({ schoolId, batchId: subject.batchId!, revision: subject.revision, comment: c.trim() }); onDone(); } catch (e) { setErr(errMsg(e)); setBusy(false); } };
  return <Modal title={`Return ${subject.subjectName}`} eyebrow={subject.teacherName} onClose={onClose} viewport><div className="space-y-3"><textarea rows={3} aria-label="Reason for return" placeholder="What must the teacher correct?" value={c} onChange={e => setC(e.target.value)} />{err && <p role="alert" className="text-sm font-bold text-[hsl(var(--destructive))]">{err}</p>}<div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button onClick={go} disabled={busy}>Return to teacher</Button></div></div></Modal>;
}

export function StudentPreview(props: Parameters<typeof StudentPreviewBody>[0]) {
  return <Modal title={props.student.studentName} eyebrow="Report card preview" onClose={props.onClose} viewport><StudentPreviewBody {...props} /></Modal>;
}

export function StudentPreviewBody({ schoolId, params, student, readOnly, onClose, onPublished }: { schoolId: number; params: Record<string, unknown>; student: ClassStudent; readOnly: boolean; onClose: () => void; onPublished: () => void }) {
  const branding = useSchoolDocumentBranding(schoolId);
  const [remark, setRemark] = useState(student.schoolRemark ?? '');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const published = student.status === 'PUBLISHED';
  const missing = student.missingSubjects.length > 0 || !student.complete;
  const publish = async () => {
    if (!confirm('Publish this report card? Students and parents will see it.')) return;
    setBusy(true); setErr('');
    try { await examApi.publish({ schoolId, sessionId: params.sessionId, termId: params.termId, classId: Number(params.classId), section: params.section, studentId: student.studentId, ...(remark.trim() ? { schoolRemark: remark.trim() } : {}) }); onPublished(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return <div className="space-y-4">
      {readOnly ? <div data-testid="er-preview-readonly">        <article className="school-document-page"><SchoolDocumentHeader branding={branding.data ?? {}} /><h2 className="school-document-title">Academic report card</h2>
          <dl className="school-document-grid"><div className="school-document-field"><dt>Student</dt><dd>{student.studentName}</dd></div><div className="school-document-field"><dt>Admission number</dt><dd>{student.admissionNo}</dd></div><div className="school-document-field"><dt>Class</dt><dd>{student.className}{student.section ? ` / ${student.section}` : ''}</dd></div>{student.attendance && <div className="school-document-field"><dt>Attendance</dt><dd>{student.attendance.present} present, {student.attendance.absent} absent, {student.attendance.late} late of {student.attendance.total} days</dd></div>}</dl>
          <table className="school-document-table"><thead><tr><th>Subject</th><th>Score</th><th>Grade</th><th>Teacher</th></tr></thead><tbody>{student.subjects.map(s => <tr key={s.subjectId}><td>{s.subjectName}</td><td>{s.missing ? 'Not submitted' : `${s.score}${s.maxScore ? `/${s.maxScore}` : ''}`}</td><td>{s.grade ?? ''}</td><td>{s.teacherName}</td></tr>)}</tbody></table>
          <p><strong>Total:</strong> {student.total ?? '-'} {'  '}<strong>Average:</strong> {student.average != null ? `${student.average}%` : '-'}</p>
          {student.teacherRemark && <p><strong>Teacher:</strong> {student.teacherRemark}</p>}{(remark || student.schoolRemark) && <p><strong>School:</strong> {remark || student.schoolRemark}</p>}
        </article></div> :
      <SchoolDocumentPrintButton preview label="Print preview" disabled={!branding.data} unavailableMessage="Loading school identity.">
        <article className="school-document-page"><SchoolDocumentHeader branding={branding.data ?? {}} /><h2 className="school-document-title">Academic report card</h2>
          <dl className="school-document-grid"><div className="school-document-field"><dt>Student</dt><dd>{student.studentName}</dd></div><div className="school-document-field"><dt>Admission number</dt><dd>{student.admissionNo}</dd></div><div className="school-document-field"><dt>Class</dt><dd>{student.className}{student.section ? ` / ${student.section}` : ''}</dd></div>{student.attendance && <div className="school-document-field"><dt>Attendance</dt><dd>{student.attendance.present} present, {student.attendance.absent} absent, {student.attendance.late} late of {student.attendance.total} days</dd></div>}</dl>
          <table className="school-document-table"><thead><tr><th>Subject</th><th>Score</th><th>Grade</th><th>Teacher</th></tr></thead><tbody>{student.subjects.map(s => <tr key={s.subjectId}><td>{s.subjectName}</td><td>{s.missing ? 'Not submitted' : `${s.score}${s.maxScore ? `/${s.maxScore}` : ''}`}</td><td>{s.grade ?? ''}</td><td>{s.teacherName}</td></tr>)}</tbody></table>
          <p><strong>Total:</strong> {student.total ?? '-'} {'  '}<strong>Average:</strong> {student.average != null ? `${student.average}%` : '-'}</p>
          {student.teacherRemark && <p><strong>Teacher:</strong> {student.teacherRemark}</p>}{(remark || student.schoolRemark) && <p><strong>School:</strong> {remark || student.schoolRemark}</p>}
        </article>
      </SchoolDocumentPrintButton>
      }
      {missing && <p role="alert" className="rounded-lg bg-[hsl(35_83%_53%/.15)] p-3 text-sm font-bold">{student.missingSubjects.map(s => `${s} result has not been submitted by the assigned teacher.`).join(' ') || 'Required subject results are incomplete.'}</p>}
      {!readOnly && !published && <><Field label="School remark (optional)"><textarea rows={2} value={remark} onChange={e => setRemark(e.target.value)} /></Field>
        <Button onClick={publish} disabled={busy || missing} testId="button-er-publish">{busy ? 'Publishing...' : 'Publish Result'}</Button></>}
      {published && <p className="text-sm font-bold text-[hsl(157_37%_30%)]">Published and locked.</p>}
      {err && <p role="alert" className="text-sm font-bold text-[hsl(var(--destructive))]">{err}</p>}
  </div>;
}
