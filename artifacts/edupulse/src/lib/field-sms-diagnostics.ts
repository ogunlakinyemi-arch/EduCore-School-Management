const guidance:Record<string,[string,string]>={
  CURRENT_FINANCIAL_SCHEMA_NOT_APPLIED:['Required finance/SMS storage is not applied.','Review approved migration delivery with the release operator; do not enable sending or run a migration from here.'],
  CURRENT_LIFECYCLE_MIGRATION_NOT_APPLIED:['The current finance lifecycle is not applied.','Review the approved lifecycle migration and its independent verification.'],
  EXISTING_FINANCIAL_GUARDS_REQUIRED:['Existing financial protections are missing or unverified.','Verify the required financial history guard definitions; do not bypass them to enable SMS.'],
  CURRENT_HISTORY_GUARDS_REQUIRED:['Financial history protection is missing or unverified.','Restore and verify the approved history guards before using Field SMS.'],
  CURRENT_EXTENSIONS_MIGRATION_AND_HISTORY_GUARDS_REQUIRED:['Field SMS extensions or their history guards are missing.','Review the approved extension migration and verify all history guards; a flag change cannot fix this.'],
  CURRENT_AGGREGATE_SCOPE_GUARDS_REQUIRED:['Aggregate school/term protection is missing or unverified.','Verify the approved scope guards before releasing the connected workflow.'],
  SMS_DELIVERY_PAUSED_BY_OWNER:['SMS delivery is paused by the Owner.','Review notification delivery controls. Resuming requires separate explicit authorization.'],
  SMS_NOT_AUTHORIZED_BY_OWNER:['The Owner has not enabled SMS delivery.','Review notification delivery controls; viewing this page does not grant send permission.'],
  SMS_ACTIVATION_REVIEW_REQUIRED:['SMS activation evidence has not been recorded.','Complete the existing Owner review without enabling delivery implicitly.'],
  SMS_TRANSPORT_PAUSED_OR_NOT_ENABLED:['The SMS transport is held by runtime or Owner controls.','Review notification delivery controls and the serving runtime; do not assume a missing flag.'],
  SMS_PROVIDER_NOT_CONFIGURED:['The configured SMS provider is unavailable.','Have the release operator review the existing SMS configuration securely. No provider check or message was sent.'],
  CONTACT_PERMISSION_REQUIRED:['This contact has not given the required permission.','Record legitimate contact permission; selecting a contact never grants permission.'],
  SMS_SCOPE_OR_CONSENT_REQUIRED:['Contact permission or SMS scope is not valid.','Review contact eligibility and current permission before preparing a new preview.'],
};
export function fieldSmsDiagnostic(error:unknown){
  const e=error as {status?:number;data?:{error?:unknown;code?:unknown}}|null;
  const raw=typeof error==='string'?error:e?.data?.code??e?.data?.error;
  const code=typeof raw==='string'&&/^[A-Z][A-Z0-9_]{4,150}$/.test(raw)?raw:null;
  const known=code?guidance[code]:null;
  if(known)return {code,title:known[0],next:known[1]};
  if(e?.status===401)return {code:'SESSION_REQUIRED',title:'Your session needs attention.',next:'Sign in again, then refresh Field SMS.'};
  if(e?.status===403||code&&/ACCESS_DENIED|NOT_AUTHORIZED|OWNER_REQUIRED/.test(code))
    return {code:code??'OWNER_PERMISSION_REQUIRED',title:'This operation requires current Platform Owner permission.',next:'Refresh your session and confirm the active role; school or BRO access does not grant campaign authority.'};
  if([404,410,501].includes(e?.status??0))return {code:'FIELD_SMS_ROUTE_UNAVAILABLE',title:'The Field SMS route is unavailable in the serving API.',next:'Confirm the serving release and API route with the release operator. This does not establish a missing flag.'};
  return {code:code??'FIELD_SMS_READINESS_UNKNOWN',title:'Field SMS readiness could not be confirmed.',next:'Refresh once, then review the sanitized serving-runtime diagnostics. No message can be sent from this unavailable view.'};
}
