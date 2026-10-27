// @vitest-environment jsdom
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({ready:false,userId:9}));
vi.mock('@workspace/api-client-react',()=>({
  useGetAuthorizedContext:()=>({data:{user:{id:fixture.userId}}}),
  getGetDirectStudentLiveReadinessQueryKey:(id:number,scope:unknown)=>['/api/schools/'+id+'/platform-subscriptions/live-readiness',scope],
  useGetDirectStudentLiveReadiness:()=>({data:{ready:fixture.ready,blockers:['ACTIVE_3200_RULE_AND_EXPLICIT_MATCHING_RECONCILIATION_APPROVAL_REQUIRED']},
    isLoading:false,isFetching:false,isError:false}),
  createDirectStudentLiveCheckout:vi.fn(),requestDirectStudentAssistance:vi.fn(),
}));
import {DirectStudentLivePanel,safeDirectCheckoutUrl} from './direct-student-live-panel';
import {DirectAssistanceCheckout} from './direct-assistance-checkout';
const renderSchool=()=>renderToStaticMarkup(<DirectStudentLivePanel schoolId={1}/>);
const base={id:71,schoolId:1,studentId:31,termId:4,amountMinor:320000,status:'BANK_VERIFIED',
  requestNote:'Fictional bank case',verifiedAmountMinor:320000,bankStatementReference:'FICTIONAL-CREDIT',bankCreditDate:'2026-10-27'};
describe('unreleased direct payments',()=>{
  it('only exposes an exact HTTPS Flutterwave hosted-checkout link',()=>{
    expect(safeDirectCheckoutUrl('https://checkout.flutterwave.com/v3/hosted/pay/fictional-123')).toContain('/fictional-123');
    for(const url of ['javascript:alert(1)','https://checkout.flutterwave.com.attacker.invalid/v3/hosted/pay/123',
      'http://checkout.flutterwave.com/v3/hosted/pay/123','https://checkout.flutterwave.com/v3/hosted/pay/123?redirect=evil',
      'https://user@checkout.flutterwave.com/v3/hosted/pay/123'])expect(safeDirectCheckoutUrl(url)).toBeNull();
  });
  it('shows the exact non-split rule and prevents a School Admin checkout by default',()=>{
    const html=renderSchool();
    expect(html).toContain('₦3,200');expect(html).toContain('100% to Yetenia');
    expect(html).toContain('parent-to-school NFC card/subscription fee workflow is unchanged');
    expect(html).toMatch(/disabled[^>]*>Start direct platform checkout/);
    expect(html).not.toContain('checkout.flutterwave.com');
  });
  it('does not display an Owner checkout for a request without independently verified bank credit',()=>{
    expect(renderToStaticMarkup(<DirectAssistanceCheckout caseFile={{...base,status:'REQUESTED',verifiedAmountMinor:null}}/>)).toBe('');
  });
  it('only offers a readiness check for verified bank credits, never automatic retry or transfer collection',()=>{
    const html=renderToStaticMarkup(<DirectAssistanceCheckout caseFile={base}/>);
    expect(html).toContain('Check direct-payment readiness');
    expect(html).not.toContain('Start verified-bank platform checkout');
    expect(html).not.toContain('checkout.flutterwave.com');
  });
});
