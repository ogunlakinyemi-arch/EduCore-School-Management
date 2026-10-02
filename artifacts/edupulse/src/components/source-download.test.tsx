import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@workspace/api-client-react', () => ({ downloadCurriculumSourceDocument: vi.fn() }));
vi.mock('@/components/shared', () => ({ Button: (p: { children: unknown; testId?: string }) => <button data-testid={p.testId}>{p.children as never}</button> }));
vi.mock('@/components/school-ops-kit', () => ({ Notice: () => null, errMsg: () => '' }));
import { SourceDownload } from './source-download';
describe('SourceDownload', () => {
  it('renders an authenticated download control', () => {
    const html = renderToStaticMarkup(<SourceDownload importId={5} testId="dl" />);
    expect(html).toContain('data-testid="dl"');
    expect(html).toContain('Download source document');
  });
});
