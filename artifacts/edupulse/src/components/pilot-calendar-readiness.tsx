import {useGetPilotReadiness,getGetPilotReadinessQueryKey} from "@workspace/api-client-react";
export function PilotCalendarReadiness({actorId}:{actorId:number}){
  const review=useGetPilotReadiness({query:{
    queryKey:[...getGetPilotReadinessQueryKey(),actorId],retry:false,staleTime:0,
    refetchOnMount:"always",refetchOnWindowFocus:true,
  }});
  return <section className="panel p-5" data-testid="pilot-calendar-readiness">
    <h2 className="text-lg font-bold">Pilot school calendars</h2>
    <p className="mt-2 text-sm">Read-only current-school calendar checks, not permission to publish or activate payments.
      Serving Production target, current recovery evidence, schema/rollback review and authenticated acceptance remain separate prerequisites.
      Active records below are not a confirmed pilot-school list.</p>
    <button className="my-3 text-sm font-bold underline" onClick={()=>review.refetch()} disabled={review.isFetching}>Refresh calendar checks</button>
    {review.isLoading?<p role="status">Checking saved school calendars…</p>
      :review.isError?<p role="alert">Readiness review unavailable. No school dates or settings have been changed.</p>
      :review.data&&<div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="sr-only">School calendar readiness; no dates are invented</caption>
        <thead><tr>{["School","Current calendar","January second term","Required review"].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead>
        <tbody>{review.data.calendars.map(s=><tr key={s.schoolId} className="border-t">
          <td className="p-2">{s.schoolName}</td><td className="p-2">{s.currentCalendar}</td>
          <td className="p-2">{s.januaryCollectionStart??"School Admin review required"}</td>
          <td className="p-2">{s.checklist.join(" ")}</td>
        </tr>)}</tbody>
      </table><p className="mt-2 text-xs">Checked {review.data.checkedAt}. Production change authorization: blocked.</p></div>}
  </section>;
}
