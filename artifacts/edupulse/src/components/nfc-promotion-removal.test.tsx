import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({role:'PARENT',rows:[] as any[]}));
vi.mock('@clerk/react',()=>({useAuth:()=>({userId:'fixture-user'})}));
vi.mock('@workspace/api-client-react',()=>({
  useGetAuthorizedContext:()=>({data:{isPlatformOwner:false,roles:[{role:state.role,status:'ACTIVE',schoolId:1}]}}),
  useVerifyStudentSubscriptionPayment:()=>({}),
  useGetStudentSubscriptionPayment:()=>({}),
  getGetStudentSubscriptionPaymentQueryKey:()=>['fixture-payment'],
}));
vi.mock('@tanstack/react-query',()=>({
  useQuery:()=>({data:{rows:state.rows},isLoading:false,isError:false}),
  useMutation:()=>({}),useQueryClient:()=>({invalidateQueries:vi.fn()}),
}));
vi.mock('@/components/assisted-nfc-payment',()=>({AssistedNfcPayment:()=>null}));
vi.mock('@/components/nfc-payment-link-controls',()=>({NfcPaymentLinkControls:()=>null}));
vi.mock('@/components/shared',()=>({
  EmptyState:({title,description}:any)=><div>{title}{description}</div>,
  date:()=>'',money:(n:number)=>`₦${n}`,Button:()=>null,ErrorState:()=>null,StatusPill:()=>null,
}));
import {StudentNfcObligationsPanel} from './student-nfc-obligations';
describe('retired NFC fee promotion',()=>{
  it.each(['PARENT','SCHOOL_ADMIN'])('does not advertise the automatic 5000 term fee to %s',role=>{
    state.role=role;
    state.rows=[];
    const html=renderToStaticMarkup(<StudentNfcObligationsPanel schoolId={1} manageReturn={false}/>);
    expect(html).toContain('NFC payment history');
    expect(html).not.toMatch(/5,000|Automatic NFC subscription|Schools cannot create or change it|New checkout allocations/);
    expect(html).toContain('No NFC payment records');
  });
  it('retains the historical amount and reference without presenting them as a term price',()=>{
    state.role='PARENT';
    state.rows=[{schoolId:1,studentId:12,termId:4,studentName:'Fixture Learner',className:'JSS1',
      schoolName:'Alpha School',sessionName:'2026/2027',termName:'First Term',status:'PAID',
      amountMinor:500000,ordinaryFeesMinor:0,totalMinor:500000,schoolAllocatedMinor:190000,
      platformAllocatedMinor:310000,partnerAllocatedMinor:0,reference:'RETAINED-HISTORY-001',
      paymentMethod:'FLUTTERWAVE',canPay:false}];
    const before=structuredClone(state.rows);
    const html=renderToStaticMarkup(<StudentNfcObligationsPanel schoolId={1} manageReturn={false}/>);
    expect(html).toContain('Fixture Learner');expect(html).toContain('RETAINED-HISTORY-001');
    expect(html).toContain('Recorded NFC amount');expect(html).toContain('₦5000');
    expect(html).not.toContain('₦5,000 per term');
    expect(state.rows).toEqual(before);
  });
});
