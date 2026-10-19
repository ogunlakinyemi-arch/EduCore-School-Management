// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({
  my: {application:null,eligible:true} as any,
  rows: [] as any[], submit:vi.fn(), decide:vi.fn(), invalidate:vi.fn(), refetch:vi.fn(), navigate:vi.fn(),
}));
vi.mock('@clerk/react',()=>({
  useAuth:()=>({isLoaded:true,isSignedIn:true}), useClerk:()=>({signOut:vi.fn()}),
  SignIn:()=> <div>Clerk sign in</div>, SignUp:()=> <div data-testid="clerk-signup">Clerk sign up</div>,
}));
vi.mock('wouter',()=>({useLocation:()=>['/',state.navigate],Redirect:()=>null,
  Link:({children,href}:any)=><a href={href}>{children}</a>}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:state.invalidate,refetchQueries:state.refetch})}));
vi.mock('@workspace/api-client-react',()=>({
  useGetMyAccountApplication:()=>({data:state.my,isLoading:false,isError:false,refetch:state.refetch}),
  useSubmitAccountApplication:()=>({mutate:state.submit,isPending:false}),
  useGetAccountApplications:()=>({data:state.rows,isLoading:false,isError:false,refetch:state.refetch}),
  useDecideAccountApplication:()=>({mutate:state.decide}),
  getGetMyAccountApplicationQueryKey:()=>['my-application'],
  getGetAuthorizedContextQueryKey:()=>['authorized-context'],
  getGetAccountApplicationsQueryKey:()=>['applications'],
}));
import {ApplicationPortal} from './apply';
import {AuthScreen} from './auth-screen';
import AccountApplicationsPanel from '@/components/account-applications-panel';

let root:Root,host:HTMLDivElement;
beforeEach(()=>{
  vi.clearAllMocks();sessionStorage.clear();
  state.my={application:null,eligible:true};state.rows=[];
  state.invalidate.mockResolvedValue(undefined);state.refetch.mockResolvedValue(undefined);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove()});
const render=(node:React.ReactNode)=>act(()=>root.render(node));
const click=(id:string)=>act(()=>{(host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).click()});
const input=(id:string,value:string)=>{
  const el=host.querySelector(`[data-testid="${id}"]`) as HTMLInputElement|HTMLTextAreaElement;
  const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  act(()=>{
    Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);
    el.dispatchEvent(new Event('input',{bubbles:true}));
  });
};
describe('public application UI behavior',()=>{
  it('requires choosing School Admin or Partner before public Clerk signup',()=>{
    render(<AuthScreen mode="sign-up"/>);
    expect(host.querySelector('[data-testid="clerk-signup"]')).toBeNull();
    expect([...host.querySelectorAll('[data-testid^="choose-"]')].map(n=>n.textContent)).toEqual(['School Admin','Partner']);
    click('choose-partner');
    expect(host.querySelector('[data-testid="clerk-signup"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="application-approval-notice"]')?.textContent).toContain('Partner application');
    expect(host.textContent).toContain('Platform Owner approval is required');
    expect(sessionStorage.getItem('edupulse:application-intent')).toContain('PARTNER');
  });
  it('submits complete school details without client-owned user, status or role grants',()=>{
    render(<ApplicationPortal/>);
    for(const [id,value] of Object.entries({
      'input-first-name':'First','input-last-name':'Last','input-phone':'+2348000000000',
      'input-city':'Lagos','input-state':'Lagos','input-school-name':'Application School',
    })) input(id,value);
    act(()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(state.submit).toHaveBeenCalledWith({data:{
      applicantType:'SCHOOL_ADMIN',firstName:'First',lastName:'Last',phone:'+2348000000000',
      city:'Lagos',state:'Lagos',schoolName:'Application School',
    }},expect.any(Object));
    const options=state.submit.mock.calls[0][1];
    act(()=>options.onSuccess());
    expect(state.invalidate).toHaveBeenCalledWith({queryKey:['my-application']});
  });
  it.each(['PENDING','REJECTED'])('shows %s without a portal access action',(status)=>{
    state.my={application:{id:3,status,rejectionReason:'Not verified'},eligible:false};
    render(<ApplicationPortal/>);
    expect(host.textContent).toContain(status);
    expect(host.querySelector('[data-testid="button-open-dashboard"]')).toBeNull();
    if(status==='REJECTED')expect(host.textContent).toContain('Not verified');
  });
  it('refreshes authorization before entering the approved dashboard',async()=>{
    state.my={application:{id:3,status:'APPROVED'},eligible:false};
    sessionStorage.setItem('edupulse:selected-portal','TEACHER');
    render(<ApplicationPortal/>);
    await act(async()=>{(host.querySelector('[data-testid="button-open-dashboard"]') as HTMLButtonElement).click()});
    expect(state.refetch).toHaveBeenCalledWith({queryKey:['authorized-context']});
    expect(sessionStorage.getItem('edupulse:selected-portal')).toBeNull();
    expect(state.navigate).toHaveBeenCalledWith('/');
  });
  it('requires Owner confirmation and reason for rejection, then refreshes the directory',()=>{
    state.rows=[{id:5,applicantType:'PARTNER',firstName:'Partner',lastName:'Applicant',status:'PENDING',createdAt:'2026-10-19T00:00:00Z'}];
    render(<AccountApplicationsPanel/>);
    click('button-reject-5');
    expect((host.querySelector('[data-testid="button-confirm-decision"]') as HTMLButtonElement).disabled).toBe(true);
    input('input-rejection-reason','Details not verified');
    click('button-confirm-decision');
    expect(state.decide).toHaveBeenCalledWith({applicationId:5,data:{status:'REJECTED',reason:'Details not verified'}},expect.any(Object));
    act(()=>state.decide.mock.calls[0][1].onSuccess());
    expect(state.invalidate).toHaveBeenCalledWith({queryKey:['applications']});
  });
});
