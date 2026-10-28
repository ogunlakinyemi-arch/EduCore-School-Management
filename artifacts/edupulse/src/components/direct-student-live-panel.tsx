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
export function DirectStudentLivePanel({schoolId,selectionOptions,showAssistance=true,onPaymentStateChange}:{
  schoolId:number;
  selectionOptions?:{students:{id:number;firstName:string;lastName:string;admissionNo:string}[];
    terms:{id:number;name:string;sessionName:string}[]};
  showAssistance?:boolean;onPaymentStateChange?:()=>void;
}){
  const actorId=useGetAuthorizedContext().data?.user?.id;
  const [student,setStudent]=useState(''),[term,setTerm]=useState(''),[note,setNote]=useState('');
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState('');
  const [attempt,setAttempt]=useState<{state:string;reference:string;checkoutUrl:string|null}|null>(null);
  const key=useRef<string|null>(null);
  const inflight=useRef(false);
  const inputValid=positive(student)&&positive(term)&&(!selectionOptions||(
    selectionOptions.students.some(s=>String(s.id)===student)&&selectionOptions.terms.some(t=>String(t.id)===term)));
  const params={studentId:Number(student),termId:Number(term)};
  const status=useGetDirectStudentLiveReadiness(schoolId,params,{query:{
    queryKey:[...getGetDirectStudentLiveReadinessQueryKey(schoolId,params),`actor:${actorId??'none'}`],
    enabled:schoolId>0&&!!actorId&&inputValid,staleTime:0,refetchOnMount:'always',placeholderData:undefined,
    refetchOnWindowFocus:true,refetchInterval:15000,retry:false,
  }});
  const canStart=inputValid&&status.data?.ready===true&&status.data.mode==='LIVE'&&status.data.amountMinor===320000
    &&status.data.currency==='NGN'&&!status.isFetching&&!busy&&!uncertain&&!safeDirectCheckoutUrl(attempt?.checkoutUrl);
  const checkout=async()=>{
    if(!canStart||!inputValid||inflight.current)return;
    if(!window.confirm('Start the reviewed ₦3,200 LIVE payment to Yetenia for this student and term? No money goes to a school or BRO.'))return;
    inflight.current=true;key.current??=crypto.randomUUID();setBusy(true);setMessage('');
    try{
      const saved=await createDirectStudentLiveCheckout(schoolId,params,{headers:{'Idempotency-Key':key.current}});
      setAttempt(saved);
      onPaymentStateChange?.();
      if(saved.state==='FAILED'){key.current=crypto.randomUUID();setMessage('The provider verified a failed attempt. A new attempt requires another explicit confirmation.');}
      else setMessage(saved.state==='READY'?'Checkout created. Follow the provider link only if you intend to pay.':'Existing attempt retained; do not start another payment until it is reconciled.');
    }catch{
      setUncertain(true);setMessage('The original request may have reached Flutterwave. Do not retry automatically or transfer money again. Ask the Owner to reconcile the attempt using the original request.');
    }finally{inflight.current=false;setBusy(false);}
  };
  const ask=async(e:FormEvent)=>{
    e.preventDefault();
    if(!inputValid||note.trim().length<3||busy
      ||status.data?.blockers.includes('FREE_ROLLOUT_NO_PLATFORM_PAYMENT')!==false)return;
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
      <p className="text-sm text-[hsl(var(--muted-foreground))]">Use EduCore free for the current term, without NFC devices or cards. Collection begins only in this school's configured second academic term starting in January 2027. Parents pay school fees directly to the school. Separately, the School Admin initiates ₦3,200 per student per academic term to the Platform Owner through Flutterwave. All gross proceeds settle to the Owner's merchant account; no school or BRO split is sent. An eligible BRO may earn a separate internal ₦150 entitlement under the reviewed policy. Without an eligible BRO, no BRO ledger record or liability is created.</p>
      <label className="mt-3 block text-sm font-semibold">Fixed Student platform fee<input readOnly aria-readonly="true" aria-label="Fixed Student platform fee" value="₦3,200" className={field} /></label></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold">{selectionOptions?'Student':'Student ID'}{selectionOptions
        ?<select aria-label="Student" data-testid="select-assisted-student" className={field} disabled={busy} value={student} onChange={e=>{setStudent(e.target.value);setAttempt(null);setUncertain(false);key.current=null;setMessage('');}}>
          <option value="">Select a student</option>{selectionOptions.students.map(s=><option key={s.id} value={s.id}>{s.firstName} {s.lastName} · {s.admissionNo}</option>)}</select>
        :<input className={field} disabled={busy} inputMode="numeric" value={student} onChange={e=>{setStudent(e.target.value);setAttempt(null);setUncertain(false);key.current=null;setMessage('');}} />}</label>
      <label className="text-sm font-semibold">{selectionOptions?'Academic term':'Academic term ID'}{selectionOptions
        ?<select aria-label="Academic term" data-testid="select-assisted-term" className={field} disabled={busy} value={term} onChange={e=>{setTerm(e.target.value);setAttempt(null);setUncertain(false);key.current=null;setMessage('');}}>
          <option value="">Select an academic term</option>{selectionOptions.terms.map(t=><option key={t.id} value={t.id}>{t.sessionName}, {t.name}</option>)}</select>
        :<input className={field} disabled={busy} inputMode="numeric" value={term} onChange={e=>{setTerm(e.target.value);setAttempt(null);setUncertain(false);key.current=null;setMessage('');}} />}</label>
    </div>
    <p className="text-xs font-semibold" role="status">
      {!inputValid?'Select the exact student and academic term to check readiness.'
        : status.isLoading?'Checking reviewed rules and reconciliation…'
        : status.isError?'Readiness cannot be verified. No checkout will start.'
        : status.data?.ready&&status.data.mode==='LIVE'?'Reviewed direct checkout is available for this scope.'
        : status.data?.blockers.includes('FREE_ROLLOUT_NO_PLATFORM_PAYMENT')
          ? 'Free rollout: no platform charge, payment obligation or checkout. Billing waits for the school’s configured January 2027 second term to begin.'
          : `${status.data?.mode==='TEST_ONLY'?'TEST-only environment; no LIVE payment. ':''}Checkout blocked: ${status.data?.blockers.join(', ')||'no reviewed rule or reconciliation approval'}.`}
    </p>
    <Button disabled={!canStart} onClick={()=>void checkout()} testId="button-direct-student-checkout">{busy?'Working…':'Start direct platform checkout'}</Button>
    {attempt && <p className="text-xs">Attempt {attempt.reference} · {attempt.state}. {safeDirectCheckoutUrl(attempt.checkoutUrl) &&
      <a href={safeDirectCheckoutUrl(attempt.checkoutUrl)!} target="_blank" rel="noopener noreferrer" className="underline">Open Flutterwave checkout</a>}</p>}
    {showAssistance&&<form onSubmit={e=>void ask(e)} className="space-y-2 border-t border-[hsl(var(--border))] pt-4">
      <label className="block text-sm font-semibold">Request Owner bank-transfer assistance
        <textarea className={field} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="Reason for assistance" /></label>
      <p className="text-xs">A request or receipt upload is not bank credit. The Owner must verify the actual ₦3,200 transfer independently before any Flutterwave attempt; failed attempts never collect the transfer again.</p>
      <Button type="submit" variant="outline" disabled={!inputValid||note.trim().length<3||busy||status.data?.blockers.includes('FREE_ROLLOUT_NO_PLATFORM_PAYMENT')!==false} testId="button-request-direct-assistance">Record request only</Button>
    </form>}
    <p className="text-xs">Creating checkout or returning from Flutterwave is not proof of payment. Only an independently verified successful transaction bound to this student and term satisfies the separate platform obligation.</p>
    {message&&<p role="status" className="text-xs font-semibold">{message}</p>}
  </section>;
}
