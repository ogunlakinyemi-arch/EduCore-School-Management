import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { matchRoute, useRouter } from 'wouter';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const managementSource = readFileSync(new URL('./pages/partner/management.tsx', import.meta.url), 'utf8');
const portalSource = readFileSync(new URL('./pages/partner/portal.tsx', import.meta.url), 'utf8');

let parser: Parameters<typeof matchRoute>[0];
function CaptureRouterParser() {
  parser = useRouter().parser;
  return null;
}
renderToStaticMarkup(<CaptureRouterParser />);

const ownerRoutes = [...appSource.matchAll(/<Route path="(\/partners[^"]*)">\s*<RoleGuard isPlatformOwnerOnly><PartnerManagement \/><\/RoleGuard>/g)]
  .map((match) => match[1]);
const managementRoutes = [...managementSource.matchAll(/<Route path="(\/partners[^"]*)" component=\{(\w+)\}/g)]
  .map((match) => ({ path: match[1], component: match[2] }));

function resolvedOwnerPage(path: string) {
  if (!ownerRoutes.some((route) => matchRoute(parser, route, path)[0])) return null;
  return managementRoutes.find((route) => matchRoute(parser, route.path, path)[0])?.component ?? null;
}

describe('dashboard route compatibility', () => {
  it('redirects the legacy /dashboard path to the platform dashboard route', () => {
    expect(appSource).toContain('<Route path="/dashboard"><Redirect to="/" /></Route>');
  });
});

describe('Platform Owner partner routes', () => {
  it('reaches the existing payout overview instead of the 404 fallback', () => {
    expect(managementSource).toContain('function PayoutsOverview()');
    expect(managementSource).toContain('<Link href="/partners/payouts">');
    expect(resolvedOwnerPage('/partners/payouts')).toBe('PayoutsOverview');
  });

  it('preserves the Partners overview and other Owner partner pages', () => {
    expect(resolvedOwnerPage('/partners')).toBe('PartnersOverview');
    expect(resolvedOwnerPage('/partners/conflicts')).toBe('AttributionConflicts');
    expect(ownerRoutes.some((route) => matchRoute(parser, route, '/partners/12')[0])).toBe(true);
    expect(managementSource).toContain('<Route path="/partners/:id">');
  });

  it('keeps Partner self-service payouts outside the Owner route', () => {
    expect(resolvedOwnerPage('/partner/payouts')).toBeNull();
    expect(appSource).toContain('<Route path="/partner*"><PartnerPortal /></Route>');
    expect(portalSource).toContain('<Route path="/partner/payouts" component={MyPayouts} />');
  });
});