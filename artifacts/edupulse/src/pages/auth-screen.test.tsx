import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
  useClerk: () => ({ signOut: vi.fn() }),
  SignIn: () => <div className="cl-rootBox">Sign in control</div>,
  SignUp: () => <div className="cl-rootBox">Sign up control</div>,
}));
vi.mock('wouter', () => ({
  useLocation: () => ['/sign-in', vi.fn()],
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

import { AuthScreen } from './auth-screen';

afterEach(() => vi.unstubAllGlobals());

describe('responsive authentication shell', () => {
  it('forwards the authentication completion flag through the roleless protected entry', () => {
    const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/ApplicationPortal\s+pendingAccess\s+autoSubmit=/);
  });
  it.each(['sign-in', 'sign-up'] as const)('constrains the %s grid and content without changing authentication', (mode) => {
    vi.stubGlobal('window', { location: { search: '', origin: 'https://example.com' } });
    const html = renderToStaticMarkup(<AuthScreen mode={mode} />);
    expect(html).toContain('auth-screen');
    expect(html).toContain('grid-cols-[minmax(0,1fr)]');
    expect(html).toContain('md:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]');
    expect(html).toContain('flex min-w-0 flex-col');
    expect(html).toContain(mode === 'sign-in' ? 'Sign in control' : 'Submit Application');
    if (mode === 'sign-up') {
      expect(html).not.toContain('Sign up control');
      expect(html).toContain('input-school-name');
      expect(html).toContain('footer-sign-in');
    }
    if (mode === 'sign-in') {
      for (const role of ['PLATFORM_OWNER', 'SCHOOL_ADMIN', 'TEACHER', 'STAFF', 'PARENT', 'STUDENT', 'PARTNER']) {
        expect(html).toContain(`value="${role}"`);
      }
    }
  });

  it('scopes wrapping and stacked provider controls to mobile authentication pages', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    expect(css).toContain('@media (max-width: 767px)');
    expect(css).toContain('.auth-screen .cl-cardBox');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(css).toContain('flex-wrap: wrap');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).not.toContain('overflow-x: hidden');
  });
  it('shows the profile form first, never the Clerk widget, for a typed applicant', () => {
    vi.stubGlobal('window', { location: { search: '?applicantType=PARTNER', origin: 'https://example.com' } });
    const html = renderToStaticMarkup(<AuthScreen mode="sign-up" />);
    expect(html).not.toContain('Sign up control');
    expect(html).toContain('Partner Full Name');
    expect(html).toContain('Business Name (optional)');
  });
});
