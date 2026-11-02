import {useEffect,useRef,useState} from 'react';
import {useControlOwnerStudentCard} from '@workspace/api-client-react';
import type {StudentCardReadiness,StudentCardControlEvent,StudentCardControlInputRestrictionsItem} from '@workspace/api-client-react';
import {Button,Field,Modal} from './shared';
import {backendError} from './uid-actions';

export type ControlAction='LOCK'|'UNLOCK'|'GRANT_GRACE'|'REVOKE_GRACE';
const GRACEABLE=['NFC_FLUTTERWAVE_PAYMENT_REQUIRED','STUDENT_PLATFORM_SUBSCRIPTION_REQUIRED','SUBSCRIPTION_REQUIRED'];
const LABEL:Record<ControlAction,string>={LOCK:'Lock card',UNLOCK:'Unlock card',GRANT_GRACE:'Grant grace period',REVOKE_GRACE:'Revoke grace period'};
const ACTION_TEXT:Record<string,string>={LOCK:'Locked',UNLOCK:'Unlocked',GRANT_GRACE:'Grace granted',REVOKE_GRACE:'Grace revoked'};

const fmt=(iso?:string|null)=>{
  if(!iso)return 'not recorded';const d=new Date(iso);
  return Number.isNaN(d.getTime())?iso:`${d.toLocaleString()} (browser local) · ${d.toISOString()} UTC`;
};
export function graceExpiry(data?:StudentCardReadiness|null):string|null{
  const v=data?.grace?.grant?.details?.expiresAt;return typeof v==='string'?v:null;
}
const coveredOf=(e?:StudentCardControlEvent|null)=>{
  const r=e?.details?.restrictions;return Array.isArray(r)?r.filter((x):x is string=>typeof x==='string'):[];
};
const actor=(id:number|null)=>id==null?'system':`user #${id}`;

/** Local wall-clock that ticks exactly at a target instant (grace expiry). */
export function useExpiryClock(expiresAt:string|null,onExpire:()=>void){
  const [now,setNow]=useState(()=>Date.now());
  const cb=useRef(onExpire);cb.current=onExpire;
  useEffect(()=>{
    if(!expiresAt)return;const at=new Date(expiresAt).getTime();if(Number.isNaN(at))return;
    let t:ReturnType<typeof setTimeout>|undefined;
    const arm=()=>{
      const wait=at-Date.now();
      if(wait<=0){setNow(Date.now());cb.current();return;}
      t=setTimeout(arm,Math.min(wait+1,2147483000));
    };
    arm();
    return ()=>clearTimeout(t);
  },[expiresAt]);
  const at=expiresAt?new Date(expiresAt).getTime():NaN;
  return {now,expired:!Number.isNaN(at)&&Math.max(now,Date.now())>=at};
}

export function CardStatusSummary({data,graceExpired}:{data:StudentCardReadiness;graceExpired:boolean}){
  const grant=data.grace?.grant;const exp=graceExpiry(data);
  const waived=data.restrictions.filter(r=>r.waived);const total=data.restrictions.length;
  const remaining=total-waived.length;
  let coverage='';
  if(!graceExpired&&waived.length&&remaining)coverage=`Grace waives ${waived.length} of ${total} restrictions. ${remaining} still apply and continue to block use.`;
  else if(!graceExpired&&waived.length)coverage=`Grace waives all ${total} listed restrictions for now. Payment is not marked paid.`;
  return <div className="space-y-2 rounded-lg border border-[hsl(var(--border))] p-3 text-sm" data-testid="card-effective-status">
    <p><span className="font-semibold">Effective status:</span> <span data-testid="text-effective-status">{graceExpired?'GRACE_EXPIRED_RECHECK_REQUIRED':data.effectiveStatus}</span> · <span className="font-semibold">Source:</span> <span data-testid="text-status-source">{graceExpired?'NORMAL_POLICY_RECHECK_REQUIRED':data.statusSource}</span> · <span className="font-semibold">Stage:</span> {data.stage}</p>
    {coverage&&<p data-testid="text-grace-coverage">{coverage}</p>}
    {grant&&<div data-testid="grace-grant">
      <p><span className="font-semibold">Grace ({graceExpired?'EXPIRED, rechecking':data.grace.state}):</span> {data.grace.state==='REVOKED'?'revoked':'granted'} by {actor(grant.actorUserId)} at {fmt(grant.createdAt)}</p>
      <p>Expires: <span data-testid="text-grace-expiry">{fmt(exp)}</span></p>
      <p>Covers: {coveredOf(grant).join(', ')||'none recorded'}</p>
      <p>Reason: {grant.reason}</p>
      <p className="text-xs">Grace does not mark payment as paid, clear a card lock, activate a staged card, or permit printing on its own.</p>
    </div>}
  </div>;
}

export function CardControlHistory({history}:{history:StudentCardControlEvent[]}){
  const rows=history.slice(0,30);
  return <details className="text-sm" data-testid="card-control-history">
    <summary className="cursor-pointer font-semibold">Recent control history ({rows.length} shown; full audit retained)</summary>
    {rows.length===0?<p className="mt-2">No lock or grace actions recorded for this card.</p>:
      <ol className="mt-2 space-y-2">{rows.map(e=><li key={e.id} className="border-l-2 border-[hsl(var(--border))] pl-2" data-testid={`history-event-${e.id}`}>
        <p className="font-semibold">{ACTION_TEXT[e.action]??e.action} · {actor(e.actorUserId)} · {fmt(e.createdAt)}</p>
        <p>Reason: {e.reason}</p>
        {graceExpiry({grace:{grant:e}} as StudentCardReadiness)&&<p>Expiry: {fmt(graceExpiry({grace:{grant:e}} as StudentCardReadiness))}</p>}
        {coveredOf(e).length>0&&<p>Restrictions: {coveredOf(e).join(', ')}</p>}
      </li>)}</ol>}
  </details>;
}

export function OwnerCardControls({data,cardId,schoolId,studentId,graceExpired,refreshing=false,onRefresh,onRefetch}:{
  data:StudentCardReadiness;cardId:number;schoolId:number;studentId:number;graceExpired:boolean;
  refreshing?:boolean;
  onRefresh:()=>Promise<void>;onRefetch:()=>void;
}){
  const control=useControlOwnerStudentCard();
  const [action,setAction]=useState<ControlAction|null>(null);
  const [version,setVersion]=useState(0);
  const [reason,setReason]=useState('');const [confirmed,setConfirmed]=useState(false);
  const [expiry,setExpiry]=useState('');const [selected,setSelected]=useState<string[]>([]);
  const [msg,setMsg]=useState('');const [conflict,setConflict]=useState('');
  const graceable=data.restrictions.filter(r=>r.overridable&&!r.waived&&GRACEABLE.includes(r.code));
  const available:ControlAction[]=[];
  if(data.canLock)available.push('LOCK');
  if(data.stage==='ADMINISTRATIVE_LOCK'&&data.canActivate)available.push('UNLOCK');
  if(data.canGrantGrace&&!graceExpired&&graceable.length)available.push('GRANT_GRACE');
  if(data.canRevokeGrace&&!graceExpired)available.push('REVOKE_GRACE');
  const staged=data.stage==='AWAITING_ACTIVATION';
  const outstanding=data.restrictions.filter(r=>!r.waived);
  const restrictionText=outstanding.map(r=>`${r.code}: ${r.message}`).join(' ');
  const safetyText=outstanding.filter(r=>!r.overridable).map(r=>`${r.code}: ${r.message}`).join(' ');
  const disabledReason=(a:ControlAction):string=>{
    if(available.includes(a))return refreshing?'Refreshing current eligibility; wait for the server response.':
      control.isPending?'A card action is being checked.':'';
    if(a==='LOCK')return staged
      ?'This card is already locked pending initial activation. Only an active card can receive an administrative lock.'
      :'Only an active card can receive an administrative lock. Existing card restrictions and locks are preserved.';
    if(a==='UNLOCK')return staged
      ?`Initial activation is required, not administrative Unlock.${restrictionText?` Activation blocked by ${restrictionText}`:' Use Activate linked card after reviewing eligibility.'}`
      :data.stage==='SECURITY_LOCK'?'Security/legacy locks cannot be unlocked here; use the original security resolution workflow.'
      :data.stage==='ADMINISTRATIVE_LOCK'?`Current eligibility must pass before Unlock. ${restrictionText||'Refresh readiness to review the current restriction.'}`
      :'There is no Owner administrative lock to remove.';
    if(a==='GRANT_GRACE')return staged
      ?'Non-overrideable initial activation requirement: grace cannot activate a staged card or substitute for its independently verified NFC payment. Grace is permitted only for an active card or an Owner administrative lock.'
      :graceExpired?'Grace has expired; wait for server eligibility to be rechecked.'
      :data.grace?.state==='ACTIVE'?'A grace grant is already active. Revoke it before considering a new grant.'
      :safetyText?`Grace cannot override ${safetyText}`
      :!graceable.length?'No confirmed eligible payment restriction is available for temporary grace.'
      :'The server does not permit grace for this card’s current state. Grace requires an eligible exact student/card assignment and current academic term.';
    return 'Grace has expired; wait for server eligibility to be rechecked.';
  };
  const shown:ControlAction[]=['LOCK','UNLOCK','GRANT_GRACE'];
  if(data.canRevokeGrace&&data.grace?.state==='ACTIVE')shown.push('REVOKE_GRACE');
  const open=(a:ControlAction)=>{control.reset();setAction(a);setVersion(data.version);setReason('');setConfirmed(false);setExpiry('');setSelected([]);setConflict('');};
  const trimmed=reason.trim();
  const expIso=expiry?new Date(expiry):null;
  const expValid=!!expIso&&!Number.isNaN(expIso.getTime())&&expIso.getTime()>Date.now();
  const stale=data.version!==version;
  const ready=!!action&&available.includes(action)&&confirmed&&trimmed.length>=3&&trimmed.length<=480&&!stale&&!control.isPending&&!refreshing&&
    (action!=='GRANT_GRACE'||(expValid&&selected.length>0));
  const submit=()=>{
    if(!action||!ready)return;
    control.mutate({cardId,data:{schoolId,studentId,version,confirm:true,reason:trimmed,action,
      ...(action==='GRANT_GRACE'?{expiresAt:expIso!.toISOString(),restrictions:selected as StudentCardControlInputRestrictionsItem[]}:{})}},{
      onSuccess:async()=>{setMsg(`${LABEL[action]} recorded. Readiness refreshed from the server.`);setAction(null);await onRefresh();},
      onError:async(err)=>{
        if((err as {status?:number}|null)?.status===409)setConflict('This card changed since you opened this dialog. Data was refreshed; close and reopen to act on the current version.');
        await onRefresh();onRefetch();
      },
    });
  };
  return <section className="min-w-0 space-y-3 rounded-lg border border-[hsl(var(--border))] p-3 [overflow-wrap:anywhere]" aria-label="Student card actions" data-testid="owner-card-controls">
    <h4 className="font-semibold">Actions</h4>
    <p className="text-sm">Platform Owner only. Disabled actions show the current policy reason.</p>
    {data.stage==='SECURITY_LOCK'&&<p className="text-sm" data-testid="text-security-lock">Security lock: this card cannot be unlocked here.</p>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{shown.map(a=>{
      const id=a.toLowerCase().replace('_','-');const why=disabledReason(a);
      return <div key={a} className="min-w-0 space-y-1" role="group" aria-label={LABEL[a]}
        aria-describedby={`card-${cardId}-${id}-reason`} data-testid={`action-card-${id}`}>
        <Button type="button" variant="outline" disabled={!available.includes(a)||control.isPending||refreshing}
          title={why||undefined} testId={`button-card-${id}`}
          onClick={()=>{if(available.includes(a))open(a);}}>{LABEL[a]}</Button>
        <p id={`card-${cardId}-${id}-reason`} className="text-sm" data-testid={`reason-card-${id}`}>
          {why||(a==='LOCK'?'Available: stop this exact UID with an audited administrative lock.':
            a==='UNLOCK'?'Available: remove only the Owner administrative lock; other restrictions still apply.':
            a==='GRANT_GRACE'?'Available: temporarily cover selected eligible payment restrictions for this exact card and current term. Payment remains unpaid.':
            'Active grace: revoke the temporary permission immediately; retain the grant and audit history.')}
        </p>
      </div>;
    })}</div>
    {msg&&<p role="status" data-testid="text-control-success">{msg}</p>}
    {action&&<Modal title={`Confirm: ${LABEL[action]}`} eyebrow={`Platform Owner · UID ${data.uid} · version ${version}`} onClose={()=>{if(!control.isPending)setAction(null);}}>
      <div className="space-y-4">
        {action==='GRANT_GRACE'&&<p className="text-sm">Grace temporarily waives only the restrictions you select. It does not mark payment paid, clear a lock, activate a staged card, or allow printing unless the server later reports the card printable.</p>}
        {action==='REVOKE_GRACE'&&<p className="text-sm">Revoking grace re-applies every waived restriction immediately.</p>}
        {action==='LOCK'&&<p className="text-sm">An administrative lock stops this UID from being used until an Owner unlocks it.</p>}
        {action==='UNLOCK'&&<p className="text-sm">Unlocking removes only the administrative lock. Other restrictions still apply.</p>}
        {action==='GRANT_GRACE'&&<>
          <fieldset className="space-y-1"><legend className="font-semibold">Restrictions to waive (required)</legend>
            {graceable.map(r=><label key={r.code} className="flex gap-2"><input type="checkbox" className="!w-auto" data-testid={`check-grace-${r.code}`}
              checked={selected.includes(r.code)} disabled={control.isPending}
              onChange={e=>setSelected(s=>e.target.checked?[...s,r.code]:s.filter(c=>c!==r.code))}/>{r.code} · {r.message}</label>)}
          </fieldset>
          <p className="text-xs">Expiry must be within the current academic term, whose date boundary uses Africa/Lagos.</p>
          <Field label={`Grace expires at (your browser local timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}; sent as UTC)`}>
            <input type="datetime-local" value={expiry} disabled={control.isPending} onChange={e=>setExpiry(e.target.value)} data-testid="input-grace-expiry"/>
          </Field>
          {expiry&&<p className="text-xs" data-testid="text-grace-expiry-utc">{expValid?`Will be sent as ${expIso!.toISOString()}`:'Choose a valid future time.'}</p>}
        </>}
        <Field label="Reason (required, 3 to 480 characters)">
          <textarea value={reason} maxLength={480} disabled={control.isPending} onChange={e=>setReason(e.target.value)} data-testid="input-card-control-reason"/>
        </Field>
        <label className="flex gap-2"><input type="checkbox" className="!w-auto" checked={confirmed} disabled={control.isPending} onChange={e=>setConfirmed(e.target.checked)} data-testid="confirm-card-control"/>I confirm this action for this exact UID and student.</label>
        {stale&&<p role="alert" data-testid="text-control-stale">Readiness changed since this dialog opened (version {version} to {data.version}). Close and reopen to review the current state.</p>}
        {conflict&&<p role="alert">{conflict}</p>}
        {control.isError&&!conflict&&<p role="alert">{backendError(control.error)}</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" disabled={control.isPending} onClick={()=>setAction(null)}>Cancel</Button>
          <Button type="button" disabled={!ready} testId="submit-card-control" onClick={submit}>{control.isPending?'Checking…':`Confirm ${LABEL[action].toLowerCase()}`}</Button>
        </div>
      </div>
    </Modal>}
  </section>;
}
