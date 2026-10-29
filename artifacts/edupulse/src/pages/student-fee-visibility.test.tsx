// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({invoices:[] as any[],platform:vi.fn(),ledger:vi.fn()}));
vi.mock('@workspace/api-client-react',async original=>{
  const actual=await original<typeof import('@workspace/api-client-react')>();
  const q=(data:any)=>({data,isLoading:false,isError:false,refetch:vi.fn()});
  return {...actual,
    useGetAuthorizedContext:()=>q({user:{id:101},isPlatformOwner:false,roles:[{role:'STUDENT',schoolId:1,status:'ACTIVE'}]}),
    useListStudentFeeInvoices:()=>q(f.invoices),
    useListStudentFeePayments:()=>q([]),useListParentFeePayments:()=>q([]),
    useGetSchoolBranding:()=>q({schoolId:1,name:'Fixture School'}),
  };
});
vi.mock('@/components/student-nfc-obligations',async original=>({
  ...await original<typeof import('@/components/student-nfc-obligations')>(),
  StudentNfcObligationsPanel:()=>{f.platform();return <div>Platform subscription ₦3,200</div>;},
  useStudentNfcObligations:()=>{f.ledger();return{data:{rows:[{amountMinor:320000,status:'UNPAID'}]}};},
}));
vi.mock('@/components/shared',async original=>({
  ...await original<typeof import('@/components/shared')>(),useTenant:()=>({schoolId:1}),
}));
import { MyFeesPage } from './finance';
import { SubscriptionsRoute } from './subscriptions';
beforeEach(()=>{
  f.platform.mockClear();f.ledger.mockClear();
  f.invoices=[{id:71,schoolId:1,studentId:11,studentName:'Fixture Child',invoiceNumber:'SCHOOL-71',
    sessionName:'2026/2027',termName:'First Term',status:'PARTIAL',currency:'NGN',
    totalMinor:1250000,subtotalMinor:1250000,discountMinor:0,waiverMinor:0,
    paidMinor:200000,outstandingMinor:1050000,issuedAt:'2026-10-01',dueDate:null}];
});
it('shows actual school-issued invoices and balances, without loading platform totals or payment instructions',()=>{
  const html=renderToStaticMarkup(<MyFeesPage/>);
  expect(html).toContain('SCHOOL-71');expect(html).toContain('₦12,500');expect(html).toContain('₦10,500');
  expect(html).toContain('School fees paid');expect(html).toContain('₦2,000');
  expect(html).not.toMatch(/3,200|3200|platform payment|NFC subscription|Flutterwave/i);
  expect(f.platform).not.toHaveBeenCalled();expect(f.ledger).not.toHaveBeenCalled();
});
it('keeps a genuinely school-proposed 3200-naira invoice visible instead of filtering by numeric price',()=>{
  f.invoices[0]={...f.invoices[0],totalMinor:320000,paidMinor:0,outstandingMinor:320000};
  const html=renderToStaticMarkup(<MyFeesPage/>);
  expect(html).toContain('SCHOOL-71');expect(html).toContain('₦3,200');
  expect(html).not.toContain('Platform subscription');expect(f.ledger).not.toHaveBeenCalled();
});
it('replaces the legacy student subscriptions entry with school-fee guidance, not the platform ledger',()=>{
  const html=renderToStaticMarkup(<SubscriptionsRoute/>);
  expect(html).toContain('school-issued invoices');expect(html).not.toMatch(/3,200|platform payment|Flutterwave/i);
  expect(f.platform).not.toHaveBeenCalled();expect(f.ledger).not.toHaveBeenCalled();
});
