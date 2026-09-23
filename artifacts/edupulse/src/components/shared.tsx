import { useLocation, Link } from 'wouter';
import { useState, type ReactNode, type FormEvent, createContext, useContext, useEffect, useRef } from 'react';
import { UserButton } from '@clerk/react';
import { 
  Activity, ArrowLeft, ArrowUpRight, BadgeCheck, BarChart3, Bell, BookOpen, Building2, Check, ChevronDown, 
  CircleAlert, CircleDollarSign, CreditCard, FileClock, GraduationCap, LayoutDashboard, Library, Menu, 
  MoreHorizontal, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Smartphone, 
  UserRound, UsersRound, WalletCards, X, Zap, Calendar, UserCog, ClipboardList, Briefcase, Handshake
} from 'lucide-react';
import {
  useGetAuthorizedContext, useListSchools, getListSchoolsQueryKey,
  useGetCurrentUserSchools, getGetCurrentUserSchoolsQueryKey,
  useListPlatformNotifications, getListPlatformNotificationsQueryKey
} from '@workspace/api-client-react';

export function cx(...parts: Array<string | false | undefined | null>) { 
  return parts.filter(Boolean).join(' '); 
}

export const money = (value = 0) => `₦${value.toLocaleString('en-NG')}`;
export const date = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const time = (value?: string | null) => value ? new Date(value).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }) : '—';

export function IconLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5" data-testid="brand-edupulse">
      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] shadow-[0_2px_10px_hsl(var(--accent)/.2)]">
        <Zap size={18} strokeWidth={2.6} />
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[hsl(var(--sidebar))] bg-[hsl(var(--primary))]" />
      </span>
      {!compact && <span className="display-font text-xl font-bold tracking-tight text-[hsl(var(--sidebar-foreground))]">Yemait EduCore</span>}
    </div>
  );
}

type AppRole = 'PLATFORM_OWNER' | 'SCHOOL_ADMIN' | 'TEACHER' | 'ACCOUNTANT' | 'PARENT' | 'STUDENT' | 'STAFF';
type NavItem = { href: string; label: string; icon: typeof Activity; roles?: AppRole[] };

const nav: NavItem[] = [
  { href: '/', label: 'Command centre', icon: LayoutDashboard },
  { href: '/schools', label: 'Schools', icon: Building2, roles: ['PLATFORM_OWNER'] },
  { href: '/students', label: 'Students', icon: GraduationCap, roles: ['PLATFORM_OWNER', 'SCHOOL_ADMIN', 'TEACHER', 'STAFF'] },
  { href: '/parents', label: 'Parents', icon: UsersRound, roles: ['PLATFORM_OWNER', 'SCHOOL_ADMIN'] },
  { href: '/employees', label: 'Employees', icon: Briefcase, roles: ['PLATFORM_OWNER', 'SCHOOL_ADMIN'] },
  { href: '/academics', label: 'Academics', icon: Calendar, roles: ['PLATFORM_OWNER', 'SCHOOL_ADMIN'] },
  { href: '/subjects', label: 'Subjects', icon: BookOpen, roles: ['PLATFORM_OWNER', 'SCHOOL_ADMIN', 'TEACHER'] },
  { href: '/classes', label: 'Classes', icon: Library, roles: ['PLATFORM_OWNER', 'SCHOOL_ADMIN', 'TEACHER', 'STAFF'] },
  { href: '/users', label: 'Users & Roles', icon: UserCog, roles: ['PLATFORM_OWNER', 'SCHOOL_ADMIN'] },
  { href: '/partners', label: 'Partners', icon: Handshake, roles: ['PLATFORM_OWNER'] },
  { href: '/devices', label: 'Devices', icon: Smartphone, roles: ['PLATFORM_OWNER'] },
  { href: '/subscriptions', label: 'Subscriptions', icon: WalletCards, roles: ['PLATFORM_OWNER', 'SCHOOL_ADMIN', 'ACCOUNTANT'] },
  { href: '/cards', label: 'NFC Cards', icon: CreditCard, roles: ['PLATFORM_OWNER', 'SCHOOL_ADMIN', 'STAFF'] },
  { href: '/audit', label: 'Audit Log', icon: FileClock, roles: ['PLATFORM_OWNER', 'SCHOOL_ADMIN'] },
];

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const { schoolId } = useTenant();
  const contextQuery = useGetAuthorizedContext();
  const context = contextQuery.data;
  
  if (contextQuery.isLoading) return <div className="min-h-[100dvh] bg-[hsl(var(--background))]" />;

  const roles = context?.roles?.map(r => r.role) || [];
  const isPlatformOwner = context?.isPlatformOwner || false;
  if (isPlatformOwner && !roles.includes('PLATFORM_OWNER')) roles.push('PLATFORM_OWNER');

  const visibleNav = nav.filter(item => !item.roles || item.roles.some(role => roles.includes(role)));
  const name = context?.user?.name ?? 'Yemait EduCore user';
  const roleDisplay = isPlatformOwner ? 'Platform Owner' : (roles[0]?.replaceAll('_', ' ') ?? 'User').toLowerCase();
  const initials = name.split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase();
  
  const userSchoolsQuery = useGetCurrentUserSchools({ query: { enabled: !isPlatformOwner && !!contextQuery.data, queryKey: getGetCurrentUserSchoolsQueryKey() } });
  const schoolsQuery = useListSchools({ status: 'active' as any }, { query: { enabled: isPlatformOwner, queryKey: getListSchoolsQueryKey({ status: 'active' as any }) } }); 
  
  let schoolName = 'Platform Network';
  if (schoolId) {
    if (isPlatformOwner) {
      schoolName = schoolsQuery.data?.find((s: any) => s.id === schoolId)?.name || 'Authorized School';
    } else {
      schoolName = userSchoolsQuery.data?.find((s: any) => s.schoolId === schoolId)?.name || 'Authorized School';
    }
  }

  const notificationsQuery = useListPlatformNotifications({ query: { enabled: isPlatformOwner, queryKey: getListPlatformNotificationsQueryKey() } });
  const hasUnread = notificationsQuery.data?.some((n: any) => !n.isRead) || false;

  return (
    <div className="app-shell min-h-[100dvh] text-[hsl(var(--foreground))]">
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[260px] -translate-x-full flex-col bg-[hsl(var(--sidebar))] p-5 transition-transform md:translate-x-0', open && 'translate-x-0')} data-testid="sidebar">
        <div className="mb-8 flex items-center justify-between px-2">
          <IconLogo />
          <button onClick={() => setOpen(false)} className="text-[hsl(var(--sidebar-foreground))] md:hidden" aria-label="Close navigation" data-testid="button-close-navigation"><X size={18} /></button>
        </div>
        <div className="mb-3 px-2 text-[11px] font-bold uppercase tracking-[.15em] text-[hsl(var(--sidebar-foreground)/.5)]">Workspace</div>
        <nav className="space-y-1 overflow-y-auto scrollbar-thin">
          {visibleNav.map(item => {
            const Icon = item.icon; 
            const active = item.href === '/' ? location === '/' : location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={cx('group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[hsl(var(--sidebar-foreground)/.7)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]', active && 'bg-[hsl(var(--sidebar-primary))] font-bold text-[hsl(var(--sidebar-primary-foreground))] hover:bg-[hsl(var(--sidebar-primary))]')} data-testid={`link-nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}>
                <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
                <span>{item.label}</span>
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-current" />}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto pt-5">
          <div className="rounded-2xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.4)] p-4">
            <div className="mb-2 flex items-center gap-2 text-[hsl(var(--sidebar-accent-foreground))]"><ShieldCheck size={16} /><span className="text-xs font-bold">Secure operations</span></div>
            <p className="text-xs leading-5 text-[hsl(var(--sidebar-foreground)/.6)]">Your actions are bound to your active tenant permissions.</p>
          </div>
          <Link href="/settings" className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[hsl(var(--sidebar-foreground)/.7)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]" data-testid="link-nav-settings">
            <Settings2 size={18} /> Settings
          </Link>
        </div>
      </aside>
      {open && <button className="fixed inset-0 z-30 bg-[hsl(var(--foreground)/.4)] backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} aria-label="Close menu" data-testid="button-dismiss-menu" />}
      <div className="md:pl-[260px] flex flex-col min-h-[100dvh]">
        <header className="sticky top-0 z-20 flex h-[76px] shrink-0 items-center justify-between border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--background)/.95)] px-5 backdrop-blur-xl md:px-8">
          <div className="flex items-center gap-4">
            <button className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] md:hidden" onClick={() => setOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={22} /></button>
            <div>
              <div className="eyebrow flex items-center gap-1.5">
                Yemait EduCore <ChevronDown size={12} className="opacity-50" /> {schoolName}
              </div>
              <div className="mt-0.5 text-sm font-bold text-[hsl(var(--foreground))] capitalize">
                {location === '/' ? `Welcome back, ${name.split(' ')[0]}` : nav.find(item => item.href !== '/' && location.startsWith(item.href))?.label || 'Overview'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isPlatformOwner ? (
              <Link href="/notifications">
                <button className="relative grid h-10 w-10 place-items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary)/.3)] hover:text-[hsl(var(--primary))]" aria-label="Notifications" data-testid="button-notifications">
                  <Bell size={18} />
                  {hasUnread && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full border-2 border-[hsl(var(--card))] bg-[hsl(var(--destructive))]" />}
                </button>
              </Link>
            ) : (
              <button className="relative grid h-10 w-10 place-items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary)/.3)] hover:text-[hsl(var(--primary))]" aria-label="Notifications" data-testid="button-notifications">
                <Bell size={18} />
              </button>
            )}
            <div className="hidden h-8 w-px bg-[hsl(var(--border))] sm:block" />
            <div className="hidden text-right sm:block">
              <div className="text-xs font-bold">{name}</div>
              <div className="text-[10px] capitalize text-[hsl(var(--muted-foreground))]">{roleDisplay}</div>
            </div>
            <div className="hidden h-10 w-10 place-items-center rounded-full bg-[hsl(var(--primary))] text-xs font-bold text-[hsl(var(--primary-foreground))] sm:grid shadow-sm" data-testid="avatar-user">{initials}</div>
            <UserButton />
          </div>
        </header>
        <main className="nav-grid flex-1 p-5 md:p-8">
          <div className="mx-auto max-w-[1440px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end fade-up">
      <div>
        <div className="eyebrow mb-2">{eyebrow}</div>
        <h1 className="display-font text-3xl font-bold text-[hsl(var(--foreground))] md:text-4xl" data-testid={`heading-${title.toLowerCase().replaceAll(' ', '-')}`}>{title}</h1>
        {description && <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', type = 'button', className, disabled, testId, title }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'outline' | 'quiet' | 'danger'; type?: 'button' | 'submit'; className?: string; disabled?: boolean; testId?: string; title?: string }) {
  return (
    <button 
      type={type} 
      onClick={onClick} 
      disabled={disabled} 
      title={title}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50', 
        variant === 'primary' && 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_4px_14px_hsl(var(--primary)/.25)] hover:-translate-y-0.5 hover:shadow-[0_6px_20px_hsl(var(--primary)/.3)]', 
        variant === 'outline' && 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)/.4)] hover:bg-[hsl(var(--primary)/.04)]', 
        variant === 'quiet' && 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]', 
        variant === 'danger' && 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.16)]', 
        className
      )} 
      data-testid={testId}
    >
      {children}
    </button>
  );
}

export function StatusPill({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const normalized = value.toLowerCase();
  const tone = ['active', 'verified', 'completed', 'admitted'].includes(normalized) ? 'bg-[hsl(157_37%_43%/.15)] text-[hsl(157_37%_30%)] dark:text-[hsl(157_37%_55%)]' : 
               ['pending', 'attention', 'unverified', 'unpaid'].includes(normalized) ? 'bg-[hsl(35_83%_53%/.15)] text-[hsl(28_73%_40%)] dark:text-[hsl(35_83%_55%)]' : 
               ['suspended', 'expired', 'failed', 'locked', 'lost', 'archived', 'rejected', 'withdrawn', 'terminated'].includes(normalized) ? 'bg-[hsl(var(--destructive)/.15)] text-[hsl(var(--destructive))]' : 
               'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]';
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider', tone)} data-testid={`status-${normalized}`}>{value}</span>;
}

export function Metric({ label, value, detail, icon: Icon, accent = false }: { label: string; value: string | number; detail?: string; icon: typeof Activity; accent?: boolean }) {
  return (
    <div className="panel fade-up relative overflow-hidden p-5 md:p-6 group">
      <div className="flex items-start justify-between">
        <div>
          <div className="eyebrow">{label}</div>
          <div className="display-font mt-3 text-3xl font-bold md:text-[34px] tracking-tight" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</div>
        </div>
        <div className={cx('grid h-11 w-11 place-items-center rounded-2xl transition-transform group-hover:scale-110', accent ? 'bg-[hsl(var(--accent)/.2)] text-[hsl(var(--primary))] dark:text-[hsl(var(--accent))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]')}>
          <Icon size={20} />
        </div>
      </div>
      {detail && <div className="mt-4 text-xs font-medium text-[hsl(var(--muted-foreground))]">{detail}</div>}
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-10 w-64 rounded-xl bg-[hsl(var(--muted))]" />
      <div className="grid gap-5 md:grid-cols-4">
        {[1, 2, 3, 4].map(item => <div key={item} className="h-36 rounded-2xl bg-[hsl(var(--muted))]" />)}
      </div>
      <div className="h-96 rounded-2xl bg-[hsl(var(--muted))]" />
    </div>
  );
}

export function ErrorState({ retry, message = "The operations feed took a wrong turn. Retry when your connection is ready." }: { retry: () => void, message?: string }) {
  return (
    <div className="panel flex min-h-[380px] flex-col items-center justify-center p-8 text-center fade-up">
      <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]">
        <CircleAlert size={26} />
      </div>
      <h2 className="display-font text-2xl font-bold">Couldn’t load this view</h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{message}</p>
      <Button onClick={retry} variant="outline" className="mt-6" testId="button-retry"><RefreshCw size={15} />Retry request</Button>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: typeof Activity; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center p-8 text-center fade-up">
      <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--primary)/.08)] text-[hsl(var(--primary))] dark:bg-[hsl(var(--accent)/.15)] dark:text-[hsl(var(--accent))]">
        <Icon size={26} />
      </div>
      <h3 className="display-font text-xl font-bold">{title}</h3>
      <p className="mt-2.5 max-w-md text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ActivityFeed({ items = [] as any[] }: { items?: any[] }) {
  return (
    <div className="divide-y divide-[hsl(var(--border)/.6)]">
      {items.length ? items.slice(0, 8).map((item, index) => (
        <div className="flex gap-4 py-3.5 first:pt-0 last:pb-0" key={item.id ?? index}>
          <div className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl', item.severity === 'critical' ? 'bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]' : 'bg-[hsl(var(--primary)/.08)] text-[hsl(var(--primary))] dark:bg-[hsl(var(--accent)/.15)] dark:text-[hsl(var(--accent))]')}>
            <Activity size={14} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
              <span className="truncate">{item.action}</span>
              {item.severity && <StatusPill value={item.severity} />}
            </div>
            <div className="mt-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]">
              {item.user} · {item.school || 'Platform'} · {date(item.timestamp)} {time(item.timestamp)}
            </div>
          </div>
        </div>
      )) : (
        <EmptyState icon={Activity} title="No recent movement" description="Activity will appear here as your team works across the workspace." />
      )}
    </div>
  );
}

export function Modal({ title, eyebrow, children, onClose }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void }) { 
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--foreground)/.25)] p-4 backdrop-blur-sm fade-up">
      <div className="panel max-h-[90dvh] w-full max-w-lg overflow-auto p-6 md:p-8 shadow-2xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
            <h2 className="display-font text-2xl font-bold">{title}</h2>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]" aria-label="Close dialog" data-testid="button-close-dialog">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  ); 
}

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) { 
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">{label}</span>
      {children}
      {error && <span className="mt-1.5 block text-xs font-medium text-[hsl(var(--destructive))]">{error}</span>}
    </label>
  ); 
}

export function Info({ label, value, className }: { label: string; value: ReactNode; className?: string }) { 
  return (
    <div className={cx("rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4", className)}>
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 text-sm font-bold leading-tight">{value || '—'}</div>
    </div>
  ); 
}

type TenantContextType = {
  schoolId: number;
  setSchoolId: (id: number) => void;
};

const TenantContext = createContext<TenantContextType>({ schoolId: 0, setSchoolId: () => {} });

export function TenantProvider({ children }: { children: ReactNode }) {
  const [schoolId, setSchoolId] = useState<number>(0);
  const initialized = useRef(false);
  
  const contextQuery = useGetAuthorizedContext();
  const isPlatformOwner = contextQuery.data?.isPlatformOwner;
  
  const userSchoolsQuery = useGetCurrentUserSchools({ query: { enabled: !isPlatformOwner && !!contextQuery.data, queryKey: getGetCurrentUserSchoolsQueryKey() } });
  
  useEffect(() => {
    if (initialized.current || contextQuery.isLoading) return;
    
    if (isPlatformOwner) {
      setSchoolId(0);
      initialized.current = true;
    } else if (userSchoolsQuery.data && userSchoolsQuery.data.length > 0) {
      setSchoolId(userSchoolsQuery.data[0].schoolId);
      initialized.current = true;
    }
  }, [contextQuery.isLoading, isPlatformOwner, userSchoolsQuery.data]);

  return <TenantContext.Provider value={{ schoolId, setSchoolId }}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  return useContext(TenantContext);
}

export function TenantPicker() {
  const { schoolId, setSchoolId } = useTenant();
  const contextQuery = useGetAuthorizedContext();
  const isPlatformOwner = contextQuery.data?.isPlatformOwner || false;
  
  const schoolsQuery = useListSchools({ status: 'active' as any }, { query: { enabled: isPlatformOwner, queryKey: getListSchoolsQueryKey({ status: 'active' as any }) } }); 
  const userSchoolsQuery = useGetCurrentUserSchools({ query: { enabled: !isPlatformOwner && !!contextQuery.data, queryKey: getGetCurrentUserSchoolsQueryKey() } });

  const authorizedSchools = isPlatformOwner 
    ? (schoolsQuery.data ?? []) 
    : (userSchoolsQuery.data ?? []).map((s: any) => ({ id: s.schoolId, name: s.name }));

  if (!isPlatformOwner && authorizedSchools.length <= 1) return null;

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2 shadow-sm">
      <Building2 size={16} className="text-[hsl(var(--primary))]" />
      <select 
        value={schoolId || ''} 
        onChange={e => setSchoolId(Number(e.target.value))} 
        className="max-w-[200px] border-0 bg-transparent p-0 text-sm font-bold outline-none ring-0 focus:ring-0" 
        data-testid="select-tenant-school"
      >
        {isPlatformOwner ? <option value="">Platform Network</option> : (!schoolId && <option value="">Select a school context</option>)}
        {authorizedSchools.map((school: any) => (
          <option key={school.id} value={school.id}>{school.name}</option>
        ))}
      </select>
    </div>
  );
}