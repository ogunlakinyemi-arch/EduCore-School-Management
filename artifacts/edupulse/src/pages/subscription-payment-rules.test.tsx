// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it } from 'vitest';
import { nairaToMinor, SubscriptionPaymentRulesPage } from './subscription-payment-rules';

describe('Owner subscription rule controls',()=>{
  it('shows the prospective 150 liability separately and keeps historical 100 rules visible without enabling accrual on missing storage',()=>{
    const html=renderToStaticMarkup(<SubscriptionPaymentRulesPage snapshot={{staffRules:[],audit:[],
      broRules:[{id:1,name:'Historical BRO rule',status:'ACTIVE',term:'First Term',partnerAmount:100,
        schoolAmount:1900,effectiveDate:'2026-01-01T00:00:00Z'}],
      broCommission:{available:false,entries:[]}}} onRefresh={()=>undefined}/>);
    expect(html).toContain('₦150 per eligible student per academic term');
    expect(html).toContain('Existing ₦100 earnings remain unchanged');
    expect(html).toContain('Historical BRO rule');
    expect(html).toContain('not a deduction or split');
    expect(html).toContain('recovery safety clearance');
    expect(html).toMatch(/disabled[^>]*>Record eligible BRO liability/);
  });
  it('shows the actual frozen earning amount rather than recalculating historical entries at the new rate',()=>{
    const html=renderToStaticMarkup(<SubscriptionPaymentRulesPage snapshot={{staffRules:[],audit:[],broRules:[],
      broCommission:{available:true,entries:[{id:8,schoolId:1,studentId:31,termId:4,partnerId:2,
        amountMinor:15000,status:'PENDING_OWNER_APPROVAL'}]}}} onRefresh={()=>undefined}/>);
    expect(html).toContain('#8');expect(html).toContain('₦150');
    expect(html).toContain('PENDING OWNER APPROVAL');
    expect(html).toContain('No automatic payout');
  });
  it('converts naira exactly and rejects formulas, negative or fractional-kobo amounts',()=>{
    expect(nairaToMinor('3,200')).toBe(320000);
    expect(nairaToMinor('2000.01')).toBe(200001);
    for(const input of ['-1','10.001','1e5','=2000','1000000000000'])expect(nairaToMinor(input)).toBeNull();
  });
  it('shows intent and provider limitations without suggesting a receipt activates billing',()=>{
    const html=renderToStaticMarkup(<SubscriptionPaymentRulesPage
      snapshot={{staffRules:[],broRules:[],audit:[],proposals:[],assistance:[]}}
      onRefresh={()=>undefined}/>);
    expect(html).toContain('Student NFC &amp; EduCore');
    expect(html).toContain('₦3,200');
    expect(html).toContain('Teacher');
    expect(html).toContain('Direct LIVE checkout stays');
    expect(html).toContain('unavailable until separately approved');
    expect(html).not.toContain('Initiate Flutterwave payment</button>');
  });
  it('renders audit before/after from only safe financial fields',()=>{
    const html=renderToStaticMarkup(<SubscriptionPaymentRulesPage
      snapshot={{staffRules:[],broRules:[],proposals:[],assistance:[],audit:[{
        id:3,user:'Fictional Owner',action:'ACTIVATED',timestamp:'2026-10-27T10:00:00Z',
        metadata:{reason:'Reviewed rule activation',before:{status:'DRAFT',amountMinor:200000,secret:'never-show'},
          after:{status:'SCHEDULED',amountMinor:200000,secret:'never-show'}}}]}}
      onRefresh={()=>undefined}/>);
    expect(html).toContain('Before:');expect(html).toContain('After:');
    expect(html).toContain('Reviewed rule activation');
    expect(html).not.toContain('never-show');
  });
});
