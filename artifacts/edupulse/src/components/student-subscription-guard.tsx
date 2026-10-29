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
    <p>Your school sets the fees shown in My fees. View your school-issued invoices for the applicable academic term and ask your parent or guardian to contact the school about payment questions.</p>
    <p>If access is restricted, contact your School Administrator for help. Fee information does not change card registration or school security requirements.</p>
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
      <h2 className="font-bold">{query.isLoading?'Checking current-term access':blocked?'Student core access restricted':'Current-term access available'}</h2>
      {blocked && <p className="text-sm">{query.isError?'Access status could not be verified. Please retry.':'Some learning features are currently unavailable. Contact your School Administrator for help.'} Your account, school fees, inbox, welfare, transport and support remain available.</p>}
      <div className="flex flex-wrap gap-4 text-sm font-semibold">
        <Link href="/student-subscription">Access status &amp; school fee information</Link>
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
  return <section className="panel space-y-4 p-5"><h1 className="display-font text-2xl font-bold">My school fees &amp; access</h1><StudentSubscriptionInstructions/><Link href="/my-fees" className="font-semibold underline">View school-issued fees</Link></section>;
}
