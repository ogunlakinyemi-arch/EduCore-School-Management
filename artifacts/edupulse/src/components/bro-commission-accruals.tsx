import {useState,type FormEvent} from 'react';
import {Button} from '@/components/shared';
export type BroCommissionSnapshot={available:boolean;entries:{id:number;schoolId:number;studentId:number;
  termId:number;partnerId:number;amountMinor:number;status:string}[]};
export function BroCommissionAccruals({snapshot,onAccrue,onRefresh}:{
  snapshot?:BroCommissionSnapshot;
  onAccrue?:(scope:{schoolId:number;studentId:number;termId:number})=>Promise<{id:number;amountMinor:number;existing:boolean}>;
  onRefresh:()=>unknown;
}){
  const [scope,setScope]=useState({schoolId:'',studentId:'',termId:''});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const submit=async(e:FormEvent)=>{
    e.preventDefault();if(busy||!onAccrue||!snapshot?.available)return;
    const values=Object.fromEntries(Object.entries(scope).map(([k,v])=>[k,Number(v)])) as {schoolId:number;studentId:number;termId:number};
    if(!Object.values(values).every(v=>Number.isSafeInteger(v)&&v>0))return;
    if(!window.confirm('Record an eligible ₦150 BRO liability only? This does not pay the BRO, alter a student collection or reprice historical commissions.'))return;
    setBusy(true);setMessage('');
    try{
      const r=await onAccrue(values);
      setMessage(`${r.existing?'Existing earning retained':'Liability recorded'}: #${r.id}, ₦${r.amountMinor/100}. No payment was made.`);
      await onRefresh();
    }catch{setMessage('No new earning confirmed. Approval, eligibility or historical evidence requires review. A retry cannot increase an existing earning.');}
    finally{setBusy(false);}
  };
  return <div className="mt-4 space-y-3 text-sm">
    <p>Prospective policy: <strong>₦150 per eligible student per academic term</strong>. Term commencement in Africa/Lagos must be on or after the approved effective instant. A late payment never reprices an earlier term. Existing ₦100 earnings remain unchanged.</p>
    <p>This is a separate platform expense—not a deduction or split from the fixed ₦3,200 collection. Verified payment, admitted active student and unique historical BRO attribution are required. Ambiguous legacy earnings require review. No automatic payout; term-end Owner approval remains required.</p>
    {!snapshot?.available&&<p role="status">Not effective: storage review and recovery safety clearance are required before installation and activation. No migrations or services are changed by this screen.</p>}
    <form onSubmit={e=>void submit(e)} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">{(['schoolId','studentId','termId'] as const).map(k=>
        <label key={k}>{({schoolId:'School ID',studentId:'Student ID',termId:'Academic term ID'})[k]}
          <input required disabled={busy||!snapshot?.available} inputMode="numeric" pattern="[1-9][0-9]*" className="mt-1 w-full rounded border p-2"
            value={scope[k]} onChange={e=>setScope(s=>({...s,[k]:e.target.value}))}/></label>)}</div>
      <Button type="submit" disabled={busy||!snapshot?.available||!onAccrue}>Record eligible BRO liability</Button>
    </form>
    {message&&<p role="status">{message}</p>}
    {(snapshot?.entries??[]).map(e=><p key={e.id}>#{e.id} · school {e.schoolId} · student {e.studentId} · term {e.termId} · BRO {e.partnerId} · ₦{e.amountMinor/100} · {e.status.replaceAll('_',' ')}</p>)}
  </div>;
}
