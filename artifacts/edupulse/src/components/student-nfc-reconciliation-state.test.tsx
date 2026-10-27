// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {StudentNfcReconciliation} from './student-nfc-reconciliation';
const state=vi.hoisted(()=>({actor:9,keys:[] as unknown[][]}));
vi.mock('@workspace/api-client-react',()=>({
  useGetAuthorizedContext:()=>({data:{user:{id:state.actor}}}),
  getPreviewStudentNfcReconciliationQueryKey:(p:any)=>['reconciliation',p],
  usePreviewStudentNfcReconciliation:(p:any,o:any)=>{
    state.keys.push(o.query.queryKey);
    return{isFetching:false,isError:false,refetch:vi.fn(),data:{
      reportVersion:'FICTIONAL',readOnly:true,applyAvailable:false,approvalRequired:true,
      schoolId:p.schoolId,termId:p.termId,academicSessionId:3,schoolName:'Fictional School',termName:'Fictional Term',
      generatedAt:'2026-10-27T10:00:00Z',evidenceDigest:'fictional-digest',platformAmountMinor:320000,
      sourceStatus:'COMPLETE',sources:[],warnings:['READ_ONLY_PREVIEW_ONLY'],rows:[],
      summary:{candidates:0,newObligations:0,ownerReview:0,preserved:0},
    }};
  },
}));
vi.mock('@/components/shared',()=>({
  Button:({children,onClick,type='button',disabled,testId}:any)=><button type={type} disabled={disabled} onClick={onClick} data-testid={testId}>{children}</button>,
  money:(n:number)=>`₦${n.toLocaleString('en-NG')}`,
}));
describe('Owner preview scope and identity isolation',()=>{
  let root:Root,host:HTMLDivElement;
  beforeEach(async()=>{
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;state.actor=9;state.keys=[];
    host=document.createElement('div');document.body.append(host);root=createRoot(host);
    await act(async()=>root.render(<StudentNfcReconciliation defaultSchoolId={1}/>));
  });
  afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
  const edit=async(id:string,value:string)=>{
    const el=host.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);
      el.dispatchEvent(new Event('input',{bubbles:true}));
    });
  };
  const preview=async()=>{
    await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  };
  const report=()=>host.querySelector('[data-testid="recon-report"]');
  it('shows no report before an explicit valid preview and separates the proposed price',async()=>{
    expect(report()).toBeNull();await edit('input-recon-term','4');await preview();
    expect(report()).not.toBeNull();expect(host.textContent).toContain('₦3,200');
    expect(host.textContent).toContain('separate explicit review and approval');
    expect(Array.from(host.querySelectorAll('button')).some(b=>/apply|migrate/i.test(b.textContent??''))).toBe(false);
  });
  it('forces a fresh query generation on every Preview for the same scope',async()=>{
    await edit('input-recon-term','4');await preview();
    const before=state.keys.at(-1);
    await preview();expect(state.keys.at(-1)).not.toEqual(before);
  });
  it('hides an old report immediately after scope edits and tenant changes',async()=>{
    await edit('input-recon-term','4');await preview();expect(report()).not.toBeNull();
    await edit('input-recon-term','5');expect(report()).toBeNull();
    await preview();expect(report()).not.toBeNull();
    await act(async()=>root.render(<StudentNfcReconciliation defaultSchoolId={2}/>));
    expect(report()).toBeNull();
  });
  it('does not retain another signed-in identity’s report',async()=>{
    await edit('input-recon-term','4');await preview();expect(report()).not.toBeNull();
    state.actor=99;
    await act(async()=>root.render(<StudentNfcReconciliation defaultSchoolId={1}/>));
    expect(report()).toBeNull();
  });
});
