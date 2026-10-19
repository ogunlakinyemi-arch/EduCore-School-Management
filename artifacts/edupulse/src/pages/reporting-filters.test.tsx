import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ loading:false, error:false, fetching:false }));
vi.mock('@/hooks/use-reporting-api', async () => ({
  ...await vi.importActual('@/hooks/use-reporting-api'),
  useReportResult: () => ({ data:{title:'Student report',columns:[],rows:[],total:0}, isLoading:false, isFetching:state.fetching, isError:false }),
  useReportFilterOptions: () => ({
    data:{options:{sessionId:[{value:'7',label:'2026/2027'}],termId:[{value:'8',label:'First term'}],classId:[{value:'9',label:'JSS 1 (Blue)'}],section:[{value:'Blue',label:'Blue'}],status:[{value:'ACTIVE',label:'ACTIVE'}]},truncated:[],requiresSchool:false},
    isLoading:state.loading,isError:state.error,refetch:vi.fn(),
  }),
}));
vi.mock('@/components/shared', () => ({
  Button: ({children,testId,...props}: any) => <button data-testid={testId} {...props}>{children}</button>,
  EmptyState: ({title}: any) => <p>{title}</p>,
  ErrorState: () => <p>Error</p>, SkeletonPage: () => <p>Loading</p>,
  PageHeading: () => null, TenantPicker: () => null, useTenant: () => ({schoolId:10}),
  cx: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));
import { ReportingWorkspace } from './reporting';
const render = () => renderToStaticMarkup(<ReportingWorkspace item={{
  id:'students',title:'Students',filters:['schoolId','from','to','sessionId','termId','classId','section','status'],
}} owner={false} schools={[]} scope={{userId:1,roleScope:'SCHOOL_ADMIN',tenantId:10,tenantSchoolId:10}} />);
beforeEach(() => { state.loading=false;state.error=false;state.fetching=false; });
describe('report filter controls', () => {
  it('keeps dates as native date controls and renders readable authorized choices with Any defaults', () => {
    const html=render();
    expect(html.match(/type="date"/g)).toHaveLength(2);
    for (const key of ['sessionId','termId','classId','section','status']) {
      expect(html).toContain(`data-testid="select-report-${key}"`);
      expect(html).not.toContain(`data-testid="input-report-${key}"`);
    }
    for (const label of ['2026/2027','First term','JSS 1 (Blue)','Any academic session','Any term','Any class','Any section','Any status']) expect(html).toContain(label);
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('min-h-11');
    expect(html).not.toContain('data-testid="select-report-school"');
  });
  it('shows retry feedback for unavailable choices rather than accepting typed IDs', () => {
    state.error=true;
    const html=render();
    expect(html).toContain('Filter choices could not be loaded');
    expect(html).toContain('Retry choices');
    expect(html).toMatch(/disabled=""[^>]*data-testid="select-report-sessionId"/);
  });
  it('prevents exporting a stale table while the selected view refreshes', () => {
    state.fetching=true;
    expect(render().match(/<button[^>]*data-testid="button-export-report"[^>]*>/)?.[0]).toContain('disabled=""');
  });
});
