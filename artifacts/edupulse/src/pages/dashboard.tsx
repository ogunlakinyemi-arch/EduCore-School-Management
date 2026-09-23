import { useGetPlatformDashboard, useGetSchoolDashboard, useGetAuthorizedContext } from '@workspace/api-client-react';
import { Building2, GraduationCap, CircleDollarSign, Smartphone, ArrowUpRight } from 'lucide-react';
import { PageHeading, Metric, useTenant, SkeletonPage, ErrorState, ActivityFeed, money } from '@/components/shared';

export function Dashboard() {
  const contextQuery = useGetAuthorizedContext();
  const isPlatformOwner = contextQuery.data?.isPlatformOwner || false;
  const { schoolId } = useTenant();

  if (contextQuery.isLoading) return <SkeletonPage />;
  if (contextQuery.isError) return <ErrorState retry={() => contextQuery.refetch()} />;

  if (isPlatformOwner && (!schoolId || schoolId === 0)) {
    return <PlatformDashboard />;
  } else if (schoolId && schoolId !== 0) {
    return <SchoolDashboard schoolId={schoolId} />;
  } else {
    return <ErrorState retry={() => {}} message="No dashboard access available for your role." />;
  }
}

function PlatformDashboard() {
  const query = useGetPlatformDashboard();
  const data: any = query.data;
  
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;
  
  const today = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow={`Platform overview · ${today}`} 
        title="The whole network, at a glance." 
        description="A calm operational read on the schools, people and payments moving through EduPulse." 
        // We avoid wouter Link here since it's just a UI demo, but wait, wouter Link needs a proper import in shared, actually I'll use native a or wouter Link
        // Need to import Link from wouter directly
        action={
          <a href="/schools" className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] shadow-[0_4px_14px_hsl(var(--primary)/.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_20px_hsl(var(--primary)/.3)]" data-testid="link-manage-schools">
            <Building2 size={16} />Manage schools
          </a>
        } 
      />
      
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total schools" value={data?.totalSchools ?? 0} detail={`${data?.activeSchools ?? 0} active · ${data?.suspendedSchools ?? 0} need attention`} icon={Building2} accent />
        <Metric label="Students across network" value={(data?.totalStudents ?? 0).toLocaleString()} detail={`${data?.activeSubscriptions ?? 0} active subscriptions`} icon={GraduationCap} />
        <Metric label="Revenue this cycle" value={money(data?.revenue)} detail={`${money(data?.schoolAllocation)} allocated to schools`} icon={CircleDollarSign} accent />
        <Metric label="NFC fleet" value={(data?.activeCards ?? 0).toLocaleString()} detail={`${data?.lockedCards ?? 0} locked cards`} icon={Smartphone} />
      </div>
      
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="panel p-6 md:p-8">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <div className="eyebrow">Network pulse</div>
              <h2 className="display-font mt-2 text-2xl font-bold">Payments and allocation</h2>
            </div>
            <span className="rounded-full bg-[hsl(var(--accent)/.2)] px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary))] dark:text-[hsl(var(--accent))]">Live ledger</span>
          </div>
          
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-[hsl(var(--primary))] p-5 text-[hsl(var(--primary-foreground))] shadow-lg">
              <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">Gross collected</div>
              <div className="display-font mt-8 text-3xl font-bold">{money(data?.revenue)}</div>
              <div className="mt-3 text-xs font-medium opacity-80">Across every school</div>
            </div>
            <div className="rounded-2xl bg-[hsl(var(--secondary))] p-5 border border-[hsl(var(--border))]">
              <div className="eyebrow">School allocation</div>
              <div className="display-font mt-8 text-3xl font-bold">{money(data?.schoolAllocation)}</div>
              <div className="mt-3 text-xs font-medium text-[hsl(var(--muted-foreground))]">Share returning to operators</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-5 bg-[hsl(var(--card))]">
              <div className="eyebrow">EduPulse allocation</div>
              <div className="display-font mt-8 text-3xl font-bold">{money(data?.edupulseAllocation)}</div>
              <div className="mt-3 text-xs font-medium text-[hsl(var(--muted-foreground))]">Platform operations share</div>
            </div>
          </div>
          
          <div className="mt-8 flex items-center gap-3 border-t border-[hsl(var(--border))] pt-5 text-sm font-medium text-[hsl(var(--muted-foreground))]">
            <div className="h-2.5 w-2.5 rounded-full bg-[hsl(157_37%_43%)] shadow-[0_0_8px_hsl(157_37%_43%/.5)]" />
            Collections are within the expected term rhythm 
            <ArrowUpRight size={16} className="ml-auto opacity-50" />
          </div>
        </div>
        
        <div className="panel p-6 md:p-8">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <div className="eyebrow">Latest activity</div>
              <h2 className="display-font mt-2 text-2xl font-bold">What just happened</h2>
            </div>
            <a href="/audit" className="text-sm font-bold text-[hsl(var(--primary))] hover:underline" data-testid="link-view-audit">View trail</a>
          </div>
          <ActivityFeed items={data?.recentActivity} />
        </div>
      </div>
    </div>
  );
}

function SchoolDashboard({ schoolId }: { schoolId: number }) {
  const query = useGetSchoolDashboard({ schoolId });
  const data: any = query.data;
  
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;
  
  const school = data?.school;
  const today = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow={`School overview · ${today}`} 
        title={`${school?.name || 'Your School'} Command Centre`} 
        description="The pulse of your students, staff, and daily operations." 
        action={
          <a href="/students" className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] shadow-[0_4px_14px_hsl(var(--primary)/.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_20px_hsl(var(--primary)/.3)]" data-testid="link-directory">
            <GraduationCap size={16} />Open directory
          </a>
        } 
      />
      
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total students" value={data?.totalStudents ?? 0} detail={`${data?.activeStudents ?? 0} currently active`} icon={GraduationCap} accent />
        <Metric label="Unpaid students" value={data?.unpaidStudents ?? 0} detail="Need subscription follow-up" icon={CircleDollarSign} />
        <Metric label="Pending payments" value={data?.pendingPayments ?? 0} detail="Waiting for verification" icon={CircleDollarSign} accent />
        <Metric label="Active cards" value={data?.activeCards ?? 0} detail={`${data?.lockedCards ?? 0} locked`} icon={Smartphone} />
      </div>
      
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="panel p-6 md:p-8">
          <div className="eyebrow mb-2">Institutional snapshot</div>
          <h2 className="display-font text-2xl font-bold mb-6">Staff & Structure</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[hsl(var(--border))] p-5 bg-[hsl(var(--card))]">
              <div className="eyebrow">Active Teachers</div>
              <div className="display-font mt-4 text-3xl font-bold">{data?.activeTeachers ?? 0}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-5 bg-[hsl(var(--card))]">
              <div className="eyebrow">Other Staff</div>
              <div className="display-font mt-4 text-3xl font-bold">{data?.otherStaff ?? 0}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-5 bg-[hsl(var(--card))]">
              <div className="eyebrow">Total Classes</div>
              <div className="display-font mt-4 text-3xl font-bold">{data?.totalClasses ?? 0}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-5 bg-[hsl(var(--card))]">
              <div className="eyebrow">Total Subjects</div>
              <div className="display-font mt-4 text-3xl font-bold">{data?.totalSubjects ?? 0}</div>
            </div>
          </div>
          
          <div className="mt-6 rounded-2xl bg-[hsl(var(--secondary))] p-5 border border-[hsl(var(--border))] flex items-center justify-between">
            <div>
              <div className="text-sm font-bold">Academic Session</div>
              <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                {data?.currentAcademicSession?.name || 'No active session'} · {data?.currentTerm?.name || 'No term'} Term
              </div>
            </div>
            <a href="/academics" className="text-xs font-bold text-[hsl(var(--primary))] hover:underline">Manage</a>
          </div>
        </div>
        
        <div className="panel p-6 md:p-8">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <div className="eyebrow">School activity</div>
              <h2 className="display-font mt-2 text-2xl font-bold">Recent movement</h2>
            </div>
            <a href="/audit" className="text-sm font-bold text-[hsl(var(--primary))] hover:underline" data-testid="link-view-audit">Full trail</a>
          </div>
          <ActivityFeed items={data?.recentActivity} />
        </div>
      </div>
    </div>
  );
}