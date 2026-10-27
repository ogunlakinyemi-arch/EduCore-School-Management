// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it } from 'vitest';
import { nairaToMinor, SubscriptionPaymentRulesPage } from './subscription-payment-rules';

describe('Owner subscription rule controls',()=>{
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
    expect(html).toContain('Provider payment initiation');
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
