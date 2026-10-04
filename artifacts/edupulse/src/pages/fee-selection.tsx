import {useEffect,useMemo,useState} from 'react';
import {useQueries} from '@tanstack/react-query';
import {useGetAuthorizedContext,type FeeInvoice} from '@workspace/api-client-react';
import {Button} from '@/components/shared';
import {ParentOnlineMethods} from './finance-online';

const money=(minor:bigint)=>`₦${(minor/100n).toLocaleString('en-NG')}.${String(minor%100n).padStart(2,'0')}`;

export type FeeLine={id:number;name:string;amountMinor:number;paidMinor:number;outstandingMinor:number};
export type FeeLines={invoiceId:number;selectable:boolean;reason:string|null;lines:FeeLine[]};
/** 'ALL' = whole remaining invoice; number[] = selected fee lines. */
export type Selection=Record<number,'ALL'|number[]>;

export const lineTotal=(lines:FeeLine[],ids:number[])=>lines.filter(l=>ids.includes(l.id)).reduce((s,l)=>s+BigInt(l.outstandingMinor),0n);

/** Parse saved selection; legacy format was a bare array of invoice ids. */
export function parseSelection(raw:string):Selection {
  const v:unknown=JSON.parse(raw);
  const ok=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>0;
  if(Array.isArray(v)){
    if(v.length>1000||!v.every(ok)) throw Error('Invalid payment selection');
    return Object.fromEntries([...new Set(v as number[])].map(id=>[id,'ALL' as const]));
  }
  if(!v||typeof v!=='object') throw Error('Invalid payment selection');
  const out:Selection={};
  for(const [k,val] of Object.entries(v as Record<string,unknown>)){
    if(!ok(Number(k))) throw Error('Invalid payment selection');
    if(val==='ALL') out[Number(k)]='ALL';
    else if(Array.isArray(val)&&val.length<=1000&&val.every(ok)) out[Number(k)]=[...new Set(val as number[])];
    else throw Error('Invalid payment selection');
  }
  return out;
}

async function fetchLines(id:number):Promise<FeeLines> {
  const r=await fetch(`/api/parent/fees/invoices/${id}/lines`,{credentials:'include'});
  const b=await r.json().catch(()=>null);
  if(!r.ok) throw new Error(b?.error||`Fee lines could not be loaded (${r.status})`);
  return b;
}

/** Keep provider transactions independent; advance only after server-confirmed balances. */
export function ParentFeeSelection({studentId,invoices,onBankTransfer}:{studentId:number;invoices:FeeInvoice[];onBankTransfer?:(invoice:FeeInvoice,lineIds:number[]|undefined,amountMinor:number)=>void}) {
  const context=useGetAuthorizedContext();
  const actor=context.data?.user.id;
  const key=actor ? `educore:fee-selection:${actor}:${studentId}` : null;
  const [sel,setSel]=useState<Selection>({});
  const [started,setStarted]=useState(false);
  const [error,setError]=useState('');
  const owned=invoices.filter(i=>i.studentId===studentId);
  const unpaid=owned.filter(i=>i.status!=='PAID'&&i.status!=='CANCELLED'&&Number.isSafeInteger(i.outstandingMinor)&&i.outstandingMinor>0);
  const relevant=useMemo(()=>owned.filter(i=>unpaid.some(u=>u.id===i.id)||sel[i.id]!==undefined),[invoices,studentId,sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineQs=useQueries({queries:relevant.map(i=>({queryKey:['parent-fee-lines',actor,i.id,i.paidMinor,i.outstandingMinor,i.status],enabled:!!actor,queryFn:()=>fetchLines(i.id),refetchOnMount:'always' as const}))});
  const lines=new Map<number,{data?:FeeLines;loading:boolean;error:boolean;refetch:()=>void}>();
  relevant.forEach((i,n)=>lines.set(i.id,{data:lineQs[n].data,loading:lineQs[n].isLoading,error:lineQs[n].isError,refetch:()=>{void lineQs[n].refetch();}}));

  const outstandingFor=(i:FeeInvoice):bigint|null=>{
    const s=sel[i.id]; if(s===undefined) return null;
    if(s==='ALL') return BigInt(Math.max(i.outstandingMinor,0));
    const d=lines.get(i.id)?.data; return d?lineTotal(d.lines,s):null;
  };
  /** Server-confirmed completion: whole invoice PAID, or every chosen line has zero outstanding. */
  const isDone=(i:FeeInvoice)=>{
    const s=sel[i.id];
    if(s==='ALL') return i.status==='PAID'||i.outstandingMinor<=0;
    if(!s) return false;
    const d=lines.get(i.id)?.data;
    return !!d&&s.every(id=>d.lines.find(l=>l.id===id)?.outstandingMinor===0);
  };
  const chosenInvoices=owned.filter(i=>sel[i.id]!==undefined);
  const remaining=chosenInvoices.filter(i=>!isDone(i));
  const total=chosenInvoices.filter(i=>!isDone(i)).reduce((sum,i)=>sum+(outstandingFor(i)??0n),0n);
  const complete=started&&chosenInvoices.length>0&&remaining.length===0;
  const next=remaining[0];
  const nextSel=next?sel[next.id]:undefined;
  const nextLines=next?lines.get(next.id)?.data:undefined;
  const nextLineIds=next&&Array.isArray(nextSel)&&nextLines?nextSel.filter(id=>(nextLines.lines.find(l=>l.id===id)?.outstandingMinor??0)>0):undefined;
  const nextAmount=nextLineIds&&nextLines?lineTotal(nextLines.lines,nextLineIds):null;

  useEffect(()=>{
    setSel({});setStarted(false);setError('');
    if(!key) return;
    try {
      const raw=window.sessionStorage.getItem(key);
      if(!raw) return;
      const parsed=parseSelection(raw);
      setSel(parsed);setStarted(Object.keys(parsed).length>0);
    } catch {setError('The saved payment selection could not be loaded. Select the fees again; check payment history before retrying a pending charge.');}
  },[key]);

  const toggleInvoice=(i:FeeInvoice,on:boolean)=>setSel(v=>{const n={...v};if(on)n[i.id]='ALL';else delete n[i.id];return n;});
  const toggleLine=(i:FeeInvoice,all:FeeLine[],lineId:number,on:boolean)=>setSel(v=>{
    const cur=Array.isArray(v[i.id])?(v[i.id] as number[]):[];
    const ids=on?[...new Set([...cur,lineId])]:cur.filter(x=>x!==lineId);
    const n={...v};
    if(ids.length===0) delete n[i.id]; else n[i.id]=ids.length===all.length?'ALL':ids;
    return n;
  });
  const selectAll=(on:boolean)=>setSel(on?Object.fromEntries(unpaid.map(i=>[i.id,'ALL' as const])):{});
  const selectedTotal=unpaid.reduce((sum,i)=>sum+(outstandingFor(i)??0n),0n);
  const waiting=unpaid.some(i=>Array.isArray(sel[i.id])&&!lines.get(i.id)?.data);
  const begin=()=>{
    const picked=Object.fromEntries(Object.entries(sel).filter(([id])=>unpaid.some(i=>i.id===Number(id))));
    if(!key||!Object.keys(picked).length) return;
    try { window.sessionStorage.setItem(key,JSON.stringify(picked));setSel(picked);setStarted(true);setError(''); }
    catch {setError('Your browser could not save this selection. No checkout was started.');}
  };
  const reset=()=>{
    if(key) {try{window.sessionStorage.removeItem(key);}catch{setError('The saved selection could not be cleared.');return;}}
    setStarted(false);setSel({});
  };
  const chosenCount=Object.keys(sel).filter(id=>unpaid.some(i=>i.id===Number(id))).length;
  return <section className="panel mt-6 p-5" data-testid="parent-fee-selection">
    <h2 className="display-font text-lg font-bold">Select fees to pay</h2>
    <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Choose one, several or all unpaid fees for this child. Selected charges use the existing payment service, one checkout at a time. Each receipt and balance is confirmed separately.</p>
    {!started&&<>
      <label className="mt-4 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={unpaid.length>0&&unpaid.every(i=>sel[i.id]==='ALL')}
        disabled={!unpaid.length} onChange={e=>selectAll(e.target.checked)} />Select all unpaid fees</label>
      <div className="mt-3 space-y-2">{unpaid.map(i=>{
        const L=lines.get(i.id); const d=L?.data; const s=sel[i.id];
        const open=d?.selectable?d.lines.filter(l=>l.outstandingMinor>0):[];
        const perLine=open.length>0;
        return <div key={i.id} className="rounded-lg border border-[hsl(var(--border))] p-3 text-sm" data-testid={`fee-invoice-${i.id}`}>
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={s==='ALL'} onChange={e=>toggleInvoice(i,e.target.checked)} />
            <span className="flex-1">{perLine?'Whole invoice':(i.feeItems?.map(item=>item.name).join(', ')||i.invoiceNumber)}<span className="block text-xs text-[hsl(var(--muted-foreground))]">{i.invoiceNumber} · Session #{i.sessionId}, term #{i.termId}</span></span>
            <strong>{money(BigInt(i.outstandingMinor))}</strong>
          </label>
          {L?.loading&&<p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Loading fee lines…</p>}
          {L?.error&&<p role="alert" className="mt-2 text-xs text-[hsl(var(--destructive))]">Fee lines could not be loaded; the full remaining invoice can still be paid. <button className="underline" onClick={L.refetch}>Retry</button></p>}
          {d&&!d.selectable&&<p role="status" className="mt-2 text-xs" data-testid={`text-lines-unavailable-${i.id}`}>Individual fees cannot be chosen for this invoice: {d.reason||'earlier payments or discounts were not allocated to specific fees.'} The full remaining balance is paid instead.</p>}
          {perLine&&<div className="mt-2 space-y-1 border-t border-[hsl(var(--border)/.6)] pt-2">{open.map(l=>
            <label key={l.id} className="flex items-center gap-3 text-sm"><input type="checkbox" aria-label={`Pay ${l.name}`} checked={s==='ALL'||(Array.isArray(s)&&s.includes(l.id))} disabled={s==='ALL'}
              onChange={e=>toggleLine(i,open,l.id,e.target.checked)} /><span className="flex-1">{l.name}</span><span className="tabular-nums">{money(BigInt(l.outstandingMinor))}</span></label>)}</div>}
        </div>;})}</div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><strong data-testid="text-selected-total">Selected balance: {money(selectedTotal)}</strong>
        <Button disabled={!actor||!chosenCount||waiting} onClick={begin}>Pay selected fees ({chosenCount})</Button></div>
    </>}
    {started&&<div className="mt-4 space-y-3">
      {complete?<p role="status">All selected fees are confirmed paid.</p>:next?<>
        <p>{remaining.length} selected {remaining.length===1?'invoice remains':'invoices remain'} · {money(total)}</p>
        {Array.isArray(nextSel)&&!nextLines?<p role="status">Confirming current fee balances…</p>:<>
          <p className="font-semibold">Next payment: {next.invoiceNumber} · {money(nextAmount??BigInt(next.outstandingMinor))}{nextLineIds?` · ${nextLineIds.length} fee ${nextLineIds.length===1?'line':'lines'}`:''}</p>
          <ParentOnlineMethods key={`${next.id}:${nextLineIds?.join('-')??'all'}:${next.outstandingMinor}`} invoice={next} studentId={studentId}
            {...(nextLineIds?.length&&nextAmount!==null&&nextAmount<=BigInt(Number.MAX_SAFE_INTEGER)?{lineIds:nextLineIds,selectedAmountMinor:Number(nextAmount)}:{})} />
          {onBankTransfer&&<Button variant="outline" testId={`button-selected-bank-${next.id}`}
            disabled={!actor||(nextAmount!==null&&nextAmount<=0n)}
            onClick={()=>onBankTransfer(next,nextLineIds,Number(nextAmount??BigInt(next.outstandingMinor)))}>Submit bank transfer for selected fees</Button>}
        </>}
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Return to this child's fees after payment to continue. A bank-transfer submission remains pending until school verification; only the selected fees are allocated when verified.</p>
      </>:<p role="alert">A selected invoice is unavailable or no longer payable. Check payment history; no additional checkout has been started.</p>}
      <Button variant="quiet" onClick={reset}>{complete?'Clear completed selection':'Change selection'}</Button>
    </div>}
    {error&&<p role="alert" className="mt-3 text-sm text-[hsl(var(--destructive))]">{error}</p>}
  </section>;
}
