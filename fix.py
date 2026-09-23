import os
import glob
import re

# Update pages to useTenant
pages = glob.glob("artifacts/edupulse/src/pages/*.tsx")
for filepath in pages:
    with open(filepath, "r") as f:
        content = f.read()
    
    if "const [schoolId, setSchoolId] = useState<number>(0);" in content:
        content = content.replace("const [schoolId, setSchoolId] = useState<number>(0);", "const { schoolId, setSchoolId } = useTenant();")
        content = content.replace("<TenantPicker schoolId={schoolId} setSchoolId={setSchoolId} />", "<TenantPicker />")
        content = content.replace("TenantPicker, ", "TenantPicker, useTenant, ")
        
        with open(filepath, "w") as f:
            f.write(content)

# Fix dashboard.tsx
with open("artifacts/edupulse/src/pages/dashboard.tsx", "r") as f:
    dashboard = f.read()

dashboard = dashboard.replace("import { PageHeading, Metric", "import { PageHeading, Metric, useTenant")
dashboard = dashboard.replace("const schoolId = contextQuery.data?.roles?.[0]?.schoolId;", "const { schoolId } = useTenant();")
dashboard = re.sub(
    r"if \(isPlatformOwner\) \{",
    "if (isPlatformOwner && (!schoolId || schoolId === 0)) {",
    dashboard
)
dashboard = dashboard.replace("} else if (schoolId) {", "} else if (schoolId && schoolId !== 0) {")
with open("artifacts/edupulse/src/pages/dashboard.tsx", "w") as f:
    f.write(dashboard)

# Fix App.tsx
with open("artifacts/edupulse/src/App.tsx", "r") as f:
    app = f.read()

app = app.replace("import { ClerkProvider } from '@clerk/react';", "import { ClerkProvider, SignedIn, SignedOut, UserButton } from '@clerk/react';")
app = app.replace("import { Route, Switch, useLocation } from 'wouter';", "import { Route, Switch, useLocation, Redirect } from 'wouter';")
app = app.replace("import { Shell } from '@/components/shared';", "import { Shell, TenantProvider } from '@/components/shared';")

protected_routes_content = """function ProtectedRoutes() {
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
          <div className="mt-6">
            <UserButton />
          </div>
        </div>
      </div>
    );
  }
  
  const roles = context?.roles?.map(r => r.role) || [];
  const isOnlyParent = roles.length === 1 && roles[0] === 'PARENT';
  
  if (isOnlyParent) {
    return <ParentPortal />;
  }

  return (
    <TenantProvider>
      <Shell>
        <Switch>
          <Route path="/" component={Dashboard} />
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
}"""

app = re.sub(r"function ProtectedRoutes\(\) \{.*?\n\}", protected_routes_content, app, flags=re.DOTALL)

routing = """            <Switch>
              <Route path="/sign-in"><AuthScreen mode="sign-in" /></Route>
              <Route path="/sign-up"><AuthScreen mode="sign-up" /></Route>
              <Route>
                <SignedIn>
                  <Switch>
                    <Route path="/parent*"><ParentPortal /></Route>
                    <Route><ProtectedRoutes /></Route>
                  </Switch>
                </SignedIn>
                <SignedOut>
                  <Redirect to="/sign-in" />
                </SignedOut>
              </Route>
            </Switch>"""

app = re.sub(r"            <Switch>.*?            </Switch>", routing, app, flags=re.DOTALL)

with open("artifacts/edupulse/src/App.tsx", "w") as f:
    f.write(app)

