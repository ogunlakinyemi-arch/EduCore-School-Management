// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  sessionsError: false, termsError: false,
  sessions: vi.fn(), terms: vi.fn(),
}));
vi.mock('@workspace/api-client-react', async original => ({
  ...await original<typeof import('@workspace/api-client-react')>(),
  useListAcademicSessions: (...args: unknown[]) => {
    state.sessions(...args);
    return { data: [{ id: 11, schoolId: 7, name: '2026/2027' }, { id: 91, schoolId: 8, name: 'Foreign school' }],
      isLoading: false, isError: state.sessionsError, refetch: vi.fn() };
  },
  useListAcademicTerms: (...args: unknown[]) => {
    state.terms(...args);
    return { data: [{ id: 12, sessionId: 11, name: 'Second term' }, { id: 92, sessionId: 91, name: 'Foreign session' }],
      isLoading: false, isError: state.termsError, refetch: vi.fn() };
  },
}));
import { FinancePeriodFilters } from './finance-period-filters';
beforeEach(() => {
  state.sessionsError = false; state.termsError = false;
  state.sessions.mockClear(); state.terms.mockClear();
});
describe('finance academic period selectors', () => {
  it('shows names backed by the selected school and session instead of typed IDs', () => {
    const html = renderToStaticMarkup(<FinancePeriodFilters schoolId={7} sessionId="11" termId="12" onChange={() => {}} />);
    expect(html).toContain('2026/2027');
    expect(html).toContain('Second term');
    expect(html).not.toContain('Foreign school');
    expect(html).not.toContain('Foreign session');
    expect(html).not.toContain('<input');
    expect(state.sessions.mock.calls[0][0]).toEqual({ schoolId: 7 });
    expect(state.terms.mock.calls[0].slice(0, 2)).toEqual([11, { schoolId: 7 }]);
  });
  it('requires a school before loading Owner-wide period filters', () => {
    const html = renderToStaticMarkup(<FinancePeriodFilters sessionId="" termId="" onChange={() => {}} />);
    expect(html).toContain('Choose a school first');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(state.sessions.mock.calls[0][1].query.enabled).toBe(false);
    expect(state.terms.mock.calls[0][2].query.enabled).toBe(false);
  });
  it('shows retry paths and disables failed metadata rather than accepting guessed IDs', () => {
    state.sessionsError = true; state.termsError = true;
    const html = renderToStaticMarkup(<FinancePeriodFilters schoolId={7} sessionId="11" termId="" onChange={() => {}} />);
    expect(html).toContain('Could not load sessions. Retry');
    expect(html).toContain('Could not load terms. Retry');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
