import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, Field, Modal, SkeletonPage, StatusPill, date } from '@/components/shared';
import { examApi, errMsg, fileToBase64, saveBlob, statusLabel, type ErContext, type PaperDetail } from '@/lib/exam-record-api';
import { FileText, Plus, Printer } from 'lucide-react';

const EDITABLE = ['DRAFT', 'RETURNED'];
const REVIEWABLE = ['SUBMITTED', 'RESUBMITTED'];

export function paperCapabilities(role: ErContext['role'], status: string) {
  const st = status.toUpperCase();
  return { canEdit: role === 'TEACHER' && EDITABLE.includes(st), canReview: role === 'ADMIN' && REVIEWABLE.includes(st), canPrint: role === 'ADMIN' && st === 'APPROVED' };
}

export function QuestionsSurface({ schoolId, ctx, sessionId, termId }: { schoolId: number; ctx: ErContext; sessionId: number; termId: number }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [classId, setClassId] = useState('');
  const q = useQuery({ queryKey: ['er-papers', schoolId, sessionId, termId, classId], queryFn: () => examApi.papers({ schoolId, sessionId, termId, classId }) });
  const subjectAssignments = ctx.assignments.filter(a => !a.commentOnly);
  const classes = [...new Map(subjectAssignments.map(a => [a.classId, a.className])).entries()];
  if (openId) return <PaperDetailView id={openId} schoolId={schoolId} role={ctx.role} onBack={() => { setOpenId(null); q.refetch(); }} />;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end gap-4">
      <Field label="Class"><select aria-label="Filter class" value={classId} onChange={e => setClassId(e.target.value)}><option value="">All classes</option>{classes.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></Field>
      {ctx.role === 'TEACHER' && <Button onClick={() => setCreating(true)} testId="button-er-new-paper"><Plus size={15} />Upload questions</Button>}
    </div>
    {q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} /> :
      !q.data?.length ? <div className="panel"><EmptyState icon={FileText} title="No question papers" description={ctx.role === 'TEACHER' ? 'Upload a PDF, Word or Excel question paper for a class you teach.' : 'No teacher has uploaded a question paper for this term yet.'} /></div> :
      <div className="panel overflow-x-auto"><table className="w-full min-w-[720px] text-sm" data-testid="table-er-papers"><thead className="bg-[hsl(var(--muted)/.4)] text-left text-xs uppercase tracking-wider"><tr><th className="p-3">Class</th><th className="p-3">Subject</th><th className="p-3">Exam</th><th className="p-3">Teacher</th><th className="p-3">Status</th><th className="p-3 text-right">Action</th></tr></thead>
        <tbody className="divide-y divide-[hsl(var(--border)/.6)]">{q.data.map(p => <tr key={p.id}>
          <td className="p-3 font-bold">{p.className}{p.section ? `/${p.section}` : ''}</td><td className="p-3">{p.subjectName}</td><td className="p-3">{p.examinationName}</td><td className="p-3">{p.teacherName}</td>
          <td className="p-3"><StatusPill value={statusLabel(p.status)} /></td>
          <td className="p-3 text-right"><Button variant="outline" className="py-1.5" onClick={() => setOpenId(p.id)}>{ctx.role === 'ADMIN' && REVIEWABLE.includes(p.status.toUpperCase()) ? 'Review' : ctx.role === 'ADMIN' && p.status.toUpperCase() === 'APPROVED' ? 'Print' : ctx.role === 'TEACHER' && EDITABLE.includes(p.status.toUpperCase()) ? 'Open' : 'View'}</Button></td></tr>)}</tbody></table></div>}
    {creating && <NewPaper schoolId={schoolId} ctx={ctx} sessionId={sessionId} termId={termId} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setOpenId(id); }} />}
  </div>;
}

function NewPaper({ schoolId, ctx, sessionId, termId, onClose, onCreated }: { schoolId: number; ctx: ErContext; sessionId: number; termId: number; onClose: () => void; onCreated: (id: number) => void }) {
  const [a, setA] = useState('0');
  const [f, setF] = useState({ examinationName: '', instructions: '', duration: '', totalMarks: '' });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); const as = ctx.assignments.filter(x => !x.commentOnly)[Number(a)];
    if (!as || !file || !f.examinationName.trim()) { setErr('Choose a class and subject, name the examination and attach a file.'); return; }
    if (f.totalMarks && !/^\d+(\.\d+)?$/.test(f.totalMarks)) { setErr('Total marks must be a number.'); return; }
    setBusy(true); setErr('');
    try {
      const p = await examApi.createPaper({ scope: { schoolId, sessionId, termId, classId: as.classId, section: as.section, subjectId: as.subjectId }, examinationName: f.examinationName.trim(), instructions: f.instructions || null, duration: f.duration || null, totalMarks: f.totalMarks ? Number(f.totalMarks) : null, filename: file.name, dataBase64: await fileToBase64(file) });
      onCreated(p.id);
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return <Modal title="Upload question paper" eyebrow="Exam questions" onClose={onClose} viewport>
    <form onSubmit={submit} className="space-y-4">
      <Field label="Class and subject"><select value={a} onChange={e => setA(e.target.value)} aria-label="Class and subject">{ctx.assignments.filter(x => !x.commentOnly).map((x, i) => <option key={i} value={i}>{x.className}{x.section ? `/${x.section}` : ''} - {x.subjectName}</option>)}</select></Field>
      <Field label="Examination name"><input value={f.examinationName} onChange={e => setF({ ...f, examinationName: e.target.value })} aria-label="Examination name" /></Field>
      <Field label="Instructions (optional)"><textarea rows={2} value={f.instructions} onChange={e => setF({ ...f, instructions: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Duration (optional)"><input value={f.duration} onChange={e => setF({ ...f, duration: e.target.value })} placeholder="2 hours" /></Field><Field label="Total marks (optional)"><input inputMode="decimal" value={f.totalMarks} onChange={e => setF({ ...f, totalMarks: e.target.value })} /></Field></div>
      <div className="rounded-lg bg-[hsl(var(--muted)/.5)] p-3 text-xs" data-testid="text-er-xlsx-format"><strong>Structured Excel (.xlsx) format.</strong> Required column: <strong>Question</strong>. Optional column: <strong>Marks</strong>. Optional answer columns: <strong>Option A</strong>, <strong>Option B</strong>, <strong>Option C</strong>, <strong>Option D</strong>. One question per row. PDF and Word files are kept exactly as uploaded.</div>
      <input type="file" aria-label="Question file" accept=".pdf,.docx,.xlsx" onChange={e => setFile(e.target.files?.[0] ?? null)} data-testid="input-er-question-file" />
      {err && <p role="alert" className="text-sm font-bold text-[hsl(var(--destructive))]">{err}</p>}
      <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy} testId="button-er-create-paper">{busy ? 'Uploading...' : 'Save as draft'}</Button></div>
    </form>
  </Modal>;
}

function PaperDetailView({ id, schoolId, role, onBack }: { id: number; schoolId: number; role: ErContext['role']; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['er-paper', id, schoolId], queryFn: () => examApi.paper(id, schoolId), staleTime: 0 });
  const [versionId, setVersionId] = useState<number | undefined>();
  const [url, setUrl] = useState(''); const [isPdf, setIsPdf] = useState(false); const [docBlob, setDocBlob] = useState<Blob | null>(null);
  const [docErr, setDocErr] = useState('');
  const [comment, setComment] = useState(''); const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null); const [busy, setBusy] = useState(false);
  const p: PaperDetail | undefined = q.data;
  const latest = p?.versions.slice().sort((a, b) => b.revision - a.revision)[0];
  const shown = p?.versions.find(v => v.id === versionId) ?? latest;
  useEffect(() => {
    if (!p) return; let live = true; let u = ''; setDocErr('');
    examApi.document(id, schoolId, shown?.id).then(b => { if (!live) return; setDocBlob(b); const pdf = b.type.includes('pdf'); setIsPdf(pdf); if (pdf) { u = URL.createObjectURL(b); setUrl(u); } else setUrl(''); }).catch(e => live && setDocErr(errMsg(e)));
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [id, schoolId, shown?.id, p?.revision]);
  if (q.isLoading) return <SkeletonPage />;
  if (q.isError || !p) return <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} />;
  const st = p.status.toUpperCase();
  const cap = paperCapabilities(role, p.status);
  const act = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); setMsg(null); try { await fn(); setMsg({ ok: true, t: ok }); setComment(''); await qc.invalidateQueries({ queryKey: ['er-paper', id, schoolId] }); } catch (e) { setMsg({ ok: false, t: errMsg(e) }); } finally { setBusy(false); } };
  const upload = async (f: File | null) => { if (!f) return; await act(async () => examApi.addVersion(id, { schoolId, revision: p.revision, filename: f.name, dataBase64: await fileToBase64(f) }), 'New version added.'); };
  const print = async () => { try { const b = await examApi.print(id, schoolId); const isDocx = b.type.includes('word') || b.type.includes('officedocument'); if (isDocx) { saveBlob(b, `${p.examinationName}.docx`); setMsg({ ok: true, t: 'The original Word document was downloaded. Open it in Word to print with its original formatting.' }); return; } const u = URL.createObjectURL(b); const w = window.open(u, '_blank'); if (!w) saveBlob(b, `${p.examinationName}.${b.type.includes('pdf') ? 'pdf' : 'html'}`); } catch (e) { setMsg({ ok: false, t: errMsg(e) }); } };
  return <div className="space-y-5">
    <Button variant="quiet" onClick={onBack}>Back to papers</Button>
    <div className="panel p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">{p.className}{p.section ? `/${p.section}` : ''} - {p.subjectName}</div><h2 className="display-font text-2xl font-bold">{p.examinationName}</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{p.teacherName}{p.submittedAt ? ` - submitted ${date(p.submittedAt)}` : ''}{p.duration ? ` - ${p.duration}` : ''}{p.totalMarks ? ` - ${p.totalMarks} marks` : ''}</p></div><StatusPill value={st === 'RETURNED' ? 'Returned - correction required' : statusLabel(p.status)} /></div>
      {p.instructions && <p className="mt-3 text-sm">{p.instructions}</p>}</div>
    {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm font-bold text-[hsl(157_37%_30%)]' : 'text-sm font-bold text-[hsl(var(--destructive))]'}>{msg.t}</p>}
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      <section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-[hsl(var(--border))] p-4"><h3 className="font-bold">Preview {shown ? `- version ${shown.revision}` : ''}</h3>{docBlob && !isPdf && shown && <Button variant="outline" className="py-1.5" onClick={() => saveBlob(docBlob, shown.filename)}>Download original</Button>}</div>
        {docErr ? <p role="alert" className="p-5 text-sm text-[hsl(var(--destructive))]">{docErr}</p> : isPdf && url ? <iframe title="Question paper" src={`${url}#toolbar=0&navpanes=0`} className="h-[70vh] w-full" data-testid="frame-er-paper" /> : <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap p-5 text-sm" data-testid="text-er-paper-preview">{shown?.previewText || 'Loading document...'}</pre>}
      </section>
      <aside className="space-y-5">
        {cap.canEdit && <div className="panel space-y-3 p-5"><h3 className="font-bold">{st === 'RETURNED' ? 'Upload corrected version' : 'Replace draft file'}</h3><input type="file" aria-label="New version file" accept=".pdf,.docx,.xlsx" disabled={busy} onChange={e => upload(e.target.files?.[0] ?? null)} />
          <Button onClick={() => act(() => examApi.submitPaper(id, { schoolId, revision: p.revision }), st === 'RETURNED' ? 'Resubmitted to School Admin.' : 'Submitted to School Admin.')} disabled={busy || !p.versions.length} testId="button-er-submit-paper">{st === 'RETURNED' ? 'Resubmit' : 'Submit to School Admin'}</Button></div>}
        {cap.canReview && <div className="panel space-y-3 p-5"><h3 className="font-bold">Review</h3><textarea rows={3} aria-label="Review comment" placeholder="Comment (required to return)" value={comment} onChange={e => setComment(e.target.value)} />
          <div className="flex gap-2"><Button variant="outline" disabled={busy} testId="button-er-return-paper" onClick={() => comment.trim() ? act(() => examApi.review(id, { schoolId, revision: p.revision, decision: 'RETURN', comment: comment.trim() }), 'Returned to teacher.') : setMsg({ ok: false, t: 'Give the teacher a reason for the return.' })}>Return to Teacher</Button><Button disabled={busy} testId="button-er-approve-paper" onClick={() => act(() => examApi.review(id, { schoolId, revision: p.revision, decision: 'APPROVE', comment: comment.trim() }), 'Approved and ready for printing.')}>Approve Question Paper</Button></div></div>}
        {cap.canPrint && <div className="panel p-5"><h3 className="font-bold">Ready for printing</h3>{/\.docx$/i.test(shown?.filename ?? '') && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]" data-testid="text-er-docx-print-note">This is a Word document. Print Question Paper downloads the original .docx with its Word formatting preserved; open it in Word to print. It does not open a browser print page.</p>}<Button className="mt-3" onClick={print} testId="button-er-print-paper"><Printer size={15} />Print Question Paper</Button></div>}
        {role === 'OWNER' && <p className="rounded-xl bg-[hsl(var(--secondary))] p-4 text-xs">Platform Owner view is read-only.</p>}
        <div className="panel p-5"><h3 className="font-bold">Version history</h3><ul className="mt-3 space-y-2 text-sm">{p.versions.slice().sort((a, b) => b.revision - a.revision).map(v => <li key={v.id}><button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setVersionId(v.id)}>Version {v.revision} - {v.filename}</button><div className="text-xs text-[hsl(var(--muted-foreground))]">{date(v.createdAt)}</div></li>)}</ul></div>
        <div className="panel p-5"><h3 className="font-bold">Review history</h3>{p.reviews.length ? <ul className="mt-3 space-y-3 text-sm">{p.reviews.map(r => <li key={r.id}><strong>{r.decision === 'APPROVE' ? 'Approved' : 'Returned'}</strong> by {r.reviewerName} on {date(r.createdAt)}{r.comment && <p className="text-[hsl(var(--muted-foreground))]">{r.comment}</p>}</li>)}</ul> : <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">No reviews yet.</p>}</div>
      </aside>
    </div>
  </div>;
}
