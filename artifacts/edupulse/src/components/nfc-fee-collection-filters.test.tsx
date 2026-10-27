// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const fixture=vi.hoisted(()=>({
  terms:[
    {id:4,schoolId:3,schoolName:'Fictional School A',sessionName:'2026 / 2027',name:'First Term',
      startDate:'2026-09-01',endDate:'2026-12-20',isCurrent:true},
    {id:5,schoolId:8,schoolName:'Fictional School B',sessionName:'2026 / 2027',name:'First Term',
      startDate:'2026-09-02',endDate:'2026-12-21',isCurrent:true},
    {id:6,schoolId:3,schoolName:'Fictional School A',sessionName:'2025 / 2026',name:'First Term',
      startDate:'2025-09-01',endDate:'2025-12-20',isCurrent:false},
  ],
  rowCalls:[] as {params:Record<string,unknown>;enabled:boolean}[],
  choiceCalls:[] as {schoolId?:number}[],
  loadingSchool:null as number|null,
  error:false,empty:false,
}));
vi.mock('@workspace/api-client-react',async original=>({
  ...(await original<object>()),
  useGetAuthorizedContext:()=>({data:{user:{id:42},isPlatformOwner:true},isLoading:false,isError:false,refetch:vi.fn()}),
  useGetNfcFeeCollectionFilterOptions:(params:{schoolId?:number})=>{
    fixture.choiceCalls.push(params);
    const loading=params.schoolId===fixture.loadingSchool;
    return {data:loading||fixture.error?undefined:{
      schools:[{id:3,name:'Fictional School A'},{id:8,name:'Fictional School B'}],
      terms:fixture.empty?[]:fixture.terms.filter(t=>!params.schoolId||t.schoolId===params.schoolId)},
      isSuccess:!loading&&!fixture.error,isError:fixture.error,isLoading:loading,isFetching:loading,refetch:vi.fn()};
  },
  useGetNfcFeeCollectionOversight:(params:Record<string,unknown>,options:{query:{enabled:boolean}})=>{
    fixture.rowCalls.push({params,enabled:options.query.enabled});
    return {data:{items:[],total:60},isLoading:false,isError:false,isFetching:false,dataUpdatedAt:0,refetch:vi.fn()};
  },
}));
import {NfcFeeCollectionOversight,defaultOversightTerm,oversightTermLabel} from './nfc-fee-collection-oversight';

let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
const element=<NfcFeeCollectionOversight/>;
const school=()=>host.querySelector<HTMLSelectElement>('[data-testid="select-oversight-school"]')!;
const term=()=>host.querySelector<HTMLSelectElement>('[data-testid="select-oversight-term"]')!;
const applied=()=>fixture.rowCalls.filter(c=>c.enabled).at(-1)!.params;
async function render(){await act(async()=>root.render(element));}
async function select(node:HTMLSelectElement,value:string){
  await act(async()=>{node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));});
}
async function submit(){
  await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
}
async function click(id:string){
  await act(async()=>host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click());
}
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  fixture.rowCalls=[];fixture.choiceCalls=[];fixture.loadingSchool=null;fixture.error=false;fixture.empty=false;
  fixture.terms[0].isCurrent=true;fixture.terms[1].isCurrent=true;
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});

describe('Owner academic-term filter interaction',()=>{
  it('labels duplicate term names by school/session/dates and never chooses an ambiguous current term',async()=>{
    await render();
    expect(school().value).toBe('');
    expect(term().value).toBe('');
    expect(term().options[0].text).toBe('Select academic term');
    expect(host.querySelector('input[placeholder="Term ID"]')).toBeNull();
    expect(host.querySelector('input[placeholder="School ID"]')).toBeNull();
    const labels=Array.from(term().options).slice(1).map(o=>o.text);
    expect(labels).toEqual(fixture.terms.map(oversightTermLabel));
    expect(new Set(labels).size).toBe(3);
    expect(labels[0]).toContain('Fictional School A · 2026 / 2027 · First Term');
    expect(labels[1]).toContain('Fictional School B · 2026 / 2027 · First Term');
    expect(applied().termId).toBeUndefined();
    expect(host.textContent).toContain('Apply includes all terms');
    expect(defaultOversightTerm([])).toBe('');
    expect(defaultOversightTerm(fixture.terms)).toBe('');
  });
  it('defaults to the only current term, including on Clear, and keeps historical choices',async()=>{
    fixture.terms[1].isCurrent=false;
    await render();
    expect(term().value).toBe('4');expect(applied().termId).toBe(4);
    await select(term(),'6');await submit();
    expect(applied().termId).toBe(6);
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Clear')!.click());
    expect(term().value).toBe('4');expect(applied().termId).toBe(4);
  });
  it('refreshes terms on school changes, clears incompatible selections, and only applies with page reset on Apply',async()=>{
    await render();
    await select(school(),'3');
    expect(term().value).toBe('4');
    expect(applied().schoolId).toBeUndefined();
    await submit();
    expect(applied()).toMatchObject({schoolId:3,termId:4,offset:0});
    await click('button-oversight-next');
    expect(applied().offset).toBe(25);
    fixture.loadingSchool=8;
    await select(school(),'8');
    expect(term().value).toBe('');expect(term().disabled).toBe(true);
    expect(applied()).toMatchObject({schoolId:3,termId:4,offset:25});
    expect(host.querySelector<HTMLButtonElement>('[data-testid="button-oversight-apply"]')!.disabled).toBe(true);
    fixture.loadingSchool=null;
    // A new element forces the mock query's completed response to render without remounting state.
    await act(async()=>root.render(<NfcFeeCollectionOversight/>));
    expect(term().value).toBe('5');
    expect(Array.from(term().options).some(o=>o.value==='4')).toBe(false);
    expect(fixture.choiceCalls.some(c=>c.schoolId===8)).toBe(true);
    await submit();
    expect(applied()).toMatchObject({schoolId:8,termId:5,offset:0});
    await select(school(),'');
    expect(term().value).toBe('5'); // A compatible explicitly retained choice remains valid across schools.
  });
  it('preserves search/status filters and clears them along with pagination and school selection',async()=>{
    await render();await select(school(),'3');
    const input=host.querySelector<HTMLInputElement>('[data-testid="input-oversight-search"]')!;
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Fictional Student');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await select(host.querySelector<HTMLSelectElement>('[data-testid="select-oversight-status"]')!,'PENDING_EVIDENCE');
    await submit();await click('button-oversight-next');
    expect(applied()).toMatchObject({search:'Fictional Student',status:'PENDING_EVIDENCE',schoolId:3,termId:4,offset:25});
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Clear')!.click());
    expect(applied()).toEqual({limit:25,offset:0});
    expect(input.value).toBe('');expect(school().value).toBe('');expect(term().value).toBe('');
  });
  it('shows empty/error choices honestly without inventing a term or enabling a failed selection',async()=>{
    fixture.empty=true;
    await render();
    expect(term().options).toHaveLength(1);expect(term().value).toBe('');
    expect(host.textContent).toContain('no existing academic terms');
    expect(applied().termId).toBeUndefined();
    fixture.error=true;
    await act(async()=>root.render(<NfcFeeCollectionOversight/>));
    expect(term().disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="button-oversight-apply"]')!.disabled).toBe(true);
    expect(host.textContent).toContain('Academic terms could not be loaded');
  });
});
