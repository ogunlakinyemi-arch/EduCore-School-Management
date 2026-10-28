// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({approve:vi.fn(),invalidate:vi.fn(),rows:[] as any[],batches:[] as any[],
  rowsError:false,batchesError:false,rowsRetry:vi.fn(),batchesRetry:vi.fn(),export:vi.fn()}));
vi.mock('@workspace/api-client-react',async original=>({
  ...await original<typeof import('@workspace/api-client-react')>(),
  useListPartnerTermCommissions:()=>({data:f.rows,isLoading:false,isError:f.rowsError,refetch:f.rowsRetry}),
  useListPartnerPayoutBatches:()=>({data:f.batches,isLoading:false,isError:f.batchesError,refetch:f.batchesRetry}),
  useApprovePartnerPayoutBatch:()=>({mutateAsync:f.approve,isPending:false}),
  getPartnerPayoutBatchExport:f.export,
}));
vi.mock('@tanstack/react-query',async original=>({
  ...await original<typeof import('@tanstack/react-query')>(),
  useQueryClient:()=>({invalidateQueries:f.invalidate}),
}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
import TermCommissionsPage from './term-commissions';
let root:Root,host:HTMLDivElement;
const click=async(id:string)=>{
  const element=document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  expect(element).not.toBeNull();
  await act(async()=>element.dispatchEvent(new MouseEvent('click',{bubbles:true})));
};
beforeEach(()=>{
  vi.stubEnv('DEV',true);
  f.rowsError=false;f.batchesError=false;f.rowsRetry.mockReset();f.batchesRetry.mockReset();f.export.mockReset();
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  sessionStorage.clear();f.approve.mockReset().mockResolvedValue({id:1});f.invalidate.mockReset().mockResolvedValue(undefined);
  f.rows=[{id:1,partnerId:1,partnerName:'Fixture Partner',schoolId:10,studentId:1,sessionId:1,
    termId:1,term:'First Term',sessionName:'2026/2027',reference:'SCV3_fixture_1',status:'PENDING',amountMinor:10000,
    grossMinor:500000,schoolMinor:190000,providerFeeMinor:6500,providerAdditionalFeeMinor:500,
    vatMinor:null,merchantRemainderMinor:303000,ownerNetMinor:293000,eligible:true,termEnded:true,settlementStatus:'COLLECTION_PAID'}];
  f.batches=[];host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();sessionStorage.clear();vi.unstubAllEnvs();});
it('opens a confirmation and records selected eligible IDs only, refreshing both persistent views',async()=>{
  await act(async()=>root.render(<TermCommissionsPage/>));
  await click('select-commission-1');await click('button-approve-selected');
  expect(f.approve).not.toHaveBeenCalled();
  await click('button-confirm-approval');
  expect(f.approve).toHaveBeenCalledOnce();
  expect(f.approve.mock.calls[0][0].data.commissionIds).toEqual([1]);
  expect(f.approve.mock.calls[0][0].data.idempotencyKey).toMatch(/^[\w-]{16,100}$/);
  expect(f.invalidate).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[data-testid=banner-retry]')).toBeNull();
});
it('retains exact IDs/key after a lost response and retries without making a second approval identity',async()=>{
  f.approve.mockRejectedValueOnce(new Error('Lost response'));
  await act(async()=>root.render(<TermCommissionsPage/>));
  await click('select-commission-1');await click('button-approve-selected');await click('button-confirm-approval');
  expect(document.querySelector('[data-testid=banner-retry]')).not.toBeNull();
  expect((document.querySelector('[data-testid=select-commission-1]') as HTMLInputElement).disabled).toBe(true);
  const original=f.approve.mock.calls[0][0];
  await click('button-retry-approval');
  expect(f.approve.mock.calls[1][0]).toEqual(original);
});
it('keeps non-ended or held entries unselectable and prevents invalidated batch export',async()=>{
  f.rows[0].termEnded=false;f.rows.push({...f.rows[0],id:2,status:'HELD',termEnded:true,eligible:false});
  f.batches=[{id:2,status:'REVIEW_REQUIRED',amountMinor:10000,currency:'NGN',items:[],approvedAt:'2026-10-19',
    approvedBy:1,executionMode:'EXPORT_ONLY'}];
  await act(async()=>root.render(<TermCommissionsPage/>));
  expect((document.querySelector('[data-testid=select-commission-1]') as HTMLInputElement).disabled).toBe(true);
  expect((document.querySelector('[data-testid=select-commission-2]') as HTMLInputElement).disabled).toBe(true);
  expect((document.querySelector('[data-testid=button-export-2]') as HTMLButtonElement).disabled).toBe(true);
  expect(host.textContent).toContain('Unknown');
});
it('renders published commission and approval history read-only without allowing legacy actions',async()=>{
  vi.stubEnv('DEV',false);
  f.batches=[{id:2,status:'APPROVED',amountMinor:10000,currency:'NGN',items:[],approvedAt:'2026-10-19',
    approvedBy:1,executionMode:'EXPORT_ONLY'}];
  await act(async()=>root.render(<TermCommissionsPage/>));
  expect(host.textContent).toContain('Published view is read-only');
  expect(host.textContent).toContain('Fixture Partner');
  expect(host.textContent).toContain('Batch #2');
  for(const id of ['select-commission-1','button-approve-selected','button-export-2'])
    expect((document.querySelector(`[data-testid="${id}"]`) as HTMLInputElement).disabled).toBe(true);
  expect(f.approve).not.toHaveBeenCalled();expect(f.export).not.toHaveBeenCalled();
});
it('retries both read feeds after the term feed fails, with no approval or export',async()=>{
  f.rowsError=true;f.batchesError=true;
  await act(async()=>root.render(<TermCommissionsPage/>));
  expect(host.textContent).toContain('BRO term commissions could not be loaded');
  const retry=host.querySelector('button')!;
  await act(async()=>retry.click());
  expect(f.rowsRetry).toHaveBeenCalledOnce();expect(f.batchesRetry).toHaveBeenCalledOnce();
  f.rowsError=false;f.batchesError=false;
  await act(async()=>root.render(<TermCommissionsPage/>));
  expect(host.textContent).toContain('Fixture Partner');expect(f.approve).not.toHaveBeenCalled();
});
it('keeps commission evidence visible when batch history fails and retries only history',async()=>{
  f.batchesError=true;
  await act(async()=>root.render(<TermCommissionsPage/>));
  expect(host.textContent).toContain('Fixture Partner');expect(host.textContent).toContain('Batch history failed to load');
  const retry=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Retry')!;
  await act(async()=>retry.click());
  expect(f.batchesRetry).toHaveBeenCalledOnce();expect(f.rowsRetry).not.toHaveBeenCalled();
  expect(f.approve).not.toHaveBeenCalled();
});
