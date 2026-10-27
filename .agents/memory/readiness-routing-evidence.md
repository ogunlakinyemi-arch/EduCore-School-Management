---
name: Readiness routing evidence
description: Public readiness must be verified through the whole app, not only an isolated health router.
---

Verify anonymous health/readiness requests through the complete application's
middleware chain, including an authentication-denying downstream control.
An isolated router test cannot establish the route's public accessibility.

**Why:** A readiness handler and passing isolated tests coexisted with a
Production 401. Earlier device, identity or finance middleware can intercept a
request before the handler. Code-level test success is not deployed acceptance.

**How to apply:** Retain full-app anonymous readiness success/failure tests and
a protected neighboring-route denial. Treat any deployed build's observed
behavior separately; a corrected Development route does not certify Production.
