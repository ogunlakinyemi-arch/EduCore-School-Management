import {useState} from 'react';
import {useGetOwnerNotificationDeliveryControls,useUpdateOwnerNotificationDeliveryControls,getGetOwnerNotificationDeliveryControlsQueryKey} from '@workspace/api-client-react';
import type {OwnerDeliveryControls,OwnerDeliveryView} from '@workspace/api-client-react';

type Draft=Pick<OwnerDeliveryControls,'paused'|'smsEnabled'|'pushEnabled'|'telegramEnabled'|'pushParentIds'>;
const channelRows=[
  {key:'smsEnabled',config:'SMS',label:'SMS',note:'Emergency and student absence notices only. Recipient opt-in remains required.'},
  {key:'pushEnabled',config:'PUSH',label:'Push',note:'Limited to the explicitly selected eligible parent test recipients below.'},
  {key:'telegramEnabled',config:'TELEGRAM',label:'Telegram',note:'Only parents who linked Telegram and consented receive notices.'},
] as const;

const errorStatus=(e:unknown)=>typeof e==='object'&&e&&'status' in e?Number((e as {status:unknown}).status):0;
const fmt=(v:string|null)=>v?new Date(v).toLocaleString('en-NG'):'Never';

export function OwnerNotificationDeliveryControl(){
  const query=useGetOwnerNotificationDeliveryControls({query:{queryKey:getGetOwnerNotificationDeliveryControlsQueryKey()}});
  const save=useUpdateOwnerNotificationDeliveryControls();
  const [draft,setDraft]=useState<Draft|null>(null);
  const [reason,setReason]=useState('');
  const [notice,setNotice]=useState<{tone:'ok'|'error';text:string}|null>(null);
  const view:OwnerDeliveryView|undefined=query.data;
  const server=view?.controls;
  const current:Draft|undefined=draft??(server&&{paused:server.paused,smsEnabled:server.smsEnabled,pushEnabled:server.pushEnabled,telegramEnabled:server.telegramEnabled,pushParentIds:server.pushParentIds});
  const eligible=(view?.candidates??[]).filter(c=>c.eligible);
  const ineligible=(view?.candidates??[]).filter(c=>!c.eligible);
  const reasonOk=reason.trim().length>=5&&reason.trim().length<=500;
  const busy=save.isPending;
  const update=(patch:Partial<Draft>)=>{if(!current)return;setNotice(null);setDraft({...current,...patch});};
  const toggleParent=(id:number,on:boolean)=>current&&update({pushParentIds:on?[...new Set([...current.pushParentIds,id])].slice(0,20):current.pushParentIds.filter(p=>p!==id)});
  const submit=()=>{
    if(!current||!server||!draft||!reasonOk||busy)return;
    const allowed=new Set(eligible.map(c=>c.userId));
    save.mutate({data:{...current,pushParentIds:current.pushParentIds.filter(id=>allowed.has(id)),expectedVersion:server.version,reason:reason.trim()}},{
      onSuccess:async()=>{await query.refetch();setDraft(null);setReason('');
        setNotice({tone:'ok',text:'Delivery controls saved with your audit reason. No test message was sent.'});},
      onError:e=>{const s=errorStatus(e);setNotice({tone:'error',text:s===409?'Another Owner change was saved first (version conflict). Your draft is kept; reload the current controls, review, and save again.':
        s===403||s===404?'These controls are Owner-only and available in Development only.':s===400||s===422?'The server rejected this change. Check the reason (5–500 characters) and recipient selection.':
        'Change was not confirmed saved. Refresh to check the current state before retrying.'});},
    });
  };
  return <div className="space-y-4 rounded-xl border p-4" aria-label="Notification delivery controls" data-testid="owner-delivery-control">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="font-bold">Global notification delivery</h3>
        <p className="text-xs">Development only. Controls start disabled and paused. Pausing or resuming here affects notification delivery only — protected payment and worker pauses are unchanged. Resume delivers only fresh non-financial notices created after the change; nothing queued earlier is replayed. Existing recipient consent remains required. There are no paid tests or test-send buttons.</p></div>
      <button type="button" className="min-h-10 rounded-lg border px-3 text-sm" disabled={query.isFetching} onClick={()=>void query.refetch()}>{query.isFetching?'Refreshing…':'Refresh'}</button>
    </div>
    {query.isLoading?<div className="space-y-2" aria-busy="true"><div className="h-4 w-2/3 animate-pulse rounded bg-current opacity-10"/><div className="h-4 w-1/2 animate-pulse rounded bg-current opacity-10"/><div className="h-20 animate-pulse rounded bg-current opacity-10"/></div>
    :query.isError||!view||!current||!server?<p role="alert" className="text-sm">{[403,404].includes(errorStatus(query.error))?'Delivery controls are Owner-only and available in Development only.':'Could not load delivery controls.'} <button type="button" className="underline" onClick={()=>void query.refetch()}>Retry</button></p>
    :<>
      <div className="rounded-lg border p-3 text-sm">
        <p className="font-semibold">Notification delivery: {current.paused?'Paused':'Running'}{draft&&draft.paused!==server.paused&&' (unsaved)'}</p>
        <p className="text-xs">Saved version {server.version} · Last activated {fmt(server.activatedAt)}</p>
        <button type="button" disabled={busy} className="mt-2 min-h-10 rounded-lg border px-3" onClick={()=>update({paused:!current.paused})}>
          {current.paused?'Resume notification delivery':'Pause notification delivery'}</button>
      </div>
      <div className="grid gap-2 md:grid-cols-3">{channelRows.map(row=>{const on=current[row.key];const configured=view.configuration[row.config];
        return <div key={row.key} className="rounded-lg border p-3 text-sm" data-testid={`delivery-${row.config.toLowerCase()}`}>
          <label className="flex min-h-10 items-center gap-2 font-semibold"><input type="checkbox" checked={on} disabled={busy} aria-label={`${row.label} delivery enabled`} onChange={e=>update({[row.key]:e.target.checked} as Partial<Draft>)}/>{row.label}</label>
          <p className="text-xs">{on?'Enabled':'Disabled'}{server[row.key]!==on?' (unsaved)':''} · {configured?'Provider configured':'Provider not configured'}{on&&current.paused?' · held while paused':''}</p>
          <p className="mt-1 text-xs">{row.note}</p>
        </div>;})}</div>
      <fieldset className="rounded-lg border p-3 text-sm">
        <legend className="px-1 font-semibold">Push test recipients ({current.pushParentIds.length} selected, max 20)</legend>
        <p className="text-xs">Only eligible parent or teacher accounts reported by the server can be selected. No message is sent by selecting a recipient.</p>
        {eligible.length===0?<p role="status" className="mt-2 text-xs">No eligible push test recipients are currently available.</p>:
          <div className="mt-2 flex flex-wrap gap-3">{eligible.map(c=><label key={c.userId} className="inline-flex min-h-10 items-center gap-2">
            <input type="checkbox" disabled={busy||(!current.pushParentIds.includes(c.userId)&&current.pushParentIds.length>=20)} checked={current.pushParentIds.includes(c.userId)} onChange={e=>toggleParent(c.userId,e.target.checked)}/>
            Recipient #{c.userId} · School #{c.schoolId}</label>)}</div>}
        {current.pushParentIds.filter(id=>!eligible.some(c=>c.userId===id)).length>0&&<p className="mt-2 text-xs" role="status">Saved recipients no longer eligible will be removed on next save: {current.pushParentIds.filter(id=>!eligible.some(c=>c.userId===id)).map(id=>`#${id}`).join(', ')}</p>}
        {ineligible.length>0&&<details className="mt-2 text-xs"><summary>Ineligible candidates ({ineligible.length})</summary>
          <ul className="mt-1 space-y-1">{ineligible.map(c=><li key={c.userId}>Recipient #{c.userId} · School #{c.schoolId} — {c.reason}</li>)}</ul></details>}
      </fieldset>
      <div className="rounded-lg border p-3 text-xs" aria-label="Delivery diagnostics">
        <p className="font-semibold text-sm">Diagnostics (read-only, no secret values)</p>
        <p>Worker: {view.worker.running?'running':'stopped'} · last tick {fmt(view.worker.lastTickAt)}{view.worker.lastErrorCategory?` · last error category ${view.worker.lastErrorCategory}`:''}</p>
        <p>Protected workers paused: {view.protectedWorkersPaused?'yes':'no'} · Payment test notifications restricted: {view.paymentTestNotificationsRestricted?'yes':'no'}</p>
        {view.queue.length===0?<p>Queue is empty.</p>:<table className="mt-1 w-full text-left"><thead><tr><th>Channel</th><th>Status</th><th>Category</th><th>Count</th></tr></thead>
          <tbody>{view.queue.map((q,i)=><tr key={i}><td>{q.channel}</td><td>{q.status}</td><td>{q.category}</td><td>{q.count}</td></tr>)}</tbody></table>}
      </div>
      <label className="flex flex-col gap-1 text-sm">Audit reason for this change (required, 5–500 characters)
        <textarea className="rounded border p-2" rows={2} maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={!draft||!reasonOk||busy} onClick={submit}>{busy?'Saving…':'Save delivery controls'}</button>
        <button type="button" className="min-h-11 rounded-lg px-4 underline disabled:opacity-50" disabled={!draft||busy} onClick={()=>{setDraft(null);setNotice(null);}}>Discard draft</button>
      </div>
      {draft&&!reasonOk&&<p className="text-xs">Enter an audit reason to save.</p>}
    </>}
    {notice&&<p role={notice.tone==='error'?'alert':'status'} className="text-sm">{notice.text}</p>}
  </div>;
}
