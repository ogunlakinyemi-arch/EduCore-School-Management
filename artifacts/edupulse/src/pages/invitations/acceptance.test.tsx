// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  destinationForAuthorizedContext,
  destinationForNewlyActivatedRole,
  invitationReturnUrl,
  readInvitationContext,
  consumeInvitationAuthFlow,
  setInvitationAuthFlow,
} from './acceptance-context';

const mocks = vi.hoisted(() => ({
  auth: { isLoaded: true, isSignedIn: false },
  legacyMatch: false,
  legacyToken: undefined as string | undefined,
  partnerAliasMatch: false,
  setLocation: vi.fn(),
  mutateAsync: vi.fn(),
  refetch: vi.fn(),
  signUpProps: null as null | Record<string, unknown>,
}));

vi.mock('wouter', () => ({
  useRoute: (path: string) => {
    if (path === '/partner/invitations/:invitationToken/accept') {
      return [mocks.legacyMatch, { invitationToken: mocks.legacyToken }];
    }
    if (path === '/partner/accept-invitation') return [mocks.partnerAliasMatch, {}];
    return [false, {}];
  },
  useLocation: () => ['/', mocks.setLocation],
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@clerk/react', () => ({
  useAuth: () => mocks.auth,
  SignUp: (props: Record<string, unknown>) => {
    mocks.signUpProps = props;
    return <div data-testid="clerk-sign-up">Secure account form</div>;
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  getGetAuthorizedContextQueryKey: () => ['/api/me/authorized-context'],
  useAcceptPartnerInvitation: () => ({ mutateAsync: mocks.mutateAsync }),
  useGetAuthorizedContext: () => ({ refetch: mocks.refetch }),
}));

import InvitationAcceptance, { partnerInvitationErrorMessage } from './acceptance';

let root: Root;
let host: HTMLDivElement;

async function renderAcceptance() {
  await act(async () => root.render(<InvitationAcceptance />));
}

function setSearch(search: string, pathname = '/accept-invitation') {
  window.history.replaceState({}, '', `${pathname}${search}`);
}

describe('invitation acceptance context', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.auth.isLoaded = true;
    mocks.auth.isSignedIn = false;
    mocks.legacyMatch = false;
    mocks.legacyToken = undefined;
    mocks.partnerAliasMatch = false;
    mocks.signUpProps = null;
    window.sessionStorage.clear();
    mocks.setLocation.mockReset();
    mocks.mutateAsync.mockReset().mockResolvedValue({});
    mocks.refetch.mockReset().mockResolvedValue({
      data: { roles: [{ role: 'PARTNER', status: 'ACTIVE' }] },
    });
    setSearch('');
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('reads Clerk and partner context without treating either as a role', () => {
    expect(readInvitationContext('?__clerk_ticket=clerk-secret&partnerInvitation=opaque-secret')).toEqual({
      ticket: 'clerk-secret',
      partnerToken: 'opaque-secret',
    });
    expect(invitationReturnUrl(
      { ticket: 'clerk-secret', partnerToken: 'opaque-secret' },
      '/edu',
    )).toBe('/edu/accept-invitation?__clerk_ticket=clerk-secret&partnerInvitation=opaque-secret');
    setInvitationAuthFlow('clerk-secret', 'signup');
    expect(consumeInvitationAuthFlow('different-ticket')).toBeNull();
    setInvitationAuthFlow('clerk-secret', 'signup');
    expect(consumeInvitationAuthFlow('clerk-secret')).toBe('signup');
    expect(destinationForAuthorizedContext({
      roles: [{ role: 'PARTNER', status: 'PENDING' }],
    })).toBeNull();
    expect(destinationForAuthorizedContext({
      roles: [{ role: 'PARTNER', status: 'ACTIVE' }],
    })).toBe('/partner');
    for (const role of ['TEACHER', 'ACCOUNTANT', 'STAFF']) {
      expect(destinationForAuthorizedContext({
        roles: [{ role, status: 'ACTIVE' }],
      })).toBe('/');
    }
    expect(destinationForNewlyActivatedRole(
      { roles: [{ role: 'SCHOOL_ADMIN', schoolId: 4, status: 'ACTIVE' }] },
      { roles: [{ role: 'SCHOOL_ADMIN', schoolId: 4, status: 'ACTIVE' }] },
    )).toBeNull();
    expect(destinationForNewlyActivatedRole(
      { roles: [{ role: 'PARTNER', status: 'ACTIVE' }] },
      { roles: [
        { role: 'PARTNER', status: 'ACTIVE' },
        { role: 'SCHOOL_ADMIN', schoolId: 4, status: 'ACTIVE' },
      ] },
    )).toBe('/');
    expect(partnerInvitationErrorMessage({
      status: 400,
      data: { error: 'Invalid invitation token' },
    })).toContain('token is invalid');
    expect(partnerInvitationErrorMessage({
      status: 400,
      data: { error: 'Invitation is expired or revoked' },
    })).toContain('expired, was revoked, or has already been used');
    expect(partnerInvitationErrorMessage({
      status: 409,
      data: { error: 'Invitation already accepted' },
    })).toContain('already been used');
  });

  it('renders a visible Clerk-loading state and does not render a blank page', async () => {
    mocks.auth.isLoaded = false;
    setSearch('?__clerk_ticket=do-not-display');
    await renderAcceptance();
    expect(host.textContent).toContain('Loading secure invitation');
    expect(host.textContent).not.toContain('do-not-display');
  });

  it.each([
    ['SCHOOL_ADMIN', '/'],
    ['TEACHER', '/'],
    ['ACCOUNTANT', '/'],
    ['PARENT', '/parent'],
    ['STUDENT', '/'],
    ['STAFF', '/'],
    ['PARTNER', '/partner'],
    ['DEVICE_ACTIVATION_OFFICER', '/activation'],
    ['COMPANY_ACCOUNTANT', '/company-finance'],
  ])('continues a newly verified %s invitee to its authorized dashboard', (role, destination) => {
    const fresh = { roles: [{ role, schoolId: role === 'PARTNER' || role === 'COMPANY_ACCOUNTANT' ? null : 4, status: 'ACTIVE' }] };
    expect(destinationForNewlyActivatedRole({ roles: [] }, fresh)).toBe(destination);
    expect(destinationForAuthorizedContext({
      roles: [{ role, schoolId: 4, status: 'PENDING' }],
    })).toBeNull();
  });

  it('routes a server-verified Owner without granting ownership from invitation context', () => {
    expect(destinationForAuthorizedContext({ isPlatformOwner: true, roles: [] })).toBe('/');
    expect(readInvitationContext('?role=PLATFORM_OWNER&schoolId=999')).toEqual({
      ticket: null, partnerToken: null,
    });
  });

  it('does not call partner acceptance before Clerk authentication', async () => {
    setSearch('?__clerk_ticket=synthetic-clerk-ticket&partnerInvitation=synthetic-partner-context');
    await renderAcceptance();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('synthetic-clerk-ticket');
    expect(host.textContent).not.toContain('synthetic-partner-context');
    expect(mocks.signUpProps?.forceRedirectUrl).toBe(
      '/accept-invitation?__clerk_ticket=synthetic-clerk-ticket&partnerInvitation=synthetic-partner-context',
    );
  });

  it('shows a useful error when required Clerk context is absent', async () => {
    await renderAcceptance();
    expect(host.textContent).toContain('missing its secure Clerk ticket');
  });

  it('keeps the ticket and partner context on the Clerk signup fallback URL', async () => {
    setSearch('?__clerk_ticket=clerk-ticket&partnerInvitation=opaque-token');
    await renderAcceptance();
    expect(mocks.signUpProps?.forceRedirectUrl).toBe(
      '/accept-invitation?__clerk_ticket=clerk-ticket&partnerInvitation=opaque-token',
    );
    expect(mocks.signUpProps?.fallbackRedirectUrl).toBe(
      '/accept-invitation?__clerk_ticket=clerk-ticket&partnerInvitation=opaque-token',
    );
    expect(mocks.signUpProps?.signInUrl).toContain('__clerk_ticket=clerk-ticket');
    expect(mocks.signUpProps?.signInUrl).toContain('partnerInvitation=opaque-token');
  });

  it('forwards the legacy partner route and its opaque token to the canonical route', async () => {
    mocks.legacyMatch = true;
    mocks.legacyToken = 'opaque-partner-token';
    setSearch('?__clerk_ticket=clerk-ticket', '/partner/invitations/opaque-partner-token/accept');
    await renderAcceptance();
    expect(mocks.setLocation).toHaveBeenCalledWith(
      '/accept-invitation?__clerk_ticket=clerk-ticket&partnerInvitation=opaque-partner-token',
      { replace: true },
    );
    expect(host.textContent).not.toContain('opaque-partner-token');
  });

  it('accepts partner invitations only after Clerk is loaded and signed in, then routes from fresh backend roles', async () => {
    mocks.auth.isSignedIn = true;
    mocks.partnerAliasMatch = true;
    setSearch('?__clerk_ticket=clerk-ticket&partnerInvitation=opaque-token', '/partner/accept-invitation');
    await renderAcceptance();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.mutateAsync).toHaveBeenCalledWith({ data: { partnerInvitation: 'opaque-token' } });
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Invitation accepted');
    expect(host.textContent).not.toContain('opaque-token');
    await act(async () => {
      [...host.querySelectorAll('button')].find((button) => button.textContent === 'Continue')?.click();
    });
    expect(mocks.setLocation).toHaveBeenCalledWith('/partner');
  });

  it('does not claim a partner invite succeeded when the refreshed context has no active partner role', async () => {
    mocks.auth.isSignedIn = true;
    mocks.partnerAliasMatch = true;
    mocks.refetch.mockResolvedValueOnce({
      data: { roles: [{ role: 'SCHOOL_ADMIN', status: 'ACTIVE' }] },
    });
    setSearch('?__clerk_ticket=clerk-ticket&partnerInvitation=opaque-token', '/partner/accept-invitation');
    await renderAcceptance();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('no active partner access');
    expect(host.textContent).not.toContain('Invitation accepted');
  });

  it('requires an active-role change for an already authenticated school invitee', async () => {
    mocks.auth.isSignedIn = true;
    const sameExistingRole = { data: { roles: [{ role: 'SCHOOL_ADMIN', schoolId: 8, status: 'ACTIVE' }] } };
    mocks.refetch.mockResolvedValueOnce(sameExistingRole).mockResolvedValueOnce(sameExistingRole);
    setSearch('?__clerk_ticket=school-ticket&__invitation_registration=complete');
    await renderAcceptance();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('This account already has active access');
    expect(host.textContent).toContain('already have been accepted');
    expect(host.textContent).not.toContain('Invitation accepted');

    await act(async () => root.unmount());
    root = createRoot(host);
    mocks.refetch.mockReset().mockResolvedValueOnce({
      data: { roles: [{ role: 'SCHOOL_ADMIN', schoolId: 8, status: 'ACTIVE' }] },
    });
    mocks.auth.isSignedIn = true;
    setInvitationAuthFlow('school-ticket', 'signup');
    setSearch('?__clerk_ticket=school-ticket&__invitation_registration=complete');
    await renderAcceptance();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Invitation accepted');

    await act(async () => root.unmount());
    root = createRoot(host);
    mocks.mutateAsync.mockRejectedValueOnce(new Error('private token must not be displayed'));
    setSearch('?__clerk_ticket=clerk-ticket&partnerInvitation=opaque-token');
    await renderAcceptance();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(host.textContent).toContain('invalid, expired, or already used');
    expect(host.textContent).not.toContain('private token');
  });
});

describe('invitation route placement', () => {
  it('mounts all invitation entry points before the general AuthGuard', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8');
    const canonical = source.indexOf('<Route path="/accept-invitation"><InvitationAcceptance /></Route>');
    const legacy = source.indexOf('<Route path="/partner/invitations/:invitationToken/accept"><InvitationAcceptance /></Route>');
    const guard = source.indexOf('<AuthGuard>');
    expect(canonical).toBeGreaterThan(-1);
    expect(legacy).toBeGreaterThan(canonical);
    expect(guard).toBeGreaterThan(legacy);
  });
});