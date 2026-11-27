import {createHash} from "node:crypto";
export type CalendarPeriod={id:number;schoolId:number;name:string;startDate:string;endDate:string;
 status:string;isCurrent:boolean;updatedAt?:string};
export type CalendarTerm=CalendarPeriod&{sessionId:number};
export type CalendarChange={kind:"TERM"|"SESSION";id:number;from:{status:string;isCurrent:boolean};
 to:{status:string;isCurrent:boolean}};
export const calendarDigest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value,(_key,v)=>
 v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest("hex");
export const calendarLagosDay=(now:Date)=>new Intl.DateTimeFormat("en-CA",{
 timeZone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
export function academicTermOrdinal(name:unknown):number|null{
 if(typeof name!=="string")return null;
 const n=name.toLowerCase().replace(/[\s_-]/g,"");
 for(const [i,words] of [[1,["firstterm","firstacademicterm","term1","1stterm","first","1"]],
  [2,["secondterm","secondacademicterm","term2","2ndterm","second","2"]],
  [3,["thirdterm","thirdacademicterm","term3","3rdterm","third","3"]]] as const)
  if((words as readonly string[]).includes(n))return i;
 return null;
}
export const validCalendarDay=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)
 &&Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day;
const goodDates=(p:CalendarPeriod)=>validCalendarDay(p.startDate)&&validCalendarDay(p.endDate)&&p.startDate<=p.endDate;
const overlaps=(a:CalendarPeriod,b:CalendarPeriod)=>a.startDate<=b.endDate&&b.startDate<=a.endDate;
/** No wall-clock override, writes, billing or promotion. The executor obtains
 * today from PostgreSQL after acquiring the school's calendar lock. */
export function planAcademicCalendarRollover(schoolId:number,today:string,sessions:CalendarPeriod[],terms:CalendarTerm[]){
 if(!Number.isSafeInteger(schoolId)||schoolId<1||!validCalendarDay(today))throw Error("INVALID_ROLLOVER_SCOPE_OR_DAY");
 const errors:string[]=[];
 const ss=[...sessions].sort((a,b)=>a.id-b.id),ts=[...terms].sort((a,b)=>a.id-b.id);
 if([...ss,...ts].some(p=>p.schoolId!==schoolId))errors.push("CALENDAR_TENANT_MISMATCH");
 if(new Set(ss.map(p=>p.id)).size!==ss.length||new Set(ts.map(p=>p.id)).size!==ts.length)errors.push("DUPLICATE_CALENDAR_IDENTITIES");
 const localSessions=ss.filter(p=>p.schoolId===schoolId),localTerms=ts.filter(p=>p.schoolId===schoolId);
 for(const p of [...localSessions,...localTerms]){
  if(!goodDates(p))errors.push(`INVALID_DATES:${p.id}`);
  if(typeof p.name!=="string"||!p.name.trim()||p.name.trim().length>120)errors.push(`INVALID_PERIOD_NAME:${p.id}`);
  if(!["PLANNED","ACTIVE","INACTIVE"].includes(p.status))errors.push(`UNKNOWN_CALENDAR_STATUS:${p.id}`);
 }
 for(const a of localSessions)for(const b of localSessions)
  if(a.id<b.id&&goodDates(a)&&goodDates(b)&&overlaps(a,b))errors.push(`OVERLAPPING_SESSIONS:${a.id}:${b.id}`);
 for(const t of localTerms){
  const s=localSessions.find(p=>p.id===t.sessionId);
  if(!s||t.startDate<s.startDate||t.endDate>s.endDate)errors.push(`TERM_OUTSIDE_SAVED_SESSION:${t.id}`);
 }
 for(const a of localTerms)for(const b of localTerms)
  if(a.id<b.id&&goodDates(a)&&goodDates(b)&&overlaps(a,b))errors.push(`OVERLAPPING_TERMS:${a.id}:${b.id}`);
 const dueSessions=localSessions.filter(s=>goodDates(s)&&s.startDate<=today&&today<=s.endDate);
 if(dueSessions.length>1)errors.push("AMBIGUOUS_DUE_SESSION");
 let session=dueSessions.length===1?dueSessions[0]:null;
 if(session){
  if(session.status==="INACTIVE")errors.push("DUE_SESSION_EXPLICITLY_INACTIVE");
  const children=localTerms.filter(t=>t.sessionId===session!.id);
  if(children.length!==3||new Set(children.map(t=>academicTermOrdinal(t.name))).size!==3
    ||children.some(t=>academicTermOrdinal(t.name)===null))errors.push("DUE_SESSION_REQUIRES_FIRST_SECOND_THIRD_TERM");
  const ordered=[...children].sort((a,b)=>(academicTermOrdinal(a.name)??0)-(academicTermOrdinal(b.name)??0));
  if(ordered.some((t,i)=>i>0&&ordered[i-1].endDate>=t.startDate))errors.push("TERM_NUMBER_DATE_ORDER_INVALID");
 }
 const dueTerms=session?localTerms.filter(t=>t.sessionId===session!.id&&goodDates(t)&&t.startDate<=today&&today<=t.endDate):[];
 if(dueTerms.length>1)errors.push("AMBIGUOUS_DUE_TERM");
 let term=dueTerms.length===1?dueTerms[0]:null;
 if(term?.status==="INACTIVE")errors.push("DUE_TERM_EXPLICITLY_INACTIVE");
 if(errors.length){session=null;term=null;}
 const changes:CalendarChange[]=[];
 for(const [kind,periods,target] of [["TERM",localTerms,term],["SESSION",localSessions,session]] as const){
  for(const p of periods){
   const expired=goodDates(p)&&p.endDate<today;
   // Existing calendars may configure future periods as ACTIVE. Their
   // operational state requires isCurrent AND dates; do not turn that legacy
   // configuration into a backwards lifecycle revision of an advance review.
   const to={status:target?.id===p.id?"ACTIVE":expired&&["PLANNED","ACTIVE"].includes(p.status)?"INACTIVE":p.status,
    isCurrent:target?.id===p.id};
   if(to.status!==p.status||to.isCurrent!==p.isCurrent)changes.push({kind,id:p.id,from:{status:p.status,isCurrent:p.isCurrent},to});
  }
 }
 // Normalize already converged state out of the material fingerprint; retain
 // full source state separately for a unique audit of actual repairs.
 const material=(p:CalendarPeriod)=>{const {status,isCurrent,updatedAt,...rest}=p;return rest;};
 return {schoolId,today,status:errors.length?"BLOCKED":"READY",errors:[...new Set(errors)].sort(),
  sessionId:session?.id??null,termId:term?.id??null,changes,
  calendarDigest:calendarDigest({sessions:ss.map(material),terms:ts.map(material)}),
  sourceDigest:calendarDigest({sessions:ss,terms:ts})};
}
