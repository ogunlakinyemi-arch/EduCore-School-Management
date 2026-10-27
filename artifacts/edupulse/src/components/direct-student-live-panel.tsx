import { useRef,useState, type FormEvent } from 'react';
import {
  useGetAuthorizedContext,useGetDirectStudentLiveReadiness,getGetDirectStudentLiveReadinessQueryKey,
  createDirectStudentLiveCheckout,requestDirectStudentAssistance,
} from '@workspace/api-client-react';
import { Button } from '@/components/shared';
const field='w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 text-sm';
const positive=(v:string)=>/^[1-9]\d*$/.test(v)&&Number.isSafeInteger(Number(v));
export function safeDirectCheckoutUrl(value:string|null|undefined){
  try{
    const u=new URL(value??'');
    return u.protocol==='https:'&&u.hostname==='checkout.flutterwave.com'
      &&/^\/v3\/hosted\/pay\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)
      &&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash?u.href:null;
  }catch{return null;}
}
/** This component cannot initiate payments until the server has independently released a reviewed rule. */
export function DirectStudentLivePanel({schoolId}:{schoolId:number}){
  const actorId=useGetAuthorizedContext().data?.user?.id;
  const [student,setStudent]=useState(''),[term,setTerm]=useState(''),[note,setNote]=useState('');
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState('');
  const [attempt,setAttempt]=useState<{state:string;reference:string;checkoutUrl:string|null}|null>(null);
  const key=useRef<string|null>(null);
  const inputValid=positive(student)&&positive(term);
  const params={studentId:Number(student),termId:Number(term)};
  const status=useGetDirectStudentLiveReadiness(schoolId,params,{query:{
    queryKey:[...getGetDirectStudentLiveReadinessQueryKey(schoolId,params),`actor:${actorId??'none'}`],
    enabled:schoolId>0&&!!actorId&&inputValid,staleTime:0,refetchOnMount:'always',
    refetchOnWindowFocus:true,refetchInterval:15000,retry:false,
  }});
  const canStart=status.data?.ready===true&&!status.isFetching&&!busy&&!uncertain&&!safeDirectCheckoutUrl(attempt?.checkoutUrl);
  const checkout=async()=>{
    if(!canStart||!inputValid)return;
    if(!window.confirm('Start the reviewed ₦3,200 LIVE payment to Yetenia for this student and term? No money goes to a school or BRO.'))return;
    key.current??=crypto.randomUUID();setBusy(true);setMessage('');
    try{
      const saved=await createDirectStudentLiveCheckout(schoolId,params,{headers:{'Idempotency-Key':key.current}});
      setAttempt(saved);
      if(saved.state==='FAILED'){key.current=crypto.randomUUID();setMessage('The provider verified a failed attempt. A new attempt requires another explicit confirmation.');}
      else setMessage(saved.state==='READY'?'Checkout created. Follow the provider link only if you intend to pay.':'Existing attempt retained; do not start another payment until it is reconciled.');
    }catch{
      setUncertain(true);setMessage('The original request may have reached Flutterwave. Do not retry automatically or transfer money again. Ask the Owner to reconcile the attempt using the original request.');
    }finally{setBusy(false);}
  };
  const ask=async(e:FormEvent)=>{
    e.preventDefault();
    if(!inputValid||note.trim().length<3||busy)return;
    if(!window.confirm('Record an assistance request only? This does not verify bank credit or initiate Flutterwave. Do not send a transfer until Yetenia independently confirms instructions.'))return;
    setBusy(true);setMessage('');
    try{
      const r=await requestDirectStudentAssistance(schoolId,{...params,requestNote:note.trim()});
      setMessage(`Assistance request #${r.id} recorded as ${r.status}. It is not a bank-credit verification or payment.`);
    }catch{setMessage('Could not record the request. Check with the Owner before trying again; the previous request may have been saved.');}
    finally{setBusy(false);}
  };
  return <section className="panel mt-6 space-y-4 p-5" data-testid="direct-student-live-panel">
    <div><h2 className="display-font text-xl font-bold">School-to-Yetenia platform fee</h2>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">Prepared direct LIVE Flutterwave payment: ₦3,200 per student per term, 100% to Yetenia; no school split or BRO commission. The school-configured parent-facing NFC fee is separate and is never proof of this payment.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold">Student ID<input className={field} inputMode="numeric" value={student} onChange={e=>{setStudent(e.target.value);setAttempt(null);setUncertain(false);key.current=null;}} /></label>
      <label className="text-sm font-semibold">Academic term ID<input className={field} inputMode="numeric" value={term} onChange={e=>{setTerm(e.target.value);setAttempt(null);setUncertain(false);key.current=null;}} /></label>
    </div>
    <p className="text-xs font-semibold" role="status">
      {!inputValid?'Enter the exact student and term to check readiness.'
        : status.isLoading?'Checking reviewed rules and reconciliation…'
        : status.isError?'Readiness cannot be verified. No checkout will start.'
        : status.data?.ready?'Reviewed direct checkout is available for this scope.'
        : `Checkout blocked: ${status.data?.blockers.join(', ')||'no reviewed rule or reconciliation approval'}.`}
    </p>
    <Button disabled={!canStart} onClick={()=>void checkout()} testId="button-direct-student-checkout">{busy?'Working…':'Start direct platform checkout'}</Button>
    {attempt && <p className="text-xs">Attempt {attempt.reference} · {attempt.state}. {safeDirectCheckoutUrl(attempt.checkoutUrl) &&
      <a href={safeDirectCheckoutUrl(attempt.checkoutUrl)!} target="_blank" rel="noopener noreferrer" className="underline">Open Flutterwave checkout</a>}</p>}
    <form onSubmit={e=>void ask(e)} className="space-y-2 border-t border-[hsl(var(--border))] pt-4">
      <label className="block text-sm font-semibold">Request Owner bank-transfer assistance
        <textarea className={field} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="Reason for assistance" /></label>
      <p className="text-xs">A request or receipt upload is not bank credit. The Owner must verify the actual ₦3,200 transfer independently before any Flutterwave attempt; failed attempts never collect the transfer again.</p>
      <Button type="submit" variant="outline" disabled={!inputValid||note.trim().length<3||busy} testId="button-request-direct-assistance">Record request only</Button>
    </form>
    {message&&<p role="status" className="text-xs font-semibold">{message}</p>}
  </section>;
}
