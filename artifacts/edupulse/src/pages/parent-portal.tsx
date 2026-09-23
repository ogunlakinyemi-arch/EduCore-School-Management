import { UserButton } from '@clerk/react';
import { Link, Route, Switch } from 'wouter';
import { BookOpen, ChevronRight, GraduationCap, ShieldCheck, UserRound, UsersRound, Zap } from 'lucide-react';
import { useGetParentChild, useGetParentChildren, useGetParentProfile } from '@workspace/api-client-react';
import NotFound from './not-found';

function Loading() {
  return <div className="mx-auto max-w-6xl space-y-5 p-5 md:p-8"><div className="skeleton h-11 w-64 rounded-xl" /><div className="grid gap-4 md:grid-cols-2"><div className="skeleton h-52 rounded-[18px]" /><div className="skeleton h-52 rounded-[18px]" /></div></div>;
}

function PortalHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--background)/.94)] backdrop-blur-xl">
      <div className="mx-auto flex h-[70px] max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Zap size={18} /></span>
          <span className="display-font font-bold">EduPulse Parent</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs font-semibold text-[hsl(var(--muted-foreground))] sm:block">Protected family access</span>
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
        {['Attendance', 'Academic results', 'Fees'].map(label => <div key={label} className="panel p-5 opacity-70"><BookOpen size={18} className="text-[hsl(var(--muted-foreground))]" /><div className="mt-3 text-sm font-bold">{label}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Not available in this phase</div></div>)}
      </div>
    </div>
  );
}

function ChildProfile({ studentId }: { studentId: number }) {
  const query = useGetParentChild(studentId);
  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data) return <NotFound />;
  const child = query.data;
  return <div className="mx-auto max-w-4xl p-5 md:p-8"><Link href="/" className="text-xs font-bold text-[hsl(var(--primary))]">← Back to linked children</Link><div className="panel mt-5 overflow-hidden"><div className="bg-[hsl(var(--sidebar))] p-7 text-[hsl(var(--sidebar-foreground))]"><div className="eyebrow text-white/60">{child.schoolName}</div><h1 className="display-font mt-2 text-3xl font-bold">{child.firstName} {child.lastName}</h1><p className="mt-2 text-sm text-white/60">{child.admissionNo}</p></div><div className="grid gap-5 p-6 sm:grid-cols-2"><Detail label="Class" value={child.className} /><Detail label="Section" value={child.section} /><Detail label="Student status" value={child.status} /><Detail label="School location" value={[child.city, child.state].filter(Boolean).join(', ') || '—'} /></div></div></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="eyebrow">{label}</div><div className="mt-1 text-sm font-bold">{value}</div></div>;
}

function ChildRoute() {
  const id = Number(window.location.pathname.split('/').pop());
  return <ChildProfile studentId={id} />;
}

export default function ParentPortal() {
  return <div className="min-h-[100dvh] bg-[hsl(var(--background))]"><PortalHeader /><Switch><Route path="/" component={ParentDashboard} /><Route path="/parent/children/:studentId" component={ChildRoute} /><Route component={NotFound} /></Switch></div>;
}