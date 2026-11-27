import {useRef,useState,type FormEvent} from 'react';
import {Link} from 'wouter';
import {useGetOwnerBankTransferInstructions,requestDirectStudentAssistance} from '@workspace/api-client-react';
import {Modal,Button,Info} from '@/components/shared';

/** Opens with a private GET only. Evidence submission reuses the existing
 * REQUESTED workflow and never invokes checkout or bank-credit verification. */
export function OwnerBankTransferAssistance({schoolId,studentId,termId,actorId,onClose}:{
  schoolId:number;studentId:number;termId:number;actorId:number;onClose:()=>void;
}){
  const q=useGetOwnerBankTransferInstructions(schoolId,{studentId,termId},{query:{
    queryKey:['owner-transfer-instructions',actorId,schoolId,studentId,termId],
    gcTime:0,staleTime:0,retry:false,refetchOnMount:'always',refetchOnWindowFocus:true,refetchInterval:30000,
  }});
  const [note,setNote]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const [saved,setSaved]=useState<number|null>(null),[message,setMessage]=useState('');
  const inflight=useRef(false);
  const d=q.data,prefix=d?`${d.transferReference}\nEvidence/request: `:'';
  const canSubmit=!!d&&d.collectionPeriodEligible&&!d.ownerConfigurationPath&&
    !q.isFetching&&!q.isError&&!busy&&!uncertain&&!saved&&note.trim().length>=3;
  const submit=async(e:FormEvent)=>{
    e.preventDefault();
    if(!canSubmit||!d||inflight.current)return;
    if(!window.confirm('Submit evidence/an assistance request only? This does not confirm bank receipt, credit a subscription, or start Flutterwave.'))return;
    inflight.current=true;setBusy(true);setMessage('');
    try{
      const result=await requestDirectStudentAssistance(schoolId,{studentId,termId,requestNote:prefix+note.trim()});
      if(result.status!=='REQUESTED'||!Number.isSafeInteger(result.id)||result.id<=0)throw new Error('Unconfirmed request result');
      setSaved(result.id);setMessage(`Request #${result.id} submitted for authorized review. No transfer has been confirmed or subscription credited.`);
    }catch{
      setUncertain(true);setMessage('The request may already have been saved. Do not resubmit or transfer again; ask the Owner to check the existing request and bank credit.');
    }finally{inflight.current=false;setBusy(false);}
  };
  return <Modal title="Owner bank-transfer assistance" eyebrow="School subscription · instructions only" onClose={onClose}>
    <div className="space-y-4" data-testid="owner-bank-transfer-assistance">
      <p className="text-sm font-semibold">Subscription rate: ₦3,200 per student per academic term, paid separately to the Platform Owner.</p>
      <p className="text-sm" role="note">This is the historical single-student assistance workflow, not a school settlement account or proof of Flutterwave LIVE readiness. Its retained receipts are not subscription payments: this workflow still requires a separate authorized, independently verified Flutterwave checkout. For the new aggregate company-bank workflow, request bank remittance from Subscriptions; an independently checked Owner bank credit must then be explicitly allocated to students. Viewing account details, opening a request or uploading a receipt never marks a student paid.</p>
      {q.isLoading||q.isFetching?<p role="status">Checking verified Owner business account details…</p>:
        q.isError||!d?<div role="alert"><p>Verified Owner bank details cannot be loaded. Do not transfer funds.</p>
          <Button variant="outline" onClick={()=>void q.refetch()}>Reload instructions</Button></div>:
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Info label="School" value={d.schoolName} /><Info label="Academic term" value={d.termName} />
            <Info label="Student ID" value={String(studentId)} />
            <Info label="Required school/term transfer reference" value={<span className="break-all font-mono select-all">{d.transferReference}</span>} />
          </div>
          {!d.collectionPeriodEligible&&<p role="alert" className="text-sm font-semibold">This period is not currently eligible for subscription collection. Do not transfer funds or submit a payment request. Current-term free use and school-specific rollout rules remain in effect.</p>}
          {d.available&&d.bank?<section className="space-y-3 rounded-xl border border-[hsl(var(--border))] p-4" aria-label="Verified Owner business account">
            <h3 className="font-bold">Official Owner business bank-transfer details</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Info label="Business" value={d.bank.businessName} /><Info label="Bank" value={d.bank.bankName} />
              <Info label="Account name" value={d.bank.accountName} />
              <Info label="Account number" value={<span className="font-mono select-all">{d.bank.accountNumber}</span>} />
            </div>
          </section>:<p role="alert" className="text-sm font-semibold">{d.message}</p>}
          {d.ownerConfigurationPath
            ?<Link href={d.ownerConfigurationPath} className="text-sm font-semibold underline">Owner only: review assistance receiving details in Owner payment settings</Link>
            :!d.available&&<p className="text-sm">Verified assistance transfer details are hidden. Do not transfer funds; contact the Platform Owner. No supported company verification action is currently available in EduCore. Saving details in Flutterwave does not verify this EduCore instruction record. School Admins cannot configure or approve this account.</p>}
          <p className="text-sm">Use the exact reference above for this school, student and term. Include the bank transfer reference, date and receipt/evidence reference in the existing assistance request below. Do not include passwords or full bank statements.</p>
          <p className="text-sm font-semibold">Do not transfer twice for an existing paid, pending or uncertain payment. Ask the Owner to reconcile the original payment first. A receipt or reference is evidence only—not confirmed receipt or subscription credit.</p>
          {!d.ownerConfigurationPath&&<form onSubmit={e=>void submit(e)} className="space-y-3">
            <label className="block text-sm font-semibold">Transfer evidence/reference or assistance note
              <textarea className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2"
                value={note} onChange={e=>setNote(e.target.value)} maxLength={500-prefix.length}
                disabled={busy||!!saved||uncertain} />
            </label>
            <Button type="submit" variant="outline" disabled={!canSubmit} testId="button-submit-owner-transfer-evidence">
              {busy?'Submitting…':d.available?'Submit evidence / request review':'Request Owner assistance'}
            </Button>
          </form>}
        </>}
      {message&&<p role="status" className="text-sm font-semibold">{message}</p>}
    </div>
  </Modal>;
}
