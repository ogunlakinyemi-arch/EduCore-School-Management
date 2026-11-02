// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { act, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  schoolId: 12,
  context: {
    isPlatformOwner: true,
    user: { name: 'Platform Owner' },
    roles: [
      { role: 'PLATFORM_OWNER', schoolId: null, status: 'ACTIVE' },
      { role: 'SCHOOL_ADMIN', schoolId: 12, status: 'ACTIVE' },
      { role: 'STUDENT', schoolId: 12, status: 'ACTIVE' },
    ],
  } as any,
  ownerDirectoryCalls: [] as any[],
  librarian: false,
  loading: false,
  location: '/',
  search: '',
}));

vi.mock('@clerk/react', () => ({
  UserButton: () => <div>User account</div>,
  useAuth: () => ({ userId: 'owner-test-user', isLoaded: true }),
}));
vi.mock('./fee-payment-notifications', () => ({ FeePaymentNotifications: () => null }));
vi.mock('@/pages/communication-inbox', () => ({ CommunicationInboxBadge: () => null }));
vi.mock('@/components/subscription-access-banner', () => ({ SubscriptionAccessBanner: () => null }));
vi.mock('@/components/student-subscription-guard', () => ({ StudentSubscriptionGuard: ({children}:any) => children }));
vi.mock('@/components/staff-subscription-guard', () => ({ StaffSubscriptionGuard: ({children}:any) => children }));
vi.mock('@/components/pwa-install', () => ({ PwaInstall: () => null }));
vi.mock('@/hooks/use-phase9-api', () => ({
  usePhase9List: () => ({ data: { canManageLoans: state.librarian, canManageCatalogue: state.librarian, canAssignStaff: false } }),
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => ({ data: state.context, isLoading: state.loading }),
  useGetCurrentUserSchools: () => ({ data: [] }),
  getGetCurrentUserSchoolsQueryKey: () => ['user-schools'],
  useListOwnerSchoolDirectory: (params: any, options: any) => {
    state.ownerDirectoryCalls.push({ params, options });
    return { data: { schools: [
      { id: 12, name: 'North School' },
      { id: 13, name: 'Suspended School' },
    ] }, isLoading: false };
  },
  getListOwnerSchoolDirectoryQueryKey: (params: any) => ['owner-school-directory', params],
  useListPlatformNotifications: () => { useState(null); return { data: [] }; },
  getListPlatformNotificationsQueryKey: () => ['platform-notifications'],
}));
vi.mock('wouter', () => ({
  useLocation: () => [state.location],
  useSearch: () => state.search,
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

import { Shell, TenantSessionBoundary } from './shared';

describe('Platform Owner navigation', () => {
  beforeEach(() => {
    state.schoolId = 12;
    state.context = {
      isPlatformOwner: true,
      user: { name: 'Platform Owner', status: 'ACTIVE' },
      roles: [
        { role: 'PLATFORM_OWNER', schoolId: null, status: 'ACTIVE' },
        { role: 'SCHOOL_ADMIN', schoolId: 12, status: 'ACTIVE' },
        { role: 'STUDENT', schoolId: 12, status: 'ACTIVE' },
      ],
    };
    state.ownerDirectoryCalls = [];
    state.librarian = false;
    state.location = '/'; state.search = '';
  });

  it('keeps platform links and hides school-operation links even for a mixed-role Owner', () => {
    const html = renderToStaticMarkup(
      <Shell><div>Dashboard content</div></Shell>,
    );

    for (const href of ['/schools', '/records', '/students', '/company-employees', '/partners', '/account-applications', '/devices', '/card-uid-inventory', '/cards', '/audit', '/users', '/results', '/communications', '/platform/attendance', '/subscription-payment-rules', '/payment-settlement?tab=schools']) {
      expect(html).toContain(`href="${href}"`);
    }
    for (const href of ['/parents', '/employees', '/academics', '/subjects', '/classes', '/academic-work', '/timetable', '/attendance', '/finance', '/people/imports', '/my-academics', '/my-fees']) {
      expect(html).not.toContain(`href="${href}"`);
    }
    expect(html).toContain('aria-label="Owner school context"');
    expect(html).toContain('Suspended School');
    expect(state.ownerDirectoryCalls.some(call => call.params.status === 'all')).toBe(true);
  });

  it('only exposes the new financial links for an active global Owner account and membership', () => {
    const owner = structuredClone(state.context);
    const denied = [
      {...owner, user:{...owner.user,status:'INACTIVE'}},
      {...owner, roles:[{role:'PLATFORM_OWNER',schoolId:null,status:'INACTIVE'}]},
      {...owner, roles:[{role:'PLATFORM_OWNER',schoolId:12,status:'ACTIVE'}]},
      {...owner, roles:[]},
      ...['SCHOOL_ADMIN','ACCOUNTANT','TEACHER','STUDENT','PARENT','PARTNER'].map(role=>({
        isPlatformOwner:false,user:{status:'ACTIVE'},roles:[{role,schoolId:12,status:'ACTIVE'}],
      })),
      ...['DEVICE_ACTIVATION_OFFICER','COMPANY_ACCOUNTANT'].map(role=>({
        ...owner,roles:[...owner.roles,{role,schoolId:null,status:'ACTIVE'}],
      })),
    ];
    for (const context of denied) {
      state.context=context;
      const html=renderToStaticMarkup(<Shell>Content</Shell>);
      expect(html).not.toContain('href="/subscription-payment-rules"');
      expect(html).not.toContain('href="/payment-settlement?tab=schools"');
    }
    state.context=owner;
    state.schoolId=0;
    const html=renderToStaticMarkup(<Shell>Owner content</Shell>);
    expect(html).toContain('Subscription &amp; Payment Rules');
    expect(html).toContain('NFC Fee Collection Oversight');
    expect(html).not.toContain('Split Settlements');
    expect(html).not.toContain('Hosted Payments');
  });

  it('highlights the direct oversight link only for the schools query tab', () => {
    state.location='/payment-settlement';
    for(const [search,active] of [['tab=schools',true],['tab=company',false],['tab=history',false],['',false]] as const){
      state.search=search;
      const host=document.createElement('div');
      host.innerHTML=renderToStaticMarkup(<Shell>Owner content</Shell>);
      expect(host.querySelector('a[href="/payment-settlement?tab=schools"]')?.getAttribute('aria-current'))
        .toBe(active?'page':null);
    }
  });

  it('does not show the Owner context selector to a School Admin', () => {
    state.context = {
      isPlatformOwner: false,
      user: { name: 'School Admin' },
      roles: [{ role: 'SCHOOL_ADMIN', schoolId: 12, status: 'ACTIVE' }],
    };

    const html = renderToStaticMarkup(<Shell><div>School content</div></Shell>);

    expect(html).not.toContain('Owner school context');
    expect(html).not.toContain('Suspended School');
    expect(html).toContain('data-testid="button-nav-section-communication"');
  });

  it('hides Library for a Teacher without librarian duty', () => {
    state.context = { isPlatformOwner: false, user: { name: 'Teacher' },
      roles: [{role:'TEACHER',schoolId:12,status:'ACTIVE'}] };
    const html=renderToStaticMarkup(<Shell><div>Teacher content</div></Shell>);
    expect(html).not.toContain('data-testid="button-nav-section-library"');
    expect(html).toContain('data-testid="button-nav-section-assessments"');
  });

  it('adds Library to the same Teacher account with librarian duty', () => {
    state.librarian = true;
    state.context = { isPlatformOwner: false, user: { name: 'Teacher' },
      roles: [{role:'TEACHER',schoolId:12,status:'ACTIVE'}] };
    const html=renderToStaticMarkup(<Shell><div>Teacher content</div></Shell>);
    expect(html).toContain('data-testid="button-nav-section-library"');
    expect(html).toContain('data-testid="button-nav-section-assessments"');
    expect(html).not.toContain('href="/schools"');
  });
});

describe('tenant session isolation', () => {
  it('does not render the prior account context while a new identity is loading', () => {
    const html = renderToStaticMarkup(
      <TenantSessionBoundary
        session={{ userId: 'owner-account', status: 'ready', context: { isPlatformOwner: true } } as any}
        currentUserId="school-account"
        isLoaded
      >
        <div>Prior account dashboard</div>
      </TenantSessionBoundary>,
    );

    expect(html).not.toContain('Prior account dashboard');
  });

  it('keeps application children hidden when fetching the new account context fails', () => {
    const html = renderToStaticMarkup(
      <TenantSessionBoundary
        session={{ userId: 'school-account', status: 'error' }}
        currentUserId="school-account"
        isLoaded
      >
        <div>Prior account dashboard</div>
      </TenantSessionBoundary>,
    );

    expect(html).toContain('tenant-context-error');
    expect(html).toContain('Could not verify your account context');
    expect(html).not.toContain('Prior account dashboard');
  });
});

describe('mobile navigation lifecycle', () => {
  it('locks background scrolling, contains keyboard focus and restores it after Escape, backdrop or resize', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT:true });
    state.loading=false;
    state.context={isPlatformOwner:false,user:{name:'Development fixture'},roles:[{role:'STUDENT',schoolId:12,status:'ACTIVE'}]};
    const host=document.createElement('div'); document.body.append(host);
    const root=createRoot(host), priorOverflow=document.body.style.overflow, priorWidth=window.innerWidth;
    try {
      Object.defineProperty(window,'innerWidth',{value:360,writable:true,configurable:true});
      act(()=>root.render(<Shell><div>Content</div></Shell>));
      const open=host.querySelector<HTMLButtonElement>('[data-testid=button-open-navigation]')!;
      const show=()=>act(()=>{open.focus();open.click();});
      show();
      expect(document.body.style.overflow).toBe('hidden');
      const sidebar=host.querySelector('[data-testid=sidebar]')!;
      expect(sidebar.contains(document.activeElement)).toBe(true);
      const controls=sidebar.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),select:not([disabled]),[tabindex="0"]');
      controls[controls.length-1].focus();
      act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true})));
      expect(document.activeElement).toBe(controls[0]);
      act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
      expect(document.body.style.overflow).toBe(priorOverflow); expect(document.activeElement).toBe(open);
      expect(host.querySelector('[data-testid=button-dismiss-menu]')).toBeNull();
      show(); act(()=>host.querySelector<HTMLButtonElement>('[data-testid=button-dismiss-menu]')!.click());
      expect(document.body.style.overflow).toBe(priorOverflow); expect(document.activeElement).toBe(open);
      show(); window.innerWidth=1024; act(()=>window.dispatchEvent(new Event('resize')));
      expect(host.querySelector('[data-testid=button-dismiss-menu]')).toBeNull();
      expect(document.body.style.overflow).toBe(priorOverflow);
    } finally { act(()=>root.unmount()); host.remove(); window.innerWidth=priorWidth; document.body.style.overflow=priorOverflow; }
  });
  it('keeps the hook order stable when authorization finishes loading', () => {
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    try {
      state.loading=true; act(()=>root.render(<Shell>Content</Shell>));
      state.loading=false; expect(()=>act(()=>root.render(<Shell>Content</Shell>))).not.toThrow();
      expect(host.textContent).toContain('Content');
    } finally { state.loading=false;act(()=>root.unmount());host.remove(); }
  });
});