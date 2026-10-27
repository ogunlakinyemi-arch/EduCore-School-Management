import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { useGetMyStudentPlatformAccess,getGetMyStudentPlatformAccessQueryKey } from '@workspace/api-client-react';

export function isStudentCorePage(path:string){
  const p=path.split('?')[0];
  return p==='/' || p==='/dashboard' ||
    /^\/(?:my-academics|results|timetable|library|reporting|attendance|academic-work|curriculum)(?:\/|$)/.test(p);
}
export function StudentSubscriptionInstructions(){
  return <div className="space-y-3 text-sm">
    <p>Ask your School Administrator to review your subscription for the applicable academic term. The school must make its separate platform payment, or request Owner assistance after funds received in Yetenia’s business account have been independently checked.</p>
    <p>The intended new-rule fee is ₦3,200 per student per term. Existing amounts and unpaid obligations are unchanged; reconciliation and explicit rule approval are required before a new checkout or conversion.</p>
    <p>Your school sets the separate parent-facing NFC fee, which must be paid in full without installments. A school cash entry, uploaded receipt, transfer claim, or pending/failed payment does not verify the school’s platform payment.</p>
    <p>Only independently verified platform payment for your student record and term can restore core access. Card registration, school locks, device and other security checks still apply; payment does not automatically activate a card.</p>
  </div>;
}
export function StudentSubscriptionGuard({active,actorId,path,children}:{
  active:boolean;actorId?:number;path:string;children:ReactNode;
}){
  const query=useGetMyStudentPlatformAccess({query:{
    queryKey:[...getGetMyStudentPlatformAccessQueryKey(),actorId],enabled:active&&!!actorId,
    staleTime:0,refetchOnMount:'always',refetchOnWindowFocus:true,refetchInterval:15000,retry:false,
  }});
  if(!active)return <>{children}</>;
  const blocked=query.isError || !query.data || query.data.restricted;
  return <>
    {(blocked || path==='/student-subscription') && <section className="panel mb-5 space-y-3 p-5" role="status" data-testid="student-subscription-notice">
      <h2 className="font-bold">{query.isLoading?'Checking current-term subscription':blocked?'Student core access restricted':'Current-term platform payment verified'}</h2>
      {blocked && <p className="text-sm">{query.isError?'Subscription status could not be verified. Please retry.':'Core academics, results, attendance, reporting and library access require a verified platform subscription for your current academic term.'} Sign-in, account, subscription/payment status, payment instructions, inbox, welfare, transport and support remain available.</p>}
      {query.data?.students.map(s=><p className="text-sm" key={`${s.schoolId}-${s.studentId}`}>Student #{s.studentId} · School #{s.schoolId} · Term {s.termId??'unavailable'} · {s.status.replaceAll('_',' ')}</p>)}
      <div className="flex flex-wrap gap-4 text-sm font-semibold">
        <Link href="/student-subscription">Subscription status &amp; instructions</Link>
        <Link href="/my-fees">School fees &amp; evidence</Link>
        <Link href="/inbox">School support</Link>
        <button type="button" onClick={()=>void query.refetch()}>Refresh status</button>
      </div>
    </section>}
    {blocked && isStudentCorePage(path)
      ? <div className="panel p-5" data-testid="student-core-restricted"><StudentSubscriptionInstructions/></div>
      : children}
  </>;
}
export function StudentSubscriptionStatusPage(){
  return <section className="panel space-y-4 p-5"><h1 className="display-font text-2xl font-bold">My platform subscription</h1><StudentSubscriptionInstructions/></section>;
}
