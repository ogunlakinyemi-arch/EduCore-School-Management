import { useRef,useState,type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { FeeStructure } from '@workspace/api-client-react';
import { phase9Request } from '@/hooks/use-phase9-api';
import { Button,Field,Modal } from '@/components/shared';

export function PublishedFeeCorrections({schoolId,structures,onSaved}:{schoolId:number;structures:FeeStructure[];onSaved:(message:string)=>void}) {
  const published=structures.filter(s=>s.status==='PUBLISHED');
  const [selected,setSelected]=useState('');
  const [editing,setEditing]=useState<FeeStructure|null>(null);
  const [amounts,setAmounts]=useState<string[]>([]);
  const [reason,setReason]=useState('');
  const [error,setError]=useState('');
  const [requestKey,setRequestKey]=useState('');
  const submitting=useRef(false);
  const save=useMutation({mutationFn:(body:Record<string,unknown>)=>phase9Request<{id:number}>(
    `/school/finance/structures/${editing!.id}/corrections?schoolId=${schoolId}`,'POST',body)});
  const open=()=>{
    const structure=published.find(s=>s.id===Number(selected));if(!structure)return;
    setEditing(structure);setAmounts(structure.lines.map(l=>String(l.amountMinor/100)));setReason('');setError('');setRequestKey(crypto.randomUUID());
  };
  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    if(!editing || submitting.current)return;
    const minor=amounts.map(a=>Math.round(Number(a)*100));
    if(amounts.some(a=>!a.trim())||minor.some(a=>!Number.isSafeInteger(a)||a<1||a>2147483647)){setError('Enter valid positive amounts in naira.');return;}
    if(!window.confirm('Save this published fee correction as a new draft? On publication, eligible unpaid invoices are recalculated using their existing IDs. Original versions and audit history remain available.'))return;
    submitting.current=true;setError('');
    try{
      const result=await save.mutateAsync({confirmed:true,expectedVersion:editing.version,reason:reason.trim(),requestKey,
        lines:editing.lines.map((line,index)=>({categoryId:line.categoryId,description:line.description,amountMinor:minor[index]}))});
      setEditing(null);onSaved(`Correction draft #${result.id} saved. Review and publish that draft below. Payments, receipts and the separate NFC fee were not rewritten.`);
    }catch(cause){setError(cause instanceof Error?cause.message:'The correction could not be saved.');}
    finally{submitting.current=false;}
  };
  if(!published.length)return null;
  return <section className="panel mt-5 p-5" aria-label="Published fee corrections">
    <h2 className="display-font text-lg font-bold">Correct a published fee schedule</h2>
    <p className="my-3 text-sm">Original versions remain unchanged. Repricing is limited to unpaid invoices with no payment, provider-checkout or adjustment history. For protected invoices, use invoice adjustments, refunds or payment review. Issued receipts cannot be edited. Bus-only charges use transport controls.</p>
    <div className="flex flex-wrap gap-3"><select aria-label="Published fee schedule" value={selected} onChange={e=>setSelected(e.target.value)} data-testid="select-published-fee-correction">
      <option value="">Select a published schedule</option>{published.map(s=><option key={s.id} value={s.id}>#{s.id} · v{s.version} · class #{s.classId} · term #{s.termId}</option>)}
    </select><Button variant="outline" disabled={!selected} onClick={open} testId="button-edit-published-fees">Edit published fees</Button></div>
    {editing&&<Modal title={`Correct fee structure #${editing.id}`} onClose={()=>{if(!save.isPending)setEditing(null);}}>
      <form className="space-y-4" onSubmit={submit}>
        <p>Save a correction draft, then republish it. Existing invoice IDs and independent NFC subscriptions are reused.</p>
        {editing.lines.map((line,index)=><Field key={line.categoryId} label={`${line.categoryName} — NGN`}>
          <input required type="number" min=".01" step=".01" value={amounts[index]} disabled={save.isPending}
            onChange={e=>setAmounts(current=>current.map((a,i)=>i===index?e.target.value:a))} data-testid={`input-correct-fee-${line.categoryId}`}/>
        </Field>)}
        <Field label="Reason for correction"><textarea required minLength={3} maxLength={500} value={reason} disabled={save.isPending} onChange={e=>setReason(e.target.value)} /></Field>
        {error&&<p role="alert">{error}</p>}
        <Button type="submit" disabled={save.isPending||reason.trim().length<3}>Save correction draft</Button>
      </form>
    </Modal>}
  </section>;
}
