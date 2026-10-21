import {z} from "zod";
import type {OwnerAttendanceEvidence,OwnerAttendanceReport,OwnerAttendanceRow} from "@workspace/api-zod";

const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{
  const date=new Date(`${s}T00:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===s;
},"Invalid calendar date");
export const ownerAttendanceFilters=z.object({
  schoolId:z.coerce.number().int().positive(),type:z.enum(["STUDENT","TEACHER"]),
  classId:z.coerce.number().int().positive().optional(),from:day,to:day,
  page:z.coerce.number().int().min(1).max(100000).default(1),
  pageSize:z.coerce.number().int().min(1).max(100).default(50),
  format:z.enum(["JSON","CSV"]).default("JSON"),
}).strict().superRefine((q,ctx)=>{
  const days=(Date.parse(q.to)-Date.parse(q.from))/86400000;
  if(days<0||days>30)ctx.addIssue({code:"custom",message:"Select an ordered range of at most 31 days"});
  if(q.type==="STUDENT"&&!q.classId)ctx.addIssue({code:"custom",message:"Select a class"});
  if(q.type==="TEACHER"&&q.classId)ctx.addIssue({code:"custom",message:"Teacher reports do not accept a class"});
});
export type OwnerAttendanceFilters=z.infer<typeof ownerAttendanceFilters>;

// Match the established attendance reader's snapshot-first, event-instant scope.
const eventClass=`COALESCE(e.school_class_id,(SELECT a.school_class_id FROM student_class_assignments a
 WHERE a.school_id=e.school_id AND a.student_id=e.student_id AND a.created_at<=e.occurred_at
 AND (a.start_date IS NULL OR a.start_date<=e.event_date)
 AND (a.end_date IS NULL OR a.end_date>=e.event_date)
 ORDER BY a.created_at DESC,a.id DESC LIMIT 1))`;
export function ownerAttendanceSql(type:"STUDENT"|"TEACHER"){
  const student=type==="STUDENT";
  const roster=student?`
    SELECT p.id AS person_id,trim(concat_ws(' ',p.first_name,p.middle_name,p.last_name)) AS name,
      COALESCE(p.admission_no,'Not recorded') AS identifier,d.day::date AS date
    FROM students p CROSS JOIN days d WHERE p.school_id=$1 AND (
      EXISTS(SELECT 1 FROM student_class_assignments a WHERE a.school_id=$1 AND a.student_id=p.id
        AND a.school_class_id=$4 AND (upper(a.status)='ACTIVE' OR a.end_date IS NOT NULL)
        AND (a.start_date IS NULL OR a.start_date<=d.day::date) AND (a.end_date IS NULL OR a.end_date>=d.day::date)
        AND a.created_at<((d.day::date+1)::timestamp AT TIME ZONE 'Africa/Lagos'))
      OR EXISTS(SELECT 1 FROM attendance_events e WHERE e.school_id=$1 AND e.student_id=p.id
        AND e.event_date=d.day::date AND ${eventClass}=$4)
      OR (d.day::date=(now() AT TIME ZONE 'Africa/Lagos')::date
        AND NOT EXISTS(SELECT 1 FROM student_class_assignments a WHERE a.school_id=$1 AND a.student_id=p.id)
        AND p.class_name=(SELECT name FROM school_classes WHERE id=$4 AND school_id=$1))
    )` : `
    SELECT p.id AS person_id,trim(concat_ws(' ',p.first_name,p.middle_name,p.last_name)) AS name,
      COALESCE(p.employee_no,'Not recorded') AS identifier,d.day::date AS date
    FROM employees p CROSS JOIN days d WHERE p.school_id=$1 AND upper(p.employee_type)='TEACHER' AND $4::int IS NULL`;
  const person=student?"student_id":"employee_id";
  const discrepancy=student?"attendance_discrepancies":"employee_nfc_attendance_discrepancies";
  return `WITH days AS (SELECT generate_series($2::date::timestamp,$3::date::timestamp,INTERVAL '1 day') AS day),
    roster AS (${roster}),
    paged AS (SELECT *,count(*) OVER() AS total FROM roster
      ORDER BY date DESC,lower(name),person_id LIMIT $5 OFFSET $6)
    SELECT r.person_id AS "personId",r.name,r.identifier,r.date::text,r.total,
      COALESCE(ev.events,'[]'::jsonb) AS events
    FROM paged r LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('eventId',e.id,'eventType',e.event_type,
        'source',e.identification_method,'status',e.attendance_status,'result',e.result,
        'at',e.occurred_at,'discrepancies',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'kind',a.${student?"discrepancy_type":"kind"},'status',a.status)),'[]'::jsonb) FROM ${discrepancy} a
          WHERE a.school_id=$1 AND a.attendance_event_id=e.id))
        ORDER BY e.occurred_at NULLS LAST,e.id) AS events
      FROM attendance_events e WHERE e.school_id=$1 AND e.${person}=r.person_id AND e.event_date=r.date
        ${student?`AND ${eventClass}=$4`:"AND e.student_id IS NULL AND e.event_type IN ('SCHOOL_ENTRY','SCHOOL_EXIT')"}
    ) ev ON true ORDER BY r.date DESC,lower(r.name),r.person_id`;
}
type RawRow={personId:number;name:string;identifier:string;date:string;total:string|number;
  events:(OwnerAttendanceEvidence&{discrepancies?:{kind:string;status:string}[]})[]};
export function ownerAttendanceRow(raw:RawRow,type:"STUDENT"|"TEACHER"):OwnerAttendanceRow {
  const events=raw.events??[],accepted=events.filter(e=>e.result==="ACCEPTED");
  const gateEntries=accepted.filter(e=>e.eventType==="SCHOOL_ENTRY"&&e.source==="NFC");
  const gateExits=accepted.filter(e=>e.eventType==="SCHOOL_EXIT"&&e.source==="NFC");
  const classroom=type==="STUDENT"?accepted.filter(e=>e.eventType==="CLASSROOM_ENTRY"):[];
  const anomalies=events.flatMap(e=>[
    ...(e.discrepancies??[]).map(d=>`${d.kind} (${d.status}; event ${e.eventId})`),
    ...(e.result!=="ACCEPTED"?[`${e.eventType}: ${e.result}`]:[]),
    ...(!["NFC"].includes(e.source)&&["SCHOOL_ENTRY","SCHOOL_EXIT"].includes(e.eventType)
      ?[`Other gate source: ${e.source} (${e.status}; ${e.at??"time not recorded"})`]:[]),
  ]);
  const clean=(items:typeof events)=>items.map(({eventId,eventType,source,status,result,at})=>
    ({eventId,eventType,source,status:status??"Not recorded",result,at:at??null}));
  return {personId:raw.personId,name:raw.name||"Name not recorded",identifier:raw.identifier,date:raw.date,
    gateEntries:clean(gateEntries),gateExits:clean(gateExits),classroom:clean(classroom),anomalies,
    status:classroom.length?[...new Set(classroom.map(e=>e.status))].join(" / "):
      accepted.length?`${accepted[accepted.length-1].eventType}: ${accepted[accepted.length-1].status}`:"Not recorded"};
}
const evidenceText=(items:OwnerAttendanceEvidence[])=>items.length?items.map(e=>
  `${e.at?new Date(e.at).toLocaleString("en-GB",{timeZone:"Africa/Lagos",hour12:false}):"Not recorded"} | ${e.status} | ${e.source}`).join("; "):"Not recorded";
export function ownerAttendanceCsv(report:OwnerAttendanceReport,cell:(value:unknown)=>string){
  const headers=["Row type","School","From","To","Type","Class","Export timestamp","Timezone","Date","Name","Identifier",
    "Entry Tag-in","Exit Tag-out","Classroom status/source/time","Time in (first NFC entry)","Time out (last NFC exit)","Status","Anomalies"];
  const common=[report.school.name,report.from,report.to,report.type,report.class?.name??"Not applicable",report.generatedAt,report.timeZone];
  const rows:unknown[][]=[headers,["EXPORT_METADATA",...common,...Array(10).fill("")]];
  for(const r of report.rows)rows.push(["ATTENDANCE",...common,r.date,r.name,r.identifier,
    evidenceText(r.gateEntries),evidenceText(r.gateExits),
    report.type==="STUDENT"?evidenceText(r.classroom):"Not applicable (gate only)",
    evidenceText(r.gateEntries.filter(e=>e.at).slice(0,1)),evidenceText(r.gateExits.filter(e=>e.at).slice(-1)),r.status,r.anomalies.join("; ")||"None recorded"]);
  return "\uFEFF"+rows.map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n";
}
