import { useGetPlatformDashboard, useGetSchoolDashboard, useGetAuthorizedContext, useGetStudentSelfProfile, useGetOwnAttendance } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { TeacherAssignedWork, isOwnTeacherView } from '@/components/teacher-assigned-work';
import { Building2, GraduationCap, CircleDollarSign, Smartphone, ArrowUpRight, LogIn, LogOut, Calendar, Clock, UsersRound, Briefcase, CreditCard, FileClock, ReceiptText } from 'lucide-react';
import { PageHeading, Metric, useTenant, SkeletonPage, ErrorState, ActivityFeed, money, Button, StatusPill } from '@/components/shared';

export function Dashboard() {
  const contextQuery = useGetAuthorizedContext();
  const isPlatformOwner = contextQuery.data?.isPlatformOwner || false;
  const { schoolId } = useTenant();

  if (contextQuery.isLoading) return <SkeletonPage />;
  if (contextQuery.isError) return <ErrorState retry={() => contextQuery.refetch()} />;

  const roles = contextQuery.data?.roles?.map(r => r.role) || [];
  const isOnlyStudent = roles.length === 1 && roles[0] === 'STUDENT';
  const canOpenSchoolFinance = !isPlatformOwner && contextQuery.data?.roles?.some(role =>
    (role.role === 'SCHOOL_ADMIN' || role.role === 'ACCOUNTANT')
    && role.status === 'ACTIVE'
    && role.schoolId === schoolId) === true;

  if (isOnlyStudent) {
    return <StudentDashboard />;
  }

  if (isPlatformOwner) {
    return <PlatformDashboard selectedSchoolId={schoolId} />;
  } else if (schoolId && schoolId !== 0) {
    const ownTeacherView = isOwnTeacherView(contextQuery.data, schoolId);
    return <SchoolDashboard schoolId={schoolId} canOpenFinance={canOpenSchoolFinance} showTeacherWork={ownTeacherView} />;
  } else {
    return <ErrorState retry={() => {}} message="No dashboard access available for your role." />;
  }
}

function StudentDashboard() {
  const profileQuery = useGetStudentSelfProfile();
  const attendanceQuery = useGetOwnAttendance();

  if (profileQuery.isLoading || attendanceQuery.isLoading) return <SkeletonPage />;
  if (profileQuery.isError) return <ErrorState retry={() => profileQuery.refetch()} />;
  if (!profileQuery.data) return <ErrorState retry={() => {}} message="Student profile not found." />;

  const student = profileQuery.data;
  const attendance = attendanceQuery.data || [];
  const today = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow={`Student portal · ${today}`}
        title={`Welcome, ${student.firstName}.`}
        description="View your school information and recent attendance."
      />

      <Link href="/my-fees" className="panel mb-6 flex items-center gap-4 p-5 transition-colors hover:border-[hsl(var(--primary)/.4)] hover:bg-[hsl(var(--secondary))]" data-testid="link-student-fees-receipts">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><ReceiptText size={21} /></span>
        <span className="min-w-0 flex-1"><strong className="block">Fees & receipts</strong><span className="text-xs text-[hsl(var(--muted-foreground))]">Open your fee balance, payment history and receipts.</span></span>
        <ArrowUpRight size={17} />
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
        <div className="panel p-6 md:p-8">
          <div className="eyebrow">Your Profile</div>
          <h2 className="display-font mt-2 text-2xl font-bold">{student.firstName} {student.lastName}</h2>
          <div className="mt-6 space-y-4">
            <div><div className="text-xs text-[hsl(var(--muted-foreground))]">Admission No.</div><div className="font-bold">{student.admissionNo}</div></div>
            <div><div className="text-xs text-[hsl(var(--muted-foreground))]">Class</div><div className="font-bold">{student.className} - {student.section}</div></div>
            <div><div className="text-xs text-[hsl(var(--muted-foreground))]">Status</div><div className="font-bold capitalize">{student.status.toLowerCase()}</div></div>
          </div>
        </div>

        <div className="panel p-0 overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] p-6 md:p-8">
            <div className="eyebrow">Activity</div>
            <h2 className="display-font mt-2 text-2xl font-bold">Recent Attendance</h2>
          </div>

          {attendanceQuery.isError ? (
            <div className="p-10 text-center font-bold text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/.05)] text-sm">
              Failed to load attendance
            </div>
          ) : attendance.length === 0 ? (
            <div className="p-10 text-center text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted)/.2)] text-sm">
              No recent attendance records found.
            </div>
          ) : (
            <div className="divide-y divide-[hsl(var(--border)/.7)]">
              {attendance.map((event: any) => (
                <StudentAttendanceRow key={event.id} event={event} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StudentAttendanceRow({ event }: { event: any }) {
  const isLate = event.status === 'LATE';
  const isEarly = event.status === 'LEFT_EARLY';
  const isAbsent = event.status === 'ABSENT';
  const hasDiscrepancy = event.discrepancyStatus === 'OPEN';

  const dateStr = new Date(event.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = new Date(event.occurredAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const typeMap: Record<string, string> = {
    SCHOOL_ENTRY: 'School Arrival',
    SCHOOL_EXIT: 'School Departure',
    CLASSROOM_ENTRY: 'Class Entry',
    CLASSROOM_EXIT: 'Class Exit'
  };
  const eventName = typeMap[event.eventType] || event.eventType;

  return (
    <div className="flex items-center gap-4 p-5 md:px-8 hover:bg-[hsl(var(--muted)/.25)] transition-colors">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))] shadow-sm">
         {event.eventType.includes('ENTRY') ? <LogIn size={18} /> : <LogOut size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
           <span className="font-bold text-sm">{eventName}</span>
           {isLate && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 uppercase tracking-wider">Late</span>}
           {isEarly && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 uppercase tracking-wider">Left Early</span>}
           {isAbsent && <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-600 uppercase tracking-wider">Absent</span>}
           {hasDiscrepancy && <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-bold text-purple-600 uppercase tracking-wider">Review</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-4 text-xs font-medium text-[hsl(var(--muted-foreground))]">
          <span className="flex items-center gap-1.5"><Calendar size={13} /> {dateStr}</span>
          <span className="flex items-center gap-1.5"><Clock size={13} /> {timeStr}</span>
        </div>
      </div>
    </div>
  );
}

type PlatformSchoolSummary = {
  id: number;
  name: string;
  code: string;
  city: string;
  state: string;
  status: string;
  subscriptionStatus: string;
  studentCount: number;
  activeStudentCount: number;
  partnerReferral: null | { partnerName: string };
};

function PlatformDashboard({ selectedSchoolId }: { selectedSchoolId: number }) {
  const { setSchoolId } = useTenant();
  const query = useGetPlatformDashboard();
  const directoryQuery = useQuery({
    queryKey: ['platform-school-directory', 'dashboard'],
    queryFn: async () => {
      const response = await fetch('/api/platform/schools/directory?status=all', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Could not load platform-wide school totals (${response.status})`);
      return response.json() as Promise<{
        schools: PlatformSchoolSummary[];
        totals: {
          schoolCount: number;
          studentCount: number;
          activeStudentCount: number;
          teacherCount: number;
          staffCount: number;
          parentCount: number;
        };
      }>;
    },
  });
  const data: any = query.data;
  
  if (query.isLoading || directoryQuery.isLoading) return <SkeletonPage />;
  if (query.isError || directoryQuery.isError) return <ErrorState retry={() => { query.refetch(); directoryQuery.refetch(); }} />;
  const selectedSchool = selectedSchoolId
    ? directoryQuery.data?.schools.find(school => school.id === selectedSchoolId)
    : undefined;
  if (selectedSchoolId && !selectedSchool) {
    return <ErrorState retry={() => directoryQuery.refetch()} message="The selected school is not available in the platform directory." />;
  }
  if (selectedSchool) {
    return <PlatformSchoolDashboard school={selectedSchool} onReturn={() => setSchoolId(0)} />;
  }
  const network = directoryQuery.data?.totals ?? {
    teacherCount: 0, staffCount: 0, parentCount: 0,
  };
  
  const today = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow={`Platform overview · ${today}`} 
        title="The whole network, at a glance." 
        description="A calm operational read on the schools, people and payments moving through Yemait EduCore."
        action={
          <Link href="/schools" className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] shadow-[0_4px_14px_hsl(var(--primary)/.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_20px_hsl(var(--primary)/.3)]" data-testid="link-manage-schools">
            <Building2 size={16} />Manage schools
          </Link>
        } 
      />
      
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total schools" value={data?.totalSchools ?? 0} detail={`${data?.activeSchools ?? 0} active · ${data?.suspendedSchools ?? 0} need attention`} icon={Building2} accent />
        <Metric label="Students across network" value={(data?.totalStudents ?? 0).toLocaleString()} detail={`${data?.activeSubscriptions ?? 0} active subscriptions`} icon={GraduationCap} />
        <Metric label="Revenue this cycle" value={money(data?.revenue)} detail={`${money(data?.schoolAllocation)} allocated to schools`} icon={CircleDollarSign} accent />
        <Metric label="NFC fleet" value={(data?.activeCards ?? 0).toLocaleString()} detail={`${data?.lockedCards ?? 0} locked cards`} icon={Smartphone} />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Metric label="Active teachers across schools" value={network.teacherCount.toLocaleString()} icon={Briefcase} />
        <Metric label="Other active employees" value={network.staffCount.toLocaleString()} icon={UsersRound} />
        <Metric label="Parent accounts" value={network.parentCount.toLocaleString()} icon={UsersRound} />
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/schools" className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-bold hover:border-[hsl(var(--primary)/.4)]" data-testid="link-owner-school-directory">
          <Building2 size={16} />School directory
        </Link>
        <Link href="/devices" className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-bold hover:border-[hsl(var(--primary)/.4)]" data-testid="link-owner-devices">
          <Smartphone size={16} />NFC devices
        </Link>
        <Link href="/cards" className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-bold hover:border-[hsl(var(--primary)/.4)]" data-testid="link-owner-cards">
          <CreditCard size={16} />NFC cards
        </Link>
        <Link href="/audit" className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-bold hover:border-[hsl(var(--primary)/.4)]" data-testid="link-owner-audit">
          <FileClock size={16} />Audit trail
        </Link>
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
              <div className="eyebrow">Yemait EduCore allocation</div>
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
            <Link href="/audit" className="text-sm font-bold text-[hsl(var(--primary))] hover:underline" data-testid="link-view-audit">View trail</Link>
          </div>
          <ActivityFeed items={data?.recentActivity} />
        </div>
      </div>
    </div>
  );
}

function PlatformSchoolDashboard({ school, onReturn }: { school: PlatformSchoolSummary; onReturn: () => void }) {
  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Platform Owner / School view"
        title={school.name}
        description="Platform-level school information. School Admins manage day-to-day school operations."
        action={<Button variant="outline" onClick={onReturn}>Platform network</Button>}
      />
      <div className="panel mb-6 p-6 md:p-8" data-testid="owner-school-snapshot">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="eyebrow">School profile</div>
            <div className="mt-2 text-xl font-bold">{school.name}</div>
            <div className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              {school.code} · {[school.city, school.state].filter(Boolean).join(', ')}
            </div>
          </div>
          <StatusPill value={school.status} />
        </div>
        <div className="mt-6 border-t border-[hsl(var(--border))] pt-5 text-sm">
          <span className="text-[hsl(var(--muted-foreground))]">Subscription status: </span>
          <strong>{school.subscriptionStatus || 'Not available'}</strong>
          {school.partnerReferral?.partnerName && (
            <p className="mt-2"><span className="text-[hsl(var(--muted-foreground))]">Referral partner: </span>{school.partnerReferral.partnerName}</p>
          )}
        </div>
      </div>
      <div className="mb-6 grid gap-5 sm:grid-cols-2">
        <Metric label="Students" value={school.studentCount.toLocaleString()} icon={GraduationCap} accent />
        <Metric label="Active students" value={school.activeStudentCount.toLocaleString()} icon={GraduationCap} />
      </div>
      <div className="panel p-6">
        <div className="eyebrow mb-4">Platform access</div>
        <div className="flex flex-wrap gap-3">
          {[
            { href: `/schools/${school.id}`, label: 'School profile' },
            { href: '/students', label: 'Students & e-ID' },
            { href: '/cards', label: 'NFC cards' },
            { href: '/devices', label: 'NFC devices' },
            { href: '/partners', label: 'Partners' },
            { href: '/subscriptions', label: 'Subscription status' },
            { href: '/audit', label: 'Audit log' },
          ].map(link => (
            <Link key={link.href} href={link.href} className="rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold hover:border-[hsl(var(--primary)/.4)]">
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function SchoolDashboard({ schoolId, canOpenFinance, showTeacherWork = false }: { schoolId: number; canOpenFinance: boolean; showTeacherWork?: boolean }) {
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
          <div className="flex flex-wrap gap-2">
          {canOpenFinance && <Link href="/finance" className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-bold transition-colors hover:border-[hsl(var(--primary)/.4)]" data-testid="link-school-finance">
            <CircleDollarSign size={16} />School finance
          </Link>}
          <Link href="/students" className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] shadow-[0_4px_14px_hsl(var(--primary)/.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_20px_hsl(var(--primary)/.3)]" data-testid="link-directory">
            <GraduationCap size={16} />Open directory
          </Link>
          </div>
        } 
      />
      
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total students" value={data?.totalStudents ?? 0} detail={`${data?.activeStudents ?? 0} currently active`} icon={GraduationCap} accent />
        <Metric label="Unpaid students" value={data?.unpaidStudents ?? 0} detail="Need subscription follow-up" icon={CircleDollarSign} />
        <Metric label="Pending payments" value={data?.pendingPayments ?? 0} detail="Waiting for verification" icon={CircleDollarSign} accent />
        <Metric label="Active cards" value={data?.activeCards ?? 0} detail={`${data?.lockedCards ?? 0} locked`} icon={Smartphone} />
      </div>
      
      {showTeacherWork && <TeacherAssignedWork schoolId={schoolId} />}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="panel min-w-0 p-6 md:p-8">
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
            <Link href="/academics" className="text-xs font-bold text-[hsl(var(--primary))] hover:underline">Manage</Link>
          </div>
        </div>
        
        <div className="panel min-w-0 p-6 md:p-8">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <div className="eyebrow">School activity</div>
              <h2 className="display-font mt-2 text-2xl font-bold">Recent movement</h2>
            </div>
            <Link href="/audit" className="text-sm font-bold text-[hsl(var(--primary))] hover:underline" data-testid="link-view-audit">Full trail</Link>
          </div>
          <ActivityFeed items={data?.recentActivity} />
        </div>
      </div>
    </div>
  );
}