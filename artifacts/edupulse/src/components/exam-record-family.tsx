import { AcademicReportPrint } from '@/components/academic-report-document';
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
  const subs = subjectsOf(card);
  return <article className="panel p-6" data-testid={`report-card-${card.id}`}>
    <div className="eyebrow">{card.sessionName ?? `Session #${card.sessionId}`} - {card.termName ?? `Term #${card.termId}`}</div>
    <h3 className="display-font mt-1 text-xl font-bold">{card.className}{card.section ? ` / ${card.section}` : ''}</h3>
    {card.studentName && <p className="mt-2 text-sm">{card.studentName}{card.admissionNo ? ` — ${card.admissionNo}` : ''}</p>}
    <div className="mt-4 space-y-2 text-sm">
      {(subs.length ? subs : card.lines ?? []).map((s: any, i: number) => <div key={s.id ?? s.subjectId ?? i} className="flex justify-between gap-3 rounded-lg border border-[hsl(var(--border))] p-3"><span><strong>{s.subjectName}</strong>{s.assessmentName ? ` - ${s.assessmentName}` : ''}{s.components?.length ? <span className="mt-1 block text-xs text-[hsl(var(--muted-foreground))]">{s.components.map((c:any)=>`${c.label ?? c.name}: ${c.score}/${c.maxScore}`).join(' · ')}</span> : null}</span><span className="font-bold">{s.score}{s.maxScore ? `/${s.maxScore}` : ''}{s.grade ? ` - ${s.grade}` : ''}</span></div>)}
    </div>
    {(card.total != null || card.average != null) && <div className="mt-4 flex gap-6 text-sm"><div><div className="eyebrow">Total</div><div className="display-font text-2xl font-bold">{card.total ?? '-'}</div></div><div><div className="eyebrow">Average</div><div className="display-font text-2xl font-bold">{card.average != null ? `${card.average}%` : '-'}</div></div></div>}
    {card.attendance && <p className="mt-4 text-sm"><strong>Recorded attendance:</strong> {card.attendance.present} present, {card.attendance.late} late, {card.attendance.absent} absent ({card.attendance.total} recorded days).</p>}
    {(card.teacherRemark || card.schoolRemark) && <div className="mt-4 rounded-xl border border-[hsl(var(--border))] p-3 text-sm italic">{card.teacherRemark && <p>Teacher: {card.teacherRemark}</p>}{card.schoolRemark && <p>School: {card.schoolRemark}</p>}</div>}
    <div className="mt-4"><AcademicReportPrint schoolId={schoolId} card={card} label="Print report card" testId={`button-print-exam-record-${card.id}`} /></div>
  </article>;
}

export function StudentExamRecord({ schoolId }: { schoolId: number }) {
  const q = useListMyAcademicReportCards({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['my-cards', schoolId] } });
  if (q.isLoading) return <SkeletonPage />;
  if (q.isError) return <ErrorState retry={() => q.refetch()} message="Your results could not be loaded." />;
  return <PublishedReports cards={(q.data ?? []) as any[]} schoolId={schoolId} />;
}
