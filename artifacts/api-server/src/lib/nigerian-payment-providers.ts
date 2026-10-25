/** Only current provider records are institutions. A failed read must never
 * masquerade as a directory made from hardcoded names. No routing guesses. */
export type PaymentAccountProvider = {
  id:string;name:string;code:string|null;transferCodeVerified:boolean;
};
export type PaymentAccountProviderDirectory = {
  status:"AVAILABLE"|"UNAVAILABLE";catalogueEnvironment:"TEST"|"LIVE"|null;
  message:string;providers:PaymentAccountProvider[];
};
const normalized=(name:string)=>name.toLowerCase().replace(/[^a-z0-9]/g,"");
export function paymentAccountProviders(banks:unknown[]|null,environment:"TEST"|"LIVE"|null):PaymentAccountProviderDirectory {
  const providers:PaymentAccountProvider[]=[];
  const namesByCode=new Map<string,Set<string>>();
  for(const value of banks??[]){
    if(!value||typeof value!=="object")continue;
    const row=value as Record<string,unknown>;
    if(typeof row.name!=="string"||!row.name.trim()||row.name.length>180)continue;
    if(typeof row.code==="string"&&/^\d{3,6}$/.test(row.code)){
      const names=namesByCode.get(row.code)??new Set<string>();
      names.add(normalized(row.name));namesByCode.set(row.code,names);
    }
  }
  const seen=new Set<string>();
  for(const [index,value] of (banks??[]).entries()){
    if(!value||typeof value!=="object")continue;
    const row=value as Record<string,unknown>;
    if(typeof row.name!=="string"||!row.name.trim()||row.name.length>180)continue;
    const name=row.name.trim(),key=JSON.stringify([row.code,normalized(name)]);
    if(seen.has(key))continue;
    seen.add(key);
    // Unsupported/non-string codes and ambiguous aliases are isolated, never
    // padded, cast, guessed, or allowed to invalidate unrelated institutions.
    const compatible=typeof row.code==="string"&&/^\d{3,6}$/.test(row.code);
    const verified=!!environment&&compatible&&namesByCode.get(row.code as string)?.size===1;
    const suffix=compatible&&namesByCode.get(row.code as string)?.size===1?row.code
      :`${typeof row.id==="number"&&Number.isSafeInteger(row.id)?`id-${row.id}`:`row-${index}`}`;
    providers.push({id:`flutterwave:${suffix}`,name,code:verified?row.code as string:null,transferCodeVerified:verified});
  }
  const available=!!environment&&providers.some(p=>p.transferCodeVerified);
  const unsupported=providers.filter(p=>!p.transferCodeVerified).length;
  return {status:available?"AVAILABLE":"UNAVAILABLE",catalogueEnvironment:available?environment:null,
    message:available
      ?`Codes confirmed against the Flutterwave Nigerian catalogue. A listing does not confirm account ownership, merchant payout approval or a completed transfer.${unsupported?` ${unsupported} provider records have unsupported or ambiguous codes and cannot be selected for transfer.`:""}`
      :"The Flutterwave bank directory has no confirmed routing codes. Retry the directory or ask the administrator to inspect the directory diagnostic.",
    providers:available?providers.sort((a,b)=>a.name.localeCompare(b.name,"en")):[]};
}
