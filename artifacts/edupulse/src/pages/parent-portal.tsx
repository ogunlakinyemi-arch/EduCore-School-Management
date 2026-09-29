import { UserButton } from '@clerk/react';
import { useState } from 'react';
import { Link, Route, Switch } from 'wouter';
import { BookOpen, ChevronRight, GraduationCap, ShieldCheck, UserRound, UsersRound, Zap, LogIn, LogOut, Calendar, Clock, ReceiptText } from 'lucide-react';
import { 
  useGetParentChild, useGetParentChildren, useGetParentProfile, useGetParentChildAttendance,
  useListChildAcademicAssignments, useListChildAcademicResults, useListChildAcademicReportCards, useGetChildAcademicTimetable
} from '@workspace/api-client-react';
import NotFound from './not-found';
import { ParentFeesPage } from './finance';
import { ParentCheckoutReturn } from './finance-online';
import { FeePaymentNotifications } from '@/components/fee-payment-notifications';
import { CommunicationInbox, CommunicationInboxBadge } from '@/pages/communication-inbox';
import { NotificationSettings } from '@/pages/notification-settings';
import { Loans } from '@/pages/library';
import { cx } from 'class-variance-authority';

function Loading() {
  return <div className="mx-auto max-w-6xl space-y-5 p-5 md:p-8"><div className="skeleton h-11 w-64 rounded-xl" /><div className="grid gap-4 md:grid-cols-2"><div className="skeleton h-52 rounded-[18px]" /><div className="skeleton h-52 rounded-[18px]" /></div></div>;
}

function PortalHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--background)/.94)] backdrop-blur-xl">
      <div className="mx-auto flex h-[70px] max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Zap size={18} /></span>
          <span className="display-font font-bold">Yemait EduCore Parent</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs font-semibold text-[hsl(var(--muted-foreground))] sm:block">Protected family access</span>
          <FeePaymentNotifications audience="parent" />
          <CommunicationInboxBadge />
          <Link href="/notification-settings" className="hidden text-xs font-bold text-[hsl(var(--primary))] sm:block" data-testid="link-parent-notification-settings">Preferences</Link>
          <UserButton />
        </div>
      </div>
    </header>
  );
}

export function ParentDashboard() {
  const profile = useGetParentProfile();
  const children = useGetParentChildren();
  if (profile.isLoading || children.isLoading) return <Loading />;
  if (profile.isError || children.isError || !profile.data) return <div className="mx-auto max-w-3xl p-8"><div className="panel p-8 text-center"><h1 className="display-font text-2xl font-bold">Parent access is not ready</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Ask your school administrator to connect this account to your parent profile.</p></div></div>;
  const parent = profile.data;
  const linked = children.data ?? [];
  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8">
      <div className="mb-7">
        <div className="eyebrow">Parent portal</div>
        <h1 className="display-font mt-2 text-3xl font-bold md:text-4xl">Welcome, {parent.name}.</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">View the school information currently available for your linked children.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[.7fr_1.3fr]">
        <aside className="panel p-5 md:p-6">
          <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><UserRound size={20} /></div><div><div className="font-bold">{parent.name}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">Verified parent profile</div></div></div>
          <dl className="mt-6 space-y-4 text-sm"><div><dt className="eyebrow">Email</dt><dd className="mt-1 font-semibold">{parent.email}</dd></div><div><dt className="eyebrow">Phone</dt><dd className="mt-1 font-semibold">{parent.phone}</dd></div></dl>
          <div className="mt-6 rounded-2xl bg-[hsl(var(--secondary))] p-4"><div className="flex items-center gap-2 text-xs font-bold"><ShieldCheck size={15} className="text-[hsl(var(--primary))]" />Your family boundary is active</div><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Only students linked to this parent profile are available here.</p></div>
        </aside>
        <section className="panel overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] p-5 md:p-6"><div className="eyebrow">Linked children</div><h2 className="display-font mt-1 text-xl font-bold">{linked.length} {linked.length === 1 ? 'student' : 'students'}</h2></div>
          {linked.length ? linked.map(child => (
            <Link key={child.id} href={`/parent/children/${child.id}`} className="flex items-center gap-4 border-b border-[hsl(var(--border)/.7)] p-5 last:border-0 hover:bg-[hsl(var(--muted)/.45)]">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[hsl(var(--accent)/.22)] text-[hsl(var(--primary))]"><GraduationCap size={21} /></div>
              <div className="min-w-0 flex-1"><div className="font-bold">{child.firstName} {child.lastName}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{child.className} · {child.section} · {child.schoolName}</div></div>
              <ChevronRight size={18} className="text-[hsl(var(--muted-foreground))]" />
            </Link>
          )) : <div className="p-10 text-center"><UsersRound className="mx-auto text-[hsl(var(--muted-foreground))]" /><h3 className="mt-3 font-bold">No linked children yet</h3><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Your school administrator can add the relationship.</p></div>}
        </section>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="panel p-5"><BookOpen size={18} className="text-[hsl(var(--primary))]" /><div className="mt-3 text-sm font-bold">Attendance</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Open a linked child above to view their attendance.</div></div>
        <div className="panel p-5"><BookOpen size={18} className="text-[hsl(var(--primary))]" /><div className="mt-3 text-sm font-bold">Academic results</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Open a linked child above to view published results.</div></div>
        <div className="panel p-5"><ReceiptText size={18} className="text-[hsl(var(--primary))]" /><div className="mt-3 text-sm font-bold">Fees</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Open a linked child to review their invoices and transfers.</div></div>
      </div>
    </div>
  );
}

function ChildProfile({ studentId }: { studentId: number }) {
  const query = useGetParentChild(studentId);
  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data) return <NotFound />;
  const child = query.data;
  return (
    <div className="mx-auto max-w-4xl p-5 md:p-8">
      <Link href="/" className="text-xs font-bold text-[hsl(var(--primary))] flex items-center gap-1 mb-6"><ChevronRight size={14} className="rotate-180" /> Back to linked children</Link>
      <div className="panel overflow-hidden mb-8 shadow-xl">
        <div className="bg-[hsl(var(--sidebar))] p-7 text-[hsl(var(--sidebar-foreground))] relative overflow-hidden">
          <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none">
            <GraduationCap size={200} />
          </div>
          <div className="eyebrow text-white/60 mb-2">{child.schoolName}</div>
          <h1 className="display-font mt-2 text-3xl md:text-4xl font-bold tracking-tight">{child.firstName} {child.lastName}</h1>
          <p className="mt-2 text-sm text-white/60">{child.admissionNo}</p>
        </div>
        <div className="grid gap-5 p-6 sm:grid-cols-2 bg-[hsl(var(--muted)/.2)] border-b border-[hsl(var(--border))]">
          <Detail label="Class" value={child.className} />
          <Detail label="Section" value={child.section} />
          <Detail label="Student status" value={child.status} />
          <Detail label="School location" value={[child.city, child.state].filter(Boolean).join(', ') || '—'} />
        </div>
      </div>
      
      <div className="space-y-8">
        <Link href={`/parent/fees/${studentId}`} className="panel flex items-center gap-4 p-5 transition-colors hover:bg-[hsl(var(--secondary))]" data-testid={`link-child-fees-${studentId}`}><span className="grid h-11 w-11 place-items-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><ReceiptText size={21} /></span><span className="flex-1"><strong className="block">Fees & payments</strong><span className="text-xs text-[hsl(var(--muted-foreground))]">Invoices, balances and bank transfer submissions</span></span><ChevronRight size={17} /></Link>
        <Link href={`/parent/library/${studentId}`} className="panel flex items-center gap-4 p-5 transition-colors hover:bg-[hsl(var(--secondary))]" data-testid={`link-child-library-${studentId}`}><span className="grid h-11 w-11 place-items-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><BookOpen size={21} /></span><span className="flex-1"><strong className="block">Library loans</strong><span className="text-xs text-[hsl(var(--muted-foreground))]">Books, due dates and borrowing history</span></span><ChevronRight size={17} /></Link>
        <div className="panel overflow-hidden shadow-sm">
          <ChildAttendance studentId={studentId} />
        </div>
        <div className="panel overflow-hidden shadow-sm">
          <ChildAcademics studentId={studentId} schoolId={child.schoolId} />
        </div>
      </div>
    </div>
  );
}

function ChildAttendance({ studentId }: { studentId: number }) {
  const query = useGetParentChildAttendance(studentId);

  if (query.isLoading) return <div className="p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Loading attendance records...</div>;
  if (query.isError) return <div className="p-10 text-center text-sm font-bold text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/.05)]">Failed to load attendance.</div>;
  if (!query.data || query.data.length === 0) return <div className="p-10 text-center text-sm text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted)/.2)]">No attendance records found.</div>;

  return (
    <div className="border-t border-[hsl(var(--border))]">
      <div className="bg-[hsl(var(--muted)/.3)] p-5 md:p-6 border-b border-[hsl(var(--border))]">
        <h3 className="font-bold text-lg">Recent Attendance</h3>
      </div>
      <div className="divide-y divide-[hsl(var(--border)/.7)]">
        {query.data.map((event: any) => (
           <AttendanceRow key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}

function AttendanceRow({ event }: { event: any }) {
  const isLate = event.status === 'LATE';
  const isEarly = event.status === 'LEFT_EARLY';
  const isAbsent = event.status === 'ABSENT';
  const hasDiscrepancy = event.discrepancyStatus === 'OPEN';

  const dateStr = new Date(event.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = new Date(event.occurredAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const typeMap: Record<string, string> = {
    SCHOOL_ENTRY: 'School Arrival',
    SCHOOL_EXIT: 'School Departure',
    CLASSROOM_ENTRY: 'Classroom Entry',
    CLASSROOM_EXIT: 'Classroom Exit'
  };
  const eventName = typeMap[event.eventType] || event.eventType;

  return (
    <div className="flex items-center gap-4 p-5 md:px-6 hover:bg-[hsl(var(--muted)/.25)] transition-colors">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))] shadow-sm">
         {event.eventType.includes('ENTRY') ? <LogIn size={18} /> : <LogOut size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
           <span className="font-bold">{eventName}</span>
           {isLate && <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 uppercase tracking-wider">Late</span>}
           {isEarly && <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 uppercase tracking-wider">Left Early</span>}
           {isAbsent && <span className="rounded bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-600 uppercase tracking-wider">Absent</span>}
           {hasDiscrepancy && <span className="rounded bg-purple-500/10 px-2 py-0.5 text-[10px] font-bold text-purple-600 uppercase tracking-wider">Under Review</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-4 text-xs font-medium text-[hsl(var(--muted-foreground))]">
          <span className="flex items-center gap-1.5"><Calendar size={13} /> {dateStr}</span>
          <span className="flex items-center gap-1.5"><Clock size={13} /> {timeStr}</span>
        </div>
      </div>
    </div>
  );
}

function ChildAcademics({ studentId, schoolId }: { studentId: number; schoolId: number }) {
  const [tab, setTab] = useState<'assignments' | 'results' | 'cards' | 'timetable'>('assignments');
  
  return (
    <div>
      <div className="bg-[hsl(var(--muted)/.3)] p-5 md:p-6 border-b border-[hsl(var(--border))] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h3 className="font-bold text-lg">Academics</h3>
        <div className="flex bg-[hsl(var(--muted))] p-1 rounded-xl overflow-x-auto w-full md:w-auto">
          {[{id: 'assignments', label: 'Assignments'}, {id: 'results', label: 'Results'}, {id: 'cards', label: 'Report Cards'}, {id: 'timetable', label: 'Timetable'}].map(t => (
             <button 
               key={t.id} 
               onClick={() => setTab(t.id as any)} 
               className={cx("px-3 py-1.5 text-xs font-bold rounded-lg transition-colors whitespace-nowrap", tab === t.id ? "bg-[hsl(var(--background))] shadow-sm text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}
             >
               {t.label}
             </button>
          ))}
        </div>
      </div>
      <div className="p-5 md:p-6 bg-[hsl(var(--card))]">
        {tab === 'assignments' && <ChildAssignments studentId={studentId} schoolId={schoolId} />}
        {tab === 'results' && <ChildResults studentId={studentId} schoolId={schoolId} />}
        {tab === 'cards' && <ChildReportCards studentId={studentId} schoolId={schoolId} />}
        {tab === 'timetable' && <ChildTimetable studentId={studentId} schoolId={schoolId} />}
      </div>
    </div>
  );
}

function ChildAssignments({ studentId, schoolId }: { studentId: number; schoolId: number }) {
  const query = useListChildAcademicAssignments(studentId, { schoolId });
  if (query.isLoading) return <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Loading assignments...</div>;
  if (query.isError) return <div className="py-10 text-center text-sm text-[hsl(var(--destructive))]">Failed to load assignments</div>;
  const assignments = query.data ?? [];
  
  if (!assignments.length) return <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))] border border-dashed border-[hsl(var(--border))] rounded-xl">No active assignments.</div>;
  
  return (
    <div className="space-y-4">
      {assignments.map((item: any) => (
         <div key={item.id} className="p-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.1)] flex justify-between gap-4 flex-wrap">
            <div>
              <div className="font-bold">{item.title}</div>
              {item.description && <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1 line-clamp-2">{item.description}</div>}
              <div className="text-xs font-medium mt-3 flex gap-4 text-[hsl(var(--muted-foreground))]">
                <span>Due: {new Date(item.dueDate).toLocaleDateString()}</span>
                <span>Max Score: {item.maxScore}</span>
              </div>
            </div>
            <div>
               <span className="text-[10px] font-bold uppercase tracking-wider bg-[hsl(var(--muted))] px-2 py-1 rounded">{item.status}</span>
            </div>
         </div>
      ))}
    </div>
  );
}

function ChildResults({ studentId, schoolId }: { studentId: number; schoolId: number }) {
  const query = useListChildAcademicResults(studentId, { schoolId });
  if (query.isLoading) return <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Loading results...</div>;
  const results = (query.data ?? []).filter((r: any) => r.status === 'PUBLISHED' || !r.status);
  
  if (!results.length) return <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))] border border-dashed border-[hsl(var(--border))] rounded-xl">No published assessment results.</div>;
  
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {results.map((item: any) => (
         <div key={item.id} className="p-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.1)] flex items-center justify-between">
            <div>
              <div className="font-bold text-sm">Assessment Result</div>
              <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">ID: {item.assessmentId}</div>
              {item.remark && <div className="text-xs italic mt-2 text-[hsl(var(--muted-foreground))]">"{item.remark}"</div>}
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold display-font text-[hsl(var(--primary))]">{item.score}</div>
              <div className="text-[10px] uppercase font-bold text-[hsl(var(--muted-foreground))] mt-0.5">Score</div>
            </div>
         </div>
      ))}
    </div>
  );
}

function ChildReportCards({ studentId, schoolId }: { studentId: number; schoolId: number }) {
  const query = useListChildAcademicReportCards(studentId, { schoolId });
  if (query.isLoading) return <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Loading report cards...</div>;
  const cards = (query.data ?? []).filter((r: any) => r.status === 'PUBLISHED');
  
  if (!cards.length) return <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))] border border-dashed border-[hsl(var(--border))] rounded-xl">No published report cards.</div>;
  
  return (
    <div className="grid gap-4">
      {cards.map((card: any) => (
         <div key={card.id} className="p-5 rounded-2xl border border-[hsl(var(--primary)/.2)] bg-gradient-to-br from-[hsl(var(--primary)/.05)] to-[hsl(var(--card))]">
            <div className="flex justify-between items-start mb-4">
               <div>
                  <div className="font-bold text-lg tracking-tight">Term Report Card</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Official Record</div>
               </div>
               <div className="text-xs font-semibold text-[hsl(var(--primary))]">{card.resultState.replaceAll('_', ' ')}</div>
            </div>
            <div className="text-xs text-[hsl(var(--muted-foreground))] mb-3">{card.className} {card.section} · {card.sessionName ?? `Session #${card.sessionId}`}, {card.termName ?? `Term #${card.termId}`}</div>
            <div className="space-y-2 mb-4">
              {card.lines.length ? card.lines.map((line: any) => (
                <div key={line.id} className="flex justify-between gap-4 rounded-lg border border-[hsl(var(--border))] p-3 text-sm">
                  <span><strong>{line.subjectName}</strong> · {line.assessmentName}</span>
                  <span className="font-semibold">{line.score}/{line.maxScore} · {line.grade}</span>
                </div>
              )) : <p className="text-sm text-[hsl(var(--muted-foreground))]">No graded results were included at publication.</p>}
            </div>
            {(card.teacherRemark || card.schoolRemark) && (
              <div className="text-sm italic text-[hsl(var(--muted-foreground))] bg-[hsl(var(--background))] p-3 rounded-lg border border-[hsl(var(--border))]">
                {card.teacherRemark && <p>Teacher: {card.teacherRemark}</p>}
                {card.schoolRemark && <p>School: {card.schoolRemark}</p>}
              </div>
            )}
         </div>
      ))}
    </div>
  );
}

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];

function ChildTimetable({ studentId, schoolId }: { studentId: number; schoolId: number }) {
  const query = useGetChildAcademicTimetable(studentId, { schoolId });
  if (query.isLoading) return <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Loading timetable...</div>;
  const entries = query.data ?? [];
  
  if (!entries.length) return <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))] border border-dashed border-[hsl(var(--border))] rounded-xl">No class timetable available.</div>;
  
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {DAYS.map(day => {
        const dayEntries = entries.filter((e: any) => e.weekday === day).sort((a: any, b: any) => a.startTime.localeCompare(b.startTime));
        if (!dayEntries.length) return null;
        return (
          <div key={day} className="rounded-xl border border-[hsl(var(--border))] overflow-hidden">
             <div className="bg-[hsl(var(--muted)/.5)] px-3 py-2 text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))]">{day}</div>
             <div className="divide-y divide-[hsl(var(--border)/.6)]">
               {dayEntries.map((item: any) => (
                 <div key={item.id} className="p-3 bg-[hsl(var(--card))]">
                   <div className="text-xs font-bold mb-1">{item.startTime} — {item.endTime}</div>
                   <div className="text-xs text-[hsl(var(--muted-foreground))] flex items-center justify-between">
                     <span>{item.subjectName}</span>
                     {item.room && <span>Rm {item.room}</span>}
                   </div>
                 </div>
               ))}
             </div>
          </div>
        );
      })}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="eyebrow">{label}</div><div className="mt-1 text-sm font-bold">{value}</div></div>;
}

function ChildRoute() {
  const id = Number(window.location.pathname.split('/').pop());
  return <ChildProfile studentId={id} />;
}

function ChildFeesRoute() {
  const id = Number(window.location.pathname.split('/').pop());
  if (!Number.isInteger(id) || id < 1) return <NotFound />;
  return <ParentFeesPage studentId={id} />;
}

function ChildLibraryRoute() {
  const studentId = Number(window.location.pathname.split('/').pop());
  const child = useGetParentChild(studentId);
  if (!Number.isInteger(studentId) || studentId < 1) return <NotFound />;
  if (child.isLoading) return <Loading />;
  if (child.isError || !child.data) return <NotFound />;
  return <div className="mx-auto max-w-6xl p-5 md:p-8"><Link href={`/parent/children/${studentId}`} className="mb-6 inline-block text-xs font-bold text-[hsl(var(--primary))]" data-testid="link-parent-child-back">Back to child profile</Link><div className="eyebrow">Linked child / Library</div><h1 className="display-font mb-3 mt-2 text-3xl font-bold">{child.data.firstName}’s books</h1><p className="mb-7 text-sm text-[hsl(var(--muted-foreground))]">Current loans and return history for your linked child. Only the borrower can return or renew a book.</p><Loans schoolId={child.data.schoolId} admin={false} currentUserId={0} childId={studentId} /></div>;
}

export default function ParentPortal() {
  return <div className="min-h-[100dvh] bg-[hsl(var(--background))]"><PortalHeader /><Switch><Route path="/" component={ParentDashboard} /><Route path="/inbox"><CommunicationInbox standalone /></Route><Route path="/notification-settings"><NotificationSettings standalone /></Route><Route path="/fees/return" component={ParentCheckoutReturn} /><Route path="/parent/fees/return" component={ParentCheckoutReturn} /><Route path="/parent/children/:studentId" component={ChildRoute} /><Route path="/parent/fees/:studentId" component={ChildFeesRoute} /><Route path="/parent/library/:studentId" component={ChildLibraryRoute} /><Route component={NotFound} /></Switch></div>;
}