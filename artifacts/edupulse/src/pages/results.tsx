import { useState, FormEvent, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Modal, Field, TenantPicker, useTenant, cx, date } from '@/components/shared';
import { 
  useListAcademicAssessments, getListAcademicAssessmentsQueryKey,
  useListAcademicResults, useCreateAcademicResult, useUpdateAcademicResult, usePublishAcademicAssessmentResults, getListAcademicResultsQueryKey,
  useListAcademicReportCards, useCreateAcademicReportCard, usePublishAcademicReportCard, getListAcademicReportCardsQueryKey,
  useListAcademicGradingRules, useCreateAcademicGradingRule, useUpdateAcademicGradingRule, getListAcademicGradingRulesQueryKey,
  useListAcademicSessions, useListAcademicTerms, useListClasses, useListSubjects, useListStudents, useGetAuthorizedContext
} from '@workspace/api-client-react';
import { Plus, BarChart3, Save, CheckCircle2, Search, Pencil } from 'lucide-react';
import { SchoolDocumentHeader, SchoolDocumentPrintButton, useSchoolDocumentBranding } from '@/components/school-document';

type AcademicResultReviewItem = {
  id: number;
  schoolId?: number;
  assessmentId?: number;
  studentId: number;
  studentName?: string | null;
  admissionNo?: string | null;
  score: number | string;
  maxScore: number | string;
  grade?: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'PUBLISHED' | 'ARCHIVED';
  reviewStatus: 'NOT_REVIEWED' | 'APPROVED' | 'RETURNED';
  reviewComment?: string | null;
};

function useAcademicContext(schoolId: number) {
  const sessions = useListAcademicSessions({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['sessions', schoolId] } });
  const activeSession = sessions.data?.find((s: any) => s.isCurrent) || sessions.data?.[0];
  const terms = useListAcademicTerms(activeSession?.id as number, { schoolId }, { query: { enabled: !!(schoolId && activeSession?.id), queryKey: ['terms', activeSession?.id, schoolId] } });
  const activeTerm = terms.data?.find((t: any) => t.isCurrent) || terms.data?.[0];
  const classes = useListClasses({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['classes', schoolId] } });
  const subjects = useListSubjects({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['subjects', schoolId] } });

  return { activeSession, activeTerm, sessions: sessions.data ?? [], terms: terms.data ?? [], classes: classes.data ?? [], subjects: subjects.data ?? [], isLoading: sessions.isLoading || terms.isLoading || classes.isLoading || subjects.isLoading };
}

export function ResultsPage() {
  const { schoolId } = useTenant();
  const [tab, setTab] = useState<'results' | 'cards' | 'rules'>('results');
  const context = useGetAuthorizedContext().data;
  const isPlatformOwner = context?.isPlatformOwner === true;
  const canManage = !isPlatformOwner && !!context?.roles?.some(
    role => role.role === 'SCHOOL_ADMIN' && role.schoolId === schoolId && role.status === 'ACTIVE'
  );
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Academics" 
        title="Results & Reports." 
        description={isPlatformOwner ? 'View school results. School Admins manage marks, grading rules, and report cards.' : 'Enter marks, manage grading rules, and publish report cards.'}
        action={<TenantPicker />} 
      />
      {!schoolId ? (
        <EmptyState icon={BarChart3} title="Select a school context" description="Select a school to view results." />
      ) : (
        <>
          <div className="mb-6 flex gap-2 border-b border-[hsl(var(--border))]">
             {[{id: 'results', label: isPlatformOwner ? 'Results' : 'Result Entry'}, ...(canManage ? [{id: 'cards', label: 'Report Cards'}, {id: 'rules', label: 'Grading Rules'}] : [])].map(t => (
              <button 
                key={t.id} 
                onClick={() => setTab(t.id as any)} 
                className={cx("px-4 py-2.5 text-sm font-bold border-b-2 transition-colors", tab === t.id ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}
              >
                {t.label}
              </button>
            ))}
          </div>
           {tab === 'results' && <ResultEntryView schoolId={schoolId} canManage={canManage} isPlatformOwner={isPlatformOwner} />}
           {canManage && tab === 'cards' && <ReportCardsView schoolId={schoolId} />}
           {canManage && tab === 'rules' && <GradingRulesView schoolId={schoolId} />}
        </>
      )}
    </div>
  );
}

function ResultEntryView({ schoolId, canManage, isPlatformOwner }: { schoolId: number; canManage: boolean; isPlatformOwner: boolean }) {
  const { activeSession, activeTerm, classes, subjects, isLoading } = useAcademicContext(schoolId);
  const assessmentsQuery = useListAcademicAssessments(
    { schoolId, sessionId: activeSession?.id, termId: activeTerm?.id }, 
    { query: { enabled: !!(schoolId && activeSession?.id && activeTerm?.id), queryKey: getListAcademicAssessmentsQueryKey({ schoolId, sessionId: activeSession?.id, termId: activeTerm?.id }) } }
  );

  const [assessmentId, setAssessmentId] = useState<number | ''>('');
  
  const selectedAssessment = assessmentsQuery.data?.find((a: any) => a.id === assessmentId);
  const classId = selectedAssessment?.classId;
  const maxScore = selectedAssessment?.maxScore || 100;
  
  const studentsQuery = useListStudents({ schoolId, classId }, { query: { enabled: !!(schoolId && classId), queryKey: ['students', schoolId, classId] } });
  const resultsQuery = useListAcademicResults({ schoolId, assessmentId: assessmentId as number }, { query: { enabled: !!(schoolId && assessmentId), queryKey: getListAcademicResultsQueryKey({ schoolId, assessmentId: assessmentId as number }) } });
  const reviewQuery = useQuery({
    queryKey: ['academic-result-review', schoolId, assessmentId],
    enabled: canManage && !!schoolId && !!assessmentId,
    queryFn: async () => {
      const params = new URLSearchParams({ schoolId: String(schoolId), assessmentId: String(assessmentId) });
      const response = await fetch(`/api/academic/results/review?${params}`, { credentials: 'include' });
      const result = await response.json().catch(() => []);
      if (!response.ok) throw new Error(result?.error || `Could not load result review queue (${response.status})`);
      return result;
    },
  });

  const qc = useQueryClient();
  const publish = usePublishAcademicAssessmentResults();

  if (isLoading || assessmentsQuery.isLoading) return <SkeletonPage />;

  const assessments = assessmentsQuery.data ?? [];
  const students = studentsQuery.data ?? [];
  const results = resultsQuery.data ?? [];
  const reviewResults: AcademicResultReviewItem[] = (reviewQuery.data ?? []) as AcademicResultReviewItem[];
  const approvedCount = reviewResults.filter(result => result.status === 'SUBMITTED' && result.reviewStatus === 'APPROVED').length;

  const handlePublish = () => {
    if (!assessmentId) return;
    if (confirm("Are you sure you want to publish these results? Parents and students will be able to see them.")) {
      publish.mutate({ assessmentId: assessmentId as number, data: { schoolId } }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListAcademicAssessmentsQueryKey() });
          qc.invalidateQueries({ queryKey: getListAcademicResultsQueryKey() });
        }
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="panel p-5 flex items-center gap-4 bg-[hsl(var(--card))] border border-[hsl(var(--border))]">
        <div className="w-full max-w-sm">
          <Field label="Select Assessment">
            <select value={assessmentId} onChange={e => setAssessmentId(e.target.value ? Number(e.target.value) : '')} className="w-full">
              <option value="">Choose an assessment to grade...</option>
              {assessments.map((a: any) => (
                <option key={a.id} value={a.id}>{a.title} ({classes.find((c: any) => c.id === a.classId)?.name || 'Class'})</option>
              ))}
            </select>
          </Field>
        </div>
        {selectedAssessment && (
          <div className="ml-auto flex items-center gap-4">
             <div className="text-sm">
                <span className="text-[hsl(var(--muted-foreground))]">Status:</span> <StatusPill value={selectedAssessment.status} />
             </div>
              {canManage && selectedAssessment.status !== 'PUBLISHED' && (
                <Button onClick={handlePublish} disabled={publish.isPending || approvedCount === 0}><CheckCircle2 size={16}/> Publish Approved ({approvedCount})</Button>
             )}
          </div>
        )}
        {publish.isError && <p role="alert" className="basis-full text-sm text-[hsl(var(--destructive))]">
          Could not publish approved results: {(publish.error as Error).message}
        </p>}
      </div>

      {assessmentId && selectedAssessment ? (
        <div className="panel overflow-hidden">
          {studentsQuery.isError && <p role="alert" className="p-4 text-sm text-[hsl(var(--destructive))]">
            Could not load students for this assessment: {(studentsQuery.error as Error).message}
          </p>}
          {resultsQuery.isError && <p role="alert" className="p-4 text-sm text-[hsl(var(--destructive))]">
            Could not load existing academic results: {(resultsQuery.error as Error).message}
          </p>}
          <div className="bg-[hsl(var(--muted)/.3)] p-5 border-b border-[hsl(var(--border))]">
             <h3 className="font-bold">{selectedAssessment.title} Results</h3>
             <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Class: {classes.find((c: any) => c.id === classId)?.name} • Max Score: {maxScore}</p>
          </div>
          {studentsQuery.isLoading || resultsQuery.isLoading ? (
            <div className="p-8 text-center text-[hsl(var(--muted-foreground))]">Loading roster...</div>
          ) : students.length > 0 ? (
            <div className="divide-y divide-[hsl(var(--border)/.6)]">
              {students.map((student: any) => {
                const existing = results.find((r: any) => r.studentId === student.id);
                return (
                  <ResultRow 
                    key={student.id} 
                    student={student} 
                    existing={existing} 
                    assessmentId={assessmentId} 
                    maxScore={maxScore}
                    schoolId={schoolId}
                    sessionId={activeSession?.id}
                    termId={activeTerm?.id}
                    disabled={selectedAssessment.status === 'PUBLISHED' || (isPlatformOwner && !canManage)}
                    canManage={canManage}
                  />
                );
              })}
            </div>
          ) : (
             <EmptyState icon={BarChart3} title="No students found" description="There are no students assigned to this class." />
          )}
          {canManage && <div className="border-t border-[hsl(var(--border))]">
            <div className="p-5 bg-[hsl(var(--muted)/.2)]">
              <h4 className="font-bold">School Admin review</h4>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Only approved submitted results can be published. Returned comments stay in the private review workflow.</p>
            </div>
            {reviewQuery.isLoading ? <p role="status" className="p-5 text-sm">Loading results for review…</p> : reviewQuery.isError ? (
              <p role="alert" className="p-5 text-sm text-[hsl(var(--destructive))]">Review queue unavailable: {(reviewQuery.error as Error).message}</p>
            ) : reviewResults.filter(result => result.status === 'SUBMITTED').length ? (
              <div className="divide-y divide-[hsl(var(--border)/.6)]">
                {reviewResults.filter(result => result.status === 'SUBMITTED').map(result => (
                  <AdminResultReviewRow
                    key={result.id}
                    result={result}
                    schoolId={schoolId}
                    disabled={selectedAssessment.status === 'PUBLISHED'}
                    onReviewed={() => {
                      qc.invalidateQueries({ queryKey: ['academic-result-review', schoolId, assessmentId] });
                      qc.invalidateQueries({ queryKey: getListAcademicResultsQueryKey({ schoolId, assessmentId: assessmentId as number }) });
                    }}
                  />
                ))}
              </div>
            ) : <p className="p-5 text-sm text-[hsl(var(--muted-foreground))]">No submitted results are waiting for review.</p>}
          </div>}
        </div>
      ) : (
        <EmptyState icon={Search} title="No assessment selected" description="Choose an assessment above to enter marks." />
      )}
      {assessmentsQuery.isError && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">
        Could not load assessments: {(assessmentsQuery.error as Error).message}
      </p>}
    </div>
  );
}

export function ResultRow({ student, existing, assessmentId, maxScore, schoolId, sessionId, termId, disabled, canManage }: any) {
  const create = useCreateAcademicResult();
  const update = useUpdateAcademicResult();
  const qc = useQueryClient();

  const [score, setScore] = useState<string>(existing?.score?.toString() || '');
  const [remarks, setRemarks] = useState<string>(existing?.remark || '');
  const [isDirty, setIsDirty] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (existing) {
      setScore(existing.score?.toString() || '');
      setRemarks(existing.remark || '');
      setIsDirty(false);
      setSaveError('');
    }
  }, [existing]);

  const handleSave = () => {
    setSaveError('');
    const numericScore = parseFloat(score);
    if (isNaN(numericScore) || numericScore < 0 || numericScore > maxScore) {
       setSaveError(`Score must be a number between 0 and ${maxScore}`);
       return;
    }

    const data = { schoolId, studentId: student.id, assessmentId, score: numericScore, remark: remarks };
    const onSuccess = () => {
       setIsDirty(false);
       qc.invalidateQueries({ queryKey: getListAcademicResultsQueryKey({ schoolId, assessmentId }) });
    };

    if (existing) {
      update.mutate({ resultId: existing.id, data: { schoolId, score: numericScore, remark: remarks } }, { onSuccess });
    } else {
      create.mutate({ data }, { onSuccess });
    }
  };

  const handleSubmitForReview = async () => {
    if (!existing || existing.status !== 'DRAFT' || canManage || disabled) return;
    setSubmitError('');
    setSubmitPending(true);
    try {
      const response = await fetch(`/api/academic/results/${existing.id}/submit`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || `Could not submit result (${response.status})`);
      qc.invalidateQueries({ queryKey: getListAcademicResultsQueryKey({ schoolId, assessmentId }) });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not submit result for review');
    } finally {
      setSubmitPending(false);
    }
  };

  const pending = create.isPending || update.isPending;
  const canEdit = !disabled && (
    !existing ||
    existing.status === 'DRAFT' ||
    (canManage && existing.status === 'PUBLISHED')
  );

  return (
    <div className="flex items-center gap-4 p-4 hover:bg-[hsl(var(--muted)/.2)]">
      <div className="w-10 h-10 rounded-full bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))] grid place-items-center text-xs font-bold shrink-0">
        {student.firstName[0]}{student.lastName[0]}
      </div>
      <div className="min-w-[200px] flex-1">
        <div className="font-bold text-sm">{student.firstName} {student.lastName}</div>
        <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{student.admissionNo}</div>
      </div>
      <div className="w-24">
        <input 
          type="number" step="0.1" min="0" max={maxScore} 
          value={score} 
          onChange={e => { setScore(e.target.value); setIsDirty(true); }}
          placeholder="Score"
          disabled={!canEdit || pending}
          className="w-full h-9 rounded-md border border-[hsl(var(--border))] px-3 text-sm"
        />
      </div>
      <div className="flex-1 max-w-[300px]">
        <input 
          type="text" 
          value={remarks} 
          onChange={e => { setRemarks(e.target.value); setIsDirty(true); }}
          placeholder="Remarks (optional)"
          disabled={!canEdit || pending}
          className="w-full h-9 rounded-md border border-[hsl(var(--border))] px-3 text-sm"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        {isDirty ? (
          <Button variant="outline" onClick={handleSave} disabled={pending || !canEdit} className="h-9 px-3 py-0">
            {pending ? '...' : 'Save'}
          </Button>
        ) : existing ? (
          <>
            <span role="status" className="text-[10px] font-bold text-[hsl(157_37%_43%)] bg-[hsl(157_37%_43%/.15)] px-2 py-1 rounded">{existing.status}</span>
            {!canManage && existing.status === 'DRAFT' && !disabled && !isDirty && (
              <Button variant="outline" onClick={handleSubmitForReview} disabled={submitPending} className="h-9 px-3 py-0">
                {submitPending ? 'Submitting…' : 'Submit for review'}
              </Button>
            )}
          </>
        ) : null}
      </div>
      {existing?.reviewStatus === 'RETURNED' && existing.reviewComment && (
        <p role="status" className="basis-full text-xs text-[hsl(var(--destructive))]">Admin feedback: {existing.reviewComment}</p>
      )}
      {submitError && <p role="alert" className="basis-full text-xs text-[hsl(var(--destructive))]">{submitError}</p>}
      {saveError && <p role="alert" className="basis-full text-xs text-[hsl(var(--destructive))]">{saveError}</p>}
      {(create.isError || update.isError) && <p role="alert" className="basis-full text-xs text-[hsl(var(--destructive))]">
        Could not save result: {((create.error || update.error) as Error)?.message || 'Unknown error'}
      </p>}
    </div>
  );
}

export function AdminResultReviewRow({ result, schoolId, disabled, onReviewed }: {
  result: AcademicResultReviewItem;
  schoolId: number;
  disabled: boolean;
  onReviewed: () => void;
}) {
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const review = async (decision: 'APPROVE' | 'RETURN') => {
    setError('');
    if (decision === 'RETURN' && !comment.trim()) {
      setError('Add a comment explaining the correction required.');
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/academic/results/${result.id}/review`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId, decision, comment: comment.trim() || null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Could not review result (${response.status})`);
      setComment('');
      onReviewed();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not review result');
    } finally {
      setPending(false);
    }
  };
  return <div className="flex flex-wrap items-center gap-3 p-4">
    <div className="min-w-48 flex-1">
      <div className="font-semibold text-sm">{result.studentName || `Student #${result.studentId}`} · {result.score}/{result.maxScore}</div>
      <div className="text-xs text-[hsl(var(--muted-foreground))]">
        {result.admissionNo ? `${result.admissionNo} · ` : ''}Grade {result.grade ?? '—'} · {result.reviewStatus || 'NOT_REVIEWED'}
      </div>
      {result.reviewComment && <p className="mt-1 text-xs">Previous review: {result.reviewComment}</p>}
    </div>
    {result.reviewStatus !== 'APPROVED' && <input
      className="min-w-52 flex-1"
      value={comment}
      onChange={event => setComment(event.target.value)}
        placeholder="Review comment (required to return)"
      aria-label={`Review comment for result ${result.id}`}
      disabled={pending || disabled}
    />}
    {result.reviewStatus === 'APPROVED' ? <StatusPill value="APPROVED" /> : (
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => review('RETURN')} disabled={pending || disabled} aria-label={`Return result ${result.id}`}>{pending ? 'Saving…' : 'Return'}</Button>
        <Button onClick={() => review('APPROVE')} disabled={pending || disabled} aria-label={`Approve result ${result.id}`}>{pending ? 'Saving…' : 'Approve'}</Button>
      </div>
    )}
    {error && <p role="alert" className="basis-full text-xs text-[hsl(var(--destructive))]">{error}</p>}
  </div>;
}

function ReportCardsView({ schoolId }: { schoolId: number }) {
  const { activeSession, activeTerm, sessions, terms, classes, isLoading } = useAcademicContext(schoolId);
  const [classId, setClassId] = useState<number | ''>('');
  
  const query = useListAcademicReportCards(
    { schoolId }, 
    { query: { enabled: !!schoolId, queryKey: getListAcademicReportCardsQueryKey({ schoolId }) } }
  );
  const studentsQuery = useListStudents({ schoolId, classId: classId || undefined }, { query: { enabled: !!(schoolId && classId), queryKey: ['students', schoolId, classId] } });

  const qc = useQueryClient();
  const createCard = useCreateAcademicReportCard();
  const publishCard = usePublishAcademicReportCard();

  if (isLoading) return <SkeletonPage />;

  const cards = query.data ?? [];
  const students = studentsQuery.data ?? [];

  const handleGenerate = (studentId: number) => {
    createCard.mutate({ data: { schoolId, studentId, sessionId: activeSession?.id as number, termId: activeTerm?.id as number } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListAcademicReportCardsQueryKey() })
    });
  };

  const handlePublish = (cardId: number) => {
    if (confirm("Publish this report card? It will be visible to parents and students.")) {
      publishCard.mutate({ cardId, data: { schoolId } }, {
        onSuccess: () => qc.invalidateQueries({ queryKey: getListAcademicReportCardsQueryKey() })
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="panel p-5 flex items-center gap-4 bg-[hsl(var(--card))] border border-[hsl(var(--border))]">
        <div className="w-full max-w-sm">
          <Field label="Select Class">
            <select value={classId} onChange={e => setClassId(e.target.value ? Number(e.target.value) : '')} className="w-full">
              <option value="">Choose a class...</option>
              {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {classId ? (
        <div className="panel overflow-hidden">
          <div className="bg-[hsl(var(--muted)/.3)] p-5 border-b border-[hsl(var(--border))]">
             <h3 className="font-bold">Report Cards</h3>
             <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">For {classes.find((c: any) => c.id === classId)?.name}</p>
          </div>
          {query.isLoading || studentsQuery.isLoading ? (
             <div className="p-8 text-center text-[hsl(var(--muted-foreground))]">Loading...</div>
          ) : students.length > 0 ? (
             <div className="divide-y divide-[hsl(var(--border)/.6)]">
               {students.map((student: any) => {
                 const card = cards.find((c: any) => c.studentId === student.id && c.sessionId === activeSession?.id && c.termId === activeTerm?.id && c.classId === classId);
                 return (
                    <div key={student.id} className="p-5 hover:bg-[hsl(var(--muted)/.2)]">
                      <div className="flex items-center gap-4">
                        <div className="min-w-[200px] flex-1">
                          <div className="font-bold text-sm">{student.firstName} {student.lastName}</div>
                          <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{student.admissionNo}</div>
                        </div>
                        {card ? (
                          <>
                            <div className="flex-1 text-xs space-y-1">
                              <div>{card.lines.length} published assessment {card.lines.length === 1 ? 'score' : 'scores'} recorded</div>
                              <div className="font-bold text-[hsl(var(--primary))]">{card.resultState.replaceAll('_', ' ')}</div>
                            </div>
                            <div className="w-32"><StatusPill value={card.status} /></div>
                            <div className="w-32 flex justify-end">
                              {card.status !== 'PUBLISHED' && (
                                <Button variant="outline" className="h-8 text-xs py-0" onClick={() => handlePublish(card.id)} disabled={publishCard.isPending}>Publish</Button>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="flex-1 flex justify-end">
                            <Button variant="outline" className="h-8 text-xs py-0" onClick={() => handleGenerate(student.id)} disabled={createCard.isPending}>Generate Card</Button>
                          </div>
                        )}
                      </div>
                      {card && (
                        <details className="mt-3 text-sm">
                          <summary className="cursor-pointer font-semibold text-[hsl(var(--primary))]">View report card</summary>
                          <div className="mt-3 space-y-3 rounded-lg border border-[hsl(var(--border))] p-4">
                            <p className="text-xs text-[hsl(var(--muted-foreground))]">
                              {card.className} {card.section} · {sessions.find((s: any) => s.id === card.sessionId)?.name ?? `Session #${card.sessionId}`}, {terms.find((t: any) => t.id === card.termId)?.name ?? `Term #${card.termId}`} · {card.status}
                            </p>
                            {card.lines.length ? card.lines.map((line: any) => (
                              <div key={line.id} className="flex flex-wrap justify-between gap-2 border-t border-[hsl(var(--border))] pt-2">
                                <span><strong>{line.subjectName}</strong> · {line.assessmentName}</span>
                                <span className="font-semibold">{line.score}/{line.maxScore} · {line.grade}</span>
                              </div>
                            )) : <p>No graded results were included at publication.</p>}
                            {card.teacherRemark && <p>Teacher: {card.teacherRemark}</p>}
                            {card.schoolRemark && <p>School: {card.schoolRemark}</p>}
                          </div>
                          {card.status === 'PUBLISHED' && <ReportCardPrintDocument schoolId={schoolId} card={card} student={student} />}
                        </details>
                      )}
                   </div>
                 );
               })}
             </div>
          ) : (
            <EmptyState icon={BarChart3} title="No students found" description="There are no students in this class." />
          )}
        </div>
      ) : (
         <EmptyState icon={Search} title="Select a class" description="Choose a class to manage report cards." />
      )}
    </div>
  );
}

function ReportCardPrintDocument({ schoolId, card, student }: { schoolId: number; card: any; student: any }) {
  const branding = useSchoolDocumentBranding(schoolId);
  const school = branding.data;
  return <div className="mt-3">
    <SchoolDocumentPrintButton
      label="Print published report card"
      testId={`button-print-report-card-${card.id}`}
      disabled={!school || branding.isLoading || branding.isError}
      unavailableMessage={branding.isError ? 'School branding could not be loaded. Retry before printing this report card.' : 'Loading the selected school identity.'}
    >
      <article className="school-document-page">
        <SchoolDocumentHeader branding={school ?? {}} />
        <h2 className="school-document-title">Academic report card</h2>
        <dl className="school-document-grid">
          <div className="school-document-field"><dt>Student</dt><dd>{student.firstName} {student.lastName}</dd></div>
          <div className="school-document-field"><dt>Admission number</dt><dd>{student.admissionNo}</dd></div>
          <div className="school-document-field"><dt>Class</dt><dd>{card.className}{card.section ? ` · ${card.section}` : ''}</dd></div>
          <div className="school-document-field"><dt>Academic session</dt><dd>{card.sessionName ?? `Session #${card.sessionId}`}</dd></div>
          <div className="school-document-field"><dt>Academic term</dt><dd>{card.termName ?? `Term #${card.termId}`}</dd></div>
          <div className="school-document-field"><dt>Publication status</dt><dd>{card.status}{card.publishedAt ? ` · ${new Date(card.publishedAt).toLocaleDateString('en-NG')}` : ''}</dd></div>
          <div className="school-document-field"><dt>Result completeness</dt><dd>{String(card.resultState).replaceAll('_', ' ')}</dd></div>
        </dl>
        <h3 className="school-document-title">Published assessment results</h3>
        {card.lines.length ? <table className="school-document-table">
          <thead><tr><th>Subject</th><th>Assessment</th><th>Score</th><th>Grade</th><th>Grade points</th><th>Remark</th></tr></thead>
          <tbody>{card.lines.map((line: any) => <tr key={line.id}>
            <td>{line.subjectName}</td>
            <td>{line.assessmentName}</td>
            <td>{line.score}/{line.maxScore}</td>
            <td>{line.grade ?? ''}</td>
            <td>{line.gradePoint ?? ''}</td>
            <td>{line.remark ?? ''}</td>
          </tr>)}</tbody>
        </table> : <p>No graded results were included at publication.</p>}
        {card.teacherRemark && <p className="mt-4"><strong>Teacher remark:</strong> {card.teacherRemark}</p>}
        {card.schoolRemark && <p className="mt-2"><strong>School remark:</strong> {card.schoolRemark}</p>}
      </article>
    </SchoolDocumentPrintButton>
  </div>;
}

function GradingRulesView({ schoolId }: { schoolId: number }) {
  const query = useListAcademicGradingRules({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListAcademicGradingRulesQueryKey({ schoolId }) } });
  const [modal, setModal] = useState<any>(null);
  const qc = useQueryClient();

  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const rules = query.data ?? [];

  // Sort rules descending by minScore
  const sortedRules = [...rules].sort((a, b) => b.minScore - a.minScore);

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-[hsl(var(--border))] px-6 py-5 flex items-center justify-between bg-[hsl(var(--muted)/.3)]">
        <div>
          <h3 className="display-font text-lg font-bold">Grading Rules</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Configure grading scales</p>
        </div>
        <Button onClick={() => setModal({ create: true })}><Plus size={16} />New Rule</Button>
      </div>
      
      {sortedRules.length > 0 ? (
        <div className="divide-y divide-[hsl(var(--border)/.6)]">
          {sortedRules.map((item: any) => (
            <div key={item.id} className="flex items-center justify-between p-5 hover:bg-[hsl(var(--muted)/.2)]">
              <div>
                <div className="font-bold text-lg text-[hsl(var(--primary))]">{item.grade}</div>
                <div className="text-sm font-medium mt-1">{item.minScore} — {item.maxScore} marks</div>
                {item.remark && <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1 italic">"{item.remark}"</div>}
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => setModal(item)} className="p-2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"><Pencil size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={BarChart3} title="No grading rules" description="Set up grading boundaries (e.g. A = 70-100)." />
      )}

      {modal && (
        <Modal title={modal.create ? "Create Grading Rule" : "Edit Grading Rule"} onClose={() => setModal(null)}>
          <GradingRuleForm 
            schoolId={schoolId} 
            initial={modal.create ? null : modal}
            onDone={() => { setModal(null); qc.invalidateQueries({ queryKey: getListAcademicGradingRulesQueryKey() }); }}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function GradingRuleForm({ schoolId, initial, onDone, onCancel }: any) {
  const create = useCreateAcademicGradingRule();
  const update = useUpdateAcademicGradingRule();
  const [form, setForm] = useState({
    minScore: initial?.minScore ?? 0,
    maxScore: initial?.maxScore ?? 100,
    grade: initial?.grade || '',
    remark: initial?.remark || '',
    gradePoint: initial?.gradePoint ?? 0
  });

  const save = (e: FormEvent) => {
    e.preventDefault();
    const data = { ...form, minScore: Number(form.minScore), maxScore: Number(form.maxScore), gradePoint: Number(form.gradePoint) };
    if (initial) {
      update.mutate({ ruleId: initial.id, params: { schoolId }, data }, { onSuccess: onDone });
    } else {
      create.mutate({ params: { schoolId }, data }, { onSuccess: onDone });
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Min Score">
          <input type="number" required min={0} max={100} value={form.minScore} onChange={e => setForm({...form, minScore: Number(e.target.value)})} className="w-full" />
        </Field>
        <Field label="Max Score">
          <input type="number" required min={0} max={100} value={form.maxScore} onChange={e => setForm({...form, maxScore: Number(e.target.value)})} className="w-full" />
        </Field>
      </div>
      <Field label="Grade Label">
        <input required value={form.grade} onChange={e => setForm({...form, grade: e.target.value})} placeholder="e.g. A, B, Excellent" className="w-full uppercase" />
      </Field>
      <Field label="Grade Point">
        <input type="number" required min={0} step="0.1" value={form.gradePoint} onChange={e => setForm({...form, gradePoint: Number(e.target.value)})} className="w-full" />
      </Field>
      <Field label="Remark">
        <input required value={form.remark} onChange={e => setForm({...form, remark: e.target.value})} placeholder="e.g. Outstanding Performance" className="w-full" />
      </Field>
      <div className="flex justify-end gap-3 pt-4 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving...' : 'Save'}</Button>
      </div>
    </form>
  );
}
