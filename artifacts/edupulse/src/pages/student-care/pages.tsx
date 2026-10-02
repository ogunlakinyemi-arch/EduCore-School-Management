import { useMemo, useState } from 'react';
import { HeartPulse, ShieldCheck, ClipboardList, KeyRound, Users, Gavel } from 'lucide-react';
import { useGetParentChildren, useGetParentStudentCareSummary, useGetStudentCareSummary, useGetAuthorizedContext } from '@workspace/api-client-react';
import { PageHeading, EmptyState, StatusPill, cx, date, useTenant } from '@/components/shared';
import { sanitizeParentSummary, label, errorInfo } from './care-contract';
import { Banner, SkeletonRows, StudentPicker, useCareRoles, Chip } from './care-ui';
import { MedicalPanel } from './medical-panel';
import { WelfarePanel } from './welfare-panel';
import { BehaviourPanel, BehaviourConfigPanel } from './behaviour-panel';
import { AccessPanel } from './access-panel';

type Tab = 'medical' | 'welfare' | 'access';

function NoSchool() {
  return <EmptyState icon={Users} title="Choose a school first" description="Student care is scoped to a single school. Select a school to continue." />;
}

export function StudentCarePage() {
  const { schoolId } = useTenant();
  const { isAdmin, isOwner, loading } = useCareRoles(schoolId);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('medical');
  const tabs = useMemo(() => [
    { id: 'medical' as Tab, label: 'Medical', icon: HeartPulse },
    { id: 'welfare' as Tab, label: 'Welfare and safeguarding', icon: ShieldCheck },
    ...(isAdmin ? [{ id: 'access' as Tab, label: 'Access', icon: KeyRound }] : []),
  ], [isAdmin]);

  if (!schoolId) return <NoSchool />;
  if (isOwner) return <EmptyState icon={ShieldCheck} title="Not available to Platform Owner accounts" description="Student medical and welfare records are only accessible to authorised school staff." />;
  return (
    <div>
      <PageHeading eyebrow="Student care" title="Student care" description="Medical profiles, sickbay visits and welfare records. Access is granted per person and every change is versioned." />
      <div className="space-y-5">
        <StudentPicker schoolId={schoolId} value={studentId} onChange={id => { setStudentId(id); }} />
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-[hsl(var(--muted))] p-1" role="tablist">
          {tabs.map(t => { const I = t.icon; return (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cx('inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-bold', tab === t.id ? 'bg-[hsl(var(--background))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]')} data-testid={`tab-care-${t.id}`}><I size={14} />{t.label}</button>
          ); })}
        </div>
        {tab === 'access' && isAdmin ? <AccessPanel schoolId={schoolId} /> : !studentId ? (
          <EmptyState icon={ClipboardList} title="Select a student" description="Pick a student above to open their care records." />
        ) : loading ? <SkeletonRows /> : tab === 'medical' ? (
          <MedicalPanel key={`m-${schoolId}-${studentId}`} schoolId={schoolId} studentId={studentId} />
        ) : (
          <WelfarePanel key={`w-${schoolId}-${studentId}`} schoolId={schoolId} studentId={studentId} />
        )}
      </div>
    </div>
  );
}

export function BehaviourPage() {
  const { schoolId } = useTenant();
  const { isAdmin, isOwner } = useCareRoles(schoolId);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [tab, setTab] = useState<'log' | 'options'>('log');
  if (!schoolId) return <NoSchool />;
  if (isOwner) return <EmptyState icon={Gavel} title="Not available to Platform Owner accounts" description="Behaviour records are only accessible to authorised school staff." />;
  return (
    <div>
      <PageHeading eyebrow="Student care" title="Behaviour" description="Log recognition, concerns and incidents, then move each through review, action, family notification and resolution." />
      <div className="space-y-5">
        {isAdmin && (
          <div className="flex gap-1 rounded-xl bg-[hsl(var(--muted))] p-1 sm:w-fit">
            {(['log', 'options'] as const).map(t => <button key={t} onClick={() => setTab(t)} className={cx('rounded-lg px-4 py-2 text-xs font-bold', tab === t ? 'bg-[hsl(var(--background))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]')}>{t === 'log' ? 'Behaviour log' : 'School options'}</button>)}
          </div>
        )}
        {tab === 'options' && isAdmin ? <BehaviourConfigPanel schoolId={schoolId} /> : (
          <>
            <StudentPicker schoolId={schoolId} value={studentId} onChange={setStudentId} />
            {studentId ? <BehaviourPanel key={`b-${schoolId}-${studentId}`} schoolId={schoolId} studentId={studentId} /> : <EmptyState icon={Gavel} title="Select a student" description="Pick a student above to see and log behaviour." />}
          </>
        )}
      </div>
    </div>
  );
}

function ParentSummary({ studentId }: { studentId: number }) {
  const q = useGetParentStudentCareSummary(studentId, { query: { retry: false, queryKey: [`/api/parent/children/${studentId}/care-summary`] } });
  return <FamilySummary q={q} />;
}

function StudentSummary() {
  const q = useGetStudentCareSummary();
  return <FamilySummary q={q} />;
}

function FamilySummary({ q }: { q: { isLoading: boolean; isError: boolean; error: unknown; data?: unknown; refetch: () => unknown } }) {
  if (q.isLoading) return <SkeletonRows />;
  if (q.isError) return <Banner tone="error">{errorInfo(q.error).message} <button className="ml-2 underline" onClick={() => q.refetch()}>Retry</button></Banner>;
  const s = sanitizeParentSummary(q.data);
  // Only approved summary fields survive sanitizing; internal notes are never rendered.
  if (!s.welfare.length && !s.behaviour.length) return <EmptyState icon={ShieldCheck} title="Nothing shared yet" description="When the school shares an approved summary about your child, it will appear here." />;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="panel p-5">
        <h3 className="display-font mb-3 text-lg font-bold">Support and welfare</h3>
        {s.welfare.length ? <ul className="space-y-3">{s.welfare.map((w: any) => <li key={w.id} className="rounded-xl border border-[hsl(var(--border))] p-3"><div className="flex flex-wrap items-center gap-2"><Chip>{label(w.category)}</Chip><StatusPill value={label(w.status)} /></div><p className="mt-2 text-sm">{w.concern}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Updated {date(w.updatedAt)}</p></li>)}</ul> : <p className="text-sm text-[hsl(var(--muted-foreground))]">No shared summaries.</p>}
      </section>
      <section className="panel p-5">
        <h3 className="display-font mb-3 text-lg font-bold">Behaviour</h3>
        {s.behaviour.length ? <ul className="space-y-3">{s.behaviour.map((b: any) => <li key={b.id} className="rounded-xl border border-[hsl(var(--border))] p-3"><div className="flex flex-wrap items-center gap-2"><Chip>{label(b.category)}</Chip><StatusPill value={label(b.status)} /></div><p className="mt-2 text-sm">{b.description}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{date(b.occurredAt)}</p></li>)}</ul> : <p className="text-sm text-[hsl(var(--muted-foreground))]">No shared summaries.</p>}
      </section>
    </div>
  );
}

function ParentCareBranch() {
  const children = useGetParentChildren();
  const [studentId, setStudentId] = useState<number | null>(null);
  const list = children.data ?? [];
  const active = studentId ?? list[0]?.id ?? null;
  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8">
      <PageHeading eyebrow="Family" title="My care" description="Summaries the school has approved for you. Medical records, internal notes and safeguarding information are never shown here." />
      {children.isLoading ? <SkeletonRows n={2} /> : children.isError ? <Banner tone="error">Could not load your linked children. <button className="ml-2 underline" onClick={() => children.refetch()}>Retry</button></Banner> : !list.length ? (
        <EmptyState icon={Users} title="No linked children" description="Your school administrator can connect your profile to your children." />
      ) : (
        <div className="space-y-5">
          <div className="flex gap-2 overflow-x-auto">
            {list.map(c => <button key={c.id} onClick={() => setStudentId(c.id)} className={cx('whitespace-nowrap rounded-xl border px-4 py-2.5 text-left text-sm', active === c.id ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.06)]' : 'border-[hsl(var(--border))]')} data-testid={`button-care-child-${c.id}`}><strong className="block">{c.firstName} {c.lastName}</strong><span className="text-xs text-[hsl(var(--muted-foreground))]">{c.className} {c.section} · {c.schoolName}</span></button>)}
          </div>
          {active && <ParentSummary key={active} studentId={active} />}
        </div>
      )}
    </div>
  );
}

function StudentCareBranch() {
  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8">
      <PageHeading eyebrow="Student" title="My care" description="Summaries the school has approved for you. Medical records, internal notes and safeguarding information are never shown here." />
      <StudentSummary />
    </div>
  );
}

export function FamilyCarePage() {
  const ctx = useGetAuthorizedContext();
  if (ctx.isLoading) return <div className="mx-auto max-w-6xl p-5 md:p-8"><SkeletonRows n={2} /></div>;
  const roles = (ctx.data?.roles ?? []).filter(r => r.status === 'ACTIVE').map(r => r.role as string);
  if (roles.includes('STUDENT') && !roles.includes('PARENT')) return <StudentCareBranch />;
  return <ParentCareBranch />;
}
