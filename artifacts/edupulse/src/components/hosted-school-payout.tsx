import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch, type SchoolPayoutPreview } from '@workspace/api-client-react';
import { Button, StatusPill, money } from '@/components/shared';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ReceiptDownloadButton, ReceiptFilePicker, uploadPrivateReceipt, validateReceiptFile } from './private-receipt';

const currency=(n:number|null|undefined)=>n==null?'Not verified':money(n/100);
const errorText=(e:unknown)=>(e as {data?:{error?:string}})?.data?.error??(e instanceof Error?e.message:'Operation not confirmed. Reconcile the saved transfer; do not pay again.');
export function HostedSchoolPayout({reference,claimed,successful}:{reference:string;claimed:boolean;successful:boolean}) {
  const [open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false);
  const [file,setFile]=useState<File|null>(null),[transferDate,setDate]=useState('');
  const uploaded=useRef<{key:string;id:string}|null>(null);
  const qc=useQueryClient(),key=['hosted-school-payout',reference],path=`/api/hosted-payments/orders/${encodeURIComponent(reference)}/school-payout`;
  const q=useQuery({queryKey:key,enabled:open,queryFn:()=>customFetch<SchoolPayoutPreview>(path,{responseType:'json'}),
    staleTime:0,refetchOnWindowFocus:false});
  const request=(url:string,body:unknown)=>customFetch<SchoolPayoutPreview>(url,{
    method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'},responseType:'json'});
  const refresh=()=>{
    setConfirmed(false);
    void qc.invalidateQueries({queryKey:key});
    void qc.invalidateQueries({queryKey:['hosted-payments','orders']});
  };
  const action=useMutation({
    mutationFn:(kind:'pay'|'reconcile')=>kind==='pay'
      ?request(path,{confirmationToken:q.data?.confirmationToken,confirmed:true}):request(`${path}/reconcile`,{}),
    onSuccess:data=>qc.setQueryData(key,data),onSettled:refresh,
  });
  const proof=useMutation({
    mutationFn:async()=>{
      if(!file || validateReceiptFile(file) || !transferDate) throw new Error('Select a valid receipt and actual transfer date.');
      const uploadKey=`${reference}:${file.name}:${file.size}:${file.lastModified}:${transferDate}`;
      if(uploaded.current?.key!==uploadKey) {
        const result=await uploadPrivateReceipt({kind:'SCHOOL_SETTLEMENT',orderReference:reference,amountMinor:190000,
          purpose:`Successful school payout ${reference}`,transferDate,transferCompleted:true},file);
        uploaded.current={key:uploadKey,id:result.id};
      }
      return request(`${path}/receipt`,{proofReceiptId:uploaded.current.id,settlementDate:transferDate});
    },onSuccess:data=>qc.setQueryData(key,data),onSettled:refresh,
  });
  const p=q.data,busy=action.isPending||proof.isPending;
  return <>
    <Button variant="outline" onClick={()=>{setOpen(true);setConfirmed(false);}} testId={`pay-school-${reference}`}>
      {successful?'School transfer and proof':claimed?'Review school transfer':'Pay School Now'}
    </Button>
    <Dialog open={open} onOpenChange={v=>{if(!busy)setOpen(v);}}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{successful?'Successful school transfer':'Pay School Now'}</DialogTitle>
          <DialogDescription>Owner-authorised Flutterwave bank transfer. No settlement is recorded until a separate provider status check confirms success.</DialogDescription>
        </DialogHeader>
        {q.isPending&&<p role="status">Checking saved beneficiary and funding prerequisites…</p>}
        {q.isError&&<div role="alert"><p>{errorText(q.error)}</p><Button variant="outline" onClick={()=>void q.refetch()}>Reload transfer details</Button></div>}
        {p&&<>
          <div className="flex flex-wrap items-center gap-2"><strong>{p.schoolName}</strong><StatusPill value={p.status}/><span className="text-xs font-semibold">{p.mode} mode</span></div>
          <dl className="grid grid-cols-2 gap-3 rounded-xl border p-4 text-sm">
            <div><dt className="text-muted-foreground">School entitlement</dt><dd className="font-bold">{currency(p.amountMinor)}</dd></div>
            <div><dt className="text-muted-foreground">Collection status</dt><dd>{p.paymentStatus}</dd></div>
            <div className="col-span-2"><dt className="text-muted-foreground">Student payment reference</dt><dd className="break-all font-mono text-xs">{p.paymentReference}</dd></div>
            <div><dt className="text-muted-foreground">Bank</dt><dd>{p.recipient?.bankName??'Not configured'}</dd></div>
            <div><dt className="text-muted-foreground">Beneficiary</dt><dd>{p.recipient?.accountName??'Not verified'} {p.recipient?.maskedAccount}</dd></div>
            <div className="col-span-2"><dt className="text-muted-foreground">Collection subaccount / saved profile status</dt><dd className="break-all">{p.recipient?.subaccountId??'No collection subaccount recorded'} · {p.recipient?.subaccountStatus??'Unavailable'}</dd></div>
            <div className="col-span-2 text-xs text-muted-foreground">The subaccount ID is shown for review only. The transfer destination is the verified bank account. {p.bankVerifiedAt?'Fresh Flutterwave bank resolution completed.':'Fresh bank resolution has not been completed for a new transfer.'}</div>
            <div><dt className="text-muted-foreground">Available NGN wallet</dt><dd>{currency(p.availableBalanceMinor)}</dd></div>
            <div><dt className="text-muted-foreground">Reserved pending transfers</dt><dd>{currency(p.reservedMinor)}</dd></div>
            <div><dt className="text-muted-foreground">Quoted transfer fee</dt><dd>{currency(p.feeQuoteMinor)}</dd></div>
            <div><dt className="text-muted-foreground">Approved fee ceiling</dt><dd>{currency(p.maxFeeMinor)}</dd></div>
            {p.transferReference&&<div className="col-span-2"><dt className="text-muted-foreground">Unique transfer reference</dt><dd className="break-all font-mono text-xs">{p.transferReference}</dd></div>}
          </dl>
          {p.blockers.length>0&&<div className="rounded-xl border p-3 text-sm" role="status">
            <strong>{p.transferReference?'Transfer safeguards':'Payout disabled — missing prerequisites'}</strong>
            <ul className="ml-4 mt-2 list-disc space-y-1">{p.blockers.map((b,i)=><li key={i}>{b}</li>)}</ul>
          </div>}
          <p className="text-xs text-muted-foreground">Funding source: merchant NGN available transfer balance, not unsettled checkout collections. Transfer fees are borne by the platform and do not reduce the school’s ₦1,900. No new transfer is retried automatically.</p>
          {!p.transferReference&&<>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={!p.ready||busy}
              onChange={e=>setConfirmed(e.target.checked)} data-testid="confirm-school-payout"/>
              I authorise exactly ₦1,900 to this verified school bank account in {p.mode} mode, with platform transfer fees up to the displayed ceiling.
            </label>
            <Button disabled={!p.ready||!confirmed||!p.confirmationToken||busy||q.isFetching} onClick={()=>action.mutate('pay')} testId="confirm-pay-school-now">
              {action.isPending?'Reserving transfer…':'Confirm Pay School Now'}
            </Button>
          </>}
          {p.transferReference&&p.status!=='SUCCESS'&&<>
            <p className="text-sm">{p.status==='FAILED'?'Flutterwave confirmed failure. This reference remains retained; there is no automatic retry or second manual payment.':'This is not yet settled. Check the original transfer; do not pay again.'}</p>
            <Button disabled={busy} onClick={()=>action.mutate('reconcile')} testId="reconcile-school-transfer">{action.isPending?'Checking…':'Check original transfer status'}</Button>
          </>}
          {p.status==='SUCCESS'&&(p.receiptId?<ReceiptDownloadButton id={p.receiptId}/>:<section className="space-y-3 rounded-xl border p-4">
            <h3 className="font-semibold">Attach proof after confirmed success</h3>
            <label className="block text-sm">Actual transfer date<input className="mt-1 block w-full rounded-lg border p-2" type="date" value={transferDate} onChange={e=>setDate(e.target.value)}/></label>
            <ReceiptFilePicker file={file} onChange={setFile} disabled={busy}/>
            <Button disabled={busy||!file||!!validateReceiptFile(file)||!transferDate} onClick={()=>proof.mutate()}>{proof.isPending?'Attaching…':'Attach private transfer receipt'}</Button>
          </section>)}
        </>}
        {(action.isError||proof.isError)&&<p role="alert" className="text-sm text-destructive">{errorText(action.error??proof.error)} Refresh or reconcile the original reference before any further action.</p>}
      </DialogContent>
    </Dialog>
  </>;
}
