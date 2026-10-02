// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  createMutation: { mutate: vi.fn(), isPending: false },
  updateMutation: { mutate: vi.fn(), isPending: false },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@workspace/api-client-react', () => ({
  useListAcademicAssessments: vi.fn(),
  getListAcademicAssessmentsQueryKey: vi.fn(),
  useListAcademicResults: vi.fn(),
  useCreateAcademicResult: () => mocks.createMutation,
  useUpdateAcademicResult: () => mocks.updateMutation,
  usePublishAcademicAssessmentResults: vi.fn(),
  getListAcademicResultsQueryKey: (params: unknown) => ['academic-results', params],
  useListAcademicReportCards: vi.fn(),
  useCreateAcademicReportCard: vi.fn(),
  usePublishAcademicReportCard: vi.fn(),
  getListAcademicReportCardsQueryKey: vi.fn(),
  useListAcademicGradingRules: vi.fn(),
  useCreateAcademicGradingRule: vi.fn(),
  useUpdateAcademicGradingRule: vi.fn(),
  getListAcademicGradingRulesQueryKey: vi.fn(),
  useListAcademicSessions: vi.fn(),
  useListAcademicTerms: vi.fn(),
  useListClasses: vi.fn(),
  useListSubjects: vi.fn(),
  useListStudents: vi.fn(),
  useGetAuthorizedContext: vi.fn(),
}));

vi.mock('@/components/shared', () => ({
  PageHeading: ({ children, action }: any) => <header>{children}{action}</header>,
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
  SkeletonPage: () => <div>Loading</div>,
  ErrorState: () => <div>Error</div>,
  EmptyState: ({ title }: any) => <div>{title}</div>,
  Modal: ({ children }: any) => <div>{children}</div>,
  Field: ({ children, label }: any) => <label>{label}{children}</label>,
  TenantPicker: () => null,
  useTenant: () => ({ schoolId: 1 }),
  cx: (...classes: string[]) => classes.join(' '),
  date: () => '',
}));

vi.mock('@/components/school-document', () => ({
  SchoolDocumentHeader: () => null,
  SchoolDocumentPrintButton: () => null,
  useSchoolDocumentBranding: () => ({}),
}));

import { AdminResultReviewRow, ResultRow } from './results';

let host: HTMLDivElement;
let root: Root;

async function render(element: React.ReactNode) {
  await act(async () => root.render(element));
}

async function setValue(element: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('academic result review controls', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.invalidateQueries.mockReset();
    mocks.createMutation.mutate.mockReset();
    mocks.updateMutation.mutate.mockReset();
    mocks.createMutation.isPending = false;
    mocks.updateMutation.isPending = false;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'SUBMITTED', reviewStatus: 'NOT_REVIEWED' }),
    }));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const rowProps = (status: string, reviewStatus = 'NOT_REVIEWED', reviewComment: string | null = null) => ({
    student: { id: 13, firstName: 'Ada', lastName: 'Okafor', admissionNo: 'ADM-13' },
    existing: { id: 55, score: 18, maxScore: 20, remark: '', status, reviewStatus, reviewComment },
    assessmentId: 21, maxScore: 20, schoolId: 1, sessionId: 3, termId: 4, disabled: false, canManage: false,
  });

  it('submits a teacher draft through the review endpoint', async () => {
    await render(<ResultRow {...rowProps('DRAFT')} />);
    const submit = [...host.querySelectorAll('button')].find(button => button.textContent === 'Submit for review')!;
    await act(async () => {
      submit.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(fetch).toHaveBeenCalledWith('/api/academic/results/55/submit', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ schoolId: 1 }),
    }));
    expect(mocks.invalidateQueries).toHaveBeenCalled();
  });

  it('shows returned comments and lets only draft/returned work be edited or resubmitted', async () => {
    await render(<ResultRow {...rowProps('DRAFT', 'RETURNED', 'Check the mark total.')} />);
    expect(host.textContent).toContain('Admin feedback: Check the mark total.');
    expect(host.querySelector<HTMLInputElement>('input[type="number"]')?.disabled).toBe(false);
    expect(host.querySelector('button')?.textContent).toBe('Submit for review');

    await render(<ResultRow {...rowProps('SUBMITTED', 'NOT_REVIEWED')} />);
    expect(host.querySelector<HTMLInputElement>('input[type="number"]')?.disabled).toBe(true);
    expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Submit for review')).toBe(false);
  });

  it('requires an admin comment to return work and sends the review decision', async () => {
    await render(<AdminResultReviewRow
      result={{ id: 55, studentId: 13, score: 18, maxScore: 20, grade: 'A', status: 'SUBMITTED', reviewStatus: 'NOT_REVIEWED' }}
      schoolId={1}
      disabled={false}
      onReviewed={vi.fn()}
    />);
    const returnButton = host.querySelector<HTMLButtonElement>('button[aria-label="Return result 55"]')!;
    await act(async () => returnButton.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Add a comment');
    expect(fetch).not.toHaveBeenCalled();

    await setValue(host.querySelector<HTMLInputElement>('input[aria-label="Review comment for result 55"]')!, 'Please verify the total.');
    await act(async () => {
      returnButton.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(fetch).toHaveBeenCalledWith('/api/academic/results/55/review', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ schoolId: 1, decision: 'RETURN', comment: 'Please verify the total.' }),
    }));
  });
});