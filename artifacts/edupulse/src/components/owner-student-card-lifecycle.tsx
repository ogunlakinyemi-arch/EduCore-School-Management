import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {
  useGetAuthorizedContext,useGetOwnerStudentCardReadiness,useGetOfficialCardPreview,
  useUpdateCardStatus,getListCardsQueryKey,
} from '@workspace/api-client-react';
import {Button,Field,Modal} from './shared';
import {PrintableNfcCardDownload} from './printable-nfc-card-download';
import {backendError} from './uid-actions';
import {OwnerCardControls,CardStatusSummary,CardControlHistory,useExpiryClock,graceExpiry} from './owner-student-card-controls';

/** Fresh readiness and preview are tied to the exact card AND selected student. */
export function OwnerStudentCardLifecycle({cardId,schoolId,studentId,uid,autoPreview=false,onChanged}:{
  cardId:number;schoolId:number;studentId:number;uid:string;autoPreview?:boolean;onChanged?:()=>void;
}){
  const authorized=useGetAuthorizedContext();
  const owner=authorized.data?.isPlatformOwner===true;
  const qc=useQueryClient();
  const [open,setOpen]=useState(false);
  const [reason,setReason]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [view,setView]=useState(autoPreview);
  const [success,setSuccess]=useState('');
  const key=['owner-student-card-readiness',authorized.data?.user?.id,schoolId,studentId,cardId,uid];
  const query=useGetOwnerStudentCardReadiness(cardId,{schoolId,studentId},{
    query:{enabled:owner,queryKey:key,staleTime:0,refetchOnWindowFocus:true,refetchInterval:15000},
  });
  const data=query.data;
  const exact=data?.cardId===cardId && data.studentId===studentId && data.schoolId===schoolId &&
    data.uid.toUpperCase()===uid.toUpperCase();
  // Do not present cached printable identities while authoritative eligibility is refreshing.
  // Grace expiry is enforced on the local clock; a refetch is scheduled exactly at expiry.
  const graceActive=!!data?.grace?.grant && data.grace.state==='ACTIVE';
  const clock=useExpiryClock(graceActive?graceExpiry(data):null,()=>{void query.refetch();});
  const graceExpired=graceActive && clock.expired;
  const printable=owner && exact && !query.isFetching && !query.isError && !graceExpired && data.canPrint;
  const preview=useGetOfficialCardPreview(cardId,{schoolId},{
    query:{enabled:!!printable && view,queryKey:['owner-linked-card-preview',authorized.data?.user?.id,schoolId,studentId,cardId,uid],
      staleTime:0,gcTime:0,refetchOnWindowFocus:true},
  });
  const activate=useUpdateCardStatus();
  const refresh=async()=>{
    await Promise.all([
      qc.invalidateQueries({queryKey:key}),
      qc.invalidateQueries({queryKey:getListCardsQueryKey()}),
      qc.invalidateQueries({queryKey:['owner-link-students']}),
      qc.invalidateQueries({queryKey:['owner-linked-card-preview']}),
      qc.invalidateQueries({queryKey:['owner-student-card-readiness']}),
    ]);
    onChanged?.();
  };
  if(!owner)return null;
  return <section className="space-y-3 rounded-xl border border-[hsl(var(--border))] p-4" data-testid="owner-card-lifecycle">
    <h3 className="font-semibold">Current student e-ID · <span className="break-all font-mono">{uid}</span></h3>
    {query.isFetching && data && <p role="status">Refreshing current eligibility…</p>}
    {query.isLoading || (query.isFetching && !data)?<p role="status">Checking the saved assignment and activation requirements…</p>:
      query.isError?<p role="alert">{backendError(query.error)} <button type="button" className="underline" onClick={()=>query.refetch()}>Refresh readiness</button></p>:
      !exact?<p role="alert">The current card assignment changed. Refresh the person and card list; no printable card is offered.</p>:
      <>
        <p data-testid="card-lock-explanation">{data.explanation}</p>
        {data.restrictions.map(item=><div key={item.code} role="status" data-testid={`card-restriction-${item.code}`}>
          <p className="font-semibold">{item.message}{item.waived?' (waived by grace; payment not marked paid)':' (applies)'}</p><p className="text-sm">{item.resolution}</p>
        </div>)}
        {!data.canPrint && <p className="text-sm">The final printable e-ID is unavailable until this card is active and these checks pass. Linking and printing never override an NFC restriction.</p>}
        <CardStatusSummary data={data} graceExpired={graceExpired}/>
        {graceExpired && <p role="alert" data-testid="text-grace-expired">Grace period has expired. Grace-dependent actions and printing are disabled while the server is rechecked.</p>}
        <OwnerCardControls key={`${schoolId}:${studentId}:${cardId}:${uid}`} data={data} cardId={cardId} schoolId={schoolId} studentId={studentId} graceExpired={graceExpired} refreshing={query.isFetching}
          onRefresh={refresh} onRefetch={()=>{void query.refetch();}}/>
        <CardControlHistory history={data.history??[]}/>
        {data.canActivate && data.stage==='AWAITING_ACTIVATION' && <Button type="button" variant="outline" testId="button-owner-activate-card" onClick={()=>{
          activate.reset();setReason('');setConfirmed(false);setOpen(true);
        }}>Activate linked card</Button>}
        {printable && <>
          {!view && <Button type="button" variant="outline" onClick={()=>setView(true)}>View final e-ID card</Button>}
          {view && (preview.isLoading || preview.isFetching?<p role="status">Loading the saved school-branded e-ID…</p>:
            preview.isError?<p role="alert">{backendError(preview.error)} <button type="button" onClick={()=>preview.refetch()}>Retry preview</button></p>:
            preview.data && <div className="space-y-3" data-testid="linked-card-preview">
              <img src={preview.data.frontImage} alt={`Final student e-ID front · UID ${uid}`} className="w-full max-w-xl rounded-md border" />
              <img src={preview.data.backImage} alt="Final student e-ID back" className="w-full max-w-xl rounded-md border" />
              <p className="text-xs">Saved student identity and school branding · existing CR80 front/back format.</p>
            </div>)}
          <PrintableNfcCardDownload cardId={cardId} schoolId={schoolId} ownerAuthorized cardType="STUDENT" cardStatus={data.status}/>
          <p className="text-xs">Download the official PDF, then print at actual size using the existing card-print workflow.</p>
        </>}
      </>}
    {success && <p role="status">{success}</p>}
    {open && <Modal title="Confirm card activation / unlock" eyebrow="Platform Owner · exact current UID" onClose={()=>{if(!activate.isPending)setOpen(false);}}>
      <div className="space-y-4">
        <p>Activate UID <strong className="break-all font-mono">{uid}</strong> for the selected student? All eligibility checks run again on the server. This cannot clear lost/stolen, expiry, account, school or payment restrictions.</p>
        <Field label="Activation / unlock reason (required)">
          <input value={reason} maxLength={480} disabled={activate.isPending} onChange={e=>setReason(e.target.value)} data-testid="input-card-activation-reason"/>
        </Field>
        <label className="flex gap-2"><input type="checkbox" className="!w-auto" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={activate.isPending} data-testid="confirm-card-activation"/>I reviewed this UID and its restriction history.</label>
        {activate.isError && <p role="alert">{backendError(activate.error)}</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" disabled={activate.isPending} onClick={()=>setOpen(false)}>Cancel</Button>
          <Button type="button" disabled={!confirmed || reason.trim().length<3 || activate.isPending}
            testId="submit-card-activation" onClick={()=>activate.mutate({
              cardId,data:{status:'active',confirm:true,studentId,reason:reason.trim()},
            },{onSuccess:async()=>{
              setOpen(false);setView(true);setSuccess(`UID ${uid} activated. Attendance still applies its normal reader and policy checks.`);
              await refresh();
            },onError:()=>{void query.refetch();}})}>{activate.isPending?'Checking…':'Confirm activation / unlock'}</Button>
        </div>
      </div>
    </Modal>}
  </section>;
}
