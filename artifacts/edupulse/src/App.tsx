import { ClerkProvider, useAuth } from '@clerk/react';
import SchoolSecurityPage from './pages/security';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { Route, Switch, Redirect, Link } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useGetAuthorizedContext } from '@workspace/api-client-react';
import { ShieldAlert } from 'lucide-react';

// Layout & Shared
import { Shell, TenantProvider, Button } from '@/components/shared';
import { AuthQueryProvider } from '@/components/auth-query-provider';

// Pages
import NotFound from '@/pages/not-found';
import { AuthScreen } from '@/pages/auth-screen';
import InvitationAcceptance from '@/pages/invitations/acceptance';
import { PlatformOwnerSetup } from '@/pages/setup/platform-owner';
import ParentPortal from '@/pages/parent-portal';
import PartnerPortal from '@/pages/partner/portal';
import PartnerManagement from '@/pages/partner/management';
import RegisterSchool from '@/pages/partner/register-school';
import { Dashboard } from '@/pages/dashboard';
import { SchoolsPage, SchoolOverview } from '@/pages/schools';
import { StudentsPage } from '@/pages/students';
import { ParentsPage } from '@/pages/parents';
import { EmployeesPage } from '@/pages/employees';
import { PlatformCompanyEmployeesPage } from '@/pages/platform-company-employees';
import { CompanyAccountantPage } from '@/pages/company-accountant';
import { AcademicsPage } from '@/pages/academics';
import { SubjectsPage } from '@/pages/subjects';
import { AcademicWorkPage } from '@/pages/academic-work';
import { CurriculumManagementPage } from '@/pages/curriculum-management';
import { SchoolCurriculumPage } from '@/pages/school-curriculum';
import { LessonNotesPage } from '@/pages/lesson-notes';
import { ResultsPage } from '@/pages/results';
import { TimetablePage } from '@/pages/timetable';
import { MyAcademicsPage } from '@/pages/my-academics';
import { ClassesPage } from '@/pages/classes';
import { UsersPage } from '@/pages/users';
import { PeopleImportsPage } from '@/pages/people-imports';
import { SubscriptionsPage } from '@/pages/subscriptions';
import { CardsPage } from '@/pages/cards';
import { SchoolBrandingPage } from '@/pages/school-branding';
import { AcademicCalendarPage } from '@/pages/academic-calendar';
import { TeacherAssignmentsPage } from '@/pages/teacher-assignments';
import { TeacherDutyPage } from '@/pages/teacher-duty';
import { AdmissionsPage, PublicAdmissionPortalPage } from '@/pages/admissions';
import { StudentCarePage, BehaviourPage, FamilyCarePage } from '@/pages/student-care';
import { PromotionPage } from '@/pages/promotion';
import TransportPage from '@/pages/transport';
import FamilyTransportPage from '@/pages/family-transport';
import { EmployeeNfcPage, MyEmployeeNfcPage } from '@/pages/employee-nfc';
import { MyStaffNfcSubscriptionPage, StaffNfcFinancePage, StaffNfcBillingRulesPage, PartnerStaffNfcCommissionsPage } from '@/pages/staff-nfc-billing';
import { PaymentSettlementPage } from '@/pages/payment-settlement';
import { PayrollPage } from '@/pages/payroll';
import { MyPayslipsPage } from '@/pages/my-payslips';
import { FinanceWorkspacePage } from '@/pages/finance-workspace';
import { AuditPage } from '@/pages/audit';
import { SettingsPage } from '@/pages/settings';
import { DevicesPage } from '@/pages/devices';
import { NotificationsPage } from '@/pages/notifications';
import { AttendancePage } from '@/pages/attendance';
import { FinancePage, MyFeesPage } from '@/pages/finance';
import { CommunicationsPage } from '@/pages/communications';
import { CommunicationInbox } from '@/pages/communication-inbox';
import { NotificationSettings } from '@/pages/notification-settings';
import { LibraryPage } from '@/pages/library';
import { OperationsPage } from '@/pages/operations';
import { ReportingPage } from '@/pages/reporting';
import { ActivationHistoryPage, EidActivationPage } from '@/pages/e-id-activation';

import './index.css';

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
  const isActivationOfficer = context.roles?.some(
    role => (role.role as string) === 'DEVICE_ACTIVATION_OFFICER' && role.status === 'ACTIVE',
  ) === true;
  const isCompanyAccountant = context.roles?.some(
    role => (role.role as string) === 'COMPANY_ACCOUNTANT' && role.status === 'ACTIVE',
  ) === true;

  if (isActivationOfficer) {
    return (
      <Shell>
        <Switch>
          <Route path="/activation/history" component={ActivationHistoryPage} />
          <Route path="/activation" component={EidActivationPage} />
          <Route><Redirect to="/activation" /></Route>
        </Switch>
      </Shell>
    );
  }

  if (isCompanyAccountant) {
    return (
      <Shell>
        <Switch>
          <Route path="/company-finance" component={CompanyAccountantPage} />
          <Route><Redirect to="/company-finance" /></Route>
        </Switch>
      </Shell>
    );
  }

  if (isOnlyParent) {
    return <TenantProvider><Switch>
      <Route path="/my-care"><Shell><FamilyCarePage /></Shell></Route>
      <Route path="/my-transport"><Shell><FamilyTransportPage /></Shell></Route>
      <Route path="/academic-calendar"><Shell><AcademicCalendarPage /></Shell></Route>
      <Route path="/parent/communication"><ParentPortal /></Route>
      <Route><ParentPortal /></Route>
    </Switch></TenantProvider>;
  }

  if (isOnlyPartner) {
    return <TenantProvider><Switch>
      <Route path="/partner/staff-nfc"><Shell><PartnerStaffNfcCommissionsPage /></Shell></Route>
      <Route><PartnerPortal /></Route>
    </Switch></TenantProvider>;
  }

  return (
    <TenantProvider>
      <Shell>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/dashboard"><Redirect to="/" /></Route>
          <Route path="/security"><RoleGuard allowedRoles={['SCHOOL_ADMIN', 'STAFF', 'TEACHER']} ownerCanView ownerReadOnly><SchoolSecurityPage /></RoleGuard></Route>
          <Route path="/admissions"><RoleGuard allowedRoles={['SCHOOL_ADMIN']}><AdmissionsPage /></RoleGuard></Route>
          <Route path="/student-care"><RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER', 'STAFF']}><StudentCarePage /></RoleGuard></Route>
          <Route path="/behaviour"><RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER', 'STAFF']}><BehaviourPage /></RoleGuard></Route>
          <Route path="/promotion"><RoleGuard allowedRoles={['SCHOOL_ADMIN']}><PromotionPage /></RoleGuard></Route>
          <Route path="/my-care"><RoleGuard allowedRoles={['PARENT', 'STUDENT']}><FamilyCarePage /></RoleGuard></Route>
          <Route path="/school-branding"><RoleGuard allowedRoles={['SCHOOL_ADMIN']}><SchoolBrandingPage /></RoleGuard></Route>
          <Route path="/academic-calendar"><RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER', 'STAFF', 'PARENT', 'STUDENT']} ownerCanView ownerReadOnly><AcademicCalendarPage /></RoleGuard></Route>
          <Route path="/teacher-assignments"><RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER']}><TeacherAssignmentsPage /></RoleGuard></Route>
          <Route path="/teacher-duty"><RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER']}><TeacherDutyPage /></RoleGuard></Route>
          <Route path="/curriculum-management"><RoleGuard isPlatformOwnerOnly><CurriculumManagementPage /></RoleGuard></Route>
          <Route path="/curriculum"><RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER']}><SchoolCurriculumPage /></RoleGuard></Route>
          <Route path="/lesson-notes"><RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER']}><LessonNotesPage /></RoleGuard></Route>
          <Route path="/transport"><RoleGuard allowedRoles={['SCHOOL_ADMIN']} ownerCanView><TransportPage /></RoleGuard></Route>
          <Route path="/my-transport"><RoleGuard allowedRoles={['PARENT', 'STUDENT']}><FamilyTransportPage /></RoleGuard></Route>
          <Route path="/employee-nfc"><RoleGuard allowedRoles={['SCHOOL_ADMIN']} ownerCanView><EmployeeNfcPage /></RoleGuard></Route>
          <Route path="/my-employee-nfc"><RoleGuard allowedRoles={['TEACHER', 'STAFF']}><MyEmployeeNfcPage /></RoleGuard></Route>
          <Route path="/my-nfc-subscription"><RoleGuard allowedRoles={['TEACHER', 'STAFF']}><MyStaffNfcSubscriptionPage /></RoleGuard></Route>
          <Route path="/staff-nfc-finance"><RoleGuard allowedRoles={['SCHOOL_ADMIN', 'ACCOUNTANT']} ownerCanView><StaffNfcFinancePage /></RoleGuard></Route>
          <Route path="/billing-rules"><RoleGuard isPlatformOwnerOnly><StaffNfcBillingRulesPage /></RoleGuard></Route>
          <Route path="/payment-settlement"><RoleGuard allowedRoles={['SCHOOL_ADMIN']} ownerCanView><PaymentSettlementPage /></RoleGuard></Route>
          <Route path="/payroll"><RoleGuard allowedRoles={['SCHOOL_ADMIN']} ownerCanView><PayrollPage /></RoleGuard></Route>
          <Route path="/my-payslips"><RoleGuard allowedRoles={['TEACHER', 'STAFF']}><MyPayslipsPage /></RoleGuard></Route>
          <Route path="/finance-workspace"><RoleGuard allowedRoles={['SCHOOL_ADMIN', 'ACCOUNTANT']} ownerCanView><FinanceWorkspacePage /></RoleGuard></Route>
          <Route path="/partners">
            <RoleGuard isPlatformOwnerOnly><PartnerManagement /></RoleGuard>
          </Route>
          <Route path="/partners/*">
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
          <Route path="/reporting">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT', 'STUDENT', 'PARENT', 'PARTNER']} ownerCanView><ReportingPage /></RoleGuard>
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
          <Route path="/communications">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT']}><CommunicationsPage /></RoleGuard>
          </Route>
          <Route path="/inbox"><CommunicationInbox /></Route>
          <Route path="/notification-settings"><NotificationSettings /></Route>
          <Route path="/classes">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER', 'STAFF']} ownerCanView ownerReadOnly><ClassesPage /></RoleGuard>
          </Route>
          <Route path="/attendance">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER', 'STAFF']} ownerCanView ownerReadOnly><AttendancePage /></RoleGuard>
          </Route>
          <Route path="/library">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER', 'STAFF', 'STUDENT']}><LibraryPage /></RoleGuard>
          </Route>
          <Route path="/library/loans">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'TEACHER', 'STAFF', 'STUDENT']}><LibraryPage initialArea="loans" /></RoleGuard>
          </Route>
          <Route path="/operations">
            <RoleGuard allowedRoles={['SCHOOL_ADMIN', 'STAFF']}><OperationsPage /></RoleGuard>
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
          <Route path="/activation">
            <RoleGuard allowedRoles={['DEVICE_ACTIVATION_OFFICER']} ownerCanView><EidActivationPage /></RoleGuard>
          </Route>
          <Route path="/activation/history">
            <RoleGuard allowedRoles={['DEVICE_ACTIVATION_OFFICER']} ownerCanView><ActivationHistoryPage /></RoleGuard>
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
  const contextQuery = useGetAuthorizedContext();
  if (!isLoaded) return <div className="min-h-[100dvh] bg-[hsl(var(--background))]" />;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if (contextQuery.isLoading) return <div className="min-h-[100dvh] bg-[hsl(var(--background))]" />;
  const isActivationOfficer = contextQuery.data?.roles?.some(
    role => (role.role as string) === 'DEVICE_ACTIVATION_OFFICER' && role.status === 'ACTIVE',
  ) === true;
  const isCompanyAccountant = contextQuery.data?.roles?.some(
    role => (role.role as string) === 'COMPANY_ACCOUNTANT' && role.status === 'ACTIVE',
  ) === true;
  if (isActivationOfficer || isCompanyAccountant) return <ProtectedRoutes />;
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
        <AuthQueryProvider>
          <TooltipProvider>
            <Switch>
              <Route path="/admissions/portal/:portalKey"><PublicAdmissionPortalPage /></Route>
              <Route path="/setup/platform-owner"><PlatformOwnerSetup /></Route>
              <Route path="/sign-in/*?"><AuthScreen mode="sign-in" /></Route>
              <Route path="/sign-up/*?"><AuthScreen mode="sign-up" /></Route>
              <Route path="/accept-invitation"><InvitationAcceptance /></Route>
              <Route path="/partner/accept-invitation"><InvitationAcceptance /></Route>
              <Route path="/partner/invitations/:invitationToken/accept"><InvitationAcceptance /></Route>
              <Route path="/school/register"><RegisterSchool /></Route>
              <Route>
                <AuthGuard>
                  <Switch>
                     <Route path="/parent*"><RoleGuard allowedRoles={['PARENT']}><ParentPortal /></RoleGuard></Route>
                    <Route path="/partner/staff-nfc"><RoleGuard allowedRoles={['PARTNER']}><TenantProvider><Shell><PartnerStaffNfcCommissionsPage /></Shell></TenantProvider></RoleGuard></Route>
                    <Route path="/partner*"><PartnerPortal /></Route>
                    <Route><ProtectedRoutes /></Route>
                  </Switch>
                </AuthGuard>
              </Route>
            </Switch>
            <Toaster />
          </TooltipProvider>
        </AuthQueryProvider>
      </ClerkProvider>
    </ErrorBoundary>
  );
}
