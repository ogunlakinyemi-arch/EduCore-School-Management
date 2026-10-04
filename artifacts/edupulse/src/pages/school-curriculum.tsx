import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { BookMarked, ChevronDown, Plus, Sparkles } from 'lucide-react';
import {
  useListSchoolCurriculumMappings, useListSchoolCurriculumCatalog, getListSchoolCurriculumCatalogQueryKey, useListSchoolCurriculumTopics,
  useUpdateSubject, useAssignSchoolCurriculum, useAddSchoolCurriculumTopic, useRecordCurriculumProgress,
  getListSchoolCurriculumMappingsQueryKey, getListSchoolCurriculumTopicsQueryKey,
  type SchoolCurriculumMapping, type CurriculumProgress,
} from '@workspace/api-client-react';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Field, TenantPicker, cx, date } from '@/components/shared';
import { Notice, errMsg, FRESH, useSchoolRole } from '@/components/school-ops-kit';
import { useCurriculumContext, useInvalidateSchool } from '@/hooks/use-curriculum-context';
import { buildSyllabusOverview } from '@/lib/syllabus-overview';
import { assignmentCovers, label, splitLines, suggestVersions } from '@/lib/curriculum-kit';

const STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'DEFERRED'] as const;

function SessionTermPicker({ ctx }: { ctx: ReturnType<typeof useCurriculumContext> }) {
  return (
    <div className="mb-6 flex flex-wrap gap-3">
      <select className="min-w-[160px]" aria-label="Session" value={ctx.sessionId} onChange={e => ctx.setSessionId(Number(e.target.value))} data-testid="select-session">{ctx.sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <select className="min-w-[160px]" aria-label="Term" value={ctx.termId} onChange={e => ctx.setTermId(Number(e.target.value))} data-testid="select-term">{ctx.terms.map(t => <option key={t.id} value={t.id}>{label(t.name)} term</option>)}</select>
    </div>
  );
}

function MappingCard({ schoolId, mapping, title, classLevel, subjectId, classLevelHint, subject }: { subject?: { id: number; name: string; description?: string | null }; schoolId: number; mapping: SchoolCurriculumMapping; title: string; classLevel: string; subjectId: number; classLevelHint: string }) {
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [progress, setProgress] = useState<Record<number, CurriculumProgress>>({});
  const [draft, setDraft] = useState<Record<number, { status: string; comment: string; completedDate: string }>>({});
  const invalidate = useInvalidateSchool(schoolId);
  const topicsQ = useListSchoolCurriculumTopics(schoolId, mapping.id, { query: { enabled: open, queryKey: getListSchoolCurriculumTopicsQueryKey(schoolId, mapping.id), ...FRESH } });
  const record = useRecordCurriculumProgress();
  const addTopic = useAddSchoolCurriculumTopic();
  const [t, setT] = useState({ title: '', objectives: '' });
  const v = mapping.curriculumVersion;
  const coverage = topicsQ.data;
  const topics = [...(coverage?.topics ?? [])].sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0));
  const persistedProgress = new Map<number, CurriculumProgress>(
    (coverage?.progress ?? []).map(item => [item.topicId, item] as [number, CurriculumProgress]),
  );
  const submitTopic = (e: FormEvent) => {
    e.preventDefault();
    addTopic.mutate({ schoolId, mappingId: mapping.id, data: { classLevel: classLevel || classLevelHint, subjectId, title: t.title.trim(), learningObjectives: splitLines(t.objectives) } }, { onSuccess: () => { setT({ title: '', objectives: '' }); setAddOpen(false); invalidate(); } });
  };
  return (
    <article className="panel overflow-hidden" data-testid={`card-mapping-${mapping.id}`}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-4 p-5 text-left" data-testid={`button-mapping-${mapping.id}`}>
        <div>
          <div className="font-bold">{title}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{v ? `${v.title} / ${label(v.sourceKind)} / ${v.sourceOrganization}${v.sourceVersion ? ` ${v.sourceVersion}` : ''}` : `Version #${mapping.versionId}`}</div>
        </div>
        <div className="flex items-center gap-3"><StatusPill value={mapping.status} /><ChevronDown size={18} className={cx('transition-transform', open && 'rotate-180')} /></div>
      </button>
      {open && (
        <div className="border-t border-[hsl(var(--border))] p-5">
          <p className="mb-4 text-xs text-[hsl(var(--muted-foreground))]">Confirmed {date(mapping.confirmedAt)}. Coverage is recorded here only; saving a lesson note never changes it.</p>
          {topicsQ.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-[hsl(var(--muted))]" /> : topicsQ.isError ? <ErrorState retry={() => topicsQ.refetch()} message={errMsg(topicsQ.error)} /> : topics.length === 0 ? (
            <EmptyState icon={BookMarked} title="No topics for this class and subject" description="The published version has no topics for this mapping. School-specific topics can be added below." />
          ) : (
            <ul className="divide-y divide-[hsl(var(--border)/.6)]" data-testid={`list-topics-${mapping.id}`}>
              {topics.map(tp => {
                const currentProgress = progress[tp.id] ?? persistedProgress.get(tp.id);
                const d = draft[tp.id] ?? { status: currentProgress?.progressStatus ?? 'PLANNED', comment: currentProgress?.comment ?? '', completedDate: currentProgress?.completedDate?.slice(0, 10) ?? '' };
                const school = tp.sourceKind === 'SCHOOL_SPECIFIC';
                return (
                  <li key={tp.id} className="py-4" data-testid={`row-topic-${tp.id}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{tp.title}</span>
                      <span className={cx('rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', school ? 'bg-[hsl(35_83%_53%/.18)] text-[hsl(28_73%_40%)]' : 'bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]')} data-testid={`badge-source-${tp.id}`}>{school ? 'School-specific addition' : label(tp.sourceKind)}</span>
                      {currentProgress && <StatusPill value={currentProgress.progressStatus.replace('_', ' ')} />}
                    </div>
                    {!!tp.learningObjectives?.length && <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{tp.learningObjectives.join('; ')}</p>}
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <select aria-label="Coverage status" value={d.status} onChange={e => setDraft({ ...draft, [tp.id]: { ...d, status: e.target.value } })} data-testid={`select-progress-${tp.id}`}>{STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}</select>
                      {d.status === 'COMPLETED' && <input type="date" aria-label="Completed date" value={d.completedDate} onChange={e => setDraft({ ...draft, [tp.id]: { ...d, completedDate: e.target.value } })} />}
                      <input className="min-w-[200px] flex-1" maxLength={2000} placeholder="Comment (optional)" value={d.comment} onChange={e => setDraft({ ...draft, [tp.id]: { ...d, comment: e.target.value } })} />
                      <Button variant="outline" disabled={record.isPending} onClick={() => { if (!draft[tp.id]) setDraft({ ...draft, [tp.id]: d }); record.mutate({ schoolId, mappingId: mapping.id, data: { topicId: tp.id, progressStatus: d.status as (typeof STATUSES)[number], comment: d.comment.trim() || null, completedDate: d.status === 'COMPLETED' && d.completedDate ? d.completedDate : null } }, { onSuccess: p => { setProgress(s => ({ ...s, [tp.id]: p })); invalidate(); } }); }} testId={`button-record-progress-${tp.id}`}>Record coverage</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {subject && <SyllabusOverview schoolId={schoolId} subject={subject} topics={topics} version={v} versionId={mapping.versionId} />}
          {record.error && <div className="mt-3"><Notice tone="error">{errMsg(record.error)}</Notice></div>}
          <div className="mt-5 border-t border-[hsl(var(--border))] pt-4">
            {!addOpen ? <Button variant="quiet" onClick={() => setAddOpen(true)} testId={`button-add-school-topic-${mapping.id}`}><Plus size={14} />Add school-specific topic</Button> : (
              <form onSubmit={submitTopic} className="space-y-3" data-testid={`form-school-topic-${mapping.id}`}>
                <Notice tone="info">This topic is stored as a school-specific addition and is labelled so it is never mistaken for the official syllabus.</Notice>
                <Field label="Topic title"><input required maxLength={250} className="w-full" value={t.title} onChange={e => setT({ ...t, title: e.target.value })} data-testid="input-school-topic-title" /></Field>
                <Field label="Objectives (one per line)"><textarea className="w-full min-h-[60px]" value={t.objectives} onChange={e => setT({ ...t, objectives: e.target.value })} /></Field>
                {addTopic.error && <Notice tone="error">{errMsg(addTopic.error)}</Notice>}
                <div className="flex gap-2"><Button type="submit" disabled={addTopic.isPending} testId="button-save-school-topic">Save topic</Button><Button variant="quiet" onClick={() => setAddOpen(false)}>Cancel</Button></div>
              </form>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function AssignPanel({ schoolId, ctx }: { schoolId: number; ctx: ReturnType<typeof useCurriculumContext> }) {
  const [classId, setClassId] = useState(0);
  const [subjectId, setSubjectId] = useState(0);
  const [versionId, setVersionId] = useState(0);
  const invalidate = useInvalidateSchool(schoolId);
  const assign = useAssignSchoolCurriculum();
  const cParams = { classId, subjectId };
  const vq = useListSchoolCurriculumCatalog(schoolId, cParams, { query: { enabled: schoolId > 0 && classId > 0 && subjectId > 0, queryKey: getListSchoolCurriculumCatalogQueryKey(schoolId, cParams), ...FRESH } });
  const versions = vq.data ?? [];
  const cls = ctx.classes.find(c => c.id === classId);
  const subject = ctx.subjects.find(s => s.id === subjectId);
  const suggestions = useMemo(() => suggestVersions(versions, cls, subject), [versions, cls, subject]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    assign.mutate({ schoolId, data: { classId, subjectId, sessionId: ctx.sessionId, termId: ctx.termId, versionId } }, { onSuccess: () => { setVersionId(0); invalidate(); } });
  };
  return (
    <form onSubmit={submit} className="panel mb-6 space-y-4 p-6" data-testid="form-assign-curriculum">
      <div className="flex items-center gap-2"><Sparkles size={16} /><h2 className="display-font text-lg font-bold">Assign a curriculum version</h2></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class"><select required className="w-full" value={classId} onChange={e => { setClassId(Number(e.target.value)); setVersionId(0); }} data-testid="select-assign-class"><option value={0}>Select class</option>{ctx.classes.map(c => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}</select></Field>
        <Field label="Subject"><select required className="w-full" value={subjectId} onChange={e => { setSubjectId(Number(e.target.value)); setVersionId(0); }} data-testid="select-assign-subject"><option value={0}>Select subject</option>{ctx.subjects.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</select></Field>
      </div>
      {vq.isError && <Notice tone="error">{errMsg(vq.error, 'Published versions could not be loaded.')}</Notice>}
      {cls && subject && (
        <div data-testid="panel-suggestions">
          <div className="eyebrow mb-2">Suggested published versions (exact normalized class and subject code or name)</div>
          {suggestions.length === 0 ? <p className="text-sm text-[hsl(var(--muted-foreground))]">No published version matches {cls.name} and {subject.code}. Choose from all published versions below if one still applies.</p> : (
            <div className="flex flex-wrap gap-2">{suggestions.map(v => <button type="button" key={v.id} onClick={() => setVersionId(v.id)} className={cx('rounded-xl border px-3 py-2 text-left text-sm', versionId === v.id ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.08)]' : 'border-[hsl(var(--border))]')} data-testid={`button-suggest-${v.id}`}><span className="font-bold">{v.title}</span><br /><span className="text-xs text-[hsl(var(--muted-foreground))]">{v.sourceOrganization}</span></button>)}</div>
          )}
        </div>
      )}
      <Field label="Version to confirm (required)"><select required className="w-full" value={versionId} onChange={e => setVersionId(Number(e.target.value))} data-testid="select-assign-version"><option value={0}>Select published version</option>{versions.map(v => <option key={v.id} value={v.id}>{v.title} / {v.sourceOrganization}</option>)}</select></Field>
      {assign.error && <Notice tone="error">{errMsg(assign.error)}</Notice>}
      {assign.isSuccess && <Notice tone="success">Curriculum assigned for this session and term.</Notice>}
      <div className="flex justify-end"><Button type="submit" disabled={!classId || !subjectId || !versionId || !ctx.sessionId || !ctx.termId || assign.isPending} testId="button-assign-curriculum">{assign.isPending ? 'Assigning' : 'Confirm assignment'}</Button></div>
    </form>
  );
}

export function SchoolCurriculumPage() {
  const role = useSchoolRole();
  const schoolId = role.schoolId;
  const adminView = role.isAdmin && !role.isPlatformOwner;
  const teacherView = !adminView && role.isTeacher && !role.isPlatformOwner;
  const ctx = useCurriculumContext(schoolId, { admin: adminView, teacher: teacherView });
  const params = { sessionId: ctx.sessionId, termId: ctx.termId };
  const mq = useListSchoolCurriculumMappings(schoolId, params, { query: { enabled: schoolId > 0 && (adminView || teacherView) && ctx.sessionId > 0 && ctx.termId > 0, queryKey: getListSchoolCurriculumMappingsQueryKey(schoolId, params), ...FRESH } });
  if (role.loading) return <SkeletonPage />;
  const head = <PageHeading eyebrow="Curriculum" title="School curriculum." description={teacherView ? 'The curriculum assigned to the classes and subjects you teach, with coverage you record yourself.' : 'Assign published curriculum versions to classes and subjects, then track coverage.'} action={role.isPlatformOwner ? <TenantPicker /> : undefined} />;
  if (role.isPlatformOwner) return <div>{head}<EmptyState icon={BookMarked} title="Owner view" description="The Platform Owner manages the central library from Curriculum management. School assignment and coverage belong to School Admins and Teachers." /></div>;
  if (!schoolId || (!adminView && !teacherView)) return <div>{head}<EmptyState icon={BookMarked} title="Not available" description="Curriculum is available to School Admins and Teachers of the selected school." /></div>;
  if (ctx.loading) return <SkeletonPage />;
  if (ctx.error) return <ErrorState retry={ctx.refetch} />;

  const nameOf = (m: SchoolCurriculumMapping) => {
    const a = ctx.assignments.find(x => assignmentCovers(x, m.classId, m.subjectId));
    const c = ctx.classes.find(x => x.id === m.classId);
    const s = ctx.subjects.find(x => x.id === m.subjectId);
    const cn = c ? `${c.name} ${c.section}` : a?.className ?? `Class ${m.classId}`;
    const sn = s?.name ?? a?.subjectName ?? `Subject ${m.subjectId}`;
    return { title: `${cn} / ${sn}`, className: c?.name ?? a?.className ?? '' };
  };
  const mappings = (mq.data ?? []).filter(m => adminView || ctx.assignments.some(a => assignmentCovers(a, m.classId, m.subjectId)));
  return (
    <div className="fade-up">
      {head}
      <SessionTermPicker ctx={ctx} />
      {adminView && <AssignPanel schoolId={schoolId} ctx={ctx} />}
      {mq.isLoading ? <SkeletonPage /> : mq.isError ? <ErrorState retry={() => mq.refetch()} message={errMsg(mq.error)} /> : mappings.length === 0 ? (
        <div className="panel"><EmptyState icon={BookMarked} title="No curriculum assigned" description={adminView ? 'Assign a published version to a class and subject above.' : 'None of your classes and subjects has a curriculum for this term yet. Your School Admin assigns it.'} /></div>
      ) : (
        <div className="space-y-4" data-testid="list-mappings">
          {mappings.map(m => { const n = nameOf(m); return <MappingCard key={m.id} subject={adminView ? ctx.subjects.find(x => x.id === m.subjectId) : undefined} schoolId={schoolId} mapping={m} title={n.title} classLevel={n.className} classLevelHint={n.className} subjectId={m.subjectId} />; })}
        </div>
      )}
    </div>
  );
}

export default SchoolCurriculumPage;

function SyllabusOverview({ schoolId, subject, topics, version, versionId }: { schoolId: number; subject: { id: number; name: string; description?: string | null }; topics: Parameters<typeof buildSyllabusOverview>[0]; version: Parameters<typeof buildSyllabusOverview>[1]; versionId: number }) {
  const preview = buildSyllabusOverview(topics, version, versionId);
  const [text, setText] = useState<string | null>(null);
  const update = useUpdateSubject();
  const invalidate = useInvalidateSchool(schoolId);
  const qc = useQueryClient();
  const footnote = preview.includes('\n\nSource:') ? preview.slice(preview.lastIndexOf('\n\nSource:') + 2) : '';
  const shown = text ?? subject.description ?? '';
  const missingFootnote = text !== null && !!footnote && !text.includes(footnote.split(' (version')[0]);
  return (
    <div className="mt-5 border-t border-[hsl(var(--border))] pt-4" data-testid={`syllabus-overview-${subject.id}`}>
      <h4 className="font-bold">Subject syllabus overview</h4>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Built only from the published source topics above. Review and edit it before saving to {subject.name}. The saved text is the school's reviewed overview, not the official document.</p>
      <textarea className="mt-3 min-h-[140px] w-full" aria-label="Syllabus overview" value={shown} onChange={e => setText(e.target.value)} data-testid={`input-syllabus-${subject.id}`} />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" disabled={!preview} onClick={() => setText(preview)} testId={`button-draft-syllabus-${subject.id}`}>{preview ? 'Draft from source topics' : 'No source topics to draft from'}</Button>
        <Button disabled={update.isPending || text === null || !text.trim() || missingFootnote} onClick={() => update.mutate({ subjectId: subject.id, data: { description: text!.trim() }, params: { schoolId } }, { onSuccess: () => { setText(null); invalidate(); void qc.invalidateQueries({ queryKey: ['subjects', schoolId] }); } })} testId={`button-save-syllabus-${subject.id}`}>{update.isPending ? 'Saving...' : 'Save overview'}</Button>
      </div>
      {missingFootnote && <p className="mt-2 text-xs text-[hsl(var(--destructive))]" role="alert">Keep the source line at the end so the overview stays tied to its published source.</p>}
      {update.error && <div className="mt-2"><Notice tone="error">{errMsg(update.error)}</Notice></div>}
      {update.isSuccess && text === null && <p className="mt-2 text-xs">Saved to the subject.</p>}
    </div>
  );
}
