import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, GraduationCap, ShieldAlert } from 'lucide-react';
import {
  useListAcademicSessions, useListAcademicTerms, useListClasses,
  usePreparePromotionBatch, useListPromotionBatches, useGetPromotionBatch, useListPromotionBatchHistory,
  useReviewPromotionDecision, useFinalizePromotionBatch,
  getListStudentsQueryKey, getListPromotionBatchesQueryKey, getGetPromotionBatchQueryKey, getListPromotionBatchHistoryQueryKey,
  type PromotionStudent, type SchoolClass, type AcademicTerm,
} from '@workspace/api-client-react';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Field, TenantPicker, Modal, Info, date, cx } from '@/components/shared';
import { FRESH, Notice, useSchoolRole } from '@/components/school-ops-kit';
import {
  OUTCOMES, NEEDS_PLACEMENT, emptyDraft, validateDraft, toReviewInput, canFinalize, unreviewedCount, isReviewed,
  classifyError, attemptKey, clearAttemptKey, type Draft, type Failure,
} from './promotion-logic';

const pct = (v: number | null | undefined) => (v == null ? 'n/a' : `${v.toFixed(1)}%`);
const placement = (p?: { className: string; section: string } | null) => (p ? `${p.className} ${p.section}` : '—');

export function PromotionPage() {
  const role = useSchoolRole();
  const { schoolId, canManage } = role;
  const [batchId, setBatchId] = useState(0);
  return (
    <div className="fade-up">
      <PageHeading eyebrow="Academics / Promotion" title="Year-end promotion."
        description="Move students into the next session by explicit decision. Each student keeps the same record, admission number and NFC card across years."
        action={<TenantPicker />} />
      {role.loading ? <SkeletonPage /> : !schoolId || !canManage ? (
        <div className="panel"><EmptyState icon={ShieldAlert} title="School administrators only" description="Promotion is restricted to the School Admin of the selected school." /></div>
      ) : batchId ? <BatchDetail schoolId={schoolId} batchId={batchId} onBack={() => setBatchId(0)} />
        : <BatchHome schoolId={schoolId} onOpen={setBatchId} />}
    </div>
  );
}

function BatchHome({ schoolId, onOpen }: { schoolId: number; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const params = { schoolId, limit: 50 };
  const list = useListPromotionBatches(params, { query: { queryKey: getListPromotionBatchesQueryKey(params), ...FRESH } });
  const sessionsQ = useListAcademicSessions({ schoolId }, { query: { queryKey: ['promo-sessions', schoolId], ...FRESH } });
  const sessions = sessionsQ.data ?? [];
  const [source, setSource] = useState(0);
  const [target, setTarget] = useState(0);
  const termsQ = useListAcademicTerms(target, { schoolId }, { query: { enabled: !!target, queryKey: ['promo-terms', schoolId, target], ...FRESH } });
  const scope = `prepare:${schoolId}:${source}:${target}`;
  const [key, setKey] = useState('');
  useEffect(() => { setKey(source && target ? attemptKey(scope) : ''); }, [scope, source, target]);
  const prepare = usePreparePromotionBatch({ request: { headers: { 'Idempotency-Key': key } } });
  const [fail, setFail] = useState<Failure | null>(null);
  const bad = !source || !target ? 'Choose both sessions.' : source === target ? 'Source and target sessions must differ.' : null;

  const submit = () => {
    if (bad || !key) return;
    setFail(null);
    prepare.mutate({ data: { sourceSessionId: source, targetSessionId: target }, params: { schoolId } }, {
      onSuccess: b => { clearAttemptKey(scope); qc.invalidateQueries({ queryKey: getListPromotionBatchesQueryKey() }); onOpen(b.id); },
      onError: e => {
        const f = classifyError(e); setFail(f);
        if (f.kind === 'validation' || f.kind === 'forbidden') { clearAttemptKey(scope); setKey(attemptKey(scope)); }
        if (f.kind === 'conflict') list.refetch();
      },
    });
  };
  const batches = list.data ?? [];
  const nameOf = (id: number) => sessions.find(s => s.id === id)?.name ?? `Session ${id}`;
  return (
    <div className="space-y-8">
      <form className="panel space-y-5 p-5 md:p-6" onSubmit={e => { e.preventDefault(); submit(); }} aria-labelledby="prep-h">
        <div><div className="eyebrow">Step 1</div><h2 id="prep-h" className="display-font text-xl font-bold">Prepare a read-only batch</h2>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Preparing snapshots enrolled students with their performance and attendance. No student is moved yet.</p></div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Source session"><select value={source} onChange={e => setSource(Number(e.target.value))}><option value={0}>Select…</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? ' (current)' : ''}</option>)}</select></Field>
          <Field label="Target session"><select value={target} onChange={e => { setTarget(Number(e.target.value)); }}><option value={0}>Select…</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? ' (current)' : ''}</option>)}</select></Field>
          <div className="rounded-xl bg-[hsl(var(--muted))] p-3 text-xs">Placement terms are chosen per student during review. The effective date is the backend finalization date; it is not set here.{target ? ` ${(termsQ.data ?? []).filter(t => t.isCurrent).length ? 'A current term exists in the target session.' : 'The target session has no current term yet.'}` : ''}</div>
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Nothing takes effect until the batch is finalized.</p>
        {sessionsQ.isError && <Notice tone="error">Sessions could not be loaded.</Notice>}
        {bad && (source || target) && <Notice tone="info">{bad}</Notice>}
        {fail && <div role="alert"><Notice tone="error">{fail.message}</Notice></div>}
        <div className="flex justify-end">
          <Button type="submit" disabled={!!bad || prepare.isPending || !key} testId="button-prepare-batch">
            {prepare.isPending ? 'Preparing…' : fail?.kind === 'network' || fail?.kind === 'server' ? 'Retry safely' : 'Prepare batch'}
          </Button>
        </div>
      </form>

      <section aria-labelledby="batches-h">
        <h2 id="batches-h" className="eyebrow mb-3">Batches and history</h2>
        {list.isLoading ? <SkeletonPage /> : list.isError ? <ErrorState retry={() => list.refetch()} message="Promotion batches could not be loaded." /> :
          batches.length === 0 ? <div className="panel"><EmptyState icon={GraduationCap} title="No promotion batches" description="Prepare a batch above to begin the year-end review." /></div> : (
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Promotion batches</caption>
                <thead><tr className="text-left text-xs text-[hsl(var(--muted-foreground))]"><th scope="col" className="p-4">From</th><th scope="col" className="p-4">To</th><th scope="col" className="p-4">Students</th><th scope="col" className="p-4">Status</th><th scope="col" className="p-4">Created</th><th scope="col" className="p-4"><span className="sr-only">Open</span></th></tr></thead>
                <tbody>{batches.map(b => (
                  <tr key={b.id} className="border-t border-[hsl(var(--border)/.6)]">
                    <td className="p-4 font-bold">{nameOf(b.sourceSessionId)}</td><td className="p-4">{nameOf(b.targetSessionId)}</td>
                    <td className="p-4 font-mono">{b.studentCount}</td><td className="p-4"><StatusPill value={b.status === 'Finalized' ? 'completed' : 'pending'} /> <span className="ml-1 text-xs">{b.status}</span></td>
                    <td className="p-4">{date(b.finalizedAt ?? b.createdAt)}</td>
                    <td className="p-4"><Button variant="quiet" onClick={() => onOpen(b.id)} testId={`button-open-batch-${b.id}`}>{b.status === 'Finalized' ? 'View' : 'Review'}<ArrowRight size={14} /></Button></td>
                  </tr>))}</tbody>
              </table>
            </div>)}
      </section>
    </div>
  );
}

function BatchDetail({ schoolId, batchId, onBack }: { schoolId: number; batchId: number; onBack: () => void }) {
  const qc = useQueryClient();
  const params = { schoolId };
  const q = useGetPromotionBatch(batchId, params, { query: { queryKey: getGetPromotionBatchQueryKey(batchId, params), ...FRESH } });
  const hist = useListPromotionBatchHistory(batchId, params, { query: { queryKey: getListPromotionBatchHistoryQueryKey(batchId, params), ...FRESH } });
  const classesQ = useListClasses({ schoolId }, { query: { queryKey: ['promo-classes', schoolId], ...FRESH } });
  const targetSessionId = q.data?.targetSessionId ?? 0;
  const termsQ = useListAcademicTerms(targetSessionId, { schoolId }, { query: { enabled: !!targetSessionId, queryKey: ['promo-terms', schoolId, targetSessionId], ...FRESH } });
  const sessionsQ = useListAcademicSessions({ schoolId }, { query: { queryKey: ['promo-sessions', schoolId], ...FRESH } });
  const [editing, setEditing] = useState<PromotionStudent | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<Failure | null>(null);
  const fscope = `finalize:${schoolId}:${batchId}`;
  const [fkey, setFkey] = useState(() => attemptKey(fscope));
  const finalize = useFinalizePromotionBatch({ request: { headers: { 'Idempotency-Key': fkey } } });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: getListPromotionBatchesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPromotionBatchQueryKey(batchId) });
    qc.invalidateQueries({ queryKey: getListPromotionBatchHistoryQueryKey(batchId) });
    qc.invalidateQueries({ queryKey: getListStudentsQueryKey({ schoolId }) });
    qc.invalidateQueries({ queryKey: getListStudentsQueryKey().slice(0, 1) });
  };

  const students = useMemo(() => q.data?.students ?? [], [q.data]);
  const [filter, setFilter] = useState<'all' | 'open'>('all');
  if (q.isLoading) return <SkeletonPage />;
  if (q.isError || !q.data) return <ErrorState retry={() => q.refetch()} message="This batch could not be loaded." />;
  const batch = q.data;
  const final = batch.status === 'Finalized';
  const left = unreviewedCount(students);
  const sessions = sessionsQ.data ?? [];
  const target = sessions.find(s => s.id === batch.targetSessionId);
  const shown = filter === 'open' ? students.filter(s => !isReviewed(s)) : students;

  const doFinalize = () => {
    setNotice(null);
    finalize.mutate({ batchId, params }, {
      onSuccess: () => { clearAttemptKey(fscope); setConfirm(false); refreshAll(); },
      onError: e => {
        const f = classifyError(e); setNotice(f); setConfirm(false);
        if (f.kind === 'validation' || f.kind === 'forbidden') { clearAttemptKey(fscope); setFkey(attemptKey(fscope)); }
        refreshAll();
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onBack} testId="button-back-batches">All batches</Button>
        <StatusPill value={final ? 'completed' : 'pending'} /><span className="text-sm font-bold">{batch.status}</span>
        {final && <span className="text-xs text-[hsl(var(--muted-foreground))]">Finalized {date(batch.finalizedAt)}. Read-only.</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Info label="Students" value={batch.studentCount} /><Info label="Awaiting review" value={final ? 0 : left} /><Info label="Target session" value={target?.name ?? `Session ${batch.targetSessionId}`} />
      </div>
      {notice && <div role="alert"><Notice tone={notice.kind === 'conflict' ? 'info' : 'error'}>{notice.message}</Notice></div>}
      {!final && target && !target.isCurrent && (
        <div className="panel border-l-4 border-[hsl(var(--accent))] p-4 text-sm">
          <strong>Target session is not current.</strong> Finalization is rejected until the target session and term are the current school calendar. This page never changes the calendar.
          {' '}<Link href="/academics" className="font-bold underline">Open Academics</Link> or <Link href="/academic-calendar" className="font-bold underline">the academic calendar</Link> to activate it, then return here.
        </div>
      )}

      <div className="flex items-center gap-3">
        <label htmlFor="pf" className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Show</label>
        <select id="pf" className="max-w-[12rem]" value={filter} onChange={e => setFilter(e.target.value as 'all' | 'open')}><option value="all">All students</option><option value="open">Needing review</option></select>
      </div>
      {students.length === 0 ? <div className="panel"><EmptyState icon={GraduationCap} title="No students in this batch" description="The source session had no enrolled students to review." /></div> : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <caption className="sr-only">Students in promotion batch</caption>
            <thead><tr className="text-left text-xs text-[hsl(var(--muted-foreground))]">
              {['Student', 'Current class', 'Average', 'Attendance', 'Advisory', 'Outcome', 'Next placement', ''].map((h, i) => <th key={i} scope="col" className="p-3">{h || <span className="sr-only">Action</span>}</th>)}</tr></thead>
            <tbody>{shown.map(s => (
              <tr key={s.studentId} className="border-t border-[hsl(var(--border)/.6)] align-top">
                <td className="p-3"><div className="font-bold">{s.studentName}</div><div className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{s.admissionNumber} · ID {s.studentId}</div></td>
                <td className="p-3">{placement(s.sourcePlacement)}</td>
                <td className="p-3 font-mono">{s.academicPerformance.averageScore == null ? 'n/a' : s.academicPerformance.averageScore.toFixed(1)}<div className="text-[11px] text-[hsl(var(--muted-foreground))]">{s.academicPerformance.scoredCount}/{s.academicPerformance.resultCount} scored</div></td>
                <td className="p-3 font-mono">{pct(s.attendanceSummary.attendanceRate)}<div className="text-[11px] text-[hsl(var(--muted-foreground))]">{s.attendanceSummary.presentCount}P {s.attendanceSummary.absentCount}A {s.attendanceSummary.lateCount}L</div></td>
                <td className="p-3 text-xs">{s.recommendation}<div className="text-[hsl(var(--muted-foreground))]">advisory only</div></td>
                <td className="p-3"><span className={cx('font-bold', !isReviewed(s) && 'text-[hsl(var(--muted-foreground))]')}>{isReviewed(s) ? s.status : 'Not reviewed'}</span>{s.reason && <div className="max-w-[16rem] text-xs text-[hsl(var(--muted-foreground))]">{s.reason}</div>}</td>
                <td className="p-3">{placement(s.targetPlacement)}</td>
                <td className="p-3">{!final && <Button variant="outline" onClick={() => setEditing(s)} testId={`button-review-${s.studentId}`}>{isReviewed(s) ? 'Change' : 'Decide'}</Button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      {!final && (
        <div className="panel flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
          <p className="text-sm">{left > 0 ? `${left} student${left === 1 ? '' : 's'} still need an outcome before this batch can be finalized.` : 'Every student has a reviewed outcome.'}</p>
          <Button onClick={() => setConfirm(true)} disabled={!canFinalize(batch.status, students) || finalize.isPending} testId="button-finalize-batch">Finalize batch</Button>
        </div>
      )}

      <section aria-labelledby="hist-h">
        <h2 id="hist-h" className="eyebrow mb-3">Audit history</h2>
        {hist.isLoading ? <div className="h-24 animate-pulse rounded-2xl bg-[hsl(var(--muted))]" /> : hist.isError ? <ErrorState retry={() => hist.refetch()} message="History could not be loaded." /> :
          (hist.data ?? []).length === 0 ? <div className="panel"><EmptyState icon={GraduationCap} title="No history yet" description="Events appear as the batch is reviewed." /></div> : (
            <ol className="panel divide-y divide-[hsl(var(--border)/.6)]">{(hist.data ?? []).map(h => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-xs">
                <span className="font-bold">{h.eventType.replaceAll('_', ' ').toLowerCase()}</span>
                {h.studentId && <span className="font-mono">student {h.studentId}</span>}
                <StatusPill value={h.result === 'SUCCESS' ? 'completed' : 'failed'} />
                <span className="ml-auto text-[hsl(var(--muted-foreground))]">{date(h.createdAt)}</span>
              </li>))}</ol>)}
      </section>

      {editing && <ReviewDialog key={editing.studentId} student={editing} classes={classesQ.data ?? []} terms={termsQ.data ?? []} classesError={classesQ.isError}
        schoolId={schoolId} batchId={batchId} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refreshAll(); }} onConflict={() => { setEditing(null); refreshAll(); }} setNotice={setNotice} />}

      {confirm && (
        <Modal title="Finalize promotion" eyebrow="Destructive lifecycle change" onClose={() => setConfirm(false)}>
          <div className="space-y-4 text-sm">
            <p>Finalizing applies all {students.length} reviewed outcomes at once and cannot be undone from this screen.</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Promoted and Repeat students are placed in their target class, section and term.</li>
              <li>Graduated, Withdrawn and Transferred students leave active enrollment and their lifecycle status changes.</li>
              <li>Each student keeps the same record, admission number and NFC card; only placement and status change.</li>
              <li>The target session and term must already be current. Nothing here activates the calendar.</li>
            </ul>
            <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4">
              <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button variant="danger" onClick={doFinalize} disabled={finalize.isPending} testId="button-confirm-finalize">{finalize.isPending ? 'Finalizing…' : 'Finalize now'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ReviewDialog({ student, classes, terms, classesError, schoolId, batchId, onClose, onSaved, onConflict, setNotice }: {
  student: PromotionStudent; classes: SchoolClass[]; terms: AcademicTerm[]; classesError: boolean; schoolId: number; batchId: number;
  onClose: () => void; onSaved: () => void; onConflict: () => void; setNotice: (f: Failure | null) => void;
}) {
  const review = useReviewPromotionDecision();
  const [d, setD] = useState<Draft>(() => {
    const t = student.targetPlacement;
    return student.status === 'Pending' || student.status === 'Eligible' ? emptyDraft()
      : { status: student.status as Draft['status'], reason: student.reason ?? '', targetClassId: t?.classId ?? null, targetSection: t?.section ?? '', targetTermId: t?.termId ?? null };
  });
  const [err, setErr] = useState<string | null>(null);
  const placed = !!d.status && NEEDS_PLACEMENT.includes(d.status);
  const sections = classes.filter(c => c.id === d.targetClassId);
  const submit = () => {
    const v = validateDraft(d); setErr(v); if (v) return;
    setNotice(null);
    review.mutate({ batchId, studentId: student.studentId, data: toReviewInput(d), params: { schoolId } }, {
      onSuccess: onSaved,
      onError: e => { const f = classifyError(e); if (f.kind === 'conflict') { setNotice(f); onConflict(); } else setErr(f.message); },
    });
  };
  return (
    <Modal title={student.studentName} eyebrow={`Decide outcome · ${student.admissionNumber}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); submit(); }} noValidate>
        <Field label="Outcome"><select value={d.status} onChange={e => setD({ ...d, status: e.target.value as Draft['status'] })} aria-invalid={!!err}><option value="">Select…</option>{OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}</select></Field>
        {placed && <>
          <Field label="Target class"><select value={d.targetClassId ?? ''} onChange={e => { const c = classes.find(x => x.id === Number(e.target.value)); setD({ ...d, targetClassId: c?.id ?? null, targetSection: c?.section ?? '' }); }}><option value="">Select…</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}</select></Field>
          <Field label="Target section"><select value={d.targetSection} onChange={e => setD({ ...d, targetSection: e.target.value })} disabled={!d.targetClassId}><option value="">Select…</option>{sections.map(c => <option key={c.id} value={c.section}>{c.section}</option>)}</select></Field>
          <Field label="Target term"><select value={d.targetTermId ?? ''} onChange={e => setD({ ...d, targetTermId: e.target.value ? Number(e.target.value) : null })}><option value="">Select…</option>{terms.map(t => <option key={t.id} value={t.id}>{t.name.toLowerCase()} term</option>)}</select></Field>
          {classesError && <Notice tone="error">Classes could not be loaded.</Notice>}
        </>}
        <Field label="Reason (required)"><textarea rows={3} maxLength={1000} value={d.reason} onChange={e => setD({ ...d, reason: e.target.value })} /></Field>
        {err && <div role="alert"><Notice tone="error">{err}</Notice></div>}
        <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={review.isPending} testId="button-save-decision">{review.isPending ? 'Saving…' : 'Save decision'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default PromotionPage;
