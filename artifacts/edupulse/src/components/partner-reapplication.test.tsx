// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
const state=vi.hoisted(()=>({ mutate:vi.fn(),clear:vi.fn(),signOut:vi.fn() }));
vi.mock('@workspace/api-client-react',()=>({ useReapplyPartnerAccount:()=>({mutate:state.mutate,isPending:false}) }));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({clear:state.clear})}));
vi.mock('@clerk/react',()=>({useClerk:()=>({signOut:state.signOut})}));
import { PartnerReapplication } from './partner-reapplication';
let host:HTMLDivElement,root:Root;
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  state.mutate.mockReset();state.clear.mockReset();state.signOut.mockReset();
  window.sessionStorage.clear();
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove()});
function fill(id:string,value:string){
  const el=host.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;
  const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
  act(()=>{
    Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);
    el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));
  });
}
function submit(){
  fill('input-full-name','Fresh Partner');fill('input-email','same@fictional.invalid');
  fill('input-phone','08012345678');fill('select-partner-type','INDIVIDUAL');
  act(()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
}
describe('explicit fresh Partner application',()=>{
  it('starts blank, cannot switch to School Admin, and never submits automatically',()=>{
    act(()=>root.render(<PartnerReapplication/>));
    expect((host.querySelector('[data-testid="input-email"]') as HTMLInputElement).value).toBe('');
    const type=host.querySelector('[data-testid="select-applicant-type"]') as HTMLSelectElement;
    expect(type.disabled).toBe(true);expect(type.value).toBe('PARTNER');
    expect(state.mutate).not.toHaveBeenCalled();
    expect(host.textContent).toContain('previous account remains archived');
  });
  it('submits new Partner details and clears all prior account query/portal state on success',()=>{
    const created=vi.fn();window.sessionStorage.setItem('edupulse:selected-portal','SCHOOL_ADMIN');
    act(()=>root.render(<PartnerReapplication onCreated={created}/>));submit();
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate.mock.calls[0][0].data).toMatchObject({applicantType:'PARTNER',email:'same@fictional.invalid'});
    expect(state.mutate.mock.calls[0][0].data).not.toHaveProperty('userId');
    act(()=>state.mutate.mock.calls[0][1].onSuccess());
    expect(state.clear).toHaveBeenCalledTimes(1);expect(created).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('edupulse:selected-portal')).toBeNull();
  });
  it('explains fresh sign-in failure without resubmitting or restoring the archived account',()=>{
    act(()=>root.render(<PartnerReapplication/>));submit();
    act(()=>state.mutate.mock.calls[0][1].onError({data:{error:'Sign out and sign in again before applying.'}}));
    expect(host.textContent).toContain('Sign out and sign in again before applying.');
    expect(state.mutate).toHaveBeenCalledTimes(1);expect(state.clear).not.toHaveBeenCalled();
    const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Sign out to sign in again')!;
    act(()=>button.click());expect(state.signOut).toHaveBeenCalledTimes(1);
  });
});
