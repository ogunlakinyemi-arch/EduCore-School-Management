import { flutterwaveLiveStatus } from "./flutterwave-live-config";
export const DIRECT_STUDENT_RELEASE="STUDENT_DIRECT_3200_V1";
/** Separate release from the retired split engine. Never infer approval from credentials. */
export function directLiveConfiguration(env:NodeJS.ProcessEnv=process.env){
  const configuration=flutterwaveLiveStatus(env);
  let callbackUrl:string|null=null;
  try{
    const u=new URL(env.EDUCORE_FLUTTERWAVE_DIRECT_CALLBACK_URL??"");
    if(u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash
      &&u.pathname==="/api/flutterwave/direct-student/callback"
      &&!/(?:localhost|\.replit\.dev)$/.test(u.hostname))callbackUrl=u.href;
  }catch{/* Missing is blocked, never guessed from the Development domain. */}
  const releaseApproved=env.EDUCORE_FLUTTERWAVE_DIRECT_RELEASE===DIRECT_STUDENT_RELEASE;
  return {ready:configuration.configurationReady&&!!callbackUrl&&releaseApproved,
    configurationReady:configuration.configurationReady,callbackUrl,releaseApproved};
}
