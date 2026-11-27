import {useState} from "react";
import {
 useGetAdvanceSubscriptionReadiness,useListAdvanceSubscriptionAuthorizations,
 useCreateAdvanceSubscriptionAuthorization,useDecideAdvanceSubscriptionAuthorization,
 type AdvanceSubscriptionAuthorization,
} from "@workspace/api-client-react";
type Scope={schoolId:number;termId:number;ruleId:number};
const input="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-transparent p-2 text-sm font-normal";
const button="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm font-bold disabled:opacity-40";
const errorText=(e:unknown)=>e instanceof Error?e.message:"The request could not be confirmed. Refresh retained history before retrying.";
const wat=(s:string)=>new Date(s).toLocaleString("en-GB",{timeZone:"Africa/Lagos"})+" WAT";
export function AdvanceSubscriptionAuthorizationPanel({scope,actor}:{scope:Scope;actor:number}){
 const preview=useGetAdvanceSubscriptionReadiness(scope,{query:{
  queryKey:["advance-subscription-preview",actor,scope],staleTime:0,refetchOnWindowFocus:true,refetchInterval:60_000}});
 const list=useListAdvanceSubscriptionAuthorizations(scope,{query:{
  queryKey:["advance-subscription-history",actor,scope],staleTime:0,refetchOnWindowFocus:true,refetchInterval:60_000}});
 const create=useCreateAdvanceSubscriptionAuthorization({mutation:{retry:false}});
 const [reference,setReference]=useState(""),[hash,setHash]=useState(""),[reason,setReason]=useState("");
 const [confirmed,setConfirmed]=useState(false),[message,setMessage]=useState("");
 const [requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
 const refresh=async()=>{await Promise.all([preview.refetch(),list.refetch()]);};
 const p=preview.data;
 const submit=async()=>{
  if(!p)return;
  setMessage("");
  try{
   await create.mutateAsync({data:{...scope,previewDigest:p.digest,merchantEvidenceReference:reference.trim(),
    merchantEvidenceHash:hash.trim(),noSplitConfirmed:confirmed,reason:reason.trim(),requestKey}});
   setReference("");setHash("");setReason("");setConfirmed(false);
   setRequestKey(crypto.randomUUID());
   setMessage("Reviewed evidence saved. A separate explicit approval is still required.");
  }catch(e){setMessage(errorText(e));}finally{await refresh();}
 };
 return <section className="panel space-y-4 p-5" data-testid="advance-subscription-panel">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div><div className="eyebrow">Future-term authorization · Owner only</div>
    <h2 className="display-font text-lg font-bold">Prepare calendar-driven collection</h2></div>
   <button type="button" className={button} onClick={refresh} disabled={preview.isFetching||list.isFetching}>Refresh evidence and history</button>
  </div>
  <p className="text-sm">Authorize one reviewed school and term in advance. This does not enable LIVE, mark a term current,
   or charge anyone. Only normal authenticated checkout may start a payment after that school’s saved term opens.
   Student fee: ₦3,200. Eligible ₦150 BRO liability remains a separate expense after verified payment.</p>
  {preview.isLoading?<p>Loading future-term evidence…</p>:preview.isError||!p
   ?<p role="alert" className="text-sm text-rose-700">Advance evidence unavailable: {errorText(preview.error)}.
     Required candidate schema and operational setup must be verified separately.</p>
   :<>
    <dl className="grid gap-2 rounded-lg border border-[hsl(var(--border))] p-3 text-sm md:grid-cols-2">
     <div><dt className="font-bold">Saved calendar</dt><dd>{p.start} through {p.end} · Africa/Lagos</dd></div>
     <div><dt className="font-bold">Exclusive expiry</dt><dd>{wat(p.facts.expiresAt)}</dd></div>
     <div><dt className="font-bold">Term / session lifecycle</dt><dd>{p.calendarStatus} / {p.sessionStatus};
      current: {p.termCurrent?"yes":"no"} / {p.sessionCurrent?"yes":"no"}</dd></div>
     <div><dt className="font-bold">Independent LIVE release</dt><dd>{p.runtimeReleased?"Configured; not proof of provider readiness":"Not released; authorization never changes it"}</dd></div>
     <div><dt className="font-bold">Reviewed eligible students</dt><dd>{p.facts.eligibleStudentIds.join(", ")}</dd></div>
     <div><dt className="font-bold">Calendar / material revision</dt><dd>{p.facts.materialVersion}</dd></div>
     <div className="break-all"><dt className="font-bold">Reconciliation digest</dt><dd>{p.facts.reportDigest}</dd></div>
     <div className="break-all"><dt className="font-bold">Exact preview digest</dt><dd>{p.digest}</dd></div>
    </dl>
    <details className="rounded-lg border border-[hsl(var(--border))] p-3 text-sm">
     <summary className="cursor-pointer font-bold">Inspect exact bound calendar, rule, merchant and endpoints</summary>
     <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(p.facts,null,2)}</pre>
    </details>
    <form className="space-y-3" onSubmit={e=>{e.preventDefault();void submit();}}>
     <div className="grid gap-3 md:grid-cols-2">
      <label className="text-sm font-bold">Reviewed merchant evidence reference
       <input className={input} value={reference} onChange={e=>{setReference(e.target.value);setRequestKey(crypto.randomUUID());}} minLength={8} maxLength={300} required /></label>
      <label className="text-sm font-bold">Evidence SHA-256
       <input className={input} value={hash} onChange={e=>{setHash(e.target.value);setRequestKey(crypto.randomUUID());}} pattern="[a-f0-9]{64}" required /></label>
     </div>
     <label className="block text-sm font-bold">Reason for advance review or fresh re-review
      <textarea className={input} value={reason} onChange={e=>{setReason(e.target.value);setRequestKey(crypto.randomUUID());}} minLength={3} maxLength={500} required /></label>
     <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required />
      I reviewed this exact evidence, confirm no split/subaccount allocation, and understand that changed evidence requires a fresh review.</label>
     <button className={button} disabled={create.isPending||!p.approvalReady||!confirmed}>Save reviewed advance evidence</button>
    </form>
   </>}
  {message&&<p role="status" className="text-sm">{message}</p>}
  <h3 className="font-bold">Retained authorizations and audit history</h3>
  {list.isLoading?<p>Loading retained history…</p>:list.isError?<p role="alert">{errorText(list.error)}</p>
   :!list.data?.authorizations.length?<p className="text-sm">No advance authorization for this school, term and rule.</p>
   :list.data.authorizations.map(a=><AdvanceDecision key={a.id} value={a} refresh={refresh} />)}
 </section>;
}
function AdvanceDecision({value:a,refresh}:{value:AdvanceSubscriptionAuthorization;refresh:()=>Promise<void>}){
 const decide=useDecideAdvanceSubscriptionAuthorization({mutation:{retry:false}});
 const [reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState("");
 const act=async(action:"APPROVED"|"WITHDRAWN"|"REJECTED")=>{
  setMessage("");
  try{await decide.mutateAsync({id:a.id,data:{action,evidenceDigest:a.evidenceDigest,confirmScope:confirmed,reason:reason.trim()}});
   setReason("");setConfirmed(false);
  }catch(e){setMessage(errorText(e));}finally{await refresh();}
 };
 const active=["REVIEWED","APPROVED"].includes(a.status);
 return <article className="space-y-3 rounded-xl border border-[hsl(var(--border))] p-4" data-testid={`advance-authorization-${a.id}`}>
  <h4 className="font-bold">Authorization #{a.id} · {a.status}</h4>
  <p className="text-sm">Not before {wat(a.notBefore)} · Expires {wat(a.expiresAt)}. Expected PLANNED → ACTIVE
   and not-current → current transitions are allowed; all material changes require a fresh review.</p>
  <details className="text-sm"><summary className="cursor-pointer font-bold">Reviewed evidence and decision history</summary>
   <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(a,null,2)}</pre></details>
  {active&&<>
   <label className="block text-sm font-bold">Decision reason<input className={input} value={reason}
    onChange={e=>setReason(e.target.value)} minLength={3} maxLength={500} /></label>
   {a.status==="REVIEWED"&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />
    I explicitly authorize only the exact reviewed students, term, calendar and pricing evidence shown above.</label>}
   <div className="flex flex-wrap gap-2">
    {a.status==="REVIEWED"&&<>
     <button className={button} disabled={decide.isPending||!confirmed||reason.trim().length<3} onClick={()=>act("APPROVED")}>Approve advance authorization</button>
     <button className={button} disabled={decide.isPending||reason.trim().length<3} onClick={()=>act("REJECTED")}>Reject</button></>}
    <button className={button} disabled={decide.isPending||reason.trim().length<3} onClick={()=>act("WITHDRAWN")}>Withdraw authorization</button>
   </div>
  </>}
  {message&&<p role="alert" className="text-sm">{message}</p>}
 </article>;
}
