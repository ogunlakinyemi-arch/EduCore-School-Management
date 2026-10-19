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
  it.each(['sign-in', 'sign-up'] as const)('constrains the %s grid and content without changing authentication', (mode) => {
    vi.stubGlobal('window', { location: { search: '', origin: 'https://example.com' } });
    const html = renderToStaticMarkup(<AuthScreen mode={mode} />);
    expect(html).toContain('auth-screen');
    expect(html).toContain('grid-cols-[minmax(0,1fr)]');
    expect(html).toContain('md:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]');
    expect(html).toContain('flex min-w-0 flex-col');
    expect(html).toContain(mode === 'sign-in' ? 'Sign in control' : 'Apply for an account');
    if (mode === 'sign-up') {
      expect(html).not.toContain('Sign up control');
      expect(html).toContain('choose-school-admin');
      expect(html).toContain('choose-partner');
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
  it.each(['SCHOOL_ADMIN', 'PARTNER'])('keeps the selected %s application and approval requirement above account creation', (type) => {
    vi.stubGlobal('window', { location: { search: `?applicantType=${type}`, origin: 'https://example.com' } });
    const html = renderToStaticMarkup(<AuthScreen mode="sign-up" />);
    expect(html).toContain('Sign up control');
    expect(html).toContain(type === 'PARTNER' ? 'Partner application' : 'School Admin application');
    expect(html).toContain('Platform Owner approval is required');
  });
});
