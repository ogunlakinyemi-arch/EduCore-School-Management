// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ApiError} from '@workspace/api-client-react';

const state=vi.hoisted(()=>({
  query: {isLoading:false,isError:false,error:null as unknown,
    data:undefined as {frontImage:string;backImage:string}|undefined,refetch:vi.fn()},
  hook:vi.fn(),userId:'owner-existing',
}));
vi.mock('@clerk/react',()=>({useAuth:()=>({userId:state.userId})}));
vi.mock('@workspace/api-client-react',async importOriginal=>{
  const actual=await importOriginal<typeof import('@workspace/api-client-react')>();
  return {...actual,useGetOfficialCardPreview:(...args:unknown[])=>{state.hook(...args);return state.query;}};
});
vi.mock('./shared',()=>({
  Button:({children,onClick,testId}:{children:React.ReactNode;onClick:()=>void;testId:string})=>
    <button onClick={onClick} data-testid={testId}>{children}</button>,
  Modal:({children,title,onClose}:{children:React.ReactNode;title:string;onClose:()=>void})=>
    <div role="dialog"><h2>{title}</h2><button onClick={onClose}>Close</button>{children}</div>,
  ErrorState:({message,retry}:{message:string;retry:()=>void})=>
    <div><p>{message}</p><button onClick={retry}>Retry request</button></div>,
}));
import {OfficialCardPreview} from './official-card-preview';
let root:Root,host:HTMLDivElement;
async function click(text:string) {
  const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text);
  expect(button).toBeDefined();
  await act(async()=>button!.click());
}
describe('OfficialCardPreview',()=>{
  beforeEach(async()=>{
    (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
    state.query={isLoading:false,isError:false,error:null,data:undefined,refetch:vi.fn()};
    state.hook.mockClear();
    state.userId='owner-existing';
    host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
    await act(async()=>root.render(<OfficialCardPreview cardId={29} schoolId={1393}/>));
  });
  afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
  it('loads both current front and back only after opening, using the selected school and identity cache',async()=>{
    expect(state.hook.mock.lastCall?.[2].query.enabled).toBe(false);
    state.query.data={frontImage:'data:image/png;base64,front',backImage:'data:image/png;base64,back'};
    await click('View ID card');
    expect(state.hook.mock.lastCall).toEqual([29,{schoolId:1393},expect.objectContaining({
      query:expect.objectContaining({enabled:true,queryKey:['official-card-preview','owner-existing',1393,29],staleTime:0,gcTime:0}),
    })]);
    expect(Array.from(host.querySelectorAll('img')).map(img=>img.getAttribute('src'))).toEqual([state.query.data.frontImage,state.query.data.backImage]);
    expect(host.textContent).toContain('Preview only');
    expect(host.querySelector('a[download]')).toBeNull();
    await click('Close');expect(host.querySelector('[role="dialog"]')).toBeNull();
    await click('View ID card');expect(host.querySelectorAll('img')).toHaveLength(2);
  });
  it.each([
    [409,'No active ID card is assigned to this person.'],
    [403,"Only the Platform Owner or this school's Admin may view official card previews"],
    [404,'NFC card not found in this school'],
    [503,'Official card preview is unavailable; please retry'],
  ])('shows the specific sanitized API reason for status %s and supports retry',async(status,message)=>{
    state.query.isError=true;
    state.query.error=new ApiError(new Response(null,{status}),{error:message},{method:'GET',url:'/api/cards/29/preview?schoolId=1393'});
    await click('View ID card');
    expect(host.textContent).toContain(message);
    expect(host.textContent).not.toContain('unavailable or you do not have permission');
    await click('Retry request');expect(state.query.refetch).toHaveBeenCalledOnce();
  });
  it('does not invent a permission denial for a network error',async()=>{
    state.query.isError=true;state.query.error=new Error('network unavailable');
    await click('View ID card');
    expect(host.textContent).toContain('The ID card preview could not be loaded. Please retry.');
  });
  it('shows loading instead of an empty preview',async()=>{
    state.query.isLoading=true;await click('View ID card');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading');
  });
});
