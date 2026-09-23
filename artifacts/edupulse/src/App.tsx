import { useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, useAuth } from '@clerk/react';
import { Route, Switch, Redirect } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useGetAuthorizedContext } from '@workspace/api-client-react';

// Layout & Shared
import { Shell, TenantProvider } from '@/components/shared';

// Pages
import NotFound from '@/pages/not-found';
import { AuthScreen } from '@/pages/auth-screen';
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
import { AcademicsPage } from '@/pages/academics';
import { SubjectsPage } from '@/pages/subjects';
import { AssignmentsPage } from '@/pages/assignments';
import { ClassesPage } from '@/pages/classes';
import { UsersPage } from '@/pages/users';
import { SubscriptionsPage } from '@/pages/subscriptions';
import { CardsPage } from '@/pages/cards';
import { AuditPage } from '@/pages/audit';
import { SettingsPage } from '@/pages/settings';

import './index.css';

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const contextQuery = useGetAuthorizedContext();
  const context = contextQuery.data;

  if (contextQuery.isLoading) return <div className="min-h-[100dvh] bg-[hsl(var(--background))]" />;

  if (contextQuery.isError || (!context?.isPlatformOwner && (!context?.roles || context.roles.length === 0))) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-8 text-center bg-[hsl(var(--background))]">
        <div className="panel p-8 max-w-md">
          <h1 className="text-xl font-bold">Access Pending</h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Your account has not been assigned any roles yet. Please contact your administrator.
          </p>
        </div>
      </div>
    );
  }

  const roles = context?.roles?.map(r => r.role) || [];
  const isOnlyParent = roles.length === 1 && roles[0] === 'PARENT';
  const isOnlyPartner = roles.length === 1 && roles[0] === 'PARTNER';

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
          <Route path="/partners*" component={PartnerManagement} />
          <Route path="/schools" component={SchoolsPage} />
          <Route path="/schools/:id" component={SchoolOverview} />
          <Route path="/students" component={StudentsPage} />
          <Route path="/parents" component={ParentsPage} />
          <Route path="/employees" component={EmployeesPage} />
          <Route path="/academics" component={AcademicsPage} />
          <Route path="/subjects" component={SubjectsPage} />
          <Route path="/assignments" component={AssignmentsPage} />
          <Route path="/classes" component={ClassesPage} />
          <Route path="/users" component={UsersPage} />
          <Route path="/subscriptions" component={SubscriptionsPage} />
          <Route path="/cards" component={CardsPage} />
          <Route path="/audit" component={AuditPage} />
          <Route path="/settings" component={SettingsPage} />

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
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-8 text-center font-sans">
        <div>
          <h1 className="text-xl font-bold">Missing Clerk Configuration</h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Add <code>VITE_CLERK_PUBLISHABLE_KEY</code> to your environment variables.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <ClerkProvider publishableKey={publishableKey} signInFallbackRedirectUrl={base || '/'} signUpFallbackRedirectUrl={base || '/'}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Switch>
              <Route path="/sign-in"><AuthScreen mode="sign-in" /></Route>
              <Route path="/sign-up"><AuthScreen mode="sign-up" /></Route>
              <Route path="/school/register"><RegisterSchool /></Route>
              <Route>
                <AuthGuard>
                  <Switch>
                    <Route path="/partner/invitations/:invitationId"><AcceptInvitation /></Route>
                    <Route path="/parent*"><ParentPortal /></Route>
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