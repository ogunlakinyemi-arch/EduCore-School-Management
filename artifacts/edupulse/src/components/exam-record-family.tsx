import { SchoolDocumentHeader, SchoolDocumentPrintButton, useSchoolDocumentBranding } from '@/components/school-document';
import { EmptyState, ErrorState, SkeletonPage } from '@/components/shared';
import { useListMyAcademicReportCards } from '@workspace/api-client-react';
import { BarChart3 } from 'lucide-react';

/* Published-only consolidated report cards. Never shows questions or unpublished data. */
export function PublishedReports({ cards, schoolId }: { cards: any[]; schoolId: number }) {
  const published = cards.filter(c => c.status === 'PUBLISHED');
  if (!published.length) return <div className="panel"><EmptyState icon={BarChart3} title="This result has not been published yet." description="Your school will publish the report card here when it is ready." /></div>;
  return <div className="grid gap-5" data-testid="list-published-reports">{published.map(c => <Card key={c.id} card={c} schoolId={schoolId} />)}</div>;
}

function subjectsOf(card: any): any[] { return card.consolidatedSubjects?.length ? card.consolidatedSubjects : []; }

function Card({ card, schoolId }: { card: any; schoolId: number }) {
  const branding = useSchoolDocumentBranding(schoolId);
  const subs = subjectsOf(card);
  const body = <>
    {subs.length ? <table className="school-document-table"><thead><tr><th>Subject</th><th>Components</th><th>Total</th><th>Grade</th></tr></thead><tbody>{subs.map((s: any, i: number) => <tr key={s.subjectId ?? i}><td>{s.subjectName}</td><td>{(s.components ?? []).map((c:any)=>`${c.name}: ${c.score}/${c.maxScore}`).join(' · ')}</td><td>{s.score}{s.maxScore ? `/${s.maxScore}` : ''}</td><td>{s.grade ?? ''}</td></tr>)}</tbody></table>
      : card.lines?.length ? <table className="school-document-table"><thead><tr><th>Subject</th><th>Assessment</th><th>Score</th><th>Grade</th></tr></thead><tbody>{card.lines.map((l: any) => <tr key={l.id}><td>{l.subjectName}</td><td>{l.assessmentName}</td><td>{l.score}/{l.maxScore}</td><td>{l.grade ?? ''}</td></tr>)}</tbody></table> : <p>No graded results were included at publication.</p>}
    {(card.total != null || card.average != null) && <p><strong>Total:</strong> {card.total ?? '-'} {'  '}<strong>Average:</strong> {card.average != null ? `${card.average}%` : '-'}</p>}
    {card.attendance && <p><strong>Recorded attendance:</strong> {card.attendance.present} present, {card.attendance.late} late, {card.attendance.absent} absent ({card.attendance.total} recorded days).</p>}
    {card.teacherRemark && <p><strong>Teacher:</strong> {card.teacherRemark}</p>}
    {card.schoolRemark && <p><strong>School:</strong> {card.schoolRemark}</p>}
  </>;
  return <article className="panel p-6" data-testid={`report-card-${card.id}`}>
    <div className="eyebrow">{card.sessionName ?? `Session #${card.sessionId}`} - {card.termName ?? `Term #${card.termId}`}</div>
    <h3 className="display-font mt-1 text-xl font-bold">{card.className}{card.section ? ` / ${card.section}` : ''}</h3>
    {card.studentName && <p className="mt-2 text-sm">{card.studentName}{card.admissionNo ? ` — ${card.admissionNo}` : ''}</p>}
    <div className="mt-4 space-y-2 text-sm">
      {(subs.length ? subs : card.lines ?? []).map((s: any, i: number) => <div key={s.id ?? s.subjectId ?? i} className="flex justify-between gap-3 rounded-lg border border-[hsl(var(--border))] p-3"><span><strong>{s.subjectName}</strong>{s.assessmentName ? ` - ${s.assessmentName}` : ''}{s.components?.length ? <span className="mt-1 block text-xs text-[hsl(var(--muted-foreground))]">{s.components.map((c:any)=>`${c.name}: ${c.score}/${c.maxScore}`).join(' · ')}</span> : null}</span><span className="font-bold">{s.score}{s.maxScore ? `/${s.maxScore}` : ''}{s.grade ? ` - ${s.grade}` : ''}</span></div>)}
    </div>
    {(card.total != null || card.average != null) && <div className="mt-4 flex gap-6 text-sm"><div><div className="eyebrow">Total</div><div className="display-font text-2xl font-bold">{card.total ?? '-'}</div></div><div><div className="eyebrow">Average</div><div className="display-font text-2xl font-bold">{card.average != null ? `${card.average}%` : '-'}</div></div></div>}
    {card.attendance && <p className="mt-4 text-sm"><strong>Recorded attendance:</strong> {card.attendance.present} present, {card.attendance.late} late, {card.attendance.absent} absent ({card.attendance.total} recorded days).</p>}
    {(card.teacherRemark || card.schoolRemark) && <div className="mt-4 rounded-xl border border-[hsl(var(--border))] p-3 text-sm italic">{card.teacherRemark && <p>Teacher: {card.teacherRemark}</p>}{card.schoolRemark && <p>School: {card.schoolRemark}</p>}</div>}
    <div className="mt-4"><SchoolDocumentPrintButton label="Print report card" testId={`button-print-exam-record-${card.id}`} disabled={!branding.data || branding.isError} unavailableMessage="School branding is not available yet.">
      <article className="school-document-page"><SchoolDocumentHeader branding={branding.data ?? {}} /><h2 className="school-document-title">Academic report card</h2>
        <dl className="school-document-grid">{card.studentName && <div className="school-document-field"><dt>Student</dt><dd>{card.studentName}{card.admissionNo ? ` — ${card.admissionNo}` : ''}</dd></div>}<div className="school-document-field"><dt>Class</dt><dd>{card.className}{card.section ? ` / ${card.section}` : ''}</dd></div><div className="school-document-field"><dt>Session</dt><dd>{card.sessionName ?? card.sessionId}</dd></div><div className="school-document-field"><dt>Term</dt><dd>{card.termName ?? card.termId}</dd></div></dl>
        {body}</article></SchoolDocumentPrintButton></div>
  </article>;
}

export function StudentExamRecord({ schoolId }: { schoolId: number }) {
  const q = useListMyAcademicReportCards({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['my-cards', schoolId] } });
  if (q.isLoading) return <SkeletonPage />;
  if (q.isError) return <ErrorState retry={() => q.refetch()} message="Your results could not be loaded." />;
  return <PublishedReports cards={(q.data ?? []) as any[]} schoolId={schoolId} />;
}
