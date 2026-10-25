export const BANK_DIRECTORY_VERSION = "provider-record-isolation-v2";
/** Schema/counts only. Never copy provider messages, credentials, names, codes,
 * account data or raw payloads into diagnostics. */
export function bankDirectoryDiagnostic(httpStatus:number|null, payload:unknown) {
  const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
  const fields=(v:unknown)=>Object.keys(object(v)??{}).filter(k=>/^[a-z][a-z0-9_]{0,39}$/i.test(k)).sort();
  const body=object(payload),rows=Array.isArray(body?.data)?body.data:[];
  return {
    version:BANK_DIRECTORY_VERSION,httpStatus,
    providerStatus:body?.status==="success"?"success":body?.status==="error"?"error":"UNRECOGNISED",
    responseFields:fields(payload),dataShape:Array.isArray(body?.data)?"ARRAY":body?.data===null?"NULL":typeof body?.data,
    entryFields:[...new Set(rows.flatMap(fields))].sort(),entryCount:rows.length,
  };
}
