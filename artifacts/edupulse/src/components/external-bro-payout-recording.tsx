import {useState} from 'react';
import {Button,Field,Modal} from './shared';
import {naira,type FinanceOverview,type Payout,type useFinanceAction} from '@/lib/current-finance';

type Fin=ReturnType<typeof useFinanceAction>;
type Result=Awaited<ReturnType<Fin['run']>>;
/** Existing reserved payouts only; no transfer creation or balance override. */
export function ExternalBroPayoutRecording({data,fin,report}:{
  data:FinanceOverview;fin:Fin;report:(r:Result,message:string)=>void;
}){
  const [selected,setSelected]=useState<Payout[]|null>(null);
  const [bank,setBank]=useState<{bankName:string;accountName:string;accountNumber:string}|null>(null);
  const [form,setForm]=useState({transferReference:'',statementReference:'',transferDate:'',reason:'',completed:false,checked:false});
  const [message,setMessage]=useState('');
  const groups=new Map<string,Payout[]>();
  for(const p of data.payouts.filter(p=>p.state==='PENDING'&&p.partnerId&&p.bankFingerprint)){
    const key=`${p.partnerId}:${p.bankFingerprint}`;
    groups.set(key,[...(groups.get(key)??[]),p]);
  }
  const current=selected?.map(p=>data.payouts.find(q=>q.id===p.id&&q.state==='PENDING'));
  const stillPending=!!current?.length&&current.every(Boolean);
  const ids=selected?.map(p=>p.id).sort((a,b)=>a-b)??[];
  const slot=`external-paid:${ids.join(',')}`;
  const amount=selected?.reduce((n,p)=>n+p.amountMinor,0)??0;
  const close=()=>{setSelected(null);setBank(null);setMessage('');};
  const reveal=async()=>{
    if(!selected?.length)return;
    const r=await fin.run(`bank-reveal:${selected[0].id}`,'PAYOUT_BANK_REVEAL',
      {id:selected[0].id,reason:'Owner reviewed frozen bank instructions before external transfer'},true);
    if(r.ok&&typeof r.result.bankName==='string'&&typeof r.result.accountName==='string'&&typeof r.result.accountNumber==='string'){
      setBank({bankName:r.result.bankName,accountName:r.result.accountName,accountNumber:r.result.accountNumber});
      setMessage('');
    }else setMessage(r.ok?'Frozen bank instructions could not be confirmed.':r.message);
  };
  const submit=async()=>{
    if(!stillPending||!form.completed||!form.checked||!bank)return;
    const r=await fin.run(slot,'PAYOUT_RECORD_EXTERNAL',{ids,amountMinor:amount,
      transferReference:form.transferReference.trim(),statementReference:form.statementReference.trim(),
      transferDate:form.transferDate,reason:form.reason.trim(),
      confirmExternalTransfer:true,independentlyChecked:true},true);
    report(r,'Completed external transfer recorded against the reserved commission. EduCore sent no money.');
    if(r.ok)close();else setMessage(`${r.message}${r.uncertain?' Outcome uncertain. Refresh before resubmitting the same record.':''}`);
  };
  if(!groups.size&&!selected)return null;
  return <section className="mt-5 space-y-3" aria-label="Record external BRO bank transfers">
    <h4 className="font-bold">Record a completed bank transfer</h4>
    <p className="text-xs">Transfer from your bank separately. Record only after checking its completed debit and beneficiary.</p>
    {[...groups.entries()].map(([key,group])=><div key={key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm">
      <span><b>{group[0].broName??`BRO #${group[0].partnerId}`}</b> · {naira(group.reduce((n,p)=>n+p.amountMinor,0))}
        <span className="block text-xs">{group.length} reserved line(s) · {group[0].bankName??'Frozen verified bank'} · {group[0].maskedAccountNumber}</span>
      </span>
      <Button variant="outline" testId={`button-record-external-${group[0].id}`} onClick={()=>{
        setSelected(group);setBank(null);setMessage('');
        setForm({transferReference:'',statementReference:'',transferDate:'',reason:'',completed:false,checked:false});
      }}>Record completed transfer</Button>
    </div>)}
    {selected&&<Modal title="Record completed BRO transfer" eyebrow="Owner / External bank evidence" onClose={close}>
      <div className="space-y-4">
        <p className="text-sm"><b>{selected[0].broName}</b> · {ids.length} reserved lines · <b>{naira(amount)}</b></p>
        <p className="text-xs">This records your bank-statement review. It does not send money or automatically verify a bank transfer.</p>
        {!stillPending&&<p role="alert" className="text-sm">A payout changed. Close and refresh before recording.</p>}
        {!bank?<Button variant="outline" onClick={()=>void reveal()} disabled={fin.isPending} testId="button-reveal-current-bank">Review frozen bank instructions</Button>:
          <dl className="rounded-xl border p-3 text-sm" data-testid="frozen-current-bank">
            <dt>Bank</dt><dd>{bank.bankName}</dd><dt>Beneficiary</dt><dd>{bank.accountName}</dd><dt>Account</dt><dd className="font-mono">{bank.accountNumber}</dd>
          </dl>}
        {(['transferReference','statementReference','transferDate','reason'] as const).map(key=><Field key={key}
          label={{transferReference:'Bank transfer reference',statementReference:'Bank statement evidence reference',transferDate:'Actual transfer date',reason:'Review note'}[key]}>
          <input type={key==='transferDate'?'date':'text'} maxLength={key==='reason'?500:120}
            data-testid={`input-external-${key}`} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/>
        </Field>)}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.completed}
          data-testid="check-external-completed" onChange={e=>setForm({...form,completed:e.target.checked})}/>
          I completed this transfer outside EduCore.</label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.checked}
          data-testid="check-external-statement" onChange={e=>setForm({...form,checked:e.target.checked})}/>
          I independently checked the completed bank debit, exact amount and frozen beneficiary.</label>
        {message&&<p role="alert" className="text-sm">{message}</p>}
        <Button testId="button-submit-external-transfer" onClick={()=>void submit()}
          disabled={!bank||!stillPending||fin.isPending||!form.completed||!form.checked||form.transferReference.trim().length<6
            ||form.statementReference.trim().length<6||!form.transferDate||form.reason.trim().length<3}>
          {fin.pendingKey(slot)?'Resubmit same transfer record':'Record as paid — no transfer sent'}
        </Button>
      </div>
    </Modal>}
  </section>;
}
