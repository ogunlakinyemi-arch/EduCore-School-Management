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
  it('filters new School Admin and Partner applications and moves a decided row after refresh',()=>{
    state.rows=[
      {id:81,applicantType:'SCHOOL_ADMIN',fullName:'School Applicant',status:'PENDING',createdAt:'2026-10-19T00:00:00Z'},
      {id:82,applicantType:'PARTNER',fullName:'Partner Applicant',status:'APPROVED',createdAt:'2026-10-19T00:00:00Z'},
      {id:83,applicantType:'PARTNER',fullName:'Rejected Applicant',status:'REJECTED',createdAt:'2026-10-19T00:00:00Z'},
    ];
    render(<AccountApplicationsPanel/>);
    expect(host.textContent).toContain('School Applicant');
    expect(host.textContent).not.toContain('Partner Applicant');
    click('filter-approved');
    expect(host.textContent).toContain('Partner Applicant');
    expect(host.querySelector('[data-testid="button-approve-82"]')).toBeNull();
    click('filter-rejected');expect(host.textContent).toContain('Rejected Applicant');
    click('filter-pending');click('button-approve-81');click('button-confirm-decision');
    expect(state.decide).toHaveBeenCalledWith({applicationId:81,data:{status:'APPROVED'}},expect.any(Object));
    act(()=>state.decide.mock.calls[0][1].onSuccess());
    expect(state.invalidate).toHaveBeenCalledWith({queryKey:['applications']});
    state.rows[0].status='APPROVED';render(<AccountApplicationsPanel/>);
    expect(host.textContent).not.toContain('School Applicant');
    click('filter-approved');expect(host.textContent).toContain('School Applicant');
  });
  it('preserves the current referral intent when a typed school signup resumes an older draft',()=>{
    const original=window.location.pathname+window.location.search;
    try{
      window.history.replaceState(null,'','/sign-up?applicantType=SCHOOL_ADMIN');
      sessionStorage.setItem('edupulse:application-intent',JSON.stringify({type:'SCHOOL_ADMIN',referralToken:'current-referral-token'}));
      sessionStorage.setItem('edupulse:application-draft',JSON.stringify({savedAt:Date.now(),v:{
        applicantType:'SCHOOL_ADMIN',fullName:'Ada Obi',phone:'08031234567',schoolName:'Hill School',referralToken:'older-referral-token',
      }}));
      render(<AuthScreen mode="sign-up"/>);
      click('button-submit-application');
      expect(JSON.parse(sessionStorage.getItem('edupulse:application-draft')!).v.referralToken).toBe('current-referral-token');
    }finally{window.history.replaceState(null,'',original)}
  });
  it('validates, stores a draft, then shows Clerk only after Submit Application',()=>{
    render(<AuthScreen mode="sign-up"/>);
    expect(host.querySelector('[data-testid="clerk-signup"]')).toBeNull();
    click('button-submit-application');
    expect(host.querySelector('[data-testid="error-schoolName"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="clerk-signup"]')).toBeNull();
    input('input-school-name','Hill School');input('input-full-name','  Ada   Obi ');input('input-phone','0803 123 4567');
    click('button-submit-application');
    expect(host.querySelector('[data-testid="clerk-signup"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="footer-sign-in"]')).toBeNull();
    expect(host.textContent).toContain('finishing authentication submits your application');
    expect(state.submit).not.toHaveBeenCalled();
    const raw=sessionStorage.getItem('edupulse:application-draft')!;
    expect(raw).toContain('Hill School');expect(raw.toLowerCase()).not.toContain('password');
  });
  it('requires partner type and email, and drops school fields when switching type',()=>{
    render(<AuthScreen mode="sign-up"/>);
    input('input-school-name','Hill School');
    const sel=host.querySelector('[data-testid="select-applicant-type"]') as HTMLSelectElement;
    act(()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(sel,'PARTNER');sel.dispatchEvent(new Event('change',{bubbles:true}))});
    click('button-submit-application');
    expect(host.querySelector('[data-testid="error-email"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="error-partnerType"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="input-school-name"]')).toBeNull();
  });
  it('auto-submits a valid draft once and clears it on success',()=>{
    sessionStorage.setItem('edupulse:application-draft',JSON.stringify({savedAt:Date.now(),v:{applicantType:'SCHOOL_ADMIN',fullName:'Ada Obi',phone:'+2348031234567',schoolName:'Hill School'}}));
    render(<ApplicationPortal autoSubmit/>);
    render(<ApplicationPortal autoSubmit/>);
    expect(state.submit).toHaveBeenCalledTimes(1);
    expect(state.submit.mock.calls[0][0]).toEqual({data:{applicantType:'SCHOOL_ADMIN',fullName:'Ada Obi',phone:'+2348031234567',schoolName:'Hill School'}});
    act(()=>state.submit.mock.calls[0][1].onSuccess());
    expect(sessionStorage.getItem('edupulse:application-draft')).toBeNull();
    expect(state.invalidate).toHaveBeenCalledWith({queryKey:['my-application']});
  });
  it('keeps the form editable and refetches after a submit error',()=>{
    sessionStorage.setItem('edupulse:application-draft',JSON.stringify({savedAt:Date.now(),v:{applicantType:'SCHOOL_ADMIN',fullName:'Ada Obi',phone:'08031234567',schoolName:'Hill School'}}));
    render(<ApplicationPortal autoSubmit/>);
    act(()=>state.submit.mock.calls[0][1].onError({data:{error:'Lost response'}}));
    expect(host.querySelector('[data-testid="text-apply-error"]')?.textContent).toBe('Lost response');
    expect(state.refetch).toHaveBeenCalled();
    expect(host.querySelector('[data-testid="input-school-name"]')).not.toBeNull();
    expect(sessionStorage.getItem('edupulse:application-draft')).not.toBeNull();
  });
  it('does not auto-submit expired drafts or without the submit flag',()=>{
    sessionStorage.setItem('edupulse:application-draft',JSON.stringify({savedAt:Date.now()-31*60000,v:{applicantType:'SCHOOL_ADMIN',fullName:'A',phone:'+2348031234567',schoolName:'S'}}));
    render(<ApplicationPortal autoSubmit/>);
    expect(state.submit).not.toHaveBeenCalled();
  });
  it('direct apply submits the reusable form with normalized fields',()=>{
    render(<ApplicationPortal/>);
    input('input-school-name','Application School');input('input-full-name','First Last');input('input-phone','0803 123 4567');
    act(()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(state.submit.mock.calls[0][0]).toEqual({data:{applicantType:'SCHOOL_ADMIN',fullName:'First Last',phone:'+2348031234567',schoolName:'Application School'}});
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
