import {useState} from 'react';
import {useGetNotificationChannelPolicy,useUpdateNotificationChannelPolicy} from '@workspace/api-client-react';
import type {NotificationChannelPolicy} from '@workspace/api-client-react';
const channels=['IN_APP','SMS','EMAIL','PUSH','TELEGRAM'] as const;
export function OwnerNotificationPolicyControl(){
  const query=useGetNotificationChannelPolicy();
  const save=useUpdateNotificationChannelPolicy();
  const [draft,setDraft]=useState<NotificationChannelPolicy|null>(null);
  const [school,setSchool]=useState('');
  const [notice,setNotice]=useState('');
  const policy=draft??query.data?.policy;
  const availability=query.data?.availability??{};
  const change=(event:string,channel:typeof channels[number],kind:'allowed'|'defaults',checked:boolean)=>{
    if(!policy)return;
    const rule=policy.events[event];
    const next={...rule,[kind]:checked?[...new Set([...rule[kind],channel])]:rule[kind].filter(c=>c!==channel)};
    if(kind==='allowed'&&!checked)next.defaults=next.defaults.filter(c=>c!==channel);
    setDraft({...policy,events:{...policy.events,[event]:next}});
  };
  return <section className="panel mb-6 space-y-4 p-5" aria-label="Platform notification policy">
    <h2 className="display-font text-xl font-bold">Owner notification controls</h2>
    <p className="text-sm">Only you can permit SMS categories and set school permissions. SMS starts restricted to attendance and emergencies. Allowing another category is an explicit global policy change, not permission to send a test message.</p>
    {query.isLoading?<p>Loading policy…</p>:query.isError?<p role="alert">Could not load policy. <button onClick={()=>void query.refetch()}>Retry</button></p>:policy&&<>
      <p className="text-xs">Each channel has “Allowed” and “Default” controls. Unavailable delivery channels cannot be defaults; Telegram has no configured adapter. Permission alone never activates delivery.</p>
      <div className="space-y-3">{Object.entries(policy.events).map(([event,rule])=><fieldset key={event} className="rounded-xl border p-3">
        <legend className="px-1 text-sm font-bold">{event.replaceAll('_',' ')}</legend>
        <div className="flex flex-wrap gap-4">{channels.map(channel=><div key={channel} className="text-xs">
          <div className="font-semibold">{channel.replace('_',' ')}{!availability[channel]&&' — delivery unavailable'}</div>
          <label className="mr-3 inline-flex min-h-10 items-center gap-1"><input type="checkbox" aria-label={`${event} ${channel} allowed`}
            disabled={save.isPending||channel==='TELEGRAM'} checked={rule.allowed.includes(channel)}
            onChange={e=>change(event,channel,'allowed',e.target.checked)}/>Allowed</label>
          <label className="inline-flex min-h-10 items-center gap-1"><input type="checkbox" aria-label={`${event} ${channel} default`}
            disabled={save.isPending||!availability[channel]||!rule.allowed.includes(channel)} checked={rule.defaults.includes(channel)}
            onChange={e=>change(event,channel,'defaults',e.target.checked)}/>Default</label>
        </div>)}</div>
      </fieldset>)}</div>
      <h3 className="font-bold">School-level permissions</h3>
      <p className="text-xs">Schools without an override inherit global rules. Overrides can only restrict global channels, never expand them.</p>
      <label className="flex flex-wrap items-center gap-2 text-sm">School ID<input aria-label="School permission ID" type="number" min="1" className="rounded border p-2" value={school} onChange={e=>setSchool(e.target.value)}/>
        <button type="button" className="rounded border px-3 py-2" disabled={!Number.isSafeInteger(Number(school))||Number(school)<1||save.isPending}
          onClick={()=>{setDraft({...policy,schools:{...policy.schools,[String(Number(school))]:{enabled:true,allowed:[...channels]}}});setSchool('');}}>Add override</button></label>
      {Object.entries(policy.schools).map(([id,permission])=><fieldset key={id} className="rounded border p-3">
        <legend>School {id}</legend>
        <label className="mr-4 inline-flex min-h-10 items-center gap-2"><input type="checkbox" checked={permission.enabled} disabled={save.isPending}
          onChange={e=>setDraft({...policy,schools:{...policy.schools,[id]:{...permission,enabled:e.target.checked}}})}/>Notifications permitted</label>
        {channels.map(channel=><label key={channel} className="mr-3 inline-flex min-h-10 items-center gap-1"><input type="checkbox" disabled={save.isPending||channel==='TELEGRAM'} checked={permission.allowed.includes(channel)}
          onChange={e=>setDraft({...policy,schools:{...policy.schools,[id]:{...permission,allowed:e.target.checked?[...permission.allowed,channel]:permission.allowed.filter(c=>c!==channel)}}})}/>{channel}</label>)}
        <button type="button" disabled={save.isPending} onClick={()=>{const schools={...policy.schools};delete schools[id];setDraft({...policy,schools});}} className="ml-3 underline">Use global permissions</button>
      </fieldset>)}
      <button type="button" disabled={!draft||save.isPending} className="min-h-11 rounded-lg border px-4 disabled:opacity-50"
        onClick={()=>draft&&void save.mutateAsync({data:draft}).then(async()=>{await query.refetch();setDraft(null);setNotice('Owner policy saved and audited. No messages sent.');}).catch(()=>setNotice('Policy was not confirmed saved. Reload to check before retrying.'))}>Save Owner policy</button>
    </>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
