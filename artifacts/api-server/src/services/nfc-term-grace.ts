/** NFC only. Calendar rollover and ordinary school invoice due dates never use this. */
export const NFC_GRACE_DAYS=7;
export const lagosDate=(date:Date=new Date())=>new Intl.DateTimeFormat("en-CA",{
 timeZone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit",
}).format(date);
export function nfcTermWindow(start:string,end:string,today:string){
 const parse=(s:string)=>{
  const n=/^\d{4}-\d{2}-\d{2}$/.test(s)?Date.parse(`${s}T00:00:00Z`):NaN;
  return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===s?n:NaN;
 };
 const d=parse(start),e=parse(end),t=parse(today);
 if(![d,e,t].every(Number.isFinite)||e<d)throw Error("INVALID_NFC_TERM_CALENDAR");
 const enforcementDate=new Date(d+NFC_GRACE_DAYS*86400000).toISOString().slice(0,10);
 return {enforcementDate,inGracePeriod:t>=d&&t<=e&&today<enforcementDate,
  checkoutOpen:t>=d&&t<=e&&today>=enforcementDate};
}
