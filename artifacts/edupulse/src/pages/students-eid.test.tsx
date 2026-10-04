// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStudent: vi.fn(),
  getSchool: vi.fn(),
  listCards: vi.fn(),
  invalidateQueries: vi.fn(),
  role: 'PLATFORM_OWNER',
}));

vi.mock('@workspace/api-client-react', () => ({
  useListStudents: () => ({
    data: [{ id: 12, firstName: 'Stale', lastName: 'Directory', admissionNo: 'OLD', className: 'Old class', section: 'Z', status: 'ACTIVE' }],
    isLoading: false,
    isError: false,
  }),
  useGetSchool: () => ({ data: null }),
  useGetAuthorizedContext: () => ({ data: {
    isPlatformOwner: mocks.role === 'PLATFORM_OWNER',
    roles: [{ role: mocks.role, schoolId: mocks.role === 'PLATFORM_OWNER' ? null : 3, status: 'ACTIVE' }],
  } }),
  useCreateStudent: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateStudent: () => ({ mutate: vi.fn(), isPending: false }),
  getListStudentsQueryKey: () => ['students'],
  getGetSchoolQueryKey: () => ['school'],
  getStudent: mocks.getStudent,
  getSchool: mocks.getSchool,
  listCards: mocks.listCards,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('wouter', () => ({ useLocation: () => ['/students', vi.fn()], Link: ({ children }: any) => children }));

vi.mock('@/components/shared', () => ({
  PageHeading: ({ title, action }: any) => <header><h1>{title}</h1>{action}</header>,
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
  SkeletonPage: () => <div>Loading</div>,
  ErrorState: () => <div>Error</div>,
  EmptyState: ({ title }: any) => <div>{title}</div>,
  Modal: ({ children }: any) => <section>{children}</section>,
  Field: ({ children }: any) => <label>{children}</label>,
  Info: () => null,
  TenantPicker: () => <div />,
  useTenant: () => ({ schoolId: 3, setSchoolId: vi.fn() }),
  cx: (...classes: string[]) => classes.join(' '),
  date: () => '',
  useSchoolAdminAccess: () => ({ canManageSchool: true }),
}));

vi.mock('@/components/student-photo-field', () => ({ StudentPhotoField: () => null }));

import { StudentsPage } from './students';

const student = (overrides: Record<string, unknown> = {}) => ({
  id: 12,
  schoolId: 3,
  firstName: 'Current',
  lastName: 'Student',
  admissionNo: 'ADM-12',
  className: 'Year 6',
  section: 'B',
  status: 'ACTIVE',
  passportUrl: '/objects/student-photos/3/12/uuid',
  ...overrides,
});

let root: Root;
let host: HTMLDivElement;
const openEId = async () => {
  await act(async () => {
    root.render(<StudentsPage />);
  });
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === 'e-ID card');
  expect(button).toBeTruthy();
  await act(async () => {
    button!.click();
  });
};

const settle = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};

describe('Student Directory e-ID freshness', () => {
  it('allows same-school Admin preview without an official print action', async () => {
    mocks.role = 'SCHOOL_ADMIN';
    await openEId();
    expect(host.textContent).toContain('Current Student');
    expect(host.textContent).not.toContain('Print / Save as PDF');
    expect(window.print).not.toHaveBeenCalled();
  });

  it('does not offer Student ID card preview to a Teacher', async () => {
    mocks.role = 'TEACHER';
    await act(async () => root.render(<StudentsPage />));
    expect(host.textContent).toContain('Stale Directory');
    expect(host.textContent).not.toContain('e-ID card');
    expect(mocks.listCards).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.getStudent.mockReset();
    mocks.getSchool.mockReset();
    mocks.listCards.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.role = 'PLATFORM_OWNER';
    mocks.getStudent.mockResolvedValue(student());
    mocks.getSchool.mockResolvedValue({ id: 3, name: 'Current School', logoUrl: '/school-logo.png' });
    mocks.listCards.mockResolvedValue([
      { id: 4, uid: 'ACTIVE-UID', studentId: 12, status: 'active' },
      { id: 5, uid: 'OLD-UID', studentId: 12, status: 'inactive' },
    ]);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 0));
    vi.spyOn(window, 'print').mockImplementation(() => {});
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      writable: true,
      value: () => Promise.resolve(),
    });
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads persisted student, school and active card data and protects managed photo paths', async () => {
    await openEId();
    await settle();

    expect(mocks.getStudent).toHaveBeenCalledWith(12, { schoolId: 3 });
    expect(mocks.getSchool).toHaveBeenCalledWith(3);
    expect(mocks.listCards).toHaveBeenCalledWith({ schoolId: 3 });
    expect(host.textContent).toContain('Current Student');
    expect(host.textContent).toContain('ADM-12');
    expect(host.textContent).toContain('Student ID: 12');
    expect(host.textContent).toContain('Old class');
    expect(host.textContent).toContain('Z');
    expect(host.querySelector('.student-eid-card')?.textContent).not.toContain('Class / Section');
    expect(host.querySelector('.student-eid-card')?.textContent).not.toContain('Year 6');
    expect(host.textContent).toContain('ACTIVE-UID');
    expect(host.textContent).not.toContain('OLD-UID');
    expect(host.textContent).toContain('Current School');
    expect(host.querySelector('img[alt="Current Student passport photo"]')?.getAttribute('src'))
      .toBe('/api/students/12/photo?schoolId=3&eidRefresh=1');
    expect(host.querySelector('img[alt="Current School logo"]')?.getAttribute('src'))
      .toBe('/school-logo.png?eidRefresh=1');
  });

  it('refreshes all persisted values before printing instead of printing the open-time snapshot', async () => {
    mocks.getStudent
      .mockResolvedValueOnce(student())
      .mockResolvedValueOnce(student({ firstName: 'Updated', className: 'Year 7', passportUrl: 'https://legacy.example/photo.jpg' }));
    mocks.getSchool
      .mockResolvedValueOnce({ id: 3, name: 'Current School', logoUrl: '/school-logo.png' })
      .mockResolvedValueOnce({ id: 3, name: 'Updated School', logoUrl: '/new-logo.png' });
    mocks.listCards
      .mockResolvedValueOnce([{ id: 4, uid: 'OLD-CARD', studentId: 12, status: 'active' }])
      .mockResolvedValueOnce([{ id: 6, uid: 'LATEST-CARD', studentId: 12, status: 'active' }]);

    await openEId();
    await settle();
    const printButton = [...host.querySelectorAll('button')].find(item => item.textContent?.includes('Print / Save as PDF'));
    await act(async () => {
      printButton!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mocks.getStudent).toHaveBeenCalledTimes(2);
    expect(mocks.getSchool).toHaveBeenCalledTimes(2);
    expect(mocks.listCards).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Updated Student');
    expect(host.textContent).toContain('Updated School');
    expect(host.querySelector('.student-eid-card')?.textContent).not.toContain('Year 7');
    expect(host.textContent).toContain('LATEST-CARD');
    expect(host.querySelector('img[alt="Updated Student passport photo"]')?.getAttribute('src'))
      .toBe('https://legacy.example/photo.jpg?eidRefresh=2');
    expect(host.querySelector('img[alt="Updated School logo"]')?.getAttribute('src'))
      .toBe('/new-logo.png?eidRefresh=2');
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('cache-busts unchanged photo and logo URLs before decoding and printing', async () => {
    const sequence: string[] = [];
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(() => {
      sequence.push('decode');
      return Promise.resolve();
    });
    vi.spyOn(window, 'print').mockImplementation(() => { sequence.push('print'); });
    mocks.getStudent.mockResolvedValue(student());
    mocks.getSchool.mockResolvedValue({ id: 3, name: 'Current School', logoUrl: '/school-logo.png' });

    await openEId();
    await settle();
    const initialPhoto = host.querySelector('img[alt="Current Student passport photo"]')?.getAttribute('src');
    const initialLogo = host.querySelector('img[alt="Current School logo"]')?.getAttribute('src');
    const printButton = [...host.querySelectorAll('button')].find(item => item.textContent?.includes('Print / Save as PDF'));
    await act(async () => {
      printButton!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const refreshedPhoto = host.querySelector('img[alt="Current Student passport photo"]')?.getAttribute('src');
    const refreshedLogo = host.querySelector('img[alt="Current School logo"]')?.getAttribute('src');
    expect(initialPhoto).toBe('/api/students/12/photo?schoolId=3&eidRefresh=1');
    expect(initialLogo).toBe('/school-logo.png?eidRefresh=1');
    expect(refreshedPhoto).toBe('/api/students/12/photo?schoolId=3&eidRefresh=2');
    expect(refreshedLogo).toBe('/school-logo.png?eidRefresh=2');
    expect(sequence.slice(-1)).toEqual(['print']);
    expect(sequence.slice(0, -1)).toContain('decode');
    expect(sequence.indexOf('print')).toBe(sequence.lastIndexOf('decode') + 1);
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('cancels printing and clears the card if a refreshed image cannot decode', async () => {
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockRejectedValue(new Error('decode failed'));
    await openEId();
    await settle();
    const printButton = [...host.querySelectorAll('button')].find(item => item.textContent?.includes('Print / Save as PDF'));
    await act(async () => {
      printButton!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(host.textContent).toContain('decode failed');
    expect(host.textContent).not.toContain('Current Student');
    expect(window.print).not.toHaveBeenCalled();
  });

  it('shows a fetch failure and never prints the stale card', async () => {
    await openEId();
    await settle();
    mocks.getStudent.mockRejectedValueOnce(new Error('network unavailable'));
    const printButton = [...host.querySelectorAll('button')].find(item => item.textContent?.includes('Print / Save as PDF'));
    await act(async () => {
      printButton!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(host.textContent).toContain('latest student, school, and card information could not be loaded');
    expect(host.textContent).not.toContain('Current Student');
    expect(window.print).not.toHaveBeenCalled();
  });
});