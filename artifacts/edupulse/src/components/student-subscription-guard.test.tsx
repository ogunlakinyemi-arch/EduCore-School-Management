// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({value:{data:undefined as any,isError:false,isLoading:false,refetch:vi.fn()}}));
vi.mock('@workspace/api-client-react',()=>({
  useGetMyStudentPlatformAccess:()=>state.value,getGetMyStudentPlatformAccessQueryKey:()=>['student-platform-access'],
}));
import { isStudentCorePage,StudentSubscriptionGuard } from './student-subscription-guard';
import { ArchivedPaymentWorkflowPage } from '../pages/archived-payment-workflow';
const render=(path:string)=>renderToStaticMarkup(<StudentSubscriptionGuard active actorId={9} path={path}><div>PRIVATE CORE DATA</div></StudentSubscriptionGuard>);
describe('student UI access and archived payment entry points',()=>{
  beforeEach(()=>{state.value={data:undefined,isError:false,isLoading:false,refetch:vi.fn()};});
  it.each(['/','/dashboard','/my-academics','/results','/timetable','/library','/reporting'])('protects core page %s while coverage loads',path=>{
    expect(isStudentCorePage(path)).toBe(true);expect(render(path)).not.toContain('PRIVATE CORE DATA');
  });
  it.each(['/account','/student-subscription','/my-fees','/inbox','/academic-calendar','/my-care','/my-transport'])('retains essential page %s when unpaid',path=>{
    expect(isStudentCorePage(path)).toBe(false);expect(render(path)).toContain('PRIVATE CORE DATA');
  });
  it('fails closed on errors and releases rendering only after a fresh verified response',()=>{
    state.value.isError=true;expect(render('/results')).not.toContain('PRIVATE CORE DATA');
    state.value.isError=false;state.value.data={restricted:true,students:[{schoolId:1,studentId:31,termId:4,status:'PAYMENT_REQUIRED'}]};
    expect(render('/results')).not.toContain('PRIVATE CORE DATA');
    state.value.data={restricted:false,students:[{schoolId:1,studentId:31,termId:4,status:'VERIFIED'}]};
    expect(render('/results')).toContain('PRIVATE CORE DATA');
  });
  it('explains full school fee payment, separate platform verification and retained card security',()=>{
    const html=render('/results');
    expect(html).toContain('without installments');expect(html).toContain('Card registration');
    expect(html).toContain('reconciliation');expect(html).toContain('receipt');
  });
  it('removes retired nav items and unmounts old payment page implementations',()=>{
    const nav=readFileSync(`${process.cwd()}/src/components/shared.tsx`,'utf8');
    expect(nav).not.toContain("label: 'Split Settlements'");expect(nav).not.toContain("label: 'Hosted Payments'");
    const app=readFileSync(`${process.cwd()}/src/App.tsx`,'utf8');
    expect(app).not.toContain('<HostedPaymentsPage');expect(app).not.toContain('<FlutterwaveSettlementsPage');
    const html=renderToStaticMarkup(<ArchivedPaymentWorkflowPage/>);
    expect(html).toContain('retained unchanged');expect(html).not.toMatch(/<form|<button|checkoutUrl/);
  });
});
