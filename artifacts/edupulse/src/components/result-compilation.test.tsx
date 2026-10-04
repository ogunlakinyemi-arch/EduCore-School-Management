import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TermForm, termContainmentError } from '@/pages/academics';
import { SubjectRow } from '@/components/result-compilation';

const base = { subjectId: 1, subjectName: 'Biology', teacherName: 'Mrs Okoro', maxScore: 100, resultIds: [5] };

describe('SubjectRow', () => {
  it('shows missing subjects as awaiting, never zero', () => {
    const html = renderToStaticMarkup(<SubjectRow subject={{ ...base, score: null, grade: null, status: 'MISSING', missing: true, resultIds: [] }} schoolId={1} canManage onChanged={() => {}} />);
    expect(html).toContain('Awaiting Teacher Submission');
    expect(html).not.toMatch(/>0</);
  });
  it('offers Approve/Return only for SUBMITTED, not APPROVED', () => {
    const sub = (status: string) => renderToStaticMarkup(<SubjectRow subject={{ ...base, score: 70, grade: 'A', status, missing: false }} schoolId={1} canManage onChanged={() => {}} />);
    expect(sub('SUBMITTED')).toContain('>Return</button>');
    expect(sub('APPROVED')).not.toContain('>Return</button>');
  });
  it('offers no teacher resubmit', () => {
    const html = renderToStaticMarkup(<SubjectRow subject={{ ...base, score: 70, grade: 'A', status: 'RETURNED', missing: false }} schoolId={1} canManage={false} onChanged={() => {}} />);
    expect(html).not.toContain('Resubmit');
  });
});

describe('terms', () => {
  it('flags terms outside the selected (historical) session', () => {
    const session = { startDate: '2022-09-01', endDate: '2023-07-31' };
    expect(termContainmentError({ startDate: '2022-09-05', endDate: '2022-12-15' }, session)).toBe('');
    expect(termContainmentError({ startDate: '2022-08-01', endDate: '2022-12-15' }, session)).toMatch(/within the session/);
  });
  it('lets COMPLETED be chosen and omits overlap confirmation by default', () => {
    const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><TermForm schoolId={1} sessionId={2} onDone={() => {}} onCancel={() => {}} /></QueryClientProvider>);
    expect(html).toContain('value="COMPLETED"');
    expect(html).not.toContain('Allow overlapping term dates');
  });
});
