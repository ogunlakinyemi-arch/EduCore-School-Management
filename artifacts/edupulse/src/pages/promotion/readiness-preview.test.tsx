import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromotionReadiness } from '@workspace/api-client-react';

const state = vi.hoisted(() => ({ query: {} as Record<string, unknown>, hook: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  getGetPromotionReadinessQueryKey: (params: unknown) => ['promotion-readiness', params],
  useGetPromotionReadiness: (...args: unknown[]) => { state.hook(...args); return state.query; },
}));
vi.mock('@/components/shared', () => ({ Button: ({ children }: any) => <button>{children}</button> }));
import { PromotionReadinessPreview } from './readiness-preview';

beforeEach(() => { state.query = {}; state.hook.mockClear(); });
describe('promotion evidence preview', () => {
  it('waits for explicit school/session scope', () => {
    expect(renderToStaticMarkup(<PromotionReadinessPreview schoolId={1} sourceSessionId={0} />)).toContain('Select a source session');
    expect(state.hook.mock.calls[0]![1].query.enabled).toBe(false);
  });
  it('shows evidence and unresolved policy without any finalization control', () => {
    const data = {
      schoolId: 1, sourceSessionId: 10, thirdTermId: 102, cohortCount: 3,
      placementConflictCount: 0, studentsWithPublishedResults: 2, missingPublishedResults: 1,
      publishedResultCount: 4, executionEnabled: false, policyStatus: 'REQUIRES_APPROVED_POLICY',
      blockers: ['School-approved policy is required.'], warnings: ['Draft and earlier-term results are excluded.'],
    } satisfies PromotionReadiness;
    state.query = { data };
    const html = renderToStaticMarkup(<PromotionReadinessPreview schoolId={1} sourceSessionId={10} />);
    expect(html).toContain('3 currently enrolled');
    expect(html).toContain('School-approved policy is required.');
    expect(html).toContain('execution is not enabled');
    expect(html).not.toContain('<button');
    expect(state.hook.mock.calls[0]![0]).toEqual({ schoolId: 1, sourceSessionId: 10 });
  });
  it('does not show a successful validation on loading or error', () => {
    state.query = { isLoading: true };
    expect(renderToStaticMarkup(<PromotionReadinessPreview schoolId={1} sourceSessionId={10} />)).toContain('Checking');
    state.query = { isError: true, data: { cohortCount: 50 } };
    const html = renderToStaticMarkup(<PromotionReadinessPreview schoolId={1} sourceSessionId={10} />);
    expect(html).toContain('No promotion is authorized');
    expect(html).not.toContain('50 currently enrolled');
  });
});
