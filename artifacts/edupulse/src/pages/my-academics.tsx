import { useState } from 'react';
import { PageHeading, StatusPill, SkeletonPage, ErrorState, EmptyState, TenantPicker, useTenant, cx, date } from '@/components/shared';
import { 
  useListMyAcademicAssignments, useListMyAcademicResults, useListMyAcademicReportCards, useGetMyAcademicTimetable
} from '@workspace/api-client-react';
import { BookOpen, GraduationCap, Calendar, BarChart3, Clock, CheckCircle2 } from 'lucide-react';
import { SchoolDocumentHeader, SchoolDocumentPrintButton, useSchoolDocumentBranding } from '@/components/school-document';

export function MyAcademicsPage() {
  const { schoolId } = useTenant();
  const [tab, setTab] = useState<'assignments' | 'results' | 'cards' | 'timetable'>('assignments');
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Student Portal" 
        title="My Academics." 
        description="View your assignments, results, and class schedule." 
        action={<TenantPicker />} 
      />
      {!schoolId ? (
        <EmptyState icon={GraduationCap} title="Select a school context" description="You must select a school to view your academics." />
      ) : (
        <>
          <div className="mb-6 flex gap-2 border-b border-[hsl(var(--border))] overflow-x-auto">
            {[{id: 'assignments', label: 'Assignments'}, {id: 'results', label: 'Results'}, {id: 'cards', label: 'Report Cards'}, {id: 'timetable', label: 'Timetable'}].map(t => (
              <button 
                key={t.id} 
                onClick={() => setTab(t.id as any)} 
                className={cx("px-4 py-2.5 text-sm font-bold border-b-2 transition-colors whitespace-nowrap", tab === t.id ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'assignments' && <MyAssignmentsView schoolId={schoolId} />}
          {tab === 'results' && <MyResultsView schoolId={schoolId} />}
          {tab === 'cards' && <MyReportCardsView schoolId={schoolId} />}
          {tab === 'timetable' && <MyTimetableView schoolId={schoolId} />}
        </>
      )}
    </div>
  );
}

function MyAssignmentsView({ schoolId }: { schoolId: number }) {
  const query = useListMyAcademicAssignments(
    { schoolId },
    { query: { enabled: !!schoolId, queryKey: ['my-assignments', schoolId] } }
  );

  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const assignments = query.data ?? [];

  return (
    <div className="panel overflow-hidden">
      <div className="bg-[hsl(var(--muted)/.3)] px-6 py-5 border-b border-[hsl(var(--border))]">
        <h3 className="font-bold text-lg">My Assignments</h3>
      </div>
      {assignments.length > 0 ? (
        <div className="divide-y divide-[hsl(var(--border)/.6)]">
          {assignments.map((item: any) => (
            <div key={item.id} className="p-5 hover:bg-[hsl(var(--muted)/.15)] flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="font-bold text-base">{item.title}</div>
                <div className="text-sm font-medium text-[hsl(var(--primary))] mt-1">
                  {item.subjectName || `Subject #${item.subjectId}`}
                </div>
                {item.description && <p className="text-sm text-[hsl(var(--muted-foreground))] mt-2 max-w-2xl">{item.description}</p>}
                <div className="text-xs font-medium text-[hsl(var(--muted-foreground))] mt-3 flex items-center gap-4">
                  <span className="flex items-center gap-1.5"><Calendar size={13} /> Issued: {date(item.issueDate)}</span>
                  <span className="flex items-center gap-1.5"><Clock size={13} /> Due: {date(item.dueDate)}</span>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-4 md:flex-col md:items-end">
                <StatusPill value={item.status} />
                <div className="text-sm font-bold bg-[hsl(var(--muted))] px-3 py-1 rounded-lg">Max Score: {item.maxScore}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={BookOpen} title="No assignments" description="You have no active assignments right now." />
      )}
    </div>
  );
}

function MyResultsView({ schoolId }: { schoolId: number }) {
  const query = useListMyAcademicResults(
    { schoolId },
    { query: { enabled: !!schoolId, queryKey: ['my-results', schoolId] } }
  );

  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const results = (query.data ?? []).filter((r: any) => r.status === 'PUBLISHED');

  return (
    <div className="panel overflow-hidden">
      <div className="bg-[hsl(var(--muted)/.3)] px-6 py-5 border-b border-[hsl(var(--border))]">
        <h3 className="font-bold text-lg">My Assessment Results</h3>
      </div>
      {results.length > 0 ? (
        <div className="divide-y divide-[hsl(var(--border)/.6)]">
          {results.map((item: any) => (
            <div key={item.id} className="p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="font-bold text-base flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-[hsl(157_37%_43%)]" />
                  Assessment #{item.assessmentId}
                </div>
                <div className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
                   Subject: {item.subjectName || `#${item.subjectId}`}
                </div>
                {item.remark && <div className="text-sm mt-2 italic text-[hsl(var(--muted-foreground))]">"{item.remark}"</div>}
              </div>
              <div className="text-right">
                 <div className="text-3xl font-bold display-font tracking-tight text-[hsl(var(--primary))]">{item.score}</div>
                 <div className="text-xs uppercase tracking-widest font-bold text-[hsl(var(--muted-foreground))] mt-1">Score</div>
              </div>
              <PublishedResultPrintDocument schoolId={schoolId} result={item} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={BarChart3} title="No results published" description="Your assessment results will appear here once published by teachers." />
      )}
    </div>
  );
}

function MyReportCardsView({ schoolId }: { schoolId: number }) {
  const query = useListMyAcademicReportCards(
    { schoolId },
    { query: { enabled: !!schoolId, queryKey: ['my-cards', schoolId] } }
  );

  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const cards = (query.data ?? []).filter((r: any) => r.status === 'PUBLISHED');

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {cards.length > 0 ? cards.map((card: any) => (
        <div key={card.id} className="panel p-6 bg-gradient-to-br from-[hsl(var(--card))] to-[hsl(var(--muted)/.2)]">
          <div className="flex justify-between items-start mb-6 border-b border-[hsl(var(--border))] pb-4">
             <div>
                <div className="eyebrow">Report Card</div>
                 <h4 className="font-bold text-lg mt-1">{card.className} {card.section} · {card.sessionName ?? `Session #${card.sessionId}`}, {card.termName ?? `Term #${card.termId}`}</h4>
             </div>
             <div className="w-12 h-12 rounded-2xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))] grid place-items-center"><GraduationCap size={24}/></div>
          </div>
          <div className="text-xs font-semibold text-[hsl(var(--muted-foreground))] mb-3">
            Published {card.publishedAt ? new Date(card.publishedAt).toLocaleDateString() : '—'} · {card.resultState.replaceAll('_', ' ')}
          </div>
          <div className="space-y-2">
            {card.lines.length ? card.lines.map((line: any) => (
              <div key={line.id} className="flex justify-between gap-4 rounded-lg border border-[hsl(var(--border))] p-3 text-sm">
                <span><strong>{line.subjectName}</strong> · {line.assessmentName}</span>
                <span className="font-semibold">{line.score}/{line.maxScore} · {line.grade}</span>
              </div>
            )) : <p className="text-sm text-[hsl(var(--muted-foreground))]">No graded results were included at publication.</p>}
          </div>
          {(card.teacherRemark || card.schoolRemark) && (
            <div className="mt-6 p-4 rounded-xl bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-sm italic text-[hsl(var(--muted-foreground))]">
              {card.teacherRemark && <p>Teacher: {card.teacherRemark}</p>}
              {card.schoolRemark && <p>School: {card.schoolRemark}</p>}
            </div>
          )}
          <MyReportCardPrintDocument schoolId={schoolId} card={card} />
        </div>
      )) : (
        <div className="col-span-full">
          <EmptyState icon={BarChart3} title="No report cards" description="Report cards are not available yet for this term." />
        </div>
      )}
    </div>
  );
}

function PublishedResultPrintDocument({ schoolId, result }: { schoolId: number; result: any }) {
  const branding = useSchoolDocumentBranding(schoolId);
  const school = branding.data;
  return <SchoolDocumentPrintButton
    label="Print published result"
    testId={`button-print-published-result-${result.id}`}
    disabled={!school || branding.isLoading || branding.isError}
    unavailableMessage={branding.isError ? 'School branding could not be loaded. Retry before printing this result.' : 'Loading the selected school identity.'}
  >
    <article className="school-document-page">
      <SchoolDocumentHeader branding={school ?? {}} />
      <h2 className="school-document-title">Published student result</h2>
      <dl className="school-document-grid">
        <div className="school-document-field"><dt>Assessment</dt><dd>#{result.assessmentId}</dd></div>
        <div className="school-document-field"><dt>Student record</dt><dd>#{result.studentId}</dd></div>
        <div className="school-document-field"><dt>Subject</dt><dd>{result.subjectName ?? `Subject #${result.subjectId}`}</dd></div>
        <div className="school-document-field"><dt>Class / section</dt><dd>{result.classId}{result.section ? ` · ${result.section}` : ''}</dd></div>
        <div className="school-document-field"><dt>Academic session</dt><dd>#{result.sessionId}</dd></div>
        <div className="school-document-field"><dt>Academic term</dt><dd>#{result.termId}</dd></div>
        <div className="school-document-field"><dt>Published</dt><dd>{result.publishedAt ? new Date(result.publishedAt).toLocaleDateString('en-NG') : 'Published'}</dd></div>
        <div className="school-document-field"><dt>Score</dt><dd>{result.score}/{result.maxScore}</dd></div>
        {result.grade !== null && result.grade !== undefined && <div className="school-document-field"><dt>Grade</dt><dd>{result.grade}</dd></div>}
        {result.gradePoint !== null && result.gradePoint !== undefined && <div className="school-document-field"><dt>Grade points</dt><dd>{result.gradePoint}</dd></div>}
      </dl>
      {result.remark && <p><strong>Remark:</strong> {result.remark}</p>}
    </article>
  </SchoolDocumentPrintButton>;
}

function MyReportCardPrintDocument({ schoolId, card }: { schoolId: number; card: any }) {
  const branding = useSchoolDocumentBranding(schoolId);
  const school = branding.data;
  return <SchoolDocumentPrintButton
    label="Print published report card"
    testId={`button-print-my-report-card-${card.id}`}
    disabled={!school || branding.isLoading || branding.isError}
    unavailableMessage={branding.isError ? 'School branding could not be loaded. Retry before printing this report card.' : 'Loading the selected school identity.'}
  >
    <article className="school-document-page">
      <SchoolDocumentHeader branding={school ?? {}} />
      <h2 className="school-document-title">Academic report card</h2>
      <dl className="school-document-grid">
        <div className="school-document-field"><dt>Student record</dt><dd>#{card.studentId}</dd></div>
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
  </SchoolDocumentPrintButton>;
}

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

function MyTimetableView({ schoolId }: { schoolId: number }) {
  const query = useGetMyAcademicTimetable(
    { schoolId },
    { query: { enabled: !!schoolId, queryKey: ['my-timetable', schoolId] } }
  );

  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const entries = query.data ?? [];

  if (entries.length === 0) {
    return <EmptyState icon={Calendar} title="No schedule found" description="You have no classes scheduled for the active term." />;
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {DAYS.map(day => {
        const dayEntries = entries.filter((e: any) => e.weekday === day).sort((a: any, b: any) => a.startTime.localeCompare(b.startTime));
        if (dayEntries.length === 0) return null;
        return (
          <div key={day} className="panel overflow-hidden border border-[hsl(var(--primary)/.2)]">
            <div className="bg-[hsl(var(--primary)/.05)] px-4 py-3 border-b border-[hsl(var(--primary)/.1)] font-bold text-sm tracking-wide text-[hsl(var(--primary))]">{day}</div>
            <div className="divide-y divide-[hsl(var(--border)/.5)]">
              {dayEntries.map((item: any) => (
                <div key={item.id} className="p-4 bg-[hsl(var(--card))]">
                  <div className="flex items-center gap-2 text-xs font-bold text-[hsl(var(--foreground))] mb-1.5">
                    <Clock size={12} className="text-[hsl(var(--muted-foreground))]" /> {item.startTime} — {item.endTime}
                  </div>
                   <div className="font-bold text-base">{item.subjectName}</div>
                  {item.room && <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Room {item.room}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
