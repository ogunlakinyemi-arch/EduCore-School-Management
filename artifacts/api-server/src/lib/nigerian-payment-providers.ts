/** One canonical directory. Offline names are discovery only, NEVER routing
 * instructions. Full coverage comes from the existing payout provider's NG
 * catalogue (commercial/other banks, MFBs and supported digital institutions).
 * Do not put CBN/NIBSS/another gateway's numeric codes in this directory. */
const discoveryProviders = [
  ["access","Access Bank",["access"]],
  ["ecobank","Ecobank Nigeria",["ecobank"]],
  ["fidelity","Fidelity Bank",["fidelity"]],
  ["firstbank","First Bank of Nigeria",["firstbank","firstbankofnigeria"]],
  ["fcmb","First City Monument Bank",["fcmb","firstcitymonument"]],
  ["gtbank","Guaranty Trust Bank",["gtbank","guarantytrust"]],
  ["keystone","Keystone Bank",["keystone"]],
  ["polaris","Polaris Bank",["polaris"]],
  ["stanbic","Stanbic IBTC Bank",["stanbic"]],
  ["sterling","Sterling Bank",["sterling"]],
  ["union","Union Bank of Nigeria",["unionbank"]],
  ["uba","United Bank for Africa",["uba","unitedbankforafrica"]],
  ["unity","Unity Bank",["unitybank"]],
  ["wema","Wema Bank",["wemabank"]],
  ["zenith","Zenith Bank",["zenith"]],
  ["moniepoint","Moniepoint Microfinance Bank",["moniepoint","teamapt"]],
  ["opay","OPay (Paycom)",["opay","paycom"]],
  ["palmpay","PalmPay",["palmpay"]],
] as const;
export type PaymentAccountProvider = {
  id:string;name:string;code:string|null;transferCodeVerified:boolean;
};
export type PaymentAccountProviderDirectory = {
  status:"AVAILABLE"|"UNAVAILABLE";catalogueEnvironment:"TEST"|"LIVE"|null;
  message:string;providers:PaymentAccountProvider[];
};
const normalized=(name:string)=>name.toLowerCase().replace(/[^a-z0-9]/g,"");
export function paymentAccountProviders(banks:unknown[]|null,environment:"TEST"|"LIVE"|null):PaymentAccountProviderDirectory {
  const providers:PaymentAccountProvider[]=discoveryProviders.map(([id,name])=>({
    id:`directory:${id}`,name,code:null,transferCodeVerified:false,
  }));
  const seen=new Map<string,string>();
  if(banks)for(const value of banks){
    if(!value||typeof value!=="object")throw Error("Invalid bank catalogue");
    const row=value as Record<string,unknown>;
    // Preserve leading zeroes: accepting numeric codes would silently invent them.
    if(typeof row.code!=="string"||!/^[0-9]{3,9}$/.test(row.code)
      ||typeof row.name!=="string"||!row.name.trim()||row.name.length>180)throw Error("Invalid bank catalogue");
    const name=row.name.trim(),key=normalized(name),prior=seen.get(row.code);
    if(prior&&prior!==key)throw Error("Ambiguous bank catalogue");
    if(prior)continue;
    seen.set(row.code,key);
    const compatible=/^[0-9]{3,6}$/.test(row.code);
    const index=discoveryProviders.findIndex(([, ,aliases])=>aliases.some(alias=>key.includes(alias)));
    // Multiple distinct provider routes for a name remain separate, never pick
    // one silently (e.g. merchant vs personal accounts at the same institution).
    const discovered=index>=0?providers[index]:null;
    if(discovered&&!discovered.transferCodeVerified){
      discovered.code=compatible?row.code:null;discovered.transferCodeVerified=compatible;
    }else providers.push({id:`flutterwave:${row.code}`,name,code:compatible?row.code:null,transferCodeVerified:compatible});
  }
  const available=!!banks?.length&&!!environment;
  return {status:available?"AVAILABLE":"UNAVAILABLE",catalogueEnvironment:available?environment:null,
    message:available
      ?"Codes confirmed against the Flutterwave Nigerian catalogue. A listing does not confirm account ownership, merchant payout approval or a completed transfer. If your provider is unavailable, refresh or contact your administrator."
      :"The Flutterwave bank catalogue is unavailable. Provider names are for discovery only; new account selection cannot be saved without a confirmed routing code. Refresh or contact your administrator.",
    providers:providers.sort((a,b)=>a.name.localeCompare(b.name,"en"))};
}
