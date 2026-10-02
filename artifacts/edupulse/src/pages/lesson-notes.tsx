import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Plus, Lock, Bell, Check, Undo2, Archive } from 'lucide-react';
import {
  useListLessonNotes, useGetLessonNote, useCreateLessonNote, useUpdateLessonNote, useSubmitLessonNote,
  useReviewLessonNote, useArchiveLessonNote, useSendWeeklyLessonNoteReminders, useGetLessonNoteMonitoring,
  useListSchoolCurriculumMappings, useListSchoolCurriculumTopics,
  getListLessonNotesQueryKey, getGetLessonNoteQueryKey, getGetLessonNoteMonitoringQueryKey,
  getListSchoolCurriculumMappingsQueryKey, getListSchoolCurriculumTopicsQueryKey,
  type LessonNoteInput, type LessonNoteUpdate,
} from '@workspace/api-client-react';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Field, TenantPicker, Metric, cx, date } from '@/components/shared';
import { Notice, errMsg, FRESH, useSchoolRole } from '@/components/school-ops-kit';
import { SourceDownload } from '@/components/source-download';
import { useCurriculumContext, useInvalidateSchool } from '@/hooks/use-curriculum-context';
import { NOTE_FIELDS, cleanContent, isConflict, isEditableStatus, isPendingReview, label, missingForSubmit } from '@/lib/curriculum-kit';

type Ctx = ReturnType<typeof useCurriculumContext>;
const pill = (s: string) => s.replace('_', ' ');
const strContent = (c?: Record<string, unknown>) => Object.fromEntries(Object.entries(c ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : v == null ? '' : String(v)]));

function SessionTermWeek({ ctx, week, setWeek, allowAnyWeek }: { ctx: Ctx; week: number; setWeek: (n: number) => void; allowAnyWeek?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <select aria-label="Session" value={ctx.sessionId} onChange={e => ctx.setSessionId(Number(e.target.value))} data-testid="select-session">{ctx.sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <select aria-label="Term" value={ctx.termId} onChange={e => ctx.setTermId(Number(e.target.value))} data-testid="select-term">{ctx.terms.map(t => <option key={t.id} value={t.id}>{label(t.name)} term</option>)}</select>
      <select aria-label="Week" value={week} onChange={e => setWeek(Number(e.target.value))} data-testid="select-week">
        {allowAnyWeek && <option value={0}>All weeks</option>}
        {Array.from({ length: 20 }, (_, i) => i + 1).map(w => <option key={w} value={w}>Week {w}</option>)}
      </select>
    </div>
  );
}

function NoteReadOnly({ content }: { content: Record<string, string> }) {
  return (
    <dl className="space-y-4" data-testid="note-readonly">
      {NOTE_FIELDS.filter(f => content[f.key]).map(f => (
        <div key={f.key}><dt className="eyebrow">{f.label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{content[f.key]}</dd></div>
      ))}
    </dl>
  );
}

function History({ reviews }: { reviews?: Array<{ id: number; decision: string; comment?: string | null; createdAt: string }> }) {
  if (!reviews?.length) return null;
  return (
    <div className="mt-6 rounded-xl border border-[hsl(var(--border))] p-4" data-testid="panel-review-history">
      <div className="eyebrow mb-2 flex items-center gap-1.5"><Lock size={12} />Private review history</div>
      <ul className="space-y-3">{[...reviews].reverse().map(r => (
        <li key={r.id} className="text-sm" data-testid={`review-${r.id}`}><div className="flex items-center gap-2"><StatusPill value={r.decision === 'APPROVE' ? 'Approved' : 'Returned'} /><span className="text-xs text-[hsl(var(--muted-foreground))]">{date(r.createdAt)}</span></div>{r.comment && <p className="mt-1 whitespace-pre-wrap">{r.comment}</p>}</li>
      ))}</ul>
    </div>
  );
}

/** Teacher authoring. Keyed by note id so state never leaks between notes. */
function NoteEditor({ schoolId, ctx, noteId, onSaved }: { schoolId: number; ctx: Ctx; noteId: number | null; onSaved: (id: number) => void }) {
  const invalidate = useInvalidateSchool(schoolId);
  const detail = useGetLessonNote(schoolId, noteId ?? 0, { query: { enabled: !!noteId, queryKey: getGetLessonNoteQueryKey(schoolId, noteId ?? 0), ...FRESH } });
  const create = useCreateLessonNote();
  const update = useUpdateLessonNote();
  const submit = useSubmitLessonNote();
  const archive = useArchiveLessonNote();
  const pairs = useMemo(() => {
    const seen = new Map<string, { classId: number; subjectId: number; className: string; section: string; subjectName: string }>();
    ctx.assignments.forEach(a => { if (a.classId && a.subjectId) seen.set(`${a.classId}:${a.subjectId}`, { classId: a.classId, subjectId: a.subjectId, className: a.className ?? '', section: a.section ?? '', subjectName: a.subjectName ?? '' }); });
    return [...seen.values()];
  }, [ctx.assignments]);
  const [meta, setMeta] = useState({ week: 1, date: new Date().toISOString().slice(0, 10), classId: 0, subjectId: 0, topicId: 0, mappingId: 0, versionId: 0 });
  const [content, setContent] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState('DRAFT');
  const [conflict, setConflict] = useState(false);
  const [msg, setMsg] = useState('');
  const init = useRef<number | null | 'new'>(null);
  useEffect(() => {
    const n = detail.data;
    if (noteId && n && init.current !== noteId) {
      init.current = noteId;
      setMeta({ week: n.week, date: n.date.slice(0, 10), classId: n.classId, subjectId: n.subjectId, topicId: n.topicId ?? 0, mappingId: n.curriculumMappingId ?? 0, versionId: n.curriculumVersionId ?? 0 });
      setContent(strContent(n.content)); setRevision(n.revision); setStatus(n.status);
    }
  }, [detail.data, noteId]);
  useEffect(() => { if (!noteId && init.current !== 'new') init.current = 'new'; }, [noteId]);

  const mapParams = { classId: meta.classId, subjectId: meta.subjectId, sessionId: ctx.sessionId, termId: ctx.termId };
  const hasPair = meta.classId > 0 && meta.subjectId > 0;
  const mq = useListSchoolCurriculumMappings(schoolId, mapParams, { query: { enabled: hasPair && ctx.sessionId > 0 && ctx.termId > 0, queryKey: getListSchoolCurriculumMappingsQueryKey(schoolId, mapParams), ...FRESH } });
  const mapping = (mq.data ?? []).find(m => m.status === 'ACTIVE' && (meta.mappingId ? m.id === meta.mappingId : true)) ?? (mq.data ?? []).find(m => m.status === 'ACTIVE');
  const tq = useListSchoolCurriculumTopics(schoolId, mapping?.id ?? 0, { query: { enabled: !!mapping, queryKey: getListSchoolCurriculumTopicsQueryKey(schoolId, mapping?.id ?? 0), ...FRESH } });

  if (noteId && detail.isLoading) return <div className="h-96 animate-pulse rounded-2xl bg-[hsl(var(--muted))]" />;
  if (noteId && detail.isError) return <ErrorState retry={() => detail.refetch()} message={errMsg(detail.error)} />;
  const readOnly = !!noteId && !isEditableStatus(status);
  const set = (k: string, v: string) => setContent(c => ({ ...c, [k]: v }));
  const base = (): LessonNoteInput => ({
    sessionId: ctx.sessionId, termId: ctx.termId, classId: meta.classId, subjectId: meta.subjectId,
    section: pairs.find(p => p.classId === meta.classId)?.section || null, week: meta.week, date: meta.date,
    curriculumMappingId: meta.topicId ? meta.mappingId || mapping?.id || null : null, curriculumVersionId: meta.topicId ? meta.versionId || mapping?.versionId || null : null,
    topicId: meta.topicId || null, content: cleanContent(content),
  });
  const updatePayload = (): LessonNoteUpdate => ({ ...base(), expectedRevision: revision });
  const fail = (e: unknown) => { if (isConflict(e)) setConflict(true); setMsg(''); };
  const saveThen = (after?: (rev: number, id: number) => void) => {
    setMsg(''); setConflict(false);
    const ok = (n: { id: number; revision: number; status: string }) => { setRevision(n.revision); setStatus(n.status); invalidate(); if (after) after(n.revision, n.id); else { setMsg('Draft saved.'); onSaved(n.id); } };
    if (noteId) update.mutate({ schoolId, noteId, data: updatePayload() }, { onSuccess: ok, onError: fail });
    else create.mutate({ schoolId, data: base() }, { onSuccess: ok, onError: fail });
  };
  const doSubmit = () => {
    const miss = missingForSubmit(content);
    if (miss.length) { setMsg(`Complete before submitting: ${miss.join(', ')}.`); return; }
    saveThen((rev, id) => submit.mutate({ schoolId, noteId: id, data: { expectedRevision: rev } }, { onSuccess: n => { setRevision(n.revision); setStatus(n.status); setMsg('Submitted to your School Admin for private review.'); invalidate(); onSaved(n.id); }, onError: fail }));
  };
  const reload = async () => { const r = await detail.refetch(); if (r.data) { setContent(strContent(r.data.content)); setRevision(r.data.revision); setStatus(r.data.status); setConflict(false); } };
  const busy = create.isPending || update.isPending || submit.isPending || archive.isPending;
  const error = create.error ?? update.error ?? submit.error ?? archive.error;
  const canSave = hasPair && ctx.sessionId > 0 && ctx.termId > 0 && !busy;
  const topics = tq.data?.topics ?? [];
  return (
    <section className="panel p-6 md:p-8" data-testid="panel-note-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="eyebrow">{noteId ? `Note #${noteId} / revision ${revision}` : 'New weekly note'}</div><h2 className="display-font mt-1 text-2xl font-bold">{content.topic || 'Untitled lesson'}</h2></div>
        {noteId && <StatusPill value={pill(status)} />}
      </div>
      {readOnly && <div className="mt-4"><Notice tone="info">This note is {label(status).toLowerCase()} and read-only.</Notice></div>}
      {status === 'RETURNED' && detail.data?.latestReviewComment && <div className="mt-4"><Notice tone="error"><span data-testid="text-return-comment">Returned: {detail.data.latestReviewComment}</span></Notice></div>}
      {noteId && detail.data?.curriculumVersion && <div className="mt-4" data-testid="text-pinned-version"><Notice tone="info">Pinned curriculum version: {detail.data.curriculumVersion.title} / {detail.data.curriculumVersion.sourceOrganization}{detail.data.curriculumVersion.sourceVersion ? ` ${detail.data.curriculumVersion.sourceVersion}` : ''}. It does not change when the school's current mapping changes.</Notice></div>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Class and subject"><select className="w-full" disabled={!!noteId} value={`${meta.classId}:${meta.subjectId}`} onChange={e => { const [c, s] = e.target.value.split(':').map(Number); setMeta({ ...meta, classId: c, subjectId: s, topicId: 0, mappingId: 0, versionId: 0 }); }} data-testid="select-note-class">
          <option value="0:0">Select assignment</option>{pairs.map(p => <option key={`${p.classId}:${p.subjectId}`} value={`${p.classId}:${p.subjectId}`}>{p.className} {p.section} / {p.subjectName}</option>)}
        </select></Field>
        <Field label="Week"><input type="number" min={1} max={60} className="w-full" disabled={readOnly} value={meta.week} onChange={e => setMeta({ ...meta, week: Number(e.target.value) })} data-testid="input-note-week" /></Field>
        <Field label="Lesson date"><input type="date" className="w-full" disabled={readOnly} value={meta.date} onChange={e => setMeta({ ...meta, date: e.target.value })} data-testid="input-note-date" /></Field>
        <Field label="Curriculum topic">
          <select className="w-full" disabled={readOnly || !mapping} value={meta.topicId} onChange={e => { const id = Number(e.target.value); const t = topics.find(x => x.id === id); setMeta({ ...meta, topicId: id, mappingId: mapping?.id ?? 0, versionId: mapping?.versionId ?? 0 }); if (t && !content.topic) set('topic', t.title); }} data-testid="select-note-topic">
            <option value={0}>{mapping ? 'Not linked' : hasPair ? 'No curriculum assigned' : 'Pick class and subject'}</option>
            {topics.map(t => <option key={t.id} value={t.id}>{t.title}{t.sourceKind === 'SCHOOL_SPECIFIC' ? ' (school-specific)' : ''}</option>)}
          </select>
        </Field>
      </div>
      <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Teacher is set from your account. Saving a lesson note never changes curriculum coverage; record coverage from Curriculum.</p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {readOnly ? <div className="md:col-span-2"><NoteReadOnly content={content} /></div> : NOTE_FIELDS.map(f => (
          <div key={f.key} className={f.long ? 'md:col-span-2' : ''}>
            <Field label={`${f.label}${f.required ? ' (required to submit)' : ''}`}>
              {f.long ? <textarea className="w-full min-h-[84px]" value={content[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} data-testid={`input-note-${f.key}`} /> : <input className="w-full" value={content[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} data-testid={`input-note-${f.key}`} />}
            </Field>
          </div>
        ))}
      </div>
      {conflict && (
        <div className="mt-4" role="alert" data-testid="notice-conflict"><Notice tone="error">This note was changed elsewhere. Your unsaved text is still shown here and has not been overwritten. Copy what you need, then reload the latest version.
          <div className="mt-2"><Button variant="outline" onClick={reload} testId="button-reload-latest">Reload latest</Button></div></Notice></div>
      )}
      {error && !conflict && <div className="mt-4"><Notice tone="error">{errMsg(error)}</Notice></div>}
      {msg && <div className="mt-4"><Notice tone={msg.startsWith('Complete') ? 'error' : 'success'}><span data-testid="text-note-message">{msg}</span></Notice></div>}
      {!readOnly && (
        <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-[hsl(var(--border))] pt-4">
          <Button variant="outline" disabled={!canSave} onClick={() => saveThen()} testId="button-save-note">{update.isPending || create.isPending ? 'Saving' : 'Save draft'}</Button>
          <Button disabled={!canSave} onClick={doSubmit} testId="button-submit-note">{status === 'RETURNED' ? 'Resubmit for review' : 'Submit for review'}</Button>
        </div>
      )}
      {noteId && <History reviews={detail.data?.reviews} />}
    </section>
  );
}

function TeacherView({ schoolId }: { schoolId: number }) {
  const ctx = useCurriculumContext(schoolId, { admin: false, teacher: true });
  const [week, setWeek] = useState(0);
  const [sel, setSel] = useState<number | null | undefined>(undefined);
  const params = { sessionId: ctx.sessionId, termId: ctx.termId, ...(week ? { week } : {}) };
  const q = useListLessonNotes(schoolId, params, { query: { enabled: ctx.sessionId > 0 && ctx.termId > 0, queryKey: getListLessonNotesQueryKey(schoolId, params), ...FRESH } });
  if (ctx.loading) return <SkeletonPage />;
  if (ctx.error) return <ErrorState retry={ctx.refetch} />;
  const notes = [...(q.data ?? [])].sort((a, b) => b.week - a.week || b.id - a.id);
  return (
    <div>
      <SessionTermWeek ctx={ctx} week={week} setWeek={setWeek} allowAnyWeek />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="panel h-fit overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] p-4"><Button className="w-full" onClick={() => setSel(null)} testId="button-new-note"><Plus size={15} />New weekly note</Button></div>
          {q.isLoading ? <div className="h-32 animate-pulse bg-[hsl(var(--muted))]" /> : q.isError ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} /> : notes.length === 0 ? <EmptyState icon={FileText} title="No notes yet" description="Start your first weekly lesson note for this term." /> : (
            <ul className="divide-y divide-[hsl(var(--border)/.6)]" data-testid="list-my-notes">{notes.map(n => {
              const a = ctx.assignments.find(x => x.classId === n.classId && x.subjectId === n.subjectId);
              return <li key={n.id}><button onClick={() => setSel(n.id)} className={cx('w-full p-4 text-left hover:bg-[hsl(var(--muted)/.4)]', sel === n.id && 'bg-[hsl(var(--primary)/.06)]')} data-testid={`button-note-${n.id}`}>
                <div className="font-bold">Week {n.week} / {String(n.content?.topic ?? 'Untitled')}</div>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><StatusPill value={pill(n.status)} />{a ? `${a.className} / ${a.subjectName}` : ''}</div>
              </button></li>; })}</ul>
          )}
        </aside>
        {sel === undefined ? <div className="panel"><EmptyState icon={FileText} title="Choose or start a note" description="Notes stay private to you and your School Admin." /></div> : <NoteEditor key={sel ?? 'new'} schoolId={schoolId} ctx={ctx} noteId={sel} onSaved={id => setSel(id)} />}
      </div>
    </div>
  );
}

function AdminReview({ schoolId, ctx, noteId, onSelect, names }: { schoolId: number; ctx: Ctx; noteId: number; onSelect: (id: number) => void; names: (c: number, s: number) => string }) {
  const [week, setWeek] = useState(0);
  const [status, setStatus] = useState('');
  const params = { sessionId: ctx.sessionId, termId: ctx.termId, ...(week ? { week } : {}), ...(status ? { status: status as 'SUBMITTED' } : {}) };
  const q = useListLessonNotes(schoolId, params, { query: { enabled: ctx.sessionId > 0 && ctx.termId > 0, queryKey: getListLessonNotesQueryKey(schoolId, params), ...FRESH } });
  const notes = [...(q.data ?? [])].sort((a, b) => b.week - a.week || b.id - a.id);
  return (
    <div>
      <SessionTermWeek ctx={ctx} week={week} setWeek={setWeek} allowAnyWeek />
      <div className="mb-4"><select aria-label="Status" value={status} onChange={e => setStatus(e.target.value)} data-testid="select-review-status"><option value="">All statuses</option><option value="SUBMITTED">Submitted</option><option value="RESUBMITTED">Resubmitted</option><option value="RETURNED">Returned</option><option value="APPROVED">Approved</option><option value="DRAFT">Draft</option><option value="ARCHIVED">Archived</option></select></div>
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <aside className="panel h-fit overflow-hidden">
          {q.isLoading ? <div className="h-32 animate-pulse bg-[hsl(var(--muted))]" /> : q.isError ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} /> : notes.length === 0 ? <EmptyState icon={FileText} title="No notes match" description="Nothing has been submitted for these filters." /> : (
            <ul className="divide-y divide-[hsl(var(--border)/.6)]" data-testid="list-review-notes">{notes.map(n => (
              <li key={n.id}><button onClick={() => onSelect(n.id)} className={cx('w-full p-4 text-left hover:bg-[hsl(var(--muted)/.4)]', noteId === n.id && 'bg-[hsl(var(--primary)/.06)]')} data-testid={`button-review-note-${n.id}`}>
                <div className="font-bold">Week {n.week} / {String(n.content?.topic ?? 'Untitled')}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><StatusPill value={pill(n.status)} />{names(n.classId, n.subjectId)} / Teacher #{n.teacherId}</div>
              </button></li>))}</ul>
          )}
        </aside>
        {noteId ? <ReviewPanel key={noteId} schoolId={schoolId} noteId={noteId} names={names} /> : <div className="panel"><EmptyState icon={FileText} title="Select a note to review" description="Review comments stay private between you and the teacher." /></div>}
      </div>
    </div>
  );
}

function ReviewPanel({ schoolId, noteId, names }: { schoolId: number; noteId: number; names: (c: number, s: number) => string }) {
  const invalidate = useInvalidateSchool(schoolId);
  const q = useGetLessonNote(schoolId, noteId, { query: { queryKey: getGetLessonNoteQueryKey(schoolId, noteId), ...FRESH } });
  const review = useReviewLessonNote();
  const archive = useArchiveLessonNote();
  const [comment, setComment] = useState('');
  const [needComment, setNeedComment] = useState(false);
  const [stale, setStale] = useState(false);
  if (q.isLoading) return <div className="h-72 animate-pulse rounded-2xl bg-[hsl(var(--muted))]" />;
  if (q.isError || !q.data) return <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} />;
  const n = q.data;
  const done = () => { setComment(''); setStale(false); invalidate(); q.refetch(); };
  const decide = (decision: 'APPROVE' | 'RETURN') => {
    if (decision === 'RETURN' && !comment.trim()) { setNeedComment(true); return; }
    setNeedComment(false);
    review.mutate({ schoolId, noteId, data: { decision, comment: comment.trim() || null, expectedRevision: n.revision } }, { onSuccess: done, onError: e => { if (isConflict(e)) setStale(true); } });
  };
  const err = review.error ?? archive.error;
  return (
    <section className="panel p-6 md:p-8" data-testid="panel-review">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="eyebrow">Week {n.week} / {date(n.date)} / revision {n.revision}</div><h2 className="display-font mt-1 text-2xl font-bold">{String(n.content?.topic ?? 'Untitled lesson')}</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{names(n.classId, n.subjectId)} / Teacher #{n.teacherId}</p></div>
        <StatusPill value={pill(n.status)} />
      </div>
      {n.curriculumVersion && <div className="mt-4 text-sm" data-testid="text-review-version">Curriculum version: <span className="font-bold">{n.curriculumVersion.title}</span> / {n.curriculumVersion.sourceOrganization}{n.curriculumVersion.sourceVersion ? ` ${n.curriculumVersion.sourceVersion}` : ''}</div>}
      <div className="mt-6"><NoteReadOnly content={strContent(n.content)} /></div>
      <History reviews={n.reviews} />
      {stale && <div className="mt-4" role="alert"><Notice tone="error">The teacher changed this note while you were reviewing. Your comment is kept; the latest version is loading. Review it again before deciding.</Notice></div>}
      {err && !stale && <div className="mt-4"><Notice tone="error">{errMsg(err)}</Notice></div>}
      {isPendingReview(n.status) && (
        <div className="mt-6 space-y-3 border-t border-[hsl(var(--border))] pt-4" data-testid="form-review">
          <Field label="Private comment to the teacher (required when returning)"><textarea className="w-full min-h-[80px]" maxLength={5000} value={comment} onChange={e => setComment(e.target.value)} data-testid="input-review-comment" /></Field>
          {needComment && <p className="text-xs font-medium text-[hsl(var(--destructive))]" data-testid="text-comment-required">Add a comment explaining what to correct.</p>}
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="outline" disabled={review.isPending} onClick={() => decide('RETURN')} testId="button-return-note"><Undo2 size={14} />Return for correction</Button>
            <Button disabled={review.isPending} onClick={() => decide('APPROVE')} testId="button-approve-note"><Check size={14} />Approve</Button>
          </div>
        </div>
      )}
      {n.status === 'APPROVED' && (
        <div className="mt-6 flex justify-end border-t border-[hsl(var(--border))] pt-4"><Button variant="danger" disabled={archive.isPending} onClick={() => archive.mutate({ schoolId, noteId, data: { expectedRevision: n.revision } }, { onSuccess: done })} testId="button-archive-note"><Archive size={14} />Archive approved note</Button></div>
      )}
    </section>
  );
}

function Monitoring({ schoolId, ctx, names, onOpen }: { schoolId: number; ctx: Ctx; names: (c: number, s: number) => string; onOpen: (id: number) => void }) {
  const [week, setWeek] = useState(1);
  const [status, setStatus] = useState('');
  const [classId, setClassId] = useState(0);
  const [subjectId, setSubjectId] = useState(0);
  const [teacherId, setTeacherId] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const params = { sessionId: ctx.sessionId, termId: ctx.termId, week, ...(classId ? { classId } : {}), ...(subjectId ? { subjectId } : {}), ...(status ? { status: status as 'MISSING' } : {}) };
  const q = useGetLessonNoteMonitoring(schoolId, params, { query: { enabled: ctx.sessionId > 0 && ctx.termId > 0 && week > 0, queryKey: getGetLessonNoteMonitoringQueryKey(schoolId, params), ...FRESH } });
  const remind = useSendWeeklyLessonNoteReminders();
  const rowsAll = q.data ?? [];
  const teachers = [...new Map(rowsAll.map(r => [r.teacherId, r.teacherName ?? `Teacher #${r.teacherId}`])).entries()];
  const rows = rowsAll.filter(r => !teacherId || r.teacherId === teacherId);
  const missing = rows.filter(r => r.status === 'MISSING').length;
  const pending = rows.filter(r => isPendingReview(r.status)).length;
  const approved = rows.filter(r => r.status === 'APPROVED').length;
  return (
    <div>
      <SessionTermWeek ctx={ctx} week={week} setWeek={setWeek} />
      <div className="mb-6 flex flex-wrap gap-3">
        <select aria-label="Teacher" value={teacherId} onChange={e => setTeacherId(Number(e.target.value))} data-testid="select-mon-teacher"><option value={0}>All teachers</option>{teachers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <select aria-label="Class" value={classId} onChange={e => setClassId(Number(e.target.value))} data-testid="select-mon-class"><option value={0}>All classes</option>{ctx.classes.map(c => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}</select>
        <select aria-label="Subject" value={subjectId} onChange={e => setSubjectId(Number(e.target.value))} data-testid="select-mon-subject"><option value={0}>All subjects</option>{ctx.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value)} data-testid="select-mon-status"><option value="">All statuses</option>{['MISSING', 'DRAFT', 'SUBMITTED', 'RETURNED', 'RESUBMITTED', 'APPROVED', 'ARCHIVED'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Expected" value={rows.length} icon={FileText} /><Metric label="Missing" value={missing} icon={FileText} accent /><Metric label="Pending review" value={pending} icon={FileText} /><Metric label="Approved" value={approved} icon={Check} />
      </div>
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] p-4">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Expected notes come from active teaching assignments for week {week}.</p>
          <Button variant="outline" onClick={() => { remind.reset(); setConfirm(true); }} testId="button-open-reminders"><Bell size={14} />Remind teachers</Button>
        </div>
        {confirm && (
          <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.4)] p-4" role="alertdialog" data-testid="confirm-reminders">
            <p className="text-sm">Queue an in-app reminder for week {week} to teachers who have not yet submitted. No external message is sent from development.</p>
            {remind.error && <div className="mt-2"><Notice tone="error">{errMsg(remind.error)}</Notice></div>}
            {remind.data && <div className="mt-2"><Notice tone="success"><span data-testid="text-reminders-queued">{remind.data.queuedCount} reminder{remind.data.queuedCount === 1 ? '' : 's'} queued.</span></Notice></div>}
            <div className="mt-3 flex gap-2"><Button disabled={remind.isPending || !!remind.data} onClick={() => remind.mutate({ schoolId, data: { sessionId: ctx.sessionId, termId: ctx.termId, week } })} testId="button-send-reminders">{remind.isPending ? 'Queuing' : 'Queue reminders'}</Button><Button variant="quiet" onClick={() => setConfirm(false)}>Close</Button></div>
          </div>
        )}
        {q.isLoading ? <div className="h-40 animate-pulse bg-[hsl(var(--muted))]" /> : q.isError ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} /> : rows.length === 0 ? <EmptyState icon={FileText} title="No expected notes" description="No active teaching assignments match these filters for this week." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm" data-testid="table-monitoring">
            <thead className="bg-[hsl(var(--muted)/.5)] text-xs"><tr><th className="px-4 py-3">Teacher</th><th className="px-4 py-3">Class / subject</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={`${r.teacherId}-${r.classId}-${r.subjectId}`} className="border-t border-[hsl(var(--border)/.6)]" data-testid={`row-mon-${r.teacherId}-${r.classId}-${r.subjectId}`}>
                <td className="px-4 py-3 font-bold">{r.teacherName ?? `Teacher #${r.teacherId}`}</td><td className="px-4 py-3">{names(r.classId, r.subjectId)}</td><td className="px-4 py-3"><StatusPill value={pill(r.status)} /></td>
                <td className="px-4 py-3 text-right">{r.noteId ? <Button variant="quiet" onClick={() => onOpen(r.noteId as number)} testId={`button-open-note-${r.noteId}`}>Open</Button> : null}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

function AdminView({ schoolId }: { schoolId: number }) {
  const ctx = useCurriculumContext(schoolId, { admin: true, teacher: false });
  const [tab, setTab] = useState<'monitoring' | 'review'>('monitoring');
  const [noteId, setNoteId] = useState(0);
  const names = (c: number, s: number) => `${ctx.classes.find(x => x.id === c)?.name ?? `Class ${c}`} / ${ctx.subjects.find(x => x.id === s)?.name ?? `Subject ${s}`}`;
  if (ctx.loading) return <SkeletonPage />;
  if (ctx.error) return <ErrorState retry={ctx.refetch} />;
  return (
    <div>
      <div className="mb-6 flex gap-2 border-b border-[hsl(var(--border))]" role="tablist">
        {([['monitoring', 'Weekly monitoring'], ['review', 'Review notes']] as const).map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`tab-${id}`} className={cx('border-b-2 px-4 py-2.5 text-sm font-bold', tab === id ? 'border-[hsl(var(--primary))]' : 'border-transparent text-[hsl(var(--muted-foreground))]')}>{l}</button>)}
      </div>
      {tab === 'monitoring' ? <Monitoring schoolId={schoolId} ctx={ctx} names={names} onOpen={id => { setNoteId(id); setTab('review'); }} /> : <AdminReview schoolId={schoolId} ctx={ctx} noteId={noteId} onSelect={setNoteId} names={names} />}
    </div>
  );
}

export function LessonNotesPage() {
  const role = useSchoolRole();
  if (role.loading) return <SkeletonPage />;
  const adminView = role.isAdmin && !role.isPlatformOwner;
  const teacherView = !adminView && role.isTeacher && !role.isPlatformOwner;
  const desc = role.isPlatformOwner ? 'Lesson notes are private to each school and are not available to the Platform Owner.' : teacherView ? 'Prepare one structured note per class and subject each week. Only you and your School Admin can read it.' : 'Monitor weekly submissions from teaching assignments and review notes privately.';
  return (
    <div className="fade-up">
      <PageHeading eyebrow="Teaching" title="Lesson notes." description={desc} action={role.isPlatformOwner ? <TenantPicker /> : undefined} />
      {role.isPlatformOwner ? <EmptyState icon={Lock} title="Private to schools" description="The Platform Owner manages the central curriculum library, not school lesson notes." />
        : !role.schoolId || (!adminView && !teacherView) ? <EmptyState icon={Lock} title="Not available" description="Lesson notes are available to Teachers and School Admins of the selected school." />
        : adminView ? <AdminView key={`a-${role.schoolId}`} schoolId={role.schoolId} /> : <TeacherView key={`t-${role.schoolId}`} schoolId={role.schoolId} />}
    </div>
  );
}

export default LessonNotesPage;
