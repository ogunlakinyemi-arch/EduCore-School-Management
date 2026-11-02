// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({
  owner:true,data:null as any,fetching:false,error:null as Error|null,mutate:vi.fn(),invalidate:vi.fn(),refetch:vi.fn(),
  readiness:vi.fn(),preview:vi.fn(),download:vi.fn(),previewData:null as any,mutationError:null as Error|null,control:vi.fn(),
}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:state.invalidate})}));
vi.mock('@workspace/api-client-react',()=>({
  useGetAuthorizedContext:()=>({data:{isPlatformOwner:state.owner,user:{id:9}}}),
  useGetOwnerStudentCardReadiness:(...args:unknown[])=>{
    state.readiness(...args);return {data:state.data,isFetching:state.fetching,isError:!!state.error,error:state.error,refetch:state.refetch};
  },
  useGetOfficialCardPreview:(...args:unknown[])=>{state.preview(...args);return {data:state.previewData};},
  useControlOwnerStudentCard:()=>({mutate:state.control,reset:vi.fn(),isError:false,error:null,isPending:false}),
  useUpdateCardStatus:()=>({mutate:state.mutate,reset:vi.fn(),isError:!!state.mutationError,error:state.mutationError,isPending:false}),
  getListCardsQueryKey:()=>['/api/cards'],downloadPrintableNfcCard:(...args:unknown[])=>state.download(...args),
}));
vi.mock('@/components/uid-actions',()=>({backendError:(e:Error)=>e.message}));
vi.mock('./shared',()=>({
  Button:({children,testId,variant,...props}:any)=><button data-testid={testId} {...props}>{children}</button>,
  Field:({label,children}:any)=><label>{label}{children}</label>,
  Modal:({title,children}:any)=><div role="dialog" aria-label={title}>{children}</div>,
}));
import {OwnerStudentCardLifecycle} from './owner-student-card-lifecycle';
let root:Root,host:HTMLDivElement;
const props={cardId:101,schoolId:2,studentId:3,uid:'NEW12345',autoPreview:true};
const q=(id:string)=>host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
async function mount(override={}){
  await act(async()=>root.render(<OwnerStudentCardLifecycle {...props} {...override}/>));
}
async function click(id:string){await act(async()=>q(id)!.click());}
async function input(id:string,value:string){
  const el=q(id) as HTMLInputElement;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});
}
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  state.owner=true;state.fetching=false;state.error=null;state.mutationError=null;
  state.data={...props,status:'locked',stage:'AWAITING_ACTIVATION',explanation:'New UID linked; Owner activation required.',canActivate:true,canPrint:false,restrictions:[],
    version:4,canLock:false,canGrantGrace:false,canRevokeGrace:false,effectiveStatus:'locked',statusSource:'STAGED',serverNow:new Date().toISOString(),grace:{state:'NONE',grant:null},history:[]};
  state.previewData={frontImage:'data:image/png;base64,NEW-FRONT',backImage:'data:image/png;base64,SCHOOL-BACK'};
  for(const fn of [state.mutate,state.invalidate,state.refetch,state.readiness,state.preview,state.download,state.control])fn.mockReset();
  state.invalidate.mockResolvedValue(undefined);state.download.mockResolvedValue(new Blob(['%PDF-fixture'],{type:'application/pdf'}));
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:new-uid-card')});
  Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
it('explains a staged lock and never offers a printable student card before activation',async()=>{
  await mount();expect(host.textContent).toContain('Owner activation required');
  expect(q('button-owner-activate-card')).not.toBeNull();expect(q('linked-card-preview')).toBeNull();
  expect(q('button-download-nfc-card-101')).toBeNull();
  expect(state.preview.mock.calls.at(-1)![2].query.enabled).toBe(false);
});
it('requires confirmation and a meaningful reason; cancelling changes nothing',async()=>{
  await mount();await click('button-owner-activate-card');
  expect((q('submit-card-activation') as HTMLButtonElement).disabled).toBe(true);
  await input('input-card-activation-reason','Reviewed holder and new UID');
  expect((q('submit-card-activation') as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Cancel')!.click());
  expect(state.mutate).not.toHaveBeenCalled();expect(host.querySelector('[role=dialog]')).toBeNull();
});
it('activates the exact saved card/student with a reason and refreshes card/person state',async()=>{
  await mount();await click('button-owner-activate-card');
  await input('input-card-activation-reason','Reviewed holder and new UID');await click('confirm-card-activation');await click('submit-card-activation');
  expect(state.mutate.mock.calls[0][0]).toEqual({cardId:101,data:{status:'active',studentId:3,confirm:true,reason:'Reviewed holder and new UID'}});
  state.data={...state.data,status:'active',canActivate:false,canPrint:true};
  await act(async()=>state.mutate.mock.calls[0][1].onSuccess());
  await mount();
  expect(state.invalidate).toHaveBeenCalledWith({queryKey:['/api/cards']});
  expect(state.invalidate).toHaveBeenCalledWith({queryKey:['owner-link-students']});
  expect(q('linked-card-preview')).not.toBeNull();
  expect(host.querySelector('img')?.alt).toContain('NEW12345');
  expect(q('button-download-nfc-card-101')).not.toBeNull();
});
it('automatically renders actual returned school-branded images for the new UID and downloads through the existing PDF workflow',async()=>{
  state.data={...state.data,status:'active',canActivate:false,canPrint:true};
  const anchor=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  await mount();
  expect(host.querySelector('img')?.getAttribute('src')).toBe(state.previewData.frontImage);
  expect([...host.querySelectorAll('img')][1].getAttribute('src')).toBe(state.previewData.backImage);
  expect(state.preview.mock.calls.at(-1)!.slice(0,2)).toEqual([101,{schoolId:2}]);
  expect(host.textContent).not.toContain('OLD12345');
  expect((q('button-download-nfc-card-101') as HTMLButtonElement).type).toBe('button');
  await click('button-download-nfc-card-101');
  expect(state.download).toHaveBeenCalledWith(101,{schoolId:2},{responseType:'blob'});expect(anchor).toHaveBeenCalledOnce();
});
it('preserves genuine restrictions and explains the correct resolution without an unlock button',async()=>{
  state.data={...state.data,stage:'SECURITY_LOCK',explanation:'Security hold: possession disputed',canActivate:false,
    restrictions:[{code:'SCHOOL_SUBSCRIPTION_LOCKED',message:'School-wide lock applies',resolution:'Review existing Owner school restrictions'}]};
  await mount();expect(host.textContent).toContain('possession disputed');expect(host.textContent).toContain('Review existing Owner');
  expect(q('button-owner-activate-card')).toBeNull();expect(q('linked-card-preview')).toBeNull();
});
it('does not show a previous UID preview, failed readiness, or cached printable state while rechecking',async()=>{
  state.data={...state.data,uid:'OLD12345',status:'active',canPrint:true};await mount();expect(q('linked-card-preview')).toBeNull();
  expect(host.textContent).toContain('assignment changed');
  state.data={...state.data,uid:'NEW12345'};state.error=new Error('Assignment no longer current');
  await mount();expect(q('button-download-nfc-card-101')).toBeNull();
  state.error=null;state.fetching=true;await mount();expect(q('linked-card-preview')).toBeNull();
});
it('hides Owner-only activation and printing from other roles',async()=>{
  state.owner=false;await mount();expect(host.textContent).toBe('');expect(state.mutate).not.toHaveBeenCalled();
});
it('retains a failed activation in the dialog and never presents final print output',async()=>{
  state.mutationError=new Error('Payment verification required');
  await mount();await click('button-owner-activate-card');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Payment verification required');
  expect(q('button-download-nfc-card-101')).toBeNull();
});
async function setVal(id:string,value:string,tag:'input'|'textarea'='input'){
  const el=q(id)!;const proto=tag==='input'?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;
  await act(async()=>{Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});
}
const payR={code:'NFC_FLUTTERWAVE_PAYMENT_REQUIRED',message:'NFC payment due',resolution:'Pay',overridable:true};
const subR={code:'SUBSCRIPTION_REQUIRED',message:'Subscription due',resolution:'Renew',overridable:true};
it('grant grace requires selected restrictions, future local expiry, trimmed reason and confirmation; sends UTC and captured version',async()=>{
  state.data={...state.data,stage:'RESTRICTED',canActivate:false,canGrantGrace:true,restrictions:[payR,subR]};
  await mount();await click('button-card-grant-grace');
  expect(host.textContent).toContain('browser local timezone');
  const submit=()=>q('submit-card-control') as HTMLButtonElement;
  await setVal('input-card-control-reason','  ab  ','textarea');await click('confirm-card-control');expect(submit().disabled).toBe(true);
  await setVal('input-card-control-reason','  Parent paying Friday  ','textarea');expect(submit().disabled).toBe(true);
  await setVal('input-grace-expiry','2099-01-02T09:30');expect(submit().disabled).toBe(true);
  await click('check-grace-SUBSCRIPTION_REQUIRED');expect(submit().disabled).toBe(false);
  await click('submit-card-control');
  expect(state.control.mock.calls[0][0]).toEqual({cardId:101,data:{schoolId:2,studentId:3,version:4,confirm:true,reason:'Parent paying Friday',
    action:'GRANT_GRACE',expiresAt:new Date('2099-01-02T09:30').toISOString(),restrictions:['SUBSCRIPTION_REQUIRED']}});
});
it('blocks submit when readiness version changes after the dialog opened',async()=>{
  state.data={...state.data,stage:'ACTIVE',canActivate:false,canLock:true};
  await mount();await click('button-card-lock');
  state.data={...state.data,version:5};await mount();
  await setVal('input-card-control-reason','Lost on trip','textarea');await click('confirm-card-control');
  expect(q('text-control-stale')).not.toBeNull();expect((q('submit-card-control') as HTMLButtonElement).disabled).toBe(true);
});
it('preserves a pending reason during polling, disables submission while refreshing and resets on UID selection change',async()=>{
  state.data={...state.data,stage:'ACTIVE',canActivate:false,canLock:true};
  await mount();await click('button-card-lock');
  await setVal('input-card-control-reason','Approved temporary pause','textarea');await click('confirm-card-control');
  state.fetching=true;await mount();
  expect((q('input-card-control-reason') as HTMLTextAreaElement).value).toBe('Approved temporary pause');
  expect((q('submit-card-control') as HTMLButtonElement).disabled).toBe(true);
  state.fetching=false;await mount();
  expect((q('submit-card-control') as HTMLButtonElement).disabled).toBe(false);
  state.data={...state.data,uid:'DIFFERENT_UID'};await mount({uid:'DIFFERENT_UID'});
  expect(q('submit-card-control')).toBeNull();
});
it('offers unlock only for administrative lock, never for security lock',async()=>{
  state.data={...state.data,stage:'ADMINISTRATIVE_LOCK',canActivate:true};await mount();
  expect(q('button-card-unlock')).not.toBeNull();expect(q('button-owner-activate-card')).toBeNull();
  state.data={...state.data,stage:'SECURITY_LOCK',canActivate:true};await mount();
  expect(q('button-card-unlock')).toBeNull();
});
it('states partial waiver honestly and shows grantor, expiry, coverage and history',async()=>{
  const grant={id:7,action:'GRANT_GRACE',reason:'Fee promised',actorUserId:9,createdAt:'2025-01-01T10:00:00Z',details:{expiresAt:'2099-01-01T00:00:00Z',restrictions:['SUBSCRIPTION_REQUIRED']}};
  state.data={...state.data,stage:'RESTRICTED',canActivate:false,canRevokeGrace:true,statusSource:'GRACE',
    restrictions:[{...payR},{...subR,waived:true}],grace:{state:'ACTIVE',grant},history:[grant]};
  await mount();
  expect(q('text-grace-coverage')!.textContent).toContain('1 of 2');expect(q('text-grace-coverage')!.textContent).toContain('still apply');
  expect(q('grace-grant')!.textContent).toContain('user #9');expect(q('grace-grant')!.textContent).toContain('SUBSCRIPTION_REQUIRED');
  expect(q('history-event-7')!.textContent).toContain('Fee promised');expect(q('button-card-revoke-grace')).not.toBeNull();
});
it('disables grace UI and printing on the local clock at expiry even if cached data says printable',async()=>{
  const grant={id:8,action:'GRANT_GRACE',reason:'r',actorUserId:9,createdAt:'2020-01-01T00:00:00Z',details:{expiresAt:'2020-01-02T00:00:00Z',restrictions:['SUBSCRIPTION_REQUIRED']}};
  state.data={...state.data,status:'active',stage:'ACTIVE',canActivate:false,canPrint:true,canRevokeGrace:true,grace:{state:'ACTIVE',grant},history:[grant]};
  await mount();
  expect(q('text-grace-expired')).not.toBeNull();expect(q('button-card-revoke-grace')).toBeNull();
  expect(q('button-download-nfc-card-101')).toBeNull();expect(q('linked-card-preview')).toBeNull();
});
