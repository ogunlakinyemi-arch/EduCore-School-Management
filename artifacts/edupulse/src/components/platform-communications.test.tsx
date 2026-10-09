// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(()=>({ requests: [] as {path:string;method?:string;body?:any}[], lostResponse:false, pausePreview:false, releasePreview:null as null|(()=>void) }));
vi.mock('@/hooks/use-phase9-api',()=>({
  phase9Request: async(path:string,method?:string,body?:any)=>{
    state.requests.push({path,method,body});
    if(path.endsWith('/directory')) return {schools:[
      {id:11,name:'North School',code:'NORTH',status:'ACTIVE'},
      {id:12,name:'South School',code:'SOUTH',status:'active'},
      {id:13,name:'Retired School',code:'OLD',status:'inactive'},
    ]};
    if(path.endsWith('/preview')){
      if(state.pausePreview) await new Promise<void>(resolve=>{state.releasePreview=resolve;});
      return {schools:body.schoolIds.map((id:number)=>({id,name:id===11?'North School':'South School',recipientCount:1})),recipientCount:body.schoolIds.length};
    }
    if(method==='POST'){
      if(state.lostResponse){state.lostResponse=false;throw Error('Lost response');}
      return {campaigns:[{id:101,schoolId:11,status:'QUEUED'}]};
    }
    return {campaigns:[]};
  },
}));
vi.mock('@/components/shared',()=>({
  PageHeading:({title,action}:any)=><header><h1>{title}</h1>{action}</header>,
  Button:({testId,children,variant,...props}:any)=><button data-testid={testId} {...props}>{children}</button>,
  Field:({label,children}:any)=><label>{label}{children}</label>,
  StatusPill:({value}:any)=><span>{value}</span>,
  EmptyState:({title}:any)=><p>{title}</p>,
  ErrorState:()=><p>Error</p>,
  SkeletonPage:()=><p>Loading</p>, date:()=>'', time:()=>'',
}));
import { PlatformCommunications } from './platform-communications';

let root:Root, host:HTMLDivElement, qc:QueryClient;
const get=(id:string)=>host.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;
async function settle(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,15));});}
async function click(id:string){await act(async()=>{get(id).click();});await settle();}
async function value(id:string,val:string){
  await act(async()=>{
    const el=get(id);
    const prototype=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(el,val);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));
  });
  await settle();
}
async function draft(){await click('checkbox-comm-school-11');await value('input-comm-subject','QA message');await value('textarea-comm-body','Development-only test message.');}
beforeEach(async()=>{
  state.requests=[];state.lostResponse=false;state.pausePreview=false;state.releasePreview=null;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  await act(async()=>{root.render(<QueryClientProvider client={qc}><PlatformCommunications /></QueryClientProvider>);});
  await settle();
});
afterEach(async()=>{await act(async()=>root.unmount());qc.clear();host.remove();vi.restoreAllMocks();});

describe('Owner Communications selection and confirmation',()=>{
  it('never selects schools or broadcasts by default',()=>{
    expect(get('text-comm-count').textContent).toContain('0 of 50');
    expect(get('checkbox-comm-school-11').checked).toBe(false);
    expect(get('checkbox-comm-school-13')).toBeNull();
    expect(get('button-comm-send').disabled).toBe(true);
    expect(state.requests.filter(r=>r.method==='POST')).toHaveLength(0);
  });
  it('searches by name/code and filters without silently removing selected schools',async()=>{
    await click('checkbox-comm-school-11');
    await value('input-comm-school-search','south');
    expect(get('checkbox-comm-school-11')).toBeNull();
    expect(get('checkbox-comm-school-12')).not.toBeNull();
    expect(get('text-comm-selected-schools').textContent).toContain('North School');
    await value('input-comm-school-search','');
    await value('select-comm-school-filter','selected');
    expect(get('checkbox-comm-school-11').checked).toBe(true);
    expect(get('checkbox-comm-school-12')).toBeNull();
    await value('select-comm-school-filter','unselected');
    expect(get('checkbox-comm-school-11')).toBeNull();
    expect(get('checkbox-comm-school-12')).not.toBeNull();
  });
  it('reviews multiple named schools, sends only on confirmation, and invalidates changed previews',async()=>{
    await draft();await click('checkbox-comm-school-12');await click('button-comm-preview');
    expect(get('panel-comm-preview').textContent).toContain('North School');
    expect(get('panel-comm-preview').textContent).toContain('South School');
    await click('button-comm-send');
    expect(state.requests.filter(r=>r.path==='/platform/communications'&&r.method==='POST')).toHaveLength(0);
    await value('textarea-comm-body','Changed body');
    expect(get('panel-comm-preview')).toBeNull();
    expect(get('panel-comm-confirm')).toBeNull();
    expect(get('button-comm-send').disabled).toBe(true);
    await click('button-comm-preview');await click('button-comm-send');await click('button-comm-confirm');
    const sends=state.requests.filter(r=>r.path==='/platform/communications'&&r.method==='POST');
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toMatchObject({schoolIds:[11,12],subject:'QA message',body:'Changed body',confirmedRecipientCount:2});
    expect(get('text-comm-notice').textContent).toContain('in-app only');
  });
  it('freezes audience and draft during recipient preview to avoid confirming stale recipients',async()=>{
    await draft();state.pausePreview=true;await click('button-comm-preview');
    expect(get('checkbox-comm-school-12').disabled).toBe(true);
    expect(get('input-comm-subject').disabled).toBe(true);
    await act(async()=>state.releasePreview!());await settle();
    expect(get('checkbox-comm-school-12').disabled).toBe(false);
  });
  it('retries the identical confirmed payload and submission key after an uncertain response',async()=>{
    await draft();await click('button-comm-preview');await click('button-comm-send');
    state.lostResponse=true;await click('button-comm-confirm');
    expect(get('input-comm-subject').disabled).toBe(true);
    await click('button-comm-retry');
    const sends=state.requests.filter(r=>r.path==='/platform/communications'&&r.method==='POST');
    expect(sends).toHaveLength(2);
    expect(sends[1].body).toEqual(sends[0].body);
    expect(get('text-comm-notice').textContent).toContain('Saved for 1 school');
  });
});
