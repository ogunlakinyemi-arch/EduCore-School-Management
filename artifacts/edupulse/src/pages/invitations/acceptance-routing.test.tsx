// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Route, Router, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signUpProps: null as null | Record<string, unknown>,
}));

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
  SignUp: (props: Record<string, unknown>) => {
    mocks.signUpProps = props;
    return <div data-testid="embedded-signup">Embedded signup</div>;
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  getGetAuthorizedContextQueryKey: () => ['/api/me/authorized-context'],
  useAcceptPartnerInvitation: () => ({ mutateAsync: vi.fn() }),
  useGetAuthorizedContext: () => ({ refetch: vi.fn() }),
}));

import InvitationAcceptance from './acceptance';

describe('mounted invitation route', () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
    window.history.replaceState({}, '', '/');
  });

  it('mounts the canonical Wouter route with embedded Clerk signup and retained fallback context', async () => {
    const ticket = 'clerk-ticket-not-for-display';
    const partnerToken = 'opaque-partner-token';
    window.history.replaceState(
      {},
      '',
      `/accept-invitation?__clerk_ticket=${ticket}&partnerInvitation=${partnerToken}`,
    );
    const location = memoryLocation({ path: '/accept-invitation' });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <Router hook={location.hook}>
          <Switch>
            <Route path="/accept-invitation"><InvitationAcceptance /></Route>
          </Switch>
        </Router>,
      );
    });

    expect(host.textContent).toContain('Accept your invitation');
    expect(host.querySelector('[data-testid="embedded-signup"]')).not.toBeNull();
    expect(mocks.signUpProps?.fallbackRedirectUrl).toBe(
      `/accept-invitation?__clerk_ticket=${ticket}&partnerInvitation=${partnerToken}`,
    );
    expect(host.textContent).not.toContain(ticket);
    expect(host.textContent).not.toContain(partnerToken);
  });
});