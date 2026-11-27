import type { FeeInvoice,StudentNfcObligation } from '@workspace/api-client-react';
import {money} from './shared';
export function familyFeeBalances(invoices:Pick<FeeInvoice,'outstandingMinor'|'paidMinor'>[],
 _retiredNfcRows:Pick<StudentNfcObligation,'amountMinor'|'status'>[]=[]){
 return {schoolOutstanding:invoices.reduce((sum,i)=>sum+Number(i.outstandingMinor),0),
  schoolPaid:invoices.reduce((sum,i)=>sum+Number(i.paidMinor),0)};
}
/** School-published charges only. Legacy flags never fetch the platform ledger. */
export function FamilyFeeBalances({invoices}:{invoices:FeeInvoice[];studentId?:number;schoolOnly?:boolean}){
 const active=invoices.filter(i=>!['CANCELLED','WAIVED'].includes(i.status));
 const totals=familyFeeBalances(active);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const prior=active.filter(i=>i.isPriorTerm&&i.outstandingMinor>0&&!!i.dueDate&&i.dueDate<=today)
  .sort((a,b)=>a.dueDate!.localeCompare(b.dueDate!)||a.id-b.id);
 const arrears=prior.reduce((sum,i)=>sum+i.outstandingMinor,0);
 return <section aria-label="School-issued fee balances">
  <div className="grid gap-4 sm:grid-cols-3">
   {[['School fees due',totals.schoolOutstanding],['School fees paid',totals.schoolPaid],['Prior-term arrears',arrears]].map(([label,value])=>
    <div key={label} className="panel p-5"><div className="eyebrow">{label}</div>
     <strong className="display-font mt-2 block text-2xl">{money(Number(value)/100)}</strong></div>)}
  </div>
  <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">Unpaid balances stay on their original invoices across terms. They are not billed again. Original school due dates still apply.</p>
  {prior.length>0&&<ul aria-label="Original prior-term invoices" className="mt-3 space-y-1 text-sm">
   {prior.map(i=><li key={i.id}>{i.invoiceNumber} · {i.sessionName??`Session #${i.sessionId}`} · {i.termName??`Term #${i.termId}`} · Due {i.dueDate} · {money(i.outstandingMinor/100)}</li>)}
  </ul>}
 </section>;
}
