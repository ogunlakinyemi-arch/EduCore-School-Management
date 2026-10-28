import { flutterwaveLiveStatus } from "./flutterwave-live-config";
import { isIP } from "node:net";
export const DIRECT_STUDENT_RELEASE="STUDENT_DIRECT_3200_V1";
/** Separate release from the retired split engine. Never infer approval from credentials. */
export function directLiveConfiguration(env:NodeJS.ProcessEnv=process.env){
  const configuration=flutterwaveLiveStatus(env);
  let callbackUrl:string|null=null;
  try{
    const u=new URL(env.EDUCORE_FLUTTERWAVE_DIRECT_CALLBACK_URL??"");
    const host=u.hostname.replace(/^\[|\]$/g,"").replace(/\.$/,"");
    const publicHostname=host.includes(".")&&!isIP(host)
      &&!/(?:^|\.)(?:localhost|local|internal)$/.test(host)
      &&!/(?:^|\.)replit\.dev$/.test(host);
    if(u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash
      &&u.pathname==="/api/flutterwave/direct-student/callback"
      &&publicHostname)callbackUrl=u.href;
  }catch{/* Missing is blocked, never guessed from the Development domain. */}
  const merchantScope=env.EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE??"";
  const merchantScopeValid=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/.test(merchantScope);
  // Exact reviewed public origin/path. A configured URL is not proof of dashboard registration.
  const webhookUrl=callbackUrl
    ?new URL("/api/webhooks/flutterwave/direct-student",callbackUrl).href:null;
  const webhookReady=!!webhookUrl&&env.EDUCORE_FLUTTERWAVE_DIRECT_WEBHOOK_URL===webhookUrl;
  const releaseApproved=env.EDUCORE_FLUTTERWAVE_DIRECT_RELEASE===DIRECT_STUDENT_RELEASE;
  return {ready:configuration.configurationReady&&!!callbackUrl&&webhookReady&&merchantScopeValid&&releaseApproved,
    configurationReady:configuration.configurationReady,callbackUrl,webhookUrl,webhookReady,
    merchantScope:merchantScopeValid?merchantScope:null,releaseApproved};
}
