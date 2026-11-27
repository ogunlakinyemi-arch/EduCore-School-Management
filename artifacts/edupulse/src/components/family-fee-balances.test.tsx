import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import type {FeeInvoice} from '@workspace/api-client-react';
const ledger=vi.hoisted(()=>vi.fn(()=>{throw Error('Families must never load platform amounts');}));
vi.mock('./student-nfc-obligations',()=>({useStudentNfcObligations:ledger}));
vi.mock('./shared',()=>({money:(n:number)=>`₦${n.toLocaleString('en-NG')}`}));
import {FamilyFeeBalances,familyFeeBalances} from './family-fee-balances';
const invoice={id:5,invoiceNumber:'SCH-5',sessionId:2,termId:7,sessionName:'2026/2027',termName:'First Term',
 status:'PARTIALLY_PAID',dueDate:'2026-01-01',isPriorTerm:true,outstandingMinor:200000,paidMinor:100000} as FeeInvoice;
describe('family school fee privacy and arrears',()=>{
 it('never adds an internal obligation to school-issued fees',()=>{
  expect(familyFeeBalances([invoice],[{amountMinor:320000,status:'UNPAID'} as any]))
   .toEqual({schoolOutstanding:200000,schoolPaid:100000});
 });
 it.each([true,false])('ignores legacy schoolOnly=%s without loading platform totals',schoolOnly=>{
  const html=renderToStaticMarkup(<FamilyFeeBalances invoices={[invoice]} studentId={9} schoolOnly={schoolOnly}/>);
  expect(html).toContain('School fees due');expect(html).toContain('Prior-term arrears');
  expect(html).toContain('₦2,000');expect(html).toContain('SCH-5');expect(html).toContain('First Term');
  expect(html).not.toMatch(/3,200|₦150|Flutterwave|Platform Owner|remittance|\bBRO\b|combined/i);
  expect(ledger).not.toHaveBeenCalled();
 });
 it('shows a genuinely school-published NFC charge priced at 3200',()=>{
  const html=renderToStaticMarkup(<FamilyFeeBalances invoices={[{...invoice,outstandingMinor:320000}]}/>);
  expect(html).toContain('₦3,200');expect(ledger).not.toHaveBeenCalled();
 });
 it('does not carry cancelled, waived or settled debt into arrears',()=>{
  const html=renderToStaticMarkup(<FamilyFeeBalances invoices={[
   {...invoice,status:'CANCELLED'},{...invoice,id:6,status:'WAIVED'},{...invoice,id:7,status:'PAID',outstandingMinor:0},
  ]}/>);
  expect(html).not.toContain('Original prior-term invoices');expect(html).not.toContain('₦2,000');
 });
 it('does not label a current or future-due fee as past-term arrears',()=>{
  const html=renderToStaticMarkup(<FamilyFeeBalances invoices={[
   {...invoice,isPriorTerm:false},{...invoice,id:8,dueDate:'2099-01-01'},
  ]}/>);
  expect(html).not.toContain('Original prior-term invoices');expect(html).toContain('₦4,000');
 });
});
