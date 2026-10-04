import {useEffect,useState} from 'react';
import {useGetAuthorizedContext,type FeeInvoice} from '@workspace/api-client-react';
import {Button} from '@/components/shared';
import {ParentOnlineMethods} from './finance-online';

const money=(minor:bigint)=>`₦${(minor/100n).toLocaleString('en-NG')}.${String(minor%100n).padStart(2,'0')}`;

/** Keep provider transactions independent; advance only after server-confirmed payment. */
export function ParentFeeSelection({studentId,invoices}:{studentId:number;invoices:FeeInvoice[]}) {
  const context=useGetAuthorizedContext();
  const actor=context.data?.user.id;
  const key=actor ? `educore:fee-selection:${actor}:${studentId}` : null;
  const [selected,setSelected]=useState<number[]>([]);
  const [started,setStarted]=useState(false);
  const [error,setError]=useState('');
  const owned=invoices.filter(i=>i.studentId===studentId);
  const unpaid=owned.filter(i=>i.status!=='PAID'&&i.status!=='CANCELLED'&&Number.isSafeInteger(i.outstandingMinor)&&i.outstandingMinor>0);
  const chosen=unpaid.filter(i=>selected.includes(i.id));
  const total=chosen.reduce((sum,i)=>sum+BigInt(i.outstandingMinor),0n);
  const complete=started&&selected.length>0&&selected.every(id=>owned.some(i=>i.id===id&&i.status==='PAID'));
  useEffect(()=>{
    setSelected([]);setStarted(false);setError('');
    if(!key) return;
    try {
      const raw=window.sessionStorage.getItem(key);
      if(!raw) return;
      const ids:unknown=JSON.parse(raw);
      if(!Array.isArray(ids)||ids.length>1000||!ids.every(id=>Number.isSafeInteger(id)&&id>0)) throw Error('Invalid payment selection');
      setSelected([...new Set(ids)]);setStarted(true);
    } catch {setError('The saved payment selection could not be loaded. Select the fees again; check payment history before retrying a pending charge.');}
  },[key]);
  const begin=()=>{
    if(!key||!chosen.length) return;
    try { window.sessionStorage.setItem(key,JSON.stringify(chosen.map(i=>i.id)));setSelected(chosen.map(i=>i.id));setStarted(true);setError(''); }
    catch {setError('Your browser could not save this selection. No checkout was started.');}
  };
  const reset=()=>{
    if(key) {try{window.sessionStorage.removeItem(key);}catch{setError('The saved selection could not be cleared.');return;}}
    setStarted(false);setSelected([]);
  };
  return <section className="panel mt-6 p-5" data-testid="parent-fee-selection">
    <h2 className="display-font text-lg font-bold">Select fees to pay</h2>
    <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Choose one, several or all unpaid invoices for this child. Selected charges use the existing payment service, one checkout at a time. Each receipt and balance is confirmed separately.</p>
    {!started&&<>
      <label className="mt-4 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={unpaid.length>0&&chosen.length===unpaid.length}
        disabled={!unpaid.length} onChange={e=>setSelected(e.target.checked?unpaid.map(i=>i.id):[])} />Select all unpaid fees</label>
      <div className="mt-3 space-y-2">{unpaid.map(i=><label key={i.id} className="flex items-start gap-3 rounded-lg border border-[hsl(var(--border))] p-3 text-sm">
        <input type="checkbox" checked={selected.includes(i.id)} onChange={e=>setSelected(v=>e.target.checked?[...new Set([...v,i.id])]:v.filter(id=>id!==i.id))} />
        <span className="flex-1">{i.feeItems?.map(item=>item.name).join(', ')||i.invoiceNumber}<span className="block text-xs text-[hsl(var(--muted-foreground))]">{i.invoiceNumber} · Session #{i.sessionId}, term #{i.termId}</span>{(i.feeItems?.length??0)>1&&<span className="block text-xs">These fees share one invoice and are selected together.</span>}</span>
        <strong>{money(BigInt(i.outstandingMinor))}</strong>
      </label>)}</div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><strong>Selected balance: {money(total)}</strong>
        <Button disabled={!actor||!chosen.length} onClick={begin}>Pay selected fees ({chosen.length})</Button></div>
    </>}
    {started&&<div className="mt-4 space-y-3">
      {complete?<p role="status">All selected fees are confirmed paid.</p>:chosen[0]?<>
        <p>{chosen.length} selected {chosen.length===1?'invoice remains':'invoices remain'} · {money(total)}</p>
        <p className="font-semibold">Next payment: {chosen[0].invoiceNumber} · {money(BigInt(chosen[0].outstandingMinor))}</p>
        <ParentOnlineMethods key={chosen[0].id} invoice={chosen[0]} studentId={studentId} />
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Return to this child's fees after payment to continue. If online payment is unavailable, use the approved bank-transfer action on the invoice below.</p>
      </>:<p role="alert">A selected invoice is unavailable or no longer payable. Check payment history; no additional checkout has been started.</p>}
      <Button variant="quiet" onClick={reset}>{complete?'Clear completed selection':'Change selection'}</Button>
    </div>}
    {error&&<p role="alert" className="mt-3 text-sm text-[hsl(var(--destructive))]">{error}</p>}
  </section>;
}