// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({owner:true,request:vi.fn()}));
vi.mock('@workspace/api-client-react',()=>({
  customFetch:(...args:unknown[])=>state.request(...args),
  useGetAuthorizedContext:()=>({data:{isPlatformOwner:state.owner}}),
  getListCardsQueryKey:()=>['/api/cards'],
}));
vi.mock('@/components/uid-actions',()=>({backendError:(e:Error)=>e.message}));
vi.mock('@/components/owner-uid-reader',()=>({uidInventoryKey:['owner-uid-inventory']}));
vi.mock('@/components/shared',()=>({
  Button:({children,testId,variant,...props}:any)=><button data-testid={testId} {...props}>{children}</button>,
  Field:({label,children}:any)=><label>{label}{children}</label>,
  Modal:({title,children,onClose}:any)=><div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close</button></div>,
}));
import {OwnerDetachCard} from './owner-detach-card';
let root:Root,host:HTMLDivElement,qc:QueryClient;
const done=vi.fn();
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  state.owner=true;state.request.mockReset();state.request.mockResolvedValue({detached:true,status:'unassigned'});done.mockReset();
  qc=new QueryClient({defaultOptions:{queries:{retry:false}}});host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());qc.clear();host.remove();});
async function mount(card={id:5,uid:'AABBCCDD',status:'active'},personType:'STUDENT'|'TEACHER'|'STAFF'='STUDENT'){
  await act(async()=>root.render(<QueryClientProvider client={qc}><OwnerDetachCard schoolId={2} personId={3}
    personName="Fixture Person" personType={personType} card={card} onDetached={done}/></QueryClientProvider>));
}
const q=(id:string)=>host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
async function click(id:string){await act(async()=>q(id).click());}
async function value(id:string,value:string){
  const el=q(id) as HTMLInputElement|HTMLSelectElement;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(el,value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));
  });
}
it('is hidden from non-Owners and for missing or non-current cards',async()=>{
  state.owner=false;await mount();expect(q('button-direct-unlink')).toBeNull();
  state.owner=true;
  for(const status of ['lost','replaced','unassigned','inactive']){await mount({id:5,uid:'AABBCCDD',status});expect(q('button-direct-unlink')).toBeNull();}
  await mount({id:0,uid:'',status:'active'});expect(q('button-direct-unlink')).toBeNull();
});
it.each(['STUDENT','TEACHER','STAFF'] as const)('offers %s direct unlink without reporting loss',async type=>{
  await mount(undefined,type);expect(q('button-direct-unlink').textContent).toBe('Unlink Card');
  await click('button-direct-unlink');expect(host.textContent).toContain('detached from');
  expect(host.textContent).toContain('Fixture Person');expect(host.textContent).toContain('No replacement or charge');
  expect(state.request).not.toHaveBeenCalled();
});
it('cancellation sends no request and reopening clears confirmation/reason',async()=>{
  await mount();await click('button-direct-unlink');await value('select-direct-unlink-reason','Correction');
  await click('confirm-direct-unlink');await click('cancel-direct-unlink');expect(state.request).not.toHaveBeenCalled();
  await click('button-direct-unlink');
  expect((q('select-direct-unlink-reason') as HTMLSelectElement).value).toBe('');
  expect((q('confirm-direct-unlink') as HTMLInputElement).checked).toBe(false);
});
it('requires a reason and explicit confirmation, then sends the selected person and refreshes data',async()=>{
  await mount();const invalidate=vi.spyOn(qc,'invalidateQueries');await click('button-direct-unlink');
  expect((q('confirm-direct-unlink-submit') as HTMLButtonElement).disabled).toBe(true);
  await value('select-direct-unlink-reason','Reassignment');
  expect((q('confirm-direct-unlink-submit') as HTMLButtonElement).disabled).toBe(true);
  await click('confirm-direct-unlink');await click('confirm-direct-unlink-submit');
  expect(state.request).toHaveBeenCalledTimes(1);
  expect(state.request.mock.calls[0][0]).toBe('/api/platform/uid-inventory/cards/5/unlink');
  expect(JSON.parse(state.request.mock.calls[0][1].body)).toEqual({kind:'DETACH',schoolId:2,personId:3,personType:'STUDENT',confirm:true,reason:'Reassignment'});
  expect(invalidate).toHaveBeenCalledWith({queryKey:['owner-link-emp-cards']});
  expect(invalidate).toHaveBeenCalledWith({queryKey:['/api/cards']});
  expect(invalidate).toHaveBeenCalledWith({queryKey:['owner-link-students']});
  expect(done).toHaveBeenCalledTimes(1);expect(host.querySelector('[role=dialog]')).toBeNull();
});
it('requires meaningful Other details and retains server failure in the confirmation',async()=>{
  state.request.mockRejectedValue(new Error('Card link changed; refresh'));
  await mount();await click('button-direct-unlink');await value('select-direct-unlink-reason','Other');await click('confirm-direct-unlink');
  expect((q('confirm-direct-unlink-submit') as HTMLButtonElement).disabled).toBe(true);
  await value('input-direct-unlink-details','  Duplicate assignment corrected  ');
  await click('confirm-direct-unlink-submit');
  expect(JSON.parse(state.request.mock.calls[0][1].body).reason).toBe('Other: Duplicate assignment corrected');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Card link changed');
  expect(done).not.toHaveBeenCalled();expect(host.querySelector('[role=dialog]')).not.toBeNull();
});
