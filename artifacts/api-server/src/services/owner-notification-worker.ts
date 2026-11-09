import {dispatchCommunicationDeliveries,type CommunicationDispatchPool} from "./communication-service";
import {loadOwnerDeliveryControls,ownerNotificationDevelopment,withOwnerNotificationScope} from "./owner-notification-controls";
const status={running:false,lastTickAt:null as string|null,lastErrorCategory:null as string|null};
let busy=false;
export const ownerNotificationWorkerStatus=()=>({...status});
/** Delivery only: no attendance assessment, subscriptions, financial reconciliation or maintenance. */
export async function ownerNotificationWorkerTick(pool:CommunicationDispatchPool){
  if(!ownerNotificationDevelopment()||busy)return;
  busy=true;status.lastTickAt=new Date().toISOString();
  try{
    const controls=await loadOwnerDeliveryControls(pool);
    if(controls.paused||!controls.activatedAt)return;
    const channels:Array<"SMS"|"PUSH"|"TELEGRAM">=[];
    if(controls.smsEnabled)channels.push("SMS");
    if(controls.pushEnabled&&controls.pushParentIds.length)channels.push("PUSH");
    if(controls.telegramEnabled)channels.push("TELEGRAM");
    if(channels.length)await withOwnerNotificationScope(controls,()=>dispatchCommunicationDeliveries(pool,20,{
      allowConfiguredProviders:true,channels,
    }));
    status.lastErrorCategory=null;
  }catch{status.lastErrorCategory="NOTIFICATION_WORKER_UNAVAILABLE";}
  finally{busy=false;}
}
export function startOwnerNotificationWorker(pool:CommunicationDispatchPool){
  if(!ownerNotificationDevelopment()||status.running)return;
  status.running=true;
  void ownerNotificationWorkerTick(pool);
  setInterval(()=>void ownerNotificationWorkerTick(pool),15000).unref();
}
