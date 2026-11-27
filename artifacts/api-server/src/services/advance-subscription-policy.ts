import {createHash} from "node:crypto";
export const ADVANCE_RELEASE="STUDENT_DIRECT_ADVANCE_3200_V1";
export const advanceDigest=(value:unknown):string=>createHash("sha256").update(JSON.stringify(value,(_k,v)=>
 v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest("hex");
export function advanceWindow(start:string,end:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<start
   ||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end)))throw Error("INVALID_ADVANCE_CALENDAR");
 // Lagos midnight after the final saved day. This is an exclusive expiry,
 // not an extension of a current-term seven-day review.
 return {notBefore:new Date(`${start}T00:00:00+01:00`).toISOString(),
   expiresAt:new Date(Date.parse(`${end}T00:00:00+01:00`)+86400000).toISOString()};
}
export function advanceCheckoutOpen(today:string,start:string,end:string,termCurrent:boolean,sessionCurrent:boolean,
 termStatus:string,sessionStatus:string){
 return today>=start&&today<=end&&termCurrent&&sessionCurrent&&termStatus==="ACTIVE"&&sessionStatus==="ACTIVE";
}
/** Only these lifecycle fields may change without a fresh material review. */
export function materialCalendar(row:Record<string,unknown>){
 const {is_current,status,updated_at,...material}=row;return material;
}
export function advanceEvidenceMatches(saved:{digest:string;materialVersion:string},fresh:{digest:string;materialVersion:string}){
 return saved.digest===fresh.digest&&saved.materialVersion===fresh.materialVersion;
}
