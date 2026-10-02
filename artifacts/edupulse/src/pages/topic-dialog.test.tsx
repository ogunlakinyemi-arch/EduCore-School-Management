// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const add = vi.fn(); const upd = vi.fn();
vi.mock('@workspace/api-client-react', () => ({
  useAddCurriculumTopic: () => ({ mutate: add, isPending: false, error: null }),
  useUpdateCurriculumTopic: () => ({ mutate: upd, isPending: false, error: null }),
}));
vi.mock('@/components/shared', () => ({
  Modal: (p: { children: unknown }) => <div>{p.children as never}</div>,
  Field: (p: { children: unknown }) => <label>{p.children as never}</label>,
  Button: (p: { children: unknown; testId?: string; onClick?: () => void; type?: 'submit' | 'button'; disabled?: boolean }) => <button type={p.type ?? 'button'} data-testid={p.testId} disabled={p.disabled} onClick={p.onClick}>{p.children as never}</button>,
  PageHeading: () => null, StatusPill: () => null, SkeletonPage: () => null, ErrorState: () => null, EmptyState: () => null, Info: () => null, cx: (...a: unknown[]) => a.filter(Boolean).join(' '), date: () => '',
}));
vi.mock('@/components/school-ops-kit', () => ({ Notice: () => null, errMsg: () => '', FRESH: {}, useSchoolRole: () => ({}) }));
vi.mock('@/components/source-download', () => ({ SourceDownload: () => null }));
vi.mock('@/hooks/use-curriculum-context', () => ({ useInvalidateSchool: () => () => {} }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: () => {} }) }));
import { TopicDialog } from './curriculum-management';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const T = (id: number, title: string, level: string, code: string, parent: number | null = null) => ({ id, title, classLevel: level, subjectCode: code, parentTopicId: parent, sequenceOrder: id, learningObjectives: ['a', 'b'], learningOutcomes: [], suggestedResources: [], sourceKind: 'OFFICIAL' }) as never;
const topics = [T(1, 'Numbers', 'JSS1', 'MTH'), T(2, 'Algebra', 'JSS1', 'MTH'), T(3, 'Other class', 'JSS2', 'MTH'), T(4, 'Other subject', 'JSS1', 'ENG'), T(5, 'Sub', 'JSS1', 'MTH', 1)];

async function mount(props: Record<string, unknown>) {
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<TopicDialog versionId={9} defaults={{ classLevel: 'JSS1', subjectCode: 'MTH' }} topics={topics} onClose={() => {}} onSaved={() => {}} {...props} />); });
  return el;
}
const submit = async (el: HTMLElement) => { await act(async () => { el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); };
beforeEach(() => { add.mockClear(); upd.mockClear(); });

describe('TopicDialog', () => {
  it('add sub-topic sends parentTopicId and offers only same class/subject main topics', async () => {
    const el = await mount({ parentId: 1 });
    const opts = [...el.querySelectorAll('[data-testid="select-topic-parent"] option')].map(o => o.textContent);
    expect(opts).toEqual(['No parent (main topic)', 'Numbers', 'Algebra']);
    (el.querySelector('[data-testid="input-topic-title"]') as HTMLInputElement).value = 'x';
    await submit(el);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0].data.parentTopicId).toBe(1);
    expect(upd).not.toHaveBeenCalled();
  });
  it('edit uses update with prefilled values and excludes itself as parent', async () => {
    const el = await mount({ existingTopic: topics[1] });
    expect((el.querySelector('[data-testid="input-topic-title"]') as HTMLInputElement).value).toBe('Algebra');
    const opts = [...el.querySelectorAll('[data-testid="select-topic-parent"] option')].map(o => o.textContent);
    expect(opts).toEqual(['No parent (main topic)', 'Numbers']);
    await submit(el);
    expect(add).not.toHaveBeenCalled();
    const call = upd.mock.calls[0][0];
    expect(call).toMatchObject({ versionId: 9, topicId: 2 });
    expect(call.data).toMatchObject({ title: 'Algebra', learningObjectives: ['a', 'b'], parentTopicId: null, sequenceOrder: 2 });
  });
  it('topic with children cannot be given a parent', async () => {
    const el = await mount({ existingTopic: topics[0] });
    expect((el.querySelector('[data-testid="select-topic-parent"]') as HTMLSelectElement).disabled).toBe(true);
  });
});
