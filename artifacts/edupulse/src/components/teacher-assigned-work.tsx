import { Link } from 'wouter';
import { BookOpen, Library } from 'lucide-react';
import { useListSchoolTeacherAssignments, getListSchoolTeacherAssignmentsQueryKey } from '@workspace/api-client-react';
import { FRESH, errMsg } from '@/components/school-ops-kit';

const params = { status: 'ACTIVE' as const };

/** Rendered only for an ACTIVE Teacher in the selected school (never Owner / admin / mixed). */
export function TeacherAssignedWork({ schoolId }: { schoolId: number }) {
  const q = useListSchoolTeacherAssignments(schoolId, params, { query: { enabled: schoolId > 0, queryKey: getListSchoolTeacherAssignmentsQueryKey(schoolId, params), ...FRESH } });
  const rows = q.data ?? [];
  const classes = [...new Set(rows.map(r => r.className && `${r.className}${r.section ? ` ${r.section}` : ''}`).filter((x): x is string => !!x))];
  const subjects = [...new Set(rows.map(r => r.subjectName).filter((x): x is string => !!x))];
  return (
    <section className="panel mt-8 p-6 md:p-8" aria-label="My assigned classes and subjects" data-testid="teacher-assigned-work">
      <div className="mb-5 flex items-start justify-between">
        <div><div className="eyebrow">Your teaching</div><h2 className="display-font mt-2 text-2xl font-bold">Assigned classes and subjects</h2></div>
        <Link href="/teacher-assignments" className="text-sm font-bold text-[hsl(var(--primary))] hover:underline" data-testid="link-my-assignments">All assignments</Link>
      </div>
      {q.isLoading ? <div className="h-16 animate-pulse rounded-xl bg-[hsl(var(--muted))]" />
        : q.isError ? <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{errMsg(q.error, 'Your assignments could not be loaded.')} <button className="font-bold underline" onClick={() => q.refetch()}>Retry</button></p>
        : rows.length === 0 ? <p className="text-sm text-[hsl(var(--muted-foreground))]">No active assignments yet. Your School Administrator assigns classes and subjects.</p>
        : (
          <div className="grid gap-6 md:grid-cols-2">
            <div><div className="eyebrow mb-2 flex items-center gap-2"><Library size={13} />Classes</div>
              <div className="flex flex-wrap gap-2">{classes.length ? classes.map(c => <Link key={c} href="/classes" className="rounded-xl bg-[hsl(var(--secondary))] px-3 py-1.5 text-sm font-bold">{c}</Link>) : <span className="text-sm text-[hsl(var(--muted-foreground))]">None</span>}</div></div>
            <div><div className="eyebrow mb-2 flex items-center gap-2"><BookOpen size={13} />Subjects</div>
              <div className="flex flex-wrap gap-2">{subjects.length ? subjects.map(s => <Link key={s} href="/subjects" className="rounded-xl bg-[hsl(var(--secondary))] px-3 py-1.5 text-sm font-bold">{s}</Link>) : <span className="text-sm text-[hsl(var(--muted-foreground))]">None</span>}</div></div>
          </div>
        )}
    </section>
  );
}

type Ctx = { isPlatformOwner?: boolean; roles?: Array<{ role: string; status: string; schoolId?: number | null }> } | null | undefined;
/** Active Teacher in the selected school; never a platform owner or a mixed admin/teacher. */
export function isOwnTeacherView(ctx: Ctx, schoolId: number) {
  if (!ctx || ctx.isPlatformOwner || !schoolId) return false;
  const active = (ctx.roles ?? []).filter(r => r.status === 'ACTIVE' && r.schoolId === schoolId).map(r => r.role);
  return active.includes('TEACHER') && !active.includes('SCHOOL_ADMIN');
}
