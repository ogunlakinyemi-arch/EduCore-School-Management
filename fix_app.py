import re

with open("artifacts/edupulse/src/App.tsx", "r") as f:
    app = f.read()

app = app.replace(
    "import { ClerkProvider, SignedIn, SignedOut, UserButton } from '@clerk/react';",
    "import { ClerkProvider, useAuth, UserButton } from '@clerk/react';"
)

guard = """function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return <div className="min-h-[100dvh] bg-[hsl(var(--background))]" />;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <>{children}</>;
}

function ProtectedRoutes() {"""

app = app.replace("function ProtectedRoutes() {", guard)

routing = """            <Switch>
              <Route path="/sign-in"><AuthScreen mode="sign-in" /></Route>
              <Route path="/sign-up"><AuthScreen mode="sign-up" /></Route>
              <Route>
                <AuthGuard>
                  <Switch>
                    <Route path="/parent*"><ParentPortal /></Route>
                    <Route><ProtectedRoutes /></Route>
                  </Switch>
                </AuthGuard>
              </Route>
            </Switch>"""

app = re.sub(r"            <Switch>.*?            </Switch>", routing, app, flags=re.DOTALL)

with open("artifacts/edupulse/src/App.tsx", "w") as f:
    f.write(app)
