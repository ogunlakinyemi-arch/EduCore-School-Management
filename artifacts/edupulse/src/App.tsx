import { useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { Route, Switch, Redirect, Link } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useGetAuthorizedContext } from '@workspace/api-client-react';
import { ShieldAlert } from 'lucide-react';

// Layout & Shared
import { Shell, TenantProvider, Button } from '@/components/shared';

// Pages
import NotFound from '@/pages/not-found';
import { AuthScreen } from '@/pages/auth-screen';
import { PlatformOwnerSetup } from '@/pages/setup/platform-owner';
import ParentPortal from '@/pages/parent-portal';
import PartnerPortal from '@/pages/partner/portal';
import PartnerManagement from '@/pages/partner/management';
import RegisterSchool from '@/pages/partner/register-school';
import AcceptInvitation from '@/pages/partner/accept-invitation';
import { Dashboard } from '@/pages/dashboard';
import { SchoolsPage, SchoolOverview } from '@/pages/schools';
import { StudentsPage } from '@/pages/students';
import { ParentsPage } from '@/pages/parents';
import { EmployeesPage } from '@/pages/employees';
import { PlatformCompanyEmployeesPage } from '@/pages/platform-company-employees';
import { AcademicsPage } from '@/pages/academics';
import { SubjectsPage } from '@/pages/subjects';
import { AcademicWorkPage } from '@/pages/academic-work';
import { ResultsPage } from '@/pages/results';
import { TimetablePage } from '@/pages/timetable';
import { MyAcademicsPage } from '@/pages/my-academics';
import { ClassesPage } from '@/pages/classes';
import { UsersPage } from '@/pages/users';
import { PeopleImportsPage } from '@/pages/people-imports';
import { SubscriptionsPage } from '@/pages/subscriptions';
import { CardsPage } from '@/pages/cards';
import { AuditPage } from '@/pages/audit';
import { SettingsPage } from '@/pages/settings';
import { DevicesPage } from '@/pages/devices';
import { NotificationsPage } from '@/pages/notifications';
import { AttendancePage } from '@/pages/attendance';
import { FinancePage, MyFeesPage } from '@/pages/finance';

import './index.css';

const queryClient = new QueryClient();

function AccessDenied() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-8 text-center bg-[hsl(var(--background))]">
      <div className="panel flex flex-col items-center justify-center p-10 max-w-md w-full border-[hsl(var(--destructive)/.2)] shadow-xl fade-up">
        <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]">
          <ShieldAlert size={32} />
        </div>
        <h1 className="display-font text-2xl font-bold">Access Denied</h1>
        <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
          You don't have the required permissions to view this module. Ensure your role grants access to this area.
        </p>
        <Link href="/">
          <Button className="mt-8">Return to Dashboard</Button>
        </Link>
      </div>
    </div>
  );
}

function RoleGuard({
  allowedRoles,
  isPlatformOwnerOnly,
  ownerCanView,
  ownerReadOnly,
  children
}: {
  allowedRoles?: string[],
  isPlatformOwnerOnly?: boolean,
  ownerCanView?: boolean,
  ownerReadOnly?: boolean,
  children: React.ReactNode
}) {
  const contextQuery = useGetAuthorizedContext();
  const context = contextQuery.data;
  if (contextQuery.isLoading) return <div className="min-h-[100dvh] bg-[hsl(var(--background))]" />;
  if (!context) return <AccessDenied />;

  const isPlatformOwner = context.isPlatformOwner || false;

  if (isPlatformOwnerOnly && !isPlatformOwner) {
    return <AccessDenied />;
  }
  if (isPlatformOwner && ownerCanView) {
    return (
      <>
        {ownerReadOnly && (
          <div className="mx-5 mt-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-sm md:mx-8" role="status" data-testid="owner-read-only-notice">
            Platform Owner view only. School Admins manage day-to-day school operations.
          </div>
        )}
        {children}
      </>
    );
  }
  if (isPlatformOwner && !isPlatformOwnerOnly) return <AccessDenied />;
  if (allowedRoles && allowedRoles.length > 0) {
    const roles = context.roles?.filter(r => r.status === 'ACTIVE').map(r => r.role as string) || [];
    const hasAccess = allowedRoles.some(role => roles.includes(role));
    if (!hasAccess) return <AccessDenied />;
  }

  return <>{children}</>;
}

function ProtectedRoutes() {
  const contextQuery = useGetAuthorizedContext();
  const context = contextQuery.data;

  if (contextQuery.isLoading) return <div className="min-h-[100dvh] bg-[hsl(var(--background))]" />;

  if (contextQuery.isError || (!context?.isPlatformOwner && (!context?.roles || context.roles.length === 0))) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-8 text-center bg-[hsl(var(--background))]">
        <div className="panel p-8 max-w-md shadow-xl fade-up">
          <h1 className="display-font text-2xl font-bold">Access Pending</h1>
          <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
            Your account has not been assigned any roles yet. Please contact your administrator.
          </p>
        </div>
      </div>
    );
  }

  const roles = context?.roles?.map(r => r.role) || [];
  const requestedPortal = window.sessionStorage.getItem('edupulse:selected-portal');
  if (requestedPortal && !(requestedPortal === 'PLATFORM_OWNER' ? context.isPlatformOwner : roles.includes(requestedPortal as typeof roles[number]))) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-8">
        <div className="panel max-w-md p-8 text-center">
          <h1 className="display-font text-2xl font-bold">Portal not available</h1>
          <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
            Your verified account does not have access to the selected portal. Choosing an account type cannot change your permissions.
          </p>
          <button
            type="button"
            className="mt-6 rounded-xl bg-[hsl(var(--primary))] px-5 py-2 text-sm font-bold text-[hsl(var(--primary-foreground))]"
            onClick={() => {
              window.sessionStorage.removeItem('edupulse:selected-portal');
              window.location.reload();
            }}
          >
            Open my authorized portal
          </button>
        </div>
      </div>
    );
  }
  const isOnlyParent = !context.isPlatformOwner && roles.includes('PARENT') && (roles.length === 1 || requestedPortal === 'PARENT');
  const isOnlyPartner = !context.isPlatformOwner && roles.includes('PARTNER') && (roles.length === 1 || requestedPortal === 'PARTNER');

  if (isOnlyParent) {
    return <ParentPortal />;
  }

  if (isOnlyPartner) {
    return <PartnerPortal />;
  }

  return (
    <TenantProvider>
      <Shell>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/partners*">
            <RoleGuard isPlatformOwnerOnly><PartnerManagement /></RoleGuard>
          </Route>
          <Route path="/schools">
            <RoleGuard isPlatformOwnerOnly><SchoolsPage /></RoleGuard>
          </Route>
          <Route path="/schools/:id">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN']} ownerCanView><SchoolOverview /></RoleGuard>
          </Route>
          <Route path="/company-employees">
            <RoleGuard isPlatformOwnerOnly><PlatformCompanyEmployeesPage /></RoleGuard>
          </Route>
          <Route path="/users">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN']} ownerCanView><UsersPage /></RoleGuard>
          </Route>
          <Route path="/people/imports">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN']}><PeopleImportsPage /></RoleGuard>
          </Route>
          <Route path="/audit">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN']} ownerCanView><AuditPage /></RoleGuard>
          </Route>
          <Route path="/students">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER', 'STAFF']} ownerCanView ownerReadOnly><StudentsPage /></RoleGuard>
          </Route>
          <Route path="/parents">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN']} ownerCanView ownerReadOnly><ParentsPage /></RoleGuard>
          </Route>
          <Route path="/employees">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN']}><EmployeesPage /></RoleGuard>
          </Route>
          <Route path="/academics">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN']} ownerCanView ownerReadOnly><AcademicsPage /></RoleGuard>
          </Route>
          <Route path="/subjects">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER']} ownerCanView ownerReadOnly><SubjectsPage /></RoleGuard>
          </Route>
          <Route path="/academic-work">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER']} ownerCanView ownerReadOnly><AcademicWorkPage /></RoleGuard>
          </Route>
          <Route path="/results">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER']} ownerCanView ownerReadOnly><ResultsPage /></RoleGuard>
          </Route>
          <Route path="/timetable">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER', 'STUDENT']} ownerCanView ownerReadOnly><TimetablePage /></RoleGuard>
          </Route>
          <Route path="/my-academics">
            <RoleGuard allowedRoles={['STUDENT']}><MyAcademicsPage /></RoleGuard>
          </Route>
          <Route path="/my-fees">
            <RoleGuard allowedRoles={['STUDENT']}><MyFeesPage /></RoleGuard>
          </Route>
          <Route path="/finance">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'ACCOUNTANT']}><FinancePage /></RoleGuard>
          </Route>
          <Route path="/classes">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER', 'STAFF']} ownerCanView ownerReadOnly><ClassesPage /></RoleGuard>
          </Route>
          <Route path="/attendance">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER', 'STAFF']} ownerCanView ownerReadOnly><AttendancePage /></RoleGuard>
          </Route>
          <Route path="/devices">
            <RoleGuard isPlatformOwnerOnly><DevicesPage /></RoleGuard>
          </Route>
          <Route path="/notifications">
            <RoleGuard isPlatformOwnerOnly><NotificationsPage /></RoleGuard>
          </Route>
          <Route path="/subscriptions">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'ACCOUNTANT']} ownerCanView ownerReadOnly><SubscriptionsPage /></RoleGuard>
          </Route>
          <Route path="/cards">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'STAFF']} ownerCanView><CardsPage /></RoleGuard>
          </Route>
          <Route path="/settings">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN']} ownerCanView><SettingsPage /></RoleGuard>
          </Route>

          <Route path="/parent/children/:studentId" component={ParentPortal} />

          <Route component={NotFound} />
        </Switch>
      </Shell>
    </TenantProvider>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return <div className="min-h-[100dvh] bg-[hsl(var(--background))]" />;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <>{children}</>;
}

export default function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const publishableKey = publishableKeyFromHost(
    window.location.hostname,
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
  );
  const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

  if (!publishableKey) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-8 text-center font-sans bg-[hsl(var(--background))]">
        <div className="panel p-8 max-w-md shadow-xl fade-up">
          <h1 className="display-font text-2xl font-bold">Missing Clerk Configuration</h1>
          <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
            Add <code>VITE_CLERK_PUBLISHABLE_KEY</code> to your environment variables to enable authentication.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <ClerkProvider
        publishableKey={publishableKey}
        proxyUrl={clerkProxyUrl}
        signInFallbackRedirectUrl={base || '/'}
        signUpFallbackRedirectUrl={base || '/'}
        localization={{
          signIn: {
            start: {
              title: 'Sign in to Yemait EduCore',
              subtitle: 'Welcome back. Sign in to continue.',
            },
          },
          signUp: {
            start: {
              title: 'Create your Yemait EduCore account',
              subtitle: 'Join your school community.',
            },
          },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Switch>
              <Route path="/setup/platform-owner"><PlatformOwnerSetup /></Route>
              <Route path="/sign-in/*?"><AuthScreen mode="sign-in" /></Route>
              <Route path="/sign-up"><AuthScreen mode="sign-up" /></Route>
              <Route path="/school/register"><RegisterSchool /></Route>
              <Route>
                <AuthGuard>
                  <Switch>
                    <Route path="/partner/invitations/:invitationToken/accept"><AcceptInvitation /></Route>
                     <Route path="/parent*"><RoleGuard allowedRoles={['PARENT']}><ParentPortal /></RoleGuard></Route>
                    <Route path="/partner*"><PartnerPortal /></Route>
                    <Route><ProtectedRoutes /></Route>
                  </Switch>
                </AuthGuard>
              </Route>
            </Switch>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ClerkProvider>
    </ErrorBoundary>
  );
}
