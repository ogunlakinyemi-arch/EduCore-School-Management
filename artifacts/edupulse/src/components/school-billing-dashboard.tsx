import { useRef, useState, type ReactNode } from 'react';
import { useGetAuthorizedContext, useGetSchoolBillingContext, initializeLiveSchoolSubscription, type SchoolBillingContext } from '@workspace/api-client-react';
import { useSchoolAdminAccess, useTenant } from './shared';

const safeCheckout = (value: string | null): value is string => {
  if (!value) return false;
  try {
    const u=new URL(value);
    return u.protocol==='https:'&&u.hostname==='checkout.flutterwave.com'&&!u.username&&!u.password&&!u.port
      &&/^\/v3\/hosted\/pay\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)&&!u.search&&!u.hash;
  } catch { return false; }
};

/** Legacy children are not mounted unless the SERVER explicitly selects TEST.
 * Owner's existing read-only historical view stays separate from payment issuance. */
export function SchoolBillingDashboard({legacy}:{legacy:ReactNode}) {
  const {schoolId}=useTenant();
  const {isPlatformOwner}=useSchoolAdminAccess();
  const actorId=useGetAuthorizedContext().data?.user?.id;
  const query=useGetSchoolBillingContext({schoolId:schoolId??0},{query:{
    enabled:!!schoolId&&!!actorId&&!isPlatformOwner,
    queryKey:['school-billing-context',schoolId,actorId],
    refetchOnMount:'always',refetchInterval:10_000,
  }});
  if(isPlatformOwner)return <>{legacy}</>;
  if(!schoolId)return <p>Select a school to view billing.</p>;
  // Never use cached data after a failed refresh or across schools.
  if(query.isError)return <section role="alert">Billing context unavailable. No payment can be started.
    <button onClick={()=>void query.refetch()}>Refresh billing</button></section>;
  if(query.isLoading||!query.data||query.data.schoolId!==schoolId||query.data.actorId!==actorId)return <p>Loading server billing context…</p>;
  if(query.data.mode==='TEST')return <>{legacy}</>;
  if(query.data.mode!=='LIVE')return <p role="status">LIVE billing unavailable: {query.data.reason}. No TEST fallback is used.</p>;
  return <LiveSchoolBilling key={`${query.data.actorId}:${schoolId}:${query.data.termId}`} context={query.data}
    refresh={()=>void query.refetch()}/>;
}

export function LiveSchoolBilling({context,refresh}:{context:SchoolBillingContext;refresh:()=>void}) {
  const inFlight=useRef(new Set<number>());
  const [busy,setBusy]=useState<number|null>(null);
  const [message,setMessage]=useState('');
  const storageKey=(studentId:number)=>`educore:live-billing:${context.actorId}:${context.schoolId}:${context.termId}:${studentId}`;
  const [uncertain,setUncertain]=useState(()=>new Set(context.students.filter(s=>{
    try{return !!sessionStorage.getItem(storageKey(s.studentId));}catch{return true;}
  }).map(s=>s.studentId)));
  const start=async(studentId:number)=>{
    const student=context.students.find(s=>s.studentId===studentId);
    if(!context.termId||!student?.checkoutAllowed||uncertain.has(studentId)||inFlight.current.has(studentId))return;
    inFlight.current.add(studentId);setBusy(studentId);
    try {
      // Persist BEFORE the POST. Reloads cannot silently send a different key
      // after a lost response. Recovery reads the frozen server intent, not this marker.
      const idempotencyKey=crypto.randomUUID();
      sessionStorage.setItem(storageKey(studentId),idempotencyKey);
      setUncertain(previous=>new Set([...previous,studentId]));
      await initializeLiveSchoolSubscription({schoolId:context.schoolId,studentId,
        termId:context.termId,idempotencyKey});
      setMessage('Checkout saved. Refreshing its server-owned reference and status.');
      // Do not navigate from a POST response: only scoped context recovery may
      // offer the persisted URL, including after an uncertain response.
    }catch{
      setMessage('Checkout outcome is uncertain or unavailable. Refresh server status; do not submit another checkout.');
    }finally{inFlight.current.delete(studentId);setBusy(null);refresh();}
  };
  return <section className="space-y-4" aria-label="LIVE school billing">
    <h1 className="text-2xl font-bold">Student subscriptions · LIVE</h1>
    <p>{context.termName??'No unambiguous current term'} · NGN 5,000 per student</p>
    <p>Only independently verified server records confirm payment. A browser return or retained reference does not.
      Finalization requires an authenticated webhook and reviewed allocation evidence.</p>
    {context.reason!=='LIVE_CONTEXT'&&<p role="status">{context.reason}. New checkout is disabled.</p>}
    {message&&<p role="status">{message}</p>}
    <button type="button" onClick={refresh}>Refresh server status</button>
    {context.students.map(student=><article key={student.studentId} className="rounded-xl border p-4 space-y-2">
      <h2 className="font-semibold">{student.studentName}</h2>
      <p data-testid={`live-status-${student.studentId}`}>{student.status}</p>
      {student.reference&&<p className="break-all font-mono text-sm">{student.reference}</p>}
      {safeCheckout(student.checkoutUrl)&&student.status==='READY'&&
        <a href={student.checkoutUrl} target="_blank" rel="noreferrer">Continue secure LIVE checkout</a>}
      {student.checkoutAllowed&&context.termId&&<button type="button"
        disabled={busy!==null||uncertain.has(student.studentId)}
        onClick={()=>void start(student.studentId)}>Start LIVE checkout</button>}
      {uncertain.has(student.studentId)&&!student.reference&&<p>Awaiting server confirmation. No new checkout will be sent.
        If no reference appears, administrator reconciliation is required.</p>}
      {student.status==='HELD'&&<p>Payment is held for review. No new charge or paid status is authorized.</p>}
      {student.status==='RECONCILIATION_REQUIRED'&&<p>Reconciliation is required. Do not start another checkout.</p>}
    </article>)}
  </section>;
}
