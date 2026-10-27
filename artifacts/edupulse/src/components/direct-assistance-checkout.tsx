import { useRef,useState } from 'react';
import {
  useGetAuthorizedContext,useGetDirectStudentLiveReadiness,getGetDirectStudentLiveReadinessQueryKey,
  createAssistedDirectStudentCheckout,
} from '@workspace/api-client-react';
import { Button } from '@/components/shared';
import { safeDirectCheckoutUrl } from './direct-student-live-panel';
import type { AssistanceSnapshot } from '@/pages/subscription-payment-rules';

/** This is a separate payment after an independently verified business-bank credit. */
export function DirectAssistanceCheckout({caseFile}:{caseFile:AssistanceSnapshot}){
  const actorId=useGetAuthorizedContext().data?.user?.id;
  const [inspect,setInspect]=useState(false),[busy,setBusy]=useState(false);
  const [uncertain,setUncertain]=useState(false),[message,setMessage]=useState('');
  const [reference,setReference]=useState('');
  const [checkoutUrl,setCheckoutUrl]=useState<string|null>(null);
  const requestKey=useRef<string|null>(null);
  const bankVerified=caseFile.status==='BANK_VERIFIED'&&caseFile.verifiedAmountMinor===320000
    &&!!caseFile.bankStatementReference&&!!caseFile.bankCreditDate;
  const params={studentId:caseFile.studentId,termId:caseFile.termId};
  const status=useGetDirectStudentLiveReadiness(caseFile.schoolId,params,{query:{
    queryKey:[...getGetDirectStudentLiveReadinessQueryKey(caseFile.schoolId,params),`actor:${actorId??'none'}`],
    enabled:inspect&&bankVerified&&!!actorId,
    staleTime:0,refetchOnMount:'always',refetchOnWindowFocus:true,refetchInterval:15000,retry:false,
  }});
  const start=async()=>{
    if(!bankVerified||status.data?.ready!==true||status.isFetching||busy||uncertain||checkoutUrl)return;
    if(!window.confirm(`You independently verified ₦3,200 bank credit for assistance #${caseFile.id}. Initiate the LIVE Flutterwave payment to Yetenia only? The bank transfer will not be collected again.`))return;
    requestKey.current??=crypto.randomUUID();setBusy(true);setMessage('');
    try{
      const result=await createAssistedDirectStudentCheckout(caseFile.id,{headers:{'Idempotency-Key':requestKey.current}});
      setReference(result.reference);
      setCheckoutUrl(result.state==='READY'?safeDirectCheckoutUrl(result.checkoutUrl):null);
      if(result.state==='FAILED'){
        requestKey.current=crypto.randomUUID();
        setMessage('Provider failure verified with no charge. Bank credit remains recorded. A new attempt requires another explicit confirmation.');
      }else if(result.state==='READY')setMessage('Existing bank credit retained. A checkout link has been prepared; the payment is not verified.');
      else{setUncertain(true);setMessage('This attempt must be reconciled before another payment. Do not collect another bank transfer.');}
    }catch{
      setUncertain(true);setMessage('The provider may have accepted the original reference. Do not resend automatically or collect the transfer again; reconcile the original attempt first.');
    }finally{setBusy(false);}
  };
  if(!bankVerified)return null;
  return <div className="mt-3 space-y-2 border-t border-[hsl(var(--border))] pt-3 text-xs" data-testid={`direct-assistance-${caseFile.id}`}>
    <p className="font-semibold">Separate, non-split LIVE Yetenia payment · ₦3,200. The saved bank credit is not a Flutterwave payment.</p>
    {!inspect?<Button type="button" variant="outline" onClick={()=>setInspect(true)}>Check direct-payment readiness</Button>
      : <p role="status">{status.isLoading?'Checking approved rule and term reconciliation…'
        : status.isError?'Readiness unavailable. No payment can start.'
        : status.data?.ready?'Approved readiness for this student and term.'
        : `Checkout blocked: ${status.data?.blockers.join(', ')||'independent approval required'}.`}</p>}
    {inspect&&<Button type="button" disabled={status.data?.ready!==true||status.isFetching||busy||uncertain||!!checkoutUrl}
      onClick={()=>void start()} testId={`button-owner-direct-${caseFile.id}`}>Start verified-bank platform checkout</Button>}
    {reference&&<p>Original attempt: {reference}</p>}{message&&<p role="status">{message}</p>}
    {checkoutUrl&&<a href={checkoutUrl} target="_blank" rel="noopener noreferrer" className="underline">Open verified-bank Flutterwave checkout</a>}
  </div>;
}
